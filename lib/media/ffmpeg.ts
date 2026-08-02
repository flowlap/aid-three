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

/** Runs ffmpeg with the given args, rejecting on non-zero exit or abort. */
export function runFfmpeg(args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { signal });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (err) => reject(err));
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg 실행 실패 (code=${code}): ${stderr.slice(-2000)}`));
    });
  });
}
