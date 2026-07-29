import { notFound } from "next/navigation";
import { readProject, readProjectFile, listProjectImageIds } from "@/lib/projects/store";
import { PreviewViewer } from "./PreviewViewer";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function PreviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const screenDesign = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const screenTypes: Record<string, ScreenTypeAssignment> = screenDesign.screenTypes ?? {};
  const visualDesigns: Record<string, VisualDesign> = screenDesign.visualDesigns ?? {};

  const imageIds = await listProjectImageIds(projectId);

  return (
    <PreviewViewer
      projectId={projectId}
      projectTitle={project.title}
      scenes={scenes}
      screenTypes={screenTypes}
      visualDesigns={visualDesigns}
      imageIds={imageIds}
    />
  );
}
