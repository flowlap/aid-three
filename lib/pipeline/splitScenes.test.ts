import { describe, it, expect } from "vitest";
import { MockLlmClient } from "../ai/llm/mockLlmClient";
import { splitScenes, chunkNarration, parseRawScenes, assignSceneIds } from "./splitScenes";

const SAMPLE_RESPONSE = JSON.stringify({
  scenes: [
    { order: 1, narrationText: "안녕하세요.", estimatedDurationSec: 5, splitReason: "문장종결" },
    { order: 2, narrationText: " 오늘은 이러닝을 배웁니다.", estimatedDurationSec: 10, splitReason: "주제전환" },
  ],
});

describe("splitScenes", () => {
  it("assigns sequential scene ids to the AI-produced scenes", async () => {
    const client = new MockLlmClient([SAMPLE_RESPONSE]);

    const scenes = await splitScenes(client, "안녕하세요. 오늘은 이러닝을 배웁니다.");

    expect(scenes).toHaveLength(2);
    expect(scenes[0].id).toBe("scene-001");
    expect(scenes[1].id).toBe("scene-002");
    expect(scenes[0].splitReason).toBe("문장종결");
  });

  it("requests json mode from the client", async () => {
    const client = new MockLlmClient([SAMPLE_RESPONSE]);

    await splitScenes(client, "나레이션");

    expect(client.calls[0].options?.jsonMode).toBe(true);
  });

  it("requests the pro model", async () => {
    const client = new MockLlmClient([SAMPLE_RESPONSE]);

    await splitScenes(client, "나레이션");

    expect(client.calls[0].options?.tier).toBe("accurate");
  });

  it("resolves relatedOrders into relatedSceneIds", async () => {
    const response = JSON.stringify({
      scenes: [
        { order: 1, narrationText: "개념 A를 소개합니다.", estimatedDurationSec: 5, splitReason: "새로운 개념 도입", relatedOrders: [] },
        { order: 2, narrationText: "개념 B를 소개합니다.", estimatedDurationSec: 5, splitReason: "새로운 개념 도입", relatedOrders: [] },
        {
          order: 3,
          narrationText: "두 개념은 사실 하나입니다.",
          estimatedDurationSec: 5,
          splitReason: "이전 두 내용을 하나로 연결",
          relatedOrders: [1, 2],
        },
      ],
    });
    const client = new MockLlmClient([response]);

    const scenes = await splitScenes(client, "나레이션");

    expect(scenes[0].relatedSceneIds).toBeUndefined();
    expect(scenes[2].relatedSceneIds).toEqual(["scene-001", "scene-002"]);
  });

  it("drops self-references and unknown orders from relatedOrders", async () => {
    const response = JSON.stringify({
      scenes: [
        { order: 1, narrationText: "씬 하나.", estimatedDurationSec: 5, splitReason: "-", relatedOrders: [1, 99] },
      ],
    });
    const client = new MockLlmClient([response]);

    const scenes = await splitScenes(client, "나레이션");

    expect(scenes[0].relatedSceneIds).toBeUndefined();
  });

  it("defaults scenes without an explicit sceneType to content", async () => {
    const client = new MockLlmClient([SAMPLE_RESPONSE]);

    const scenes = await splitScenes(client, "안녕하세요. 오늘은 이러닝을 배웁니다.");

    expect(scenes[0].sceneType).toBe("content");
    expect(scenes[0].depth).toBeUndefined();
  });

  it("parses title scenes with their heading depth", async () => {
    const response = JSON.stringify({
      scenes: [
        { order: 1, narrationText: "1장 이러닝 개요", estimatedDurationSec: 3, splitReason: "장 제목", sceneType: "title", depth: 1 },
        { order: 2, narrationText: "이러닝은 온라인 학습입니다.", estimatedDurationSec: 5, splitReason: "본문 시작", sceneType: "content" },
      ],
    });
    const client = new MockLlmClient([response]);

    const scenes = await splitScenes(client, "# 1장 이러닝 개요\n이러닝은 온라인 학습입니다.");

    expect(scenes[0].sceneType).toBe("title");
    expect(scenes[0].depth).toBe(1);
    expect(scenes[1].sceneType).toBe("content");
    expect(scenes[1].depth).toBeUndefined();
  });
});

describe("chunkNarration", () => {
  it("returns the whole narration as a single chunk when under budget", () => {
    const text = "안녕하세요.\n오늘은 이러닝을 배웁니다.";
    expect(chunkNarration(text, 1000)).toEqual([text]);
  });

  it("splits at header boundaries once the budget is exceeded", () => {
    const text = "# 1장\n내용1\n\n# 2장\n내용2\n\n# 3장\n내용3";
    const chunks = chunkNarration(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).toContain("# 1장");
  });

  it("reconstructs the original text exactly when chunks are concatenated", () => {
    const text =
      "# 1장\n내용1입니다.\n\n# 2장\n내용2입니다.\n\n일반 문단도 있습니다.\n\n# 3장\n내용3입니다.";
    const chunks = chunkNarration(text, 15);
    expect(chunks.join("")).toBe(text);
  });

  it("splits an oversized header section by paragraph", () => {
    const text = "# 1장\n첫 문단입니다.\n\n둘째 문단입니다.\n\n셋째 문단입니다.";
    const chunks = chunkNarration(text, 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks.join("")).toBe(text);
  });

  it("keeps an oversized single paragraph whole when it has no blank lines to split further", () => {
    const longParagraph = "매우 긴 문단입니다. ".repeat(20);
    expect(chunkNarration(longParagraph, 20)).toEqual([longParagraph]);
  });
});

describe("parseRawScenes / assignSceneIds", () => {
  it("resolves relatedOrders that point at scenes merged in from an earlier chunk", () => {
    const chunk1 = parseRawScenes(
      JSON.stringify({
        scenes: [{ order: 1, narrationText: "개념 A", estimatedDurationSec: 5, splitReason: "도입" }],
      })
    );
    const chunk2 = parseRawScenes(
      JSON.stringify({
        scenes: [
          {
            order: 2,
            narrationText: "A와 B를 연결",
            estimatedDurationSec: 5,
            splitReason: "연결",
            relatedOrders: [1],
          },
        ],
      })
    );

    const scenes = assignSceneIds([...chunk1, ...chunk2]);

    expect(scenes[1].relatedSceneIds).toEqual(["scene-001"]);
  });

  it("throws on malformed JSON, same as parseScenesResponse used to", () => {
    expect(() => parseRawScenes("not json")).toThrow();
  });
});
