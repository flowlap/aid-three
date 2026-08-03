import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "./types";
import { getHChatBaseUrl, getHChatHeaders } from "../hchatShared";

const DEFAULT_MODEL = "gemini-3.1-flash-image";

interface GeminiImagePart {
  inlineData?: { data: string; mimeType: string };
  inline_data?: { data: string; mimeType: string };
  thought?: boolean;
}

interface GeminiChunk {
  candidates?: Array<{ content?: { parts?: GeminiImagePart[] } }>;
}

function extractInlineImageBase64(raw: string): string {
  const lines = raw.split("\n").filter((l) => l.trim());
  let b64Data = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "[" || trimmed === "]") continue;
    const json = trimmed.startsWith(",") ? trimmed.slice(1) : trimmed;
    let parsed: GeminiChunk | GeminiChunk[];
    try {
      parsed = JSON.parse(json);
    } catch {
      continue;
    }
    const chunks = Array.isArray(parsed) ? parsed : [parsed];
    for (const chunk of chunks) {
      for (const candidate of chunk.candidates ?? []) {
        for (const part of candidate.content?.parts ?? []) {
          if (part.thought) continue;
          const inline = part.inlineData ?? part.inline_data;
          if (inline?.data) b64Data = inline.data;
        }
      }
    }
  }

  if (!b64Data) {
    throw new Error(`이미지 데이터를 찾을 수 없습니다\n\n[raw 응답 앞 500자]\n${raw.slice(0, 500)}`);
  }
  return b64Data;
}

export class RealHChatGeminiImageClient implements ImageClient {
  constructor(private readonly model: string = DEFAULT_MODEL) {}

  async generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const referenceImages = options?.referenceImages?.filter((img) => img.length > 0) ?? [];
    console.log(`[H-Chat Gemini Image] 생성 시작 model=${this.model} promptChars=${prompt.length} refImages=${referenceImages.length}`);

    const imageParts = referenceImages.map((buf) => ({
      inline_data: { mime_type: "image/png", data: buf.toString("base64") },
    }));

    let response: Response;
    try {
      response = await fetch(`${getHChatBaseUrl()}/models/${this.model}:streamGenerateContent`, {
        method: "POST",
        headers: getHChatHeaders(),
        body: JSON.stringify({
          contents: [{ role: "user", parts: [...imageParts, { text: prompt }] }],
          generationConfig: { responseModalities: ["IMAGE", "TEXT"], thinkingConfig: { thinkingBudget: 0 } },
        }),
        signal: options?.signal,
      });
    } catch (err) {
      console.error(`[H-Chat Gemini Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const rawText = await response.text().catch(() => "");
    if (!response.ok) {
      const err = new ImageApiError(response.status, rawText);
      console.error(`[H-Chat Gemini Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const b64Data = extractInlineImageBase64(rawText);
    const buffer = Buffer.from(b64Data, "base64");
    console.log(`[H-Chat Gemini Image] 생성 완료 elapsedMs=${Date.now() - startedAt} bytes=${buffer.length}`);
    return buffer;
  }
}

export function createHChatGeminiImageClient(): ImageClient {
  getHChatHeaders();
  const model = process.env.HCHAT_GEMINI_IMAGE_MODEL || DEFAULT_MODEL;
  return new RealHChatGeminiImageClient(model);
}
