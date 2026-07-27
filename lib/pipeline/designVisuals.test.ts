import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { designVisuals } from "./designVisuals";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";

const scenes: Scene[] = [
  { id: "scene-001", order: 1, narrationText: "정의를 설명합니다.", estimatedDurationSec: 10, splitReason: "문장종결" },
];
const screenTypes: Record<string, ScreenTypeAssignment> = {
  "scene-001": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "정의 강조" },
};

describe("designVisuals", () => {
  it("maps each scene id to a visual design", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({
        caption: "핵심 정의",
        keywords: ["정의"],
        imageOrDiagramDescription: "중앙에 큰 텍스트",
        objectPlacement: "중앙",
        appearanceOrder: ["제목", "본문"],
        productionNotes: "폰트 크게",
      }),
    ]);

    const result = await designVisuals(client, scenes, screenTypes);

    expect(result["scene-001"].caption).toBe("핵심 정의");
    expect(result["scene-001"].keywords).toEqual(["정의"]);
  });

  it("includes the screen type and layout in the prompt", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({
        caption: "핵심 정의",
        keywords: ["정의"],
        imageOrDiagramDescription: "중앙에 큰 텍스트",
        objectPlacement: "중앙",
        appearanceOrder: ["제목", "본문"],
        productionNotes: "폰트 크게",
      }),
    ]);

    await designVisuals(client, scenes, screenTypes);

    expect(client.calls[0].messages[1].content).toContain("텍스트 강조형");
  });
});
