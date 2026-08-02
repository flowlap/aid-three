import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";

/**
 * Encodes one scene's static frame + narration audio into a fixed 1920x1080,
 * H.264/AAC mp4 clip held for exactly the audio's length (no pan/zoom —
 * see docs/reference plan notes on avoiding ffmpeg's fragile zoompan filter).
 * All clips share this exact codec/resolution/fps, which is what lets
 * concatClips join them with a fast stream copy later.
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
      "-shortest",
      "-vf", "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p",
      "-movflags", "+faststart",
      outputPath,
    ],
    signal
  );
}
