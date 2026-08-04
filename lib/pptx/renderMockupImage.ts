import { ImageResponse } from "next/og";
import { loadPretendardFonts } from "@/lib/satoriFonts";
import { buildMockupLayout } from "./renderMockupLayout";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

const RENDER_WIDTH = 1600;
const DEFAULT_ASPECT_RATIO = 16 / 9;

/**
 * Rasterizes a generic layout-grid mockup PNG for a scene that has no
 * AI-generated image yet (see renderMockupLayout.tsx). The pptx export path
 * (lib/pptx/exportPptx.ts) crops whatever it's given to cover the
 * placeholder box, so `aspectRatio` only needs to be a reasonable default —
 * it doesn't have to match any specific template's box exactly.
 */
export async function renderMockupImage(
  design: VisualDesign | undefined,
  screenType: string | undefined,
  aspectRatio: number = DEFAULT_ASPECT_RATIO
): Promise<Buffer> {
  const width = RENDER_WIDTH;
  const height = Math.max(1, Math.round(RENDER_WIDTH / aspectRatio));
  const fonts = await loadPretendardFonts();
  const response = new ImageResponse(buildMockupLayout(design, screenType, width, height), { width, height, fonts });
  return Buffer.from(await response.arrayBuffer());
}
