import { promises as fs } from "fs";
import path from "path";

export type SatoriFont = { data: ArrayBuffer; name: string; weight: 400 | 700; style: "normal" };

let fontsCache: SatoriFont[] | null = null;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

/** Loads Pretendard Regular/Bold once and caches them for any Satori (`next/og` ImageResponse) renderer in this process. */
export async function loadPretendardFonts(): Promise<SatoriFont[]> {
  if (fontsCache) return fontsCache;
  const dir = path.join(process.cwd(), "assets", "fonts");
  const [regular, bold] = await Promise.all([
    fs.readFile(path.join(dir, "Pretendard-Regular.otf")),
    fs.readFile(path.join(dir, "Pretendard-Bold.otf")),
  ]);
  fontsCache = [
    { data: toArrayBuffer(regular), name: "Pretendard", weight: 400, style: "normal" },
    { data: toArrayBuffer(bold), name: "Pretendard", weight: 700, style: "normal" },
  ];
  return fontsCache;
}
