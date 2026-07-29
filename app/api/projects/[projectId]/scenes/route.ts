import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { splitScenesStream, parseScenesResponse, type Scene } from "@/lib/pipeline/splitScenes";
import { validateNarrationIntegrity } from "@/lib/pipeline/validateNarrationIntegrity";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordChunk, getJob, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "scenes" as const;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const narration = await readProjectFile(projectId, "narration.md");
  if (!narration) return NextResponse.json({ error: "나레이션 마크다운이 없습니다" }, { status: 400 });

  let job;
  try {
    job = startJob(projectId, STEP);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: "이미 실행 중입니다" }, { status: 409 });
    }
    throw err;
  }

  let chunks: AsyncIterable<string>;
  try {
    const client = createDeepSeekClient();
    chunks = await splitScenesStream(client, narration, job.controller.signal);
  } catch (err) {
    console.error("씬 분할 실패:", err);
    finishJob(projectId, STEP, "error", "AI 씬 분할에 실패했습니다");
    return NextResponse.json(
      { error: "AI 씬 분할에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    let raw = "";
    try {
      for await (const delta of chunks) {
        raw += delta;
        recordChunk(projectId, STEP, delta);
        emit(JSON.stringify({ type: "chunk", text: delta }) + "\n");
      }

      let scenes: Scene[];
      try {
        scenes = parseScenesResponse(raw);
      } catch (err) {
        console.error("씬 분할 응답 파싱 실패:", err);
        finishJob(projectId, STEP, "error", "AI 응답 형식이 올바르지 않습니다");
        emit(JSON.stringify({ type: "error", message: "AI 응답 형식이 올바르지 않습니다" }) + "\n");
        return;
      }

      const integrityOk = validateNarrationIntegrity(
        narration,
        scenes.map((s) => s.narrationText)
      );

      await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes }, null, 2));
      await updateProjectStep(projectId, STEP);
      finishJob(projectId, STEP, "done");

      emit(JSON.stringify({ type: "result", scenes, integrityOk }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("씬 분할 스트리밍 중 오류:", err);
      finishJob(projectId, STEP, "error", "AI 씬 분할에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 씬 분할에 실패했습니다" }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (getJob(projectId, STEP)?.status === "running") {
    return NextResponse.json({ error: "생성이 진행 중입니다. 완료 후 다시 시도해주세요" }, { status: 409 });
  }

  const body = (await req.json()) as { scenes?: unknown };
  if (!Array.isArray(body.scenes)) {
    return NextResponse.json({ error: "scenes 필드는 배열이어야 합니다" }, { status: 400 });
  }
  for (const scene of body.scenes) {
    if (
      typeof scene !== "object" ||
      scene === null ||
      typeof (scene as Scene).id !== "string" ||
      typeof (scene as Scene).order !== "number" ||
      typeof (scene as Scene).narrationText !== "string" ||
      typeof (scene as Scene).estimatedDurationSec !== "number" ||
      typeof (scene as Scene).splitReason !== "string"
    ) {
      return NextResponse.json({ error: "scenes 항목의 형식이 올바르지 않습니다" }, { status: 400 });
    }
  }
  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes: body.scenes }, null, 2));
  return NextResponse.json({ ok: true });
}
