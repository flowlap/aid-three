"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export type ImageEngine = "openai" | "local";
export type LocalModelSize = "4b" | "9b";

const ENGINE_LABELS: Record<ImageEngine, string> = {
  openai: "ChatGPT (OpenAI)",
  local: "로컬 모델 (FLUX.2 Klein)",
};

const MODEL_SIZE_LABELS: Record<LocalModelSize, string> = {
  "4b": "4B (기본)",
  "9b": "9B (고품질 · 비상업용)",
};

/**
 * Project-wide image generation engine choice, shown at the top of the
 * images step. OpenAI needs an API key and bills per call; the local engine
 * runs FLUX.2 Klein via mflux entirely on-device (Mac/Apple Silicon only) —
 * see docs/reference/local-image-generation.md.
 */
export function ImageEngineSelector({
  projectId,
  initialEngine,
  initialModelSize,
  onEngineChange,
}: {
  projectId: string;
  initialEngine: ImageEngine;
  initialModelSize: LocalModelSize;
  /** Fires whenever the engine changes, so a parent that needs the current value (e.g. for a time estimate) can mirror it without owning the save logic. */
  onEngineChange?: (engine: ImageEngine) => void;
}) {
  const [engine, setEngine] = useState<ImageEngine>(initialEngine);
  const [modelSize, setModelSize] = useState<LocalModelSize>(initialModelSize);
  const [saving, setSaving] = useState(false);

  async function save(next: { engine: ImageEngine; modelSize: LocalModelSize }) {
    setSaving(true);
    try {
      await fetch(`/api/projects/${projectId}/images/engine`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engine: next.engine, localModelSize: next.modelSize }),
      });
    } finally {
      setSaving(false);
    }
  }

  function handleEngineChange(next: ImageEngine) {
    setEngine(next);
    onEngineChange?.(next);
    save({ engine: next, modelSize });
  }

  function handleModelSizeChange(next: LocalModelSize) {
    setModelSize(next);
    save({ engine, modelSize: next });
  }

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm font-medium">이미지 생성 엔진</span>
        <Select value={engine} onValueChange={(value) => handleEngineChange(value as ImageEngine)} disabled={saving}>
          <SelectTrigger className="w-full sm:w-56">
            <SelectValue>{(value: ImageEngine) => ENGINE_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="openai">{ENGINE_LABELS.openai}</SelectItem>
            <SelectItem value="local">{ENGINE_LABELS.local}</SelectItem>
          </SelectContent>
        </Select>
        {engine === "local" && (
          <Select value={modelSize} onValueChange={(value) => handleModelSizeChange(value as LocalModelSize)} disabled={saving}>
            <SelectTrigger className="w-full sm:w-52">
              <SelectValue>{(value: LocalModelSize) => MODEL_SIZE_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="4b">{MODEL_SIZE_LABELS["4b"]}</SelectItem>
              <SelectItem value="9b">{MODEL_SIZE_LABELS["9b"]}</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {engine === "openai" ? (
        <p className="text-xs text-muted-foreground">
          OpenAI Images API를 호출합니다 — 인터넷 연결과 API 키가 필요하고, 호출마다 비용이 발생합니다.
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          이 Mac에서 로컬로 실행됩니다(Apple Silicon 전용) — 최초 1회{" "}
          <code className="rounded bg-muted px-1 py-0.5">python/image/setup.sh</code>를 실행해야 합니다. 9B는 FLUX.2-dev
          비상업 라이선스이므로 내부 검수·비상업 용도로만 사용하세요. 자세한 내용은{" "}
          <code className="rounded bg-muted px-1 py-0.5">docs/reference/local-image-generation.md</code> 참고.
        </p>
      )}
    </Card>
  );
}
