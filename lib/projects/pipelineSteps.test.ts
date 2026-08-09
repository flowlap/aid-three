import { describe, it, expect } from "vitest";
import { getPipelineSteps } from "./pipelineSteps";
import { getProductionMode, type ProjectMeta } from "./types";

describe("getPipelineSteps", () => {
  it("returns the scene-mode step list in order, without a sequences step", () => {
    const steps = getPipelineSteps("scene");
    expect(steps.map((s) => s.key)).toEqual([
      "markdown",
      "scenes",
      "screen-design",
      "review",
      "images",
      "storyboard",
    ]);
  });

  it("returns the sequence-mode step list in order, without a separate screen-design step (absorbed into sequences)", () => {
    const steps = getPipelineSteps("sequence");
    expect(steps.map((s) => s.key)).toEqual([
      "markdown",
      "scenes",
      "sequences",
      "review",
      "images",
      "storyboard",
    ]);
  });

  it("keeps the existing Korean labels unchanged for shared steps", () => {
    const sceneSteps = getPipelineSteps("scene");
    const labelByKey = Object.fromEntries(sceneSteps.map((s) => [s.key, s.label]));
    expect(labelByKey).toEqual({
      markdown: "원고 변환",
      scenes: "씬 분할",
      "screen-design": "화면 설계",
      review: "일관성 검수",
      images: "이미지/목업 생성",
      storyboard: "최종 뷰",
    });
  });

  it("gives the new sequences step a non-empty Korean label", () => {
    const sequenceSteps = getPipelineSteps("sequence");
    const sequencesStep = sequenceSteps.find((s) => s.key === "sequences");
    expect(sequencesStep?.label).toBeTruthy();
    expect(sequencesStep?.label).not.toEqual("sequences");
  });

  it("does not mutate one mode's list when reading the other", () => {
    const scene1 = getPipelineSteps("scene");
    getPipelineSteps("sequence");
    const scene2 = getPipelineSteps("scene");
    expect(scene2.map((s) => s.key)).toEqual(scene1.map((s) => s.key));
  });

  it("treats a legacy project with no productionMode exactly like an explicit scene-mode project", () => {
    const legacyProject: ProjectMeta = {
      id: "11111111-1111-4111-8111-111111111111",
      title: "legacy",
      createdAt: new Date().toISOString(),
      scriptType: "narration",
      currentStep: "scenes",
      // productionMode intentionally omitted
    };

    const legacySteps = getPipelineSteps(getProductionMode(legacyProject));
    const explicitSceneSteps = getPipelineSteps("scene");

    expect(legacySteps).toEqual(explicitSceneSteps);
  });
});
