import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";
import type { CropRect } from "./motionFilter";
import type { FrameDimensions } from "./frameDimensions";

export interface ComposeSequenceStillOptions {
  /** Path to the sequence master PNG (the shared background plate). */
  masterPath: string;
  /** Path to a transparent overlay PNG (renderSequenceOverlayToPng output), or null when the scene has no overlays. */
  overlayPath: string | null;
  /** The t=0 crop of the master to use as the still frame, or null to fit the whole master into frame (static / insufficient-slack). */
  cropRect: CropRect | null;
  /** Output frame size. */
  output: FrameDimensions;
  /** Where to write the composited PNG. */
  outputPath: string;
  signal?: AbortSignal;
}

/**
 * Bakes a single still PNG = the sequence master image (cropped to `cropRect`
 * and scaled to `output`, or fit-with-pad when `cropRect` is null) with an
 * optional transparent overlay layer composited on top. This is the still
 * counterpart of buildSequenceVideoClip's motion+overlay pipeline: it renders
 * the exact frame a motion clip STARTS on (see startCropRect) so screen-design/
 * mockup/preview show what the video begins with, without an image-model call.
 *
 * Numeric crop values (unlike buildMotionFilter's time-varying expressions)
 * carry no commas, so there's no filtergraph comma-escaping or per-frame `eval`
 * concern here.
 */
export async function composeSequenceStill(opts: ComposeSequenceStillOptions): Promise<void> {
  const { masterPath, overlayPath, cropRect, output, outputPath, signal } = opts;
  await fs.mkdir(path.dirname(outputPath), { recursive: true });

  // Base: either a numeric crop+scale (matches the video clip's first frame)
  // or a fit-with-pad when there's no motion crop — the same "cover, don't
  // stretch" behaviour buildStaticScaleFilter uses, minus its video-only
  // format=yuv420p (a still PNG stays RGB, and keeping it RGB composites the
  // transparent overlay cleanly).
  const base = cropRect
    ? `crop=${Math.round(cropRect.width)}:${Math.round(cropRect.height)}:${Math.round(cropRect.x)}:${Math.round(cropRect.y)},scale=${output.width}:${output.height},setsar=1`
    : `scale=${output.width}:${output.height}:force_original_aspect_ratio=decrease,pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2,setsar=1`;

  const args = ["-y", "-i", masterPath];
  if (overlayPath) args.push("-i", overlayPath);

  if (overlayPath) {
    args.push("-filter_complex", `[0:v]${base}[b];[b][1:v]overlay=0:0:format=auto[vout]`, "-map", "[vout]");
  } else {
    args.push("-vf", base);
  }

  args.push("-frames:v", "1", "-update", "1", outputPath);

  await runFfmpeg(args, signal);
}
