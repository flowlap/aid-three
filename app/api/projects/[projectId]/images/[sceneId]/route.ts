import { NextRequest, NextResponse } from "next/server";
import {
  readProject,
  readProjectFile,
  readProjectImage,
  readProjectReferenceImage,
  writeProjectImage,
} from "@/lib/projects/store";
import { createOpenAiImageClient } from "@/lib/ai/openaiImageClient";
import { generateSceneImageWithRetry, buildRelatedScenesContext, describeImageError } from "@/lib/pipeline/generateSceneImage";
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
  const backgroundFixed = (await readProjectFile(projectId, "background-fixed-enabled.txt"))?.trim() === "true";
  const genderRaw = (await readProjectFile(projectId, "presenter-gender.txt"))?.trim();
  const presenterGender = genderRaw === "male" || genderRaw === "female" ? genderRaw : undefined;
  const referenceImages = {
    background: backgroundFixed ? (await readProjectReferenceImage(projectId, "background")) ?? undefined : undefined,
    presenter: presenterEnabled ? (await readProjectReferenceImage(projectId, "presenter")) ?? undefined : undefined,
  };

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
  if (scene.sceneType === "title") {
    return NextResponse.json({ error: "제목 씬은 이미지를 생성하지 않습니다" }, { status: 400 });
  }

  let client;
  try {
    client = createOpenAiImageClient();
  } catch (err) {
    console.error("씬 이미지 재생성 실패:", err);
    return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다" }, { status: 502 });
  }

  try {
    const buffer = await generateSceneImageWithRetry(
      client,
      scene,
      design,
      {
        screenType: screenTypes[sceneId]?.screenType,
        commonPrompt,
        presenterEnabled,
        presenterPosition: design.presenterPosition,
        presenterGender,
        backgroundFixed,
        relatedScenes: buildRelatedScenesContext(scene, visualDesigns),
      },
      undefined,
      referenceImages
    );
    await writeProjectImage(projectId, sceneId, buffer);
  } catch (err) {
    const reason = describeImageError(err);
    console.error("씬 이미지 재생성 실패:", err);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
