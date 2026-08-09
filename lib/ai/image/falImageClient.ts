import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "./types";

/**
 * fal.ai image provider, using FLUX schnell (text→image) via the queue REST
 * API (submit → poll status → fetch result). Auth is a single
 * `Authorization: Key <FAL_KEY>` header. Results come back as fal-hosted image
 * URLs, so the final bytes are downloaded from that URL — same shape as the
 * OpenAI client's url branch.
 *
 * schnell is text→image only (no image editing / image_url input), so
 * reference images passed by callers are ignored on this provider. Override
 * the model via FAL_IMAGE_MODEL; per-model input fields vary — see the model's
 * API page on fal.ai.
 */
const QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_MODEL = "fal-ai/flux/schnell";
const DEFAULT_SIZE = "1536x1024";
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_MS = 5 * 60_000;

/** Maps a "WxH" size string to fal's image_size object; passes any other string through as a fal size preset. */
function toFalImageSize(size: string): { width: number; height: number } | string {
  const match = size.match(/^(\d+)x(\d+)$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : size;
}

export class RealFalImageClient implements ImageClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL
  ) {}

  async generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const imageSize = toFalImageSize(options?.size ?? DEFAULT_SIZE);
    console.log(`[fal Image] 생성 시작 model=${this.model} promptChars=${prompt.length}`);

    const authHeaders = { Authorization: `Key ${this.apiKey}` };

    let submit: Response;
    try {
      submit = await fetch(`${QUEUE_BASE}/${this.model}`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, image_size: imageSize, num_images: 1 }),
        signal: options?.signal,
      });
    } catch (err) {
      console.error(`[fal Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }
    if (!submit.ok) {
      const err = new ImageApiError(submit.status, await submit.text());
      console.error(`[fal Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const submitted = (await submit.json()) as { status_url?: string; response_url?: string };
    if (!submitted.status_url || !submitted.response_url) {
      throw new Error("fal 큐 응답에 status_url/response_url이 없습니다");
    }

    const deadline = Date.now() + MAX_POLL_MS;
    while (true) {
      if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");

      const statusRes = await fetch(submitted.status_url, { headers: authHeaders, signal: options?.signal });
      if (!statusRes.ok) {
        const err = new ImageApiError(statusRes.status, await statusRes.text());
        console.error(`[fal Image] 상태 조회 실패 elapsedMs=${Date.now() - startedAt}`, err);
        throw err;
      }
      const status = (await statusRes.json()) as { status?: string };
      if (status.status === "COMPLETED") break;
      if (Date.now() > deadline) {
        throw new Error(`fal 생성이 제한 시간(${MAX_POLL_MS / 1000}초)을 초과했습니다`);
      }
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }

    const resultRes = await fetch(submitted.response_url, { headers: authHeaders, signal: options?.signal });
    if (!resultRes.ok) {
      const err = new ImageApiError(resultRes.status, await resultRes.text());
      console.error(`[fal Image] 결과 조회 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }
    const result = (await resultRes.json()) as { images?: Array<{ url?: string }> };
    const url = result.images?.[0]?.url;
    if (!url) {
      const err = new Error("fal 응답에 이미지가 없습니다");
      console.error(`[fal Image] 생성 실패 elapsedMs=${Date.now() - startedAt}`, err);
      throw err;
    }

    const imageRes = await fetch(url, { signal: options?.signal });
    if (!imageRes.ok) throw new Error(`이미지 다운로드 실패 (${imageRes.status})`);
    const buffer = Buffer.from(await imageRes.arrayBuffer());
    console.log(`[fal Image] 생성 완료 elapsedMs=${Date.now() - startedAt} bytes=${buffer.length}`);
    return buffer;
  }
}

export function createFalImageClient(): ImageClient {
  const apiKey = process.env.FAL_KEY;
  if (!apiKey) {
    throw new Error("FAL_KEY 환경변수가 설정되지 않았습니다");
  }
  return new RealFalImageClient(apiKey, process.env.FAL_IMAGE_MODEL || DEFAULT_MODEL);
}
