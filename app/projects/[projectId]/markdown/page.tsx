import { readProjectFile } from "@/lib/projects/store";
import { MarkdownEditor } from "./MarkdownEditor";

export default async function MarkdownPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const existing = await readProjectFile(projectId, "narration.md");

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="mb-4 text-2xl font-bold">1단계 — 마크다운 변환</h1>
      <MarkdownEditor projectId={projectId} initialMarkdown={existing} />
    </main>
  );
}
