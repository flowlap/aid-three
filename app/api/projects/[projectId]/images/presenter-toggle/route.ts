import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile } from "@/lib/projects/store";

const FILENAME = "image-presenter-enabled.txt";

/** Saves the project-wide "아나운서 표시" toggle folded into every image generation prompt. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (typeof body?.enabled !== "boolean") {
    return NextResponse.json({ error: "enabled 필드는 boolean이어야 합니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, FILENAME, body.enabled ? "true" : "false");
  return NextResponse.json({ ok: true });
}
