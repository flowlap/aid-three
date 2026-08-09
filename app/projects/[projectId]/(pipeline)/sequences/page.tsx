import { notFound, redirect } from "next/navigation";
import { readProject, readProjectFile, readSequencePlan } from "@/lib/projects/store";
import { getProductionMode } from "@/lib/projects/types";
import { SequencePlanEditor } from "./SequencePlanEditor";
import { DEFAULT_SCREEN_DESIGN_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export default async function SequencesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();

  const productionMode = getProductionMode(project);
  // Scene-mode projects never get a sequences.json and this step doesn't
  // appear in their pipeline nav (lib/projects/pipelineSteps.ts) — a direct
  // link/back-button visit must never show a broken/empty sequence editor,
  // so redirect straight to the step that follows "scenes" for that mode.
  if (productionMode !== "sequence") {
    redirect(`/projects/${projectId}/screen-design`);
  }

  const rawScenes = await readProjectFile(projectId, "scenes.json");
  const initialScenes: Scene[] = rawScenes ? JSON.parse(rawScenes).scenes : [];
  const initialPlan = await readSequencePlan(projectId);

  const screenDesignRaw = await readProjectFile(projectId, "screen-design.json");
  const parsed = screenDesignRaw ? JSON.parse(screenDesignRaw) : {};
  const initialScreenTypes: Record<string, ScreenTypeAssignment> = parsed.screenTypes ?? {};
  const initialDesigns: Record<string, VisualDesign> = parsed.visualDesigns ?? {};
  const initialScreenDesignCommonPrompt =
    (await readProjectFile(projectId, "screen-design-common-prompt.txt"))?.trim() || DEFAULT_SCREEN_DESIGN_COMMON_PROMPT;

  return (
    <>
      <h1 className="mb-1 text-3xl font-semibold tracking-tight">시퀀스 설계</h1>
      <p className="mb-6 text-sm text-muted-foreground">
        이 단계는 <strong className="font-semibold text-foreground">영상 제작을 위한 비주얼 계획</strong>(연속성·마스터
        비주얼·카메라·오버레이)과 <strong className="font-semibold text-foreground">화면 설계</strong>(화면 유형·자막·키워드)를
        함께 편집합니다. 나레이션 문구는 여기서 수정할 수 없으며, 이전 &ldquo;씬 분할&rdquo; 단계에서 계속 편집합니다.
      </p>
      <SequencePlanEditor
        projectId={projectId}
        initialScenes={initialScenes}
        initialPlan={initialPlan}
        productionMode={productionMode}
        initialScreenTypes={initialScreenTypes}
        initialDesigns={initialDesigns}
        initialScreenDesignCommonPrompt={initialScreenDesignCommonPrompt}
      />
    </>
  );
}
