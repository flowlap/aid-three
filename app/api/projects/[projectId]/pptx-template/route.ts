import { NextRequest, NextResponse } from "next/server";
import { readProject, readProjectPptxTemplate, writeProjectPptxTemplate, deleteProjectPptxTemplate } from "@/lib/projects/store";

/** Whether the project has a saved custom pptx template — drives the "적용된 템플릿" indicator in the UI. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const template = await readProjectPptxTemplate(projectId);
  return NextResponse.json({ exists: template !== null });
}

/** Saves an uploaded .pptx as the project's export template — every later "PPTX로 저장" reuses it until removed. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const formData = await req.formData();
  const template = formData.get("template") as File | null;
  if (!template) return NextResponse.json({ error: "템플릿 파일이 없습니다" }, { status: 400 });
  if (!template.name.toLowerCase().endsWith(".pptx")) {
    return NextResponse.json({ error: "pptx 파일만 업로드 가능합니다" }, { status: 400 });
  }

  await writeProjectPptxTemplate(projectId, Buffer.from(await template.arrayBuffer()));
  return NextResponse.json({ ok: true });
}

/** Reverts the project to the bundled default/노트북LM template. */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  await deleteProjectPptxTemplate(projectId);
  return NextResponse.json({ ok: true });
}
