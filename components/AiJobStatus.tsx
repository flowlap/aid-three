"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatApprox(totalSeconds: number): string {
  if (totalSeconds < 60) return `약 ${totalSeconds}초`;
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return s === 0 ? `약 ${m}분` : `약 ${m}분 ${s}초`;
}

/**
 * Shared "AI가 작업 중입니다" indicator for every pipeline step. Shows a
 * ticking elapsed-time counter (so it never reads as frozen, even when
 * discovered mid-run via polling from another tab), an optional
 * estimate-vs-elapsed comparison, an optional index/total progress bar, and
 * an optional small-text activity log (streamed raw text or per-item
 * completion lines) — the ChatGPT/Claude "thinking" panel equivalent.
 *
 * Renders nothing when `loading` is false.
 */
export function AiJobStatus({
  loading,
  label,
  startedAt,
  progress,
  estimateSeconds,
  activityLines,
  className,
}: {
  loading: boolean;
  label: string;
  startedAt: string | null;
  progress?: { index: number; total: number } | null;
  /** Rough expected duration in seconds, computed by the caller from doc size / scene count. */
  estimateSeconds?: number;
  /** Small-text log lines, oldest first — the panel auto-scrolls to the latest. */
  activityLines?: string[];
  className?: string;
}) {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading || !startedAt) {
      setElapsedSeconds(0);
      return;
    }
    const startMs = new Date(startedAt).getTime();
    const tick = () => setElapsedSeconds(Math.max(0, Math.round((Date.now() - startMs) / 1000)));
    tick();
    const handle = setInterval(tick, 1000);
    return () => clearInterval(handle);
  }, [loading, startedAt]);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [activityLines]);

  if (!loading) return null;

  const overEstimate = typeof estimateSeconds === "number" && elapsedSeconds > estimateSeconds;
  const progressPct = progress && progress.total > 0 ? Math.min(100, Math.round((progress.index / progress.total) * 100)) : null;

  return (
    <div className={cn("space-y-2 rounded-lg border bg-muted/40 p-3", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          {label}
        </span>
        <span className="font-mono text-xs text-muted-foreground">{formatElapsed(elapsedSeconds)} 경과</span>
        {progress && (
          <span className="text-xs text-muted-foreground">
            {progress.index} / {progress.total}개
          </span>
        )}
        {typeof estimateSeconds === "number" && (
          <span className={cn("text-xs", overEstimate ? "text-warning" : "text-muted-foreground")}>
            {overEstimate
              ? `예상보다 오래 걸리고 있어요 (예상 ${formatApprox(estimateSeconds)})`
              : `예상 소요 시간: ${formatApprox(estimateSeconds)}`}
          </span>
        )}
      </div>

      {progressPct !== null && (
        <div className="h-1 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${progressPct}%` }} />
        </div>
      )}

      {activityLines && activityLines.length > 0 && (
        <div
          ref={logRef}
          className="max-h-32 overflow-y-auto rounded-md border bg-background/60 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground"
        >
          {activityLines.map((line, i) => (
            <div key={i} className="whitespace-pre-wrap">
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
