/**
 * Safety ceiling on simultaneous in-flight image-generation calls. Real
 * throughput is governed by IMAGE_GENERATION_MIN_INTERVAL_MS (a rate gate on
 * how often a *new* call may start), not by this number — this just bounds
 * how many can be in flight at once so a run of fast-returning calls (e.g.
 * repeated immediate content-block failures, which don't take the usual
 * ~17-24s) can't open an unbounded number of concurrent connections to the
 * gateway. At steady state, calls average ~17-24s and a new one starts every
 * IMAGE_GENERATION_MIN_INTERVAL_MS (4s), so ~5-6 tend to be in flight at
 * once — this ceiling of 6 matches that naturally, it isn't the throttle.
 *
 * History: lowered from the original 3 all the way to 1 (fully sequential)
 * after H-Chat's Gemini image endpoint was observed silently throttling —
 * returning a 200 OK with an empty candidate instead of a proper 429 (see
 * NoImageDataError in lib/ai/image/types.ts). Raised back up once the actual
 * fix (rate-gating dispatch starts, not capping concurrency) was in place —
 * see IMAGE_GENERATION_MIN_INTERVAL_MS.
 */
export const IMAGE_GENERATION_CONCURRENCY = 6;

/**
 * Minimum spacing between the *start* of one image-generation call and the
 * start of the next, enforced via a rate gate (see createRateGate in
 * lib/concurrency.ts) shared across every concurrent worker — regardless of
 * how many calls are in flight (up to IMAGE_GENERATION_CONCURRENCY), at most
 * one new call may start per this interval. This directly targets Gemini's
 * commonly documented 15 RPM tier (60000 / 15 = 4000ms/call average), the
 * best concrete number available for H-Chat's Gemini image endpoint — there
 * is no published H-Chat-specific limit, so this is inferred, not confirmed
 * for this gateway specifically.
 *
 * Rate-gating dispatch (rather than serializing completion, the earlier
 * approach) means overall throughput can approach the full 15 RPM budget
 * even though each call takes far longer than 4s to complete, since several
 * calls started 4s apart legitimately overlap in flight.
 *
 * Note this can't guarantee staying under a *shared* quota if the H-Chat key
 * is also used by other concurrent traffic outside this app's visibility —
 * pacing our own calls to 4s apart only bounds what we contribute.
 */
export const IMAGE_GENERATION_MIN_INTERVAL_MS = 4000;

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
