"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { DETERMINISTIC_ISSUE_LABELS, type ReviewIssue } from "@/lib/pipeline/reviewConsistency";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { useAutoProgressFlag } from "@/lib/client/useAutoProgress";

const SEVERITY_LABELS: Record<ReviewIssue["severity"], string> = {
  info: "정보",
  warning: "경고",
  error: "오류",
};

const SEVERITY_BADGE_CLASS: Record<ReviewIssue["severity"], string> = {
  info: "bg-primary/10 text-primary",
  warning: "bg-warning/15 text-warning",
  error: "bg-destructive/10 text-destructive",
};

const SEVERITY_BORDER_CLASS: Record<ReviewIssue["severity"], string> = {
  info: "border-l-primary/40",
  warning: "border-l-warning",
  error: "border-l-destructive",
};

type ReviewStreamEvent =
  | { type: "deterministic"; issues: ReviewIssue[] }
  | { type: "chunk"; text: string }
  | { type: "result"; issues: ReviewIssue[] }
  | { type: "error"; message: string }
  | { type: "cancelled" };

export function ReviewIssueList({
  projectId,
  initialIssues,
}: {
  projectId: string;
  initialIssues: ReviewIssue[];
}) {
  const router = useRouter();
  const auto = useAutoProgressFlag();
  const [issues, setIssues] = useState<ReviewIssue[]>(initialIssues);
  const [rawPreview, setRawPreview] = useState("");
  const [navigatingNext, setViewingStoryboard] = useState(false);

  const { loading, discoveredRunning, error, start, cancel } = useAiJob<ReviewStreamEvent>({
    projectId,
    step: "review",
    onEvent: (event) => {
      if (event.type === "deterministic" || event.type === "result") {
        setIssues(event.issues);
      } else if (event.type === "chunk") {
        setRawPreview((prev) => prev + event.text);
      }
    },
    onPollUpdate: (status) => {
      if (typeof status.partialRaw === "string") setRawPreview(status.partialRaw);
    },
    onSettled: () => router.refresh(),
  });

  async function handleGenerate() {
    setRawPreview("");
    await start();
  }

  function handleNext() {
    setViewingStoryboard(true);
    router.push(`/projects/${projectId}/images`);
  }

  useNextStepAction(navigatingNext ? "이동 중..." : "다음 단계", navigatingNext, handleNext);

  // Auto-progress only covers free/cheap DeepSeek text steps — it deliberately
  // stops here rather than auto-continuing into the images step, which makes
  // real (paid) OpenAI image API calls per scene.
  const autoStartedRef = useRef(false);
  useEffect(() => {
    if (auto && !autoStartedRef.current) {
      autoStartedRef.current = true;
      handleGenerate();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-4">
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? (discoveredRunning ? "이미 실행 중..." : "검수 중...") : "일관성 검수 실행"}
          </Button>
          {loading && (
            <Button variant="outline" onClick={cancel}>
              취소
            </Button>
          )}
          {issues.length > 0 && (
            <span className="ml-auto text-xs font-medium text-muted-foreground">총 {issues.length}개 이슈</span>
          )}
        </div>
        {loading && (
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg border bg-muted p-3 text-xs text-muted-foreground">
            {rawPreview || "AI 검수 준비 중..."}
          </pre>
        )}
      </Card>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}

      {issues.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
          <p className="text-sm font-medium">발견된 이슈가 없습니다</p>
          <p className="mt-1 text-sm text-muted-foreground">일관성 검수를 통과했습니다.</p>
        </div>
      ) : (
        <ul className="space-y-3">
          {issues.map((issue) => (
            <li key={issue.id}>
              <Card className={cn("gap-2 border-l-4 p-4", SEVERITY_BORDER_CLASS[issue.severity])}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className={cn("border-transparent font-medium", SEVERITY_BADGE_CLASS[issue.severity])}>
                    {SEVERITY_LABELS[issue.severity]}
                  </Badge>
                  {DETERMINISTIC_ISSUE_LABELS[issue.type] && (
                    <span className="text-sm font-medium">{DETERMINISTIC_ISSUE_LABELS[issue.type]}</span>
                  )}
                </div>
                <p className="text-sm text-foreground">{issue.message}</p>
                {issue.sceneIds.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {issue.sceneIds.map((sceneId) => (
                      <Link
                        key={sceneId}
                        href={`/projects/${projectId}/screen-design#${sceneId}`}
                        className="inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                      >
                        {sceneId} 수정하러 가기 →
                      </Link>
                    ))}
                  </div>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
