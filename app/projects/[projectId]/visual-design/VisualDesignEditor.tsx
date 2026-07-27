"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

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
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/visual-design`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "비주얼 설계에 실패했습니다");
        return;
      }
      setDesigns(data.visualDesigns);
    } catch {
      setError("비주얼 설계 요청 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  function updateDesign(sceneId: string, patch: Partial<VisualDesign>) {
    setDesigns((prev) => ({ ...prev, [sceneId]: { ...prev[sceneId], ...patch } }));
  }

  async function handleNext() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/visual-design`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ visualDesigns: designs }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다");
        return;
      }
      router.push(`/projects/${projectId}/review`);
    } catch {
      setError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "설계 중..." : Object.keys(designs).length ? "다시 생성" : "AI로 비주얼 설계"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <div className="space-y-4">
        {scenes.map((scene) => {
          const design = designs[scene.id];
          return (
            <Card key={scene.id} className="space-y-2 p-4">
              <div className="rounded bg-gray-50 p-3 text-sm">
                <p className="font-medium">화면 자막: {design?.caption ?? "-"}</p>
                <p>핵심 키워드: {design?.keywords?.join(", ") ?? "-"}</p>
                <p>이미지/도식 설명: {design?.imageOrDiagramDescription ?? "-"}</p>
                <p>객체 배치: {design?.objectPlacement ?? "-"}</p>
                <p>등장 순서: {design?.appearanceOrder?.join(" → ") ?? "-"}</p>
                <Input
                  className="mt-2"
                  value={design?.productionNotes ?? ""}
                  onChange={(e) => updateDesign(scene.id, { productionNotes: e.target.value })}
                  placeholder="제작 지시"
                />
              </div>
              <p className="border-t pt-2 text-sm text-gray-600">{scene.narrationText}</p>
            </Card>
          );
        })}
      </div>
      <Button onClick={handleNext} disabled={Object.keys(designs).length === 0 || saving}>
        {saving ? "저장 중..." : "다음 단계"}
      </Button>
    </div>
  );
}
