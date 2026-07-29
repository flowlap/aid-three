import { readProjectFile } from "@/lib/projects/store";
import { MarkdownEditor } from "./MarkdownEditor";

export default async function MarkdownPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const existing = await readProjectFile(projectId, "narration.md");

  return (
    <>
      <h1 className="mb-6 text-3xl font-semibold tracking-tight">원고 변환</h1>
      <MarkdownEditor projectId={projectId} initialMarkdown={existing} />
    </>
  );
}
