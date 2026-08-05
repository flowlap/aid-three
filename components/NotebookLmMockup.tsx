import { Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { TYPE_ICONS } from "./screenTypeIcons";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

/**
 * NotebookLM "비디오 개요" 느낌의 미니멀·따뜻한 톤 카드. ScreenMockup의
 * 화면 유형별 밀도 높은 와이어프레임과 달리, 모든 화면 유형에 같은 절제된
 * 레이아웃(아이콘 + 큰 명사형 캡션 + 키워드 칩)을 적용한다 — 같은
 * VisualDesign 데이터를 다르게 보여줄 뿐 새 데이터·새 AI 호출은 없다.
 */
export function NotebookLmMockup({
  screenType,
  design,
  className,
  aspectRatio,
}: {
  screenType?: string;
  design?: VisualDesign;
  className?: string;
  /** See ScreenMockup's aspectRatio prop — same purpose, passed through when delegated to from there. */
  aspectRatio?: { width: number; height: number };
}) {
  const caption = design?.caption ?? "";
  const keywords = design?.keywords ?? [];
  const Icon = (screenType && TYPE_ICONS[screenType]) || ImageIcon;

  return (
    <div
      className={cn(
        "relative flex w-full flex-col items-center justify-center gap-4 overflow-hidden rounded-2xl bg-gradient-to-br from-amber-50 to-orange-100 px-8 text-center dark:from-amber-950/40 dark:to-orange-950/30",
        className
      )}
      style={{ aspectRatio: aspectRatio ? `${aspectRatio.width} / ${aspectRatio.height}` : "3 / 2" }}
    >
      <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-white/80 text-orange-600 shadow-sm dark:bg-white/10 dark:text-orange-300">
        <Icon className="size-5" />
      </span>
      <p className="text-xl leading-snug font-bold text-balance text-stone-800 dark:text-stone-100">
        {caption || "핵심 요약"}
      </p>
      {keywords.length > 0 && (
        <div className="flex flex-wrap items-center justify-center gap-1.5">
          {keywords.slice(0, 3).map((kw, i) => (
            <span
              key={i}
              className="rounded-full bg-white/70 px-2.5 py-1 text-[11px] font-medium text-stone-600 dark:bg-white/10 dark:text-stone-300"
            >
              {kw}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
