import { spawn } from "child_process";

/** Throws a clear Korean error if ffmpeg isn't on PATH, instead of letting spawn ENOENT bubble up unexplained. */
export async function assertFfmpegAvailable(): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-version"]);
    child.on("error", () =>
      reject(new Error("ffmpeg가 설치되어 있지 않습니다. 터미널에서 `brew install ffmpeg`로 설치해주세요."))
    );
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 실행 확인에 실패했습니다 (code=${code})`));
    });
  });
}

/** Substrings seen in real swscale/encoder-open failures caused by the OS refusing to hand out more memory or threads, as opposed to a bad command/argument. */
const RESOURCE_EXHAUSTION_PATTERNS = [
  "Resource temporarily unavailable",
  "Cannot allocate memory",
  "Failed initializing scaling graph",
  "Error while opening encoder",
];

/**
 * A null code means the process was terminated by a signal rather than
 * exiting on its own (typical of the OS killing it under memory/thread
 * pressure) — that, or a known swscale/encoder resource-exhaustion message
 * in stderr, means this isn't a bad-argument failure. Exported standalone
 * so the classification can be unit-tested without spawning ffmpeg.
 */
export function describeFfmpegFailure(code: number | null, killSignal: NodeJS.Signals | null, stderr: string): Error {
  const tail = stderr.slice(-2000);
  const isResourceExhaustion =
    killSignal !== null || RESOURCE_EXHAUSTION_PATTERNS.some((pattern) => stderr.includes(pattern));
  if (isResourceExhaustion) {
    return new Error(
      `ffmpeg가 시스템 자원 부족으로 중단되었습니다${killSignal ? ` (신호: ${killSignal})` : ""}. 다른 프로그램을 종료해 메모리/CPU 여유를 확보한 뒤 다시 시도해주세요.\n${tail}`
    );
  }
  return new Error(`ffmpeg 실행 실패 (code=${code}): ${tail}`);
}

/** Runs ffmpeg with the given args, rejecting on non-zero exit or abort. */
export function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { signal });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code, killSignal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(describeFfmpegFailure(code, killSignal, stderr));
    });
  });
}
