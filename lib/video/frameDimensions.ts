import type { ImageAspectRatio } from "@/lib/pipeline/imageAspectRatio";

export interface FrameDimensions {
  width: number;
  height: number;
}

/** Long-side target — matches the previous hardcoded FRAME_WIDTH so a 3:2 project renders at the exact same 1920x1280 as before this feature existed. */
const TARGET_WIDTH = 1920;

/**
 * Scales a detected image aspect ratio to a concrete render resolution for
 * the video frame renderer/ffmpeg encoder. Keeps width fixed at
 * TARGET_WIDTH and derives height from the ratio, rounded to the nearest
 * even number — libx264's yuv420p pixel format requires even dimensions.
 */
export function computeFrameDimensions(ratio: ImageAspectRatio): FrameDimensions {
  const rawHeight = TARGET_WIDTH * (ratio.height / ratio.width);
  const height = Math.max(2, Math.round(rawHeight / 2) * 2);
  return { width: TARGET_WIDTH, height };
}
