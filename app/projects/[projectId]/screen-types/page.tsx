import { readProjectFile } from "@/lib/projects/store";
import { ScreenTypeEditor } from "./ScreenTypeEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";

export default async function ScreenTypesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  const initialScreenTypes: Record<string, ScreenTypeAssignment> = screenTypesRaw
    ? JSON.parse(screenTypesRaw).screenTypes
    : {};

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">3단계 — 화면 유형 선정</h1>
      <ScreenTypeEditor projectId={projectId} scenes={scenes} initialScreenTypes={initialScreenTypes} />
    </main>
  );
}
