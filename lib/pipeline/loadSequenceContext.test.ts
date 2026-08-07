import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { createProject, writeProjectFile, writeSequencePlan } from "@/lib/projects/store";
import { loadSequenceContextByScene } from "./loadSequenceContext";
import type { Scene } from "./splitScenes";
import type { SequencePlan } from "./sequenceTypes";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "load-sequence-context-"));
  process.env.PROJECTS_DATA_DIR = tempRoot;
});

afterEach(async () => {
  delete process.env.PROJECTS_DATA_DIR;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

const scenes: Scene[] = [
  { id: "scene-001", order: 1, narrationText: "나레이션 1", estimatedDurationSec: 5, splitReason: "테스트" },
];

function makePlan(): SequencePlan {
  return {
    version: 1,
    sequences: [
      {
        id: "sequence-001",
        order: 1,
        title: "도입부",
        sceneIds: ["scene-001"],
        estimatedDurationSec: 5,
        purpose: "개념 소개",
        continuity: { location: "사무실", visualStyle: "플랫 일러스트", fixedElements: [], doNotChange: [] },
        masterVisual: { description: "사무실 배경", status: "not-generated" },
        cameraPlan: [],
        overlays: [],
      },
    ],
  };
}

describe("loadSequenceContextByScene", () => {
  it("returns the loaded plan alongside sequenceContextByScene on success", async () => {
    const project = await createProject("샘플", "script", "sequence");
    await writeProjectFile(project.id, "scenes.json", JSON.stringify({ scenes }));
    const plan = makePlan();
    await writeSequencePlan(project.id, plan);

    const result = await loadSequenceContextByScene(project.id, scenes);

    expect("errorResponse" in result).toBe(false);
    if ("errorResponse" in result) throw new Error("unreachable");
    expect(result.plan).toEqual(plan);
    expect(result.sequenceContextByScene["scene-001"]).toBeDefined();
  });

  it("returns an errorResponse when no sequence plan exists", async () => {
    const project = await createProject("샘플", "script", "sequence");
    await writeProjectFile(project.id, "scenes.json", JSON.stringify({ scenes }));

    const result = await loadSequenceContextByScene(project.id, scenes);

    expect("errorResponse" in result).toBe(true);
  });
});
