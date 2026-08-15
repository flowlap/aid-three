import { describe, it, expect, vi } from "vitest";
import { MockImageClient } from "../ai/image/mockImageClient";
import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "../ai/image/types";
import { buildSequenceMasterImagePrompt, generateSequenceMasterImage } from "./generateSequenceMasterImage";
import {
  IMAGE_GENERATION_RETRY_DELAY_MS,
  IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS,
  IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES,
} from "./imageGenerationConfig";
import type { Sequence } from "./sequenceTypes";

/** A stub image client whose successive calls fail/succeed per a fixed script — mirrors generateSceneImage.test.ts's ScriptedImageClient. */
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

function sequence(overrides: Partial<Sequence> & { id: string }): Sequence {
  return {
    order: 1,
    title: "시퀀스 제목",
    sceneIds: ["scene-001"],
    estimatedDurationSec: 10,
    purpose: "테스트 목적",
    continuity: {
      location: "교실",
      visualStyle: "플랫 일러스트",
      fixedElements: [],
      doNotChange: [],
    },
    masterVisual: {
      description: "칠판과 책상이 있는 교실 전경",
      status: "not-generated",
    },
    cameraPlan: [],
    overlays: [],
    ...overrides,
  };
}

describe("buildSequenceMasterImagePrompt", () => {
  it("includes the master visual description", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("칠판과 책상이 있는 교실 전경");
  });

  it("includes the location", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("교실");
  });

  it("omits timeOfDay cleanly (no literal 'undefined') when absent", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).not.toContain("undefined");
    expect(prompt).not.toContain("시간대:");
  });

  it("includes timeOfDay when present", () => {
    const prompt = buildSequenceMasterImagePrompt(
      sequence({
        id: "sequence-001",
        continuity: {
          location: "교실",
          timeOfDay: "저녁",
          visualStyle: "플랫 일러스트",
          fixedElements: [],
          doNotChange: [],
        },
      })
    );
    expect(prompt).toContain("시간대: 저녁");
  });

  it("includes fixedElements/doNotChange content when non-empty", () => {
    const prompt = buildSequenceMasterImagePrompt(
      sequence({
        id: "sequence-001",
        continuity: {
          location: "교실",
          visualStyle: "플랫 일러스트",
          fixedElements: ["칠판", "책상 배열"],
          doNotChange: ["창문 위치"],
        },
      })
    );
    expect(prompt).toContain("칠판");
    expect(prompt).toContain("책상 배열");
    expect(prompt).toContain("창문 위치");
  });

  it("omits fixedElements/doNotChange sections when empty", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).not.toContain("고정 요소:");
    expect(prompt).not.toContain("절대 변경 금지:");
  });

  it("keeps text out and frames the master as a subordinate background, not the focus", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("텍스트 렌더링 없이");
    expect(prompt).toContain("조연");
    expect(prompt).toContain("주된 내용 전달은 전부 각 씬 이미지에서 이루어지므로");
    expect(prompt).toContain("프로젝트별 강사 오버레이를 새로 추가하지");
  });

  it("tells the model not to draw concept-symbol icons/objects into the master even if continuity names them", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("개념을 상징하는 구체적 오브제·아이콘·상징물은 절대 넣지 마세요");
  });

  it("strongly weights the style reference's color/lighting/illustration-style, but not its layout", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("가벼운 참고 자료로 다루지 말고");
    expect(prompt).toContain("팔레트");
    expect(prompt).toContain("그대로 옮기지는 마세요");
  });

  it("requires matching the tone reference's level of visual simplicity, not just its color", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("참고 이미지보다 요소가 많고 복잡한 그림이 되어서는 절대 안 됩니다");
  });

  it("tells the model to keep the master visually subdued so scene content stands out", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("가장 눈에 띄는 요소");
  });

  it("asks for a shallow-depth-of-field blur so the master reads as an out-of-focus backdrop", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("아웃포커스");
    expect(prompt).toContain("흐릿하게");
  });

  it("asks for a wide composition with margin for camera crops and overlays", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("여유 공간");
    expect(prompt).toContain("크롭");
  });

  it("excludes sample typography from a tone-and-manner reference and keeps the background minimal", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("샘플 자막입니다");
    expect(prompt).toContain("A/B/C");
    expect(prompt).toContain("텍스트를 전혀 넣지 마세요");
    expect(prompt).toContain("간결하고 최소화된 구도");
    expect(prompt).toContain("의미 없는 장식물·소품·군중·복잡한 패턴");
  });

  it("keeps the minimal-background instruction from fighting style-reference color fidelity", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("임의로 탁하게 낮추지 마세요");
  });

  it("omits the background-reference emphasis instruction when no background reference image is attached", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).not.toContain("배경 고정");
  });

  it("tells the model to heavily follow the background-fixed reference image when one is attached", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }), undefined, true);
    expect(prompt).toContain("배경 참고 이미지(배경 고정)가 함께 첨부되었습니다");
    expect(prompt).toContain("가벼운 참고 자료로 다루지 말고");
  });

  it("omits the consistency-reference instruction when no other sequence's master is attached", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).not.toContain("다른 시퀀스에서 이미 생성된 마스터 비주얼");
  });

  it("tells the model to match another sequence's master's color/style but not its place/composition when one is attached", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }), undefined, false, true);
    expect(prompt).toContain("다른 시퀀스에서 이미 생성된 마스터 비주얼이 참고 이미지로 함께 첨부되었습니다");
    expect(prompt).toContain("다른 시퀀스의 장소나 사물을 이 마스터에 옮겨 그리면 안 됩니다");
  });
});

describe("generateSequenceMasterImage", () => {
  it("returns image bytes on success", async () => {
    const client = new MockImageClient();
    const buffer = await generateSequenceMasterImage(client, sequence({ id: "sequence-001" }));
    expect(buffer.length).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(1);
  });

  it("forwards reference images (style, background) to the client", async () => {
    const client = new MockImageClient();
    const background = Buffer.from("bg");
    const style = Buffer.from("style");
    await generateSequenceMasterImage(client, sequence({ id: "sequence-001" }), { background, style });
    expect(client.calls[0].options?.referenceImages).toEqual([style, background]);
  });

  it("adds the background-reference emphasis instruction to the prompt when a background reference image is passed", async () => {
    const client = new MockImageClient();
    await generateSequenceMasterImage(client, sequence({ id: "sequence-001" }), { background: Buffer.from("bg") });
    expect(client.calls[0].prompt).toContain("배경 참고 이미지(배경 고정)가 함께 첨부되었습니다");
  });

  it("forwards a consistencyReference image to the client alongside style/background", async () => {
    const client = new MockImageClient();
    const style = Buffer.from("style");
    const background = Buffer.from("bg");
    const consistencyReference = Buffer.from("anchor");
    await generateSequenceMasterImage(client, sequence({ id: "sequence-001" }), { style, background, consistencyReference });
    expect(client.calls[0].options?.referenceImages).toEqual([style, background, consistencyReference]);
  });

  it("adds the consistency-reference instruction to the prompt when a consistencyReference image is passed", async () => {
    const client = new MockImageClient();
    await generateSequenceMasterImage(client, sequence({ id: "sequence-001" }), { consistencyReference: Buffer.from("anchor") });
    expect(client.calls[0].prompt).toContain("다른 시퀀스에서 이미 생성된 마스터 비주얼이 참고 이미지로 함께 첨부되었습니다");
  });

  it("retries and eventually succeeds on a transient (non-429) error", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([new Error("network blip"), null]);
      const promise = generateSequenceMasterImage(client, sequence({ id: "sequence-001" }));
      await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_RETRY_DELAY_MS);
      const buffer = await promise;
      expect(buffer.length).toBeGreaterThan(0);
      expect(client.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("retries with the rate-limit policy on a 429 ImageApiError and eventually succeeds", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([new ImageApiError(429, "rate limited"), null]);
      const promise = generateSequenceMasterImage(client, sequence({ id: "sequence-001" }));
      await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS);
      const buffer = await promise;
      expect(buffer.length).toBeGreaterThan(0);
      expect(client.calls).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rethrows with a describable error after exhausting retries", async () => {
    vi.useFakeTimers();
    try {
      const client = new ScriptedImageClient([
        new ImageApiError(429, "rate limited"),
        new ImageApiError(429, "still rate limited"),
        new ImageApiError(429, "still rate limited again"),
      ]);
      const promise = generateSequenceMasterImage(client, sequence({ id: "sequence-001" }));
      const assertion = expect(promise).rejects.toThrow("시퀀스 sequence-001 마스터 비주얼 생성 실패");
      await vi.advanceTimersByTimeAsync(IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS * IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES);
      await assertion;
      expect(client.calls).toBe(1 + IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES);
    } finally {
      vi.useRealTimers();
    }
  });

  it("forwards an abort signal", async () => {
    const client = new MockImageClient();
    const controller = new AbortController();
    controller.abort();

    await expect(generateSequenceMasterImage(client, sequence({ id: "sequence-001" }), undefined, controller.signal)).rejects.toThrow();
  });
});
