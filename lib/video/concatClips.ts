import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";

/** Short enough to feel like a page change without obscuring narration. */
export const PAGE_TRANSITION_DURATION_SEC = 0.45;

/**
 * Builds the ffmpeg filter graph that overlaps every adjacent pair with a
 * fade. Narration tracks are then concatenated without overlap: every scene's
 * audio, including its trailing silent hold, fully completes before the next
 * narration begins.
 */
export function buildTransitionFilter(durations: number[], transitionDuration = PAGE_TRANSITION_DURATION_SEC): string {
  if (durations.length < 2) return "";

  let videoInput = "[0:v]";
  let elapsed = durations[0];
  let totalOverlap = 0;
  const filters: string[] = [];

  for (let index = 1; index < durations.length; index += 1) {
    const duration = Math.min(transitionDuration, elapsed / 2, durations[index] / 2);
    const offset = Math.max(0, elapsed - duration);
    const videoOutput = `[v${index}]`;
    filters.push(`${videoInput}[${index}:v]xfade=transition=fade:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${videoOutput}`);
    videoInput = videoOutput;
    elapsed += durations[index] - duration;
    totalOverlap += duration;
  }

  // xfade overlaps the video streams. Pad its end by the same total overlap
  // so it remains aligned with the non-overlapping audio timeline.
  filters.push(`${videoInput}tpad=stop_mode=clone:stop_duration=${totalOverlap.toFixed(3)}[vout]`);
  filters.push(`${durations.map((_, index) => `[${index}:a]`).join("")}concat=n=${durations.length}:v=0:a=1[aout]`);

  return filters.join(";");
}

/**
 * Joins per-scene clips in order, applying a short fade only after the
 * narration's trailing silent hold. The clips are re-encoded once here because ffmpeg's
 * transition filters cannot be stream-copied.
 */
export async function concatClips(
  clipPaths: string[],
  durations: number[],
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("연결할 클립이 없습니다");
  if (clipPaths.length !== durations.length || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error("동영상 전환에 필요한 씬 길이 정보가 올바르지 않습니다");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  if (clipPaths.length === 1) {
    await runFfmpeg(["-y", "-i", clipPaths[0], "-c", "copy", outputPath], signal);
    return;
  }

  const filter = buildTransitionFilter(durations);
  const inputs = clipPaths.flatMap((clipPath) => ["-i", clipPath]);
  const lastIndex = clipPaths.length - 1;
  await runFfmpeg(
    [
      "-y",
      ...inputs,
      "-filter_complex", filter,
      "-map", "[vout]",
      "-map", "[aout]",
      "-c:v", "libx264",
      "-pix_fmt", "yuv420p",
      "-c:a", "aac",
      "-b:a", "192k",
      "-movflags", "+faststart",
      outputPath,
    ],
    signal
  );
}
