import { describe, it, expect } from "vitest";
import { MockOpenAiImageClient } from "../ai/openaiImageClient.mock";
import { generateSceneImage, buildImagePrompt, buildRelatedScenesContext } from "./generateSceneImage";
import type { Scene } from "./splitScenes";
import type { VisualDesign } from "./designVisuals";

const scene: Scene = {
  id: "scene-001",
  order: 1,
  narrationText: "변수는 값을 저장하는 상자입니다.",
  estimatedDurationSec: 8,
  splitReason: "개념 도입",
};

const design: VisualDesign = {
  caption: "변수는 값을 저장하는 상자입니다.",
  keywords: ["변수", "상자"],
  imageOrDiagramDescription: "상자 안에 값이 담기는 모습을 보여주는 삽화",
  objectPlacement: "중앙",
  appearanceOrder: ["상자", "값"],
  productionNotes: "",
};

describe("generateSceneImage", () => {
  it("returns the image bytes from the client", async () => {
    const client = new MockOpenAiImageClient();
    const buffer = await generateSceneImage(client, scene, design);
    expect(buffer.length).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(1);
  });

  it("includes the visual description and narration in the prompt", () => {
    const prompt = buildImagePrompt(scene, design);
    expect(prompt).toContain("상자 안에 값이 담기는 모습을 보여주는 삽화");
    expect(prompt).toContain("변수는 값을 저장하는 상자입니다.");
  });

  it("forwards options (e.g. abort signal) to the client", async () => {
    const client = new MockOpenAiImageClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateSceneImage(client, scene, design, undefined, { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("tells the model not to render text for an illustration-style screen type", () => {
    const prompt = buildImagePrompt(scene, design, { screenType: "이미지 설명형" });
    expect(prompt).toContain("텍스트 렌더링 없이");
  });

  it("instructs the model to summarize the caption and narration into short noun-phrase text for a title-card screen type", () => {
    const prompt = buildImagePrompt(scene, design, { screenType: "간지/타이틀형" });
    expect(prompt).toContain(design.caption);
    expect(prompt).toContain(scene.narrationText);
    expect(prompt).toContain("명사형");
    expect(prompt).not.toContain("텍스트 렌더링 없이");
  });

  it("always includes the broadcast/video production style instruction", () => {
    const withText = buildImagePrompt(scene, design, { screenType: "간지/타이틀형" });
    const withoutText = buildImagePrompt(scene, design, { screenType: "이미지 설명형" });
    expect(withText).toContain("유튜브 강의 영상이나 TV 교육 프로그램");
    expect(withoutText).toContain("유튜브 강의 영상이나 TV 교육 프로그램");
  });

  it("includes the common style guide when provided", () => {
    const prompt = buildImagePrompt(scene, design, { commonPrompt: "파스텔톤 플랫 디자인, 보라색 강조" });
    expect(prompt).toContain("파스텔톤 플랫 디자인, 보라색 강조");
  });

  it("omits the style guide section when no common prompt is given", () => {
    const prompt = buildImagePrompt(scene, design);
    expect(prompt).not.toContain("공통 스타일 가이드");
  });

  it("includes the 4-shot presenter instruction when presenterEnabled is true", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true });
    expect(prompt).toContain("아나운서(발표자)가 등장해야 합니다");
    expect(prompt).toContain("좌측 등장");
    expect(prompt).toContain("우측 등장");
    expect(prompt).toContain("중앙 등장");
    expect(prompt).toContain("풀샷");
  });

  it("omits the presenter instruction when presenterEnabled is false or unset", () => {
    expect(buildImagePrompt(scene, design)).not.toContain("아나운서");
    expect(buildImagePrompt(scene, design, { presenterEnabled: false })).not.toContain("아나운서");
  });

  it("skips the presenter instruction for transition/title screens even when presenterEnabled is true", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, screenType: "간지/타이틀형" });
    expect(prompt).not.toContain("아나운서");
  });

  it("still includes the presenter instruction for non-transition screen types", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, screenType: "표/그래프형" });
    expect(prompt).toContain("아나운서(발표자)가 등장해야 합니다");
  });

  it("names the exact pre-decided presenter position instead of offering all 4 choices", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, presenterPosition: "right" });
    expect(prompt).toContain("우측 등장(화면 우측에 상반신, 좌측에 시각 자료) 형태로 등장해야 합니다");
    // Shouldn't be re-listing the other 3 options once a position was already decided.
    expect(prompt).not.toContain("다음 4가지 중에서");
  });

  it("falls back to the 4-choice instruction when no presenterPosition was decided", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true });
    expect(prompt).toContain("다음 4가지 중에서");
  });

  it("includes related scenes as reference material when provided", () => {
    const prompt = buildImagePrompt(scene, design, {
      relatedScenes: [{ sceneId: "scene-003", caption: "배출권 ETF", imageOrDiagramDescription: "탄소 가격 그래프" }],
    });
    expect(prompt).toContain("관련 씬 참고자료");
    expect(prompt).toContain("scene-003");
    expect(prompt).toContain("배출권 ETF");
    expect(prompt).toContain("탄소 가격 그래프");
  });

  it("omits the related scenes section when there are none", () => {
    const prompt = buildImagePrompt(scene, design);
    expect(prompt).not.toContain("관련 씬 참고자료");
  });
});

describe("buildRelatedScenesContext", () => {
  const visualDesigns: Record<string, VisualDesign> = {
    "scene-003": { ...design, caption: "배출권 ETF", imageOrDiagramDescription: "탄소 가격 그래프" },
    "scene-004": { ...design, caption: "친환경차 목표제", imageOrDiagramDescription: "전기차 아이콘" },
  };

  it("resolves relatedSceneIds into context entries from an already-loaded visualDesigns map", () => {
    const sceneWithRelations: Scene = { ...scene, relatedSceneIds: ["scene-003", "scene-004"] };
    const context = buildRelatedScenesContext(sceneWithRelations, visualDesigns);
    expect(context).toEqual([
      { sceneId: "scene-003", caption: "배출권 ETF", imageOrDiagramDescription: "탄소 가격 그래프" },
      { sceneId: "scene-004", caption: "친환경차 목표제", imageOrDiagramDescription: "전기차 아이콘" },
    ]);
  });

  it("skips related ids that have no design yet", () => {
    const sceneWithRelations: Scene = { ...scene, relatedSceneIds: ["scene-003", "scene-999"] };
    const context = buildRelatedScenesContext(sceneWithRelations, visualDesigns);
    expect(context).toEqual([{ sceneId: "scene-003", caption: "배출권 ETF", imageOrDiagramDescription: "탄소 가격 그래프" }]);
  });

  it("returns an empty array when the scene has no relatedSceneIds", () => {
    expect(buildRelatedScenesContext(scene, visualDesigns)).toEqual([]);
  });
});
