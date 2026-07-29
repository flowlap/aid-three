"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReviewIssue } from "@/lib/pipeline/reviewConsistency";
import { useAiJob } from "@/lib/client/useAiJob";

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
  const [issues, setIssues] = useState<ReviewIssue[]>(initialIssues);
  const [rawPreview, setRawPreview] = useState("");
  const [viewingStoryboard, setViewingStoryboard] = useState(false);

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

  async function handleViewStoryboard() {
    if (viewingStoryboard) return;
    setViewingStoryboard(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/storyboard`, { method: "POST" });
      if (!res.ok) {
        console.error("스토리보드 단계 업데이트 실패:", await res.text());
      }
      router.push(`/projects/${projectId}/storyboard`);
    } catch (err) {
      console.error("스토리보드 단계 업데이트 요청 중 오류:", err);
      setViewingStoryboard(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        <Button onClick={handleGenerate} disabled={loading}>
          {loading ? (discoveredRunning ? "이미 실행 중..." : "검수 중...") : "일관성 검수 실행"}
        </Button>
        {loading && (
          <Button variant="outline" onClick={cancel}>
            취소
          </Button>
        )}
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {loading && (
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded border bg-gray-50 p-3 text-xs text-gray-600">
          {rawPreview || "AI 검수 준비 중..."}
        </pre>
      )}
      {issues.length === 0 ? (
        <p className="text-gray-500">발견된 이슈가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {issues.map((issue) => (
            <li key={issue.id} className="rounded border p-3">
              <div className="mb-1 flex items-center gap-2">
                <Badge variant={issue.severity === "error" ? "destructive" : "secondary"}>{issue.severity}</Badge>
                <span className="text-sm font-medium">{issue.type}</span>
              </div>
              <p className="text-sm">{issue.message}</p>
              <div className="mt-1 flex gap-2 text-xs">
                {issue.sceneIds.map((sceneId) => (
                  <Link
                    key={sceneId}
                    href={`/projects/${projectId}/visual-design#${sceneId}`}
                    className="text-blue-600 hover:underline"
                  >
                    {sceneId} 수정하러 가기
                  </Link>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
      <Button onClick={handleViewStoryboard} disabled={viewingStoryboard}>
        {viewingStoryboard ? "이동 중..." : "최종 스토리보드 보기"}
      </Button>
    </div>
  );
}
