import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";

/** Short enough to feel like a page change without obscuring narration. */
export const PAGE_TRANSITION_DURATION_SEC = 0.45;

/**
 * Builds the ffmpeg filter graph that overlaps every adjacent pair with a
 * fade. `xfade` needs an offset in the already-joined timeline, whereas
 * `acrossfade` advances implicitly, so both paths are kept in lockstep.
 */
export function buildTransitionFilter(durations: number[], transitionDuration = PAGE_TRANSITION_DURATION_SEC): string {
  if (durations.length < 2) return "";

  let videoInput = "[0:v]";
  let audioInput = "[0:a]";
  let elapsed = durations[0];
  const filters: string[] = [];

  for (let index = 1; index < durations.length; index += 1) {
    const duration = Math.min(transitionDuration, elapsed / 2, durations[index] / 2);
    const offset = Math.max(0, elapsed - duration);
    const videoOutput = `[v${index}]`;
    const audioOutput = `[a${index}]`;
    filters.push(`${videoInput}[${index}:v]xfade=transition=fade:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${videoOutput}`);
    filters.push(`${audioInput}[${index}:a]acrossfade=d=${duration.toFixed(3)}:c1=tri:c2=tri${audioOutput}`);
    videoInput = videoOutput;
    audioInput = audioOutput;
    elapsed += durations[index] - duration;
  }

  return filters.join(";");
}

/**
 * Joins per-scene clips in order, applying a short fade and audio crossfade at
 * every page boundary. The clips are re-encoded once here because ffmpeg's
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
      "-map", `[v${lastIndex}]`,
      "-map", `[a${lastIndex}]`,
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
