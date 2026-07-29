"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ScreenMockup } from "@/components/ScreenMockup";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";

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
}: {
  projectId: string;
  scenes: Scene[];
  screenTypes: Record<string, ScreenTypeAssignment>;
  visualDesigns: Record<string, VisualDesign>;
  initialImageIds: string[];
}) {
  const router = useRouter();
  const [imageIds, setImageIds] = useState<Set<string>>(new Set(initialImageIds));
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [regeneratingIds, setRegeneratingIds] = useState<Set<string>>(new Set());
  const [regenerateError, setRegenerateError] = useState<string | null>(null);
  const [advancing, setAdvancing] = useState(false);
  const [advanceError, setAdvanceError] = useState<string | null>(null);

  const { loading, discoveredRunning, error, progress, start, cancel } = useAiJob<ImageStreamEvent>({
    projectId,
    step: "images",
    onEvent: (event) => {
      if (event.type === "scene") {
        setImageIds((prev) => new Set(prev).add(event.sceneId));
        setVersions((prev) => ({ ...prev, [event.sceneId]: (prev[event.sceneId] ?? 0) + 1 }));
      }
    },
    onSettled: () => router.refresh(),
  });

  async function handleGenerate() {
    await start();
  }

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
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleGenerate} disabled={loading}>
            {loading
              ? discoveredRunning
                ? `이미 실행 중...${progress ? ` (${progress.index}/${progress.total})` : ""}`
                : progress
                  ? `생성 중... (${progress.index}/${progress.total})`
                  : "생성 중..."
              : imageIds.size
                ? "전체 다시 생성"
                : "AI로 이미지 생성"}
          </Button>
          {loading && (
            <Button variant="outline" onClick={cancel}>
              취소
            </Button>
          )}
          <span className="ml-auto text-xs font-medium text-muted-foreground">
            {imageIds.size} / {scenes.length}개 생성됨
          </span>
        </div>
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
      {advanceError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {advanceError}
        </p>
      )}

      <div className="space-y-4">
        {scenes.map((scene, index) => {
          const design = visualDesigns[scene.id];
          const hasImage = imageIds.has(scene.id);
          const regenerating = regeneratingIds.has(scene.id);
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
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => regenerateScene(scene.id)}
                  disabled={regenerating || loading || !design}
                >
                  {regenerating ? "생성 중..." : hasImage ? "이 씬만 재생성" : "이 씬만 생성"}
                </Button>
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
                  <ScreenMockup screenType={screenTypes[scene.id]?.screenType} design={design} />
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
