"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useAiJob } from "@/lib/client/useAiJob";

type MarkdownStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "result"; markdown: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function MarkdownEditor({
  projectId,
  initialMarkdown,
}: {
  projectId: string;
  initialMarkdown: string | null;
}) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(initialMarkdown ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { loading, discoveredRunning, error, start, cancel } = useAiJob<MarkdownStreamEvent>({
    projectId,
    step: "markdown",
    onEvent: (event) => {
      if (event.type === "chunk") {
        setMarkdown((prev) => prev + event.text);
      } else if (event.type === "result") {
        setMarkdown(event.markdown);
      }
    },
    onPollUpdate: (status) => {
      if (typeof status.partialRaw === "string") setMarkdown(status.partialRaw);
    },
    onSettled: () => router.refresh(),
  });

  async function handleGenerate() {
    setMarkdown("");
    await start();
  }

  async function handleNext() {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/markdown`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "저장에 실패했습니다");
        return;
      }
      router.push(`/projects/${projectId}/scenes`);
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
          {loading ? (discoveredRunning ? "이미 실행 중..." : "변환 중...") : markdown ? "다시 생성" : "AI로 변환"}
        </Button>
        {loading && (
          <Button variant="outline" onClick={cancel}>
            취소
          </Button>
        )}
      </div>
      <Textarea
        rows={20}
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        placeholder="변환 결과가 여기에 표시됩니다. 직접 수정할 수 있습니다."
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {saveError && <p className="text-sm text-red-600">{saveError}</p>}
      <Button onClick={handleNext} disabled={!markdown || saving || loading}>
        {saving ? "저장 중..." : "다음 단계"}
      </Button>
    </div>
  );
}
