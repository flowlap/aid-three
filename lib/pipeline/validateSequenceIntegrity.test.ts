import { describe, it, expect } from "vitest";
import type { Scene } from "./splitScenes";
import type { Sequence, SequencePlan } from "./sequenceTypes";
import { validateSequenceIntegrity } from "./validateSequenceIntegrity";

function scene(overrides: Partial<Scene> & { id: string; order: number }): Scene {
  return {
    narrationText: "내레이션 텍스트",
    estimatedDurationSec: 10,
    splitReason: "테스트용 분절",
    ...overrides,
  };
}

function titleScene(overrides: Partial<Scene> & { id: string; order: number }): Scene {
  return scene({ sceneType: "title", depth: 1, estimatedDurationSec: 0, ...overrides });
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

/** Four ordinary content scenes, 10 seconds each, no title scenes. */
function fourContentScenes(): Scene[] {
  return [
    scene({ id: "scene-001", order: 1 }),
    scene({ id: "scene-002", order: 2 }),
    scene({ id: "scene-003", order: 3 }),
    scene({ id: "scene-004", order: 4 }),
  ];
}

function typesOf(issues: { type: string }[]): string[] {
  return issues.map((i) => i.type);
}

describe("validateSequenceIntegrity", () => {
  it("returns no issues for a fully valid plan", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    expect(validateSequenceIntegrity(scenes, p)).toEqual([]);
  });

  it("returns no issues for an empty scenes.json and an empty plan", () => {
    expect(validateSequenceIntegrity([], plan([]))).toEqual([]);
  });

  it("returns no issues for an empty plan when scenes.json only has title scenes", () => {
    const scenes = [titleScene({ id: "scene-000", order: 0 })];
    expect(validateSequenceIntegrity(scenes, plan([]))).toEqual([]);
  });

  it("flags every content scene as missing when the plan has no sequences at all", () => {
    const scenes = fourContentScenes();
    const issues = validateSequenceIntegrity(scenes, plan([]));

    expect(issues.every((i) => i.type === "missing-scene-reference")).toBe(true);
    expect(issues.map((i) => i.sceneIds[0]).sort()).toEqual(["scene-001", "scene-002", "scene-003", "scene-004"]);
  });

  it("flags an unknown scene id reference", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-999"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-002", "scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("unknown-scene-reference");
    const issue = issues.find((i) => i.type === "unknown-scene-reference")!;
    expect(issue.sceneIds).toEqual(["scene-999"]);
    expect(issue.sequenceId).toBe("sequence-001");
  });

  it("does not crash when a plan references a scene id removed by a later split/merge", () => {
    // Simulates: plan was authored against an old scenes.json, then scenes were
    // merged/split and scene-002 no longer exists.
    const scenes = [scene({ id: "scene-001", order: 1 }), scene({ id: "scene-003", order: 2 })];
    const p = plan([sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002"] })]);

    expect(() => validateSequenceIntegrity(scenes, p)).not.toThrow();
    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("unknown-scene-reference");
    // scene-003 now exists but is referenced by nothing.
    expect(issues.some((i) => i.type === "missing-scene-reference" && i.sceneIds.includes("scene-003"))).toBe(true);
  });

  it("flags a scene duplicated across two different sequences", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-002", "scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    const dup = issues.find((i) => i.type === "duplicate-scene-reference");
    expect(dup).toBeDefined();
    expect(dup!.sceneIds).toEqual(["scene-002"]);
  });

  it("flags a scene duplicated within a single sequence", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-001", "scene-002"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("duplicate-scene-reference");
  });

  it("flags a content scene that is referenced by no sequence", () => {
    const scenes = fourContentScenes();
    const p = plan([sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002", "scene-003"] })]);

    const issues = validateSequenceIntegrity(scenes, p);
    const missing = issues.find((i) => i.type === "missing-scene-reference");
    expect(missing).toBeDefined();
    expect(missing!.sceneIds).toEqual(["scene-004"]);
  });

  it("flags an empty sceneIds array in a sequence", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: [] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-001", "scene-002", "scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    const empty = issues.find((i) => i.type === "empty-sequence");
    expect(empty).toBeDefined();
    expect(empty!.sequenceId).toBe("sequence-001");
  });

  it("flags sequences placed out of order relative to underlying scene order", () => {
    const scenes = fourContentScenes();
    // sequence-001 (order:1) covers later scenes, sequence-002 (order:2) covers earlier ones.
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-003", "scene-004"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-001", "scene-002"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("scene-order-mismatch");
  });

  it("flags scenes out of relative order within a single sequence", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-002", "scene-001"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("scene-order-mismatch");
  });

  it("flags non-finite estimatedDurationSec", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002", "scene-003", "scene-004"],
        estimatedDurationSec: NaN,
      }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("invalid-duration");
  });

  it("flags negative estimatedDurationSec", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002", "scene-003", "scene-004"],
        estimatedDurationSec: -5,
      }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("invalid-duration");
  });

  it("flags a duration mismatch beyond tolerance without trusting the stored value", () => {
    const scenes = fourContentScenes(); // 2 scenes * 10s = 20s derived total for sequence-001
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002"],
        estimatedDurationSec: 100, // wildly different from the derived 20s
      }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    const mismatch = issues.find((i) => i.type === "duration-mismatch");
    expect(mismatch).toBeDefined();
    expect(mismatch!.severity).toBe("warning");
    expect(mismatch!.sequenceId).toBe("sequence-001");
  });

  it("does not flag a small duration estimate difference within tolerance", () => {
    const scenes = fourContentScenes(); // 20s derived total for sequence-001
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002"],
        estimatedDurationSec: 20.5, // within 5%/1s tolerance of derived 20s
      }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).not.toContain("duration-mismatch");
  });

  it("flags a duplicate sequence id", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002"] }),
      sequence({ id: "sequence-001", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("duplicate-sequence-id");
  });

  it("flags a missing (empty) sequence id", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({ id: "", order: 1, sceneIds: ["scene-001", "scene-002"] }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    expect(typesOf(issues)).toContain("missing-sequence-id");
  });

  it("flags a camera plan entry referencing a scene outside its own sequence", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002"],
        cameraPlan: [{ sceneId: "scene-003", shot: "wide", motion: "static" }],
      }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    const cam = issues.find((i) => i.type === "camera-plan-scene-mismatch");
    expect(cam).toBeDefined();
    expect(cam!.sceneIds).toEqual(["scene-003"]);
    expect(cam!.sequenceId).toBe("sequence-001");
  });

  it("flags an overlay entry referencing a scene outside its own sequence", () => {
    const scenes = fourContentScenes();
    const p = plan([
      sequence({
        id: "sequence-001",
        order: 1,
        sceneIds: ["scene-001", "scene-002"],
        overlays: [{ sceneId: "scene-004", type: "label", description: "잘못된 참조" }],
      }),
      sequence({ id: "sequence-002", order: 2, sceneIds: ["scene-003", "scene-004"] }),
    ]);

    const issues = validateSequenceIntegrity(scenes, p);
    const overlay = issues.find((i) => i.type === "overlay-scene-mismatch");
    expect(overlay).toBeDefined();
    expect(overlay!.sceneIds).toEqual(["scene-004"]);
    expect(overlay!.sequenceId).toBe("sequence-001");
  });

  describe("title scene policy", () => {
    it("is valid even though it never mentions title scene ids", () => {
      const scenes = [
        titleScene({ id: "scene-000", order: 0 }),
        scene({ id: "scene-001", order: 1 }),
        scene({ id: "scene-002", order: 2 }),
      ];
      const p = plan([sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-001", "scene-002"] })]);

      expect(validateSequenceIntegrity(scenes, p)).toEqual([]);
    });

    it("flags including a title scene id in sceneIds as a policy violation", () => {
      const scenes = [
        titleScene({ id: "scene-000", order: 0 }),
        scene({ id: "scene-001", order: 1 }),
        scene({ id: "scene-002", order: 2 }),
      ];
      const p = plan([
        sequence({ id: "sequence-001", order: 1, sceneIds: ["scene-000", "scene-001", "scene-002"] }),
      ]);

      const issues = validateSequenceIntegrity(scenes, p);
      const titleIssue = issues.find((i) => i.type === "title-scene-included");
      expect(titleIssue).toBeDefined();
      expect(titleIssue!.sceneIds).toEqual(["scene-000"]);
      // A title scene reference must not also count toward exactly-once
      // bookkeeping for content scenes (it's neither missing nor duplicated).
      expect(typesOf(issues)).not.toContain("missing-scene-reference");
    });
  });
});
