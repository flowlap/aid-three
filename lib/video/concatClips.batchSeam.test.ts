import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import os from "os";
import path from "path";
import { promises as fs } from "fs";

/**
 * Regression test for a real bug: concatClips's batching loop used to slice
 * a per-pair transitionDurations array per-batch for INTERNAL merges only,
 * silently dropping the value at the boundary connecting one batch's last
 * clip to the next batch's first clip — that seam always fell back to the
 * plain uniform default instead of the caller's real requested value (e.g.
 * a hard cut mid-sequence). A duration-only assertion (as in the "real
 * ffmpeg" batching test elsewhere in this file) can't catch this, since a
 * wrong transition TYPE doesn't change the total output duration. This test
 * mocks runFfmpeg to inspect the actual -filter_complex string built for
 * the merge that spans a batch seam, without needing real ffmpeg.
 */
const runFfmpegMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/media/ffmpeg", () => ({ runFfmpeg: (...args: unknown[]) => runFfmpegMock(...(args as [string[], AbortSignal | undefined])) }));

import { concatClips, MAX_CROSSFADE_BATCH, PAGE_TRANSITION_DURATION_SEC, SEQUENCE_HARD_CUT_DURATION_SEC } from "./concatClips";

describe("concatClips batch-seam transition threading (mocked ffmpeg)", () => {
  const tmpRoot = path.join(os.tmpdir(), `concat-clips-seam-test-${process.pid}`);

  beforeEach(() => {
    runFfmpegMock.mockClear();
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("carries the real per-pair value at a batch seam through to the merge that spans it, instead of defaulting", async () => {
    const clipCount = MAX_CROSSFADE_BATCH + 5; // 15 -> level-0 batches of [10, 5]
    const clipPaths = Array.from({ length: clipCount }, (_, i) => path.join(tmpRoot, `clip-${i}.mp4`));
    const durations = clipPaths.map(() => 5); // uniform and large so clamping never masks the requested value
    const seamIndex = MAX_CROSSFADE_BATCH - 1; // boundary between clip 9 and clip 10 -- the real inter-batch seam
    const seamDuration = 0.123;
    const transitionDurations = durations
      .slice(1)
      .map((_, index) => (index === seamIndex ? seamDuration : SEQUENCE_HARD_CUT_DURATION_SEC));

    const outputPath = path.join(tmpRoot, "seam-out.mp4");
    await concatClips(clipPaths, durations, outputPath, undefined, transitionDurations);

    // The final merge (over the two level-0 batch outputs) is the one call
    // whose output is the overall outputPath.
    const finalCall = runFfmpegMock.mock.calls.find((call) => (call[0] as string[]).includes(outputPath));
    expect(finalCall).toBeTruthy();
    const args = finalCall![0] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];

    expect(filter).toContain(`duration=${seamDuration.toFixed(3)}`);
    expect(filter).not.toContain(`duration=${PAGE_TRANSITION_DURATION_SEC.toFixed(3)}`);
  });

  it("still falls back to the uniform default when no transitionDurations array is given, batching or not", async () => {
    const clipCount = MAX_CROSSFADE_BATCH + 5;
    const clipPaths = Array.from({ length: clipCount }, (_, i) => path.join(tmpRoot, `clip-plain-${i}.mp4`));
    const durations = clipPaths.map(() => 5);

    const outputPath = path.join(tmpRoot, "plain-out.mp4");
    await concatClips(clipPaths, durations, outputPath);

    const finalCall = runFfmpegMock.mock.calls.find((call) => (call[0] as string[]).includes(outputPath));
    expect(finalCall).toBeTruthy();
    const args = finalCall![0] as string[];
    const filter = args[args.indexOf("-filter_complex") + 1];
    expect(filter).toContain(`duration=${PAGE_TRANSITION_DURATION_SEC.toFixed(3)}`);
  });
});
