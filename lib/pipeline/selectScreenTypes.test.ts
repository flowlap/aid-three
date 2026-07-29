import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { selectScreenTypes } from "./selectScreenTypes";
import type { Scene } from "./splitScenes";

const scenes: Scene[] = [
  { id: "scene-001", order: 1, narrationText: "정의를 설명합니다.", estimatedDurationSec: 10, splitReason: "문장종결" },
  { id: "scene-002", order: 2, narrationText: "표를 보여줍니다.", estimatedDurationSec: 20, splitReason: "표/그래프 등장" },
];

describe("selectScreenTypes", () => {
  it("maps each scene id to a screen type assignment", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({ screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" }),
      JSON.stringify({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);

    const result = await selectScreenTypes(client, scenes);

    expect(Object.keys(result)).toEqual(["scene-001", "scene-002"]);
    expect(result["scene-002"].screenType).toBe("표/그래프형");
  });

  it("includes neighboring scene context in the prompt", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({ screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" }),
      JSON.stringify({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);

    await selectScreenTypes(client, scenes);

    expect(client.calls[0].messages[1].content).toContain("표를 보여줍니다.");
  });

  it("requests the flash model", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({ screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" }),
    ]);

    await selectScreenTypes(client, [scenes[0]]);

    expect(client.calls[0].options?.model).toBe("deepseek-v4-flash");
  });

  it("calls onProgress after each scene with its index/total", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({ screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" }),
      JSON.stringify({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);
    const calls: Array<{ sceneId: string; index: number; total: number }> = [];

    await selectScreenTypes(client, scenes, {
      onProgress: (sceneId, index, total) => {
        calls.push({ sceneId, index, total });
      },
    });

    expect(calls).toEqual([
      { sceneId: "scene-001", index: 0, total: 2 },
      { sceneId: "scene-002", index: 1, total: 2 },
    ]);
  });

  it("stops before the next scene once the signal is aborted", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({ screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" }),
      JSON.stringify({ screenType: "표/그래프형", recommendedLayout: "전체 화면 표", rationale: "표 데이터 설명" }),
    ]);
    const controller = new AbortController();

    await expect(
      selectScreenTypes(client, scenes, {
        onProgress: () => {
          controller.abort();
        },
        signal: controller.signal,
      })
    ).rejects.toThrow();

    expect(client.calls).toHaveLength(1);
  });
});
