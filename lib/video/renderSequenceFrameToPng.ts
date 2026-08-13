import { buildSequenceOverlayLayout } from "./renderSequenceFrame";
import { rasterizeToPng } from "./rasterizeToPng";
import type { SequenceOverlayEntry } from "@/lib/pipeline/sequenceTypes";
import type { LayoutPosition } from "@/lib/pipeline/designVisuals";
import type { FrameDimensions } from "./frameDimensions";

/**
 * Rasterizes one scene's overlay layer to a transparent PNG (see
 * renderSequenceFrame.tsx for why overlays are a separate layer composited
 * after the motion filter, not baked into the base frame). No
 * `backgroundColor` is set on the root container, so the root of the
 * ImageResponse stays fully transparent and ffmpeg's `overlay` filter
 * composites only the drawn banners on top of the (already cropped/scaled)
 * base image.
 *
 * Returns null for an empty overlays array so callers can skip
 * generating/compositing an overlay layer entirely for that scene -- cheaper
 * than always running an all-transparent pass for the common no-overlay
 * case.
 */
export async function renderSequenceOverlayToPng(
  overlays: SequenceOverlayEntry[],
  dimensions: FrameDimensions,
  overlayPositions?: (LayoutPosition | undefined)[]
): Promise<Buffer | null> {
  if (overlays.length === 0) return null;

  const layout = buildSequenceOverlayLayout(overlays, dimensions.width, dimensions.height, overlayPositions);
  return rasterizeToPng(layout, dimensions);
}
