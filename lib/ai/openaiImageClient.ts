export interface OpenAiImageOptions {
  quality?: "low" | "medium" | "high";
  size?: string;
  signal?: AbortSignal;
}

export interface OpenAiImageClient {
  generateImage(prompt: string, options?: OpenAiImageOptions): Promise<Buffer>;
}

// ⚠️ Unverified model name (user-confirmed as "GPT Image 2 Low" without checking it exists in
// the OpenAI catalog). Kept as the single place to fix if the API rejects it.
export const OPENAI_IMAGE_MODELS = {
  default: "gpt-image-2",
} as const;

const DEFAULT_QUALITY = "low";
const DEFAULT_SIZE = "1536x1024";
const BASE_URL = "https://api.openai.com/v1";

export class RealOpenAiImageClient implements OpenAiImageClient {
  constructor(private readonly apiKey: string) {}

  async generateImage(prompt: string, options?: OpenAiImageOptions): Promise<Buffer> {
    const response = await fetch(`${BASE_URL}/images/generations`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: OPENAI_IMAGE_MODELS.default,
        prompt,
        quality: options?.quality ?? DEFAULT_QUALITY,
        size: options?.size ?? DEFAULT_SIZE,
        n: 1,
      }),
      signal: options?.signal,
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`OpenAI Image API error (${response.status}): ${body}`);
    }

    const data = (await response.json()) as { data: Array<{ b64_json?: string; url?: string }> };
    const first = data.data[0];
    if (first?.b64_json) {
      return Buffer.from(first.b64_json, "base64");
    }
    if (first?.url) {
      const imageRes = await fetch(first.url);
      if (!imageRes.ok) throw new Error(`이미지 다운로드 실패 (${imageRes.status})`);
      return Buffer.from(await imageRes.arrayBuffer());
    }
    throw new Error("OpenAI Image API 응답에 이미지 데이터가 없습니다");
  }
}

export function createOpenAiImageClient(): OpenAiImageClient {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealOpenAiImageClient(apiKey);
}
