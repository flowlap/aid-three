import { readProjectFile } from "@/lib/projects/store";
import { ReviewIssueList } from "./ReviewIssueList";
import type { ReviewIssue } from "@/lib/pipeline/reviewConsistency";

export default async function ReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const raw = await readProjectFile(projectId, "review.json");
  const initialIssues: ReviewIssue[] = raw ? JSON.parse(raw).issues : [];

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">5단계 — 일관성 검수</h1>
      <ReviewIssueList projectId={projectId} initialIssues={initialIssues} />
    </main>
  );
}
