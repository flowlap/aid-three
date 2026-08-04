import { LAYOUT_POSITIONS, type LayoutElement, type LayoutPosition, type VisualDesign } from "@/lib/pipeline/designVisuals";

const GRID_CELL_BG = "rgba(214,211,209,0.4)";
const GRID_CELL_BORDER = "2px dashed rgba(87,83,78,0.4)";
const MOCKUP_BG = "#F5F5F4";

/**
 * Fraction of `height`/`width` reserved as a safe-area padding buffer around
 * real content (grid labels, the caption bar/card) on every edge.
 * lib/pptx/exportPptx.ts cover-crops whatever mockup image this renders to
 * fit the destination template's "화면 영역" placeholder box, and that crop
 * can eat into any edge (top/bottom or left/right) depending on how the
 * box's aspect ratio compares to this render's — e.g. the bundled default
 * template's box ratio (1.9038) vs. this file's 16:9 render (1.7778) crops
 * ~3.31% (~30px of a 900px-tall render) off the top and bottom alone. 7%
 * comfortably clears that with margin to spare for other template ratios
 * too, so a crop only ever removes background color, never text.
 */
const SAFE_AREA_FRACTION = 0.07;

/**
 * JSX for a generic layout-grid mockup frame, rendered via next/og's
 * `ImageResponse` (Satori) in lib/pptx/renderMockupImage.ts — used for pptx
 * export when a scene has no AI-generated image yet. Satori supports only a
 * CSS subset (no Tailwind classes, no CSS custom properties), so this can't
 * reuse ScreenMockup.tsx's LayoutElementsMockup directly; it's a
 * purpose-built re-implementation of the same 3x3 grid + caption using only
 * inline styles, matching lib/video/renderSceneFrame.tsx's approach to the
 * same constraint. Falls back to a plain caption/screen-type card when
 * `design.layoutElements` is missing (older screen-design data).
 */
export function buildMockupLayout(
  design: VisualDesign | undefined,
  screenType: string | undefined,
  width: number,
  height: number
) {
  const caption = design?.caption?.trim() || screenType || "화면 미리보기";
  const elements = design?.layoutElements ?? [];

  if (elements.length === 0) {
    return buildEmptyMockupLayout(caption, screenType, width, height);
  }

  return buildGridMockupLayout(elements, caption, width, height);
}

/** Caption-only fallback card (no `layoutElements` to draw a grid from). */
function buildEmptyMockupLayout(caption: string, screenType: string | undefined, width: number, height: number) {
  const padY = Math.round(height * SAFE_AREA_FRACTION);
  const padX = Math.round(width * SAFE_AREA_FRACTION);

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 16,
        paddingTop: padY,
        paddingBottom: padY,
        paddingLeft: padX,
        paddingRight: padX,
        backgroundColor: MOCKUP_BG,
        fontFamily: "Pretendard",
      }}
    >
      {screenType && <div style={{ display: "flex", fontSize: 22, color: "#78716C" }}>{screenType}</div>}
      <div
        style={{
          display: "flex",
          maxWidth: width - padX * 2,
          fontSize: 32,
          fontWeight: 700,
          color: "#44403C",
          textAlign: "center",
        }}
      >
        {caption}
      </div>
    </div>
  );
}

/** 3x3 layout-elements grid with a caption bar underneath. */
function buildGridMockupLayout(elements: LayoutElement[], caption: string, width: number, height: number) {
  const byPosition = new Map<LayoutPosition, string[]>();
  for (const el of elements) {
    const list = byPosition.get(el.position) ?? [];
    list.push(el.label);
    byPosition.set(el.position, list);
  }

  const padY = Math.round(height * SAFE_AREA_FRACTION);
  const padX = Math.round(width * SAFE_AREA_FRACTION);

  return (
    <div
      style={{
        width,
        height,
        display: "flex",
        flexDirection: "column",
        paddingTop: padY,
        paddingBottom: padY,
        paddingLeft: padX,
        paddingRight: padX,
        backgroundColor: MOCKUP_BG,
        fontFamily: "Pretendard",
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", flex: 1 }}>
        {LAYOUT_POSITIONS.map((pos) => {
          const labels = byPosition.get(pos) ?? [];
          return (
            <div
              key={pos}
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
                width: `${100 / 3}%`,
                height: `${100 / 3}%`,
                ...(labels.length > 0 ? { border: GRID_CELL_BORDER, backgroundColor: GRID_CELL_BG } : {}),
              }}
            >
              {labels.map((label, i) => (
                <div
                  key={i}
                  style={{
                    display: "flex",
                    borderRadius: 999,
                    padding: "8px 20px",
                    fontSize: 20,
                    fontWeight: 600,
                    color: "#57534E",
                    backgroundColor: "rgba(255,255,255,0.85)",
                  }}
                >
                  {label}
                </div>
              ))}
            </div>
          );
        })}
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "center",
          borderTop: "1px solid #D6D3D1",
          backgroundColor: "rgba(255,255,255,0.9)",
          padding: "20px 32px",
        }}
      >
        <div style={{ display: "flex", fontSize: 26, fontWeight: 700, color: "#292524", textAlign: "center" }}>{caption}</div>
      </div>
    </div>
  );
}
