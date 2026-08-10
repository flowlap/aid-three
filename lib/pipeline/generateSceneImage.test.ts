import { describe, it, expect, vi } from "vitest";
import { MockImageClient } from "../ai/image/mockImageClient";
import { ImageApiError, NoImageDataError, type ImageClient, type ImageGenerateOptions } from "../ai/image/types";
import {
  generateSceneImage,
  generateSceneImageWithRetry,
  isRateLimitError,
  describeImageError,
  buildImagePrompt,
  buildRelatedScenesContext,
  NO_TEXT_INSTRUCTION,
} from "./generateSceneImage";
import {
  IMAGE_GENERATION_RETRY_DELAY_MS,
  IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS,
  IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES,
} from "./imageGenerationConfig";
import type { Scene } from "./splitScenes";
import type { VisualDesign } from "./designVisuals";
import type { SceneSequenceContext } from "./selectScreenTypes";

/** A stub image client whose successive calls fail/succeed per a fixed script — lets retry tests control exactly when a call succeeds without real network calls. */
class ScriptedImageClient implements ImageClient {
  calls = 0;
  constructor(private readonly script: (Error | null)[]) {}

  async generateImage(_prompt: string, options?: ImageGenerateOptions): Promise<Buffer> {
    if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const outcome = this.script[Math.min(this.calls, this.script.length - 1)];
    this.calls += 1;
    if (outcome) throw outcome;
    return Buffer.from([1, 2, 3]);
  }
}

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
    const client = new MockImageClient();
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
    const client = new MockImageClient();
    const controller = new AbortController();
    controller.abort();

    await expect(
      generateSceneImage(client, scene, design, undefined, { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("forwards background and presenter reference images to the client and reflects that in the prompt", async () => {
    const client = new MockImageClient();
    const background = Buffer.from("bg");
    const presenter = Buffer.from("presenter");

    await generateSceneImage(client, scene, design, { presenterEnabled: true }, undefined, { background, presenter });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].options?.referenceImages).toEqual([background, presenter]);
    expect(client.calls[0].prompt).toContain("제공된 강사 참고 이미지와 동일한 인물");
  });

  it("omits referenceImages entirely from the client call when no reference images are given", async () => {
    const client = new MockImageClient();
    await generateSceneImage(client, scene, design);
    expect(client.calls[0].options?.referenceImages).toEqual([]);
  });

  it("forwards the style (톤앤매너 기준) reference image to the client and reflects that in the prompt", async () => {
    const client = new MockImageClient();
    const style = Buffer.from("style-guide");

    await generateSceneImage(client, scene, design, undefined, undefined, { style });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].options?.referenceImages).toEqual([style]);
    expect(client.calls[0].prompt).toContain("톤앤매너 기준 이미지와 동일한 색감");
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
    expect(prompt).toContain("강사(발표자)가 등장해야 합니다");
    expect(prompt).toContain("좌측 등장");
    expect(prompt).toContain("우측 등장");
    expect(prompt).toContain("중앙 등장");
    expect(prompt).toContain("풀샷");
  });

  it("omits the presenter instruction when presenterEnabled is false or unset", () => {
    expect(buildImagePrompt(scene, design)).not.toContain("강사");
    expect(buildImagePrompt(scene, design, { presenterEnabled: false })).not.toContain("강사");
  });

  it("skips the presenter instruction for transition/title screens even when presenterEnabled is true", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, screenType: "간지/타이틀형" });
    expect(prompt).not.toContain("강사");
  });

  it("still includes the presenter instruction for non-transition screen types", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, screenType: "표/그래프형" });
    expect(prompt).toContain("강사(발표자)가 등장해야 합니다");
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

  it("mentions the chosen gender when presenterGender is set and no reference image is attached", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, presenterGender: "female" });
    expect(prompt).toContain("여성 강사(발표자)가 등장해야 합니다");
  });

  it("switches to a match-this-person instruction when a presenter reference image is attached, ignoring gender text", () => {
    const prompt = buildImagePrompt(scene, design, {
      presenterEnabled: true,
      presenterGender: "male",
      hasPresenterReferenceImage: true,
    });
    expect(prompt).toContain("제공된 강사 참고 이미지와 동일한 인물");
    expect(prompt).not.toContain("남성 강사");
  });

  it("includes the background-fixed instruction only when backgroundFixed is true", () => {
    expect(buildImagePrompt(scene, design, { backgroundFixed: true })).toContain("배경 참고 이미지를 그대로 배경으로 사용");
    expect(buildImagePrompt(scene, design)).not.toContain("배경 참고 이미지");
  });

  it("includes the style-reference instruction only when hasStyleReferenceImage is true", () => {
    expect(buildImagePrompt(scene, design, { hasStyleReferenceImage: true })).toContain("톤앤매너 기준 이미지와 동일한 색감");
    expect(buildImagePrompt(scene, design)).not.toContain("톤앤매너 기준 이미지");
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

  it("forces the no-text instruction when allowTextInImage is false, even for a text-forward screen type", () => {
    const prompt = buildImagePrompt(scene, design, { screenType: "간지/타이틀형", allowTextInImage: false });
    expect(prompt).toContain("텍스트 렌더링 없이");
    expect(prompt).not.toContain("명사형");
  });

  it("keeps the default text-forward behavior when allowTextInImage is unset", () => {
    const prompt = buildImagePrompt(scene, design, { screenType: "간지/타이틀형" });
    expect(prompt).toContain("명사형");
  });

  it("inserts extraPrompt as a top-priority instruction when provided", () => {
    const prompt = buildImagePrompt(scene, design, { extraPrompt: "배경을 좀 더 밝게 해주세요" });
    expect(prompt).toContain("추가 수정 지시(이번 생성에서 최우선으로 반영하세요): 배경을 좀 더 밝게 해주세요");
  });

  it("omits the extraPrompt section when not provided or blank", () => {
    expect(buildImagePrompt(scene, design)).not.toContain("추가 수정 지시");
    expect(buildImagePrompt(scene, design, { extraPrompt: "   " })).not.toContain("추가 수정 지시");
  });

  it("locks accessories and pose freedom when a presenter reference image is attached", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, hasPresenterReferenceImage: true });
    expect(prompt).toContain("안경, 마이크, 액세서리 등을 새로 추가하거나 반대로 참고 이미지에 있던 것을 빼지 마세요");
    expect(prompt).toContain("자세, 손동작, 표정은 이 화면 내용에 맞게 자연스럽게 바꿔도 되지만");
  });

  it("keeps the presenter's likeness photorealistic over the common illustration style guide when a reference image is attached", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, hasPresenterReferenceImage: true });
    expect(prompt).toContain("공통 스타일 가이드가 일러스트 톤을 요구하더라도 강사 인물만큼은 예외로 실사 그대로의 화풍을 유지");
  });

  it("does not include the accessory/likeness lock when no presenter reference image is attached", () => {
    const prompt = buildImagePrompt(scene, design, { presenterEnabled: true, presenterGender: "female" });
    expect(prompt).not.toContain("안경, 마이크, 액세서리");
  });
});

describe("sequence mode", () => {
  const sequenceContext: SceneSequenceContext = {
    purpose: "개념 도입",
    continuity: {
      location: "사무실",
      visualStyle: "플랫 일러스트",
      fixedElements: ["책상", "창문"],
      doNotChange: ["벽 색상"],
    },
    masterVisualDescription: "사무실 배경의 인물",
    overlays: [],
  };

  it("forces the no-text instruction for a text-forward screen type, ignoring the caption-baking logic", () => {
    const prompt = buildImagePrompt(scene, design, {
      screenType: "간지/타이틀형",
      sequenceImageContext: sequenceContext,
    });
    expect(prompt).toContain(NO_TEXT_INSTRUCTION);
    expect(prompt).not.toContain("명사형");
  });

  it("includes the master-continuity-lock instruction when a master reference image is attached", () => {
    const prompt = buildImagePrompt(scene, design, {
      sequenceImageContext: sequenceContext,
      hasMasterReferenceImage: true,
    });
    expect(prompt).toContain("시퀀스 마스터 배경 참고 이미지");
    expect(prompt).toContain("배경 자체를 새로 그리거나 다른 배경으로 바꾸지 마세요");
  });

  it("falls back to the textual continuity instruction when no master reference image is attached yet", () => {
    const prompt = buildImagePrompt(scene, design, { sequenceImageContext: sequenceContext });
    expect(prompt).toContain("마스터 참고 이미지가 생성되지 않았습니다");
    expect(prompt).toContain(sequenceContext.continuity.location);
    expect(prompt).toContain(sequenceContext.masterVisualDescription);
  });

  it("reflects the planned camera shot and pan direction margin instruction", () => {
    const prompt = buildImagePrompt(scene, design, {
      sequenceImageContext: {
        ...sequenceContext,
        camera: { sceneId: scene.id, shot: "close-up", motion: "pan-left" },
      },
    });
    expect(prompt).toContain("클로즈업");
    expect(prompt).toContain("왼쪽 방향에 여백");
  });

  it("skips the camera framing block with no crash when no camera entry is planned for this scene", () => {
    expect(() => buildImagePrompt(scene, design, { sequenceImageContext: sequenceContext })).not.toThrow();
    const prompt = buildImagePrompt(scene, design, { sequenceImageContext: sequenceContext });
    expect(prompt).not.toContain("클로즈업");
  });

  it("includes the overlay-exclusion instruction even when this scene has no planned overlays", () => {
    const prompt = buildImagePrompt(scene, design, { sequenceImageContext: { ...sequenceContext, overlays: [] } });
    expect(prompt).toContain("결정론적 렌더러");
  });

  it("bake mode: includes the overlay-bake instruction with each overlay's type label and description instead of the exclusion instruction", () => {
    const prompt = buildImagePrompt(scene, design, {
      sequenceImageContext: {
        ...sequenceContext,
        overlays: [
          { sceneId: scene.id, type: "label", description: "매출 30% 증가" },
          { sceneId: scene.id, type: "chart", description: "분기별 매출 그래프" },
        ],
      },
      sequenceOverlayRenderMode: "bake",
    });
    expect(prompt).toContain("라벨(짧은 텍스트 태그)");
    expect(prompt).toContain("매출 30% 증가");
    expect(prompt).toContain("차트/그래프(실제 수치 포함)");
    expect(prompt).toContain("분기별 매출 그래프");
    expect(prompt).not.toContain("결정론적 렌더러");
  });

  it("bake mode: omits both the bake and exclusion instructions when this scene has no planned overlays", () => {
    const prompt = buildImagePrompt(scene, design, {
      sequenceImageContext: { ...sequenceContext, overlays: [] },
      sequenceOverlayRenderMode: "bake",
    });
    expect(prompt).not.toContain("결정론적 렌더러");
    expect(prompt).not.toContain("별도로 합성하는 렌더러가 없습니다");
  });

  it("bake mode: keeps the shot framing label but drops the pan/zoom margin instruction since AI-mode scenes render as a static frame", () => {
    const prompt = buildImagePrompt(scene, design, {
      sequenceImageContext: {
        ...sequenceContext,
        camera: { sceneId: scene.id, shot: "close-up", motion: "pan-left" },
      },
      sequenceOverlayRenderMode: "bake",
    });
    expect(prompt).toContain("클로즈업");
    expect(prompt).not.toContain("왼쪽 방향에 여백");
  });

  it("omitting sequenceOverlayRenderMode reproduces the exact same output as before that option existed (regression)", () => {
    const withoutMode = buildImagePrompt(scene, design, { sequenceImageContext: sequenceContext });
    const withExcludeMode = buildImagePrompt(scene, design, {
      sequenceImageContext: sequenceContext,
      sequenceOverlayRenderMode: "exclude",
    });
    expect(withExcludeMode).toBe(withoutMode);
  });

  it("keeps scene-mode output free of every sequence-mode-only instruction phrase", () => {
    const withOptions = buildImagePrompt(scene, design, {
      screenType: "간지/타이틀형",
      presenterEnabled: true,
      backgroundFixed: true,
      hasStyleReferenceImage: true,
    });
    const plain = buildImagePrompt(scene, design);
    for (const prompt of [withOptions, plain]) {
      expect(prompt).not.toContain("마스터");
      expect(prompt).not.toContain("카메라가 이동해 갈");
      expect(prompt).not.toContain("결정론적 렌더러");
    }
  });

  it("forwards referenceImages.master into hasMasterReferenceImage and as the first reference buffer", async () => {
    const client = new MockImageClient();
    const master = Buffer.from("master-plate");
    const style = Buffer.from("style-guide");

    await generateSceneImage(client, scene, design, { sequenceImageContext: sequenceContext }, undefined, {
      master,
      style,
    });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].options?.referenceImages).toEqual([master, style]);
    expect(client.calls[0].prompt).toContain("시퀀스 마스터 배경 참고 이미지");
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

describe("isRateLimitError", () => {
  it("is true for a 429 ImageApiError", () => {
    expect(isRateLimitError(new ImageApiError(429, "rate limited"))).toBe(true);
  });

  it("is false for a non-429 ImageApiError", () => {
    expect(isRateLimitError(new ImageApiError(500, "server error"))).toBe(false);
  });

  it("is false for a plain error", () => {
    expect(isRateLimitError(new Error("boom"))).toBe(false);
  });

  it("is true for a NoImageDataError (Gemini's silent-quota-throttle 200 OK with empty candidate)", () => {
    expect(isRateLimitError(new NoImageDataError("이미지 데이터를 찾을 수 없습니다"))).toBe(true);
  });
});

describe("describeImageError", () => {
  it("returns an Error's message as-is when short", () => {
    expect(describeImageError(new Error("something went wrong"))).toBe("something went wrong");
  });

  it("truncates very long messages", () => {
    const long = "x".repeat(500);
    const result = describeImageError(new Error(long));
    expect(result.length).toBeLessThan(long.length);
    expect(result.endsWith("...")).toBe(true);
  });

  it("stringifies non-Error values", () => {
    expect(describeImageError("plain string failure")).toBe("plain string failure");
  });
});

describe("generateSceneImageWithRetry", () => {
  it("returns the image immediately on first success, with no retry", async () => {
    const client = new ScriptedImageClient([null]);
    const buffer = await generateSceneImageWithRetry(client, scene, design);
    expect(buffer.length).toBeGreaterThan(0);
    expect(client.calls).toBe(1);
  });

  it("retries once after the generic delay on a non-rate-limit failure, then succeeds", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([new Error("network blip"), null]);
      const promise = generateSceneImageWithRetry(client, scene, design);
      await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_RETRY_DELAY_MS);
      const buffer = await promise;
      expect(buffer.length).toBeGreaterThan(0);
      expect(client.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("fails after exhausting the single generic retry, with the scene id and reason in the message", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([new Error("network blip"), new Error("network blip again")]);
      const promise = generateSceneImageWithRetry(client, scene, design);
      const assertion = expect(promise).rejects.toThrow(`씬 ${scene.id} 이미지 생성 실패: network blip again`);
      await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_RETRY_DELAY_MS);
      await assertion;
      expect(client.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("uses the longer rate-limit delay and allows more retries for a 429", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([new ImageApiError(429, "rate limited"), null]);
      const promise = generateSceneImageWithRetry(client, scene, design);
      await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS);
      const buffer = await promise;
      expect(buffer.length).toBeGreaterThan(0);
      expect(client.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries a 429 up to the rate-limit max before failing", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([
        new ImageApiError(429, "rate limited"),
        new ImageApiError(429, "still rate limited"),
        new ImageApiError(429, "still rate limited again"),
      ]);
      const promise = generateSceneImageWithRetry(client, scene, design);
      const assertion = expect(promise).rejects.toThrow();
      await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS * IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES);
      await assertion;
      // 1 initial call + IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES retries.
      expect(client.calls).toBe(1 + IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES);
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops retrying and rejects immediately once the signal is aborted mid-wait", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([new Error("network blip"), null]);
      const controller = new AbortController();
      const promise = generateSceneImageWithRetry(client, scene, design, undefined, controller.signal);
      controller.abort();
      await expect(promise).rejects.toThrow();
      // Only the first (failing) call went out — the retry never fired.
      expect(client.calls).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
