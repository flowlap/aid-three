import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile } from "@/lib/projects/store";

const PROMPT_FILENAME = "presenter-image-prompt.txt";
const GENDER_FILENAME = "presenter-gender.txt";

/** Saves the presenter reference prompt text + gender alone, without generating an image (see presenter-reference/generate/route.ts, which also persists them as a side effect of actually generating). */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (typeof body?.prompt !== "string") {
    return NextResponse.json({ error: "prompt 필드는 문자열이어야 합니다" }, { status: 400 });
  }
  if (body.gender !== "male" && body.gender !== "female") {
    return NextResponse.json({ error: "gender 필드는 male 또는 female이어야 합니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, PROMPT_FILENAME, body.prompt);
  await writeProjectFile(projectId, GENDER_FILENAME, body.gender);
  return NextResponse.json({ ok: true });
}
