import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, projectAudioDir, listProjectAudioIds, mergeProjectJsonMap } from "@/lib/projects/store";
import { createLocalTtsClient } from "@/lib/ai/localTtsClient";
import { getWavDurationSec } from "@/lib/media/wavDuration";
import { TTS_DEFAULT_VOICE, TTS_DEFAULT_LANG_CODE, TTS_DEFAULT_INSTRUCT } from "@/lib/pipeline/ttsGenerationConfig";
import type { Scene } from "@/lib/pipeline/splitScenes";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "tts" as const;
const MANIFEST_FILENAME = "audio-manifest.json";

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resume = body?.mode === "resume";
  const alreadyGenerated = resume ? new Set(await listProjectAudioIds(projectId)) : new Set<string>();

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  if (!scenesRaw) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

  let scenes: Scene[];
  try {
    scenes = JSON.parse(scenesRaw).scenes;
  } catch (err) {
    console.error("씬 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes)) {
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  let job;
  try {
    job = startJob(projectId, STEP);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: "이미 실행 중입니다" }, { status: 409 });
    }
    throw err;
  }

  let client;
  try {
    client = createLocalTtsClient(projectAudioDir(projectId));
  } catch (err) {
    console.error("음성 생성 실패:", err);
    finishJob(projectId, STEP, "error", err instanceof Error ? err.message : "로컬 TTS 실행에 실패했습니다");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "로컬 TTS 실행에 실패했습니다" },
      { status: 502 }
    );
  }

  const pending = scenes.filter((scene) => !alreadyGenerated.has(scene.id));

  const stream = createResilientStream(async (emit) => {
    let completedSoFar = alreadyGenerated.size;
    try {
      await client.synthesizeBatch(
        pending.map((scene) => ({ sceneId: scene.id, text: scene.narrationText })),
        {
          voice: TTS_DEFAULT_VOICE,
          langCode: TTS_DEFAULT_LANG_CODE,
          instruct: TTS_DEFAULT_INSTRUCT,
          signal: job.controller.signal,
          onScene: async ({ sceneId, audio }) => {
            const durationSec = getWavDurationSec(audio);
            await mergeProjectJsonMap(projectId, MANIFEST_FILENAME, "durations", sceneId, {
              durationSec,
              voice: TTS_DEFAULT_VOICE,
              generatedAt: new Date().toISOString(),
            });
            completedSoFar += 1;
            recordProgress(projectId, STEP, completedSoFar - 1, scenes.length);
            emit(JSON.stringify({ type: "scene", sceneId, index: completedSoFar - 1, total: scenes.length, durationSec }) + "\n");
          },
        }
      );

      finishJob(projectId, STEP, "done");
      emit(JSON.stringify({ type: "result" }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("음성 생성 실패:", err);
      const message = err instanceof Error ? err.message : "로컬 TTS 실행에 실패했습니다";
      finishJob(projectId, STEP, "error", message);
      emit(JSON.stringify({ type: "error", message }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
