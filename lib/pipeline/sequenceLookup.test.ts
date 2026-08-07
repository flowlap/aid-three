import { describe, it, expect } from "vitest";
import { findSequenceForScene, groupScenesBySequence } from "./sequenceLookup";
import type { SequencePlan } from "./sequenceTypes";
import type { Scene } from "./splitScenes";

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

function makeScene(id: string, order: number): Scene {
  return {
    id,
    order,
    narrationText: `${id} 나레이션`,
    estimatedDurationSec: 5,
    splitReason: "테스트",
  };
}

describe("groupScenesBySequence", () => {
  it("groups scenes by owning sequence, in plan order, with scenes ordered by the sequence's own sceneIds", () => {
    const plan = makePlan();
    const scenes = [makeScene("scene-003", 3), makeScene("scene-002", 2), makeScene("scene-001", 1)];

    const groups = groupScenesBySequence(scenes, plan);

    expect(groups).toEqual([
      { sequenceId: "sequence-001", scenes: [scenes[2], scenes[1]] },
      { sequenceId: "sequence-002", scenes: [scenes[0]] },
    ]);
  });

  it("silently skips a scene id present in the plan but missing from the scenes array", () => {
    const plan = makePlan();
    const scenes = [makeScene("scene-001", 1)]; // scene-002 and scene-003 missing

    const groups = groupScenesBySequence(scenes, plan);

    expect(groups).toEqual([{ sequenceId: "sequence-001", scenes: [scenes[0]] }]);
  });

  it("omits a sequence entirely when none of its scenes remain", () => {
    const plan = makePlan();
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 2)]; // scene-003 (sequence-002's only scene) missing

    const groups = groupScenesBySequence(scenes, plan);

    expect(groups.map((g) => g.sequenceId)).toEqual(["sequence-001"]);
  });
});
