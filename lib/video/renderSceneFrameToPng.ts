import { ImageResponse } from "next/og";
import { promises as fs } from "fs";
import path from "path";
import { buildSceneFrameLayout, FRAME_WIDTH, FRAME_HEIGHT } from "./renderSceneFrame";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

type SatoriFont = { data: ArrayBuffer; name: string; weight: 400 | 700; style: "normal" };

let fontsCache: SatoriFont[] | null = null;

function toArrayBuffer(buffer: Buffer): ArrayBuffer {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
}

async function loadFonts(): Promise<SatoriFont[]> {
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

function toDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** Rasterizes one scene's NotebookLM-style video frame to a 1920x1080 PNG. */
export async function renderSceneFrameToPng(
  scene: Scene,
  design: VisualDesign | undefined,
  imageBuffer?: Buffer
): Promise<Buffer> {
  const fonts = await loadFonts();
  const response = new ImageResponse(buildSceneFrameLayout(scene, design, imageBuffer ? toDataUri(imageBuffer) : undefined), {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    fonts,
  });
  return Buffer.from(await response.arrayBuffer());
}
