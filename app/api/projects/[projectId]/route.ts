import { NextRequest, NextResponse } from "next/server";
import { readProject, deleteProject, updateProjectTitle } from "@/lib/projects/store";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  if (!title) return NextResponse.json({ error: "제목을 입력해주세요" }, { status: 400 });

  try {
    const updated = await updateProjectTitle(projectId, title);
    return NextResponse.json({ project: updated });
  } catch (err) {
    console.error("프로젝트 이름 변경 실패:", err);
    return NextResponse.json({ error: "프로젝트 이름 변경에 실패했습니다" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  try {
    await deleteProject(projectId);
  } catch (err) {
    console.error("프로젝트 삭제 실패:", err);
    return NextResponse.json({ error: "프로젝트 삭제에 실패했습니다" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
