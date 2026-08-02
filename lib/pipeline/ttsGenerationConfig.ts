/**
 * TTS runs as one Python process per job (the model is loaded once and reused
 * across scenes — see docs/reference/local-tts.md), so this isn't a
 * per-request concurrency cap like IMAGE_GENERATION_CONCURRENCY; it's kept
 * here for symmetry with that config and in case a future revision wants to
 * run multiple independent TTS processes in parallel.
 */
export const TTS_GENERATION_CONCURRENCY = 1;

export const TTS_DEFAULT_VOICE = "Sohee";
export const TTS_DEFAULT_LANG_CODE = "Korean";
