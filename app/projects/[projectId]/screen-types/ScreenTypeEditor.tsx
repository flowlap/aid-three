"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import { useAiJob } from "@/lib/client/useAiJob";

type ScreenTypeStreamEvent =
  | { type: "scene"; sceneId: string; index: number; total: number; data: ScreenTypeAssignment }
  | { type: "result"; screenTypes: Record<string, ScreenTypeAssignment> }
  | { type: "error"; message: string }
  | { type: "cancelled" };

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
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { loading, discoveredRunning, error, progress, start, cancel } = useAiJob<ScreenTypeStreamEvent>({
    projectId,
    step: "screen-types",
    onEvent: (event) => {
      if (event.type === "scene") {
        setScreenTypes((prev) => ({ ...prev, [event.sceneId]: event.data }));
      } else if (event.type === "result") {
        setScreenTypes(event.screenTypes);
      }
    },
    onPollUpdate: (status) => {
      const partial = status.partialData as { screenTypes?: Record<string, ScreenTypeAssignment> } | null;
      if (partial?.screenTypes) setScreenTypes(partial.screenTypes);
    },
    onSettled: () => router.refresh(),
  });

  async function handleGenerate() {
    setScreenTypes({});
    await start();
  }

  function updateAssignment(sceneId: string, patch: Partial<ScreenTypeAssignment>) {
    setScreenTypes((prev) => {
      const defaults: ScreenTypeAssignment = { screenType: "", recommendedLayout: "", rationale: "" };
      const base = prev[sceneId] ?? defaults;
      return { ...prev, [sceneId]: { ...base, ...patch } };
    });
  }

  async function handleNext() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/screen-types`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenTypes }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "저장에 실패했습니다");
        return;
      }
      router.push(`/projects/${projectId}/visual-design`);
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
                ? `선정 중... (${progress.index}/${progress.total})`
                : "선정 중..."
            : Object.keys(screenTypes).length
              ? "다시 생성"
              : "AI로 화면 유형 선정"}
        </Button>
        {loading && (
          <Button variant="outline" onClick={cancel}>
            취소
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
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
      <Button onClick={handleNext} disabled={Object.keys(screenTypes).length === 0 || saving || loading}>
        {saving ? "저장 중..." : "다음 단계"}
      </Button>
    </div>
  );
}
