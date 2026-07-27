import { readProjectFile } from "@/lib/projects/store";
import { SceneListEditor } from "./SceneListEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";

export default async function ScenesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const raw = await readProjectFile(projectId, "scenes.json");
  const initialScenes: Scene[] = raw ? JSON.parse(raw).scenes : [];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">2단계 — 씬 분할</h1>
      <SceneListEditor projectId={projectId} initialScenes={initialScenes} />
    </main>
  );
}
