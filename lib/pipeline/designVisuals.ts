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

export const PRESENTER_POSITIONS = ["left", "right", "center", "full"] as const;

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
   * variety enforced against neighboring scenes, rather than left to each
   * independent image-generation call to guess (which in practice defaulted
   * to the same position every time). Undefined for scenes where a
   * presenter doesn't make sense (pure transition screens — see
   * PRESENTER_EXCLUDED_SCREEN_TYPES) or for older data from before this
   * field existed.
   */
  presenterPosition?: PresenterPosition;
}
