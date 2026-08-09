import { describe, it, expect } from "vitest";
import { createHash } from "crypto";
import { computeSceneClipFingerprint, type SceneClipFingerprintInput } from "./sceneClipFingerprint";

function digestOf(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function baseInput(): SceneClipFingerprintInput {
  return {
    imageBuffer: Buffer.from("image-bytes"),
    audioDigest: digestOf("audio-bytes"),
    motion: "static",
    overlays: [{ sceneId: "scene-001", type: "label", description: "라벨" }],
    masterVisualAssetId: "asset-1",
    masterVisualStatus: "generated",
  };
}

describe("computeSceneClipFingerprint", () => {
  it("produces the same fingerprint for identical inputs", () => {
    expect(computeSceneClipFingerprint(baseInput())).toBe(computeSceneClipFingerprint(baseInput()));
  });

  it("changes when the image bytes change", () => {
    const a = computeSceneClipFingerprint(baseInput());
    const b = computeSceneClipFingerprint({ ...baseInput(), imageBuffer: Buffer.from("different-image") });
    expect(a).not.toBe(b);
  });

  it("changes when the audio digest changes", () => {
    const a = computeSceneClipFingerprint(baseInput());
    const b = computeSceneClipFingerprint({ ...baseInput(), audioDigest: digestOf("different-audio") });
    expect(a).not.toBe(b);
  });

  it("changes when the motion changes", () => {
    const a = computeSceneClipFingerprint(baseInput());
    const b = computeSceneClipFingerprint({ ...baseInput(), motion: "pan-left" });
    expect(a).not.toBe(b);
  });

  it("changes when the overlays change", () => {
    const a = computeSceneClipFingerprint(baseInput());
    const b = computeSceneClipFingerprint({ ...baseInput(), overlays: [] });
    expect(a).not.toBe(b);
  });

  it("changes when the master visual asset id changes", () => {
    const a = computeSceneClipFingerprint(baseInput());
    const b = computeSceneClipFingerprint({ ...baseInput(), masterVisualAssetId: "asset-2" });
    expect(a).not.toBe(b);
  });

  it("changes when the master visual status changes", () => {
    const a = computeSceneClipFingerprint(baseInput());
    const b = computeSceneClipFingerprint({ ...baseInput(), masterVisualStatus: "stale" });
    expect(a).not.toBe(b);
  });

  it("does not throw for a null image buffer and differs from any non-null buffer fingerprint", () => {
    const withNull = computeSceneClipFingerprint({ ...baseInput(), imageBuffer: null });
    const withBuffer = computeSceneClipFingerprint(baseInput());
    expect(withNull).not.toBe(withBuffer);
  });

  /** Sequence + AI mode (see video/route.ts's handleSequenceModeVideo): no master visual/overlay/camera-motion inputs exist for an AI-regenerated static frame, so the fixed shape below is what that branch always passes. */
  function aiModeInput(): SceneClipFingerprintInput {
    return {
      imageBuffer: Buffer.from("ai-generated-image"),
      audioDigest: digestOf("audio-bytes"),
      motion: "static",
      overlays: [],
      masterVisualAssetId: null,
      masterVisualStatus: null,
    };
  }

  it("AI mode: still changes fingerprint when only the image bytes change, so a regenerated scene image invalidates the cached clip", () => {
    const a = computeSceneClipFingerprint(aiModeInput());
    const b = computeSceneClipFingerprint({ ...aiModeInput(), imageBuffer: Buffer.from("different-ai-image") });
    expect(a).not.toBe(b);
  });

  it("AI mode: produces the same fingerprint across calls for the same unchanged image/audio", () => {
    expect(computeSceneClipFingerprint(aiModeInput())).toBe(computeSceneClipFingerprint(aiModeInput()));
  });
});
