import { describe, it, expect } from "vitest";
import { MockLlmClient } from "../ai/llm/mockLlmClient";
import { analyzeSceneRelations } from "./analyzeSceneRelations";
import type { Scene } from "./splitScenes";

const scenes: Scene[] = [
  {
    id: "scene-001",
    order: 1,
    narrationText: "배출권 ETF를 소개합니다.",
    estimatedDurationSec: 8,
    splitReason: "빈 줄로 구분된 문단 (가편집 원고 자동 분리)",
  },
  {
    id: "scene-002",
    order: 2,
    narrationText: "친환경차 목표제를 소개합니다.",
    estimatedDurationSec: 8,
    splitReason: "빈 줄로 구분된 문단 (가편집 원고 자동 분리)",
  },
  {
    id: "scene-003",
    order: 3,
    narrationText: "두 정책은 같은 질문에서 출발했습니다.",
    estimatedDurationSec: 8,
    splitReason: "빈 줄로 구분된 문단 (가편집 원고 자동 분리)",
  },
];

function analysisResponse(analyses: Array<{ order: number; splitReason: string; relatedOrders?: number[] }>): string {
  return JSON.stringify({ analyses });
}

describe("analyzeSceneRelations", () => {
  it("returns an empty map for an empty scene list without calling the AI", async () => {
    const client = new MockLlmClient([]);

    const result = await analyzeSceneRelations(client, []);

    expect(result).toEqual({});
    expect(client.calls).toHaveLength(0);
  });

  it("maps analyses back to existing scene ids by order", async () => {
    const client = new MockLlmClient([
      analysisResponse([
        { order: 1, splitReason: "새로운 개념 도입", relatedOrders: [] },
        { order: 2, splitReason: "새로운 개념 도입", relatedOrders: [] },
        { order: 3, splitReason: "이전 두 내용을 하나로 연결", relatedOrders: [1, 2] },
      ]),
    ]);

    const result = await analyzeSceneRelations(client, scenes);

    expect(result["scene-001"]).toEqual({ splitReason: "새로운 개념 도입" });
    expect(result["scene-003"]).toEqual({
      splitReason: "이전 두 내용을 하나로 연결",
      relatedSceneIds: ["scene-001", "scene-002"],
    });
  });

  it("parses a response the AI wrapped in a markdown code fence", async () => {
    const client = new MockLlmClient([
      `\`\`\`json\n${analysisResponse([{ order: 1, splitReason: "독립적인 내용", relatedOrders: [] }])}\n\`\`\``,
    ]);

    const result = await analyzeSceneRelations(client, [scenes[0]]);

    expect(result["scene-001"]).toEqual({ splitReason: "독립적인 내용" });
  });

  it("omits relatedSceneIds when the AI returns an empty array", async () => {
    const client = new MockLlmClient([analysisResponse([{ order: 1, splitReason: "독립적인 내용", relatedOrders: [] }])]);

    const result = await analyzeSceneRelations(client, [scenes[0]]);

    expect(result["scene-001"].relatedSceneIds).toBeUndefined();
  });

  it("drops self-references and unresolvable orders from relatedOrders", async () => {
    const client = new MockLlmClient([
      analysisResponse([{ order: 1, splitReason: "독립적인 내용", relatedOrders: [1, 99] }]),
    ]);

    const result = await analyzeSceneRelations(client, [scenes[0]]);

    expect(result["scene-001"].relatedSceneIds).toBeUndefined();
  });

  it("sends every scene's order and narration text in the prompt", async () => {
    const client = new MockLlmClient([analysisResponse([])]);

    await analyzeSceneRelations(client, scenes);

    const prompt = client.calls[0].messages[1].content;
    expect(prompt).toContain("1. 배출권 ETF를 소개합니다.");
    expect(prompt).toContain("2. 친환경차 목표제를 소개합니다.");
    expect(prompt).toContain("3. 두 정책은 같은 질문에서 출발했습니다.");
  });

  it("requests the pro model in json mode", async () => {
    const client = new MockLlmClient([analysisResponse([])]);

    await analyzeSceneRelations(client, scenes);

    expect(client.calls[0].options?.tier).toBe("accurate");
    expect(client.calls[0].options?.jsonMode).toBe(true);
  });

  it("throws a clear error when the AI response is malformed", async () => {
    const client = new MockLlmClient(["이건 JSON이 아님"]);

    await expect(analyzeSceneRelations(client, scenes)).rejects.toThrow();
  });

  it("ignores analysis entries for orders that don't exist in the scene list", async () => {
    const client = new MockLlmClient([
      analysisResponse([{ order: 999, splitReason: "존재하지 않는 씬" }]),
    ]);

    const result = await analyzeSceneRelations(client, scenes);

    expect(result).toEqual({});
  });
});
