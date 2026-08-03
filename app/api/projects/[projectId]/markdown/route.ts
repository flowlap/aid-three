import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createLlmClient } from "@/lib/ai/llm/factory";
import type { LlmClient } from "@/lib/ai/llm/types";
import { convertToMarkdownStream } from "@/lib/pipeline/convertMarkdown";
import { summarizeDocument } from "@/lib/pipeline/summarizeDocument";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordChunk, getJob, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "markdown" as const;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const rawText = await readProjectFile(projectId, "extracted.txt");
  if (!rawText) return NextResponse.json({ error: "업로드된 원본 텍스트가 없습니다" }, { status: 400 });

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
  let client: LlmClient;
  try {
    client = createLlmClient();
    chunks = await convertToMarkdownStream(client, rawText, project.scriptType, job.controller.signal);
  } catch (err) {
    console.error("마크다운 변환 실패:", err);
    finishJob(projectId, STEP, "error", "AI 변환에 실패했습니다");
    return NextResponse.json(
      { error: "AI 변환에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    let fullMarkdown = "";
    try {
      for await (const delta of chunks) {
        fullMarkdown += delta;
        recordChunk(projectId, STEP, delta);
        emit(JSON.stringify({ type: "chunk", text: delta }) + "\n");
      }

      await writeProjectFile(projectId, "narration.md", fullMarkdown);

      // Best-effort: later steps (screen-design) work fine without this, so a
      // failure here shouldn't fail the markdown step itself.
      try {
        const summary = await summarizeDocument(client, fullMarkdown, job.controller.signal);
        await writeProjectFile(projectId, "document-summary.txt", summary);
      } catch (err) {
        console.error("문서 전체 요약 생성 실패 (건너뜀):", err);
      }

      await updateProjectStep(projectId, STEP);
      finishJob(projectId, STEP, "done");
      emit(JSON.stringify({ type: "result", markdown: fullMarkdown }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("마크다운 스트리밍 중 오류:", err);
      finishJob(projectId, STEP, "error", "AI 변환에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 변환에 실패했습니다" }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (getJob(projectId, STEP)?.status === "running") {
    return NextResponse.json({ error: "생성이 진행 중입니다. 완료 후 다시 시도해주세요" }, { status: 409 });
  }

  const body = (await req.json()) as { markdown?: unknown };
  if (typeof body.markdown !== "string") {
    return NextResponse.json({ error: "markdown 필드는 문자열이어야 합니다" }, { status: 400 });
  }
  await writeProjectFile(projectId, "narration.md", body.markdown);
  return NextResponse.json({ ok: true });
}
