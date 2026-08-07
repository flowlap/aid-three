import { describe, it, expect } from "vitest";
import { findSequenceForScene } from "./sequenceLookup";
import type { SequencePlan } from "./sequenceTypes";

function makePlan(): SequencePlan {
  return {
    version: 1,
    sequences: [
      {
        id: "sequence-001",
        order: 1,
        title: "도입부",
        sceneIds: ["scene-001", "scene-002"],
        estimatedDurationSec: 10,
        purpose: "개념 소개",
        continuity: {
          location: "사무실",
          visualStyle: "플랫 일러스트",
          fixedElements: [],
          doNotChange: [],
        },
        masterVisual: { description: "사무실 배경의 인물", status: "not-generated" },
        cameraPlan: [],
        overlays: [],
      },
      {
        id: "sequence-002",
        order: 2,
        title: "심화",
        sceneIds: ["scene-003"],
        estimatedDurationSec: 5,
        purpose: "심화 설명",
        continuity: {
          location: "회의실",
          visualStyle: "플랫 일러스트",
          fixedElements: [],
          doNotChange: [],
        },
        masterVisual: { description: "회의실 배경", status: "not-generated" },
        cameraPlan: [],
        overlays: [],
      },
    ],
  };
}

describe("findSequenceForScene", () => {
  it("returns the sequence that contains the given scene id", () => {
    const plan = makePlan();

    expect(findSequenceForScene(plan, "scene-002")?.id).toBe("sequence-001");
    expect(findSequenceForScene(plan, "scene-003")?.id).toBe("sequence-002");
  });

  it("returns undefined when no sequence references the scene id", () => {
    const plan = makePlan();

    expect(findSequenceForScene(plan, "scene-999")).toBeUndefined();
  });
});
