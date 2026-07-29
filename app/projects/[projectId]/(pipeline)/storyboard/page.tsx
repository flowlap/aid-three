import Link from "next/link";
import { readProjectFile, listProjectImageIds } from "@/lib/projects/store";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScreenMockup } from "@/components/ScreenMockup";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function StoryboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");

  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];
  const screenDesign = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const screenTypes: Record<string, ScreenTypeAssignment> = screenDesign.screenTypes ?? {};
  const visualDesigns: Record<string, VisualDesign> = screenDesign.visualDesigns ?? {};
  const imageIds = new Set(await listProjectImageIds(projectId));

  return (
    <>
      <div className="mb-6 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">최종 스토리보드</h1>
          <p className="mt-1 text-sm text-muted-foreground">총 {scenes.length}개 씬</p>
        </div>
        <Button nativeButton={false} render={<Link href={`/projects/${projectId}/preview`}>미리보기로 보기</Link>} />
      </div>
      <div className="space-y-4">
        {scenes.map((scene, index) => {
          const screenType = screenTypes[scene.id];
          const design = visualDesigns[scene.id];
          const hasImage = imageIds.has(scene.id);
          return (
            <Card key={scene.id} id={scene.id} className="gap-0 p-0">
              <div className="flex gap-4 p-5">
                <div className="flex shrink-0 gap-2">
                  {hasImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/projects/${projectId}/images/${scene.id}`}
                      alt={design?.caption ?? scene.narrationText}
                      className="aspect-[3/2] w-32 shrink-0 rounded-lg border object-cover"
                    />
                  )}
                  <ScreenMockup
                    screenType={screenType?.screenType}
                    design={design}
                    showTypeBadge={false}
                    className="w-32 shrink-0"
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                      {index + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {scene.id} · {screenType?.screenType ?? "미지정"} · {scene.estimatedDurationSec}초
                    </span>
                  </div>
                  <p className="font-medium">{design?.caption ?? "(자막 없음)"}</p>
                  <p className="text-sm text-muted-foreground">{design?.imageOrDiagramDescription}</p>
                  <p className="text-sm text-muted-foreground">배치: {design?.objectPlacement}</p>
                </div>
              </div>
              <p className="border-t bg-muted/40 px-5 py-3 text-sm text-muted-foreground">{scene.narrationText}</p>
            </Card>
          );
        })}
        {scenes.length === 0 && (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">아직 씬 데이터가 없습니다.</p>
          </div>
        )}
      </div>
    </>
  );
}
