import { notFound, redirect } from "next/navigation";
import { readProject, readProjectFile } from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { ScreenDesignEditor } from "./ScreenDesignEditor";
import { DEFAULT_SCREEN_DESIGN_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function ScreenDesignPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();

  // Sequence-mode projects design screens inline inside the sequence-design
  // step (see SequencePlanEditor.tsx) and never get a standalone entry in
  // the step bar for this — a direct link/back-button visit must not show a
  // now-orphaned standalone editor, so redirect to where that work happens.
  if (getProductionMode(project) === "sequence") {
    redirect(`/projects/${projectId}/sequences`);
  }

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const parsed = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const initialScreenTypes: Record<string, ScreenTypeAssignment> = parsed.screenTypes ?? {};
  const initialDesigns: Record<string, VisualDesign> = parsed.visualDesigns ?? {};
  const initialCommonPrompt =
    (await readProjectFile(projectId, "screen-design-common-prompt.txt"))?.trim() || DEFAULT_SCREEN_DESIGN_COMMON_PROMPT;

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">화면 설계</h1>
      <ScreenDesignEditor
        projectId={projectId}
        scenes={scenes}
        initialScreenTypes={initialScreenTypes}
        initialDesigns={initialDesigns}
        initialCommonPrompt={initialCommonPrompt}
      />
    </>
  );
}
