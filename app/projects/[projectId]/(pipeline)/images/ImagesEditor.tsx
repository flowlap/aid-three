"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScreenMockup } from "@/components/ScreenMockup";
import { AiJobStatus } from "@/components/AiJobStatus";
import { CommonPromptField } from "@/components/CommonPromptField";
import { ReferenceImageSection, type PresenterGender } from "@/components/ReferenceImageSection";
import {
  ImageEngineSelector,
  type ImageEngine,
  type LocalModelSize,
  type ImageProviderType,
  type HChatGeminiModel,
} from "@/components/ImageEngineSelector";
import { SequenceImageModeSelector, type SequenceImageMode } from "@/components/SequenceImageModeSelector";
import { SequenceMasterVisualsSection } from "./SequenceMasterVisualsSection";
import { computeMockupVariantIndexes } from "@/lib/visual-templates";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import type { SequencePlan } from "@/lib/pipeline/sequenceTypes";
import type { ProductionMode } from "@/lib/projects/types";
import { buildSceneHierarchy } from "@/lib/pipeline/sceneHierarchy";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { estimateSecondsForScenes } from "@/lib/client/estimateAiDuration";
import { IMAGE_GENERATION_CONCURRENCY, LOCAL_IMAGE_CONCURRENCY } from "@/lib/pipeline/imageGenerationConfig";
import {
  DEFAULT_IMAGE_COMMON_PROMPT,
  DEFAULT_BACKGROUND_IMAGE_PROMPT,
  DEFAULT_PRESENTER_IMAGE_PROMPT,
  DEFAULT_STYLE_IMAGE_PROMPT,
} from "@/lib/pipeline/commonPromptDefaults";
import { cn } from "@/lib/utils";
import { getDepthBorderClass } from "@/lib/depthColors";

type ImageStreamEvent =
  | { type: "scene"; sceneId: string; index: number; total: number }
  | { type: "result" }
  | { type: "error"; message: string }
  | { type: "cancelled" }
  /** Sequence mode only — a non-fatal notice (e.g. a sequence has no generated master image yet) that doesn't stop generation. See ImagesEditor's onEvent. */
  | { type: "warning"; message: string };

export function ImagesEditor({
  projectId,
  productionMode,
  scenes,
  screenTypes,
  visualDesigns,
  initialImageIds,
  initialCommonPrompt,
  initialPresenterEnabled,
  initialBackgroundFixed,
  initialBackgroundPrompt,
  initialPresenterPrompt,
  initialPresenterGender,
  initialHasBackgroundImage,
  initialHasPresenterImage,
  initialStylePrompt,
  initialHasStyleImage,
  initialEngine,
  initialModelSize,
  imageProviderType,
  initialHchatGeminiModel,
  imageAspectRatio,
  initialSequenceImageMode,
  sequencePlan,
}: {
  projectId: string;
  productionMode: ProductionMode;
  scenes: Scene[];
  screenTypes: Record<string, ScreenTypeAssignment>;
  visualDesigns: Record<string, VisualDesign>;
  initialImageIds: string[];
  initialCommonPrompt: string;
  initialPresenterEnabled: boolean;
  initialBackgroundFixed: boolean;
  initialBackgroundPrompt: string;
  initialPresenterPrompt: string;
  initialPresenterGender: PresenterGender;
  initialHasBackgroundImage: boolean;
  initialHasPresenterImage: boolean;
  initialStylePrompt: string;
  initialHasStyleImage: boolean;
  initialEngine: ImageEngine;
  initialModelSize: LocalModelSize;
  imageProviderType: ImageProviderType;
  initialHchatGeminiModel: HChatGeminiModel;
  /** Actual generated-image pixel ratio (see lib/pipeline/imageAspectRatio.ts) — OpenAI defaults to 3:2, Gemini to 16:9, so the thumbnail/mockup aspect follows whatever this project actually generated instead of a hardcoded 3:2. */
  imageAspectRatio: { width: number; height: number };
  /** Sequence mode only — ignored in scene mode. See SequenceImageModeSelector. */
  initialSequenceImageMode: SequenceImageMode;
  /** Sequence mode only — null in scene mode. Drives the master-visual generation section. */
  sequencePlan: SequencePlan | null;
}) {
  const router = useRouter();
  // Sequence + composite mode composites each scene from the sequence master +
  // overlay (no image model, no per-scene prompts/references) — so the engine
  // picker, common prompt, and background/presenter/style reference controls
  // below are hidden. Sequence + AI mode uses those exact same controls as
  // scene mode (a real per-scene AI generation call), so it shows them too.
  // See the dual-production-mode plan and its AI-image-mode follow-up.
  const isSequence = productionMode === "sequence";
  const [sequenceImageMode, setSequenceImageMode] = useState<SequenceImageMode>(initialSequenceImageMode);
  const isSequenceComposite = isSequence && sequenceImageMode === "composite";
  const [localScreenTypes, setLocalScreenTypes] = useState(screenTypes);
  const [localVisualDesigns, setLocalVisualDesigns] = useState(visualDesigns);
  const mockupVariants = useMemo(
    () => computeMockupVariantIndexes(scenes, localScreenTypes),
    [scenes, localScreenTypes]
  );
  const hierarchy = useMemo(() => buildSceneHierarchy(scenes), [scenes]);
  const [imageIds, setImageIds] = useState<Set<string>>(new Set(initialImageIds));
  const [presenterEnabled, setPresenterEnabled] = useState(initialPresenterEnabled);
  const [presenterSaving, setPresenterSaving] = useState(false);
  const [backgroundFixed, setBackgroundFixed] = useState(initialBackgroundFixed);
  const [backgroundFixedSaving, setBackgroundFixedSaving] = useState(false);
  const [engine, setEngine] = useState<ImageEngine>(initialEngine);
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [mockupRegeneratingIds, setMockupRegeneratingIds] = useState<Set<string>>(new Set());
  const [mockupRegenerateError, setMockupRegenerateError] = useState<string | null>(null);
  const [openOptionsSceneId, setOpenOptionsSceneId] = useState<string | null>(null);
  const [optionsDraft, setOptionsDraft] = useState<{
    extraPrompt: string;
    backgroundFixed: boolean;
    presenterEnabled: boolean;
    styleReferenceEnabled: boolean;
  } | null>(null);
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
      } else if (event.type === "warning") {
        setActivityLines((prev) => [...prev, `⚠️ ${event.message}`]);
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

  async function toggleBackgroundFixed(next: boolean) {
    setBackgroundFixed(next);
    setBackgroundFixedSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/images/background-fixed-toggle`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: next }),
      });
    } finally {
      setBackgroundFixedSaving(false);
    }
  }

  async function handleGenerate(mode: "full" | "resume") {
    setActivityLines([]);
    await start({ body: { mode } });
  }

  const eligibleScenes = scenes.filter((s) => s.sceneType !== "title" && localVisualDesigns[s.id]);
  const completedCount = eligibleScenes.filter((s) => imageIds.has(s.id)).length;
  const remainingCount = eligibleScenes.length - completedCount;
  const isPartial = completedCount > 0 && remainingCount > 0;

  async function regenerateScene(
    sceneId: string,
    overrides?: {
      extraPrompt?: string;
      backgroundFixed?: boolean;
      presenterEnabled?: boolean;
      styleReferenceEnabled?: boolean;
    }
  ) {
    setRegenerateError(null);
    setRegeneratingIds((prev) => new Set(prev).add(sceneId));
    try {
      const res = await fetch(`/api/projects/${projectId}/images/${sceneId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(overrides ?? {}),
      });
      const data = await res.json();
      if (!res.ok) {
        setRegenerateError(data.error ?? "이미지 재생성에 실패했습니다");
        return;
      }
      setImageIds((prev) => new Set(prev).add(sceneId));
      setVersions((prev) => ({ ...prev, [sceneId]: (prev[sceneId] ?? 0) + 1 }));
      setOpenOptionsSceneId(null);
      setOptionsDraft(null);
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

  function toggleOptionsPanel(sceneId: string) {
    if (openOptionsSceneId === sceneId) {
      setOpenOptionsSceneId(null);
      setOptionsDraft(null);
      return;
    }
    setOpenOptionsSceneId(sceneId);
    setOptionsDraft({
      extraPrompt: "",
      backgroundFixed,
      presenterEnabled,
      styleReferenceEnabled: initialHasStyleImage,
    });
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
      // A plain SPA router.push() here can reuse a stale cached render of
      // the shared (pipeline) layout (stepper checkmarks included) — the
      // layout only reliably refetches project.currentStep on a real
      // navigation, so this step deliberately does a full page load instead
      // of a soft client-side transition.
      window.location.href = `/projects/${projectId}/storyboard`;
    } catch {
      setAdvanceError("다음 단계 이동 요청 중 오류가 발생했습니다");
    } finally {
      setAdvancing(false);
    }
  }

  useNextStepAction(advancing ? "이동 중..." : "다음 단계", advancing, handleNext);

  return (
    <div className="space-y-4">
      {isSequence && (
        <SequenceImageModeSelector projectId={projectId} initialMode={initialSequenceImageMode} onModeChange={setSequenceImageMode} />
      )}
      {isSequence && sequencePlan && <SequenceMasterVisualsSection projectId={projectId} initialPlan={sequencePlan} />}
      <ImageEngineSelector
        projectId={projectId}
        initialEngine={initialEngine}
        initialModelSize={initialModelSize}
        imageProviderType={imageProviderType}
        initialHchatGeminiModel={initialHchatGeminiModel}
        onEngineChange={setEngine}
      />
      <CommonPromptField
        saveUrl={`/api/projects/${projectId}/images/common-prompt`}
        initialValue={initialCommonPrompt}
        label="공통 프롬프트 (모든 씬에 적용)"
        helperText="캐릭터, 색상, 배경색, 폰트, 컨셉 등 모든 이미지에 공통으로 반영할 톤앤매너를 적어두면 씬마다 반복 입력 없이 일관된 스타일로 생성됩니다."
        placeholder={DEFAULT_IMAGE_COMMON_PROMPT}
      />
      <Card className="gap-3 p-4">
        <label className="flex cursor-pointer items-start gap-2.5">
          <input
            type="checkbox"
            checked={backgroundFixed}
            onChange={(e) => toggleBackgroundFixed(e.target.checked)}
            disabled={backgroundFixedSaving}
            className="mt-0.5 size-4 shrink-0 accent-primary"
          />
          <span>
            <span className="text-sm font-medium">배경 고정</span>
            <p className="text-xs text-muted-foreground">
              모든 씬 이미지가 같은 배경을 사용하도록 고정합니다. 아래에서 배경 이미지를 생성하거나 직접 업로드하세요.
            </p>
          </span>
        </label>
        {backgroundFixed && (
          <ReferenceImageSection
            projectId={projectId}
            kind="background"
            initialPrompt={initialBackgroundPrompt}
            defaultPrompt={DEFAULT_BACKGROUND_IMAGE_PROMPT}
            initialHasImage={initialHasBackgroundImage}
          />
        )}
      </Card>
      {!isSequenceComposite && (
        <Card className="gap-3 p-4">
          <label className="flex cursor-pointer items-start gap-2.5">
            <input
              type="checkbox"
              checked={presenterEnabled}
              onChange={(e) => togglePresenter(e.target.checked)}
              disabled={presenterSaving}
              className="mt-0.5 size-4 shrink-0 accent-primary"
            />
            <span>
              <span className="text-sm font-medium">강사 표시</span>
              <p className="text-xs text-muted-foreground">
                씬 이미지에 강사(발표자)를 등장시킵니다. 좌측/우측/중앙/풀샷 중 화면에 맞는 형태를 AI가 씬마다 선택합니다. 간지/타이틀형처럼 전환 효과에 해당하는 화면에는 적용되지 않습니다.
              </p>
            </span>
          </label>
          {presenterEnabled && (
            <ReferenceImageSection
              projectId={projectId}
              kind="presenter"
              initialPrompt={initialPresenterPrompt}
              defaultPrompt={DEFAULT_PRESENTER_IMAGE_PROMPT}
              initialHasImage={initialHasPresenterImage}
              showGenderSelect
              initialGender={initialPresenterGender}
            />
          )}
        </Card>
      )}
      <Card className="gap-3 p-4">
        <div>
          <span className="text-sm font-medium">톤앤매너 기준 이미지</span>
          <p className="text-xs text-muted-foreground">
            모든 씬 이미지 생성 시 이 이미지의 색감·일러스트 스타일·분위기를 참고해 톤앤매너를 통일합니다. 아래에서 생성하거나 직접 업로드하세요.
          </p>
        </div>
        <ReferenceImageSection
          projectId={projectId}
          kind="style"
          initialPrompt={initialStylePrompt}
          defaultPrompt={DEFAULT_STYLE_IMAGE_PROMPT}
          initialHasImage={initialHasStyleImage}
        />
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
                  : isSequenceComposite
                    ? "마스터+오버레이 합성"
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
            {completedCount} / {eligibleScenes.length}개 생성됨
          </span>
        </div>
        <AiJobStatus
          loading={loading}
          label={
            discoveredRunning
              ? "다른 곳에서 시작된 이미지 생성이 진행 중입니다"
              : isSequenceComposite
                ? "마스터 비주얼에 오버레이를 합성하는 중입니다"
                : "AI가 씬별 이미지를 생성하는 중입니다"
          }
          startedAt={startedAt}
          progress={progress}
          estimateSeconds={
            engine === "local"
              ? estimateSecondsForScenes(eligibleScenes.length, 40, LOCAL_IMAGE_CONCURRENCY)
              : estimateSecondsForScenes(eligibleScenes.length, 45, IMAGE_GENERATION_CONCURRENCY)
          }
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
          const isTitle = scene.sceneType === "title";
          const entry = hierarchy[scene.id];
          const indentDepth = entry?.indentDepth ?? 0;
          const screenType = localScreenTypes[scene.id]?.screenType;
          return (
            <Card
              key={scene.id}
              id={scene.id}
              className={cn("gap-4 p-5", isTitle && ["border-l-4 bg-muted/30", getDepthBorderClass(scene.depth ?? 1)])}
              style={{ marginLeft: `${indentDepth * 24}px` }}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                      isTitle ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                    )}
                  >
                    {index + 1}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{scene.id}</span>
                  {isTitle && (
                    <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                      제목 · {scene.depth ?? 1}뎁스
                    </span>
                  )}
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
                  {!isTitle && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      // Sequence + composite mode re-bakes the master+overlay
                      // composite directly (no prompt/reference overrides), so
                      // skip the options panel. Sequence + AI mode uses the
                      // same options panel as scene mode (a real AI call).
                      onClick={() => (isSequenceComposite ? void regenerateScene(scene.id) : toggleOptionsPanel(scene.id))}
                      disabled={regenerating || loading || !design}
                    >
                      {regenerating
                        ? "생성 중..."
                        : isSequenceComposite
                          ? hasImage
                            ? "합성 다시 생성"
                            : "합성 생성"
                          : hasImage
                            ? "이미지 재생성"
                            : "이미지 생성"}
                    </Button>
                  )}
                </div>
              </div>

              {openOptionsSceneId === scene.id && optionsDraft && (
                <div className="space-y-3 rounded-lg border border-dashed bg-muted/20 p-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-muted-foreground">
                      추가 프롬프트 (이번 생성에만 적용)
                    </label>
                    <textarea
                      value={optionsDraft.extraPrompt}
                      onChange={(e) =>
                        setOptionsDraft((prev) => (prev ? { ...prev, extraPrompt: e.target.value } : prev))
                      }
                      placeholder="예: 배경을 좀 더 밝게 해주세요"
                      rows={2}
                      className="w-full rounded-md border bg-background px-2.5 py-1.5 text-sm"
                    />
                  </div>
                  <div className="flex flex-wrap gap-4">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={optionsDraft.backgroundFixed}
                        onChange={(e) =>
                          setOptionsDraft((prev) => (prev ? { ...prev, backgroundFixed: e.target.checked } : prev))
                        }
                        className="size-3.5 accent-primary"
                      />
                      배경 고정
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={optionsDraft.presenterEnabled}
                        onChange={(e) =>
                          setOptionsDraft((prev) => (prev ? { ...prev, presenterEnabled: e.target.checked } : prev))
                        }
                        className="size-3.5 accent-primary"
                      />
                      강사 표시
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                      <input
                        type="checkbox"
                        checked={optionsDraft.styleReferenceEnabled}
                        onChange={(e) =>
                          setOptionsDraft((prev) => (prev ? { ...prev, styleReferenceEnabled: e.target.checked } : prev))
                        }
                        className="size-3.5 accent-primary"
                      />
                      톤앤매너 적용
                    </label>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => regenerateScene(scene.id, optionsDraft)}
                      disabled={regenerating}
                    >
                      {regenerating ? "생성 중..." : "생성 실행"}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setOpenOptionsSceneId(null);
                        setOptionsDraft(null);
                      }}
                    >
                      취소
                    </Button>
                  </div>
                </div>
              )}

              {entry && entry.breadcrumb.length > 0 && (
                <p className="truncate text-xs text-muted-foreground/70">{entry.breadcrumb.join(" > ")}</p>
              )}

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
                      className="w-full rounded-lg border object-cover"
                      style={{ aspectRatio: `${imageAspectRatio.width} / ${imageAspectRatio.height}` }}
                    />
                  ) : (
                    <div
                      className="flex w-full items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
                      style={{ aspectRatio: `${imageAspectRatio.width} / ${imageAspectRatio.height}` }}
                    >
                      {isTitle
                        ? "제목 씬은 이미지를 생성하지 않습니다"
                        : design
                          ? "아직 생성된 이미지가 없습니다"
                          : "화면 설계 데이터가 없어 생성할 수 없습니다"}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-xs font-medium text-muted-foreground">화면 설계 목업</p>
                    {screenType && (
                      <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                        {screenType}
                      </span>
                    )}
                  </div>
                  <ScreenMockup
                    screenType={screenType}
                    design={design}
                    showTypeBadge={false}
                    variantIndex={mockupVariants[scene.id] ?? 0}
                    aspectRatio={imageAspectRatio}
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
