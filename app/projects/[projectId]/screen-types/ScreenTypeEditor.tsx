"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";

export function ScreenTypeEditor({
  projectId,
  scenes,
  initialScreenTypes,
}: {
  projectId: string;
  scenes: Scene[];
  initialScreenTypes: Record<string, ScreenTypeAssignment>;
}) {
  const router = useRouter();
  const [screenTypes, setScreenTypes] = useState(initialScreenTypes);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/screen-types`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "화면 유형 선정에 실패했습니다");
        return;
      }
      setScreenTypes(data.screenTypes);
    } catch {
      setError("화면 유형 선정 요청 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  function updateAssignment(sceneId: string, patch: Partial<ScreenTypeAssignment>) {
    setScreenTypes((prev) => ({ ...prev, [sceneId]: { ...prev[sceneId], ...patch } }));
  }

  async function handleNext() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/screen-types`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenTypes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다");
        return;
      }
      router.push(`/projects/${projectId}/visual-design`);
    } catch {
      setError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "선정 중..." : Object.keys(screenTypes).length ? "다시 생성" : "AI로 화면 유형 선정"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <ul className="space-y-3">
        {scenes.map((scene) => {
          const assignment = screenTypes[scene.id];
          return (
            <li key={scene.id} className="rounded border p-3">
              <p className="mb-2 text-sm text-gray-500">{scene.id} — {scene.narrationText}</p>
              <Input
                className="mb-2"
                value={assignment?.screenType ?? ""}
                onChange={(e) => updateAssignment(scene.id, { screenType: e.target.value })}
                placeholder="화면 유형"
              />
              <Input
                value={assignment?.recommendedLayout ?? ""}
                onChange={(e) => updateAssignment(scene.id, { recommendedLayout: e.target.value })}
                placeholder="추천 레이아웃"
              />
              {assignment?.rationale && <p className="mt-1 text-xs text-gray-400">근거: {assignment.rationale}</p>}
            </li>
          );
        })}
      </ul>
      <Button onClick={handleNext} disabled={Object.keys(screenTypes).length === 0 || saving}>
        {saving ? "저장 중..." : "다음 단계"}
      </Button>
    </div>
  );
}
