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

  it("does not ask for on-screen text/captions or a presenter", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("텍스트 렌더링 없이");
    expect(prompt).toContain("강사(발표자) 등 인물은 등장시키지");
  });

  it("asks for a wide composition with margin for camera crops and overlays", () => {
    const prompt = buildSequenceMasterImagePrompt(sequence({ id: "sequence-001" }));
    expect(prompt).toContain("여유 공간");
    expect(prompt).toContain("크롭");
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
