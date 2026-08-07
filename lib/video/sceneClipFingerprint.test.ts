import { describe, it, expect } from "vitest";
import { computeSceneClipFingerprint, type SceneClipFingerprintInput } from "./sceneClipFingerprint";

function baseInput(): SceneClipFingerprintInput {
  return {
    imageBuffer: Buffer.from("image-bytes"),
    audioBuffer: Buffer.from("audio-bytes"),
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

  it("changes when the audio bytes change", () => {
    const a = computeSceneClipFingerprint(baseInput());
    const b = computeSceneClipFingerprint({ ...baseInput(), audioBuffer: Buffer.from("different-audio") });
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
});
