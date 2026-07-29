import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep, mergeProjectJsonMap } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { selectScreenTypes, type ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { Scene } from "@/lib/pipeline/splitScenes";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, getJob, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "screen-types" as const;
const FILENAME = "screen-types.json";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const raw = await readProjectFile(projectId, "scenes.json");
  if (!raw) return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });

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
    console.error("화면 유형 선정 실패:", err);
    finishJob(projectId, STEP, "error", "AI 화면 유형 선정에 실패했습니다");
    return NextResponse.json(
      { error: "AI 화면 유형 선정에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    // Clear any leftover entries from a previous run so a second tab polling
    // mid-regenerate never sees a mix of old-run and new-run scenes.
    await writeProjectFile(projectId, FILENAME, JSON.stringify({ screenTypes: {} }, null, 2));

    let screenTypes: Record<string, ScreenTypeAssignment>;
    try {
      screenTypes = await selectScreenTypes(client, scenes, {
        signal: job.controller.signal,
        onProgress: async (sceneId, index, total, data) => {
          await mergeProjectJsonMap(projectId, FILENAME, "screenTypes", sceneId, data);
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
      console.error("화면 유형 선정 실패:", err);
      finishJob(projectId, STEP, "error", "AI 화면 유형 선정에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 화면 유형 선정에 실패했습니다" }) + "\n");
      return;
    }

    await writeProjectFile(projectId, FILENAME, JSON.stringify({ screenTypes }, null, 2));
    await updateProjectStep(projectId, STEP);
    finishJob(projectId, STEP, "done");

    emit(JSON.stringify({ type: "result", screenTypes }) + "\n");
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

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  if (getJob(projectId, STEP)?.status === "running") {
    return NextResponse.json({ error: "생성이 진행 중입니다. 완료 후 다시 시도해주세요" }, { status: 409 });
  }

  let body: { screenTypes?: unknown };
  try {
    body = await req.json();
  } catch (err) {
    console.error("요청 본문 파싱 실패:", err);
    return NextResponse.json({ error: "요청 본문이 올바른 JSON이 아닙니다" }, { status: 400 });
  }

  if (!isValidScreenTypesMap(body.screenTypes)) {
    return NextResponse.json({ error: "screenTypes 필드의 형식이 올바르지 않습니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, FILENAME, JSON.stringify({ screenTypes: body.screenTypes }, null, 2));
  return NextResponse.json({ ok: true });
}
