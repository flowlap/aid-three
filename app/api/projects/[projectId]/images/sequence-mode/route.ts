import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile } from "@/lib/projects/store";

const SEQUENCE_IMAGE_MODE_FILENAME = "sequence-image-mode.txt";

export type SequenceImageMode = "composite" | "ai";

/** Saves the project-wide sequence-mode still image generation choice: deterministic composite (master crop + overlay layer) vs full AI regeneration per scene (overlays baked into the prompt). Scene-mode projects never read this file. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const mode: unknown = body?.mode;
  if (mode !== "composite" && mode !== "ai") {
    return NextResponse.json({ error: "mode 필드는 'composite' 또는 'ai'여야 합니다" }, { status: 400 });
  }

  await writeProjectFile(projectId, SEQUENCE_IMAGE_MODE_FILENAME, mode satisfies SequenceImageMode);
  return NextResponse.json({ ok: true });
}
