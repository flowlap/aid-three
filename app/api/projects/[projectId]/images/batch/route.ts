import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  readProject,
  readProjectFile,
  readProjectReferenceImage,
  listProjectImageIds,
  writeImageBatchJob,
  listImageBatchJobIds,
  readImageBatchJob,
  type ImageBatchJobRecord,
} from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import {
  buildImagePrompt,
  buildRelatedScenesContext,
  resolvePresenterPosition,
  type FixedPresenterPosition,
} from "@/lib/pipeline/generateSceneImage";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment, SceneSequenceContext } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { groupContentScenesByParentTitle } from "@/lib/pipeline/sceneHierarchy";
import { loadSequenceContextByScene } from "@/lib/pipeline/loadSequenceContext";
import { groupScenesBySequence, loadSequenceMasterAsset, type SequenceMasterAsset } from "@/lib/pipeline/sequenceLookup";
import type { SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { DEFAULT_IMAGE_COMMON_PROMPT, DEFAULT_SEQUENCE_SCENE_EXTRA_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import {
  submitGeminiImageBatch,
  getGeminiBatchApiKey,
  getGeminiBatchImageModel,
  isGeminiBatchProviderEnabled,
  type GeminiBatchImageItem,
} from "@/lib/ai/image/geminiBatch";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";

/**
 * Mirrors the group-collection logic in images/route.ts's `else if (client)`
 * (real-time cloud) branch — same eligible-scene filter, same grouping, same
 * prompt/reference-image construction — but submits everything as one
 * Gemini Batch API job instead of looping calls. See lib/ai/image/geminiBatch.ts.
 *
 * Composite-mode sequence scenes never reach here: they don't call any image
 * model at all (bakeSequenceSceneStill composites deterministically), so
 * there's nothing for a batch job to do for them — same exclusion
 * images/route.ts's cloud/local branches already apply.
 */
interface ImageSceneGroup {
  sequenceId: string | null;
  scenes: Scene[];
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  if (!isGeminiBatchProviderEnabled()) {
    return NextResponse.json({ error: "IMAGE_BATCH_PROVIDER=gemini로 설정되어 있지 않습니다" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const resume = body?.mode === "resume";
  const alreadyGenerated = resume ? new Set(await listProjectImageIds(projectId)) : new Set<string>();

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  if (!scenesRaw || !screenDesignRaw) {
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터가 없습니다" }, { status: 400 });
  }
  const commonPrompt = (await readProjectFile(projectId, "image-common-prompt.txt"))?.trim() || DEFAULT_IMAGE_COMMON_PROMPT;
  const sequenceSceneExtraPrompt =
    (await readProjectFile(projectId, "sequence-scene-extra-prompt.txt"))?.trim() || DEFAULT_SEQUENCE_SCENE_EXTRA_PROMPT;
  const presenterEnabled = (await readProjectFile(projectId, "image-presenter-enabled.txt"))?.trim() === "true";
  const backgroundFixed = (await readProjectFile(projectId, "background-fixed-enabled.txt"))?.trim() === "true";
  const genderRaw = (await readProjectFile(projectId, "presenter-gender.txt"))?.trim();
  const presenterGender = genderRaw === "male" || genderRaw === "female" ? genderRaw : undefined;
  const fixedPositionRaw = (await readProjectFile(projectId, "presenter-fixed-position.txt"))?.trim();
  const presenterFixedPosition: FixedPresenterPosition =
    fixedPositionRaw === "left" || fixedPositionRaw === "center" || fixedPositionRaw === "right"
      ? fixedPositionRaw
      : "auto";
  const sequenceImageModeRaw = (await readProjectFile(projectId, "sequence-image-mode.txt"))?.trim();
  const sequenceImageMode: "composite" | "ai" = sequenceImageModeRaw === "composite" ? "composite" : "ai";
  const referenceImages = {
    background: backgroundFixed ? (await readProjectReferenceImage(projectId, "background")) ?? undefined : undefined,
    presenter: presenterEnabled ? (await readProjectReferenceImage(projectId, "presenter")) ?? undefined : undefined,
    style: (await readProjectReferenceImage(projectId, "style")) ?? undefined,
  };

  let scenes: Scene[];
  let visualDesigns: Record<string, VisualDesign>;
  let screenTypes: Record<string, ScreenTypeAssignment>;
  try {
    scenes = JSON.parse(scenesRaw).scenes;
    visualDesigns = JSON.parse(screenDesignRaw).visualDesigns;
    screenTypes = JSON.parse(screenDesignRaw).screenTypes ?? {};
  } catch (err) {
    console.error("씬 또는 화면 설계 데이터 파싱 실패:", err);
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }
  if (!Array.isArray(scenes) || typeof visualDesigns !== "object" || visualDesigns === null) {
    return NextResponse.json({ error: "씬 또는 화면 설계 데이터 형식이 올바르지 않습니다" }, { status: 400 });
  }

  let sequenceContextByScene: Record<string, SceneSequenceContext> | undefined;
  let sequencePlan: SequencePlan | undefined;
  if (getProductionMode(project) === "sequence") {
    const contextResult = await loadSequenceContextByScene(projectId, scenes);
    if ("errorResponse" in contextResult) return contextResult.errorResponse;
    sequenceContextByScene = contextResult.sequenceContextByScene;
    sequencePlan = contextResult.plan;
  }

  if (sequencePlan && sequenceImageMode === "composite") {
    return NextResponse.json(
      { error: "이 프로젝트는 시퀀스 합성 모드라 AI 이미지 생성 대상이 없습니다 (마스터+오버레이로 결정론적 합성됨)" },
      { status: 400 }
    );
  }

  const rawGroups: ImageSceneGroup[] = sequencePlan
    ? groupScenesBySequence(scenes, sequencePlan).map((group) => ({ sequenceId: group.sequenceId, scenes: group.scenes }))
    : groupContentScenesByParentTitle(scenes).map((group) => ({ sequenceId: null, scenes: group.scenes }));
  const pendingGroups = rawGroups
    .map((group) => ({
      ...group,
      scenes: group.scenes.filter(
        (scene) => scene.sceneType !== "title" && visualDesigns[scene.id] && !alreadyGenerated.has(scene.id)
      ),
    }))
    .filter((group) => group.scenes.length > 0);

  const sequenceMasterAssets = new Map<string, SequenceMasterAsset>();
  if (sequencePlan) {
    for (const group of pendingGroups) {
      if (!group.sequenceId || sequenceMasterAssets.has(group.sequenceId)) continue;
      const sequence = sequencePlan.sequences.find((seq) => seq.id === group.sequenceId);
      sequenceMasterAssets.set(group.sequenceId, await loadSequenceMasterAsset(projectId, sequence));
    }
  }

  const items: GeminiBatchImageItem[] = pendingGroups.flatMap((group) =>
    group.scenes.map((scene) => {
      const design = visualDesigns[scene.id];
      const masterBuffer = group.sequenceId ? sequenceMasterAssets.get(group.sequenceId)?.buffer : undefined;
      const prompt = buildImagePrompt(scene, design, {
        screenType: screenTypes[scene.id]?.screenType,
        commonPrompt,
        extraPrompt: sequencePlan ? sequenceSceneExtraPrompt : undefined,
        presenterEnabled,
        presenterPosition: resolvePresenterPosition(presenterFixedPosition, design.presenterPosition),
        presenterGender,
        backgroundFixed,
        relatedScenes: buildRelatedScenesContext(scene, visualDesigns),
        sequenceImageContext: sequenceContextByScene?.[scene.id],
        sequenceOverlayRenderMode: sequencePlan ? "bake" : undefined,
        hasMasterReferenceImage: Boolean(masterBuffer),
      });
      const sceneReferenceImages = [referenceImages.style, referenceImages.background, referenceImages.presenter, masterBuffer].filter(
        (buf): buf is Buffer => buf !== undefined && buf.length > 0
      );
      return { key: scene.id, prompt, referenceImages: sceneReferenceImages };
    })
  );

  if (items.length < 2) {
    return NextResponse.json({ error: "배치 생성은 2개 이상의 씬이 있어야 합니다" }, { status: 400 });
  }

  const model = getGeminiBatchImageModel();
  let batchName: string;
  try {
    const apiKey = getGeminiBatchApiKey();
    ({ batchName } = await submitGeminiImageBatch(items, { apiKey, model }));
  } catch (err) {
    console.error("Gemini 배치 이미지 생성 제출 실패:", err);
    return NextResponse.json({ error: describeImageError(err) }, { status: 502 });
  }

  const record: ImageBatchJobRecord = {
    batchId: randomUUID(),
    googleBatchName: batchName,
    model,
    submittedAt: new Date().toISOString(),
    sceneIds: items.map((item) => item.key),
    status: "submitted",
  };
  await writeImageBatchJob(projectId, record);

  return NextResponse.json({ batchId: record.batchId, submittedCount: items.length });
}

/** Lists this project's Gemini image-batch jobs — used by the status panel to resume showing an in-progress job after a page reload. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const batchIds = await listImageBatchJobIds(projectId);
  const records = (await Promise.all(batchIds.map((batchId) => readImageBatchJob(projectId, batchId)))).filter(
    (record): record is ImageBatchJobRecord => record !== null
  );
  records.sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
  return NextResponse.json({ jobs: records });
}
