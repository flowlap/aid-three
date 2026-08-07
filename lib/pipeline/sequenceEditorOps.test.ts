import { describe, it, expect } from "vitest";
import type { Scene } from "./splitScenes";
import type { Sequence, SequencePlan } from "./sequenceTypes";
import {
  deriveSequenceDurationSec,
  mergeAdjacentSequences,
  moveSceneToAdjacentSequence,
  renameSequence,
  splitSequence,
  updateContinuity,
  updateMasterVisualDescription,
} from "./sequenceEditorOps";

function scene(overrides: Partial<Scene> & { id: string; order: number }): Scene {
  return {
    narrationText: "내레이션 텍스트",
    estimatedDurationSec: 10,
    splitReason: "테스트용 분절",
    ...overrides,
  };
}

function sequence(overrides: Partial<Sequence> & { id: string; order: number; sceneIds: string[] }): Sequence {
  return {
    title: "시퀀스 제목",
    estimatedDurationSec: overrides.sceneIds.length * 10,
    purpose: "테스트 목적",
    continuity: {
      location: "교실",
      visualStyle: "플랫 일러스트",
      fixedElements: [],
      doNotChange: [],
    },
    masterVisual: {
      description: "마스터 비주얼 설명",
      status: "not-generated",
    },
    cameraPlan: [],
    overlays: [],
    ...overrides,
  };
}

function plan(sequences: Sequence[]): SequencePlan {
  return { version: 1, sequences };
}

/** Six 10s content scenes, grouped 2/2/2 into three sequences. */
function sixScenes(): Scene[] {
  return [
    scene({ id: "scene-001", order: 1 }),
    scene({ id: "scene-002", order: 2 }),
    scene({ id: "scene-003", order: 3 }),
    scene({ id: "scene-004", order: 4 }),
    scene({ id: "scene-005", order: 5 }),
    scene({ id: "scene-006", order: 6 }),
  ];
}

function threeSequencePlan(): SequencePlan {
  return plan([
    sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002"] }),
    sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    sequence({ id: "sequence-003", order: 3, sceneIds: ["scene-005", "scene-006"] }),
  ]);
}

function seqById(p: SequencePlan, id: string): Sequence {
  const found = p.sequences.find((s) => s.id === id);
  if (!found) throw new Error(`sequence not found: ${id}`);
  return found;
}

describe("renameSequence", () => {
  it("renames the sequence's title", () => {
    const result = renameSequence(threeSequencePlan(), "sequence-002", "새 제목");
    if ("error" in result) throw new Error(result.error);
    expect(seqById(result.plan, "sequence-002").title).toBe("새 제목");
  });

  it("trims whitespace and rejects an empty title", () => {
    const result = renameSequence(threeSequencePlan(), "sequence-001", "   ");
    expect("error" in result).toBe(true);
  });

  it("rejects an unknown sequence id", () => {
    const result = renameSequence(threeSequencePlan(), "sequence-999", "제목");
    expect("error" in result).toBe(true);
  });
});

describe("updateContinuity", () => {
  it("merges a partial patch into the sequence's continuity", () => {
    const result = updateContinuity(threeSequencePlan(), "sequence-001", { location: "실외", timeOfDay: "낮" });
    if ("error" in result) throw new Error(result.error);
    const seq = seqById(result.plan, "sequence-001");
    expect(seq.continuity.location).toBe("실외");
    expect(seq.continuity.timeOfDay).toBe("낮");
    expect(seq.continuity.visualStyle).toBe("플랫 일러스트"); // untouched field preserved
  });

  it("marks a generated master visual stale when continuity changes", () => {
    const p = threeSequencePlan();
    const generated = updateMasterVisualStatusHelper(p, "sequence-001", "generated");
    const result = updateContinuity(generated, "sequence-001", { location: "실외" });
    if ("error" in result) throw new Error(result.error);
    expect(seqById(result.plan, "sequence-001").masterVisual.status).toBe("stale");
  });

  it("rejects an unknown sequence id", () => {
    const result = updateContinuity(threeSequencePlan(), "sequence-999", { location: "실외" });
    expect("error" in result).toBe(true);
  });
});

describe("updateMasterVisualDescription", () => {
  it("updates the description", () => {
    const result = updateMasterVisualDescription(threeSequencePlan(), "sequence-001", "새로운 마스터 비주얼 설명");
    if ("error" in result) throw new Error(result.error);
    expect(seqById(result.plan, "sequence-001").masterVisual.description).toBe("새로운 마스터 비주얼 설명");
  });

  it("marks a generated master visual stale when the description changes", () => {
    const p = updateMasterVisualStatusHelper(threeSequencePlan(), "sequence-001", "generated");
    const result = updateMasterVisualDescription(p, "sequence-001", "변경된 설명");
    if ("error" in result) throw new Error(result.error);
    expect(seqById(result.plan, "sequence-001").masterVisual.status).toBe("stale");
  });

  it("leaves a not-generated master visual's status alone", () => {
    const result = updateMasterVisualDescription(threeSequencePlan(), "sequence-001", "변경된 설명");
    if ("error" in result) throw new Error(result.error);
    expect(seqById(result.plan, "sequence-001").masterVisual.status).toBe("not-generated");
  });
});

describe("moveSceneToAdjacentSequence", () => {
  it("moves the last scene of a sequence to the next sequence, recomputing both durations", () => {
    const scenes = sixScenes();
    const result = moveSceneToAdjacentSequence(threeSequencePlan(), scenes, "scene-002", "next");
    if ("error" in result) throw new Error(result.error);
    const first = seqById(result.plan, "sequence-001");
    const second = seqById(result.plan, "sequence-002");
    expect(first.sceneIds).toEqual(["scene-001"]);
    expect(second.sceneIds).toEqual(["scene-002", "scene-003", "scene-004"]);
    expect(first.estimatedDurationSec).toBe(deriveSequenceDurationSec(["scene-001"], scenes));
    expect(second.estimatedDurationSec).toBe(deriveSequenceDurationSec(["scene-002", "scene-003", "scene-004"], scenes));
  });

  it("moves the first scene of a sequence to the previous sequence", () => {
    const scenes = sixScenes();
    const result = moveSceneToAdjacentSequence(threeSequencePlan(), scenes, "scene-003", "prev");
    if ("error" in result) throw new Error(result.error);
    const first = seqById(result.plan, "sequence-001");
    const second = seqById(result.plan, "sequence-002");
    expect(first.sceneIds).toEqual(["scene-001", "scene-002", "scene-003"]);
    expect(second.sceneIds).toEqual(["scene-004"]);
  });

  it("carries the moved scene's camera plan and overlay entries along", () => {
    const scenes = sixScenes();
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002"],
        cameraPlan: [
          { sceneId: "scene-001", shot: "wide", motion: "static" },
          { sceneId: "scene-002", shot: "medium", motion: "static" },
        ],
        overlays: [{ sceneId: "scene-002", type: "label", description: "라벨" }],
      }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);
    const result = moveSceneToAdjacentSequence(p, scenes, "scene-002", "next");
    if ("error" in result) throw new Error(result.error);
    const first = seqById(result.plan, "sequence-001");
    const second = seqById(result.plan, "sequence-002");
    expect(first.cameraPlan).toEqual([{ sceneId: "scene-001", shot: "wide", motion: "static" }]);
    expect(second.cameraPlan).toEqual([{ sceneId: "scene-002", shot: "medium", motion: "static" }]);
    expect(second.overlays).toEqual([{ sceneId: "scene-002", type: "label", description: "라벨" }]);
  });

  it("rejects moving a non-boundary (interior) scene", () => {
    const scenes = sixScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002", "scene-003"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-004", "scene-005"] }),
    ]);
    const result = moveSceneToAdjacentSequence(p, scenes, "scene-002", "next");
    expect("error" in result).toBe(true);
  });

  it("rejects moving toward a direction with no adjacent sequence", () => {
    const scenes = sixScenes();
    const result = moveSceneToAdjacentSequence(threeSequencePlan(), scenes, "scene-001", "prev");
    expect("error" in result).toBe(true);
  });

  it("rejects a move that would leave the source sequence empty", () => {
    const scenes = sixScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-002", "scene-003"] }),
    ]);
    const result = moveSceneToAdjacentSequence(p, scenes, "scene-001", "next");
    expect("error" in result).toBe(true);
  });

  it("rejects an unknown scene id", () => {
    const scenes = sixScenes();
    const result = moveSceneToAdjacentSequence(threeSequencePlan(), scenes, "scene-999", "next");
    expect("error" in result).toBe(true);
  });
});

describe("mergeAdjacentSequences", () => {
  it("concatenates sceneIds/cameraPlan/overlays and recomputes duration", () => {
    const scenes = sixScenes();
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002"],
        cameraPlan: [{ sceneId: "scene-001", shot: "wide", motion: "static" }],
        overlays: [{ sceneId: "scene-002", type: "label", description: "라벨" }],
      }),
      sequence({
        id: "sequence-002",
        order: 2,
        sceneIds: ["scene-003", "scene-004"],
        cameraPlan: [{ sceneId: "scene-003", shot: "medium", motion: "pan-left" }],
      }),
      sequence({ id: "sequence-003", order: 3, sceneIds: ["scene-005", "scene-006"] }),
    ]);

    const result = mergeAdjacentSequences(p, scenes, "sequence-001", "sequence-002");
    if ("error" in result) throw new Error(result.error);
    expect(result.plan.sequences).toHaveLength(2);
    const merged = seqById(result.plan, "sequence-001");
    expect(merged.sceneIds).toEqual(["scene-001", "scene-002", "scene-003", "scene-004"]);
    expect(merged.cameraPlan).toEqual([
      { sceneId: "scene-001", shot: "wide", motion: "static" },
      { sceneId: "scene-003", shot: "medium", motion: "pan-left" },
    ]);
    expect(merged.overlays).toEqual([{ sceneId: "scene-002", type: "label", description: "라벨" }]);
    expect(merged.estimatedDurationSec).toBe(deriveSequenceDurationSec(merged.sceneIds, scenes));

    // The third sequence's order is renumbered down after the merge collapses two into one.
    const third = seqById(result.plan, "sequence-003");
    expect(third.order).toBe(2);
  });

  it("rejects merging two sequences that are not adjacent", () => {
    const scenes = sixScenes();
    const result = mergeAdjacentSequences(threeSequencePlan(), scenes, "sequence-001", "sequence-003");
    expect("error" in result).toBe(true);
  });

  it("rejects an unknown sequence id", () => {
    const scenes = sixScenes();
    const result = mergeAdjacentSequences(threeSequencePlan(), scenes, "sequence-001", "sequence-999");
    expect("error" in result).toBe(true);
  });
});

describe("splitSequence", () => {
  it("splits a sequence into two at the given scene boundary and renumbers subsequent order", () => {
    const scenes = [
      scene({ id: "scene-001", order: 1 }),
      scene({ id: "scene-002", order: 2 }),
      scene({ id: "scene-003", order: 3 }),
      scene({ id: "scene-004", order: 4 }),
    ];
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002", "scene-003"],
        cameraPlan: [
          { sceneId: "scene-001", shot: "wide", motion: "static" },
          { sceneId: "scene-003", shot: "close-up", motion: "static" },
        ],
        overlays: [{ sceneId: "scene-003", type: "highlight", description: "강조" }],
      }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-004"] }),
    ]);

    const result = splitSequence(p, scenes, "sequence-001", "scene-001");
    if ("error" in result) throw new Error(result.error);
    expect(result.plan.sequences).toHaveLength(3);

    const first = seqById(result.plan, "sequence-001");
    expect(first.sceneIds).toEqual(["scene-001"]);
    expect(first.order).toBe(1);
    expect(first.cameraPlan).toEqual([{ sceneId: "scene-001", shot: "wide", motion: "static" }]);
    expect(first.estimatedDurationSec).toBe(deriveSequenceDurationSec(["scene-001"], scenes));

    const secondHalfId = result.plan.sequences.find(
      (s) => s.id !== "sequence-001" && s.id !== "sequence-002"
    )!.id;
    const secondHalf = seqById(result.plan, secondHalfId);
    expect(secondHalf.sceneIds).toEqual(["scene-002", "scene-003"]);
    expect(secondHalf.order).toBe(2);
    expect(secondHalf.overlays).toEqual([{ sceneId: "scene-003", type: "highlight", description: "강조" }]);
    expect(secondHalf.estimatedDurationSec).toBe(deriveSequenceDurationSec(["scene-002", "scene-003"], scenes));

    // The originally-second sequence is pushed to order 3 by the split.
    const originalSecond = seqById(result.plan, "sequence-002");
    expect(originalSecond.order).toBe(3);
  });

  it("rejects a split point that would leave the second half empty (last scene of the sequence)", () => {
    const scenes = sixScenes();
    const result = splitSequence(threeSequencePlan(), scenes, "sequence-001", "scene-002");
    expect("error" in result).toBe(true);
  });

  it("rejects a split scene id that does not belong to the given sequence", () => {
    const scenes = sixScenes();
    const result = splitSequence(threeSequencePlan(), scenes, "sequence-001", "scene-005");
    expect("error" in result).toBe(true);
  });

  it("rejects an unknown sequence id", () => {
    const scenes = sixScenes();
    const result = splitSequence(threeSequencePlan(), scenes, "sequence-999", "scene-001");
    expect("error" in result).toBe(true);
  });
});

/** Test-only helper to seed a sequence's masterVisual.status for stale-marking assertions above. */
function updateMasterVisualStatusHelper(
  p: SequencePlan,
  sequenceId: string,
  status: Sequence["masterVisual"]["status"]
): SequencePlan {
  return {
    ...p,
    sequences: p.sequences.map((s) => (s.id === sequenceId ? { ...s, masterVisual: { ...s.masterVisual, status } } : s)),
  };
}
