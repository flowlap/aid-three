/** Per-scene clip rendering is CPU-bound (ffmpeg encode), unlike the network-bound image/TTS steps, so this is kept low and separate from IMAGE_GENERATION_CONCURRENCY. */
export const VIDEO_RENDER_CONCURRENCY = 2;
