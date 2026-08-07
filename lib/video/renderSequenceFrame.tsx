import type { OverlayType, SequenceOverlayEntry } from "@/lib/pipeline/sequenceTypes";

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
 * SequenceOverlayEntry has no position/bbox/structured-data fields, only
 * `{sceneId, type, description}` free text (this is an intentional, already
 * reviewed constraint on the data model -- see sequenceTypes.ts). That means
 * this can't precisely position a "highlight" over a specific element in the
 * underlying AI-generated image, and can't synthesize a real chart/diagram
 * from thin air for those types. The honest interpretation used here: every
 * overlay renders as a distinctly-styled, type-coded banner/badge showing
 * its description text, at a fixed default zone per type. "label"/
 * "diagram"/"chart" (content annotations) stack along the bottom third;
 * "highlight"/"arrow-flow" (attention cues) stack in the top-right corner.
 * Multiple overlays in the same zone stack vertically via flex gap so they
 * never overlap.
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
          {style.label}
        </div>
        <div style={{ display: "flex", fontSize: 30, fontWeight: 600, color: "#FFFFFF" }}>{overlay.description}</div>
      </div>
    </div>
  );
}

/**
 * Pure layout builder for one scene's overlay layer, split out from the
 * Satori rasterization wrapper below the same way buildSceneFrameLayout is
 * split from renderSceneFrameToPng -- testable without invoking Satori.
 */
export function buildSequenceOverlayLayout(overlays: SequenceOverlayEntry[], frameWidth: number, frameHeight: number) {
  const cornerOverlays = overlays.filter((overlay) => OVERLAY_STYLES[overlay.type].zone === "corner");
  const bottomOverlays = overlays.filter((overlay) => OVERLAY_STYLES[overlay.type].zone === "bottom");

  return (
    <div
      style={{
        width: frameWidth,
        height: frameHeight,
        display: "flex",
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
    </div>
  );
}
