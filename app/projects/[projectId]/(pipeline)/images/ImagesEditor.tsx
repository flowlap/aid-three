"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScreenMockup } from "@/components/ScreenMockup";
import { AiJobStatus } from "@/components/AiJobStatus";
import { CommonPromptField } from "@/components/CommonPromptField";
import { computeMockupVariantIndexes } from "@/lib/visual-templates";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { estimateSecondsForScenes } from "@/lib/client/estimateAiDuration";
import { IMAGE_GENERATION_CONCURRENCY } from "@/lib/pipeline/imageGenerationConfig";
import { DEFAULT_IMAGE_COMMON_PROMPT } from "@/lib/pipeline/commonPromptDefaults";

type ImageStreamEvent =
  | { type: "scene"; sceneId: string; index: number; total: number }
  | { type: "result" }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function ImagesEditor({
  projectId,
  scenes,
  screenTypes,
  visualDesigns,
  initialImageIds,
  initialCommonPrompt,
  initialPresenterEnabled,
}: {
  projectId: string;
  scenes: Scene[];
  screenTypes: Record<string, ScreenTypeAssignment>;
  visualDesigns: Record<string, VisualDesign>;
  initialImageIds: string[];
  initialCommonPrompt: string;
  initialPresenterEnabled: boolean;
}) {
  const router = useRouter();
  const [localScreenTypes, setLocalScreenTypes] = useState(screenTypes);
  const [localVisualDesigns, setLocalVisualDesigns] = useState(visualDesigns);
  const mockupVariants = useMemo(
    () => computeMockupVariantIndexes(scenes, localScreenTypes),
    [scenes, localScreenTypes]
  );
  const [imageIds, setImageIds] = useState<Set<string>>(new Set(initialImageIds));
  const [presenterEnabled, setPresenterEnabled] = useState(initialPresenterEnabled);
  const [presenterSaving, setPresenterSaving] = useState(false);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [mockupRegeneratingIds, setMockupRegeneratingIds] = useState<Set<string>>(new Set());
  const [mockupRegenerateError, setMockupRegenerateError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  const [activityLines, setActivityLines] = useState<string[]>([]);

  const { loading, discoveredRunning, error, progress, startedAt, start, cancel } = useAiJob<ImageStreamEvent>({
    projectId,
    step: "images",
    onEvent: (event) => {
      if (event.type === "scene") {
        setImageIds((prev) => new Set(prev).add(event.sceneId));
        setVersions((prev) => ({ ...prev, [event.sceneId]: (prev[event.sceneId] ?? 0) + 1 }));
        setActivityLines((prev) => [...prev, `[${event.index + 1}/${event.total}] ${event.sceneId} 이미지 생성 완료`]);
      }
    },
    onSettled: () => router.refresh(),
  });

  async function togglePresenter(next: boolean) {
    setPresenterEnabled(next);
    setPresenterSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/images/presenter-toggle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
    } finally {
      setPresenterSaving(false);
    }
  }

  async function handleGenerate(mode: "full" | "resume") {
    setActivityLines([]);
    await start({ body: { mode } });
  }

  const eligibleScenes = scenes.filter((s) => localVisualDesigns[s.id]);
  const completedCount = eligibleScenes.filter((s) => imageIds.has(s.id)).length;
  const remainingCount = eligibleScenes.length - completedCount;
  const isPartial = completedCount > 0 && remainingCount > 0;

  async function regenerateScene(sceneId: string) {
    setRegenerateError(null);
    setRegeneratingIds((prev) => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/projects/${projectId}/images/${sceneId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setRegenerateError(data.error ?? "이미지 재생성에 실패했습니다");
        return;
      }
      setImageIds((prev) => new Set(prev).add(sceneId));
      setVersions((prev) => ({ ...prev, [sceneId]: (prev[sceneId] ?? 0) + 1 }));
    } catch {
      setRegenerateError("이미지 재생성 요청 중 오류가 발생했습니다");
    } finally {
      setRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(sceneId);
        return next;
      });
    }
  }

  async function regenerateMockup(sceneId: string) {
    setMockupRegenerateError(null);
    setMockupRegeneratingIds((prev) => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/projects/${projectId}/screen-design/${sceneId}`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setMockupRegenerateError(data.error ?? "목업 재생성에 실패했습니다");
        return;
      }
      setLocalScreenTypes((prev) => ({ ...prev, [sceneId]: data.screenType }));
      setLocalVisualDesigns((prev) => ({ ...prev, [sceneId]: data.visualDesign }));
    } catch {
      setMockupRegenerateError("목업 재생성 요청 중 오류가 발생했습니다");
    } finally {
      setMockupRegeneratingIds((prev) => {
        const next = new Set(prev);
        next.delete(sceneId);
        return next;
      });
    }
  }

  async function handleNext() {
    setAdvancing(true);
    setAdvanceError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/storyboard`, { method: "POST" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setAdvanceError(data.error ?? "다음 단계로 이동하지 못했습니다");
        return;
      }
      router.push(`/projects/${projectId}/storyboard`);
    } catch {
      setAdvanceError("다음 단계 이동 요청 중 오류가 발생했습니다");
    } finally {
      setAdvancing(false);
    }
  }

  useNextStepAction(advancing ? "이동 중..." : "다음 단계", advancing, handleNext);

  return (
    <div className="space-y-4">
      <CommonPromptField
        saveUrl={`/api/projects/${projectId}/images/common-prompt`}
        initialValue={initialCommonPrompt}
        label="공통 프롬프트 (모든 씬에 적용)"
        helperText="캐릭터, 색상, 배경색, 폰트, 컨셉 등 모든 이미지에 공통으로 반영할 톤앤매너를 적어두면 씬마다 반복 입력 없이 일관된 스타일로 생성됩니다."
        placeholder={DEFAULT_IMAGE_COMMON_PROMPT}
      />
      <Card className="gap-1.5 p-4">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={presenterEnabled}
            onChange={(e) => togglePresenter(e.target.checked)}
            disabled={presenterSaving}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            <span className="text-sm font-medium">아나운서 표시</span>
            <p className="text-xs text-muted-foreground">
              씬 이미지에 아나운서(발표자)를 등장시킵니다. 좌측/우측/중앙/풀샷 중 화면에 맞는 형태를 AI가 씬마다 선택합니다. 간지/타이틀형처럼 전환 효과에 해당하는 화면에는 적용되지 않습니다.
            </p>
          </span>
        </label>
      </Card>
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => handleGenerate(isPartial ? "resume" : "full")} disabled={loading}>
            {loading
              ? discoveredRunning
                ? `이미 실행 중...${progress ? ` (${progress.index}/${progress.total})` : ""}`
                : progress
                  ? `생성 중... (${progress.index}/${progress.total})`
                  : "생성 중..."
              : isPartial
                ? `이어서 생성 (${remainingCount}개 남음)`
                : imageIds.size
                  ? "전체 다시 생성"
                  : "AI로 이미지 생성"}
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
          <span className="ml-auto text-xs font-medium text-muted-foreground">
            {imageIds.size} / {scenes.length}개 생성됨
          </span>
        </div>
        <AiJobStatus
          loading={loading}
          label={discoveredRunning ? "다른 곳에서 시작된 이미지 생성이 진행 중입니다" : "AI가 씬별 이미지를 생성하는 중입니다"}
          startedAt={startedAt}
          progress={progress}
          estimateSeconds={estimateSecondsForScenes(scenes.length, 45, IMAGE_GENERATION_CONCURRENCY)}
          activityLines={activityLines}
        />
      </Card>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {regenerateError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {regenerateError}
        </p>
      )}
      {mockupRegenerateError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {mockupRegenerateError}
        </p>
      )}
      {advanceError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {advanceError}
        </p>
      )}

      <div className="space-y-4">
        {scenes.map((scene, index) => {
          const design = localVisualDesigns[scene.id];
          const hasImage = imageIds.has(scene.id);
          const regenerating = regeneratingIds.has(scene.id);
          const mockupRegenerating = mockupRegeneratingIds.has(scene.id);
          const version = versions[scene.id] ?? 0;
          return (
            <Card key={scene.id} id={scene.id} className="gap-4 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{scene.id}</span>
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => regenerateMockup(scene.id)}
                    disabled={mockupRegenerating}
                  >
                    {mockupRegenerating ? "생성 중..." : design ? "목업 재생성" : "목업 생성"}
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => regenerateScene(scene.id)}
                    disabled={regenerating || loading || !design}
                  >
                    {regenerating ? "생성 중..." : hasImage ? "이미지 재생성" : "이미지 생성"}
                  </Button>
                </div>
              </div>

              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {scene.narrationText}
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">AI 생성 이미지</p>
                  {hasImage ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={`/api/projects/${projectId}/images/${scene.id}?v=${version}`}
                      alt={design?.caption ?? scene.narrationText}
                      className="aspect-[3/2] w-full rounded-lg border object-cover"
                    />
                  ) : (
                    <div className="flex aspect-[3/2] w-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground">
                      {design ? "아직 생성된 이미지가 없습니다" : "화면 설계 데이터가 없어 생성할 수 없습니다"}
                    </div>
                  )}
                </div>
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">화면 설계 목업</p>
                  <ScreenMockup
                    screenType={localScreenTypes[scene.id]?.screenType}
                    design={design}
                    variantIndex={mockupVariants[scene.id] ?? 0}
                  />
                </div>
              </div>
              {design?.imageOrDiagramDescription && (
                <p className="text-xs text-muted-foreground">설계 설명: {design.imageOrDiagramDescription}</p>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
