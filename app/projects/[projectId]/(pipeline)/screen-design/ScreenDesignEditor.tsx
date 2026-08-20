"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AiJobStatus } from "@/components/AiJobStatus";
import { CommonPromptField } from "@/components/CommonPromptField";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { buildSceneHierarchy } from "@/lib/pipeline/sceneHierarchy";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { useToast } from "@/lib/client/ToastContext";
import { estimateSecondsForScenes } from "@/lib/client/estimateAiDuration";
import { DEFAULT_SCREEN_DESIGN_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import { ScreenDesignSceneCard } from "./ScreenDesignFields";

/** Lets the "저장 완료" toast actually be seen before a destination navigation unloads the page. */
const TOAST_BEFORE_NAVIGATE_MS = 600;

type ScreenDesignStreamEvent =
  | { type: "scene"; sceneId: string; index: number; total: number; screenType: ScreenTypeAssignment; visualDesign: VisualDesign }
  | { type: "result"; screenTypes: Record<string, ScreenTypeAssignment>; visualDesigns: Record<string, VisualDesign> }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function ScreenDesignEditor({
  projectId,
  scenes,
  initialScreenTypes,
  initialDesigns,
  initialCommonPrompt,
}: {
  projectId: string;
  scenes: Scene[];
  initialScreenTypes: Record<string, ScreenTypeAssignment>;
  initialDesigns: Record<string, VisualDesign>;
  initialCommonPrompt: string;
}) {
  const router = useRouter();
  const { showToast } = useToast();
  const [screenTypes, setScreenTypes] = useState(initialScreenTypes);
  const [designs, setDesigns] = useState(initialDesigns);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [activityLines, setActivityLines] = useState<string[]>([]);

  const { loading, discoveredRunning, error, progress, startedAt, start, cancel } = useAiJob<ScreenDesignStreamEvent>({
    projectId,
    step: "screen-design",
    onEvent: (event) => {
      if (event.type === "scene") {
        setScreenTypes((prev) => ({ ...prev, [event.sceneId]: event.screenType }));
        setDesigns((prev) => ({ ...prev, [event.sceneId]: event.visualDesign }));
        setActivityLines((prev) => [
          ...prev,
          `[${event.index + 1}/${event.total}] ${event.sceneId} → ${event.screenType.screenType}`,
        ]);
      } else if (event.type === "result") {
        setScreenTypes(event.screenTypes);
        setDesigns(event.visualDesigns);
      }
    },
    onPollUpdate: (status) => {
      const partial = status.partialData as
        | { screenTypes?: Record<string, ScreenTypeAssignment>; visualDesigns?: Record<string, VisualDesign> }
        | null;
      if (partial?.screenTypes) setScreenTypes(partial.screenTypes);
      if (partial?.visualDesigns) setDesigns(partial.visualDesigns);
    },
    onSettled: () => router.refresh(),
  });

  async function handleGenerate(mode: "full" | "resume") {
    if (mode === "full") {
      setScreenTypes({});
      setDesigns({});
    }
    setActivityLines([]);
    await start({ body: { mode } });
  }

  const completedCount = scenes.filter((s) => screenTypes[s.id]).length;
  const remainingCount = scenes.length - completedCount;
  const isPartial = completedCount > 0 && remainingCount > 0;
  const hierarchy = useMemo(() => buildSceneHierarchy(scenes), [scenes]);

  function updateScreenType(sceneId: string, patch: Partial<ScreenTypeAssignment>) {
    setScreenTypes((prev) => {
      const defaults: ScreenTypeAssignment = {
        screenType: "",
        recommendedLayout: "",
        rationale: "",
        caption: "",
        keywords: [],
        imageOrDiagramDescription: "",
        objectPlacement: "",
      };
      return { ...prev, [sceneId]: { ...(prev[sceneId] ?? defaults), ...patch } };
    });
  }

  function updateDesign(sceneId: string, patch: Partial<VisualDesign>) {
    setDesigns((prev) => {
      const defaults: VisualDesign = {
        caption: "",
        keywords: [],
        imageOrDiagramDescription: "",
        objectPlacement: "",
        appearanceOrder: [],
        productionNotes: "",
      };
      return { ...prev, [sceneId]: { ...(prev[sceneId] ?? defaults), ...patch } };
    });
  }

  async function regenerateScene(sceneId: string) {
    setRegenerateError(null);
    setRegeneratingIds((prev) => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/projects/${projectId}/screen-design/${sceneId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRegenerateError(data.error ?? "씬 재생성에 실패했습니다");
        return;
      }
      setScreenTypes((prev) => ({ ...prev, [sceneId]: data.screenType }));
      setDesigns((prev) => ({ ...prev, [sceneId]: data.visualDesign }));
    } catch {
      setRegenerateError("씬 재생성 요청 중 오류가 발생했습니다");
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(sceneId);
        return next;
      });
    }
  }

  /** Omitting `destination` saves in place (the standalone "저장" button); passing one saves then navigates there ("다음 단계"). */
  async function saveAndGoTo(destination?: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/screen-design`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenTypes, visualDesigns: designs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "저장에 실패했습니다");
        return;
      }
      showToast("저장 완료");
      if (!destination) return;
      await new Promise((resolve) => setTimeout(resolve, TOAST_BEFORE_NAVIGATE_MS));
      // A plain SPA router.push() here can reuse a stale cached render of
      // the shared (pipeline) layout (stepper checkmarks included) — the
      // layout only reliably refetches project.currentStep on a real
      // navigation, so this step deliberately does a full page load instead
      // of a soft client-side transition.
      window.location.href = destination;
    } catch {
      setSaveError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  function handleNext() {
    return saveAndGoTo(`/projects/${projectId}/review`);
  }

  useNextStepAction(
    saving ? "저장 중..." : "다음 단계",
    Object.keys(screenTypes).length === 0 || saving || loading,
    handleNext
  );

  return (
    <div className="space-y-4">
      <CommonPromptField
        saveUrl={`/api/projects/${projectId}/screen-design/common-prompt`}
        initialValue={initialCommonPrompt}
        label="공통 프롬프트 (모든 씬에 적용)"
        helperText="이 콘텐츠 전반에 적용할 맥락이나 원칙을 적어두면 AI가 씬마다 화면 유형·자막·키워드를 정할 때 함께 참고합니다."
        placeholder={DEFAULT_SCREEN_DESIGN_COMMON_PROMPT}
      />
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => handleGenerate(isPartial ? "resume" : "full")} disabled={loading}>
            {loading
              ? discoveredRunning
                ? `이미 실행 중...${progress ? ` (${progress.index}/${progress.total})` : ""}`
                : progress
                  ? `설계 중... (${progress.index}/${progress.total})`
                  : "설계 중..."
              : isPartial
                ? `이어서 생성 (${remainingCount}개 남음)`
                : completedCount > 0
                  ? "다시 생성"
                  : "AI로 화면 설계"}
          </Button>
          {!loading && isPartial && (
            <Button variant="outline" onClick={() => handleGenerate("full")}>
              전체 다시 생성
            </Button>
          )}
          {loading && (
            <Button variant="outline" onClick={cancel}>
              취소
            </Button>
          )}
          <Button
            variant="outline"
            onClick={() => void saveAndGoTo()}
            disabled={Object.keys(screenTypes).length === 0 || saving || loading}
            className="ml-auto"
          >
            {saving ? "저장 중..." : "저장"}
          </Button>
          <span className="text-xs font-medium text-muted-foreground">
            {completedCount} / {scenes.length}개 씬 완료
          </span>
        </div>
        <AiJobStatus
          loading={loading}
          label={discoveredRunning ? "다른 곳에서 시작된 화면 설계가 진행 중입니다" : "AI가 씬별 화면 유형을 설계하는 중입니다"}
          startedAt={startedAt}
          progress={progress}
          estimateSeconds={estimateSecondsForScenes(scenes.length, 15)}
          activityLines={activityLines}
        />
      </Card>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {saveError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError}
        </p>
      )}
      {regenerateError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {regenerateError}
        </p>
      )}

      <div className="space-y-4">
        {scenes.map((scene, index) => {
          const entry = hierarchy[scene.id];
          return (
            <ScreenDesignSceneCard
              key={scene.id}
              scene={scene}
              displayIndex={index + 1}
              indentDepth={entry?.indentDepth ?? 0}
              assignment={screenTypes[scene.id]}
              design={designs[scene.id]}
              regenerating={regeneratingIds.has(scene.id)}
              regenerateDisabled={regeneratingIds.has(scene.id) || loading}
              onRegenerate={() => regenerateScene(scene.id)}
              onUpdateScreenType={(patch) => updateScreenType(scene.id, patch)}
              onUpdateDesign={(patch) => updateDesign(scene.id, patch)}
            />
          );
        })}
      </div>
    </div>
  );
}
