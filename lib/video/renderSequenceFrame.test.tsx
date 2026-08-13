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

  it("renders structured process steps as deterministic learning graphics", () => {
    const layout = buildSequenceOverlayLayout(
      [{ sceneId: "scene-001", type: "arrow-flow", description: "기존 설명", content: { kind: "flow", steps: ["확인", "실행", "점검"] } }],
      FRAME_WIDTH,
      FRAME_HEIGHT
    );
    expect(findText(layout, "학습 절차")).toBe(true);
    expect(findText(layout, "확인")).toBe(true);
    expect(findText(layout, "실행")).toBe(true);
    expect(findText(layout, "점검")).toBe(true);
  });

  it("renders supplied chart labels and values instead of treating them as a prose badge", () => {
    const layout = buildSequenceOverlayLayout(
      [{ sceneId: "scene-001", type: "chart", description: "기존 설명", content: { kind: "chart", chartType: "bar", labels: ["전", "후"], values: [24, 76], unit: "%" } }],
      FRAME_WIDTH,
      FRAME_HEIGHT
    );
    expect(findText(layout, "데이터 비교")).toBe(true);
    expect(findText(layout, "24%")).toBe(true);
    expect(findText(layout, "76%")).toBe(true);
    expect(findText(layout, "전")).toBe(true);
    expect(findText(layout, "후")).toBe(true);
  });

  it("uses a distinct trend layout when the planned chart type is line", () => {
    const layout = buildSequenceOverlayLayout(
      [{ sceneId: "scene-001", type: "chart", description: "추이", content: { kind: "chart", chartType: "line", labels: ["1월", "2월", "3월"], values: [20, 50, 40] } }],
      FRAME_WIDTH,
      FRAME_HEIGHT
    );
    expect(findText(layout, "데이터 추세")).toBe(true);
    const elements = collectElements(layout);
    expect(elements.some((el) => typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).transform)).toBe(true);
  });

  it("places a structured highlight at its normalized master-image target instead of the generic corner", () => {
    const layout = buildSequenceOverlayLayout(
      [{ sceneId: "scene-001", type: "highlight", description: "기존 강조", content: { kind: "highlight", label: "핵심 장치", target: { x: 0.2, y: 0.3, width: 0.25, height: 0.2 } } }],
      FRAME_WIDTH,
      FRAME_HEIGHT
    );
    const elements = collectElements(layout);
    const target = elements.find((el) => typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).border === "7px solid #F59E0B");
    expect(target?.props.style).toMatchObject({ left: 384, top: 384, width: 480, height: 256 });
    expect(findText(layout, "핵심 장치")).toBe(true);
  });

  describe("overlayPositions (screen-design-driven placement)", () => {
    const CELL_WIDTH = (FRAME_WIDTH - 72 * 2) / 3;
    const CELL_HEIGHT = (FRAME_HEIGHT - 72 * 2) / 3;

    it("places a plain fallback overlay in the 9-grid cell given by overlayPositions, out of the legacy zone stacks", () => {
      const layout = buildSequenceOverlayLayout([makeOverlay("label", "코너식 라벨")], FRAME_WIDTH, FRAME_HEIGHT, ["top-left"]);

      const [topRow, bottomRow] = layout.props.children as { props: { children: unknown } }[];
      expect(topRow.props.children).toBeFalsy();
      expect(bottomRow.props.children).toBeFalsy();

      const elements = collectElements(layout);
      const cell = elements.find(
        (el) => typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).left === 72 && (el.props.style as Record<string, unknown>).top === 72
      );
      expect(cell).toBeTruthy();
      expect(cell?.props.style).toMatchObject({ width: CELL_WIDTH, height: CELL_HEIGHT });
      expect(findText(layout, "코너식 라벨")).toBe(true);
    });

    it("maps bottom-right to the last grid cell", () => {
      const layout = buildSequenceOverlayLayout([makeOverlay("label")], FRAME_WIDTH, FRAME_HEIGHT, ["bottom-right"]);
      const elements = collectElements(layout);
      const cell = elements.find(
        (el) =>
          typeof el.props.style === "object" &&
          (el.props.style as Record<string, unknown>).left === 72 + 2 * CELL_WIDTH &&
          (el.props.style as Record<string, unknown>).top === 72 + 2 * CELL_HEIGHT
      );
      expect(cell).toBeTruthy();
    });

    it("stacks multiple overlays assigned the same grid cell instead of overlapping", () => {
      const overlays = [makeOverlay("label", "첫 라벨"), makeOverlay("highlight", "두번째 강조")];
      const layout = buildSequenceOverlayLayout(overlays, FRAME_WIDTH, FRAME_HEIGHT, ["center", "center"]);
      const elements = collectElements(layout);
      const cell = elements.find(
        (el) => typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).justifyContent === "center" && (el.props.style as Record<string, unknown>).width === CELL_WIDTH
      );
      const stack = (cell?.props.children ?? []) as unknown[];
      expect(Array.isArray(stack)).toBe(true);
      expect((stack as unknown[]).length).toBe(2);
    });

    it("ignores an assigned position for structured content (flow/diagram/chart) — it keeps the existing bottom band", () => {
      const layout = buildSequenceOverlayLayout(
        [{ sceneId: "scene-001", type: "diagram", description: "구조도", content: { kind: "diagram", layout: "hierarchy", nodes: ["A", "B"] } }],
        FRAME_WIDTH,
        FRAME_HEIGHT,
        ["top-left"]
      );
      const [, bottomRow] = layout.props.children as { props: { children: unknown } }[];
      expect(bottomRow.props.children).toBeTruthy();
      const elements = collectElements(layout);
      const cell = elements.find((el) => typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).left === 72 && (el.props.style as Record<string, unknown>).top === 72);
      expect(cell).toBeUndefined();
    });

    it("ignores an assigned position for a target-based highlight — it keeps its normalized-target placement", () => {
      const layout = buildSequenceOverlayLayout(
        [{ sceneId: "scene-001", type: "highlight", description: "기존 강조", content: { kind: "highlight", target: { x: 0.2, y: 0.3, width: 0.25, height: 0.2 } } }],
        FRAME_WIDTH,
        FRAME_HEIGHT,
        ["center"]
      );
      const elements = collectElements(layout);
      const target = elements.find((el) => typeof el.props.style === "object" && (el.props.style as Record<string, unknown>).border === "7px solid #F59E0B");
      expect(target?.props.style).toMatchObject({ left: 384, top: 384 });
    });

    it("falls back to the legacy zone stack for an overlay with no assigned position, even when other overlays in the same call have one", () => {
      const overlays = [makeOverlay("label", "위치 있음"), makeOverlay("chart", "위치 없음")];
      const layout = buildSequenceOverlayLayout(overlays, FRAME_WIDTH, FRAME_HEIGHT, ["top-left", undefined]);
      const [, bottomRow] = layout.props.children as { props: { children: unknown } }[];
      expect(findText(bottomRow, "위치 없음")).toBe(true);
      expect(findText(bottomRow, "위치 있음")).toBe(false);
    });
  });
});

describe("renderSequenceOverlayToPng", () => {
  it("returns null for an empty overlays array without invoking Satori", async () => {
    const result = await renderSequenceOverlayToPng([], { width: FRAME_WIDTH, height: FRAME_HEIGHT });
    expect(result).toBeNull();
  });

  it("rasterizes a structured chart into a real PNG", async () => {
    const result = await renderSequenceOverlayToPng(
      [{ sceneId: "scene-001", type: "chart", description: "완료율", content: { kind: "chart", chartType: "bar", labels: ["전", "후"], values: [24, 76], unit: "%" } }],
      { width: FRAME_WIDTH, height: FRAME_HEIGHT }
    );
    expect(result?.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  });
});
