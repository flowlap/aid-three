import { describe, it, expect } from "vitest";
import { buildMotionFilter, buildStaticScaleFilter, MIN_PAN_SLACK_PX, type SourceDimensions } from "./motionFilter";
import type { CameraMotion } from "@/lib/pipeline/sequenceTypes";
import type { FrameDimensions } from "./frameDimensions";

const OUTPUT: FrameDimensions = { width: 1920, height: 1280 }; // 3:2

// Matches the output's 3:2 aspect ratio exactly -> zero pan slack.
const MATCHING_SOURCE: SourceDimensions = { width: 1920, height: 1280 };

// Wider than the output aspect ratio -> plenty of horizontal slack to pan across.
const WIDE_SOURCE: SourceDimensions = { width: 3840, height: 1280 };

const ALL_MOTIONS: CameraMotion[] = [
  "static",
  "slow-push-in",
  "slow-pull-out",
  "pan-left",
  "pan-right",
  "follow-flow",
];

function parseCropParams(filter: string): Record<string, string> {
  // Expressions use ffmpeg's min()/max() functions, which contain commas --
  // so the crop segment can't be isolated with a naive split(","); it must
  // be matched up to the literal ",scale=" that always follows it.
  const match = filter.match(/^crop=(.*),scale=/);
  if (!match) throw new Error(`no crop segment found in filter: ${filter}`);
  const params: Record<string, string> = {};
  for (const part of match[1].split(":")) {
    const eqIndex = part.indexOf("=");
    params[part.slice(0, eqIndex)] = part.slice(eqIndex + 1);
  }
  return params;
}

describe("buildStaticScaleFilter", () => {
  it("matches the literal filter string buildVideoClip.ts uses today", () => {
    // Copied verbatim from lib/video/buildVideoClip.ts so any future drift
    // between the two is caught by this test.
    const width = 1920;
    const height = 1280;
    const expected = `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,format=yuv420p`;
    expect(buildStaticScaleFilter({ width, height })).toBe(expected);
  });
});

describe("buildMotionFilter", () => {
  it("returns null for static (caller falls back to the static filter)", () => {
    expect(buildMotionFilter("static", WIDE_SOURCE, OUTPUT, 5)).toBeNull();
  });

  it("returns null for every motion when the source has a zero or negative dimension", () => {
    for (const motion of ALL_MOTIONS) {
      expect(buildMotionFilter(motion, { width: 0, height: 1080 }, OUTPUT, 5)).toBeNull();
      expect(buildMotionFilter(motion, { width: 1920, height: 0 }, OUTPUT, 5)).toBeNull();
      expect(buildMotionFilter(motion, { width: -100, height: 1080 }, OUTPUT, 5)).toBeNull();
      expect(buildMotionFilter(motion, { width: 1920, height: -1 }, OUTPUT, 5)).toBeNull();
    }
  });

  it("produces a crop+scale filter with eval=frame for every non-static motion (with enough slack)", () => {
    const motions: CameraMotion[] = ["slow-push-in", "slow-pull-out", "pan-left", "pan-right", "follow-flow"];
    for (const motion of motions) {
      const filter = buildMotionFilter(motion, WIDE_SOURCE, OUTPUT, 5);
      expect(filter).not.toBeNull();
      expect(filter).toContain("crop=");
      expect(filter).toContain("eval=frame");
      expect(filter).toContain(`scale=${OUTPUT.width}:${OUTPUT.height}`);
    }
  });

  it("push-in and pull-out produce mirrored but different crop expressions", () => {
    const pushIn = buildMotionFilter("slow-push-in", WIDE_SOURCE, OUTPUT, 5);
    const pullOut = buildMotionFilter("slow-pull-out", WIDE_SOURCE, OUTPUT, 5);
    expect(pushIn).not.toBeNull();
    expect(pullOut).not.toBeNull();
    expect(pushIn).not.toEqual(pullOut);

    const pushParams = parseCropParams(pushIn!);
    const pullParams = parseCropParams(pullOut!);
    // Both re-center within the source (via in_w/in_h) and shrink towards
    // 82% of the same base window, but from opposite ends of progress.
    expect(pushParams.x).toContain("in_w");
    expect(pullParams.x).toContain("in_w");
    expect(pushParams.w).not.toBe(pullParams.w);
  });

  it("push-in/pull-out never fall back to static, even with zero pan slack", () => {
    expect(buildMotionFilter("slow-push-in", MATCHING_SOURCE, OUTPUT, 5)).not.toBeNull();
    expect(buildMotionFilter("slow-pull-out", MATCHING_SOURCE, OUTPUT, 5)).not.toBeNull();
  });

  /**
   * Regression test for a real bug: push-in/pull-out used to scale in_w/in_h
   * directly, so the crop window's aspect ratio always equaled the SOURCE's
   * own aspect ratio -- when that differs from the output's (the normal
   * case; it's exactly why buildStaticScaleFilter needs
   * force_original_aspect_ratio + pad), the trailing
   * scale=${output.width}:${output.height} would stretch/squash the image
   * non-uniformly for the whole clip. Evaluates the actual w/h ffmpeg
   * expressions (substituting in_w/in_h/t) at both t=0 and t=clipDurationSec
   * against a deliberately non-aspect-matched source.
   */
  it("keeps the push-in/pull-out crop window at the output's aspect ratio (not the source's) at both the start and end of the animation", () => {
    const clipDurationSec = 5;
    const outAspect = OUTPUT.width / OUTPUT.height;

    function evalExpr(expr: string, t: number): number {
      const jsExpr = expr
        .replace(/\bmin\(/g, "Math.min(")
        .replace(/\bmax\(/g, "Math.max(")
        .replace(/\bin_w\b/g, String(WIDE_SOURCE.width))
        .replace(/\bin_h\b/g, String(WIDE_SOURCE.height))
        .replace(/\bt\b/g, String(t));
      // Evaluating our own generated ffmpeg-expression string in a test, not user input.
      return new Function(`return (${jsExpr});`)() as number;
    }

    for (const motion of ["slow-push-in", "slow-pull-out"] as const) {
      const filter = buildMotionFilter(motion, WIDE_SOURCE, OUTPUT, clipDurationSec)!;
      expect(filter).not.toBeNull();
      const params = parseCropParams(filter);

      for (const t of [0, clipDurationSec]) {
        const w = evalExpr(params.w, t);
        const h = evalExpr(params.h, t);
        expect(w / h).toBeCloseTo(outAspect, 6);
        expect(w).toBeLessThanOrEqual(WIDE_SOURCE.width + 1e-6);
        expect(h).toBeLessThanOrEqual(WIDE_SOURCE.height + 1e-6);
      }
    }
  });

  it("pan-left and pan-right slide the crop window in opposite directions", () => {
    const left = buildMotionFilter("pan-left", WIDE_SOURCE, OUTPUT, 5);
    const right = buildMotionFilter("pan-right", WIDE_SOURCE, OUTPUT, 5);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left).not.toEqual(right);

    const leftParams = parseCropParams(left!);
    const rightParams = parseCropParams(right!);
    // pan-right grows from 0 towards slack; pan-left shrinks from slack towards 0
    // (implemented as slack*(1-progress)) -- so only pan-left's x expression
    // contains the "1-" term.
    expect(rightParams.x).not.toContain("1-");
    expect(leftParams.x).toContain("1-");
    // The crop window itself (fixed size) should be identical between the two.
    expect(leftParams.w).toBe(rightParams.w);
    expect(leftParams.h).toBe(rightParams.h);
    // y is constant (vertically centered) for pan-left/pan-right.
    expect(leftParams.y).not.toMatch(/\bt\b/);
    expect(rightParams.y).not.toMatch(/\bt\b/);
  });

  it("follow-flow moves both the x and y axes", () => {
    const filter = buildMotionFilter("follow-flow", WIDE_SOURCE, OUTPUT, 5);
    expect(filter).not.toBeNull();
    const params = parseCropParams(filter!);
    expect(params.x).toMatch(/\bt\b/);
    expect(params.y).toMatch(/\bt\b/);
  });

  it("falls back to null for pan-left/pan-right/follow-flow when the source has no pan slack, but not for push-in/pull-out", () => {
    expect(buildMotionFilter("pan-left", MATCHING_SOURCE, OUTPUT, 5)).toBeNull();
    expect(buildMotionFilter("pan-right", MATCHING_SOURCE, OUTPUT, 5)).toBeNull();
    expect(buildMotionFilter("follow-flow", MATCHING_SOURCE, OUTPUT, 5)).toBeNull();
    expect(buildMotionFilter("slow-push-in", MATCHING_SOURCE, OUTPUT, 5)).not.toBeNull();
    expect(buildMotionFilter("slow-pull-out", MATCHING_SOURCE, OUTPUT, 5)).not.toBeNull();
  });

  it("falls back to null just below the MIN_PAN_SLACK_PX threshold", () => {
    // Output aspect ratio 1920:1280 = 1.5. Construct a source whose available
    // horizontal slack is just under the threshold.
    const cropH = 1280;
    const cropW = cropH * (OUTPUT.width / OUTPUT.height); // = source height case, cropW == source width when no slack
    const source: SourceDimensions = { width: Math.round(cropW + MIN_PAN_SLACK_PX - 1), height: cropH };
    expect(buildMotionFilter("pan-left", source, OUTPUT, 5)).toBeNull();
  });

  it("returns null for an unrecognized motion value (defensive default case)", () => {
    expect(buildMotionFilter("bogus-motion" as CameraMotion, WIDE_SOURCE, OUTPUT, 5)).toBeNull();
  });
});
