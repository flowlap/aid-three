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
});
