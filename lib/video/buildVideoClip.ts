import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";

/** Silence after each narration before the visual moves to the next scene. */
export const SCENE_BREAK_HOLD_SEC = 0.65;

/**
 * Encodes one scene's static frame + narration audio into a fixed 1920x1280,
 * H.264/AAC mp4 clip. A short silent hold is appended after narration, so a
 * scene can never change before its voiceover has finished (no pan/zoom —
 * see docs/reference plan notes on avoiding ffmpeg's fragile zoompan filter).
 * All clips share this exact codec/resolution/fps.
 */
export async function buildVideoClip(framePath: string, audioPath: string, outputPath: string, signal?: AbortSignal): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await runFfmpeg(
    [
      "-y",
      "-loop", "1",
      "-framerate", "30",
      "-i", framePath,
      "-i", audioPath,
      "-c:v", "libx264",
      "-tune", "stillimage",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-af", `apad=pad_dur=${SCENE_BREAK_HOLD_SEC}`,
      "-shortest",
      "-vf", "scale=1920:1280:force_original_aspect_ratio=decrease,pad=1920:1280:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ],
    signal
  );
}
