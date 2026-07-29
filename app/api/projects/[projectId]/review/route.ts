import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import {
  checkDuplicateLayouts,
  checkOverlongNarration,
  checkSceneNumbering,
  reviewSemanticConsistencyStream,
  parseSemanticReviewResponse,
  type ReviewIssue,
} from "@/lib/pipeline/reviewConsistency";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordChunk, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "review" as const;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  if (!scenesRaw || !screenDesignRaw) {
    return NextResponse.json({ error: "이전 단계 데이터가 모두 필요합니다" }, { status: 400 });
  }

  let scenes: Scene[];
  let screenTypes: Record<string, ScreenTypeAssignment>;
  let visualDesigns: Record<string, VisualDesign>;
  try {
    scenes = JSON.parse(scenesRaw).scenes;
    const screenDesign = JSON.parse(screenDesignRaw);
    screenTypes = screenDesign.screenTypes;
    visualDesigns = screenDesign.visualDesigns;
  } catch (err) {
    console.error("이전 단계 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "이전 단계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes) || typeof screenTypes !== "object" || screenTypes === null || typeof visualDesigns !== "object" || visualDesigns === null) {
    return NextResponse.json({ error: "이전 단계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const deterministic = [
    ...checkDuplicateLayouts(scenes, screenTypes),
    ...checkOverlongNarration(scenes),
    ...checkSceneNumbering(scenes),
  ];

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
    chunks = await reviewSemanticConsistencyStream(client, scenes, visualDesigns, job.controller.signal);
  } catch (err) {
    console.error("일관성 검수 실패:", err);
    finishJob(projectId, STEP, "error", "AI 일관성 검수에 실패했습니다");
    return NextResponse.json(
      { error: "AI 일관성 검수에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    emit(JSON.stringify({ type: "deterministic", issues: deterministic }) + "\n");

    let raw = "";
    try {
      for await (const delta of chunks) {
        raw += delta;
        recordChunk(projectId, STEP, delta);
        emit(JSON.stringify({ type: "chunk", text: delta }) + "\n");
      }

      let semantic: ReviewIssue[];
      try {
        semantic = parseSemanticReviewResponse(raw);
      } catch (err) {
        console.error("일관성 검수 응답 파싱 실패:", err);
        finishJob(projectId, STEP, "error", "AI 응답 형식이 올바르지 않습니다");
        emit(JSON.stringify({ type: "error", message: "AI 응답 형식이 올바르지 않습니다" }) + "\n");
        return;
      }

      const issues = [...deterministic, ...semantic];
      await writeProjectFile(projectId, "review.json", JSON.stringify({ issues }, null, 2));
      await updateProjectStep(projectId, STEP);
      finishJob(projectId, STEP, "done");

      emit(JSON.stringify({ type: "result", issues }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("일관성 검수 스트리밍 중 오류:", err);
      finishJob(projectId, STEP, "error", "AI 일관성 검수에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 일관성 검수에 실패했습니다" }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
