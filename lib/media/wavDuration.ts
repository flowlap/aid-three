/**
 * Reads a WAV file's duration straight from its RIFF header — no ffprobe/
 * ffmpeg dependency needed just to know how long a clip is. Scans chunks
 * rather than assuming "fmt " and "data" are the first two, since some
 * encoders (mlx-audio's included) insert other chunks between them.
 */
export function getWavDurationSec(buffer: Buffer): number {
  if (buffer.length < 12 || buffer.toString("ascii", 0, 4) !== "RIFF" || buffer.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("올바른 WAV 파일이 아닙니다");
  }

  let offset = 12;
  let sampleRate: number | null = null;
  let byteRate: number | null = null;
  let dataSize: number | null = null;

  while (offset + 8 <= buffer.length) {
    const chunkId = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const chunkStart = offset + 8;

    if (chunkId === "fmt ") {
      sampleRate = buffer.readUInt32LE(chunkStart + 4);
      byteRate = buffer.readUInt32LE(chunkStart + 8);
    } else if (chunkId === "data") {
      dataSize = chunkSize;
    }

    offset = chunkStart + chunkSize + (chunkSize % 2); // chunks are word-aligned
  }

  if (dataSize === null) throw new Error("WAV data 청크를 찾을 수 없습니다");
  if (!byteRate) {
    if (!sampleRate) throw new Error("WAV fmt 청크를 찾을 수 없습니다");
    throw new Error("WAV byteRate 값이 올바르지 않습니다");
  }

  return dataSize / byteRate;
}
