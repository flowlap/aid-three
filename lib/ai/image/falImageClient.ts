import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "./types";

/**
 * fal.ai image provider, using FLUX schnell (text→image) via the queue REST
 * API (submit → poll status → fetch result). Auth is a single
 * `Authorization: Key <FAL_KEY>` header. Results come back as fal-hosted image
 * URLs, so the final bytes are downloaded from that URL — same shape as the
 * OpenAI client's url branch.
 *
 * Override the model via FAL_IMAGE_MODEL; per-model input fields vary — see the
 * model's API page on fal.ai.
 *
 * Model families take different sizing params: FLUX-style models want an
 * `image_size` object ({width,height} or a preset string), while Google's
 * Nano Banana 2 models take an `aspect_ratio` enum instead. buildSizeBody
 * picks the right one from the model id so a plain FAL_IMAGE_MODEL switch keeps
 * honoring the requested size.
 *
 * Reference images: FLUX schnell is text→image only, so references are ignored
 * there. Nano Banana 2 supports image editing — when references are passed for
 * a nano-banana model we hit its `/edit` endpoint with the references as
 * `image_urls` (base64 data URIs), matching how the OpenAI client switches to
 * its edit path.
 */
const QUEUE_BASE = "https://queue.fal.run";
const DEFAULT_MODEL = "fal-ai/flux/schnell";
const DEFAULT_SIZE = "1536x1024";
const POLL_INTERVAL_MS = 1000;
const MAX_POLL_MS = 5 * 60_000;

/** aspect_ratio values Nano Banana 2 accepts, as [label, width/height]. */
const NANO_BANANA_ASPECT_RATIOS: Array<[string, number]> = [
  ["21:9", 21 / 9],
  ["16:9", 16 / 9],
  ["3:2", 3 / 2],
  ["4:3", 4 / 3],
  ["5:4", 5 / 4],
  ["1:1", 1],
  ["4:5", 4 / 5],
  ["3:4", 3 / 4],
  ["2:3", 2 / 3],
  ["9:16", 9 / 16],
];

function isNanoBananaModel(model: string): boolean {
  return /nano-banana/i.test(model);
}

/** Maps a "WxH" size string to fal's image_size object; passes any other string through as a fal size preset. */
function toFalImageSize(size: string): { width: number; height: number } | string {
  const match = size.match(/^(\d+)x(\d+)$/);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : size;
}

/** Maps a "WxH" size string to the nearest Nano Banana aspect_ratio label; falls back to "auto". */
function toNanoBananaAspectRatio(size: string): string {
  const match = size.match(/^(\d+)x(\d+)$/);
  if (!match) return "auto";
  const target = Number(match[1]) / Number(match[2]);
  let best = NANO_BANANA_ASPECT_RATIOS[0];
  for (const candidate of NANO_BANANA_ASPECT_RATIOS) {
    if (Math.abs(candidate[1] - target) < Math.abs(best[1] - target)) best = candidate;
  }
  return best[0];
}

/** Returns the model-appropriate sizing field(s) for the request body. */
function buildSizeBody(model: string, size: string): Record<string, unknown> {
  return isNanoBananaModel(model)
    ? { aspect_ratio: toNanoBananaAspectRatio(size) }
    : { image_size: toFalImageSize(size) };
}

export class RealFalImageClient implements ImageClient {
  constructor(
    private readonly apiKey: string,
    private readonly model: string = DEFAULT_MODEL
  ) {}

  async generateImage(prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    const startedAt = Date.now();
    const sizeBody = buildSizeBody(this.model, options?.size ?? DEFAULT_SIZE);
    const referenceImages = options?.referenceImages?.filter((img) => img.length > 0) ?? [];

    // Nano Banana edits via its /edit endpoint with image_urls; other models
    // (e.g. FLUX schnell) are text→image only, so references are dropped.
    const useEdit = referenceImages.length > 0 && isNanoBananaModel(this.model);
    const endpoint = useEdit ? `${this.model}/edit` : this.model;
    const imageUrlsBody = useEdit
      ? { image_urls: referenceImages.map((buf) => `data:image/png;base64,${buf.toString("base64")}`) }
      : {};
    console.log(
      `[fal Image] 생성 시작 model=${this.model} edit=${useEdit} refImages=${referenceImages.length} promptChars=${prompt.length}`
    );

    const authHeaders = { Authorization: `Key ${this.apiKey}` };

    let submit: Response;
    try {
      submit = await fetch(`${QUEUE_BASE}/${endpoint}`, {
        method: "POST",
        headers: { ...authHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ prompt, ...sizeBody, ...imageUrlsBody, num_images: 1 }),
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
