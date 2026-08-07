"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Combine, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AiJobStatus } from "@/components/AiJobStatus";
import type { Scene } from "@/lib/pipeline/splitScenes";
import { buildSceneHierarchy } from "@/lib/pipeline/sceneHierarchy";
import type { ProductionMode, ScriptType } from "@/lib/projects/types";
import { getPipelineSteps } from "@/lib/projects/pipelineSteps";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { useAutoProgressFlag, withAutoProgress } from "@/lib/client/useAutoProgress";
import { estimateSecondsForChars } from "@/lib/client/estimateAiDuration";
import { cn } from "@/lib/utils";
import { getDepthBorderClass } from "@/lib/depthColors";

type SceneStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "result"; scenes: Scene[]; integrityOk: boolean }
  | { type: "error"; message: string }
  | { type: "cancelled" };

function renumber(scenes: Scene[]): Scene[] {
  return scenes.map((scene, i) => ({ ...scene, order: i + 1 }));
}

/** Picks where to cut narrationText: the given cursor if it's usable, otherwise the whitespace closest to the middle so we don't cut a word in half. */
function findSplitIndex(text: string, preferredIndex: number): number {
  if (preferredIndex > 0 && preferredIndex < text.length) return preferredIndex;
  const mid = Math.floor(text.length / 2);
  for (let offset = 0; offset < text.length; offset++) {
    if (text[mid + offset] === " ") return mid + offset + 1;
    if (mid - offset >= 0 && text[mid - offset] === " ") return mid - offset + 1;
  }
  return mid || 1;
}

function nextSplitId(existingIds: string[], baseId: string): string {
  const idSet = new Set(existingIds);
  if (!idSet.has(`${baseId}-b`)) return `${baseId}-b`;
  let n = 2;
  while (idSet.has(`${baseId}-${n}`)) n += 1;
  return `${baseId}-${n}`;
}

export function SceneListEditor({
  projectId,
  initialScenes,
  narrationLength,
  scriptType,
  productionMode,
}: {
  projectId: string;
  initialScenes: Scene[];
  narrationLength: number;
  scriptType: ScriptType;
  productionMode: ProductionMode;
}) {
  const router = useRouter();
  const auto = useAutoProgressFlag();
  const [scenes, setScenes] = useState<Scene[]>(initialScenes);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [rawPreview, setRawPreview] = useState("");
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);

  const { loading, discoveredRunning, error, startedAt, start, cancel } = useAiJob<SceneStreamEvent>({
    projectId,
    step: "scenes",
    onEvent: (event) => {
      if (event.type === "chunk") {
        setRawPreview((prev) => prev + event.text);
      } else if (event.type === "result") {
        setScenes(event.scenes);
        setWarning(event.integrityOk ? null : "AI가 나레이션 원문을 임의로 수정했을 수 있습니다. 확인해주세요.");
      }
    },
    onPollUpdate: (status) => {
      if (typeof status.partialRaw === "string") setRawPreview(status.partialRaw);
    },
    onSettled: () => router.refresh(),
  });

  async function handleGenerate() {
    setWarning(null);
    setRawPreview("");
    await start();
  }

  async function handleAnalyze() {
    setAnalyzeError(null);
    setAnalyzing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes/analyze`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setAnalyzeError(data.error ?? "AI 추가 정보 분석에 실패했습니다");
        return;
      }
      setScenes(data.scenes);
    } catch {
      setAnalyzeError("AI 추가 정보 분석 요청 중 오류가 발생했습니다");
    } finally {
      setAnalyzing(false);
    }
  }

  function updateScene(index: number, patch: Partial<Scene>) {
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  }

  function deleteScene(index: number) {
    setScenes((prev) => {
      if (prev.length <= 1) return prev;
      const deleted = prev[index];
      const rest = prev.filter((_, i) => i !== index);
      const mergesIntoNext = index < rest.length;
      const mergeIndex = mergesIntoNext ? index : index - 1;
      const merged = rest.map((scene, i) => {
        if (i !== mergeIndex) return scene;
        const narrationText = mergesIntoNext
          ? `${deleted.narrationText} ${scene.narrationText}`.trim()
          : `${scene.narrationText} ${deleted.narrationText}`.trim();
        const involvesTitle = deleted.sceneType === "title" || scene.sceneType === "title";
        return {
          ...scene,
          narrationText,
          estimatedDurationSec: scene.estimatedDurationSec + deleted.estimatedDurationSec,
          ...(involvesTitle ? { sceneType: "content" as const, depth: undefined } : {}),
        };
      });
      return renumber(merged);
    });
  }

  function splitScene(index: number) {
    setScenes((prev) => {
      const scene = prev[index];
      if (scene.sceneType === "title") return prev;
      const cursor = textareaRefs.current[scene.id]?.selectionStart ?? -1;
      const splitAt = findSplitIndex(scene.narrationText, cursor);
      const leftText = scene.narrationText.slice(0, splitAt).trim();
      const rightText = scene.narrationText.slice(splitAt).trim();
      if (!leftText || !rightText) return prev;

      const leftRatio = leftText.length / (leftText.length + rightText.length);
      const leftDuration = Math.max(1, Math.round(scene.estimatedDurationSec * leftRatio));
      const rightDuration = Math.max(1, scene.estimatedDurationSec - leftDuration);

      const newId = nextSplitId(
        prev.map((s) => s.id),
        scene.id
      );
      const sceneA: Scene = { ...scene, narrationText: leftText, estimatedDurationSec: leftDuration };
      const sceneB: Scene = {
        ...scene,
        id: newId,
        narrationText: rightText,
        estimatedDurationSec: rightDuration,
        splitReason: "수동 분리",
      };

      const next = [...prev];
      next.splice(index, 1, sceneA, sceneB);
      return renumber(next);
    });
  }

  function mergeWithNext(index: number) {
    setScenes((prev) => {
      if (index >= prev.length - 1) return prev;
      const a = prev[index];
      const b = prev[index + 1];
      const involvesTitle = a.sceneType === "title" || b.sceneType === "title";
      const mergedScene: Scene = {
        ...a,
        narrationText: `${a.narrationText} ${b.narrationText}`.trim(),
        estimatedDurationSec: a.estimatedDurationSec + b.estimatedDurationSec,
        ...(involvesTitle ? { sceneType: "content" as const, depth: undefined } : {}),
      };
      const next = [...prev];
      next.splice(index, 2, mergedScene);
      return renumber(next);
    });
  }

  async function saveAndGoTo(destination: string) {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "저장에 실패했습니다");
        return;
      }
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

  // Mode-aware: sequence-mode projects insert a "sequences" step between
  // "scenes" and "screen-design" (see lib/projects/pipelineSteps.ts), so the
  // next-step destination must be derived from the ordered step list rather
  // than hardcoded — a scene-mode project still lands on "screen-design"
  // exactly as before.
  const nextStepKey = useMemo(() => {
    const steps = getPipelineSteps(productionMode);
    const idx = steps.findIndex((step) => step.key === "scenes");
    return idx >= 0 && idx + 1 < steps.length ? steps[idx + 1].key : "screen-design";
  }, [productionMode]);

  async function handleNext() {
    await saveAndGoTo(withAutoProgress(`/projects/${projectId}/${nextStepKey}`, auto));
  }

  useNextStepAction(saving ? "저장 중..." : "다음 단계", scenes.length === 0 || saving || loading, handleNext);

  const hierarchy = useMemo(() => buildSceneHierarchy(scenes), [scenes]);

  // Auto-progress: kick off generation once on arrival if there's nothing yet.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (auto && !autoStartedRef.current && scenes.length === 0) {
      autoStartedRef.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-progress: once this tab's own generation settles cleanly, move on by itself.
  const autoPilotRef = useRef(auto);
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading && autoPilotRef.current && autoStartedRef.current && !discoveredRunning) {
      if (!error && warning === null && scenes.length > 0) {
        queueMicrotask(() => void handleNext());
      } else {
        autoPilotRef.current = false;
      }
    }
    prevLoadingRef.current = loading;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  return (
    <div className="space-y-4">
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? (discoveredRunning ? "이미 실행 중..." : "분할 중...") : scenes.length ? "다시 생성" : "AI로 씬 분할"}
          </Button>
          {loading && (
            <Button variant="outline" onClick={cancel}>
              취소
            </Button>
          )}
          {scriptType === "narration_pre_edited" && scenes.length > 0 && (
            <Button
              variant="outline"
              onClick={handleAnalyze}
              disabled={analyzing || loading}
              title="빈 줄 기준으로 자동 분리된 씬에 분리 이유와 관련 씬 정보를 AI로 채워 넣습니다. 나레이션 문구·씬 경계는 바뀌지 않습니다."
            >
              {analyzing ? "분석 중..." : "AI 추가 정보 분석"}
            </Button>
          )}
          <span className="ml-auto text-xs font-medium text-muted-foreground">총 {scenes.length}개 씬</span>
        </div>
        <AiJobStatus
          loading={loading}
          label={discoveredRunning ? "다른 곳에서 시작된 씬 분할이 진행 중입니다" : "AI가 나레이션을 씬으로 분할하는 중입니다"}
          startedAt={startedAt}
          estimateSeconds={estimateSecondsForChars(narrationLength)}
          activityLines={rawPreview ? [rawPreview] : []}
        />
      </Card>

      {warning && (
        <p className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">{warning}</p>
      )}
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
      {analyzeError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {analyzeError}
        </p>
      )}

      <ul className="space-y-3">
        {scenes.map((scene, index) => {
          const isTitle = scene.sceneType === "title";
          const entry = hierarchy[scene.id];
          const indentDepth = entry?.indentDepth ?? 0;
          return (
            <li key={scene.id} style={{ marginLeft: `${indentDepth * 24}px` }}>
              <Card
                className={cn(
                  "flex-row items-start gap-3 p-4",
                  isTitle && ["border-l-4 bg-muted/30", getDepthBorderClass(scene.depth ?? 1)]
                )}
              >
                <div
                  className={cn(
                    "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
                    isTitle ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
                  )}
                >
                  {scene.order}
                </div>
                <div className="min-w-0 flex-1 space-y-2.5">
                  <div className="flex flex-wrap items-center gap-3">
                    <span className="text-xs text-muted-foreground">{scene.id}</span>
                    {isTitle && (
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
                        제목 · {scene.depth ?? 1}뎁스
                      </span>
                    )}
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Input
                        type="number"
                        className="h-7 w-16"
                        value={scene.estimatedDurationSec}
                        onChange={(e) => updateScene(index, { estimatedDurationSec: Number(e.target.value) })}
                      />
                      초
                    </label>
                    <div className="ml-auto flex gap-1">
                      {!isTitle && (
                        <button
                          type="button"
                          onClick={() => splitScene(index)}
                          aria-label="씬 분리"
                          title="씬 분리 (텍스트 커서 위치 기준)"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Scissors className="size-4" />
                        </button>
                      )}
                      {index < scenes.length - 1 && (
                        <button
                          type="button"
                          onClick={() => mergeWithNext(index)}
                          aria-label="다음 씬과 병합"
                          title="다음 씬과 병합"
                          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                        >
                          <Combine className="size-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => deleteScene(index)}
                        disabled={scenes.length <= 1}
                        aria-label="씬 삭제"
                        title="씬 삭제"
                        className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-40"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                  </div>
                  {entry && entry.breadcrumb.length > 0 && (
                    <p className="truncate text-xs text-muted-foreground/70">{entry.breadcrumb.join(" > ")}</p>
                  )}
                  {isTitle ? (
                    <Input
                      value={scene.narrationText}
                      onChange={(e) => updateScene(index, { narrationText: e.target.value })}
                      className="text-sm font-semibold"
                    />
                  ) : (
                    <Textarea
                      ref={(el) => {
                        textareaRefs.current[scene.id] = el;
                      }}
                      rows={2}
                      value={scene.narrationText}
                      onChange={(e) => updateScene(index, { narrationText: e.target.value })}
                      className="text-sm"
                    />
                  )}
                  {(scene.splitReason || (scene.relatedSceneIds && scene.relatedSceneIds.length > 0)) && (
                    <div className="space-y-0.5 text-xs text-muted-foreground">
                      {scene.splitReason && <p>분리 이유: {scene.splitReason}</p>}
                      {scene.relatedSceneIds && scene.relatedSceneIds.length > 0 && (
                        <p>관련 씬: {scene.relatedSceneIds.join(", ")}</p>
                      )}
                    </div>
                  )}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
