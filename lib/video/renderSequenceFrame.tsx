import type { OverlayType, SequenceOverlayContent, SequenceOverlayEntry } from "@/lib/pipeline/sequenceTypes";

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

function renderOverlayChip(overlay: SequenceOverlayEntry, key: string) {
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
        maxWidth: 1400,
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

/**
 * Pure layout builder for one scene's overlay layer, split out from the
 * Satori rasterization wrapper below the same way buildSceneFrameLayout is
 * split from renderSceneFrameToPng -- testable without invoking Satori.
 */
export function buildSequenceOverlayLayout(overlays: SequenceOverlayEntry[], frameWidth: number, frameHeight: number) {
  const targetHighlights = overlays.filter((overlay) => overlay.content?.kind === "highlight" && overlay.content.target);
  const cornerOverlays = overlays.filter((overlay) => OVERLAY_STYLES[overlay.type].zone === "corner" && !targetHighlights.includes(overlay));
  const bottomOverlays = overlays.filter((overlay) => OVERLAY_STYLES[overlay.type].zone === "bottom");

  return (
    <div
      style={{
        width: frameWidth,
        height: frameHeight,
        display: "flex",
        position: "relative",
        flexDirection: "column",
        justifyContent: "space-between",
        padding: 72,
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
    </div>
  );
}
