import type { CameraMotion } from "@/lib/pipeline/sequenceTypes";
import type { FrameDimensions } from "./frameDimensions";

export interface SourceDimensions {
  width: number;
  height: number;
}

/**
 * Below this many pixels of available slide range, a pan reads as
 * imperceptible (or, worse, risks a near-zero-width crop expression) —
 * small enough to only reject genuinely flat aspect-ratio matches, not
 * legitimately mild pans.
 */
export const MIN_PAN_SLACK_PX = 24;

/**
 * Push-in shrinks (and pull-out grows) the crop window between 100% and this
 * fraction of the source's full size.
 */
const ZOOM_RATIO = 0.18;

/** Formats a number for an ffmpeg filter expression without scientific notation or trailing zeros. */
function formatNum(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * The exact static scale/pad filter buildVideoClip.ts already applies to
 * every scene frame today. Exported so both the plain (non-sequence) path
 * and the sequence-mode "no motion / fell back to static" path use the
 * identical literal instead of two copies drifting apart.
 */
export function buildStaticScaleFilter(output: FrameDimensions): string {
  return `scale=${output.width}:${output.height}:force_original_aspect_ratio=decrease,pad=${output.width}:${output.height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
}

/** `t` clamped to [0, clipDurationSec], then normalized to a 0..1 progress fraction. */
function progressExpr(clipDurationSec: number): string {
  return `(min(max(t,0),${formatNum(clipDurationSec)})/${formatNum(clipDurationSec)})`;
}

/**
 * The largest crop window matching the OUTPUT's aspect ratio that fits
 * inside the source (a "cover" fit) — used as the base window for every
 * motion so the trailing `scale=${output.width}:${output.height}` never has
 * to stretch a mismatched-aspect crop non-uniformly. Without this, a source
 * whose own aspect ratio differs from the output's (the normal case — it's
 * exactly why buildStaticScaleFilter needs force_original_aspect_ratio +
 * pad) would get visibly squashed/stretched for the whole clip.
 */
function fitOutputAspectCrop(source: SourceDimensions, output: FrameDimensions): { width: number; height: number } {
  const outAspect = output.width / output.height;
  const width = Math.min(source.width, source.height * outAspect);
  const height = width / outAspect;
  return { width, height };
}

function cropFilter(w: string, h: string, x: string, y: string, output: FrameDimensions): string {
  // eval=frame is required: crop's x/y/w/h expressions default to
  // evaluating once at filter init (eval=init) and would otherwise freeze
  // at their t=0 value for the whole clip -- silently reproducing the exact
  // "frozen crop" bug this module exists to avoid.
  return `crop=w=${w}:h=${h}:x=${x}:y=${y}:eval=frame,scale=${output.width}:${output.height},setsar=1`;
}

/**
 * Builds a pure, stateless (no zoompan-style per-frame accumulator) ffmpeg
 * `-vf` fragment for a gentle pan/zoom over a static source image, or `null`
 * when the requested motion can't be meaningfully/safely applied -- callers
 * should fall back to buildStaticScaleFilter() in that case rather than
 * fail the render.
 */
export function buildMotionFilter(
  motion: CameraMotion,
  source: SourceDimensions,
  output: FrameDimensions,
  clipDurationSec: number
): string | null {
  if (source.width <= 0 || source.height <= 0) return null;
  if (!Number.isFinite(clipDurationSec) || clipDurationSec <= 0) return null;

  switch (motion) {
    case "static":
      return null;

    case "slow-push-in":
    case "slow-pull-out": {
      // Start from the same output-aspect-matched base window pan-left/
      // pan-right/follow-flow use below (fitOutputAspectCrop), NOT in_w/in_h
      // directly -- otherwise the crop window's aspect ratio would always
      // equal the SOURCE's own aspect ratio, and the trailing scale to
      // output dimensions would non-uniformly stretch/squash it whenever
      // the source and output aspect ratios differ (the normal case).
      const base = fitOutputAspectCrop(source, output);
      // progress' = 1 - progress for pull-out, so it starts at 82% and
      // grows back to 100% -- the exact mirror of push-in's shrink. Both
      // w and h are scaled by this identical factor, so the crop window's
      // aspect ratio (== the output's, by construction of `base`) stays
      // constant for the whole animation.
      const progress = motion === "slow-push-in" ? progressExpr(clipDurationSec) : `(1-${progressExpr(clipDurationSec)})`;
      const zoomFactor = `(1-${ZOOM_RATIO}*${progress})`;
      const w = `(${formatNum(base.width)}*${zoomFactor})`;
      const h = `(${formatNum(base.height)}*${zoomFactor})`;
      const x = `((in_w-${w})/2)`;
      const y = `((in_h-${h})/2)`;
      // The crop window is always <=100% of the source by construction
      // (base is itself a cover-fit crop, and it's only ever shrunk further
      // from there), so this is always geometrically valid -- push-in/
      // pull-out never fall back to static for lack of room, unlike the pan
      // motions below.
      return cropFilter(w, h, x, y, output);
    }

    case "pan-left":
    case "pan-right":
    case "follow-flow": {
      const { width: cropW, height: cropH } = fitOutputAspectCrop(source, output);
      const slackX = source.width - cropW;
      const slackY = source.height - cropH;
      const progress = progressExpr(clipDurationSec);

      if (motion === "follow-flow") {
        // No start/end crop-origin hint exists in SequenceCameraPlanEntry
        // (intentionally, per the data model), so follow-flow always
        // defaults to a diagonal sweep across whichever axis/axes have
        // room -- only needs ONE axis with meaningful slack.
        if (slackX < MIN_PAN_SLACK_PX && slackY < MIN_PAN_SLACK_PX) return null;
        const x = `(${formatNum(slackX)}*${progress})`;
        const y = `(${formatNum(slackY)}*${progress})`;
        return cropFilter(formatNum(cropW), formatNum(cropH), x, y, output);
      }

      if (slackX < MIN_PAN_SLACK_PX) return null;
      const x =
        motion === "pan-right" ? `(${formatNum(slackX)}*${progress})` : `(${formatNum(slackX)}*(1-${progress}))`;
      const y = formatNum((source.height - cropH) / 2);
      return cropFilter(formatNum(cropW), formatNum(cropH), x, y, output);
    }

    default:
      // Defensive: TypeScript's CameraMotion union should prevent this.
      return null;
  }
}
