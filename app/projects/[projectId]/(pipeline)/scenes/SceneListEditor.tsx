"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Combine, Scissors, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Scene } from "@/lib/pipeline/splitScenes";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { useAutoProgressFlag, withAutoProgress } from "@/lib/client/useAutoProgress";

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
}: {
  projectId: string;
  initialScenes: Scene[];
}) {
  const router = useRouter();
  const auto = useAutoProgressFlag();
  const [scenes, setScenes] = useState<Scene[]>(initialScenes);
  const textareaRefs = useRef<Record<string, HTMLTextAreaElement | null>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [rawPreview, setRawPreview] = useState("");

  const { loading, discoveredRunning, error, start, cancel } = useAiJob<SceneStreamEvent>({
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
        return { ...scene, narrationText, estimatedDurationSec: scene.estimatedDurationSec + deleted.estimatedDurationSec };
      });
      return renumber(merged);
    });
  }

  function splitScene(index: number) {
    setScenes((prev) => {
      const scene = prev[index];
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
      const mergedScene: Scene = {
        ...a,
        narrationText: `${a.narrationText} ${b.narrationText}`.trim(),
        estimatedDurationSec: a.estimatedDurationSec + b.estimatedDurationSec,
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
      router.push(destination);
    } catch {
      setSaveError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    await saveAndGoTo(withAutoProgress(`/projects/${projectId}/screen-design`, auto));
  }

  useNextStepAction(saving ? "저장 중..." : "다음 단계", scenes.length === 0 || saving || loading, handleNext);

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
          <span className="ml-auto text-xs font-medium text-muted-foreground">총 {scenes.length}개 씬</span>
        </div>
        {loading && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
            {rawPreview || "생성 준비 중..."}
          </pre>
        )}
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

      <ul className="space-y-3">
        {scenes.map((scene, index) => (
          <li key={scene.id}>
            <Card className="flex-row items-start gap-3 p-4">
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                {scene.order}
              </div>
              <div className="min-w-0 flex-1 space-y-2.5">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-xs text-muted-foreground">{scene.id}</span>
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
                    <button
                      type="button"
                      onClick={() => splitScene(index)}
                      aria-label="씬 분리"
                      title="씬 분리 (텍스트 커서 위치 기준)"
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <Scissors className="size-4" />
                    </button>
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
                <Textarea
                  ref={(el) => {
                    textareaRefs.current[scene.id] = el;
                  }}
                  rows={2}
                  value={scene.narrationText}
                  onChange={(e) => updateScene(index, { narrationText: e.target.value })}
                  className="text-sm"
                />
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
