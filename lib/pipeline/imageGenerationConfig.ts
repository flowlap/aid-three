/**
 * Max simultaneous OpenAI image-generation requests per job. Shared between
 * the images route (actual dispatch limit) and the client-side time
 * estimate, so the estimate reflects real parallel throughput.
 */
export const IMAGE_GENERATION_CONCURRENCY = 3;

/**
 * Retry policy for a non-rate-limit image generation failure (network
 * hiccup, transient API error, ...): wait this long, then retry this many
 * times before giving up and failing the whole job.
 */
export const IMAGE_GENERATION_RETRY_DELAY_MS = 5000;
export const IMAGE_GENERATION_MAX_RETRIES = 1;

/**
 * Retry policy specifically for a 429 rate-limit response — the most likely
 * failure when several scenes/groups are generating concurrently (see
 * IMAGE_GENERATION_CONCURRENCY). A longer delay and more retries than the
 * generic policy give OpenAI's per-minute limit time to actually reset.
 */
export const IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS = 30000;
export const IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES = 2;

/** "4b" (default, Apache 2.0) or "9b" (higher quality, FLUX.2-dev non-commercial license — internal review use only). */
export type LocalImageModelSize = "4b" | "9b";

/** Resolution for the full-batch ("AI로 이미지 생성") local run — fast draft pass across every scene. */
export const LOCAL_IMAGE_DRAFT_WIDTH = 1024;
export const LOCAL_IMAGE_DRAFT_HEIGHT = 576;

/** Resolution for a single scene's "이미지 재생성" local run — higher quality, one scene at a time. */
export const LOCAL_IMAGE_FINAL_WIDTH = 1344;
export const LOCAL_IMAGE_FINAL_HEIGHT = 768;

/** FLUX.2 Klein is step-distilled — 4 steps is the model's intended operating point, not a speed/quality tradeoff knob. */
export const LOCAL_IMAGE_STEPS = 4;

/** mflux on-the-fly quantization bit depth, applied to both 4B and 9B. */
export const LOCAL_IMAGE_QUANTIZE = 8;

/** Local generation runs on one GPU process that loads the model once — no benefit to (and no support for) concurrent calls. */
export const LOCAL_IMAGE_CONCURRENCY = 1;
