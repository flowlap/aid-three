import { promises as fs } from "fs";
import path from "path";
import { runFfmpeg } from "@/lib/media/ffmpeg";

/** Escapes a path for ffmpeg's concat demuxer list file (single quotes, per its documented format). */
function escapeConcatPath(p: string): string {
  return p.replace(/'/g, "'\\''");
}

/**
 * Joins per-scene clips (in scene order) into one mp4. Every clip comes from
 * buildVideoClip with identical codec/resolution/fps, so the concat demuxer
 * can stream-copy (`-c copy`) without re-encoding — seconds, not minutes.
 */
export async function concatClips(clipPaths: string[], outputPath: string, signal?: AbortSignal): Promise<void> {
  if (clipPaths.length === 0) throw new Error("연결할 클립이 없습니다");

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  const listPath = path.join(path.dirname(outputPath), "concat-list.txt");
  const listContent = clipPaths.map((p) => `file '${escapeConcatPath(p)}'`).join("\n");
  await fs.writeFile(listPath, listContent, "utf-8");

  try {
    await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", listPath, "-c", "copy", outputPath], signal);
  } finally {
    await fs.rm(listPath, { force: true });
  }
}
