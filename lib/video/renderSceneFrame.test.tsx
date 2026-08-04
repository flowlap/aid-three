import { describe, it, expect } from "vitest";
import { buildSceneFrameLayout, FRAME_WIDTH, FRAME_HEIGHT } from "./renderSceneFrame";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

const scene: Scene = {
  id: "scene-001",
  order: 1,
  narrationText: "변수는 값을 저장하는 상자입니다.",
  estimatedDurationSec: 8,
  splitReason: "개념 도입",
};

const design: VisualDesign = {
  caption: "변수와 상자",
  keywords: ["변수", "상자", "저장"],
  imageOrDiagramDescription: "상자 안에 값이 담기는 모습",
  objectPlacement: "중앙",
  appearanceOrder: ["상자", "값"],
  productionNotes: "",
};

function findText(node: unknown, text: string): boolean {
  if (typeof node === "string") return node.includes(text);
  if (Array.isArray(node)) return node.some((child) => findText(child, text));
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return findText(props?.children, text);
  }
  return false;
}

describe("buildSceneFrameLayout", () => {
  it("renders at the fixed 1920x1280 (3:2) frame size", () => {
    const layout = buildSceneFrameLayout(scene, design);
    expect(layout.props.style.width).toBe(FRAME_WIDTH);
    expect(layout.props.style.height).toBe(FRAME_HEIGHT);
  });

  it("shows the design caption when present", () => {
    const layout = buildSceneFrameLayout(scene, design);
    expect(findText(layout, "변수와 상자")).toBe(true);
  });

  it("falls back to a narration excerpt when there is no caption", () => {
    const layout = buildSceneFrameLayout(scene, { ...design, caption: "" });
    expect(findText(layout, "변수는 값을 저장하는 상자입니다")).toBe(true);
  });

  it("includes up to 3 keyword chips on a mockup frame", () => {
    const layout = buildSceneFrameLayout(scene, { ...design, keywords: ["A", "B", "C", "D"] });
    expect(findText(layout, "A")).toBe(true);
    expect(findText(layout, "C")).toBe(true);
    expect(findText(layout, "D")).toBe(false);
  });

  it("uses a generated content image as the full video page", () => {
    const layout = buildSceneFrameLayout(scene, design, "data:image/png;base64,AAAA");
    const imgNode = layout.props.children;
    expect(imgNode.props.src).toBe("data:image/png;base64,AAAA");
    expect(imgNode.props.width).toBe(FRAME_WIDTH);
    expect(imgNode.props.height).toBe(FRAME_HEIGHT);
  });

  it("keeps title scenes as mockup cards even when an image is present", () => {
    const titleScene: Scene = { ...scene, sceneType: "title", narrationText: "1장. 변수" };
    const layout = buildSceneFrameLayout(titleScene, design, "data:image/png;base64,AAAA");
    expect(findText(layout, "변수와 상자")).toBe(true);
    expect(findText(layout, "AAAA")).toBe(false);
  });
});
