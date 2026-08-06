import { NextRequest, NextResponse } from "next/server";
import { readProject, writeProjectFile } from "@/lib/projects/store";
import type { LocalImageModelSize } from "@/lib/pipeline/imageGenerationConfig";
import { HCHAT_GEMINI_IMAGE_MODELS } from "@/lib/ai/image/hchatGeminiImageClient";

const ENGINE_FILENAME = "image-engine.txt";
const MODEL_SIZE_FILENAME = "image-local-model-size.txt";
const HCHAT_GEMINI_MODEL_FILENAME = "image-hchat-gemini-model.txt";

export type ImageEngine = "openai" | "local";

/** Saves the project-wide image generation engine choice (OpenAI vs local FLUX.2 Klein), and when local, the model size, and when the server's IMAGE_PROVIDER is hchat-gemini, the Gemini model. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) return NextResponse.json({ error: "프로젝트를 찾을 수 없습니다" }, { status: 404 });

  const body = await req.json().catch(() => null);
  const engine: unknown = body?.engine;
  if (engine !== "openai" && engine !== "local") {
    return NextResponse.json({ error: "engine 필드는 'openai' 또는 'local'이어야 합니다" }, { status: 400 });
  }

  const localModelSize: unknown = body?.localModelSize;
  if (localModelSize !== undefined && localModelSize !== "4b" && localModelSize !== "9b") {
    return NextResponse.json({ error: "localModelSize 필드는 '4b' 또는 '9b'이어야 합니다" }, { status: 400 });
  }

  const hchatGeminiModel: unknown = body?.hchatGeminiModel;
  if (hchatGeminiModel !== undefined && !HCHAT_GEMINI_IMAGE_MODELS.includes(hchatGeminiModel as never)) {
    return NextResponse.json(
      { error: `hchatGeminiModel 필드는 ${HCHAT_GEMINI_IMAGE_MODELS.join(", ")} 중 하나여야 합니다` },
      { status: 400 }
    );
  }

  await writeProjectFile(projectId, ENGINE_FILENAME, engine satisfies ImageEngine);
  if (localModelSize !== undefined) {
    await writeProjectFile(projectId, MODEL_SIZE_FILENAME, localModelSize satisfies LocalImageModelSize);
  }
  if (hchatGeminiModel !== undefined) {
    await writeProjectFile(projectId, HCHAT_GEMINI_MODEL_FILENAME, hchatGeminiModel as string);
  }
  return NextResponse.json({ ok: true });
}
