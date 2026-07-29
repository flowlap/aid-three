"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { useAutoProgressFlag, withAutoProgress } from "@/lib/client/useAutoProgress";

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
}: {
  projectId: string;
  scenes: Scene[];
  initialScreenTypes: Record<string, ScreenTypeAssignment>;
  initialDesigns: Record<string, VisualDesign>;
}) {
  const router = useRouter();
  const auto = useAutoProgressFlag();
  const [screenTypes, setScreenTypes] = useState(initialScreenTypes);
  const [designs, setDesigns] = useState(initialDesigns);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateError, setRegenerateError] = useState<string | null>(null);

  const { loading, discoveredRunning, error, progress, start, cancel } = useAiJob<ScreenDesignStreamEvent>({
    projectId,
    step: "screen-design",
    onEvent: (event) => {
      if (event.type === "scene") {
        setScreenTypes((prev) => ({ ...prev, [event.sceneId]: event.screenType }));
        setDesigns((prev) => ({ ...prev, [event.sceneId]: event.visualDesign }));
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

  async function handleGenerate() {
    setScreenTypes({});
    setDesigns({});
    await start();
  }

  function updateScreenType(sceneId: string, patch: Partial<ScreenTypeAssignment>) {
    setScreenTypes((prev) => {
      const defaults: ScreenTypeAssignment = { screenType: "", recommendedLayout: "", rationale: "", caption: "" };
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

  function parseCommaList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
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

  async function handleNext() {
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
      router.push(withAutoProgress(`/projects/${projectId}/review`, auto));
    } catch {
      setSaveError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  useNextStepAction(
    saving ? "저장 중..." : "다음 단계",
    Object.keys(screenTypes).length === 0 || saving || loading,
    handleNext
  );

  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (auto && !autoStartedRef.current && Object.keys(screenTypes).length === 0) {
      autoStartedRef.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const autoPilotRef = useRef(auto);
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    if (prevLoadingRef.current && !loading && autoPilotRef.current && autoStartedRef.current && !discoveredRunning) {
      const complete = scenes.length > 0 && scenes.every((s) => screenTypes[s.id]?.screenType);
      if (!error && complete) {
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
            {loading
              ? discoveredRunning
                ? `이미 실행 중...${progress ? ` (${progress.index}/${progress.total})` : ""}`
                : progress
                  ? `설계 중... (${progress.index}/${progress.total})`
                  : "설계 중..."
              : Object.keys(screenTypes).length
                ? "다시 생성"
                : "AI로 화면 설계"}
          </Button>
          {loading && (
            <Button variant="outline" onClick={cancel}>
              취소
            </Button>
          )}
          <span className="ml-auto text-xs font-medium text-muted-foreground">총 {scenes.length}개 씬</span>
        </div>
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
          const assignment = screenTypes[scene.id];
          const design = designs[scene.id];
          const regenerating = regeneratingIds.has(scene.id);
          return (
            <Card key={scene.id} id={scene.id} className="gap-5 p-5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-xs font-medium text-muted-foreground">{scene.id}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateScene(scene.id)}
                  disabled={regenerating || loading}
                >
                  {regenerating ? "재생성 중..." : "이 씬만 재생성"}
                </Button>
              </div>

              <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
                {scene.narrationText}
              </p>

              <div className="rounded-lg border bg-muted/50 p-3.5">
                <p className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">AI 선택</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">화면 유형</span>
                    <Input
                      value={assignment?.screenType ?? ""}
                      onChange={(e) => updateScreenType(scene.id, { screenType: e.target.value })}
                      placeholder="화면 유형"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-xs text-muted-foreground">추천 레이아웃</span>
                    <Input
                      value={assignment?.recommendedLayout ?? ""}
                      onChange={(e) => updateScreenType(scene.id, { recommendedLayout: e.target.value })}
                      placeholder="추천 레이아웃"
                    />
                  </label>
                </div>
                {assignment?.rationale && (
                  <p className="mt-2.5 text-xs text-muted-foreground italic">근거: {assignment.rationale}</p>
                )}
              </div>

              <div className="space-y-4">
                <label className="block">
                  <span className="mb-1.5 block text-sm font-medium">화면 자막</span>
                  <Input
                    value={design?.caption ?? ""}
                    onChange={(e) => updateDesign(scene.id, { caption: e.target.value })}
                    placeholder="화면 자막"
                  />
                </label>
                <label className="block">
                  <span className="mb-1.5 block text-xs text-muted-foreground">이미지/도식 설명</span>
                  <Textarea
                    value={design?.imageOrDiagramDescription ?? ""}
                    onChange={(e) => updateDesign(scene.id, { imageOrDiagramDescription: e.target.value })}
                    placeholder="이미지 또는 도식에 대한 설명"
                  />
                </label>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-muted-foreground">핵심 키워드 (쉼표로 구분)</span>
                    <Input
                      value={design?.keywords?.join(", ") ?? ""}
                      onChange={(e) => updateDesign(scene.id, { keywords: parseCommaList(e.target.value) })}
                      placeholder="핵심 키워드1, 핵심 키워드2"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-muted-foreground">객체 배치</span>
                    <Input
                      value={design?.objectPlacement ?? ""}
                      onChange={(e) => updateDesign(scene.id, { objectPlacement: e.target.value })}
                      placeholder="객체 배치"
                    />
                  </label>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-muted-foreground">등장 순서 (쉼표로 구분)</span>
                    <Input
                      value={design?.appearanceOrder?.join(", ") ?? ""}
                      onChange={(e) => updateDesign(scene.id, { appearanceOrder: parseCommaList(e.target.value) })}
                      placeholder="제목, 본문 텍스트, 아이콘"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-xs text-muted-foreground">제작 지시</span>
                    <Input
                      value={design?.productionNotes ?? ""}
                      onChange={(e) => updateDesign(scene.id, { productionNotes: e.target.value })}
                      placeholder="제작 지시"
                    />
                  </label>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
