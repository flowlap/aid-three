import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectFile, writeProjectFile, updateProjectStep } from "@/lib/projects/store";
import { createDeepSeekClient } from "@/lib/ai/deepseekClient";
import { convertToMarkdown } from "@/lib/pipeline/convertMarkdown";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const rawText = await readProjectFile(projectId, "extracted.txt");
  if (!rawText) return NextResponse.json({ error: "업로드된 원본 텍스트가 없습니다" }, { status: 400 });

  const client = createDeepSeekClient();
  const markdown = await convertToMarkdown(client, rawText, project.scriptType);

  await writeProjectFile(projectId, "narration.md", markdown);
  await updateProjectStep(projectId, "markdown");

  return NextResponse.json({ markdown });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const { markdown } = (await req.json()) as { markdown: string };
  await writeProjectFile(projectId, "narration.md", markdown);
  return NextResponse.json({ ok: true });
}
