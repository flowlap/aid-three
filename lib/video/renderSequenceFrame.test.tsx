import { describe, it, expect } from "vitest";
import { buildSequenceOverlayLayout } from "./renderSequenceFrame";
import { renderSequenceOverlayToPng } from "./renderSequenceFrameToPng";
import type { OverlayType, SequenceOverlayEntry } from "@/lib/pipeline/sequenceTypes";

const FRAME_WIDTH = 1920;
const FRAME_HEIGHT = 1280;

const ALL_TYPES: OverlayType[] = ["label", "arrow-flow", "highlight", "diagram", "chart"];

function makeOverlay(type: OverlayType, description = `${type} 설명`): SequenceOverlayEntry {
  return { sceneId: "scene-001", type, description };
}

/** Collects every node in the JSX tree that is a plain object with `.props` (i.e. a React element). */
function collectElements(node: unknown, acc: { props: Record<string, unknown> }[] = []): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) {
    for (const child of node) collectElements(child, acc);
    return acc;
  }
  if (node && typeof node === "object" && "props" in node) {
    const el = node as { props: Record<string, unknown> };
    acc.push(el);
    collectElements(el.props?.children, acc);
  }
  return acc;
}

function findText(node: unknown, text: string): boolean {
  if (typeof node === "string") return node.includes(text);
  if (Array.isArray(node)) return node.some((child) => findText(child, text));
  if (node && typeof node === "object" && "props" in node) {
    const props = (node as { props?: { children?: unknown } }).props;
    return findText(props?.children, text);
  }
  return false;
}

describe("buildSequenceOverlayLayout", () => {
  it("renders at the given frame size", () => {
    const layout = buildSequenceOverlayLayout([], FRAME_WIDTH, FRAME_HEIGHT);
    expect(layout.props.style.width).toBe(FRAME_WIDTH);
    expect(layout.props.style.height).toBe(FRAME_HEIGHT);
  });

  it("renders no overlay-content nodes for an empty overlays array", () => {
    const layout = buildSequenceOverlayLayout([], FRAME_WIDTH, FRAME_HEIGHT);
    for (const type of ALL_TYPES) {
      expect(findText(layout, `${type} 설명`)).toBe(false);
    }
    // Neither zone's inner stack container renders when it has nothing to show.
    const [topRow, bottomRow] = layout.props.children as { props: { children: unknown } }[];
    expect(topRow.props.children).toBeFalsy();
    expect(bottomRow.props.children).toBeFalsy();
  });

  it("renders each overlay type's own description text", () => {
    for (const type of ALL_TYPES) {
      const layout = buildSequenceOverlayLayout([makeOverlay(type)], FRAME_WIDTH, FRAME_HEIGHT);
      expect(findText(layout, `${type} 설명`)).toBe(true);
    }
  });

  it("gives every overlay type a visually distinct accent color", () => {
    const colors = new Map<OverlayType, string>();
    for (const type of ALL_TYPES) {
      const layout = buildSequenceOverlayLayout([makeOverlay(type)], FRAME_WIDTH, FRAME_HEIGHT);
      const elements = collectElements(layout);
      const withBorder = elements.find((el) => typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).borderLeft);
      expect(withBorder, `expected a bordered chip for overlay type "${type}"`).toBeTruthy();
      const border = (withBorder!.props.style as Record<string, unknown>).borderLeft as string;
      const color = border.split(" ").pop()!;
      colors.set(type, color);
    }
    const uniqueColors = new Set(colors.values());
    expect(uniqueColors.size).toBe(ALL_TYPES.length);
  });

  it("separates attention-cue types (highlight/arrow-flow) from content-annotation types (label/diagram/chart) into different zones", () => {
    const attentionLayout = buildSequenceOverlayLayout([makeOverlay("highlight")], FRAME_WIDTH, FRAME_HEIGHT);
    const [attentionTopRow, attentionBottomRow] = attentionLayout.props.children as { props: { children: unknown } }[];
    expect(attentionTopRow.props.children).toBeTruthy();
    expect(attentionBottomRow.props.children).toBeFalsy();

    const contentLayout = buildSequenceOverlayLayout([makeOverlay("label")], FRAME_WIDTH, FRAME_HEIGHT);
    const [contentTopRow, contentBottomRow] = contentLayout.props.children as { props: { children: unknown } }[];
    expect(contentTopRow.props.children).toBeFalsy();
    expect(contentBottomRow.props.children).toBeTruthy();
  });

  it("stacks multiple overlays in the same zone without collapsing into one node", () => {
    const overlays = [makeOverlay("label", "첫 번째"), makeOverlay("chart", "두 번째"), makeOverlay("diagram", "세 번째")];
    const layout = buildSequenceOverlayLayout(overlays, FRAME_WIDTH, FRAME_HEIGHT);

    expect(findText(layout, "첫 번째")).toBe(true);
    expect(findText(layout, "두 번째")).toBe(true);
    expect(findText(layout, "세 번째")).toBe(true);

    const [, bottomRow] = layout.props.children as { props: { children: unknown } }[];
    const stack = (bottomRow.props.children as { props: { children: unknown[] } }).props.children;
    expect(Array.isArray(stack)).toBe(true);
    expect((stack as unknown[]).length).toBe(3);
  });
});

describe("renderSequenceOverlayToPng", () => {
  it("returns null for an empty overlays array without invoking Satori", async () => {
    const result = await renderSequenceOverlayToPng([], { width: FRAME_WIDTH, height: FRAME_HEIGHT });
    expect(result).toBeNull();
  });
});
