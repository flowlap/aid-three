export const LAYOUT_POSITIONS = [
  "top-left",
  "top",
  "top-right",
  "left",
  "center",
  "right",
  "bottom-left",
  "bottom",
  "bottom-right",
] as const;

export type LayoutPosition = (typeof LAYOUT_POSITIONS)[number];

export interface LayoutElement {
  label: string;
  position: LayoutPosition;
}

export const PRESENTER_POSITIONS = ["left", "right", "center", "full", "none"] as const;

export type PresenterPosition = (typeof PRESENTER_POSITIONS)[number];

export interface VisualDesign {
  caption: string;
  keywords: string[];
  imageOrDiagramDescription: string;
  objectPlacement: string;
  appearanceOrder: string[];
  productionNotes: string;
  /**
   * Compact, structured version of `objectPlacement` — a handful of
   * (label, 3x3-grid position) pairs — so ScreenMockup can render a generic
   * layout that actually reflects this scene's specific screen design
   * instead of always falling back to a fixed per-screenType template.
   * `objectPlacement` stays as the richer freeform text for the AI image
   * prompt; this is the same information distilled for code rendering.
   */
  layoutElements?: LayoutElement[];
  /**
   * Where the presenter/announcer should appear if the images step's
   * "강사 표시" toggle is on — decided once here (screen design), with
   * variety encouraged against neighboring scenes, rather than left to each
   * independent image-generation call to guess (which in practice defaulted
   * to the same position every time). `"none"` means the AI judged the
   * presenter doesn't fit this particular screen even though the toggle is
   * on — distinct from `undefined`, which is for scenes where a presenter
   * doesn't make sense by screen type (pure transition screens — see
   * PRESENTER_EXCLUDED_SCREEN_TYPES) or for older data from before this
   * field existed.
   */
  presenterPosition?: PresenterPosition;
  /**
   * Sequence mode only — a 3x3-grid position per entry of this scene's
   * `Sequence.overlays` (same sceneId-filtered order used everywhere:
   * buildSequenceContextByScene, bakeSequenceSceneStill, buildSequenceTimeline
   * — so index i here always means "the i-th overlay planned for this
   * scene"). Lets the sequence-mode composite overlay renderer
   * (renderSequenceFrame.tsx) place a scene's fallback label/highlight cards
   * according to THIS scene's actual screen design instead of always
   * stacking them in the same two fixed zones. Undefined (or an
   * out-of-range/invalid entry) for structured overlays (flow/diagram/chart)
   * and target-based highlights, which keep their existing placement
   * regardless — see renderSequenceFrame.tsx's OVERLAY_STYLES/zone system —
   * and for scene-mode projects, which have no Sequence.overlays at all.
   */
  overlayPositions?: (LayoutPosition | undefined)[];
}
