import { describe, it, expect } from "vitest";
import { computeVisualDesign, computeMockupVariantIndexes, personGoesOnRight, SCREEN_TYPE_OPTIONS, SCREEN_TYPE_INFO } from "./index";
import type { Scene } from "../pipeline/splitScenes";
import type { ScreenTypeAssignment } from "../pipeline/selectScreenTypes";

const scene: Scene = {
  id: "scene-001",
  order: 1,
  narrationText: "변수는 let과 const로 선언할 수 있습니다.",
  estimatedDurationSec: 10,
  splitReason: "주제 전환",
};

function makeAssignment(overrides: Partial<ScreenTypeAssignment> & { screenType: string }): ScreenTypeAssignment {
  return {
    recommendedLayout: "기본",
    rationale: "",
    caption: "변수 선언 방법 요약",
    keywords: ["let", "const", "변수 선언"],
    imageOrDiagramDescription: "",
    objectPlacement: "",
    ...overrides,
  };
}

describe("SCREEN_TYPE_INFO", () => {
  it("has a non-empty description for every screen type option", () => {
    for (const type of SCREEN_TYPE_OPTIONS) {
      expect(SCREEN_TYPE_INFO[type].length).toBeGreaterThan(0);
    }
  });
});

describe("computeVisualDesign", () => {
  it("produces a full VisualDesign for every canonical screen type, with no AI call", () => {
    for (const screenType of SCREEN_TYPE_OPTIONS) {
      const design = computeVisualDesign(scene, makeAssignment({ screenType }));

      expect(design.caption).toBe("변수 선언 방법 요약");
      expect(design.keywords).toEqual(["let", "const", "변수 선언"]);
      expect(design.imageOrDiagramDescription.length).toBeGreaterThan(0);
      expect(design.objectPlacement.length).toBeGreaterThan(0);
      expect(design.appearanceOrder.length).toBeGreaterThan(0);
      expect(design.productionNotes.length).toBeGreaterThan(0);
    }
  });

  it("falls back to a generic template for an unrecognized screen type", () => {
    const design = computeVisualDesign(scene, makeAssignment({ screenType: "존재하지않는유형" }));
    expect(design.imageOrDiagramDescription).toContain("이미지");
  });

  it("appends the AI's rationale to production notes when present", () => {
    const assignment = makeAssignment({ screenType: "텍스트 강조형", rationale: "핵심 개념 정의라서" });
    const design = computeVisualDesign(scene, assignment);
    expect(design.productionNotes).toContain("핵심 개념 정의라서");
  });

  it("uses the AI-provided caption verbatim, never truncating it with an ellipsis", () => {
    const longCaption = "이 자막은 나레이션 원문과 무관하게 AI가 새로 요약한, 원문보다 훨씬 긴 완결된 문장일 수도 있습니다";
    const assignment = makeAssignment({ screenType: "텍스트 강조형", caption: longCaption });
    const design = computeVisualDesign(scene, assignment);
    expect(design.caption).toBe(longCaption);
    expect(design.caption).not.toContain("…");
  });

  it("falls back to the full narration text (not a truncated one) when the AI caption is missing", () => {
    const assignment = makeAssignment({ screenType: "텍스트 강조형", caption: "" });
    const design = computeVisualDesign(scene, assignment);
    expect(design.caption).toBe(scene.narrationText);
    expect(design.caption).not.toContain("…");
  });

  it("uses the AI-provided keywords verbatim, regardless of where they appear in the narration", () => {
    const longScene: Scene = {
      ...scene,
      narrationText: "이번 문장은 키워드 추출과 관련 없는 도입부이고, 정작 핵심은 맨 끝에 나오는 재귀함수 최적화입니다.",
    };
    const assignment = makeAssignment({ screenType: "텍스트 강조형", keywords: ["재귀함수", "최적화"] });
    const design = computeVisualDesign(longScene, assignment);
    expect(design.keywords).toEqual(["재귀함수", "최적화"]);
  });

  it("falls back to local extraction only when the AI keywords are missing", () => {
    const assignment = makeAssignment({ screenType: "텍스트 강조형", keywords: [] });
    const design = computeVisualDesign(scene, assignment);
    expect(design.keywords.length).toBeGreaterThan(0);
  });

  it("prefers the AI's scene-specific objectPlacement/imageOrDiagramDescription over the generic template", () => {
    const assignment = makeAssignment({
      screenType: "텍스트 강조형",
      objectPlacement: "인물은 좌측 1/3, 그래프는 우측 2/3",
      imageOrDiagramDescription: "배출권 ETF 가격 추이 꺾은선 그래프",
    });
    const design = computeVisualDesign(scene, assignment);
    expect(design.objectPlacement).toBe("인물은 좌측 1/3, 그래프는 우측 2/3");
    expect(design.imageOrDiagramDescription).toBe("배출권 ETF 가격 추이 꺾은선 그래프");
  });

  it("falls back to the generic template's objectPlacement/imageOrDiagramDescription when the AI didn't supply them", () => {
    const assignment = makeAssignment({ screenType: "텍스트 강조형" });
    const design = computeVisualDesign(scene, assignment);
    expect(design.objectPlacement.length).toBeGreaterThan(0);
    expect(design.imageOrDiagramDescription.length).toBeGreaterThan(0);
  });

  it("passes through the AI's layoutElements untouched", () => {
    const assignment = makeAssignment({
      screenType: "텍스트 강조형",
      layoutElements: [{ label: "핵심 문구", position: "center" }],
    });
    const design = computeVisualDesign(scene, assignment);
    expect(design.layoutElements).toEqual([{ label: "핵심 문구", position: "center" }]);
  });

  it("leaves layoutElements undefined when the AI didn't supply it", () => {
    const assignment = makeAssignment({ screenType: "텍스트 강조형" });
    const design = computeVisualDesign(scene, assignment);
    expect(design.layoutElements).toBeUndefined();
  });

  it("passes through the AI's presenterPosition untouched", () => {
    const assignment = makeAssignment({ screenType: "텍스트 강조형", presenterPosition: "right" });
    const design = computeVisualDesign(scene, assignment);
    expect(design.presenterPosition).toBe("right");
  });
});

describe("personGoesOnRight", () => {
  it("returns false when the person is placed on the left", () => {
    expect(personGoesOnRight("인물은 화면 좌측 1/3, 텍스트는 반대쪽")).toBe(false);
  });

  it("returns true when the person is placed on the right", () => {
    expect(personGoesOnRight("텍스트는 좌측, 인물은 우측에 배치")).toBe(true);
  });

  it("does not get confused by other elements' left/right placement in the same sentence", () => {
    expect(personGoesOnRight("인물은 화면 좌측 1/3, 그래프는 우측 2/3")).toBe(false);
  });

  it("defaults to false (left) when no direction is mentioned", () => {
    expect(personGoesOnRight("중앙 배치")).toBe(false);
  });
});

describe("computeMockupVariantIndexes", () => {
  it("cycles through variants for a repeat-prone type so consecutive occurrences differ", () => {
    const scenes: Scene[] = ["a", "b", "c", "d"].map((id, i) => ({
      id: `scene-${id}`,
      order: i + 1,
      narrationText: "x",
      estimatedDurationSec: 5,
      splitReason: "",
    }));
    const screenTypes: Record<string, ScreenTypeAssignment> = {
      "scene-a": makeAssignment({ screenType: "텍스트 강조형" }),
      "scene-b": makeAssignment({ screenType: "텍스트 강조형" }),
      "scene-c": makeAssignment({ screenType: "텍스트 강조형" }),
      "scene-d": makeAssignment({ screenType: "텍스트 강조형" }),
    };

    const variants = computeMockupVariantIndexes(scenes, screenTypes);

    expect(variants["scene-a"]).toBe(0);
    expect(variants["scene-b"]).toBe(1);
    expect(variants["scene-c"]).toBe(2);
    expect(variants["scene-d"]).toBe(0); // wraps back around after 3 variants
    expect(variants["scene-a"]).not.toBe(variants["scene-b"]);
  });

  it("does not assign a variant for screen types without configured variation", () => {
    const scenes: Scene[] = [{ id: "scene-x", order: 1, narrationText: "x", estimatedDurationSec: 5, splitReason: "" }];
    const screenTypes: Record<string, ScreenTypeAssignment> = {
      "scene-x": makeAssignment({ screenType: "체크리스트형" }),
    };

    expect(computeMockupVariantIndexes(scenes, screenTypes)).toEqual({});
  });
});
