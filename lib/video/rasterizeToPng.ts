import { ImageResponse } from "next/og";
import { loadPretendardFonts } from "@/lib/satoriFonts";
import type { ReactElement } from "react";
import type { FrameDimensions } from "./frameDimensions";

/**
 * Shared next/og (Satori) rasterization boilerplate: load/cache the
 * Pretendard fonts, run the given JSX layout through ImageResponse at the
 * given dimensions, and collect the result into a PNG Buffer. Used by both
 * renderSceneFrameToPng.ts (title cards / scene frames) and
 * renderSequenceFrameToPng.ts (sequence-mode overlay layers) — the layout
 * builders themselves stay separate (Satori has no component-reuse
 * mechanism across such different layouts), only this rasterization
 * plumbing is shared.
 */
export async function rasterizeToPng(layout: ReactElement, { width, height }: FrameDimensions): Promise<Buffer> {
  const fonts = await loadPretendardFonts();
  const response = new ImageResponse(layout, { width, height, fonts });
  return Buffer.from(await response.arrayBuffer());
}
