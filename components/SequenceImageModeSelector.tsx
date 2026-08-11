"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type SequenceImageMode = "composite" | "ai";

const MODE_LABELS: Record<SequenceImageMode, string> = {
  composite: "코드 기반 합성 (마스터 + 교육 그래픽)",
  ai: "AI 재생성 (오버레이를 프롬프트에 반영)",
};

/**
 * Project-wide choice for how sequence-mode content scenes get their still
 * image: a deterministic composite of the sequence's master visual + an
 * overlay layer (no image-model call per scene), or a full AI regeneration
 * per scene where overlay content (labels/arrows/highlights/diagrams/charts)
 * is folded into the generation prompt instead of composited afterward.
 */
export function SequenceImageModeSelector({
  projectId,
  initialMode,
  onModeChange,
}: {
  projectId: string;
  initialMode: SequenceImageMode;
  /** Fires whenever the mode changes, so a parent that needs the current value can mirror it without owning the save logic. */
  onModeChange?: (mode: SequenceImageMode) => void;
}) {
  const [mode, setMode] = useState<SequenceImageMode>(initialMode);
  const [saving, setSaving] = useState(false);

  async function handleModeChange(next: SequenceImageMode) {
    setMode(next);
    onModeChange?.(next);
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/images/sequence-mode`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: next }),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">씬 이미지 생성 방식</span>
        <Select value={mode} onValueChange={(value) => handleModeChange(value as SequenceImageMode)} disabled={saving}>
          <SelectTrigger className="w-full sm:w-72">
            <SelectValue>{(value: SequenceImageMode) => MODE_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="composite">{MODE_LABELS.composite}</SelectItem>
            <SelectItem value="ai">{MODE_LABELS.ai}</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {mode === "composite" ? (
        <p className="text-xs text-muted-foreground">
          이미지 모델을 호출하지 않고 시퀀스 마스터 비주얼에 정확한 한글·수치 기반의 라벨/흐름도/강조/도식/차트를 결정적으로 합성합니다 — 비용 없음.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          씬마다 AI 이미지 생성을 호출해 오버레이 내용까지 이미지에 직접 그리도록 요청합니다 — 씬 모드와 동일하게 호출마다 비용이 발생합니다.
        </p>
      )}
    </Card>
  );
}
