import { readProjectFile } from "@/lib/projects/store";
import { VisualDesignEditor } from "./VisualDesignEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function VisualDesignPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const visualDesignRaw = await readProjectFile(projectId, "visual-design.json");
  const initialDesigns: Record<string, VisualDesign> = visualDesignRaw
    ? JSON.parse(visualDesignRaw).visualDesigns
    : {};

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">4단계 — 비주얼 설계</h1>
      <VisualDesignEditor projectId={projectId} scenes={scenes} initialDesigns={initialDesigns} />
    </main>
  );
}
