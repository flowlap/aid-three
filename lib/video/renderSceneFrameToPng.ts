import { buildSceneFrameLayout } from "./renderSceneFrame";
import { rasterizeToPng } from "./rasterizeToPng";
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
  dimensions: FrameDimensions
): Promise<Buffer> {
  const layout = buildSceneFrameLayout(
    scene,
    design,
    imageBuffer ? toDataUri(imageBuffer) : undefined,
    dimensions.width,
    dimensions.height
  );
  return rasterizeToPng(layout, dimensions);
}
