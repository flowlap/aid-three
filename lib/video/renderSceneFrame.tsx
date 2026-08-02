import type { Scene } from "@/lib/pipeline/splitScenes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

export const FRAME_WIDTH = 1920;
export const FRAME_HEIGHT = 1080;

/**
 * JSX for one video frame, rendered via next/og's `ImageResponse` (Satori).
 * Satori supports only a CSS subset — no Tailwind classes, no CSS custom
 * properties, no imported icon components — so this can't reuse
 * ScreenMockup.tsx/NotebookLmMockup.tsx directly. It's a separate,
 * purpose-built layout using only inline styles, matching NotebookLmMockup's
 * warm/minimal visual language (see components/NotebookLmMockup.tsx).
 */
export function buildSceneFrameLayout(scene: Scene, design: VisualDesign | undefined, imageDataUri?: string) {
  const caption = design?.caption?.trim() || scene.narrationText.slice(0, 40);
  const keywords = design?.keywords ?? [];

  return (
    <div
      style={{
        width: FRAME_WIDTH,
        height: FRAME_HEIGHT,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 48,
        padding: 96,
        backgroundImage: "linear-gradient(135deg, #FDF6EC 0%, #FCE7D2 100%)",
        fontFamily: "Pretendard",
      }}
    >
      {imageDataUri ? (
        // eslint-disable-next-line jsx-a11y/alt-text -- Satori rendering, not real DOM/a11y tree
        <img
          src={imageDataUri}
          width={960}
          height={640}
          style={{ borderRadius: 32, objectFit: "cover", boxShadow: "0 20px 60px rgba(0,0,0,0.12)" }}
        />
      ) : (
        <div
          style={{
            display: "flex",
            width: 160,
            height: 160,
            borderRadius: 80,
            backgroundColor: "rgba(217,119,6,0.15)",
          }}
        />
      )}
      <div
        style={{
          display: "flex",
          maxWidth: 1400,
          fontSize: 64,
          fontWeight: 700,
          lineHeight: 1.3,
          color: "#44403C",
          textAlign: "center",
        }}
      >
        {caption}
      </div>
      {keywords.length > 0 && (
        <div style={{ display: "flex", gap: 16 }}>
          {keywords.slice(0, 3).map((kw) => (
            <div
              key={kw}
              style={{
                display: "flex",
                borderRadius: 999,
                padding: "12px 28px",
                fontSize: 32,
                color: "#57534E",
                backgroundColor: "rgba(255,255,255,0.7)",
              }}
            >
              {kw}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
