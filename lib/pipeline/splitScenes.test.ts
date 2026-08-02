import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { splitScenes } from "./splitScenes";

const SAMPLE_RESPONSE = JSON.stringify({
  scenes: [
    { order: 1, narrationText: "안녕하세요.", estimatedDurationSec: 5, splitReason: "문장종결" },
    { order: 2, narrationText: " 오늘은 이러닝을 배웁니다.", estimatedDurationSec: 10, splitReason: "주제전환" },
  ],
});

describe("splitScenes", () => {
  it("assigns sequential scene ids to the AI-produced scenes", async () => {
    const client = new MockDeepSeekClient([SAMPLE_RESPONSE]);

    const scenes = await splitScenes(client, "안녕하세요. 오늘은 이러닝을 배웁니다.");

    expect(scenes).toHaveLength(2);
    expect(scenes[0].id).toBe("scene-001");
    expect(scenes[1].id).toBe("scene-002");
    expect(scenes[0].splitReason).toBe("문장종결");
  });

  it("requests json mode from the client", async () => {
    const client = new MockDeepSeekClient([SAMPLE_RESPONSE]);

    await splitScenes(client, "나레이션");

    expect(client.calls[0].options?.jsonMode).toBe(true);
  });

  it("requests the pro model", async () => {
    const client = new MockDeepSeekClient([SAMPLE_RESPONSE]);

    await splitScenes(client, "나레이션");

    expect(client.calls[0].options?.model).toBe("deepseek-v4-pro");
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
    const client = new MockDeepSeekClient([response]);

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
    const client = new MockDeepSeekClient([response]);

    const scenes = await splitScenes(client, "나레이션");

    expect(scenes[0].relatedSceneIds).toBeUndefined();
  });
});
