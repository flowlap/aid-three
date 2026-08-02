import { readProjectFile } from "@/lib/projects/store";
import { ReviewIssueList } from "./ReviewIssueList";
import type { ReviewIssue } from "@/lib/pipeline/reviewConsistency";

export default async function ReviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const raw = await readProjectFile(projectId, "review.json");
  const initialIssues: ReviewIssue[] = raw ? JSON.parse(raw).issues : [];
  const scenesRaw = await readProjectFile(projectId, "scenes.json");
  const sceneCount: number = scenesRaw ? (JSON.parse(scenesRaw).scenes?.length ?? 0) : 0;

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">일관성 검수</h1>
      <ReviewIssueList projectId={projectId} initialIssues={initialIssues} initialHasRun={raw !== null} sceneCount={sceneCount} />
    </>
  );
}
