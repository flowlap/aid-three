import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, readProjectImage, writeProjectImage } from "@/lib/projects/store";
import { createOpenAiImageClient } from "@/lib/ai/openaiImageClient";
import { generateSceneImage, buildRelatedScenesContext } from "@/lib/pipeline/generateSceneImage";
import { DEFAULT_IMAGE_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sceneId: string }> }
) {
  const { projectId, sceneId } = await params;
  const buffer = await readProjectImage(projectId, sceneId);
  if (!buffer) return NextResponse.json({ error: "이미지를 찾을 수 없습니다" }, { status: 404 });

  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "image/png", "Cache-Control": "no-store" },
  });
}

/** Regenerates a single scene's image without touching the rest. */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sceneId: string }> }
) {
  const { projectId, sceneId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  if (!scenesRaw || !screenDesignRaw) {
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터가 없습니다" }, { status: 400 });
  }
  const commonPrompt = (await readProjectFile(projectId, "image-common-prompt.txt"))?.trim() || DEFAULT_IMAGE_COMMON_PROMPT;
  const presenterEnabled = (await readProjectFile(projectId, "image-presenter-enabled.txt"))?.trim() === "true";

  let scenes: Scene[];
  let visualDesigns: Record<string, VisualDesign>;
  let screenTypes: Record<string, ScreenTypeAssignment>;
  try {
    scenes = JSON.parse(scenesRaw).scenes;
    visualDesigns = JSON.parse(screenDesignRaw).visualDesigns;
    screenTypes = JSON.parse(screenDesignRaw).screenTypes ?? {};
  } catch (err) {
    console.error("씬 재생성 실패:", err);
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  const scene = scenes.find((s) => s.id === sceneId);
  const design = visualDesigns[sceneId];
  if (!scene || !design) return NextResponse.json({ error: "씬을 찾을 수 없습니다" }, { status: 404 });

  let client;
  try {
    client = createOpenAiImageClient();
  } catch (err) {
    console.error("씬 이미지 재생성 실패:", err);
    return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다" }, { status: 502 });
  }

  try {
    const buffer = await generateSceneImage(client, scene, design, {
      screenType: screenTypes[sceneId]?.screenType,
      commonPrompt,
      presenterEnabled,
      presenterPosition: design.presenterPosition,
      relatedScenes: buildRelatedScenesContext(scene, visualDesigns),
    });
    await writeProjectImage(projectId, sceneId, buffer);
  } catch (err) {
    console.error("씬 이미지 재생성 실패:", err);
    return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
