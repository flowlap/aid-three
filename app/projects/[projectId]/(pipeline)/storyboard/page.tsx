import Link from "next/link";
import { readProject, readProjectFile, listProjectImageIds, listProjectImageVersions, updateProjectStep } from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { computeStoryboardPrereqsComplete } from "@/lib/projects/stepCompletion";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScreenMockupThumbnail } from "@/components/ScreenMockup";
import { PptxExportButton } from "@/components/PptxExportButton";
import { computeMockupVariantIndexes } from "@/lib/visual-templates";
import { buildSceneHierarchy } from "@/lib/pipeline/sceneHierarchy";
import { getProjectImageAspectRatio } from "@/lib/pipeline/imageAspectRatio";
import { cn } from "@/lib/utils";
import { getDepthBorderClass } from "@/lib/depthColors";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function StoryboardPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;

  // Reaching this page IS "done" for the storyboard step (it has no output
  // of its own — see computeStoryboardPrereqsComplete) — advance currentStep
  // here instead of requiring the images step's "다음 단계" button to have
  // been clicked first, so a direct link/bookmark into the storyboard still
  // marks the project complete once every earlier step's output actually is.
  const project = await readProject(projectId);
  if (project && project.currentStep !== "storyboard") {
    const productionMode = getProductionMode(project);
    if (await computeStoryboardPrereqsComplete(projectId, productionMode)) {
      await updateProjectStep(projectId, "storyboard");
    }
  }

  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");

  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];
  const screenDesign = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const screenTypes: Record<string, ScreenTypeAssignment> = screenDesign.screenTypes ?? {};
  const visualDesigns: Record<string, VisualDesign> = screenDesign.visualDesigns ?? {};
  const imageIds = new Set(await listProjectImageIds(projectId));
  const imageVersions = await listProjectImageVersions(projectId);
  const mockupVariants = computeMockupVariantIndexes(scenes, screenTypes);
  const hierarchy = buildSceneHierarchy(scenes);
  const imageAspectRatio = await getProjectImageAspectRatio(projectId);

  return (
    <>
      <div className="mb-6 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">최종 스토리보드</h1>
            <p className="mt-1 text-sm text-muted-foreground">총 {scenes.length}개 씬</p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<Link href={`/projects/${projectId}/narration-audio`}>동영상으로 보기</Link>}
            />
            <Button nativeButton={false} render={<Link href={`/projects/${projectId}/preview`}>미리보기로 보기</Link>} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 rounded-lg border bg-muted/30 px-3 py-2">
          <span className="shrink-0 text-xs font-medium text-muted-foreground">PPTX 내보내기</span>
          <div className="h-4 w-px shrink-0 bg-border" />
          <PptxExportButton projectId={projectId} />
        </div>
      </div>
      <div className="space-y-4">
        {scenes.map((scene, index) => {
          const screenType = screenTypes[scene.id];
          const design = visualDesigns[scene.id];
          const hasImage = imageIds.has(scene.id);
          const isTitle = scene.sceneType === "title";
          const entry = hierarchy[scene.id];
          const indentDepth = entry?.indentDepth ?? 0;
          return (
            <Card
              key={scene.id}
              id={scene.id}
              className={cn("gap-0 p-0", isTitle && ["border-l-4 bg-muted/30", getDepthBorderClass(scene.depth ?? 1)])}
              style={{ marginLeft: `${indentDepth * 24}px` }}
            >
              <div className="flex gap-4 p-5">
                <div className="flex shrink-0 items-start gap-2">
                  {hasImage && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/projects/${projectId}/images/${scene.id}?v=${imageVersions[scene.id] ?? 0}`}
                      alt={design?.caption ?? scene.narrationText}
                      className="w-32 shrink-0 rounded-lg border object-cover"
                      style={{ aspectRatio: `${imageAspectRatio.width} / ${imageAspectRatio.height}` }}
                    />
                  )}
                  <ScreenMockupThumbnail
                    width={128}
                    screenType={screenType?.screenType}
                    design={design}
                    variantIndex={mockupVariants[scene.id] ?? 0}
                    aspectRatio={imageAspectRatio}
                  />
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                        isTitle ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {scene.id} · {screenType?.screenType ?? "미지정"} · {scene.estimatedDurationSec}초
                    </span>
                    {isTitle && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        제목 · {scene.depth ?? 1}뎁스
                      </span>
                    )}
                  </div>
                  {entry && entry.breadcrumb.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground/70">{entry.breadcrumb.join(" > ")}</p>
                  )}
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
