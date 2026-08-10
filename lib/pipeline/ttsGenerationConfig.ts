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

/**
 * Qwen3-TTS-CustomVoice infers emotion/prosody from each call's text content
 * when no `instruct` is given — since every scene is synthesized as an
 * independent call with no cross-scene continuity, this made narration tone
 * swing scene-to-scene (sad, upbeat, ...) depending on what that scene's text
 * happened to say. Passing a fixed instruct on every call overrides that
 * per-text inference so the whole narration stays one consistent tone.
 */
export const TTS_DEFAULT_INSTRUCT = "차분하고 담담한 내레이션 톤으로, 문장 내용과 상관없이 감정 기복 없이 일정하게 말해주세요.";
