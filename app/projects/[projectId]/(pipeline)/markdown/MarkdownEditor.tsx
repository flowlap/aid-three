"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { AiJobStatus } from "@/components/AiJobStatus";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { useToast } from "@/lib/client/ToastContext";
import { estimateSecondsForChars } from "@/lib/client/estimateAiDuration";
import type { ScriptType } from "@/lib/projects/types";

/** Lets the "저장 완료" toast actually be seen before a destination navigation unloads the page. */
const TOAST_BEFORE_NAVIGATE_MS = 600;

type MarkdownStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "result"; markdown: string }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function MarkdownEditor({
  projectId,
  initialMarkdown,
  rawTextLength,
  scriptType,
}: {
  projectId: string;
  initialMarkdown: string | null;
  rawTextLength: number;
  scriptType: ScriptType;
}) {
  const isPreEditedNarration = scriptType === "narration_pre_edited";
  const router = useRouter();
  const { showToast } = useToast();
  const [markdown, setMarkdown] = useState(initialMarkdown ?? "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const { loading, discoveredRunning, error, startedAt, start, cancel } = useAiJob<MarkdownStreamEvent>({
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

  /** Omitting `destination` saves in place (the standalone "저장" button); passing one saves then navigates there ("다음 단계"/자동 진행). */
  async function saveAndGoTo(destination?: string) {
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
      showToast("저장 완료");
      if (!destination) return;
      await new Promise((resolve) => setTimeout(resolve, TOAST_BEFORE_NAVIGATE_MS));
      // A plain SPA router.push() here can reuse a stale cached render of
      // the shared (pipeline) layout (stepper checkmarks included) — the
      // layout only reliably refetches project.currentStep on a real
      // navigation, so this step deliberately does a full page load instead
      // of a soft client-side transition.
      window.location.href = destination;
    } catch {
      setSaveError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  async function handleNext() {
    await saveAndGoTo(`/projects/${projectId}/scenes`);
  }

  async function handleAutoProgress() {
    await saveAndGoTo(`/projects/${projectId}/scenes?auto=1`);
  }

  useNextStepAction(saving ? "저장 중..." : "다음 단계", !markdown || saving || loading, handleNext);

  return (
    <div className="space-y-4">
      <Card className="gap-0 p-0">
        <div className="flex flex-wrap items-center gap-2 border-b p-4">
          {isPreEditedNarration ? (
            <p className="text-sm text-muted-foreground">
              나레이션(가편집) 프로젝트는 이미 완성된 나레이션을 그대로 사용하므로 AI 변환을 다시 실행할 수 없습니다.
            </p>
          ) : (
            <>
              <Button onClick={handleGenerate} disabled={loading}>
                {loading ? (discoveredRunning ? "이미 실행 중..." : "변환 중...") : markdown ? "다시 생성" : "AI로 변환"}
              </Button>
              {loading && (
                <Button variant="outline" onClick={cancel}>
                  취소
                </Button>
              )}
            </>
          )}
          <Button
            variant="outline"
            onClick={() => void saveAndGoTo()}
            disabled={!markdown || saving || loading}
            className="ml-auto"
          >
            {saving ? "저장 중..." : "저장"}
          </Button>
          <Button variant="outline" onClick={handleAutoProgress} disabled={!markdown || saving || loading}>
            자동 진행 (2~6단계)
          </Button>
        </div>
        {loading && (
          <div className="border-b p-3">
            <AiJobStatus
              loading={loading}
              label={discoveredRunning ? "다른 곳에서 시작된 변환이 진행 중입니다" : "AI가 원고를 마크다운으로 변환하는 중입니다"}
              startedAt={startedAt}
              estimateSeconds={estimateSecondsForChars(rawTextLength)}
            />
          </div>
        )}
        <div className="p-4">
          <Textarea
            rows={20}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder="변환 결과가 여기에 표시됩니다. 직접 수정할 수 있습니다."
            className="min-h-[28rem] resize-y border-0 bg-transparent p-0 text-sm leading-relaxed shadow-none focus-visible:ring-0"
          />
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
    </div>
  );
}
