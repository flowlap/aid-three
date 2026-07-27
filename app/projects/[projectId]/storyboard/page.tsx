import { readProjectFile } from "@/lib/projects/store";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function StoryboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenTypesRaw = await readProjectFile(projectId, "screen-types.json");
  const visualDesignRaw = await readProjectFile(projectId, "visual-design.json");

  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];
  const screenTypes: Record<string, ScreenTypeAssignment> = screenTypesRaw
    ? JSON.parse(screenTypesRaw).screenTypes
    : {};
  const visualDesigns: Record<string, VisualDesign> = visualDesignRaw
    ? JSON.parse(visualDesignRaw).visualDesigns
    : {};

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-6 text-2xl font-bold">최종 스토리보드</h1>
      <div className="space-y-6">
        {scenes.map((scene) => {
          const screenType = screenTypes[scene.id];
          const design = visualDesigns[scene.id];
          return (
            <section key={scene.id} id={scene.id} className="rounded border">
              <div className="border-b bg-gray-50 p-4">
                <p className="text-xs text-gray-500">
                  {scene.id} · {screenType?.screenType ?? "미지정"} · {scene.estimatedDurationSec}초
                </p>
                <p className="font-medium">{design?.caption ?? "(자막 없음)"}</p>
                <p className="text-sm text-gray-600">{design?.imageOrDiagramDescription}</p>
                <p className="text-sm text-gray-600">배치: {design?.objectPlacement}</p>
              </div>
              <div className="p-4 text-sm">{scene.narrationText}</div>
            </section>
          );
        })}
        {scenes.length === 0 && <p className="text-gray-500">아직 씬 데이터가 없습니다.</p>}
      </div>
    </main>
  );
}
