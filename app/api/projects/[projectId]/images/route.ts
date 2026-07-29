import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectImage, updateProjectStep } from "@/lib/projects/store";
import { createOpenAiImageClient } from "@/lib/ai/openaiImageClient";
import { generateSceneImage } from "@/lib/pipeline/generateSceneImage";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, JobAlreadyRunningError } from "@/lib/jobs/registry";

const STEP = "images" as const;

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  if (!scenesRaw || !screenDesignRaw) {
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터가 없습니다" }, { status: 400 });
  }

  let scenes: Scene[];
  let visualDesigns: Record<string, VisualDesign>;
  try {
    scenes = JSON.parse(scenesRaw).scenes;
    visualDesigns = JSON.parse(screenDesignRaw).visualDesigns;
  } catch (err) {
    console.error("씬 또는 화면 설계 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes) || typeof visualDesigns !== "object" || visualDesigns === null) {
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
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
    client = createOpenAiImageClient();
  } catch (err) {
    console.error("이미지 생성 실패:", err);
    finishJob(projectId, STEP, "error", "AI 이미지 생성에 실패했습니다");
    return NextResponse.json(
      { error: "AI 이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  const stream = createResilientStream(async (emit) => {
    try {
      for (let i = 0; i < scenes.length; i++) {
        if (job.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

        const scene = scenes[i];
        const design = visualDesigns[scene.id];
        if (!design) continue;

        const buffer = await generateSceneImage(client, scene, design, { signal: job.controller.signal });
        await writeProjectImage(projectId, scene.id, buffer);
        recordProgress(projectId, STEP, i, scenes.length);
        emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: i, total: scenes.length }) + "\n");
      }

      await updateProjectStep(projectId, STEP);
      finishJob(projectId, STEP, "done");
      emit(JSON.stringify({ type: "result" }) + "\n");
    } catch (err) {
      if (job.controller.signal.aborted) {
        finishJob(projectId, STEP, "cancelled");
        emit(JSON.stringify({ type: "cancelled" }) + "\n");
        return;
      }
      console.error("이미지 생성 실패:", err);
      finishJob(projectId, STEP, "error", "AI 이미지 생성에 실패했습니다");
      emit(JSON.stringify({ type: "error", message: "AI 이미지 생성에 실패했습니다" }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
