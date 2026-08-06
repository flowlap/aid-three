import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeSequencePlan, updateProjectStep } from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { createLlmClient } from "@/lib/ai/llm/factory";
import { planSequencesStream, parseSequencePlanResponse } from "@/lib/pipeline/planSequences";
import { validateSequenceIntegrity } from "@/lib/pipeline/validateSequenceIntegrity";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { Sequence, SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordChunk, getJob, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "sequences" as const;

/**
 * Mode gate: this whole route only makes sense for sequence-mode projects.
 * sequences.json must never be written for a scene-mode project (see the
 * plan doc's non-negotiable compatibility rules), and generating a plan for
 * scenes the project isn't set up to review/edit in this mode would be
 * dead weight at best. This is the first API-level mode gate in the
 * codebase (Task 2's gating was navigation-only), so both verbs check it
 * explicitly up front rather than relying on the UI to never call this route
 * for a scene-mode project.
 */
const NOT_SEQUENCE_MODE_ERROR = "시퀀스 제작 모드 프로젝트가 아닙니다";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  if (getProductionMode(project) !== "sequence") {
    return NextResponse.json({ error: NOT_SEQUENCE_MODE_ERROR }, { status: 400 });
  }

  const rawScenes = await readProjectFile(projectId, "scenes.json");
  if (!rawScenes) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

  let scenes: Scene[];
  try {
    scenes = JSON.parse(rawScenes).scenes;
  } catch (err) {
    console.error("씬 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes) || scenes.length === 0) {
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

  let client: ReturnType<typeof createLlmClient>;
  let chunkStream: AsyncIterable<string>;
  try {
    client = createLlmClient();
    chunkStream = await planSequencesStream(client, scenes, job.controller.signal);
  } catch (err) {
    console.error("시퀀스 계획 생성 실패:", err);
    finishJob(projectId, STEP, "error", "AI 시퀀스 계획 생성에 실패했습니다");
    return NextResponse.json(
      { error: "AI 시퀀스 계획 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    try {
      let raw = "";
      for await (const delta of chunkStream) {
        raw += delta;
        recordChunk(projectId, STEP, delta);
        emit(JSON.stringify({ type: "chunk", text: delta }) + "\n");
      }

      let plan: SequencePlan;
      try {
        plan = parseSequencePlanResponse(raw);
      } catch (err) {
        console.error("시퀀스 계획 응답 파싱 실패:", err);
        finishJob(projectId, STEP, "error", "AI 응답 형식이 올바르지 않습니다");
        emit(JSON.stringify({ type: "error", message: "AI 응답 형식이 올바르지 않습니다" }) + "\n");
        return;
      }

      // Computed and attached before writing (per the plan doc), but — like
      // scenes/route.ts's validateNarrationIntegrity/integrityOk — issues do
      // not block the write. validateSequenceIntegrity's issues are designed
      // to be recoverable/user-facing (Task 3), and the sequence-plan editor
      // (Task 5) is where the user is expected to see and fix them, the same
      // way scene-split integrity problems are surfaced but not blocking.
      const issues = validateSequenceIntegrity(scenes, plan);

      await writeSequencePlan(projectId, plan);
      await updateProjectStep(projectId, STEP);
      finishJob(projectId, STEP, "done");

      emit(JSON.stringify({ type: "result", plan, issues }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("시퀀스 계획 생성 중 오류:", err);
      finishJob(projectId, STEP, "error", "AI 시퀀스 계획 생성에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 시퀀스 계획 생성에 실패했습니다" }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isValidSequenceShape(value: unknown): value is Sequence {
  if (typeof value !== "object" || value === null) return false;
  const seq = value as Sequence;
  return (
    typeof seq.id === "string" &&
    typeof seq.order === "number" &&
    typeof seq.title === "string" &&
    isStringArray(seq.sceneIds) &&
    typeof seq.estimatedDurationSec === "number" &&
    typeof seq.purpose === "string" &&
    typeof seq.continuity === "object" &&
    seq.continuity !== null &&
    typeof seq.continuity.location === "string" &&
    typeof seq.continuity.visualStyle === "string" &&
    isStringArray(seq.continuity.fixedElements) &&
    isStringArray(seq.continuity.doNotChange) &&
    typeof seq.masterVisual === "object" &&
    seq.masterVisual !== null &&
    typeof seq.masterVisual.description === "string" &&
    typeof seq.masterVisual.status === "string" &&
    Array.isArray(seq.cameraPlan) &&
    Array.isArray(seq.overlays)
  );
}

function isValidSequencePlanShape(value: unknown): value is SequencePlan {
  if (typeof value !== "object" || value === null) return false;
  const plan = value as SequencePlan;
  return plan.version === 1 && Array.isArray(plan.sequences) && plan.sequences.every(isValidSequenceShape);
}

/**
 * Saves a manually-edited plan (Task 5's editor). Unlike POST's generation
 * path, PUT rejects on any severity:"error" integrity issue rather than
 * writing anyway — a human-edited save is expected to actually be correct
 * before it lands on disk, whereas a freshly-generated draft is expected to
 * still need review. severity:"warning" issues (e.g. duration-mismatch) do
 * NOT block the save: they're informational drift signals, not structural
 * corruption, and blocking a save over a stale duration estimate would be
 * needlessly punishing for what is likely a legitimate manual edit.
 */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });
  if (getProductionMode(project) !== "sequence") {
    return NextResponse.json({ error: NOT_SEQUENCE_MODE_ERROR }, { status: 400 });
  }

  if (getJob(projectId, STEP)?.status === "running") {
    return NextResponse.json({ error: "생성이 진행 중입니다. 완료 후 다시 시도해주세요" }, { status: 409 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    console.error("요청 본문 파싱 실패:", err);
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다" }, { status: 400 });
  }

  if (!isValidSequencePlanShape(body)) {
    return NextResponse.json({ error: "시퀀스 계획 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const rawScenes = await readProjectFile(projectId, "scenes.json");
  if (!rawScenes) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

  let scenes: Scene[];
  try {
    scenes = JSON.parse(rawScenes).scenes;
  } catch (err) {
    console.error("씬 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes)) {
    return NextResponse.json({ error: "씬 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const issues = validateSequenceIntegrity(scenes, body);
  if (issues.some((issue) => issue.severity === "error")) {
    return NextResponse.json({ error: "시퀀스 계획이 씬 데이터와 맞지 않습니다", issues }, { status: 400 });
  }

  await writeSequencePlan(projectId, body);
  return NextResponse.json({ ok: true, issues });
}
