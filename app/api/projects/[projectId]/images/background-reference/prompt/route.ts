import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile } from "@/lib/projects/store";

const PROMPT_FILENAME = "background-image-prompt.txt";

/** Saves the background reference prompt text alone, without generating an image (see background-reference/generate/route.ts, which also persists it as a side effect of actually generating). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (typeof body?.prompt !== "string") {
    return NextResponse.json({ error: "prompt 필드는 문자열이어야 합니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, PROMPT_FILENAME, body.prompt);
  return NextResponse.json({ ok: true });
}
