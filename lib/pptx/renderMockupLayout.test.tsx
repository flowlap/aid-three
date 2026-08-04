import { describe, it, expect } from "vitest";
import { buildMockupLayout } from "./renderMockupLayout";
import type { VisualDesign, LayoutElement } from "@/lib/pipeline/designVisuals";

const layoutElements: LayoutElement[] = [
  { label: "제목", position: "top" },
  { label: "설명 카드", position: "center" },
];

const design: VisualDesign = {
  caption: "화면 자막입니다",
  keywords: [],
  imageOrDiagramDescription: "",
  objectPlacement: "",
  appearanceOrder: [],
  productionNotes: "",
  layoutElements,
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

describe("buildMockupLayout", () => {
  it("renders at the requested width/height", () => {
    const layout = buildMockupLayout(design, "표/그래프형", 1600, 900);
    expect(layout.props.style.width).toBe(1600);
    expect(layout.props.style.height).toBe(900);
  });

  it("shows layoutElements labels when present", () => {
    const layout = buildMockupLayout(design, "표/그래프형", 1600, 900);
    expect(findText(layout, "제목")).toBe(true);
    expect(findText(layout, "설명 카드")).toBe(true);
  });

  it("shows the caption below the grid", () => {
    const layout = buildMockupLayout(design, "표/그래프형", 1600, 900);
    expect(findText(layout, "화면 자막입니다")).toBe(true);
  });

  it("falls back to a caption-only card when layoutElements is missing", () => {
    const layout = buildMockupLayout({ ...design, layoutElements: undefined }, "표/그래프형", 1600, 900);
    expect(findText(layout, "화면 자막입니다")).toBe(true);
  });

  it("falls back to the screen type name when there is no caption either", () => {
    const layout = buildMockupLayout({ ...design, caption: "", layoutElements: undefined }, "표/그래프형", 1600, 900);
    expect(findText(layout, "표/그래프형")).toBe(true);
  });
});
