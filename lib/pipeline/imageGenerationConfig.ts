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
