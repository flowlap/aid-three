import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import {
  checkDuplicateLayouts,
  checkOverlongNarration,
  checkSceneNumbering,
  reviewSemanticConsistency,
} from "./reviewConsistency";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";
import type { VisualDesign } from "./designVisuals";

function makeScene(id: string, order: number, durationSec = 10): Scene {
  return { id, order, narrationText: `${id} 나레이션`, estimatedDurationSec: durationSec, splitReason: "문장종결" };
}

describe("checkDuplicateLayouts", () => {
  it("flags three or more consecutive scenes with the same layout", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 2), makeScene("scene-003", 3)];
    const screenTypes: Record<string, ScreenTypeAssignment> = {
      "scene-001": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
      "scene-002": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
      "scene-003": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
    };

    const issues = checkDuplicateLayouts(scenes, screenTypes);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("duplicate-layout");
    expect(issues[0].sceneIds).toEqual(["scene-001", "scene-002", "scene-003"]);
  });

  it("does not flag two consecutive repeats", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 2)];
    const screenTypes: Record<string, ScreenTypeAssignment> = {
      "scene-001": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
      "scene-002": { screenType: "텍스트 강조형", recommendedLayout: "중앙 텍스트", rationale: "" },
    };

    expect(checkDuplicateLayouts(scenes, screenTypes)).toHaveLength(0);
  });
});

describe("checkOverlongNarration", () => {
  it("flags scenes exceeding 40 seconds", () => {
    const scenes = [makeScene("scene-001", 1, 45)];

    const issues = checkOverlongNarration(scenes);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("overlong-narration");
  });

  it("does not flag scenes within the limit", () => {
    const scenes = [makeScene("scene-001", 1, 30)];
    expect(checkOverlongNarration(scenes)).toHaveLength(0);
  });
});

describe("checkSceneNumbering", () => {
  it("flags gaps in scene ordering", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 3)];

    const issues = checkSceneNumbering(scenes);

    expect(issues).toHaveLength(1);
    expect(issues[0].type).toBe("numbering-gap");
  });

  it("passes sequential ordering", () => {
    const scenes = [makeScene("scene-001", 1), makeScene("scene-002", 2)];
    expect(checkSceneNumbering(scenes)).toHaveLength(0);
  });
});

describe("reviewSemanticConsistency", () => {
  it("parses AI-reported issues", async () => {
    const client = new MockDeepSeekClient([
      JSON.stringify({
        issues: [
          { type: "terminology", severity: "warning", sceneIds: ["scene-001"], message: "용어 불일치" },
        ],
      }),
    ]);
    const scenes = [makeScene("scene-001", 1)];
    const designs: Record<string, VisualDesign> = {
      "scene-001": {
        caption: "자막",
        keywords: [],
        imageOrDiagramDescription: "",
        objectPlacement: "",
        appearanceOrder: [],
        productionNotes: "",
      },
    };

    const issues = await reviewSemanticConsistency(client, scenes, designs);

    expect(issues).toHaveLength(1);
    expect(issues[0].id).toBe("semantic-1");
    expect(issues[0].type).toBe("terminology");
  });

  it("requests the flash model", async () => {
    const client = new MockDeepSeekClient([JSON.stringify({ issues: [] })]);
    const scenes = [makeScene("scene-001", 1)];

    await reviewSemanticConsistency(client, scenes, {});

    expect(client.calls[0].options?.model).toBe("deepseek-v4-flash");
  });
});
