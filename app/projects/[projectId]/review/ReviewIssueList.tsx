"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { ReviewIssue } from "@/lib/pipeline/reviewConsistency";

export function ReviewIssueList({
  projectId,
  initialIssues,
}: {
  projectId: string;
  initialIssues: ReviewIssue[];
}) {
  const router = useRouter();
  const [issues, setIssues] = useState<ReviewIssue[]>(initialIssues);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/review`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "일관성 검수에 실패했습니다");
        return;
      }
      setIssues(data.issues);
    } catch {
      setError("일관성 검수 요청 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "검수 중..." : "일관성 검수 실행"}
      </Button>
      {error && <p className="text-sm text-red-600">{error}</p>}
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
      <Button onClick={() => router.push(`/projects/${projectId}/storyboard`)}>최종 스토리보드 보기</Button>
    </div>
  );
}
