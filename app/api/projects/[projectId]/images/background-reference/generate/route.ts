import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile, writeProjectReferenceImage } from "@/lib/projects/store";
import { createImageClient } from "@/lib/ai/image/factory";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";
import { DEFAULT_BACKGROUND_IMAGE_PROMPT } from "@/lib/pipeline/commonPromptDefaults";

const PROMPT_FILENAME = "background-image-prompt.txt";

/** Generates (or regenerates, replacing the previous one) the project's fixed background reference image from a prompt. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const prompt = (typeof body?.prompt === "string" ? body.prompt : "").trim() || DEFAULT_BACKGROUND_IMAGE_PROMPT;

  let client;
  try {
    client = createImageClient();
  } catch (err) {
    console.error("배경 참고 이미지 생성 실패:", err);
    return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다" }, { status: 502 });
  }

  try {
    const buffer = await client.generateImage(prompt);
    await writeProjectReferenceImage(projectId, "background", buffer);
    await writeProjectFile(projectId, PROMPT_FILENAME, prompt);
  } catch (err) {
    const reason = describeImageError(err);
    console.error("배경 참고 이미지 생성 실패:", err);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
