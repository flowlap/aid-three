import { readProjectFile, listProjectImageIds } from "@/lib/projects/store";
import { ImagesEditor } from "./ImagesEditor";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function ImagesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const scenes: Scene[] = scenesRaw ? JSON.parse(scenesRaw).scenes : [];

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const screenDesign = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const screenTypes: Record<string, ScreenTypeAssignment> = screenDesign.screenTypes ?? {};
  const visualDesigns: Record<string, VisualDesign> = screenDesign.visualDesigns ?? {};

  const initialImageIds = await listProjectImageIds(projectId);

  return (
    <>
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">이미지 생성</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        선택 사항입니다. 이미지 없이 다음 단계로 넘어가도 됩니다 — OpenAI 이미지 API 호출은 비용이 발생합니다.
      </p>
      <ImagesEditor
        projectId={projectId}
        scenes={scenes}
        screenTypes={screenTypes}
        visualDesigns={visualDesigns}
        initialImageIds={initialImageIds}
      />
    </>
  );
}
