"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Scene } from "@/lib/pipeline/splitScenes";

export function SceneListEditor({
  projectId,
  initialScenes,
}: {
  projectId: string;
  initialScenes: Scene[];
}) {
  const router = useRouter();
  const [scenes, setScenes] = useState<Scene[]>(initialScenes);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "씬 분할에 실패했습니다");
        return;
      }
      setScenes(data.scenes);
      setWarning(data.integrityOk ? null : "AI가 나레이션 원문을 임의로 수정했을 수 있습니다. 확인해주세요.");
    } catch {
      setError("씬 분할 요청 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  function updateScene(index: number, patch: Partial<Scene>) {
    setScenes((prev) => prev.map((scene, i) => (i === index ? { ...scene, ...patch } : scene)));
  }

  async function handleNext() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/scenes`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scenes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다");
        return;
      }
      router.push(`/projects/${projectId}/screen-types`);
    } catch {
      setError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "분할 중..." : scenes.length ? "다시 생성" : "AI로 씬 분할"}
      </Button>
      {warning && <p className="text-sm text-amber-600">{warning}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="space-y-3">
        {scenes.map((scene, index) => (
          <li key={scene.id} className="rounded border p-3">
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500">
              <span>{scene.id}</span>
              <span>· 사유: {scene.splitReason}</span>
              <Input
                type="number"
                className="w-24"
                value={scene.estimatedDurationSec}
                onChange={(e) => updateScene(index, { estimatedDurationSec: Number(e.target.value) })}
              />
              <span>초</span>
            </div>
            <textarea
              className="w-full rounded border p-2"
              rows={2}
              value={scene.narrationText}
              onChange={(e) => updateScene(index, { narrationText: e.target.value })}
            />
          </li>
        ))}
      </ul>
      <Button onClick={handleNext} disabled={scenes.length === 0 || saving}>
        {saving ? "저장 중..." : "다음 단계"}
      </Button>
    </div>
  );
}
