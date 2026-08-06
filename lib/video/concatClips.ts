import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";

/** Short enough to feel like a page change without obscuring narration. */
export const PAGE_TRANSITION_DURATION_SEC = 0.45;

/**
 * A single ffmpeg process chaining (N-1) xfade filters for N inputs was
 * found to intermittently fail once N grows large enough — reproduced with
 * synthetic clips (fine up to ~250 chained inputs) and, separately, with a
 * real 459-scene project's clips even batched at 30, both times failing with
 * swscaler "Failed initializing scaling graph (Resource temporarily
 * unavailable)" or an outright signal kill mid-encode. The threshold isn't a
 * fixed filter-graph-complexity limit — it moves with whatever else the
 * machine is doing (the 30-batch failure coincided with heavy system-wide
 * memory/thread pressure from unrelated apps). Kept low to leave real
 * margin for a busy dev machine rather than chasing an exact ceiling. Clips
 * are merged in bounded batches, with the batch outputs recursively
 * re-merged the same way, so no single ffmpeg invocation ever chains more
 * than this many crossfades.
 */
export const MAX_CROSSFADE_BATCH = 10;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

/**
 * Builds the ffmpeg filter graph that overlaps every adjacent pair with a
 * fade. Narration tracks are then concatenated without overlap: every scene's
 * audio, including its trailing silent hold, fully completes before the next
 * narration begins.
 *
 * Each xfade shortens the video chain by its overlap duration, so that overlap
 * is padded back immediately (not saved up for one tpad at the end) — a
 * single trailing tpad would only fix the *total* duration while leaving
 * every scene in between increasingly ahead of its audio, since the video
 * chain feeding each subsequent xfade's offset math would still be shrunk by
 * every prior transition. Restoring the chain to full length after each step
 * keeps every transition anchored to the real (audio) timeline regardless of
 * how many transitions preceded it.
 */
export function buildTransitionFilter(durations: number[], transitionDuration = PAGE_TRANSITION_DURATION_SEC): string {
  if (durations.length < 2) return "";

  let videoInput = "[0:v]";
  let cumulative = durations[0];
  const filters: string[] = [];

  for (let index = 1; index < durations.length; index += 1) {
    const duration = Math.min(transitionDuration, cumulative / 2, durations[index] / 2);
    const offset = Math.max(0, cumulative - duration);
    const isLast = index === durations.length - 1;
    const xfadeOutput = isLast ? "[xvout]" : `[x${index}]`;
    const videoOutput = isLast ? "[vout]" : `[v${index}]`;
    filters.push(`${videoInput}[${index}:v]xfade=transition=fade:duration=${duration.toFixed(3)}:offset=${offset.toFixed(3)}${xfadeOutput}`);
    filters.push(`${xfadeOutput}tpad=stop_mode=clone:stop_duration=${duration.toFixed(3)}${videoOutput}`);
    videoInput = videoOutput;
    cumulative += durations[index];
  }

  filters.push(`${durations.map((_, index) => `[${index}:a]`).join("")}concat=n=${durations.length}:v=0:a=1[aout]`);

  return filters.join(";");
}

interface Clip {
  path: string;
  duration: number;
}

/**
 * Merges a single bounded batch of clips (at most MAX_CROSSFADE_BATCH) with
 * one ffmpeg process — the same crossfade approach the whole export used to
 * run in one shot for every scene. Safe to call directly at this size; see
 * MAX_CROSSFADE_BATCH for why larger batches aren't.
 */
async function mergeBatch(clips: Clip[], outputPath: string, signal?: AbortSignal): Promise<void> {
  if (clips.length === 1) {
    await runFfmpeg(["-y", "-i", clips[0].path, "-c", "copy", outputPath], signal);
    return;
  }

  const filter = buildTransitionFilter(clips.map((clip) => clip.duration));
  const inputs = clips.flatMap((clip) => ["-i", clip.path]);
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

/**
 * Joins per-scene clips in order, applying a short fade only after the
 * narration's trailing silent hold. The clips are re-encoded because ffmpeg's
 * transition filters cannot be stream-copied.
 *
 * Merges happen in batches of at most MAX_CROSSFADE_BATCH (see there for
 * why) — the batch outputs become the next level's clips, re-merged the same
 * way, until one file remains. A batch clip's duration for the purposes of
 * the next level's crossfade-offset math is just the sum of its constituent
 * clips' durations: buildTransitionFilter pads each transition's overlap
 * back immediately, so a merged clip's total length always matches its
 * non-overlapping audio track exactly, regardless of how many times it's
 * been re-merged.
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

  let clips: Clip[] = clipPaths.map((clipPath, index) => ({ path: clipPath, duration: durations[index] }));
  const tmpDir = `${outputPath}.batch-tmp`;

  try {
    let level = 0;
    while (clips.length > MAX_CROSSFADE_BATCH) {
      await fs.mkdir(tmpDir, { recursive: true });
      const batches = chunk(clips, MAX_CROSSFADE_BATCH);
      const nextClips: Clip[] = [];
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchOutputPath = path.join(tmpDir, `level${level}-batch${i}.mp4`);
        await mergeBatch(batch, batchOutputPath, signal);
        nextClips.push({ path: batchOutputPath, duration: batch.reduce((sum, clip) => sum + clip.duration, 0) });
      }
      clips = nextClips;
      level += 1;
    }
    await mergeBatch(clips, outputPath, signal);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
