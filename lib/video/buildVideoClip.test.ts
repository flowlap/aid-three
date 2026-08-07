import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import os from "os";
import path from "path";
import { promises as fs } from "fs";

const runFfmpegMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/media/ffmpeg", () => ({ runFfmpeg: (...args: unknown[]) => runFfmpegMock(...(args as [string[], AbortSignal | undefined])) }));

import { buildSequenceVideoClip } from "./buildVideoClip";

describe("buildSequenceVideoClip (mocked ffmpeg)", () => {
  const tmpRoot = path.join(os.tmpdir(), `build-sequence-video-clip-test-${process.pid}`);

  beforeEach(() => {
    runFfmpegMock.mockClear();
  });

  afterAll(async () => {
    await fs.rm(tmpRoot, { recursive: true, force: true }).catch(() => {});
  });

  it("uses a plain -vf filter with two inputs when there is no overlay", async () => {
    const outputPath = path.join(tmpRoot, "no-overlay", "scene-001.mp4");

    await buildSequenceVideoClip("frame.png", "audio.wav", outputPath, "scale=100:100", null);

    expect(runFfmpegMock).toHaveBeenCalledTimes(1);
    const args = runFfmpegMock.mock.calls[0][0] as string[];

    expect(args).not.toContain("-filter_complex");
    expect(args).not.toContain("overlay.png");
    const vfIndex = args.indexOf("-vf");
    expect(vfIndex).toBeGreaterThan(-1);
    expect(args[vfIndex + 1]).toBe("scale=100:100");

    const inputIndexes = args.reduce<number[]>((acc, arg, i) => (arg === "-i" ? [...acc, i] : acc), []);
    expect(inputIndexes).toHaveLength(2);
    expect(args[inputIndexes[0] + 1]).toBe("frame.png");
    expect(args[inputIndexes[1] + 1]).toBe("audio.wav");
  });

  it("uses -filter_complex with three inputs and maps [vout]/1:a when an overlay is given", async () => {
    const outputPath = path.join(tmpRoot, "overlay", "scene-001.mp4");

    await buildSequenceVideoClip("frame.png", "audio.wav", outputPath, "scale=100:100", "overlay.png");

    expect(runFfmpegMock).toHaveBeenCalledTimes(1);
    const args = runFfmpegMock.mock.calls[0][0] as string[];

    expect(args).not.toContain("-vf");
    const filterIndex = args.indexOf("-filter_complex");
    expect(filterIndex).toBeGreaterThan(-1);
    expect(args[filterIndex + 1]).toBe("[0:v]scale=100:100[base];[base][2:v]overlay=0:0:format=auto[vout]");

    const mapIndexes = args.reduce<number[]>((acc, arg, i) => (arg === "-map" ? [...acc, i] : acc), []);
    expect(mapIndexes).toHaveLength(2);
    expect(args[mapIndexes[0] + 1]).toBe("[vout]");
    expect(args[mapIndexes[1] + 1]).toBe("1:a");

    const inputIndexes = args.reduce<number[]>((acc, arg, i) => (arg === "-i" ? [...acc, i] : acc), []);
    expect(inputIndexes).toHaveLength(3);
    expect(args[inputIndexes[0] + 1]).toBe("frame.png");
    expect(args[inputIndexes[1] + 1]).toBe("audio.wav");
    expect(args[inputIndexes[2] + 1]).toBe("overlay.png");
  });

  it("creates the output directory before running ffmpeg", async () => {
    const outputDir = path.join(tmpRoot, "mkdir-check");
    const outputPath = path.join(outputDir, "scene-001.mp4");

    await buildSequenceVideoClip("frame.png", "audio.wav", outputPath, "scale=100:100", null);

    const stat = await fs.stat(outputDir);
    expect(stat.isDirectory()).toBe(true);
  });

  it("passes the abort signal through to ffmpeg", async () => {
    const controller = new AbortController();
    const outputPath = path.join(tmpRoot, "signal", "scene-001.mp4");

    await buildSequenceVideoClip("frame.png", "audio.wav", outputPath, "scale=100:100", null, controller.signal);

    expect(runFfmpegMock.mock.calls[0][1]).toBe(controller.signal);
  });
});
