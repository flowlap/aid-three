import { readProjectFile } from "@/lib/projects/store";
import { ScreenDesignEditor } from "./ScreenDesignEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function ScreenDesignPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const parsed = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const initialScreenTypes: Record<string, ScreenTypeAssignment> = parsed.screenTypes ?? {};
  const initialDesigns: Record<string, VisualDesign> = parsed.visualDesigns ?? {};

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">화면 설계</h1>
      <ScreenDesignEditor
        projectId={projectId}
        scenes={scenes}
        initialScreenTypes={initialScreenTypes}
        initialDesigns={initialDesigns}
      />
    </>
  );
}
