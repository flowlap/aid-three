import { notFound } from "next/navigation";
import { readProject, readProjectFile, listProjectImageIds } from "@/lib/projects/store";
import { AppShell, type StepCompletion } from "@/app/AppShell";
import type { Scene } from "@/lib/pipeline/splitScenes";
import { getProductionMode, type PipelineStep, type ProductionMode } from "@/lib/projects/types";

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
 * Lightweight structural check only: file exists, parses as JSON, and has a
 * non-empty `sequences` array. This does NOT run the full sequence-plan
 * integrity validator (lib/pipeline/validateSequenceIntegrity.ts, added in a
 * later task) — a future task may want to upgrade this to reuse that
 * validator once it exists, for parity with how isScenesComplete could in
 * principle also be stricter. Only ever called in sequence mode: sequences.json
 * is only written after an explicit sequence-plan generation, and opening a
 * legacy (scene-mode) project must never require or read it.
 */
async function isSequencesComplete(projectId: string): Promise<boolean> {
  const raw = await readProjectFile(projectId, "sequences.json");
  if (!raw) return false;
  try {
    const sequences = JSON.parse(raw).sequences;
    return Array.isArray(sequences) && sequences.length > 0;
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

async function computeStepCompletion(
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
    // earlier step is done AND the user has actually reached it (currentStep
    // only advances to "storyboard" via the images step's "다음 단계" action).
    storyboard: currentStep === "storyboard" && storyboardPrereqsComplete,
  };
}

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();

  const productionMode = getProductionMode(project);
  const stepCompletion = await computeStepCompletion(projectId, project.currentStep, productionMode);

  return (
    <AppShell
      projectId={projectId}
      projectTitle={project.title}
      productionMode={productionMode}
      stepCompletion={stepCompletion}
    >
      {children}
    </AppShell>
  );
}
