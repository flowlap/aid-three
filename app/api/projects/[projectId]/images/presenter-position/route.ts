import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile } from "@/lib/projects/store";

const FILENAME = "presenter-fixed-position.txt";
const VALID_POSITIONS = new Set(["auto", "left", "center", "right"]);

/** Saves the project-wide fixed presenter position (left/center/right), or "auto" to keep letting screen design's per-scene AI choice through unchanged. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (typeof body?.position !== "string" || !VALID_POSITIONS.has(body.position)) {
    return NextResponse.json({ error: "position 필드는 auto/left/center/right 중 하나여야 합니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, FILENAME, body.position);
  return NextResponse.json({ ok: true });
}
