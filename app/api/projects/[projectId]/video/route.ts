import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "fs";
import { Readable } from "stream";
import {
  readProject,
  readProjectFile,
  readProjectImage,
  readProjectAudio,
  listProjectAudioIds,
  listProjectVideoClipIds,
  writeProjectVideoFrame,
  projectVideoFramePath,
  projectAudioPath,
  projectVideoClipPath,
  projectVideoPath,
  statProjectVideo,
} from "@/lib/projects/store";
import { renderSceneFrameToPng } from "@/lib/video/renderSceneFrameToPng";
import { buildVideoClip } from "@/lib/video/buildVideoClip";
import { concatClips } from "@/lib/video/concatClips";
import { assertFfmpegAvailable } from "@/lib/media/ffmpeg";
import { getWavDurationSec } from "@/lib/media/wavDuration";
import { runWithConcurrencyLimit } from "@/lib/concurrency";
import { VIDEO_RENDER_CONCURRENCY } from "@/lib/pipeline/videoRenderConfig";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "video" as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resume = body?.mode === "resume";

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  if (!scenesRaw) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

  let scenes: Scene[];
  try {
    scenes = JSON.parse(scenesRaw).scenes;
  } catch (err) {
    console.error("씬 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  }

  const audioIds = new Set(await listProjectAudioIds(projectId));
  const missingAudio = scenes.filter((scene) => !audioIds.has(scene.id));
  if (missingAudio.length > 0) {
    return NextResponse.json(
      { error: `${missingAudio.length}개 씬에 내레이션 음성이 없습니다. 먼저 내레이션 음성 생성을 완료해주세요.` },
      { status: 400 }
    );
  }

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const visualDesigns: Record<string, VisualDesign> = screenDesignRaw
    ? (JSON.parse(screenDesignRaw).visualDesigns ?? {})
    : {};
  let durations: number[];
  try {
    durations = await Promise.all(
      scenes.map(async (scene) => {
        const audio = await readProjectAudio(projectId, scene.id);
        if (!audio) throw new Error(`씬 ${scene.order}의 내레이션 음성을 찾을 수 없습니다`);
        return getWavDurationSec(audio);
      })
    );
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "내레이션 음성 길이를 읽을 수 없습니다" }, { status: 400 });
  }

  try {
    await assertFfmpegAvailable();
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "ffmpeg를 사용할 수 없습니다" }, { status: 502 });
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

  const existingClipIds = resume ? new Set(await listProjectVideoClipIds(projectId)) : new Set<string>();
  const pending = scenes.filter((scene) => !existingClipIds.has(scene.id));

  const stream = createResilientStream(async (emit) => {
    let completedSoFar = existingClipIds.size;
    try {
      await runWithConcurrencyLimit(pending, VIDEO_RENDER_CONCURRENCY, async (scene) => {
        if (job.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const design = visualDesigns[scene.id];
        const imageBuffer = await readProjectImage(projectId, scene.id);
        const framePng = await renderSceneFrameToPng(scene, design, imageBuffer ?? undefined);
        await writeProjectVideoFrame(projectId, scene.id, framePng);

        await buildVideoClip(
          projectVideoFramePath(projectId, scene.id),
          projectAudioPath(projectId, scene.id),
          projectVideoClipPath(projectId, scene.id),
          job.controller.signal
        );

        completedSoFar += 1;
        recordProgress(projectId, STEP, completedSoFar - 1, scenes.length);
        emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: completedSoFar - 1, total: scenes.length }) + "\n");
      });

      emit(JSON.stringify({ type: "concatenating" }) + "\n");
      const clipPaths = scenes.map((scene) => projectVideoClipPath(projectId, scene.id));
      await concatClips(clipPaths, durations, projectVideoPath(projectId), job.controller.signal);

      finishJob(projectId, STEP, "done");
      emit(JSON.stringify({ type: "result" }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("동영상 생성 실패:", err);
      const message = err instanceof Error ? err.message : "동영상 생성에 실패했습니다";
      finishJob(projectId, STEP, "error", message);
      emit(JSON.stringify({ type: "error", message }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

/** Serves the final mp4 with Range support so <video> can seek/scrub without downloading the whole file. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const info = await statProjectVideo(projectId);
  if (!info) return NextResponse.json({ error: "생성된 동영상이 없습니다" }, { status: 404 });

  const range = req.headers.get("range");
  const commonHeaders = {
    "Content-Type": "video/mp4",
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store",
  };

  if (!range) {
    const stream = Readable.toWeb(createReadStream(info.path)) as ReadableStream;
    return new Response(stream, { headers: { ...commonHeaders, "Content-Length": String(info.size) } });
  }

  const match = range.match(/bytes=(\d*)-(\d*)/);
  const start = match?.[1] ? parseInt(match[1], 10) : 0;
  const end = match?.[2] ? Math.min(parseInt(match[2], 10), info.size - 1) : info.size - 1;

  const stream = Readable.toWeb(createReadStream(info.path, { start, end })) as ReadableStream;
  return new Response(stream, {
    status: 206,
    headers: {
      ...commonHeaders,
      "Content-Range": `bytes ${start}-${end}/${info.size}`,
      "Content-Length": String(end - start + 1),
    },
  });
}
