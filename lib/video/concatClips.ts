import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";

/** Short enough to feel like a page change without obscuring narration. */
export const PAGE_TRANSITION_DURATION_SEC = 0.45;

/**
 * Near-instant hard cut used at scene boundaries WITHIN the same sequence in
 * sequence-mode video — scenes inside one sequence should read as
 * continuous, not fading in/out of themselves, while a real
 * PAGE_TRANSITION_DURATION_SEC fade is still used at actual sequence
 * boundaries. Kept just above literal 0 rather than exactly 0 purely to
 * leave a hair of margin against any degenerate edge case in the xfade
 * offset math, even though empirically (see the "per-pair transition
 * durations" real-ffmpeg test in concatClips.test.ts) a literal 0 also
 * produces a perfectly valid clip with the ffmpeg version this repo targets.
 */
export const SEQUENCE_HARD_CUT_DURATION_SEC = 0.05;

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
 *
 * `transitionDuration` is either a single number applied uniformly to every
 * adjacent pair (the original, still fully backward-compatible behavior), or
 * an array of exactly `durations.length - 1` per-pair durations aligned to
 * the same order as `durations` — used by sequence-mode video to fade only
 * at real sequence boundaries and hard-cut everywhere else. Either way, each
 * pair's actual duration is still separately clamped so it never overlaps
 * more than half of either adjacent clip.
 */
export function buildTransitionFilter(
  durations: number[],
  transitionDuration: number | number[] = PAGE_TRANSITION_DURATION_SEC
): string {
  if (durations.length < 2) return "";

  if (Array.isArray(transitionDuration) && transitionDuration.length !== durations.length - 1) {
    throw new Error("전환 길이 배열의 개수가 씬 경계 수와 일치하지 않습니다");
  }

  let videoInput = "[0:v]";
  let cumulative = durations[0];
  const filters: string[] = [];

  for (let index = 1; index < durations.length; index += 1) {
    const requestedDuration = Array.isArray(transitionDuration) ? transitionDuration[index - 1] : transitionDuration;
    const duration = Math.min(requestedDuration, cumulative / 2, durations[index] / 2);
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
 *
 * `transitionDurations`, when given, is a per-pair array aligned to this
 * batch's own clips (length `clips.length - 1`) — see concatClips for how
 * it's threaded level by level. Omitted, it falls back to
 * buildTransitionFilter's own uniform default.
 */
async function mergeBatch(
  clips: Clip[],
  outputPath: string,
  signal?: AbortSignal,
  transitionDurations?: number[]
): Promise<void> {
  if (clips.length === 1) {
    await runFfmpeg(["-y", "-i", clips[0].path, "-c", "copy", outputPath], signal);
    return;
  }

  const filter = buildTransitionFilter(clips.map((clip) => clip.duration), transitionDurations);
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
 *
 * `transitionDurations`, when given, is a per-pair array aligned to the
 * original `clipPaths`/`durations` (length `clipPaths.length - 1`) — e.g.
 * sequence-mode video uses this to fade only at real sequence boundaries and
 * hard-cut everywhere else.
 *
 * Batching never reorders or merges non-adjacent clips, so EVERY boundary at
 * EVERY recursion level — including the boundary between two batch-OUTPUT
 * clips — always corresponds to exactly one real original transition index;
 * none of them are "artificial" in the sense of having no meaningful value.
 * A batch's own internal merge only hides the transitions *strictly inside*
 * it; the one boundary connecting it to the next batch is deferred, not
 * discarded. So `transitionDurations` is threaded level by level: each
 * level's per-pair array is sliced per-batch for that batch's own internal
 * merge, and the single value at each inter-batch seam is carried forward
 * as the corresponding entry of the NEXT level's per-pair array — all the
 * way up to however many recursion levels MAX_CROSSFADE_BATCH ends up
 * requiring for a given clip count, not just the first one. (An earlier
 * version of this function only threaded level 0's values into level 1 and
 * silently dropped every level's inter-batch seam value beyond that,
 * injecting an unwanted default-duration fade in the middle of what should
 * have been a hard cut for any sequence spanning more than
 * MAX_CROSSFADE_BATCH scenes.)
 */
export async function concatClips(
  clipPaths: string[],
  durations: number[],
  outputPath: string,
  signal?: AbortSignal,
  transitionDurations?: number[]
): Promise<void> {
  if (clipPaths.length === 0) throw new Error("연결할 클립이 없습니다");
  if (clipPaths.length !== durations.length || durations.some((duration) => !Number.isFinite(duration) || duration <= 0)) {
    throw new Error("동영상 전환에 필요한 씬 길이 정보가 올바르지 않습니다");
  }
  if (transitionDurations && transitionDurations.length !== clipPaths.length - 1) {
    throw new Error("전환 길이 배열의 개수가 씬 경계 수와 일치하지 않습니다");
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  let clips: Clip[] = clipPaths.map((clipPath, index) => ({ path: clipPath, duration: durations[index] }));
  // Per-boundary transition duration aligned with `clips` at the CURRENT
  // recursion level (undefined when the caller didn't ask for per-pair
  // control at all, preserving the plain-default behavior everywhere).
  let seamDurations: number[] | undefined = transitionDurations;
  const tmpDir = `${outputPath}.batch-tmp`;

  try {
    let level = 0;
    while (clips.length > MAX_CROSSFADE_BATCH) {
      await fs.mkdir(tmpDir, { recursive: true });
      const batches = chunk(clips, MAX_CROSSFADE_BATCH);
      const nextClips: Clip[] = [];
      const nextSeamDurations: number[] | undefined = seamDurations ? [] : undefined;
      let clipOffset = 0;
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const batchOutputPath = path.join(tmpDir, `level${level}-batch${i}.mp4`);
        const batchTransitions = seamDurations?.slice(clipOffset, clipOffset + batch.length - 1);
        await mergeBatch(batch, batchOutputPath, signal, batchTransitions);
        nextClips.push({ path: batchOutputPath, duration: batch.reduce((sum, clip) => sum + clip.duration, 0) });

        // The boundary between this batch's output and the next batch's
        // output is exactly the real original seam at this global index —
        // carry it forward instead of letting it fall in the gap between
        // batches and silently default.
        if (nextSeamDurations && i < batches.length - 1) {
          nextSeamDurations.push(seamDurations![clipOffset + batch.length - 1]);
        }
        clipOffset += batch.length;
      }
      clips = nextClips;
      seamDurations = nextSeamDurations;
      level += 1;
    }
    await mergeBatch(clips, outputPath, signal, seamDurations);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
