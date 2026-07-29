import { describe, it, expect } from "vitest";
import { computeVisualDesign, SCREEN_TYPE_OPTIONS } from "./index";
import type { Scene } from "../pipeline/splitScenes";
import type { ScreenTypeAssignment } from "../pipeline/selectScreenTypes";

const scene: Scene = {
  id: "scene-001",
  order: 1,
  narrationText: "변수는 let과 const로 선언할 수 있습니다.",
  estimatedDurationSec: 10,
  splitReason: "주제 전환",
};

describe("computeVisualDesign", () => {
  it("produces a full VisualDesign for every canonical screen type, with no AI call", () => {
    for (const screenType of SCREEN_TYPE_OPTIONS) {
      const assignment: ScreenTypeAssignment = {
        screenType,
        recommendedLayout: "기본",
        rationale: "",
        caption: "변수 선언 방법 요약",
      };
      const design = computeVisualDesign(scene, assignment);

      expect(design.caption).toBe("변수 선언 방법 요약");
      expect(design.keywords.length).toBeGreaterThan(0);
      expect(design.imageOrDiagramDescription.length).toBeGreaterThan(0);
      expect(design.objectPlacement.length).toBeGreaterThan(0);
      expect(design.appearanceOrder.length).toBeGreaterThan(0);
      expect(design.productionNotes.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a generic template for an unrecognized screen type", () => {
    const assignment: ScreenTypeAssignment = {
      screenType: "존재하지않는유형",
      recommendedLayout: "기본",
      rationale: "",
      caption: "요약",
    };
    const design = computeVisualDesign(scene, assignment);
    expect(design.imageOrDiagramDescription).toContain("이미지");
  });

  it("appends the AI's rationale to production notes when present", () => {
    const assignment: ScreenTypeAssignment = {
      screenType: "텍스트 강조형",
      recommendedLayout: "중앙 텍스트",
      rationale: "핵심 개념 정의라서",
      caption: "요약",
    };
    const design = computeVisualDesign(scene, assignment);
    expect(design.productionNotes).toContain("핵심 개념 정의라서");
  });

  it("uses the AI-provided caption verbatim, never truncating it with an ellipsis", () => {
    const longCaption = "이 자막은 나레이션 원문과 무관하게 AI가 새로 요약한, 원문보다 훨씬 긴 완결된 문장일 수도 있습니다";
    const assignment: ScreenTypeAssignment = {
      screenType: "텍스트 강조형",
      recommendedLayout: "",
      rationale: "",
      caption: longCaption,
    };
    const design = computeVisualDesign(scene, assignment);
    expect(design.caption).toBe(longCaption);
    expect(design.caption).not.toContain("…");
  });

  it("falls back to the full narration text (not a truncated one) when the AI caption is missing", () => {
    const assignment: ScreenTypeAssignment = {
      screenType: "텍스트 강조형",
      recommendedLayout: "",
      rationale: "",
      caption: "",
    };
    const design = computeVisualDesign(scene, assignment);
    expect(design.caption).toBe(scene.narrationText);
    expect(design.caption).not.toContain("…");
  });
});
