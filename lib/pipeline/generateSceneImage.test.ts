import { describe, it, expect } from "vitest";
import { MockOpenAiImageClient } from "../ai/openaiImageClient.mock";
import { generateSceneImage, buildImagePrompt } from "./generateSceneImage";
import type { Scene } from "./splitScenes";
import type { VisualDesign } from "./designVisuals";

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
    const client = new MockOpenAiImageClient();
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
    const client = new MockOpenAiImageClient();
    const controller = new AbortController();
    controller.abort();

    await expect(generateSceneImage(client, scene, design, { signal: controller.signal })).rejects.toThrow();
  });
});
