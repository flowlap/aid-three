import { NextRequest, NextResponse } from "next/server";
import {
  readProject,
  readProjectFile,
  readProjectReferenceImage,
  writeProjectImage,
  updateProjectStep,
  listProjectImageIds,
} from "@/lib/projects/store";
import { createImageClient } from "@/lib/ai/image/factory";
import { generateSceneImageWithRetry, buildRelatedScenesContext, describeImageError } from "@/lib/pipeline/generateSceneImage";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { createResilientStream } from "@/lib/http/resilientStream";
import { startJob, finishJob, recordProgress, JobAlreadyRunningError } from "@/lib/jobs/registry";
import { runWithConcurrencyLimit } from "@/lib/concurrency";
import { groupContentScenesByParentTitle } from "@/lib/pipeline/sceneHierarchy";
import { IMAGE_GENERATION_CONCURRENCY } from "@/lib/pipeline/imageGenerationConfig";
import { DEFAULT_IMAGE_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";

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
    client = createImageClient();
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
      // Title scenes never get an AI image — the final video frame renderer
      // (renderSceneFrame.tsx) already falls back to a plain caption card
      // when there's no image, which is exactly the look a title/divider
      // scene wants, so there's no need to spend an image call on it.
      const eligibleScenes = scenes.filter((scene) => scene.sceneType !== "title" && visualDesigns[scene.id]);
      const total = eligibleScenes.length;

      // Grouped the same way as screen design (see selectScreenTypes.ts /
      // sceneHierarchy.ts): each nearest-title cluster of content scenes is
      // one unit of parallel work, so a chapter's images generate together
      // instead of being interleaved arbitrarily with unrelated scenes.
      // Unlike screen design's uncapped Promise.all (cheap text calls),
      // image generation stays capped at IMAGE_GENERATION_CONCURRENCY
      // concurrent *groups* — real image API calls are costlier and more
      // rate-limit-sensitive, so groups queue behind the cap the same way
      // individual scenes used to.
      const pendingGroups = groupContentScenesByParentTitle(scenes)
        .map((group) => ({
          ...group,
          scenes: group.scenes.filter((scene) => visualDesigns[scene.id] && !alreadyGenerated.has(scene.id)),
        }))
        .filter((group) => group.scenes.length > 0);
      let completedSoFar = eligibleScenes.filter((scene) => alreadyGenerated.has(scene.id)).length;

      await runWithConcurrencyLimit(pendingGroups, IMAGE_GENERATION_CONCURRENCY, async (group) => {
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
            },
            job.controller.signal,
            referenceImages
          );
          await writeProjectImage(projectId, scene.id, buffer);
          completedSoFar += 1;
          recordProgress(projectId, STEP, completedSoFar - 1, total);
          emit(JSON.stringify({ type: "scene", sceneId: scene.id, index: completedSoFar - 1, total }) + "\n");
        }
      });

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
