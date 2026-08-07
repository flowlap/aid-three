import { createHash } from "crypto";
import type { CameraMotion, SequenceOverlayEntry } from "@/lib/pipeline/sequenceTypes";

export interface SceneClipFingerprintInput {
  imageBuffer: Buffer | null;
  audioBuffer: Buffer;
  motion: CameraMotion;
  overlays: SequenceOverlayEntry[];
  masterVisualAssetId: string | null;
  masterVisualStatus: string | null;
}

/**
 * Sequence-mode "does this scene's clip need to be re-rendered" check.
 * Scene mode's resume logic only checks "does a clip file exist for this
 * scene ID" — deliberately coarse, and fine there because nothing about a
 * scene-mode clip's *content* can silently drift once rendered once. Sequence
 * mode's clip depends on the scene image, narration audio, camera motion,
 * overlays, and the owning sequence's master-visual asset/status — any one of
 * which can change after a clip was rendered (an edited plan, a regenerated
 * master, a swapped scene image) without the scene ID itself changing. So
 * resume must compare a fingerprint of everything the clip depends on, not
 * just presence of a same-named file.
 */
export function computeSceneClipFingerprint(input: SceneClipFingerprintInput): string {
  const hash = createHash("sha256");
  hash.update(input.imageBuffer ?? Buffer.alloc(0));
  hash.update(input.audioBuffer);
  hash.update(
    JSON.stringify({
      motion: input.motion,
      overlays: input.overlays,
      masterVisualAssetId: input.masterVisualAssetId,
      masterVisualStatus: input.masterVisualStatus,
    })
  );
  return hash.digest("hex");
}
