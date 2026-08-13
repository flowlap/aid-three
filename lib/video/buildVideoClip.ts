import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";
import type { FrameDimensions } from "./frameDimensions";

/** Silence after each narration before the visual moves to the next scene. */
export const SCENE_BREAK_HOLD_SEC = 0.65;

/**
 * Encodes one scene's static frame + narration audio into an H.264/AAC mp4
 * clip at the given dimensions (see computeFrameDimensions — scaled to
 * whatever aspect ratio this project's images actually generated at). A
 * short silent hold is appended after narration, so a scene can never
 * change before its voiceover has finished (no pan/zoom — see
 * docs/reference plan notes on avoiding ffmpeg's fragile zoompan filter).
 * All clips of one project share this exact codec/resolution/fps.
 *
 * `clipDurationSec` (narration + SCENE_BREAK_HOLD_SEC, computed by the
 * caller from the real WAV file) is passed as an explicit `-t` cutoff
 * instead of relying on `-shortest` to detect where the padded audio ends:
 * `-shortest` was found to race with x264's B-frame lookahead buffer on a
 * `-loop 1` still-image input, occasionally muxing a couple of GOPs' worth
 * of extra video after the audio has already ended (confirmed by re-running
 * an identical real-project ffmpeg invocation multiple times and observing
 * a different frame count each time). `-t` truncates the output at a fixed
 * PTS regardless of encoder buffering, which is deterministic.
 *
 * This is scene mode's only clip builder and stays byte-for-byte unchanged.
 * Sequence mode's motion/overlay rendering (crop+scale via lib/video/
 * motionFilter.ts, not zoompan — the fragility this comment warns about is
 * still avoided) is implemented as the separate buildSequenceVideoClip below
 * instead of parameterizing this function, so this path can never regress.
 */
export async function buildVideoClip(
  framePath: string,
  audioPath: string,
  outputPath: string,
  { width, height }: FrameDimensions,
  clipDurationSec: number,
  signal?: AbortSignal
): Promise<void> {
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
      "-t", String(clipDurationSec),
      "-vf", `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`,
      "-movflags", "+faststart",
      outputPath,
    ],
    signal
  );
}

/**
 * Sequence-mode sibling of buildVideoClip: same base invocation shape (loop
 * the frame, mux with narration audio, apad + an explicit `-t` cutoff so a
 * scene never advances before its narration finishes — see buildVideoClip's
 * doc comment for why `-t` is used instead of `-shortest`), but takes the
 * `-vf` filter as a parameter — callers pass buildMotionFilter(...)'s result
 * when non-null, or buildStaticScaleFilter(...) as the fallback (see
 * lib/video/motionFilter.ts) — and can additionally composite a transparent
 * overlay PNG (labels/arrows/highlights/diagrams/charts, see
 * renderSequenceFrameToPng.ts) on top of the motion-filtered base via a
 * third looped input and `-filter_complex`.
 */
export async function buildSequenceVideoClip(
  framePath: string,
  audioPath: string,
  outputPath: string,
  vf: string,
  overlayPath: string | null,
  clipDurationSec: number,
  signal?: AbortSignal
): Promise<void> {
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  const args = [
    "-y",
    "-loop", "1",
    "-framerate", "30",
    "-i", framePath,
    "-i", audioPath,
  ];

  if (overlayPath) {
    args.push("-loop", "1", "-framerate", "30", "-i", overlayPath);
  }

  args.push(
    "-c:v", "libx264",
    "-tune", "stillimage",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-af", `apad=pad_dur=${SCENE_BREAK_HOLD_SEC}`,
    "-t", String(clipDurationSec)
  );

  if (overlayPath) {
    args.push(
      "-filter_complex", `[0:v]${vf}[base];[base][2:v]overlay=0:0:format=auto[vout]`,
      "-map", "[vout]",
      "-map", "1:a"
    );
  } else {
    args.push("-vf", vf);
  }

  args.push("-movflags", "+faststart", outputPath);

  await runFfmpeg(args, signal);
}
