import { NextRequest, NextResponse } from "next/server";
import {
  readProject,
  readProjectFile,
  readProjectReferenceImage,
  projectReferenceImagePath,
  projectImagesDir,
  writeProjectImage,
  updateProjectStep,
  listProjectImageIds,
} from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { createImageClient } from "@/lib/ai/image/factory";
import type { ImageClient } from "@/lib/ai/image/types";
import { createLocalImageClient, type LocalImageClient } from "@/lib/ai/localImageClient";
import {
  generateSceneImageWithRetry,
  buildImagePrompt,
  buildRelatedScenesContext,
  describeImageError,
  type SceneReferenceImages,
} from "@/lib/pipeline/generateSceneImage";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment, SceneSequenceContext } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, JobAlreadyRunningError } from "@/lib/jobs/registry";
import { runWithConcurrencyLimit } from "@/lib/concurrency";
import { groupContentScenesByParentTitle } from "@/lib/pipeline/sceneHierarchy";
import { loadSequenceContextByScene } from "@/lib/pipeline/loadSequenceContext";
import { groupScenesBySequence, loadSequenceMasterAsset, type SequenceMasterAsset } from "@/lib/pipeline/sequenceLookup";
import type { SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { bakeSequenceSceneStill } from "@/lib/pipeline/bakeSequenceSceneStill";
import { computeFrameDimensions } from "@/lib/video/frameDimensions";
import { getProjectImageAspectRatio } from "@/lib/pipeline/imageAspectRatio";
import {
  IMAGE_GENERATION_CONCURRENCY,
  LOCAL_IMAGE_DRAFT_WIDTH,
  LOCAL_IMAGE_DRAFT_HEIGHT,
  LOCAL_IMAGE_STEPS,
  LOCAL_IMAGE_QUANTIZE,
  type LocalImageModelSize,
} from "@/lib/pipeline/imageGenerationConfig";
import { DEFAULT_IMAGE_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";

/**
 * A unit of work for image generation: either a sequence-mode group (all
 * scenes belonging to one Sequence, sequenceId set) or a scene-mode group
 * (a nearest-title cluster from groupContentScenesByParentTitle, sequenceId
 * null). Downstream generation code only ever reads `.scenes`; `sequenceId`
 * is consulted solely to look up that group's sequence master image.
 */
interface ImageSceneGroup {
  sequenceId: string | null;
  scenes: Scene[];
}

const STEP = "images" as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const resume = body?.mode === "resume";
  const alreadyGenerated = resume ? new Set(await listProjectImageIds(projectId)) : new Set<string>();

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
  const engineRaw = (await readProjectFile(projectId, "image-engine.txt"))?.trim();
  const engine: "openai" | "local" = engineRaw === "local" ? "local" : "openai";
  const modelSizeRaw = (await readProjectFile(projectId, "image-local-model-size.txt"))?.trim();
  const localModelSize: LocalImageModelSize = modelSizeRaw === "9b" ? "9b" : "4b";
  const hchatGeminiModel = (await readProjectFile(projectId, "image-hchat-gemini-model.txt"))?.trim() || undefined;
  const referenceImages = {
    background: backgroundFixed ? (await readProjectReferenceImage(projectId, "background")) ?? undefined : undefined,
    presenter: presenterEnabled ? (await readProjectReferenceImage(projectId, "presenter")) ?? undefined : undefined,
    style: (await readProjectReferenceImage(projectId, "style")) ?? undefined,
  };
  // Same reference set for every scene — used as the multi-image /images/edits input for OpenAI, or as
  // Flux2KleinEdit's image_paths for the local engine (paths, not buffers — mflux reads files directly).
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

  let job;
  try {
    job = startJob(projectId, STEP);
  } catch (err) {
    if (err instanceof JobAlreadyRunningError) {
      return NextResponse.json({ error: "이미 실행 중입니다" }, { status: 409 });
    }
    throw err;
  }

  // Sequence mode composites each scene from the sequence master + overlays
  // (no image model per scene — see bakeSequenceSceneStill), so no image
  // client is created; only scene-mode's per-scene generation needs one.
  const frameDimensions = sequencePlan
    ? computeFrameDimensions(await getProjectImageAspectRatio(projectId))
    : undefined;

  let client: ImageClient | undefined;
  let localClient: LocalImageClient | undefined;
  if (sequencePlan) {
    // no-op: no AI image client needed in sequence mode
  } else if (engine === "local") {
    try {
      localClient = createLocalImageClient(projectImagesDir(projectId));
    } catch (err) {
      console.error("로컬 이미지 생성 실패:", err);
      const message = err instanceof Error ? err.message : "로컬 이미지 생성에 실패했습니다";
      finishJob(projectId, STEP, "error", message);
      return NextResponse.json({ error: message }, { status: 502 });
    }
  } else {
    try {
      client = createImageClient({ hchatGeminiModel });
    } catch (err) {
      console.error("이미지 생성 실패:", err);
      finishJob(projectId, STEP, "error", "AI 이미지 생성에 실패했습니다");
      return NextResponse.json(
        { error: "AI 이미지 생성에 실패했습니다. 잠시 후 다시 시도해주세요." },
        { status: 502 }
      );
    }
  }

  const stream = createResilientStream(async (emit) => {
    try {
      // Title scenes never get an AI image — the final video frame renderer
      // (renderSceneFrame.tsx) already falls back to a plain caption card
      // when there's no image, which is exactly the look a title/divider
      // scene wants, so there's no need to spend an image call on it.
      const eligibleScenes = scenes.filter((scene) => scene.sceneType !== "title" && visualDesigns[scene.id]);
      const total = eligibleScenes.length;

      // Grouped by owning sequence in sequence mode (see sequenceLookup.ts),
      // or the same nearest-title clustering as screen design in scene mode
      // (see selectScreenTypes.ts / sceneHierarchy.ts) — either way, one
      // unit of work per group, so scenes that should stay visually
      // consistent (a chapter, or a sequence) generate together instead of
      // being interleaved arbitrarily with unrelated scenes.
      const rawGroups: ImageSceneGroup[] = sequencePlan
        ? groupScenesBySequence(scenes, sequencePlan).map((group) => ({ sequenceId: group.sequenceId, scenes: group.scenes }))
        : groupContentScenesByParentTitle(scenes).map((group) => ({ sequenceId: null, scenes: group.scenes }));
      const pendingGroups = rawGroups
        .map((group) => ({
          ...group,
          scenes: group.scenes.filter((scene) => visualDesigns[scene.id] && !alreadyGenerated.has(scene.id)),
        }))
        .filter((group) => group.scenes.length > 0);
      let completedSoFar = eligibleScenes.filter((scene) => alreadyGenerated.has(scene.id)).length;

      // Sequence mode only: load each affected sequence's master image
      // (once per sequence, not per scene — groupScenesBySequence already
      // guarantees at most one group per sequenceId, so no dedup check is
      // needed here) so every scene in that sequence can be generated
      // against the same background/continuity plate. "stale" masters (see
      // staleIfGenerated in sequenceEditorOps.ts) are still real, readable
      // files and are reused just like "generated" ones — only a missing
      // asset (not-generated, or a "generated"/"stale" status whose file
      // vanished) falls back to the textual continuity instruction in
      // buildImagePrompt. This must not abort the job, just warn once per
      // affected sequence.
      const sequenceMasterAssets = new Map<string, SequenceMasterAsset>();
      if (sequencePlan) {
        for (const group of pendingGroups) {
          if (!group.sequenceId) continue;
          const sequence = sequencePlan.sequences.find((seq) => seq.id === group.sequenceId);
          const asset = await loadSequenceMasterAsset(projectId, sequence);
          sequenceMasterAssets.set(group.sequenceId, asset);
          if (!asset.buffer) {
            const message =
              sequence?.masterVisual.status === "stale"
                ? `${sequence.title} 시퀀스의 마스터 이미지 파일을 찾을 수 없어 텍스트 설명만으로 씬 이미지를 생성합니다.`
                : `${sequence?.title ?? group.sequenceId} 시퀀스의 마스터 이미지가 아직 생성되지 않아 텍스트 설명만으로 씬 이미지를 생성합니다.`;
            emit(JSON.stringify({ type: "warning", message }) + "\n");
          }
        }
      }

      if (sequencePlan && frameDimensions) {
        // Sequence mode: each content scene's still is a deterministic composite
        // of its sequence's master image (cropped to the camera motion's first
        // frame) + its overlay layer — no image-model call per scene. Baked to
        // images/{sceneId}.png so the existing preview/storyboard/editor UIs
        // (which just read that file) show the master+overlay result directly.
        // A scene whose sequence has no master image bakes nothing (the
        // per-sequence warning above already told the user); the video renderer
        // falls back to a caption card just like a missing scene image.
        const pendingSceneEntries = pendingGroups.flatMap((group) =>
          group.scenes.map((scene) => ({ scene, sequenceId: group.sequenceId }))
        );
        await runWithConcurrencyLimit(pendingSceneEntries, IMAGE_GENERATION_CONCURRENCY, async ({ scene, sequenceId }) => {
          if (job.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

          const sequence = sequenceId ? sequencePlan.sequences.find((seq) => seq.id === sequenceId) : undefined;
          const masterAsset = (sequenceId && sequenceMasterAssets.get(sequenceId)) || ({} as SequenceMasterAsset);
          await bakeSequenceSceneStill({
            projectId,
            sceneId: scene.id,
            sequence,
            masterAsset,
            frameDimensions,
            signal: job.controller.signal,
          });
          completedSoFar += 1;
          recordProgress(projectId, STEP, completedSoFar - 1, total);
          emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: completedSoFar - 1, total }) + "\n");
        });
      } else if (localClient) {
        // Local generation runs one Python process that loads the model once and
        // generates strictly in order (LOCAL_IMAGE_CONCURRENCY=1) — no benefit to
        // OpenAI's uncapped-groups-behind-a-limit shape, so every pending scene is
        // flattened into a single ordered batch call instead.
        const pendingSceneEntries = pendingGroups.flatMap((group) =>
          group.scenes.map((scene) => ({ scene, sequenceId: group.sequenceId }))
        );
        const items = pendingSceneEntries.map(({ scene, sequenceId }) => {
          const design = visualDesigns[scene.id];
          const masterPath = sequenceId ? sequenceMasterAssets.get(sequenceId)?.path : undefined;
          const prompt = buildImagePrompt(scene, design, {
            screenType: screenTypes[scene.id]?.screenType,
            commonPrompt,
            presenterEnabled,
            presenterPosition: design.presenterPosition,
            presenterGender,
            backgroundFixed,
            relatedScenes: buildRelatedScenesContext(scene, visualDesigns),
            allowTextInImage: false,
            sequenceImageContext: sequenceContextByScene?.[scene.id],
            hasMasterReferenceImage: Boolean(masterPath),
          });
          const itemReferenceImagePaths = masterPath ? [...referenceImagePaths, masterPath] : referenceImagePaths;
          return { sceneId: scene.id, prompt, referenceImagePaths: itemReferenceImagePaths };
        });

        await localClient.generateBatch(items, {
          modelSize: localModelSize,
          width: LOCAL_IMAGE_DRAFT_WIDTH,
          height: LOCAL_IMAGE_DRAFT_HEIGHT,
          steps: LOCAL_IMAGE_STEPS,
          quantize: LOCAL_IMAGE_QUANTIZE,
          signal: job.controller.signal,
          onScene: async ({ sceneId, image }) => {
            await writeProjectImage(projectId, sceneId, image);
            completedSoFar += 1;
            recordProgress(projectId, STEP, completedSoFar - 1, total);
            emit(JSON.stringify({ type: "scene", sceneId, index: completedSoFar - 1, total }) + "\n");
          },
        });
      } else if (client) {
        // Image generation stays capped at IMAGE_GENERATION_CONCURRENCY
        // concurrent *groups* — real image API calls are costlier and more
        // rate-limit-sensitive, so groups queue behind the cap.
        await runWithConcurrencyLimit(pendingGroups, IMAGE_GENERATION_CONCURRENCY, async (group) => {
          const masterBuffer = group.sequenceId ? sequenceMasterAssets.get(group.sequenceId)?.buffer : undefined;
          const groupReferenceImages: SceneReferenceImages = group.sequenceId
            ? { ...referenceImages, master: masterBuffer }
            : referenceImages;

          for (const scene of group.scenes) {
            if (job.controller.signal.aborted) throw new DOMException("Aborted", "AbortError");

            const design = visualDesigns[scene.id];
            const buffer = await generateSceneImageWithRetry(
              client,
              scene,
              design,
              {
                screenType: screenTypes[scene.id]?.screenType,
                commonPrompt,
                presenterEnabled,
                presenterPosition: design.presenterPosition,
                presenterGender,
                backgroundFixed,
                relatedScenes: buildRelatedScenesContext(scene, visualDesigns),
                sequenceImageContext: sequenceContextByScene?.[scene.id],
              },
              job.controller.signal,
              groupReferenceImages
            );
            await writeProjectImage(projectId, scene.id, buffer);
            completedSoFar += 1;
            recordProgress(projectId, STEP, completedSoFar - 1, total);
            emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: completedSoFar - 1, total }) + "\n");
          }
        });
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
      const reason = describeImageError(err);
      console.error("이미지 생성 실패:", err);
      finishJob(projectId, STEP, "error", reason);
      emit(JSON.stringify({ type: "error", message: reason }) + "\n");
    }
  });

  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8" } });
}
