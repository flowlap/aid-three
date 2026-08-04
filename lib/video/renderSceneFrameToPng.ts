import { ImageResponse } from "next/og";
import { buildSceneFrameLayout, FRAME_WIDTH, FRAME_HEIGHT } from "./renderSceneFrame";
import { loadPretendardFonts } from "@/lib/satoriFonts";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

function toDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** Rasterizes one scene's NotebookLM-style video frame to a 1920x1080 PNG. */
export async function renderSceneFrameToPng(
  scene: Scene,
  design: VisualDesign | undefined,
  imageBuffer?: Buffer
): Promise<Buffer> {
  const fonts = await loadPretendardFonts();
  const response = new ImageResponse(buildSceneFrameLayout(scene, design, imageBuffer ? toDataUri(imageBuffer) : undefined), {
    width: FRAME_WIDTH,
    height: FRAME_HEIGHT,
    fonts,
  });
  return Buffer.from(await response.arrayBuffer());
}
