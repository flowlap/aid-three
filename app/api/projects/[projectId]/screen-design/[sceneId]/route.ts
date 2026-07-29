import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, mergeProjectJsonMap } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { selectScreenTypes } from "@/lib/pipeline/selectScreenTypes";
import { computeVisualDesign } from "@/lib/visual-templates";
import type { Scene } from "@/lib/pipeline/splitScenes";

const FILENAME = "screen-design.json";

/** Regenerates a single scene's screen type + visual design without touching the rest. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sceneId: string }> }
) {
  const { projectId, sceneId } = await params;
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

  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) return NextResponse.json({ error: "씬을 찾을 수 없습니다" }, { status: 404 });

  let client;
  try {
    client = createDeepSeekClient();
  } catch (err) {
    console.error("씬 재생성 실패:", err);
    return NextResponse.json({ error: "AI 화면 설계에 실패했습니다" }, { status: 502 });
  }

  let screenTypes;
  try {
    screenTypes = await selectScreenTypes(client, [scene]);
  } catch (err) {
    console.error("씬 재생성 실패:", err);
    return NextResponse.json({ error: "AI 화면 설계에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
  }

  const screenType = screenTypes[scene.id];
  const visualDesign = computeVisualDesign(scene, screenType);

  await mergeProjectJsonMap(projectId, FILENAME, "screenTypes", sceneId, screenType);
  await mergeProjectJsonMap(projectId, FILENAME, "visualDesigns", sceneId, visualDesign);

  return NextResponse.json({ screenType, visualDesign });
}
