import { describe, it, expect } from "vitest";
import { buildSequenceTimeline } from "./buildSequenceTimeline";
import { SCENE_BREAK_HOLD_SEC } from "./buildVideoClip";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { Sequence, SequencePlan } from "@/lib/pipeline/sequenceTypes";

function makeScene(overrides: Partial<Scene> & Pick<Scene, "id" | "order">): Scene {
  return {
    narrationText: "나레이션",
    estimatedDurationSec: 5,
    splitReason: "테스트",
    ...overrides,
  };
}

function makeSequence(overrides: Partial<Sequence> & Pick<Sequence, "id" | "order" | "sceneIds">): Sequence {
  return {
    title: "시퀀스",
    estimatedDurationSec: 10,
    purpose: "",
    continuity: {
      location: "",
      visualStyle: "",
      fixedElements: [],
      doNotChange: [],
    },
    masterVisual: { description: "", status: "not-generated" },
    cameraPlan: [],
    overlays: [],
    ...overrides,
  };
}

describe("buildSequenceTimeline", () => {
  it("computes cumulative startSec/clipDurationSec including the scene-break hold", () => {
    const scenes: Scene[] = [
      makeScene({ id: "scene-001", order: 1, sceneType: "title" }),
      makeScene({ id: "scene-002", order: 2 }),
      makeScene({ id: "scene-003", order: 3 }),
    ];
    const plan: SequencePlan = {
      version: 1,
      sequences: [makeSequence({ id: "sequence-001", order: 1, sceneIds: ["scene-002", "scene-003"] })],
    };
    const durations = { "scene-001": 3, "scene-002": 4, "scene-003": 6 };

    const timeline = buildSequenceTimeline(scenes, plan, durations);

    expect(timeline.entries).toHaveLength(3);
    expect(timeline.entries[0]).toMatchObject({
      sceneId: "scene-001",
      order: 0,
      startSec: 0,
      narrationDurationSec: 3,
      clipDurationSec: 3 + SCENE_BREAK_HOLD_SEC,
    });
    expect(timeline.entries[1]).toMatchObject({
      sceneId: "scene-002",
      startSec: 3 + SCENE_BREAK_HOLD_SEC,
      narrationDurationSec: 4,
      clipDurationSec: 4 + SCENE_BREAK_HOLD_SEC,
    });
    expect(timeline.entries[2]).toMatchObject({
      sceneId: "scene-003",
      startSec: 3 + SCENE_BREAK_HOLD_SEC + 4 + SCENE_BREAK_HOLD_SEC,
      narrationDurationSec: 6,
      clipDurationSec: 6 + SCENE_BREAK_HOLD_SEC,
    });
    const expectedTotal = 3 + 4 + 6 + 3 * SCENE_BREAK_HOLD_SEC;
    expect(timeline.totalDurationSec).toBeCloseTo(expectedTotal, 6);
  });

  it("defaults a missing duration entry to 0 without throwing", () => {
    const scenes: Scene[] = [makeScene({ id: "scene-001", order: 1 })];
    const plan: SequencePlan = { version: 1, sequences: [] };

    const timeline = buildSequenceTimeline(scenes, plan, {});

    expect(timeline.entries[0].narrationDurationSec).toBe(0);
    expect(timeline.entries[0].clipDurationSec).toBeCloseTo(SCENE_BREAK_HOLD_SEC, 6);
  });

  it("gives title scenes / unowned scenes sequenceId null, motion static, and no overlays -- even if a same-id camera/overlay entry exists elsewhere", () => {
    const scenes: Scene[] = [
      makeScene({ id: "title-scene", order: 1, sceneType: "title" }),
      makeScene({ id: "scene-002", order: 2 }),
    ];
    const plan: SequencePlan = {
      version: 1,
      sequences: [
        makeSequence({
          id: "sequence-001",
          order: 1,
          sceneIds: ["scene-002"],
          // Coincidentally-named entries for the title scene, which does NOT
          // belong to this sequence -- must not leak onto the title entry.
          cameraPlan: [{ sceneId: "title-scene", shot: "wide", motion: "pan-left" }],
          overlays: [{ sceneId: "title-scene", type: "label", description: "should not apply" }],
        }),
      ],
    };

    const timeline = buildSequenceTimeline(scenes, plan, { "title-scene": 2, "scene-002": 5 });

    const titleEntry = timeline.entries[0];
    expect(titleEntry.sequenceId).toBeNull();
    expect(titleEntry.motion).toBe("static");
    expect(titleEntry.overlays).toEqual([]);
  });

  it("defaults a content scene inside a sequence with no matching camera-plan entry to static", () => {
    const scenes: Scene[] = [makeScene({ id: "scene-002", order: 1 })];
    const plan: SequencePlan = {
      version: 1,
      sequences: [makeSequence({ id: "sequence-001", order: 1, sceneIds: ["scene-002"], cameraPlan: [] })],
    };

    const timeline = buildSequenceTimeline(scenes, plan, { "scene-002": 5 });

    expect(timeline.entries[0].sequenceId).toBe("sequence-001");
    expect(timeline.entries[0].motion).toBe("static");
  });

  it("applies a matching camera-plan entry's motion to its own scene", () => {
    const scenes: Scene[] = [makeScene({ id: "scene-002", order: 1 })];
    const plan: SequencePlan = {
      version: 1,
      sequences: [
        makeSequence({
          id: "sequence-001",
          order: 1,
          sceneIds: ["scene-002"],
          cameraPlan: [{ sceneId: "scene-002", shot: "medium", motion: "slow-push-in" }],
        }),
      ],
    };

    const timeline = buildSequenceTimeline(scenes, plan, { "scene-002": 5 });

    expect(timeline.entries[0].motion).toBe("slow-push-in");
  });

  it("sets boundary flags at the start/end of the whole timeline and at actual sequence transitions", () => {
    const scenes: Scene[] = [
      makeScene({ id: "s1", order: 1 }),
      makeScene({ id: "s2", order: 2 }),
      makeScene({ id: "s3", order: 3 }),
      makeScene({ id: "s4", order: 4 }),
    ];
    const plan: SequencePlan = {
      version: 1,
      sequences: [
        makeSequence({ id: "sequence-001", order: 1, sceneIds: ["s1", "s2"] }),
        makeSequence({ id: "sequence-002", order: 2, sceneIds: ["s3", "s4"] }),
      ],
    };
    const durations = { s1: 3, s2: 3, s3: 3, s4: 3 };

    const timeline = buildSequenceTimeline(scenes, plan, durations);
    const [e1, e2, e3, e4] = timeline.entries;

    // Very first/last scenes overall.
    expect(e1.isSequenceBoundaryStart).toBe(true);
    expect(e4.isSequenceBoundaryEnd).toBe(true);

    // Interior scene within a sequence: no boundary either side.
    expect(e1.isSequenceBoundaryEnd).toBe(false);
    expect(e4.isSequenceBoundaryStart).toBe(false);

    // Real transition between sequence-001 and sequence-002.
    expect(e2.isSequenceBoundaryEnd).toBe(true);
    expect(e3.isSequenceBoundaryStart).toBe(true);
    expect(e2.isSequenceBoundaryStart).toBe(false);
    expect(e3.isSequenceBoundaryEnd).toBe(false);
  });

  it("treats a transition into/out of null sequenceId as a boundary too", () => {
    const scenes: Scene[] = [
      makeScene({ id: "title", order: 1, sceneType: "title" }),
      makeScene({ id: "s1", order: 2 }),
      makeScene({ id: "s2", order: 3 }),
    ];
    const plan: SequencePlan = {
      version: 1,
      sequences: [makeSequence({ id: "sequence-001", order: 1, sceneIds: ["s1", "s2"] })],
    };

    const timeline = buildSequenceTimeline(scenes, plan, { title: 2, s1: 3, s2: 3 });
    const [titleEntry, s1Entry] = timeline.entries;

    expect(titleEntry.sequenceId).toBeNull();
    expect(titleEntry.isSequenceBoundaryEnd).toBe(true);
    expect(s1Entry.sequenceId).toBe("sequence-001");
    expect(s1Entry.isSequenceBoundaryStart).toBe(true);
  });

  it("attaches overlays only to their own scene", () => {
    const scenes: Scene[] = [
      makeScene({ id: "s1", order: 1 }),
      makeScene({ id: "s2", order: 2 }),
    ];
    const plan: SequencePlan = {
      version: 1,
      sequences: [
        makeSequence({
          id: "sequence-001",
          order: 1,
          sceneIds: ["s1", "s2"],
          overlays: [
            { sceneId: "s1", type: "label", description: "s1 label" },
            { sceneId: "s2", type: "chart", description: "s2 chart" },
            { sceneId: "s2", type: "highlight", description: "s2 highlight" },
          ],
        }),
      ],
    };

    const timeline = buildSequenceTimeline(scenes, plan, { s1: 3, s2: 3 });

    expect(timeline.entries[0].overlays).toEqual([{ sceneId: "s1", type: "label", description: "s1 label" }]);
    expect(timeline.entries[1].overlays).toEqual([
      { sceneId: "s2", type: "chart", description: "s2 chart" },
      { sceneId: "s2", type: "highlight", description: "s2 highlight" },
    ]);
  });
});
