import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile, writeProjectReferenceImage } from "@/lib/projects/store";
import { createOpenAiImageClient } from "@/lib/ai/openaiImageClient";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";
import { DEFAULT_PRESENTER_IMAGE_PROMPT } from "@/lib/pipeline/commonPromptDefaults";

const PROMPT_FILENAME = "presenter-image-prompt.txt";
const GENDER_FILENAME = "presenter-gender.txt";
const GENDER_LABEL: Record<"male" | "female", string> = { male: "남성", female: "여성" };

/** Generates (or regenerates, replacing the previous one) the project's presenter/announcer reference image from a prompt + gender. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const prompt = (typeof body?.prompt === "string" ? body.prompt : "").trim() || DEFAULT_PRESENTER_IMAGE_PROMPT;
  const gender = body?.gender === "male" || body?.gender === "female" ? body.gender : "female";

  let client;
  try {
    client = createOpenAiImageClient();
  } catch (err) {
    console.error("강사 참고 이미지 생성 실패:", err);
    return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다" }, { status: 502 });
  }

  try {
    const buffer = await client.generateImage(`${prompt}\n\n성별: ${GENDER_LABEL[gender as "male" | "female"]}.`);
    await writeProjectReferenceImage(projectId, "presenter", buffer);
    await writeProjectFile(projectId, PROMPT_FILENAME, prompt);
    await writeProjectFile(projectId, GENDER_FILENAME, gender);
  } catch (err) {
    const reason = describeImageError(err);
    console.error("강사 참고 이미지 생성 실패:", err);
    return NextResponse.json({ error: reason }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
