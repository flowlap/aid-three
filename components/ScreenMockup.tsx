import { Image as ImageIcon, Quote, User, ListChecks, Network } from "lucide-react";
import { cn } from "@/lib/utils";
import { TYPE_ICONS } from "./screenTypeIcons";
import { NotebookLmMockup } from "./NotebookLmMockup";
import { personGoesOnRight } from "@/lib/visual-templates";
import { LAYOUT_POSITIONS, type LayoutElement, type LayoutPosition, type VisualDesign } from "@/lib/pipeline/designVisuals";

/**
 * Renders the AI's `layoutElements` (see designVisuals.ts) as a 3x3 grid —
 * a generic layout driven directly by this scene's own screen design,
 * instead of the fixed per-screenType compositions below. Used whenever the
 * screen design step actually produced structured placement data, which
 * closes most of the gap between what the mockup shows and what the AI
 * image (driven by the same objectPlacement text) actually draws.
 */
/**
 * `caption` (the actual on-screen subtitle authored for this scene) is
 * always rendered too — the grid alone was just abstract element-name chips
 * ("배출권 ETF 카드") with no real scene content visible anywhere in the
 * mockup.
 */
function LayoutElementsMockup({ elements, caption }: { elements: LayoutElement[]; caption: string }) {
  const byPosition = new Map<LayoutPosition, string[]>();
  for (const el of elements) {
    const list = byPosition.get(el.position) ?? [];
    list.push(el.label);
    byPosition.set(el.position, list);
  }

  return (
    <div className="flex h-full flex-col">
      <div className="grid flex-1 grid-cols-3 grid-rows-3 gap-1 p-3">
        {LAYOUT_POSITIONS.map((pos) => {
          const labels = byPosition.get(pos);
          return (
            <div
              key={pos}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-md p-1 text-center",
                labels && "border border-dashed border-border/60 bg-muted/30"
              )}
            >
              {labels?.map((label, i) => (
                <span key={i} className="rounded-full bg-primary/10 px-2 py-0.5 text-[9px] leading-tight font-medium text-primary">
                  {label}
                </span>
              ))}
            </div>
          );
        })}
      </div>
      {caption && (
        <p className="border-t bg-background/90 px-3 py-1.5 text-center text-xs font-semibold text-balance">{caption}</p>
      )}
    </div>
  );
}

function IconBadge({
  icon: Icon,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary",
        className
      )}
    >
      <Icon className="size-4" />
    </span>
  );
}

/**
 * Renders a code-only wireframe of a scene's screen design (no AI image
 * involved) so users always have a layout reference, even before or instead
 * of generating an AI image. The arrangement is derived purely from
 * `screenType` + the scene's VisualDesign fields — same inputs the AI image
 * prompt uses, just visualized as HTML/CSS instead of a raster image.
 *
 * Never truncates text with an ellipsis: `design.caption` is expected to
 * already be a short AI-written summary (see selectScreenTypes), so the
 * layouts below just wrap it instead of clamping/cutting it.
 *
 * `variantIndex` rotates through a few different compositions for the
 * screen types most likely to repeat often in a deck (title cards, emphasis
 * screens — see MOCKUP_VARIANT_COUNTS in lib/visual-templates), so scenes
 * sharing a screenType don't all render as an identical box. Callers should
 * pass the value from computeMockupVariantIndexes; types without a
 * registered variant count just ignore it.
 */
export function ScreenMockup({
  screenType,
  design,
  showTypeBadge = true,
  variantIndex = 0,
  className,
  style = "storyboard",
  aspectRatio,
}: {
  screenType?: string;
  design?: VisualDesign;
  showTypeBadge?: boolean;
  variantIndex?: number;
  className?: string;
  /** "storyboard" (default) is this file's dense per-type wireframe; "notebooklm" delegates to NotebookLmMockup's minimal warm-tone card. Same VisualDesign data, different rendering. */
  style?: "storyboard" | "notebooklm";
  /** Actual generated-image pixel ratio (see lib/pipeline/imageAspectRatio.ts) so the mockup sits at the same aspect as the AI image next to it, instead of always 3:2 — omit where no image exists yet (e.g. screen-design step). */
  aspectRatio?: { width: number; height: number };
}) {
  if (style === "notebooklm") {
    return <NotebookLmMockup screenType={screenType} design={design} className={className} aspectRatio={aspectRatio} />;
  }

  const caption = design?.caption ?? "";
  const items = design?.appearanceOrder ?? [];
  const keywords = design?.keywords ?? [];
  const Icon = (screenType && TYPE_ICONS[screenType]) || ImageIcon;

  const body = design?.layoutElements?.length ? (
    <LayoutElementsMockup elements={design.layoutElements} caption={caption} />
  ) : (
    (() => {
    switch (screenType) {
      case "간지/타이틀형": {
        if (variantIndex % 3 === 1) {
          return (
            <div className="flex h-full items-center gap-4 pr-6 pl-5">
              <span className="h-16 w-1 shrink-0 rounded-full bg-primary" />
              <p className="text-lg leading-snug font-bold text-balance">{caption || "챕터 제목"}</p>
            </div>
          );
        }
        if (variantIndex % 3 === 2) {
          return (
            <div className="flex h-full flex-col items-center justify-center gap-2 bg-primary px-6 text-center text-primary-foreground">
              <Icon className="size-5 opacity-80" />
              <p className="text-lg leading-snug font-bold text-balance">{caption || "챕터 제목"}</p>
            </div>
          );
        }
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="h-px w-10 bg-border" />
            <p className="text-lg leading-snug font-bold text-balance">{caption || "챕터 제목"}</p>
            <span className="h-px w-10 bg-border" />
          </div>
        );
      }

      case "텍스트 강조형": {
        if (variantIndex % 3 === 1) {
          return (
            <div className="flex h-full items-center gap-4 pr-6 pl-5">
              <span className="h-14 w-1 shrink-0 rounded-full bg-primary" />
              <p className="text-base leading-snug font-semibold text-balance">{caption || "핵심 문구"}</p>
            </div>
          );
        }
        if (variantIndex % 3 === 2) {
          return (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1.5 text-primary">
                <Icon className="size-3.5" />
              </span>
              <p className="text-base leading-snug font-semibold text-balance">{caption || "핵심 문구"}</p>
            </div>
          );
        }
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <IconBadge icon={Icon} />
            <p className="text-base leading-snug font-semibold text-balance">{caption || "핵심 문구"}</p>
          </div>
        );
      }

      case "인물 등장형":
        return (
          <div className={cn("flex h-full items-center gap-4 px-6", personGoesOnRight(design?.objectPlacement ?? "") && "flex-row-reverse")}>
            <div className="flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-full bg-primary/10 text-primary">
              <User className="size-6" />
            </div>
            <p className="flex-1 text-sm leading-snug text-foreground/80">{caption}</p>
          </div>
        );

      case "표/그래프형": {
        const heights = [40, 70, 55, 90, 30];
        const labels = keywords.length ? keywords.slice(0, heights.length) : [];
        return (
          <div className="flex h-full flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <IconBadge icon={Icon} className="size-6" />
              <p className="text-xs font-semibold">{caption || "제목"}</p>
            </div>
            <div className="flex flex-1 gap-2">
              {heights.map((h, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div className="flex w-full flex-1 items-end">
                    <div className="w-full rounded-t bg-primary/25" style={{ height: `${h}%` }} />
                  </div>
                  {labels[i] && (
                    <span className="max-w-full truncate text-[9px] text-muted-foreground">{labels[i]}</span>
                  )}
                </div>
              ))}
            </div>
            <div className="h-px bg-border/70" />
          </div>
        );
      }

      case "인포그래픽형": {
        const nodes = keywords.length ? keywords.slice(0, 4) : items.slice(0, 4);
        const fallbackNodes = nodes.length ? nodes : ["개념 A", "개념 B", "개념 C"];
        const positions = [
          { top: "10%", left: "50%" },
          { top: "60%", left: "10%" },
          { top: "60%", left: "90%" },
          { top: "88%", left: "50%" },
        ];
        return (
          <div className="relative h-full p-4">
            <span className="absolute top-1/2 left-1/2 flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Network className="size-4" />
            </span>
            {fallbackNodes.map((node, i) => {
              const pos = positions[i] ?? positions[positions.length - 1];
              return (
                <span
                  key={i}
                  className="absolute max-w-20 -translate-x-1/2 -translate-y-1/2 rounded-full bg-background px-2 py-1 text-center text-[9px] text-foreground/80 ring-1 ring-border"
                  style={pos}
                >
                  {node}
                </span>
              );
            })}
          </div>
        );
      }

      case "절차 애니메이션형": {
        const steps = items.length ? items.slice(0, 4) : ["1단계", "2단계", "3단계"];
        return (
          <div className="flex h-full flex-col justify-center gap-4 p-5">
            <div className="flex items-center">
              {steps.map((step, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1 last:flex-none">
                  <div className="flex w-full items-center">
                    <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-semibold text-primary">
                      {i + 1}
                    </div>
                    {i < steps.length - 1 && <span className="mx-1 h-px flex-1 bg-border" />}
                  </div>
                  <span className="max-w-[72px] text-center text-[10px] text-muted-foreground">{step}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-foreground/70">{caption}</p>
          </div>
        );
      }

      case "비교 대조형": {
        const [leftLabel, rightLabel] = keywords.length >= 2 ? keywords : ["A", "B"];
        return (
          <div className="relative flex h-full">
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center">
              <span className="text-[10px] font-semibold text-muted-foreground">{leftLabel}</span>
              <span className="text-xs text-foreground/80">{items[0] ?? "좌측 항목"}</span>
            </div>
            <div className="w-px shrink-0 bg-border" />
            <div className="flex flex-1 flex-col items-center justify-center gap-1.5 p-4 text-center">
              <span className="text-[10px] font-semibold text-muted-foreground">{rightLabel}</span>
              <span className="text-xs text-foreground/80">{items[1] ?? "우측 항목"}</span>
            </div>
            <span className="absolute top-1/2 left-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background text-[9px] font-bold text-muted-foreground ring-1 ring-border">
              VS
            </span>
          </div>
        );
      }

      case "타임라인형": {
        const points = items.length ? items.slice(0, 5) : ["시작", "중간", "끝"];
        return (
          <div className="flex h-full flex-col justify-center gap-4 px-6">
            <div className="flex items-center">
              {points.map((point, i) => (
                <div key={i} className="flex flex-1 flex-col items-center gap-1 last:flex-none">
                  <div className="flex w-full items-center">
                    <span className="size-2.5 shrink-0 rounded-full bg-primary" />
                    {i < points.length - 1 && <span className="h-px flex-1 bg-border" />}
                  </div>
                  <span className="max-w-[64px] text-center text-[10px] text-muted-foreground">{point}</span>
                </div>
              ))}
            </div>
            <p className="text-center text-xs text-foreground/70">{caption}</p>
          </div>
        );
      }

      case "용어 정의형": {
        const term = keywords[0] ?? caption;
        return (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <p className="text-lg font-bold text-primary">{term}</p>
            <span className="h-px w-10 bg-border" />
            <p className="text-xs text-foreground/70">{caption}</p>
          </div>
        );
      }

      case "질문/퀴즈형":
        return (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
            <IconBadge icon={Icon} />
            <p className="text-base leading-snug font-semibold text-balance">{caption || "질문"}</p>
          </div>
        );

      case "인용/사례형":
        return (
          <div className="flex h-full flex-col items-center justify-center gap-2 px-8 text-center">
            <Quote className="size-5 text-primary/60" />
            <p className="text-sm leading-snug text-balance italic">{caption}</p>
          </div>
        );

      case "체크리스트형": {
        const rows = items.length ? items : keywords.length ? keywords : ["항목 1", "항목 2", "항목 3"];
        return (
          <div className="flex h-full flex-col justify-center gap-2 p-5">
            {rows.slice(0, 4).map((item, i) => (
              <div key={i} className="flex items-start gap-2 text-xs">
                <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-primary/15 text-primary">
                  <ListChecks className="size-2.5" />
                </span>
                <span className="text-foreground/80">{item}</span>
              </div>
            ))}
          </div>
        );
      }

      case "요약/정리형": {
        const rows = keywords.length ? keywords : items;
        return (
          <div className="flex h-full flex-col justify-center gap-2 p-5">
            <div className="flex items-center gap-2">
              <IconBadge icon={Icon} className="size-6" />
              <p className="text-xs font-semibold">{caption || "정리"}</p>
            </div>
            <div className="space-y-1.5 pl-1">
              {rows.slice(0, 4).map((kw, i) => (
                <div key={i} className="flex items-center gap-2 text-xs text-foreground/80">
                  <span className="size-1.5 shrink-0 rounded-full bg-primary" />
                  <span>{kw}</span>
                </div>
              ))}
            </div>
          </div>
        );
      }

      case "이미지 설명형":
      default:
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <IconBadge icon={Icon} />
            <p className="text-xs text-foreground/70">{caption}</p>
          </div>
        );
    }
    })()
  );

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {showTypeBadge && screenType && (
        <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
          {screenType}
        </span>
      )}
      <div
        className="relative w-full overflow-hidden rounded-lg border border-dashed bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [background-size:14px_14px]"
        style={{ aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : "3 / 2" }}
      >
        <div className="absolute inset-0 bg-background/70" />
        <div className="relative h-full">{body}</div>
      </div>
    </div>
  );
}

/**
 * Width ScreenMockup is designed against elsewhere (screen-design/images
 * steps, preview) — its text/padding sizes read correctly at roughly this
 * width. ScreenMockupThumbnail renders at this width and scales the whole
 * thing down, so a thumbnail is a true miniature (same relative
 * proportions) instead of the same fixed font sizes cramped into a smaller
 * box, which breaks wrapping and overflow at small widths.
 */
const MOCKUP_NATURAL_WIDTH = 420;

/**
 * A small, fixed-width rendering of ScreenMockup for contexts (like the
 * final storyboard list) that need a thumbnail rather than a full-size
 * mockup. Renders ScreenMockup at MOCKUP_NATURAL_WIDTH, then shrinks it with
 * a CSS transform anchored top-left — the browser lays out and sizes fonts
 * at natural width first, so the result reads as the natural mockup zoomed
 * out, not a distorted small copy. `width` also fixes the outer box's
 * layout footprint (height follows from the shared 3:2 aspect ratio).
 */
export function ScreenMockupThumbnail({
  width,
  screenType,
  design,
  variantIndex,
  aspectRatio,
}: {
  width: number;
  screenType?: string;
  design?: VisualDesign;
  variantIndex?: number;
  /** See ScreenMockup's aspectRatio prop. Applied to both the outer box and the inner ScreenMockup so the transform:scale() math (which scales width/height uniformly) lines up. */
  aspectRatio?: { width: number; height: number };
}) {
  const scale = width / MOCKUP_NATURAL_WIDTH;
  return (
    <div
      className="relative shrink-0 overflow-hidden rounded-lg"
      style={{ width, aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : "3 / 2" }}
    >
      <div
        className="absolute top-0 left-0"
        style={{ width: MOCKUP_NATURAL_WIDTH, transform: `scale(${scale})`, transformOrigin: "top left" }}
      >
        <ScreenMockup
          screenType={screenType}
          design={design}
          showTypeBadge={false}
          variantIndex={variantIndex}
          className="w-full"
          aspectRatio={aspectRatio}
        />
      </div>
    </div>
  );
}
