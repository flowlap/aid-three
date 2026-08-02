/**
 * Max simultaneous OpenAI image-generation requests per job. Shared between
 * the images route (actual dispatch limit) and the client-side time
 * estimate, so the estimate reflects real parallel throughput.
 */
export const IMAGE_GENERATION_CONCURRENCY = 3;
