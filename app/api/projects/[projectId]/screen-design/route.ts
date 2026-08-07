import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep, mergeProjectJsonMap } from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { createLlmClient } from "@/lib/ai/llm/factory";
import { selectScreenTypes, type ScreenTypeAssignment, type SceneSequenceContext } from "@/lib/pipeline/selectScreenTypes";
import { computeVisualDesign } from "@/lib/visual-templates";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import type { Scene } from "@/lib/pipeline/splitScenes";
import { loadSequenceContextByScene } from "@/lib/pipeline/loadSequenceContext";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, getJob, JobAlreadyRunningError } from "@/lib/jobs/registry";
import { DEFAULT_SCREEN_DESIGN_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";

const STEP = "screen-design" as const;
const FILENAME = "screen-design.json";

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resume = body?.mode === "resume";

  const raw = await readProjectFile(projectId, "scenes.json");
  if (!raw) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

  const documentSummary = (await readProjectFile(projectId, "document-summary.txt"))?.trim() || undefined;
  const commonPrompt =
    (await readProjectFile(projectId, "screen-design-common-prompt.txt"))?.trim() || DEFAULT_SCREEN_DESIGN_COMMON_PROMPT;

  let existingScreenTypes: Record<string, ScreenTypeAssignment> = {};
  let existingVisualDesigns: Record<string, VisualDesign> = {};
  if (resume) {
    const existingRaw = await readProjectFile(projectId, FILENAME);
    if (existingRaw) {
      try {
        const parsed = JSON.parse(existingRaw);
        existingScreenTypes = parsed.screenTypes ?? {};
        existingVisualDesigns = parsed.visualDesigns ?? {};
      } catch (err) {
        console.error("기존 화면 설계 데이터 파싱 실패 (처음부터 진행):", err);
      }
    }
  }

  let scenes: Scene[];
  try {
    scenes = JSON.parse(raw).scenes;
  } catch (err) {
    console.error("씬 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes)) {
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  let sequenceContextByScene: Record<string, SceneSequenceContext> | undefined;
  if (getProductionMode(project) === "sequence") {
    const contextResult = await loadSequenceContextByScene(projectId, scenes);
    if ("errorResponse" in contextResult) return contextResult.errorResponse;
    sequenceContextByScene = contextResult.sequenceContextByScene;
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
    client = createLlmClient();
  } catch (err) {
    console.error("화면 설계 실패:", err);
    finishJob(projectId, STEP, "error", "AI 화면 설계에 실패했습니다");
    return NextResponse.json(
      { error: "AI 화면 설계에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    if (!resume) {
      // Clear any leftover entries from a previous run so a second tab polling
      // mid-regenerate never sees a mix of old-run and new-run scenes.
      await writeProjectFile(projectId, FILENAME, JSON.stringify({ screenTypes: {}, visualDesigns: {} }, null, 2));
    }

    let screenTypes: Record<string, ScreenTypeAssignment>;
    const visualDesigns: Record<string, VisualDesign> = { ...existingVisualDesigns };
    try {
      screenTypes = await selectScreenTypes(client, scenes, {
        signal: job.controller.signal,
        documentSummary,
        commonPrompt,
        existingAssignments: resume ? existingScreenTypes : undefined,
        sequenceContextByScene,
        onProgress: async (sceneId, index, total, screenType) => {
          const scene = scenes.find((s) => s.id === sceneId);
          const visualDesign = computeVisualDesign(scene!, screenType);
          visualDesigns[sceneId] = visualDesign;
          await mergeProjectJsonMap(projectId, FILENAME, "screenTypes", sceneId, screenType);
          await mergeProjectJsonMap(projectId, FILENAME, "visualDesigns", sceneId, visualDesign);
          recordProgress(projectId, STEP, index, total);
          emit(JSON.stringify({ type: "scene", sceneId, index, total, screenType, visualDesign }) + "\n");
        },
      });
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("화면 설계 실패:", err);
      finishJob(projectId, STEP, "error", "AI 화면 설계에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 화면 설계에 실패했습니다" }) + "\n");
      return;
    }

    await writeProjectFile(projectId, FILENAME, JSON.stringify({ screenTypes, visualDesigns }, null, 2));
    await updateProjectStep(projectId, STEP);
    finishJob(projectId, STEP, "done");

    emit(JSON.stringify({ type: "result", screenTypes, visualDesigns }) + "\n");
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

function isValidScreenTypesMap(value: unknown): value is Record<string, ScreenTypeAssignment> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as ScreenTypeAssignment).screenType === "string" &&
      typeof (entry as ScreenTypeAssignment).recommendedLayout === "string" &&
      typeof (entry as ScreenTypeAssignment).rationale === "string"
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidVisualDesignsMap(value: unknown): value is Record<string, VisualDesign> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(
    (entry) =>
      typeof entry === "object" &&
      entry !== null &&
      typeof (entry as VisualDesign).caption === "string" &&
      isStringArray((entry as VisualDesign).keywords) &&
      typeof (entry as VisualDesign).imageOrDiagramDescription === "string" &&
      typeof (entry as VisualDesign).objectPlacement === "string" &&
      isStringArray((entry as VisualDesign).appearanceOrder) &&
      typeof (entry as VisualDesign).productionNotes === "string"
  );
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (getJob(projectId, STEP)?.status === "running") {
    return NextResponse.json({ error: "생성이 진행 중입니다. 완료 후 다시 시도해주세요" }, { status: 409 });
  }

  let body: { screenTypes?: unknown; visualDesigns?: unknown } | null;
  try {
    body = await req.json();
  } catch (err) {
    console.error("요청 본문 파싱 실패:", err);
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다" }, { status: 400 });
  }

  if (
    typeof body !== "object" ||
    body === null ||
    !isValidScreenTypesMap(body.screenTypes) ||
    !isValidVisualDesignsMap(body.visualDesigns)
  ) {
    return NextResponse.json({ error: "screenTypes 또는 visualDesigns 필드의 형식이 올바르지 않습니다" }, { status: 400 });
  }

  await writeProjectFile(
    projectId,
    FILENAME,
    JSON.stringify({ screenTypes: body.screenTypes, visualDesigns: body.visualDesigns }, null, 2)
  );
  return NextResponse.json({ ok: true });
}
