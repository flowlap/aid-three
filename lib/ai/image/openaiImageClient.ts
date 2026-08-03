import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "./types";

// ⚠️ Unverified model name (user-confirmed as "GPT Image 2 Low" without checking it exists in
// the OpenAI catalog). Kept as the single place to fix if the API rejects it.
export const OPENAI_IMAGE_MODELS = {
  default: "gpt-image-2",
} as const;

const DEFAULT_QUALITY = "low";
const DEFAULT_SIZE = "1536x1024";
const BASE_URL = "https://api.openai.com/v1";

export class RealOpenAiImageClient implements ImageClient {
  constructor(private readonly apiKey: string) {}

  async generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const referenceImages = options?.referenceImages?.filter((img) => img.length > 0) ?? [];
    return referenceImages.length > 0
      ? this.editImage(prompt, referenceImages, options)
      : this.generateFromScratch(prompt, options);
  }

  private async generateFromScratch(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const quality = options?.quality ?? DEFAULT_QUALITY;
    const size = options?.size ?? DEFAULT_SIZE;
    console.log(`[OpenAI Image] 생성 시작 model=${OPENAI_IMAGE_MODELS.default} quality=${quality} size=${size} promptChars=${prompt.length}`);

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/images/generations`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: OPENAI_IMAGE_MODELS.default,
          prompt,
          quality,
          size,
          n: 1,
        }),
        signal: options?.signal,
      });
    } catch (err) {
      console.error(`[OpenAI Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    return this.parseImageResponse(response, startedAt);
  }

  private async editImage(prompt: string, referenceImages: Buffer[], options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const quality = options?.quality ?? DEFAULT_QUALITY;
    const size = options?.size ?? DEFAULT_SIZE;
    console.log(
      `[OpenAI Image] 참조 이미지 기반 생성 시작 model=${OPENAI_IMAGE_MODELS.default} quality=${quality} size=${size} promptChars=${prompt.length} refImages=${referenceImages.length}`
    );

    const form = new FormData();
    form.set("model", OPENAI_IMAGE_MODELS.default);
    form.set("prompt", prompt);
    form.set("quality", quality);
    form.set("size", size);
    form.set("n", "1");
    referenceImages.forEach((buffer, i) => {
      form.append("image[]", new Blob([new Uint8Array(buffer)], { type: "image/png" }), `reference-${i}.png`);
    });

    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}` },
        body: form,
        signal: options?.signal,
      });
    } catch (err) {
      console.error(`[OpenAI Image] 참조 이미지 기반 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    return this.parseImageResponse(response, startedAt);
  }

  private async parseImageResponse(response: Response, startedAt: number): Promise<Buffer> {
    if (!response.ok) {
      const body = await response.text();
      const err = new ImageApiError(response.status, body);
      console.error(`[OpenAI Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const data = (await response.json()) as { data: Array<{ b64_json?: string; url?: string }> };
    const first = data.data[0];
    if (first?.b64_json) {
      const buffer = Buffer.from(first.b64_json, "base64");
      console.log(`[OpenAI Image] 생성 완료 elapsedMs=${Date.now() - startedAt} bytes=${buffer.length}`);
      return buffer;
    }
    if (first?.url) {
      const imageRes = await fetch(first.url);
      if (!imageRes.ok) throw new Error(`이미지 다운로드 실패 (${imageRes.status})`);
      const buffer = Buffer.from(await imageRes.arrayBuffer());
      console.log(`[OpenAI Image] 생성 완료(URL 다운로드) elapsedMs=${Date.now() - startedAt} bytes=${buffer.length}`);
      return buffer;
    }
    const err = new Error("OpenAI Image API 응답에 이미지 데이터가 없습니다");
    console.error(`[OpenAI Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
    throw err;
  }
}

export function createOpenAiImageClient(): ImageClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealOpenAiImageClient(apiKey);
}
