"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { useAiJob } from "@/lib/client/useAiJob";

type VisualDesignStreamEvent =
  | { type: "scene"; sceneId: string; index: number; total: number; data: VisualDesign }
  | { type: "result"; visualDesigns: Record<string, VisualDesign> }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function VisualDesignEditor({
  projectId,
  scenes,
  initialDesigns,
}: {
  projectId: string;
  scenes: Scene[];
  initialDesigns: Record<string, VisualDesign>;
}) {
  const router = useRouter();
  const [designs, setDesigns] = useState(initialDesigns);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { loading, discoveredRunning, error, progress, start, cancel } = useAiJob<VisualDesignStreamEvent>({
    projectId,
    step: "visual-design",
    onEvent: (event) => {
      if (event.type === "scene") {
        setDesigns((prev) => ({ ...prev, [event.sceneId]: event.data }));
      } else if (event.type === "result") {
        setDesigns(event.visualDesigns);
      }
    },
    onPollUpdate: (status) => {
      const partial = status.partialData as { visualDesigns?: Record<string, VisualDesign> } | null;
      if (partial?.visualDesigns) setDesigns(partial.visualDesigns);
    },
    onSettled: () => router.refresh(),
  });

  async function handleGenerate() {
    setDesigns({});
    await start();
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
      const base = prev[sceneId] ?? defaults;
      return { ...prev, [sceneId]: { ...base, ...patch } };
    });
  }

  function parseCommaList(value: string): string[] {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }

  async function handleNext() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/visual-design`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visualDesigns: designs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "저장에 실패했습니다");
        return;
      }
      router.push(`/projects/${projectId}/review`);
    } catch {
      setSaveError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={handleGenerate} disabled={loading}>
          {loading
            ? discoveredRunning
              ? `이미 실행 중...${progress ? ` (${progress.index}/${progress.total})` : ""}`
              : progress
                ? `설계 중... (${progress.index}/${progress.total})`
                : "설계 중..."
            : Object.keys(designs).length
              ? "다시 생성"
              : "AI로 비주얼 설계"}
        </Button>
        {loading && (
          <Button variant="outline" onClick={cancel}>
            취소
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <div className="space-y-4">
        {scenes.map((scene) => {
          const design = designs[scene.id];
          return (
            <Card key={scene.id} id={scene.id} className="space-y-2 p-4">
              <div className="space-y-2 rounded bg-gray-50 p-3 text-sm">
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">화면 자막</span>
                  <Input
                    value={design?.caption ?? ""}
                    onChange={(e) => updateDesign(scene.id, { caption: e.target.value })}
                    placeholder="화면 자막"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">핵심 키워드 (쉼표로 구분)</span>
                  <Input
                    value={design?.keywords?.join(", ") ?? ""}
                    onChange={(e) => updateDesign(scene.id, { keywords: parseCommaList(e.target.value) })}
                    placeholder="핵심 키워드1, 핵심 키워드2"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">이미지/도식 설명</span>
                  <Textarea
                    value={design?.imageOrDiagramDescription ?? ""}
                    onChange={(e) => updateDesign(scene.id, { imageOrDiagramDescription: e.target.value })}
                    placeholder="이미지 또는 도식에 대한 설명"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">객체 배치</span>
                  <Input
                    value={design?.objectPlacement ?? ""}
                    onChange={(e) => updateDesign(scene.id, { objectPlacement: e.target.value })}
                    placeholder="객체 배치"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">등장 순서 (쉼표로 구분)</span>
                  <Input
                    value={design?.appearanceOrder?.join(", ") ?? ""}
                    onChange={(e) => updateDesign(scene.id, { appearanceOrder: parseCommaList(e.target.value) })}
                    placeholder="제목, 본문 텍스트, 아이콘"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-xs text-gray-500">제작 지시</span>
                  <Input
                    value={design?.productionNotes ?? ""}
                    onChange={(e) => updateDesign(scene.id, { productionNotes: e.target.value })}
                    placeholder="제작 지시"
                  />
                </label>
              </div>
              <p className="border-t pt-2 text-sm text-gray-600">{scene.narrationText}</p>
            </Card>
          );
        })}
      </div>
      <Button onClick={handleNext} disabled={Object.keys(designs).length === 0 || saving || loading}>
        {saving ? "저장 중..." : "다음 단계"}
      </Button>
    </div>
  );
}
