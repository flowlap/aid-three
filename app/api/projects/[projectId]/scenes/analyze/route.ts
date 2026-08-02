import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { analyzeSceneRelations } from "@/lib/pipeline/analyzeSceneRelations";
import type { Scene } from "@/lib/pipeline/splitScenes";

/**
 * Fills in splitReason/relatedSceneIds for scenes that were split
 * deterministically (나레이션(가편집) projects — see splitScenesByBlankLines.ts)
 * instead of by the AI. Scene text/order/id are never touched, only these
 * two metadata fields are added, so this is a single request/response call
 * rather than the streaming job pattern used by the multi-call pipeline
 * steps.
 */
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
  if (!Array.isArray(scenes) || scenes.length === 0) {
    return NextResponse.json({ error: "씬 데이터가 없습니다" }, { status: 400 });
  }

  let client;
  try {
    client = createDeepSeekClient();
  } catch (err) {
    console.error("씬 추가 정보 분석 실패:", err);
    return NextResponse.json({ error: "AI 추가 정보 분석에 실패했습니다" }, { status: 502 });
  }

  let analyses;
  try {
    analyses = await analyzeSceneRelations(client, scenes);
  } catch (err) {
    console.error("씬 추가 정보 분석 실패:", err);
    return NextResponse.json({ error: "AI 추가 정보 분석에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
  }

  const updatedScenes = scenes.map((scene) => {
    const analysis = analyses[scene.id];
    if (!analysis) return scene;
    return {
      id: scene.id,
      order: scene.order,
      narrationText: scene.narrationText,
      estimatedDurationSec: scene.estimatedDurationSec,
      splitReason: analysis.splitReason,
      ...(analysis.relatedSceneIds ? { relatedSceneIds: analysis.relatedSceneIds } : {}),
    };
  });

  await writeProjectFile(projectId, "scenes.json", JSON.stringify({ scenes: updatedScenes }, null, 2));

  return NextResponse.json({ scenes: updatedScenes });
}
