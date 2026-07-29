import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep, mergeProjectJsonMap } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { designVisuals, type VisualDesign } from "@/lib/pipeline/designVisuals";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, getJob, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "visual-design" as const;
const FILENAME = "visual-design.json";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  if (!scenesRaw || !screenTypesRaw) {
    return NextResponse.json({ error: "씬 또는 화면 유형 데이터가 없습니다" }, { status: 400 });
  }

  let scenes: Scene[];
  let screenTypes: Record<string, ScreenTypeAssignment>;
  try {
    scenes = JSON.parse(scenesRaw).scenes;
    screenTypes = JSON.parse(screenTypesRaw).screenTypes;
  } catch (err) {
    console.error("씬 또는 화면 유형 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 또는 화면 유형 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes)) {
    return NextResponse.json({ error: "씬 또는 화면 유형 데이터 형식이 올바르지 않습니다" }, { status: 400 });
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
    client = createDeepSeekClient();
  } catch (err) {
    console.error("비주얼 설계 실패:", err);
    finishJob(projectId, STEP, "error", "AI 비주얼 설계에 실패했습니다");
    return NextResponse.json(
      { error: "AI 비주얼 설계에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    await writeProjectFile(projectId, FILENAME, JSON.stringify({ visualDesigns: {} }, null, 2));

    let visualDesigns: Record<string, VisualDesign>;
    try {
      visualDesigns = await designVisuals(client, scenes, screenTypes, {
        signal: job.controller.signal,
        onProgress: async (sceneId, index, total, data) => {
          await mergeProjectJsonMap(projectId, FILENAME, "visualDesigns", sceneId, data);
          recordProgress(projectId, STEP, index, total);
          emit(JSON.stringify({ type: "scene", sceneId, index, total, data }) + "\n");
        },
      });
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("비주얼 설계 실패:", err);
      finishJob(projectId, STEP, "error", "AI 비주얼 설계에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 비주얼 설계에 실패했습니다" }) + "\n");
      return;
    }

    await writeProjectFile(projectId, FILENAME, JSON.stringify({ visualDesigns }, null, 2));
    await updateProjectStep(projectId, STEP);
    finishJob(projectId, STEP, "done");

    emit(JSON.stringify({ type: "result", visualDesigns }) + "\n");
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isVisualDesign(value: unknown): value is VisualDesign {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as VisualDesign).caption === "string" &&
    isStringArray((value as VisualDesign).keywords) &&
    typeof (value as VisualDesign).imageOrDiagramDescription === "string" &&
    typeof (value as VisualDesign).objectPlacement === "string" &&
    isStringArray((value as VisualDesign).appearanceOrder) &&
    typeof (value as VisualDesign).productionNotes === "string"
  );
}

function isValidVisualDesignsMap(value: unknown): value is Record<string, VisualDesign> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every(isVisualDesign);
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (getJob(projectId, STEP)?.status === "running") {
    return NextResponse.json({ error: "생성이 진행 중입니다. 완료 후 다시 시도해주세요" }, { status: 409 });
  }

  let body: { visualDesigns?: unknown } | null;
  try {
    body = await req.json();
  } catch (err) {
    console.error("요청 본문 파싱 실패:", err);
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다" }, { status: 400 });
  }

  if (typeof body !== "object" || body === null || !isValidVisualDesignsMap(body.visualDesigns)) {
    return NextResponse.json({ error: "visualDesigns 필드의 형식이 올바르지 않습니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, FILENAME, JSON.stringify({ visualDesigns: body.visualDesigns }, null, 2));
  return NextResponse.json({ ok: true });
}
