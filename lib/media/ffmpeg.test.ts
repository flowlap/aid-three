import { describe, expect, it } from "vitest";
import { describeFfmpegFailure, runFfmpeg } from "./ffmpeg";

describe("describeFfmpegFailure", () => {
  it("reports a plain non-zero exit with no signal as a generic failure", () => {
    const err = describeFfmpegFailure(1, null, "Error opening input file /no/such/file.mp4.");
    expect(err.message).toMatch(/^ffmpeg 실행 실패 \(code=1\)/);
  });

  /**
   * Regression: a real production failure showed ffmpeg killed by a signal
   * (code=null) partway through a long encode under system-wide memory/
   * thread pressure. The old message only reported `code`, silently
   * dropping the signal and leaving a raw stderr dump as the only clue.
   */
  it("reports a signal-terminated process as a resource-exhaustion failure", () => {
    const err = describeFfmpegFailure(null, "SIGKILL", "frame=66163 fps=356 ...");
    expect(err.message).toContain("시스템 자원 부족으로 중단되었습니다");
    expect(err.message).toContain("SIGKILL");
  });

  it.each([
    "Resource temporarily unavailable",
    "Cannot allocate memory",
    "Failed initializing scaling graph",
    "Error while opening encoder",
  ])("reports a non-zero exit containing %j as a resource-exhaustion failure", (pattern) => {
    const err = describeFfmpegFailure(187, null, `[swscaler] ${pattern}`);
    expect(err.message).toContain("시스템 자원 부족으로 중단되었습니다");
  });
});

describe("runFfmpeg (real ffmpeg)", () => {
  it("rejects with the generic message for an ordinary bad-argument failure", async () => {
    await expect(runFfmpeg(["-y", "-i", "/no/such/file.mp4", "/tmp/ffmpeg-test-out.mp4"])).rejects.toThrow(
      /^ffmpeg 실행 실패 \(code=\d+\)/
    );
  });
});
