import { readProjectFile, listProjectImageIds } from "@/lib/projects/store";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { validateSequenceIntegrity } from "@/lib/pipeline/validateSequenceIntegrity";
import type { PipelineStep, ProductionMode } from "@/lib/projects/types";
import type { StepCompletion } from "@/app/AppShell";

async function isMarkdownComplete(projectId: string): Promise<boolean> {
  const raw = await readProjectFile(projectId, "narration.md");
  return Boolean(raw && raw.trim().length > 0);
}

async function isScenesComplete(projectId: string): Promise<boolean> {
  const raw = await readProjectFile(projectId, "scenes.json");
  if (!raw) return false;
  try {
    const scenes = JSON.parse(raw).scenes;
    return Array.isArray(scenes) && scenes.length > 0;
  } catch {
    return false;
  }
}

/**
 * Runs the full sequence-plan integrity validator
 * (lib/pipeline/validateSequenceIntegrity.ts) against the current
 * scenes.json — not just "file exists and has a non-empty sequences array".
 * This codebase has no cross-step invalidation (see CLAUDE.md): re-running
 * scene splitting after a sequence plan already exists silently leaves
 * sequences.json referencing stale/missing scene ids, and without this check
 * the stepper kept showing a green checkmark for a plan that would
 * immediately fail images/video generation with "시퀀스 계획에 오류가
 * 있습니다" (see loadSequenceContext.ts) — indistinguishable from a healthy
 * plan until the user happened to revisit generation. Only ever called in
 * sequence mode: sequences.json is only written after an explicit
 * sequence-plan generation, and opening a legacy (scene-mode) project must
 * never require or read it.
 */
async function isSequencesComplete(projectId: string): Promise<boolean> {
  const [sequencesRaw, scenesRaw] = await Promise.all([
    readProjectFile(projectId, "sequences.json"),
    readProjectFile(projectId, "scenes.json"),
  ]);
  if (!sequencesRaw || !scenesRaw) return false;
  try {
    const plan: SequencePlan = JSON.parse(sequencesRaw);
    if (!Array.isArray(plan.sequences) || plan.sequences.length === 0) return false;
    const scenes: Scene[] = JSON.parse(scenesRaw).scenes ?? [];
    const issues = validateSequenceIntegrity(scenes, plan);
    return !issues.some((issue) => issue.severity === "error");
  } catch {
    return false;
  }
}

/** Title scenes never get a screen-design AI call (selectScreenTypes.ts assigns them locally), so they're excluded from the check. */
async function isScreenDesignComplete(projectId: string): Promise<boolean> {
  const [scenesRaw, screenDesignRaw] = await Promise.all([
    readProjectFile(projectId, "scenes.json"),
    readProjectFile(projectId, "screen-design.json"),
  ]);
  if (!scenesRaw || !screenDesignRaw) return false;

  try {
    const scenes: Scene[] = JSON.parse(scenesRaw).scenes ?? [];
    const screenTypes: Record<string, unknown> = JSON.parse(screenDesignRaw).screenTypes ?? {};
    const contentScenes = scenes.filter((scene) => scene.sceneType !== "title");
    return contentScenes.length > 0 && contentScenes.every((scene) => Boolean(screenTypes[scene.id]));
  } catch {
    return false;
  }
}

async function isReviewComplete(projectId: string): Promise<boolean> {
  const raw = await readProjectFile(projectId, "review.json");
  if (!raw) return false;
  try {
    const issues = JSON.parse(raw).issues;
    // Finding issues is a normal, complete outcome — only a missing/malformed file means the check hasn't run.
    return Array.isArray(issues);
  } catch {
    return false;
  }
}

/** Mirrors images/route.ts's own "eligible scene" filter (non-title, has a visual design) so this matches exactly what the bulk generation job considers done. */
async function isImagesComplete(projectId: string): Promise<boolean> {
  const [scenesRaw, screenDesignRaw] = await Promise.all([
    readProjectFile(projectId, "scenes.json"),
    readProjectFile(projectId, "screen-design.json"),
  ]);
  if (!scenesRaw || !screenDesignRaw) return false;

  try {
    const scenes: Scene[] = JSON.parse(scenesRaw).scenes ?? [];
    const visualDesigns: Record<string, unknown> = JSON.parse(screenDesignRaw).visualDesigns ?? {};
    const eligibleScenes = scenes.filter((scene) => scene.sceneType !== "title" && visualDesigns[scene.id]);
    if (eligibleScenes.length === 0) return false;

    const imageIds = new Set(await listProjectImageIds(projectId));
    return eligibleScenes.every((scene) => imageIds.has(scene.id));
  } catch {
    return false;
  }
}

/**
 * Storyboard has no output of its own to check (it's a read-only composite
 * of everything above) — "done" means every earlier step's output is
 * actually complete, independent of whatever currentStep currently says.
 * Shared by computeStepCompletion (which also requires currentStep to have
 * reached "storyboard") and storyboard/page.tsx (which uses this alone to
 * decide whether landing on the page should advance currentStep there).
 */
export async function computeStoryboardPrereqsComplete(projectId: string, productionMode: ProductionMode): Promise<boolean> {
  const isSequenceMode = productionMode === "sequence";
  const [markdown, scenes, sequences, screenDesign, review, images] = await Promise.all([
    isMarkdownComplete(projectId),
    isScenesComplete(projectId),
    isSequenceMode ? isSequencesComplete(projectId) : Promise.resolve(true),
    isScreenDesignComplete(projectId),
    isReviewComplete(projectId),
    isImagesComplete(projectId),
  ]);
  return markdown && scenes && sequences && screenDesign && review && images;
}

export async function computeStepCompletion(
  projectId: string,
  currentStep: PipelineStep,
  productionMode: ProductionMode
): Promise<StepCompletion> {
  const isSequenceMode = productionMode === "sequence";

  // sequences.json is only ever written after an explicit sequence-plan
  // generation, and legacy/scene-mode projects must never be required (or
  // even expected) to have it — so this check only runs in sequence mode.
  const [markdown, scenes, sequences, screenDesign, review, images] = await Promise.all([
    isMarkdownComplete(projectId),
    isScenesComplete(projectId),
    isSequenceMode ? isSequencesComplete(projectId) : Promise.resolve(false),
    isScreenDesignComplete(projectId),
    isReviewComplete(projectId),
    isImagesComplete(projectId),
  ]);

  const storyboardPrereqsComplete = isSequenceMode
    ? markdown && scenes && sequences && screenDesign && review && images
    : markdown && scenes && screenDesign && review && images;

  return {
    markdown,
    scenes,
    ...(isSequenceMode ? { sequences } : {}),
    "screen-design": screenDesign,
    review,
    images,
    // Storyboard has no separate output of its own to check (it's a
    // read-only composite of everything above) — it's complete once every
    // earlier step is done AND the user has actually reached it. Reaching it
    // now also happens automatically: storyboard/page.tsx advances
    // currentStep to "storyboard" itself the first time it's visited with
    // every prerequisite already satisfied (see computeStoryboardPrereqsComplete).
    storyboard: currentStep === "storyboard" && storyboardPrereqsComplete,
  };
}
