import { ImageResponse } from "next/og";
import { buildSceneFrameLayout } from "./renderSceneFrame";
import { loadPretendardFonts } from "@/lib/satoriFonts";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import type { FrameDimensions } from "./frameDimensions";

function toDataUri(buffer: Buffer): string {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

/** Rasterizes one scene's video frame to a PNG at the given dimensions (see computeFrameDimensions). */
export async function renderSceneFrameToPng(
  scene: Scene,
  design: VisualDesign | undefined,
  imageBuffer: Buffer | undefined,
  { width, height }: FrameDimensions
): Promise<Buffer> {
  const fonts = await loadPretendardFonts();
  const response = new ImageResponse(
    buildSceneFrameLayout(scene, design, imageBuffer ? toDataUri(imageBuffer) : undefined, width, height),
    { width, height, fonts }
  );
  return Buffer.from(await response.arrayBuffer());
}
