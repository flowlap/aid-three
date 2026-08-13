import type { OverlayType, SequenceOverlayContent, SequenceOverlayEntry } from "@/lib/pipeline/sequenceTypes";
import { LAYOUT_POSITIONS, type LayoutPosition } from "@/lib/pipeline/designVisuals";

/**
 * Overlays are composited by ffmpeg AFTER the crop+scale motion filter
 * (see lib/video/motionFilter.ts) is applied to the base scene image, as a
 * SEPARATE transparent-background layer -- not baked into the base frame
 * before cropping. If overlay text were part of the same image that gets
 * cropped/panned, it would drift, scale, and potentially exit frame along
 * with the camera motion, defeating the entire purpose of rendering
 * overlays via code (predictable, always-legible, stable positioning)
 * instead of relying on AI-generated image typography. This module renders
 * ONLY that overlay layer for one scene's SequenceOverlayEntry[] -- it does
 * not touch title-card rendering (renderSceneFrame.tsx stays as-is).
 *
 * Legacy SequenceOverlayEntry values have only `{sceneId, type, description}`
 * and remain type-coded banners. New plans may also carry a small structured
 * `content` payload: process steps, diagram nodes, chart values, or a
 * normalized highlight target. This module is the one rendering seam for
 * both versions, so old projects remain stable while new plans gain genuine
 * educational graphics without asking an image model to draw text or data.
 */

interface OverlayStyle {
  /** Which fixed zone this overlay type renders in. */
  zone: "bottom" | "corner";
  /** Short Korean type label shown above the description text. */
  label: string;
  /** Accent color used for the icon chip and left border, unique per type. */
  color: string;
  /** Plain-glyph icon (Satori has no icon-font/SVG-import support) — no emoji, for consistent cross-platform rendering. */
  icon: string;
}

const OVERLAY_STYLES: Record<OverlayType, OverlayStyle> = {
  label: { zone: "bottom", label: "라벨", color: "#2563EB", icon: "●" },
  diagram: { zone: "bottom", label: "다이어그램", color: "#7C3AED", icon: "◧" },
  chart: { zone: "bottom", label: "차트", color: "#059669", icon: "▤" },
  highlight: { zone: "corner", label: "강조", color: "#F59E0B", icon: "★" },
  "arrow-flow": { zone: "corner", label: "흐름", color: "#DC2626", icon: "→" },
};

/**
 * `maxWidth` defaults to the full bottom/corner-band width (1400) that every
 * existing caller relies on; a caller placing this chip inside one of the
 * 9-grid position cells (see buildSequenceOverlayLayout) passes the cell's
 * own (narrower) width instead, so the card doesn't overflow it. Only the
 * plain fallback banner below reads it — the structured flow/diagram/chart
 * branches never render inside a position cell (see the isStructured check
 * in buildSequenceOverlayLayout), so they keep their fixed structuredShell
 * width unconditionally.
 */
function renderOverlayChip(overlay: SequenceOverlayEntry, key: string, maxWidth = 1400) {
  const style = OVERLAY_STYLES[overlay.type];
  const structured = overlay.content;

  if (structured?.kind === "flow") return renderFlow(structured, style, key);
  if (structured?.kind === "diagram") return renderDiagram(structured, style, key);
  if (structured?.kind === "chart") return renderChart(structured, style, key);

  const title = structured?.kind === "label" ? structured.title : style.label;
  const body = structured?.kind === "label" ? structured.body ?? overlay.description : overlay.description;
  return (
    <div
      key={key}
      style={{
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
        gap: 20,
        maxWidth,
        backgroundColor: "rgba(17,17,17,0.72)",
        borderRadius: 16,
        padding: "20px 32px",
        borderLeft: `8px solid ${style.color}`,
      }}
    >
      <div
        style={{
          display: "flex",
          width: 48,
          height: 48,
          borderRadius: 24,
          backgroundColor: style.color,
          alignItems: "center",
          justifyContent: "center",
          fontSize: 24,
          color: "#FFFFFF",
        }}
      >
        {style.icon}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div style={{ display: "flex", fontSize: 20, fontWeight: 700, color: "rgba(255,255,255,0.75)" }}>
          {title}
        </div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: "#FFFFFF" }}>{body}</div>
      </div>
    </div>
  );
}

function structuredShell(style: OverlayStyle, key: string, children: React.ReactNode) {
  return (
    <div
      key={key}
      style={{
        display: "flex",
        flexDirection: "column",
        width: 1400,
        backgroundColor: "rgba(10, 16, 28, 0.86)",
        borderRadius: 20,
        padding: "24px 32px",
        gap: 18,
        borderTop: `8px solid ${style.color}`,
      }}
    >
      {children}
    </div>
  );
}

/** Deterministic process diagram — step count controls spacing, not a fixed text box. */
function renderFlow(content: Extract<SequenceOverlayContent, { kind: "flow" }>, style: OverlayStyle, key: string) {
  return structuredShell(
    style,
    key,
    <>
      <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: style.color }}>학습 절차</div>
      <div style={{ display: "flex", flexDirection: "row", alignItems: "center", width: "100%" }}>
        {content.steps.map((step, index) => (
          <div key={`${step}-${index}`} style={{ display: "flex", flexDirection: "row", alignItems: "center", flex: 1 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 10, flex: 1 }}>
              <div style={{ display: "flex", width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: style.color, color: "#FFFFFF", fontSize: 23, fontWeight: 700 }}>{index + 1}</div>
              <div style={{ display: "flex", fontSize: 25, fontWeight: 600, color: "#FFFFFF", textAlign: "center" }}>{step}</div>
            </div>
            {index < content.steps.length - 1 && <div style={{ display: "flex", width: 42, height: 3, backgroundColor: style.color, opacity: 0.8 }} />}
          </div>
        ))}
      </div>
    </>
  );
}

/** A compact relationship map: its node count changes the grid instead of stacking prose banners. */
function renderDiagram(content: Extract<SequenceOverlayContent, { kind: "diagram" }>, style: OverlayStyle, key: string) {
  const columns = content.layout === "hierarchy" ? 1 : Math.min(content.nodes.length, 4);
  return structuredShell(
    style,
    key,
    <>
      <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: style.color }}>
        {content.layout === "hierarchy" ? "개념 구조" : content.layout === "radial" ? "개념 관계" : "개념 흐름"}
      </div>
      <div style={{ display: "flex", flexDirection: "row", flexWrap: "wrap", justifyContent: "center", gap: 16 }}>
        {content.nodes.map((node, index) => (
          <div key={`${node}-${index}`} style={{ display: "flex", width: `${Math.floor(100 / columns) - 2}%`, minHeight: 66, alignItems: "center", justifyContent: "center", padding: "12px 18px", borderRadius: 14, border: `2px solid ${style.color}`, backgroundColor: index === 0 ? style.color : "rgba(255,255,255,0.07)", color: "#FFFFFF", fontSize: 24, fontWeight: 600, textAlign: "center" }}>{node}</div>
        ))}
      </div>
    </>
  );
}

/** Uses supplied numeric values directly; the renderer never invents chart data. */
function renderChart(content: Extract<SequenceOverlayContent, { kind: "chart" }>, style: OverlayStyle, key: string) {
  const maxValue = Math.max(...content.values.map(Math.abs), 1);
  const chartBody = content.chartType === "line" ? renderLineChart(content, style, maxValue) : renderBarChart(content, style, maxValue);
  return structuredShell(
    style,
    key,
    <>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 22, fontWeight: 700, color: style.color }}>
        <span>{content.chartType === "line" ? "데이터 추세" : "데이터 비교"}</span><span>{content.unit ?? ""}</span>
      </div>
      {chartBody}
    </>
  );
}

function renderBarChart(content: Extract<SequenceOverlayContent, { kind: "chart" }>, style: OverlayStyle, maxValue: number) {
  return (
    <div style={{ display: "flex", flexDirection: "row", alignItems: "flex-end", height: 180, gap: 18 }}>
      {content.values.map((value, index) => {
        const height = Math.max(10, Math.round((Math.abs(value) / maxValue) * 130));
        return (
          <div key={`${content.labels[index]}-${index}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 8, flex: 1, height: "100%" }}>
            <div style={{ display: "flex", fontSize: 22, fontWeight: 700, color: "#FFFFFF" }}>{`${value}${content.unit ?? ""}`}</div>
            <div style={{ display: "flex", width: "100%", height, minHeight: 10, borderRadius: "10px 10px 0 0", backgroundColor: style.color }} />
            <div style={{ display: "flex", fontSize: 19, color: "rgba(255,255,255,0.78)", textAlign: "center" }}>{content.labels[index]}</div>
          </div>
        );
      })}
    </div>
  );
}

function renderLineChart(content: Extract<SequenceOverlayContent, { kind: "chart" }>, style: OverlayStyle, maxValue: number) {
  const plotHeight = 118;
  const points = content.values.map((value, index) => ({
    x: content.values.length === 1 ? 50 : (index / (content.values.length - 1)) * 100,
    y: plotHeight - (Math.abs(value) / maxValue) * plotHeight,
  }));
  return (
    <div style={{ display: "flex", flexDirection: "column", height: 180, gap: 8 }}>
      <div style={{ display: "flex", position: "relative", height: plotHeight, borderBottom: "2px solid rgba(255,255,255,0.35)" }}>
        {points.slice(0, -1).map((point, index) => {
          const next = points[index + 1];
          const dx = next.x - point.x;
          const dy = next.y - point.y;
          const width = Math.sqrt(dx * dx + dy * dy);
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          return <div key={`line-${index}`} style={{ display: "flex", position: "absolute", left: `${point.x}%`, top: point.y, width: `${width}%`, height: 5, backgroundColor: style.color, transformOrigin: "left center", transform: `rotate(${angle}deg)`, borderRadius: 3 }} />;
        })}
        {points.map((point, index) => (
          <div key={`point-${index}`} style={{ display: "flex", position: "absolute", left: `calc(${point.x}% - 11px)`, top: point.y - 11, width: 22, height: 22, borderRadius: 11, backgroundColor: style.color, border: "4px solid #FFFFFF", alignItems: "center", justifyContent: "center" }} />
        ))}
      </div>
      <div style={{ display: "flex", flexDirection: "row" }}>
        {content.values.map((value, index) => (
          <div key={`${content.labels[index]}-${index}`} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, flex: 1 }}>
            <div style={{ display: "flex", fontSize: 21, fontWeight: 700, color: "#FFFFFF" }}>{`${value}${content.unit ?? ""}`}</div>
            <div style={{ display: "flex", fontSize: 19, color: "rgba(255,255,255,0.78)", textAlign: "center" }}>{content.labels[index]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function renderHighlightTarget(overlay: SequenceOverlayEntry, key: string, frameWidth: number, frameHeight: number) {
  if (overlay.content?.kind !== "highlight" || !overlay.content.target) return null;
  const { target, label } = overlay.content;
  return (
    <div key={key} style={{ display: "flex", position: "absolute", left: target.x * frameWidth, top: target.y * frameHeight, width: target.width * frameWidth, height: target.height * frameHeight, border: "7px solid #F59E0B", borderRadius: 18, boxShadow: "0 0 0 9999px rgba(0,0,0,0.12)" }}>
      {label && <div style={{ display: "flex", position: "absolute", top: -42, left: 0, padding: "7px 16px", borderRadius: 10, backgroundColor: "#F59E0B", color: "#111827", fontSize: 22, fontWeight: 700 }}>{label}</div>}
    </div>
  );
}

const GRID_PADDING = 72;

/**
 * Maps one of the 9 layout-elements-style grid positions (see
 * VisualDesign.layoutElements in designVisuals.ts and ScreenMockup's
 * LayoutElementsMockup, which renders the exact same 9 names as a 3x3
 * mockup grid) to the matching cell rect inside the frame — same padding as
 * the corner/bottom bands below, so a positioned card lines up with them.
 * `LAYOUT_POSITIONS` is already in row-major order (top-left, top,
 * top-right, left, center, ...), so its index alone gives row/col.
 */
/** Index 0/1/2 along one grid axis -> the flex alignment that hugs that axis's edge (or centers, for the middle index). */
const EDGE_ALIGNMENT: readonly ["flex-start", "center", "flex-end"] = ["flex-start", "center", "flex-end"];

function layoutPositionToCellRect(position: LayoutPosition, frameWidth: number, frameHeight: number) {
  const index = LAYOUT_POSITIONS.indexOf(position);
  const row = Math.floor(index / 3);
  const col = index % 3;
  const cellWidth = (frameWidth - GRID_PADDING * 2) / 3;
  const cellHeight = (frameHeight - GRID_PADDING * 2) / 3;
  return {
    left: GRID_PADDING + col * cellWidth,
    top: GRID_PADDING + row * cellHeight,
    width: cellWidth,
    height: cellHeight,
    alignItems: EDGE_ALIGNMENT[col],
    justifyContent: EDGE_ALIGNMENT[row],
  };
}

const STRUCTURED_CONTENT_KINDS = new Set(["flow", "diagram", "chart"]);

/**
 * Pure layout builder for one scene's overlay layer, split out from the
 * Satori rasterization wrapper below the same way buildSceneFrameLayout is
 * split from renderSceneFrameToPng -- testable without invoking Satori.
 *
 * `overlayPositions[i]`, when given, is screen-design's chosen 9-grid slot
 * for `overlays[i]` (see ScreenTypeAssignment.overlayPositions) — but it
 * only ever applies to the plain fallback banner (no structured content, or
 * a non-targeted highlight): flow/diagram/chart keep their fixed
 * structuredShell width and existing bottom-band stacking regardless (see
 * the module doc / the plan this shipped under for why), and a
 * target-based highlight already has its own precise placement. Omitting
 * the 4th argument (or leaving an index undefined) reproduces the exact
 * legacy corner/bottom stacking byte-for-byte, so old projects/tests are
 * unaffected.
 */
export function buildSequenceOverlayLayout(
  overlays: SequenceOverlayEntry[],
  frameWidth: number,
  frameHeight: number,
  overlayPositions?: (LayoutPosition | undefined)[]
) {
  const targetHighlights = overlays.filter((overlay) => overlay.content?.kind === "highlight" && overlay.content.target);

  // Only a plain fallback banner (no content, a "label", or an untargeted
  // "highlight") can be moved to a screen-design-chosen grid cell — matched
  // to its ORIGINAL index in `overlays` (not any filtered array) since
  // that's the index space overlayPositions was produced in.
  const positionByOverlay = new Map<SequenceOverlayEntry, LayoutPosition>();
  overlays.forEach((overlay, index) => {
    if (targetHighlights.includes(overlay)) return;
    if (overlay.content && STRUCTURED_CONTENT_KINDS.has(overlay.content.kind)) return;
    const position = overlayPositions?.[index];
    if (position) positionByOverlay.set(overlay, position);
  });

  const cornerOverlays = overlays.filter(
    (overlay) => OVERLAY_STYLES[overlay.type].zone === "corner" && !targetHighlights.includes(overlay) && !positionByOverlay.has(overlay)
  );
  const bottomOverlays = overlays.filter(
    (overlay) => OVERLAY_STYLES[overlay.type].zone === "bottom" && !positionByOverlay.has(overlay)
  );

  const positionGroups = new Map<LayoutPosition, SequenceOverlayEntry[]>();
  for (const overlay of overlays) {
    const position = positionByOverlay.get(overlay);
    if (!position) continue;
    const group = positionGroups.get(position) ?? [];
    group.push(overlay);
    positionGroups.set(position, group);
  }

  return (
    <div
      style={{
        width: frameWidth,
        height: frameHeight,
        display: "flex",
        position: "relative",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: GRID_PADDING,
        fontFamily: "Pretendard",
      }}
    >
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "flex-end", width: "100%" }}>
        {cornerOverlays.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 20 }}>
            {cornerOverlays.map((overlay, index) => renderOverlayChip(overlay, `corner-${index}`))}
          </div>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "row", justifyContent: "center", width: "100%" }}>
        {bottomOverlays.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
            {bottomOverlays.map((overlay, index) => renderOverlayChip(overlay, `bottom-${index}`))}
          </div>
        )}
      </div>
      {targetHighlights.map((overlay, index) => renderHighlightTarget(overlay, `highlight-target-${index}`, frameWidth, frameHeight))}
      {Array.from(positionGroups.entries()).map(([position, group]) => {
        const rect = layoutPositionToCellRect(position, frameWidth, frameHeight);
        return (
          <div
            key={`cell-${position}`}
            style={{
              display: "flex",
              position: "absolute",
              left: rect.left,
              top: rect.top,
              width: rect.width,
              height: rect.height,
              flexDirection: "column",
              alignItems: rect.alignItems,
              justifyContent: rect.justifyContent,
              gap: 16,
            }}
          >
            {group.map((overlay, index) => renderOverlayChip(overlay, `cell-${position}-${index}`, rect.width - 24))}
          </div>
        );
      })}
    </div>
  );
}
