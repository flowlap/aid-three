import { NextRequest, NextResponse } from "next/server";
import { readProject, updateProjectStep } from "@/lib/projects/store";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  try {
    await updateProjectStep(projectId, "storyboard");
  } catch (err) {
    console.error("프로젝트 단계 업데이트 실패:", err);
    return NextResponse.json({ error: "프로젝트 단계 업데이트에 실패했습니다" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
