import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Sequence } from "@/lib/pipeline/sequenceTypes";
import type { SequenceMasterAsset } from "@/lib/pipeline/sequenceLookup";

vi.mock("@/lib/video/composeSequenceStill", () => ({ composeSequenceStill: vi.fn() }));
vi.mock("@/lib/video/renderSequenceFrameToPng", () => ({ renderSequenceOverlayToPng: vi.fn() }));
vi.mock("@/lib/pipeline/imageAspectRatio", () => ({ getImageDimensions: vi.fn() }));

import { bakeSequenceSceneStill } from "./bakeSequenceSceneStill";
import { composeSequenceStill } from "@/lib/video/composeSequenceStill";
import { renderSequenceOverlayToPng } from "@/lib/video/renderSequenceFrameToPng";
import { getImageDimensions } from "@/lib/pipeline/imageAspectRatio";

const compose = vi.mocked(composeSequenceStill);
const renderOverlay = vi.mocked(renderSequenceOverlayToPng);
const imageDims = vi.mocked(getImageDimensions);

const FRAME = { width: 1920, height: 1280 };
// Wide master so pan motions have slack.
const MASTER: SequenceMasterAsset = { buffer: Buffer.from("master"), path: "/data/master.png" };

function sequenceWith(sceneId: string, opts: { motion?: string; overlay?: boolean }): Sequence {
  return {
    id: "sequence-001",
    order: 1,
    title: "s",
    sceneIds: [sceneId],
    estimatedDurationSec: 10,
    purpose: "",
    continuity: { location: "", visualStyle: "", fixedElements: [], doNotChange: [] },
    masterVisual: { description: "", status: "generated" },
    cameraPlan: opts.motion ? [{ sceneId, shot: "wide", motion: opts.motion as never }] : [],
    overlays: opts.overlay ? [{ sceneId, type: "label", description: "hi" }] : [],
  } as Sequence;
}

describe("bakeSequenceSceneStill", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    imageDims.mockReturnValue({ width: 3840, height: 1280 });
    renderOverlay.mockResolvedValue(Buffer.from("overlay-png"));
  });

  it("returns {baked:false, no-master} and composites nothing when the master is missing", async () => {
    const result = await bakeSequenceSceneStill({
      projectId: "d54f1502-2b54-407c-87fa-6c67e0174aa0",
      sceneId: "scene-001",
      sequence: sequenceWith("scene-001", { motion: "pan-left", overlay: true }),
      masterAsset: {},
      frameDimensions: FRAME,
    });
    expect(result).toEqual({ baked: false, reason: "no-master" });
    expect(compose).not.toHaveBeenCalled();
  });

  it("returns {baked:false, unreadable-master} when the master PNG can't be parsed", async () => {
    imageDims.mockReturnValue(null);
    const result = await bakeSequenceSceneStill({
      projectId: "d54f1502-2b54-407c-87fa-6c67e0174aa0",
      sceneId: "scene-001",
      sequence: sequenceWith("scene-001", { motion: "pan-left" }),
      masterAsset: MASTER,
      frameDimensions: FRAME,
    });
    expect(result).toEqual({ baked: false, reason: "unreadable-master" });
    expect(compose).not.toHaveBeenCalled();
  });

  it("composites master + overlay layer when the scene has overlays", async () => {
    const result = await bakeSequenceSceneStill({
      projectId: "d54f1502-2b54-407c-87fa-6c67e0174aa0",
      sceneId: "scene-001",
      sequence: sequenceWith("scene-001", { motion: "pan-left", overlay: true }),
      masterAsset: MASTER,
      frameDimensions: FRAME,
    });
    expect(result).toEqual({ baked: true });
    expect(renderOverlay).toHaveBeenCalledOnce();
    expect(compose).toHaveBeenCalledOnce();
    const arg = compose.mock.calls[0][0];
    expect(arg.masterPath).toBe(MASTER.path);
    expect(arg.overlayPath).toBeTruthy(); // a temp overlay PNG path
    expect(arg.cropRect).not.toBeNull(); // pan-left over a wide master crops
  });

  it("composites just the cropped master (no overlay input) when the scene has no overlays", async () => {
    const result = await bakeSequenceSceneStill({
      projectId: "d54f1502-2b54-407c-87fa-6c67e0174aa0",
      sceneId: "scene-001",
      sequence: sequenceWith("scene-001", { motion: "slow-push-in" }),
      masterAsset: MASTER,
      frameDimensions: FRAME,
    });
    expect(result).toEqual({ baked: true });
    expect(renderOverlay).not.toHaveBeenCalled();
    expect(compose).toHaveBeenCalledOnce();
    expect(compose.mock.calls[0][0].overlayPath).toBeNull();
  });
});
