import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { execFile } from "child_process";
import { promisify } from "util";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { buildTransitionFilter, concatClips, MAX_CROSSFADE_BATCH } from "./concatClips";

const execFileAsync = promisify(execFile);

describe("buildTransitionFilter", () => {
  it("adds a video fade for every page boundary while keeping audio sequential", () => {
    const filter = buildTransitionFilter([10, 8, 12]);

    expect(filter).toContain("[0:v][1:v]xfade=transition=fade:duration=0.450:offset=9.550[x1]");
    expect(filter).toContain("[x1]tpad=stop_mode=clone:stop_duration=0.450[v1]");
    expect(filter).toContain("[v1][2:v]xfade=transition=fade:duration=0.450:offset=17.550[xvout]");
    expect(filter).toContain("[xvout]tpad=stop_mode=clone:stop_duration=0.450[vout]");
    expect(filter).toContain("[0:a][1:a][2:a]concat=n=3:v=0:a=1[aout]");
  });

  it("shortens the transition for a very short page", () => {
    expect(buildTransitionFilter([0.4, 10])).toContain("duration=0.200:offset=0.200");
  });

  /**
   * Regression test for a real production bug: a single trailing tpad only
   * restored the *total* duration lost to crossfade overlap, leaving every
   * intermediate scene boundary increasingly ahead of its audio the more
   * transitions preceded it (offset math for transition k used to be based
   * on a video chain still shrunk by all k-1 prior overlaps). Confirmed via
   * a synthetic 6-clip repro with real ffmpeg: drift grew ~0.45s per prior
   * transition, up to ~200s for a 459-scene project. Each transition must
   * land at the same fixed offset before its clip's true (audio) boundary,
   * regardless of how many transitions came before it.
   */
  it("keeps every transition anchored to its true boundary regardless of prior transitions", () => {
    const durations = [3, 3, 3, 3, 3, 3];
    const filter = buildTransitionFilter(durations);

    // Every transition borrows exactly `duration` seconds from the end of
    // the true cumulative boundary before it — never more, no matter its
    // position in the chain.
    expect(filter).toContain("[0:v][1:v]xfade=transition=fade:duration=0.450:offset=2.550[x1]");
    expect(filter).toContain("[v1][2:v]xfade=transition=fade:duration=0.450:offset=5.550[x2]");
    expect(filter).toContain("[v2][3:v]xfade=transition=fade:duration=0.450:offset=8.550[x3]");
    expect(filter).toContain("[v3][4:v]xfade=transition=fade:duration=0.450:offset=11.550[x4]");
    expect(filter).toContain("[v4][5:v]xfade=transition=fade:duration=0.450:offset=14.550[xvout]");
  });
});

/**
 * Regression test for a real production failure: chaining every scene's
 * xfade into one ffmpeg process (the old concatClips implementation) was
 * reproduced to intermittently fail past a few hundred inputs with
 * swscaler "Resource temporarily unavailable" / libx264 "Error while
 * opening encoder" (confirmed via a synthetic 459-clip repro matching a
 * real project). This exercises the fix — batching past MAX_CROSSFADE_BATCH
 * — end to end against real ffmpeg, using a clip count just over the batch
 * boundary so it actually forces two recursion levels.
 */
describe("concatClips batching (real ffmpeg)", () => {
  const tmpRoot = path.join(os.tmpdir(), `concat-clips-test-${process.pid}`);
  const clipCount = MAX_CROSSFADE_BATCH + 5;
  const clipDuration = 0.4;
  let clipPaths: string[];

  beforeAll(async () => {
    await fs.mkdir(tmpRoot, { recursive: true });
    clipPaths = await Promise.all(
      Array.from({ length: clipCount }, async (_, i) => {
        const clipPath = path.join(tmpRoot, `clip-${i}.mp4`);
        await execFileAsync("ffmpeg", [
          "-y",
          "-f", "lavfi", "-i", `color=c=blue:s=64x64:d=${clipDuration}:r=30`,
          "-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono",
          "-c:v", "libx264", "-pix_fmt", "yuv420p",
          "-t", String(clipDuration),
          "-c:a", "aac", "-shortest",
          clipPath,
        ]);
        return clipPath;
      })
    );
  }, 60000);

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("merges more clips than MAX_CROSSFADE_BATCH into one file and cleans up intermediates", async () => {
    const outputPath = path.join(tmpRoot, "final.mp4");
    const durations = clipPaths.map(() => clipDuration);

    await concatClips(clipPaths, durations, outputPath);

    await expect(fs.access(outputPath)).resolves.toBeUndefined();
    await expect(fs.access(`${outputPath}.batch-tmp`)).rejects.toThrow();

    const { stdout } = await execFileAsync("ffprobe", [
      "-v", "error",
      "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1",
      outputPath,
    ]);
    const actualDuration = parseFloat(stdout);
    const expectedDuration = clipCount * clipDuration;
    expect(Math.abs(actualDuration - expectedDuration)).toBeLessThan(1);
  }, 60000);
});
