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

  let markdown: string;
  try {
    const client = createDeepSeekClient();
    markdown = await convertToMarkdown(client, rawText, project.scriptType);
  } catch (err) {
    console.error("마크다운 변환 실패:", err);
    return NextResponse.json(
      { error: "AI 변환에 실패했습니다. 잠시 후 다시 시도해주세요." },
      { status: 502 }
    );
  }

  await writeProjectFile(projectId, "narration.md", markdown);
  await updateProjectStep(projectId, "markdown");

  return NextResponse.json({ markdown });
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const body = (await req.json()) as { markdown?: unknown };
  if (typeof body.markdown !== "string") {
    return NextResponse.json({ error: "markdown 필드는 문자열이어야 합니다" }, { status: 400 });
  }
  await writeProjectFile(projectId, "narration.md", body.markdown);
  return NextResponse.json({ ok: true });
}
