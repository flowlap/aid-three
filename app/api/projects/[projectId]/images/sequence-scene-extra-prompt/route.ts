import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile } from "@/lib/projects/store";

const FILENAME = "sequence-scene-extra-prompt.txt";

/** Saves the sequence + AI mode per-scene extra instruction (see DEFAULT_SEQUENCE_SCENE_EXTRA_PROMPT) folded into every scene image generation prompt as promptOptions.extraPrompt. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  if (typeof body?.text !== "string") {
    return NextResponse.json({ error: "text 필드는 문자열이어야 합니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, FILENAME, body.text);
  return NextResponse.json({ ok: true });
}
