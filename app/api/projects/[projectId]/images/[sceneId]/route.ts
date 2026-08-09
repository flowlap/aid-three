import { NextRequest, NextResponse } from "next/server";
import {
  readProject,
  readProjectFile,
  readProjectImage,
  readProjectReferenceImage,
  projectReferenceImagePath,
  projectImagesDir,
  writeProjectImage,
} from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { createImageClient } from "@/lib/ai/image/factory";
import { createLocalImageClient } from "@/lib/ai/localImageClient";
import {
  generateSceneImageWithRetry,
  buildImagePrompt,
  buildRelatedScenesContext,
  describeImageError,
} from "@/lib/pipeline/generateSceneImage";
import { DEFAULT_IMAGE_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import {
  LOCAL_IMAGE_FINAL_WIDTH,
  LOCAL_IMAGE_FINAL_HEIGHT,
  LOCAL_IMAGE_STEPS,
  LOCAL_IMAGE_QUANTIZE,
  type LocalImageModelSize,
} from "@/lib/pipeline/imageGenerationConfig";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { withInFlightLock, AlreadyInFlightError } from "@/lib/jobs/inFlightLock";
import { loadSequenceContextByScene } from "@/lib/pipeline/loadSequenceContext";
import { findSequenceForScene, loadSequenceMasterAsset } from "@/lib/pipeline/sequenceLookup";
import { bakeSequenceSceneStill } from "@/lib/pipeline/bakeSequenceSceneStill";
import { computeFrameDimensions } from "@/lib/video/frameDimensions";
import { getProjectImageAspectRatio } from "@/lib/pipeline/imageAspectRatio";

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

interface RegenerateSceneOverrides {
  extraPrompt?: string;
  backgroundFixed?: boolean;
  presenterEnabled?: boolean;
  styleReferenceEnabled?: boolean;
}

/** Regenerates a single scene's image without touching the rest. Uses the local engine's higher (final-quality) resolution when local generation is selected — a deliberate one-off action, unlike the fast draft pass the full-batch route uses. Accepts an optional JSON body of one-off overrides (see RegenerateSceneOverrides) that apply only to this regeneration and are never persisted. */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ projectId: string; sceneId: string }> }
) {
  const { projectId, sceneId } = await params;
  const overrides: RegenerateSceneOverrides = await req.json().catch(() => ({}));
  try {
    return await withInFlightLock(`images:${projectId}:${sceneId}`, () => regenerateScene(projectId, sceneId, overrides));
  } catch (err) {
    if (err instanceof AlreadyInFlightError) {
      return NextResponse.json({ error: "이 씬은 이미 재생성 중입니다. 완료될 때까지 기다려주세요." }, { status: 409 });
    }
    throw err;
  }
}

async function regenerateScene(projectId: string, sceneId: string, overrides: RegenerateSceneOverrides): Promise<NextResponse> {
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  if (!scenesRaw || !screenDesignRaw) {
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터가 없습니다" }, { status: 400 });
  }
  const commonPrompt = (await readProjectFile(projectId, "image-common-prompt.txt"))?.trim() || DEFAULT_IMAGE_COMMON_PROMPT;
  const projectPresenterEnabled = (await readProjectFile(projectId, "image-presenter-enabled.txt"))?.trim() === "true";
  const projectBackgroundFixed = (await readProjectFile(projectId, "background-fixed-enabled.txt"))?.trim() === "true";
  const genderRaw = (await readProjectFile(projectId, "presenter-gender.txt"))?.trim();
  const presenterGender = genderRaw === "male" || genderRaw === "female" ? genderRaw : undefined;
  const engineRaw = (await readProjectFile(projectId, "image-engine.txt"))?.trim();
  const engine: "openai" | "local" = engineRaw === "local" ? "local" : "openai";
  const modelSizeRaw = (await readProjectFile(projectId, "image-local-model-size.txt"))?.trim();
  const localModelSize: LocalImageModelSize = modelSizeRaw === "9b" ? "9b" : "4b";
  const hchatGeminiModel = (await readProjectFile(projectId, "image-hchat-gemini-model.txt"))?.trim() || undefined;

  const presenterEnabled = overrides.presenterEnabled ?? projectPresenterEnabled;
  const backgroundFixed = overrides.backgroundFixed ?? projectBackgroundFixed;
  const styleReferenceEnabled = overrides.styleReferenceEnabled ?? true;
  const extraPrompt = overrides.extraPrompt;

  const referenceImages = {
    background: backgroundFixed ? (await readProjectReferenceImage(projectId, "background")) ?? undefined : undefined,
    presenter: presenterEnabled ? (await readProjectReferenceImage(projectId, "presenter")) ?? undefined : undefined,
    style: styleReferenceEnabled ? (await readProjectReferenceImage(projectId, "style")) ?? undefined : undefined,
  };
  const referenceImagePaths = [
    referenceImages.background ? projectReferenceImagePath(projectId, "background") : null,
    referenceImages.presenter ? projectReferenceImagePath(projectId, "presenter") : null,
    referenceImages.style ? projectReferenceImagePath(projectId, "style") : null,
  ].filter((p): p is string => p !== null);

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

  // Sequence mode: reuse the same shared prerequisite gate the screen-design
  // routes use (loadSequenceContextByScene) rather than hand-rolling a
  // narrower one just for this single scene. If the sequence plan is
  // missing/broken, a single-scene regenerate is blocked the same way a full
  // batch run would be — a broken plan genuinely blocks meaningful per-scene
  // generation in this mode. When this scene's owning sequence has no
  // readable master image (not-generated, or a missing asset file), proceed
  // without one (buildImagePrompt's textual continuity fallback handles it)
  // — there's no stream here to emit a warning event on, so nothing further
  // to do for that case. "stale" masters are still real, readable files and
  // are reused just like "generated" ones — see loadSequenceMasterAsset.
  // Sequence mode: a scene's still is a deterministic composite of its
  // sequence's master image (cropped to the camera motion's first frame) +
  // its overlay layer — not an AI image. So "regenerate" here re-bakes that
  // composite; the AI engine paths below are never reached in sequence mode.
  if (getProductionMode(project) === "sequence") {
    const contextResult = await loadSequenceContextByScene(projectId, scenes);
    if ("errorResponse" in contextResult) return contextResult.errorResponse;
    const owningSequence = findSequenceForScene(contextResult.plan, sceneId);
    const masterAsset = await loadSequenceMasterAsset(projectId, owningSequence);
    const frameDimensions = computeFrameDimensions(await getProjectImageAspectRatio(projectId));
    const result = await bakeSequenceSceneStill({
      projectId,
      sceneId,
      sequence: owningSequence,
      masterAsset,
      frameDimensions,
    });
    if (!result.baked) {
      return NextResponse.json(
        {
          error:
            "이 씬이 속한 시퀀스의 마스터 이미지가 아직 없습니다. ‘시퀀스 설계’ 단계에서 마스터 비주얼을 먼저 생성해주세요.",
        },
        { status: 400 }
      );
    }
    return NextResponse.json({ ok: true });
  }

  if (engine === "local") {
    let localClient;
    try {
      localClient = createLocalImageClient(projectImagesDir(projectId));
    } catch (err) {
      console.error("씬 이미지 재생성 실패:", err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "로컬 이미지 생성에 실패했습니다" }, { status: 502 });
    }

    const prompt = buildImagePrompt(scene, design, {
      screenType: screenTypes[sceneId]?.screenType,
      commonPrompt,
      presenterEnabled,
      presenterPosition: design.presenterPosition,
      presenterGender,
      backgroundFixed,
      relatedScenes: buildRelatedScenesContext(scene, visualDesigns),
      allowTextInImage: false,
      extraPrompt,
    });
    const itemReferenceImagePaths = referenceImagePaths;

    try {
      let generatedImage: Buffer | undefined;
      await localClient.generateBatch([{ sceneId, prompt, referenceImagePaths: itemReferenceImagePaths }], {
        modelSize: localModelSize,
        width: LOCAL_IMAGE_FINAL_WIDTH,
        height: LOCAL_IMAGE_FINAL_HEIGHT,
        steps: LOCAL_IMAGE_STEPS,
        quantize: LOCAL_IMAGE_QUANTIZE,
        onScene: async ({ image }) => {
          generatedImage = image;
        },
      });
      if (!generatedImage) throw new Error("로컬 이미지 생성 결과가 비어 있습니다");
      await writeProjectImage(projectId, sceneId, generatedImage);
    } catch (err) {
      console.error("씬 이미지 재생성 실패:", err);
      return NextResponse.json({ error: err instanceof Error ? err.message : "로컬 이미지 생성에 실패했습니다" }, { status: 502 });
    }

    return NextResponse.json({ ok: true });
  }

  let client;
  try {
    client = createImageClient({ hchatGeminiModel });
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
        extraPrompt,
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
