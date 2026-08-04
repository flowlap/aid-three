import { NextRequest, NextResponse } from "next/server";
import os from "os";
import { readProject, readProjectFile, writeProjectFile, writeProjectReferenceImage } from "@/lib/projects/store";
import { createImageClient } from "@/lib/ai/image/factory";
import { createLocalImageClient } from "@/lib/ai/localImageClient";
import { describeImageError } from "@/lib/pipeline/generateSceneImage";
import { DEFAULT_PRESENTER_IMAGE_PROMPT } from "@/lib/pipeline/commonPromptDefaults";
import { LOCAL_IMAGE_FINAL_WIDTH, LOCAL_IMAGE_FINAL_HEIGHT, LOCAL_IMAGE_STEPS, LOCAL_IMAGE_QUANTIZE, type LocalImageModelSize } from "@/lib/pipeline/imageGenerationConfig";
import { withInFlightLock, AlreadyInFlightError } from "@/lib/jobs/inFlightLock";

const PROMPT_FILENAME = "presenter-image-prompt.txt";
const GENDER_FILENAME = "presenter-gender.txt";
const GENDER_LABEL: Record<"male" | "female", string> = { male: "남성", female: "여성" };

/** Generates (or regenerates, replacing the previous one) the project's presenter/announcer reference image from a prompt + gender — follows the project's image-engine.txt choice (OpenAI/cloud vs local FLUX.2 Klein), same as scene image generation. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => ({}));
  const prompt = (typeof body?.prompt === "string" ? body.prompt : "").trim() || DEFAULT_PRESENTER_IMAGE_PROMPT;
  const gender = body?.gender === "male" || body?.gender === "female" ? body.gender : "female";
  const fullPrompt = `${prompt}\n\n성별: ${GENDER_LABEL[gender as "male" | "female"]}.`;

  const engineRaw = (await readProjectFile(projectId, "image-engine.txt"))?.trim();
  const engine: "openai" | "local" = engineRaw === "local" ? "local" : "openai";
  const modelSizeRaw = (await readProjectFile(projectId, "image-local-model-size.txt"))?.trim();
  const localModelSize: LocalImageModelSize = modelSizeRaw === "9b" ? "9b" : "4b";

  try {
    return await withInFlightLock(`images:${projectId}:presenter-reference`, async () => {
      let buffer: Buffer;
      if (engine === "local") {
        let localClient;
        try {
          localClient = createLocalImageClient(os.tmpdir());
        } catch (err) {
          console.error("강사 참고 이미지 생성 실패:", err);
          return NextResponse.json({ error: err instanceof Error ? err.message : "로컬 이미지 생성에 실패했습니다" }, { status: 502 });
        }
        try {
          let generatedImage: Buffer | undefined;
          await localClient.generateBatch([{ sceneId: `reference-presenter-${projectId}`, prompt: fullPrompt }], {
            modelSize: localModelSize,
            width: LOCAL_IMAGE_FINAL_WIDTH,
            height: LOCAL_IMAGE_FINAL_HEIGHT,
            steps: LOCAL_IMAGE_STEPS,
            quantize: LOCAL_IMAGE_QUANTIZE,
            onScene: async ({ image }) => {
              generatedImage = image;
            },
          });
          if (!generatedImage) throw new Error("로컬 이미지 생성 결과가 비어 있습니다");
          buffer = generatedImage;
        } catch (err) {
          console.error("강사 참고 이미지 생성 실패:", err);
          return NextResponse.json({ error: err instanceof Error ? err.message : "로컬 이미지 생성에 실패했습니다" }, { status: 502 });
        }
      } else {
        let client;
        try {
          client = createImageClient();
        } catch (err) {
          console.error("강사 참고 이미지 생성 실패:", err);
          return NextResponse.json({ error: "AI 이미지 생성에 실패했습니다" }, { status: 502 });
        }
        try {
          buffer = await client.generateImage(fullPrompt);
        } catch (err) {
          const reason = describeImageError(err);
          console.error("강사 참고 이미지 생성 실패:", err);
          return NextResponse.json({ error: reason }, { status: 502 });
        }
      }

      await writeProjectReferenceImage(projectId, "presenter", buffer);
      await writeProjectFile(projectId, PROMPT_FILENAME, prompt);
      await writeProjectFile(projectId, GENDER_FILENAME, gender);
      return NextResponse.json({ ok: true });
    });
  } catch (err) {
    if (err instanceof AlreadyInFlightError) {
      return NextResponse.json({ error: "강사 참고 이미지가 이미 생성 중입니다. 완료될 때까지 기다려주세요." }, { status: 409 });
    }
    throw err;
  }
}
