import {
  BarChart3,
  Clock,
  Columns2,
  Image as ImageIcon,
  ListChecks,
  NotebookText,
  Quote,
  Type,
  User,
  Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

const TYPE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  "텍스트 강조형": Type,
  "인물 등장형": User,
  "이미지 설명형": ImageIcon,
  "표/그래프형": BarChart3,
  "절차 애니메이션형": Workflow,
  "비교 대조형": Columns2,
  "타임라인형": Clock,
  "인용/사례형": Quote,
  "체크리스트형": ListChecks,
  "요약/정리형": NotebookText,
};

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
 */
export function ScreenMockup({
  screenType,
  design,
  showTypeBadge = true,
  className,
}: {
  screenType?: string;
  design?: VisualDesign;
  showTypeBadge?: boolean;
  className?: string;
}) {
  const caption = design?.caption ?? "";
  const items = design?.appearanceOrder ?? [];
  const keywords = design?.keywords ?? [];
  const Icon = (screenType && TYPE_ICONS[screenType]) || ImageIcon;

  const body = (() => {
    switch (screenType) {
      case "텍스트 강조형":
        return (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <IconBadge icon={Icon} />
            <p className="text-base leading-snug font-semibold text-balance">{caption || "핵심 문구"}</p>
          </div>
        );

      case "인물 등장형":
        return (
          <div className="flex h-full items-center gap-4 px-6">
            <div className="flex size-16 shrink-0 flex-col items-center justify-center gap-1 rounded-full bg-primary/10 text-primary">
              <User className="size-6" />
            </div>
            <p className="flex-1 text-sm leading-snug text-foreground/80">{caption}</p>
          </div>
        );

      case "표/그래프형":
        return (
          <div className="flex h-full flex-col gap-3 p-5">
            <div className="flex items-center gap-2">
              <IconBadge icon={Icon} className="size-6" />
              <p className="text-xs font-semibold">{caption || "제목"}</p>
            </div>
            <div className="flex flex-1 items-end gap-2 border-b border-border/70 pb-0.5">
              {[40, 70, 55, 90, 30].map((h, i) => (
                <div key={i} className="flex-1 rounded-t bg-primary/25" style={{ height: `${h}%` }} />
              ))}
            </div>
          </div>
        );

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

      case "비교 대조형":
        return (
          <div className="relative flex h-full">
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-foreground/80">
              {items[0] ?? "좌측 항목"}
            </div>
            <div className="w-px shrink-0 bg-border" />
            <div className="flex flex-1 items-center justify-center p-4 text-center text-xs text-foreground/80">
              {items[1] ?? "우측 항목"}
            </div>
            <span className="absolute top-1/2 left-1/2 flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-background text-[9px] font-bold text-muted-foreground ring-1 ring-border">
              VS
            </span>
          </div>
        );

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
  })();

  return (
    <div
      className={cn(
        "relative aspect-[3/2] w-full overflow-hidden rounded-lg border border-dashed bg-[radial-gradient(circle,var(--color-border)_1px,transparent_1px)] [background-size:14px_14px]",
        className
      )}
    >
      <div className="absolute inset-0 bg-background/70" />
      <div className="relative h-full">
        {showTypeBadge && screenType && (
          <span className="absolute top-2 left-2 z-10 rounded-full bg-background/90 px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
            {screenType}
          </span>
        )}
        {body}
      </div>
    </div>
  );
}
