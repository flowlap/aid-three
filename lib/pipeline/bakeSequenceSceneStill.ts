import { promises as fs } from "fs";
import { tmpdir } from "os";
import path from "path";
import { projectImagePath } from "@/lib/projects/store";
import { getImageDimensions } from "@/lib/pipeline/imageAspectRatio";
import { startCropRect } from "@/lib/video/motionFilter";
import { composeSequenceStill } from "@/lib/video/composeSequenceStill";
import { renderSequenceOverlayToPng } from "@/lib/video/renderSequenceFrameToPng";
import type { FrameDimensions } from "@/lib/video/frameDimensions";
import type { Sequence } from "@/lib/pipeline/sequenceTypes";
import type { SequenceMasterAsset } from "@/lib/pipeline/sequenceLookup";
import type { LayoutPosition } from "@/lib/pipeline/designVisuals";

export interface BakeSequenceStillResult {
  /** True when a composited still was written to images/{sceneId}.png. */
  baked: boolean;
  /** Set when `baked` is false so the caller can warn / fall back to a caption card. */
  reason?: "no-master" | "unreadable-master";
}

/**
 * Bakes one content scene's still = the owning sequence's master image
 * (cropped to the camera motion's t=0 frame) + that scene's overlay layer,
 * written to images/{sceneId}.png. This replaces per-scene AI image generation
 * in sequence mode (see the dual-production-mode plan): the image model is used
 * only for the per-sequence master plate, and each scene is a deterministic
 * crop+overlay composite of it — the same master + overlays the video renderer
 * animates, frozen at the clip's first frame (startCropRect).
 *
 * Returns { baked: false } (never throws for a missing/unreadable master) so
 * the caller can fall back to a caption card exactly like a title scene, the
 * same recovery the video route already uses when a base image is absent.
 */
export async function bakeSequenceSceneStill(params: {
  projectId: string;
  sceneId: string;
  sequence: Sequence | undefined;
  masterAsset: SequenceMasterAsset;
  frameDimensions: FrameDimensions;
  /** From this scene's VisualDesign (screen-design.json) — see VisualDesign.overlayPositions. */
  overlayPositions?: (LayoutPosition | undefined)[];
  signal?: AbortSignal;
}): Promise<BakeSequenceStillResult> {
  const { projectId, sceneId, sequence, masterAsset, frameDimensions, overlayPositions, signal } = params;

  if (!masterAsset.path || !masterAsset.buffer) return { baked: false, reason: "no-master" };
  const source = getImageDimensions(masterAsset.buffer);
  if (!source) return { baked: false, reason: "unreadable-master" };

  const motion = sequence?.cameraPlan.find((entry) => entry.sceneId === sceneId)?.motion ?? "static";
  const overlays = sequence?.overlays.filter((overlay) => overlay.sceneId === sceneId) ?? [];
  const cropRect = startCropRect(motion, source, frameDimensions);

  // Overlay layer is optional — renderSequenceOverlayToPng returns null for an
  // empty overlays array, so scenes with no overlays skip the overlay input
  // entirely (a plain cropped master).
  const overlayBuffer = overlays.length > 0 ? await renderSequenceOverlayToPng(overlays, frameDimensions, overlayPositions) : null;

  let tempDir: string | null = null;
  let overlayPath: string | null = null;
  try {
    if (overlayBuffer) {
      tempDir = await fs.mkdtemp(path.join(tmpdir(), "seq-overlay-"));
      overlayPath = path.join(tempDir, `${sceneId}.png`);
      await fs.writeFile(overlayPath, overlayBuffer);
    }

    await composeSequenceStill({
      masterPath: masterAsset.path,
      overlayPath,
      cropRect,
      output: frameDimensions,
      outputPath: projectImagePath(projectId, sceneId),
      signal,
    });
  } finally {
    if (tempDir) await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }

  return { baked: true };
}
