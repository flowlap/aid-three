"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { recognizeImageText, type OcrWord } from "@/lib/client/ocrWorker";

/** navigator.clipboard.writeText() can hang (e.g. a pending permission prompt) — race it so a stuck write never leaves the button stuck on "복사 중". Mirrors RelatedImageSearch.tsx's own withTimeout. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([promise, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms))]);
}

type OcrStatus = "idle" | "recognizing" | "done" | "error";

/**
 * Wraps an <img> with an on-demand, client-side OCR text layer — Tesseract.js
 * (Korean), running entirely in the browser, no server round-trip or API
 * cost. Recognized words are rendered as invisible, precisely positioned
 * <span>s over the image so the user can literally drag-select the actual
 * on-image text with the mouse and copy it with Cmd/Ctrl+C — the same
 * pattern PDF viewers use for a scanned page's selectable text layer.
 *
 * OCR only runs when the user clicks the button, never automatically: it's
 * CPU-heavy (a second or more per image) and this page can list dozens of
 * scene images in one scroll.
 */
export function OcrTextOverlay({
  src,
  alt,
  className,
  style,
}: {
  src: string;
  alt: string;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [status, setStatus] = useState<OcrStatus>("idle");
  const [words, setWords] = useState<OcrWord[]>([]);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [fullText, setFullText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [renderedHeight, setRenderedHeight] = useState(0);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  // A regenerated image (same scene, new src) invalidates any previous OCR
  // pass — reset during render (React's "adjusting state on prop change"
  // pattern) rather than in an effect, so there's no extra commit+re-render.
  const [prevSrc, setPrevSrc] = useState(src);
  if (prevSrc !== src) {
    setPrevSrc(src);
    setStatus("idle");
    setWords([]);
    setFullText("");
    setError(null);
  }

  // Tracks the <img>'s actual rendered pixel height so word spans' font-size
  // (see below) stays proportional across responsive layout/window resizes —
  // the spans themselves are positioned with CSS percentages, which already
  // scale automatically, but font-size needs a concrete px value.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => setRenderedHeight(entries[0].contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // <img onLoad> never fires if the browser already had this image cached
  // and it was already `complete` by the time React attached the listener
  // (a well-known React/DOM race) — this catches that case on mount/src
  // change so naturalSize doesn't silently stay null forever, which would
  // otherwise make the OCR overlay compute successfully but never render.
  useEffect(() => {
    const img = imgRef.current;
    if (img && img.complete && img.naturalWidth > 0) {
      setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
    }
  }, [src]);

  async function runOcr() {
    setStatus("recognizing");
    setError(null);
    try {
      const result = await recognizeImageText(src);
      setWords(result.words.filter((w) => w.text.trim().length > 0 && w.bbox.x1 > w.bbox.x0 && w.bbox.y1 > w.bbox.y0));
      setFullText(result.text.trim());
      setStatus("done");
    } catch {
      setError("텍스트 인식에 실패했습니다");
      setStatus("error");
    }
  }

  async function copyFullText() {
    try {
      await withTimeout(navigator.clipboard.writeText(fullText), 1500);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError("클립보드 복사에 실패했습니다");
    }
  }

  return (
    <div ref={wrapperRef} className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        ref={imgRef}
        src={src}
        alt={alt}
        className={className}
        style={style}
        onLoad={(e) => {
          const t = e.currentTarget;
          setNaturalSize({ width: t.naturalWidth, height: t.naturalHeight });
        }}
      />
      {status === "done" && naturalSize && renderedHeight > 0 && words.length > 0 && (
        <div className="absolute inset-0 overflow-hidden">
          {words.map((w, i) => {
            const leftPct = (w.bbox.x0 / naturalSize.width) * 100;
            const topPct = (w.bbox.y0 / naturalSize.height) * 100;
            const widthPct = ((w.bbox.x1 - w.bbox.x0) / naturalSize.width) * 100;
            const heightPct = ((w.bbox.y1 - w.bbox.y0) / naturalSize.height) * 100;
            return (
              <span
                key={i}
                className="absolute overflow-hidden text-transparent selection:bg-primary/30"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  fontSize: `${Math.max(8, (heightPct / 100) * renderedHeight * 0.85)}px`,
                  lineHeight: 1,
                  whiteSpace: "pre",
                }}
              >
                {w.text}
              </span>
            );
          })}
        </div>
      )}
      <div className="absolute right-1.5 bottom-1.5 flex gap-1">
        {status !== "done" && (
          <Button type="button" size="xs" variant="secondary" onClick={runOcr} disabled={status === "recognizing"}>
            {status === "recognizing" ? "인식 중..." : status === "error" ? "다시 시도" : "텍스트 인식"}
          </Button>
        )}
        {status === "done" && fullText && (
          <Button type="button" size="xs" variant="secondary" onClick={copyFullText}>
            {copied ? "복사됨" : "전체 복사"}
          </Button>
        )}
      </div>
      {error && (
        <p className="absolute inset-x-1.5 bottom-8 rounded bg-destructive/90 px-1.5 py-0.5 text-center text-[10px] text-destructive-foreground">
          {error}
        </p>
      )}
    </div>
  );
}
