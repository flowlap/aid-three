import { notFound } from "next/navigation";
import { readProject, readProjectFile } from "@/lib/projects/store";
import { SceneListEditor } from "./SceneListEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";

export default async function ScenesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();
  const raw = await readProjectFile(projectId, "scenes.json");
  const initialScenes: Scene[] = raw ? JSON.parse(raw).scenes : [];
  const narration = await readProjectFile(projectId, "narration.md");

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">씬 분할</h1>
      <SceneListEditor
        projectId={projectId}
        initialScenes={initialScenes}
        narrationLength={narration?.length ?? 0}
        scriptType={project.scriptType}
      />
    </>
  );
}
