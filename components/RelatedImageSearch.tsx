"use client";

import { useEffect, useRef, useState } from "react";
import { Search, Crop, X, Download, Camera } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ImageSearchSite } from "@/lib/imageSearchSites";

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The sub-rect (in element-box pixels) that `object-fit: contain` actually renders the image into — the rest is letterbox padding. */
function computeContainRect(box: { width: number; height: number }, natural: { width: number; height: number }): Rect {
  const boxRatio = box.width / box.height;
  const naturalRatio = natural.width / natural.height;
  if (naturalRatio > boxRatio) {
    const width = box.width;
    const height = width / naturalRatio;
    return { x: 0, y: (box.height - height) / 2, width, height };
  }
  const height = box.height;
  const width = height * naturalRatio;
  return { x: (box.width - width) / 2, y: 0, width, height };
}

function normalizeRect(a: { x: number; y: number }, b: { x: number; y: number }): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(a.x - b.x),
    height: Math.abs(a.y - b.y),
  };
}

/** navigator.clipboard.write() can hang indefinitely rather than reject (e.g. a pending permission prompt nobody answers) — race it so a stuck clipboard write can never block the thumbnail/new-tab fallback from appearing. */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("timed out")), ms)),
  ]);
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Per-scene "연관 이미지 찾기" controls for the preview page: click a keyword
 * (or type free text) to open a text search on every currently-selected site
 * (see PreviewViewer.tsx's checkbox row), or crop a region of the scene's
 * generated image to copy it to the clipboard ("이미지 크롭") or download it
 * directly ("이미지 크롭 후 다운로드") — those two stay site-independent.
 *
 * "스크린샷 검색" (crop-based image search) only targets sites that actually
 * support it (`site.imageSearchUrl` defined — see lib/imageSearchSites.ts;
 * a site like Flaticon with no image-based search at all is silently
 * skipped). Getty Images Korea is the one site with a true automated
 * hand-off: the crop is uploaded server-side (handleGettyKoreaAutoSearch,
 * proxied via lib/imageSearch/gettyImageSearchUpload.ts) and its results
 * page opens directly. Every other capable site gets the manual flow: the
 * crop is copied to the clipboard once and each site's image-search entry
 * point opens in its own tab for the user to paste into.
 */
export function RelatedImageSearch({
  imageUrl,
  keywords,
  sites,
}: {
  imageUrl?: string;
  keywords: string[];
  sites: ImageSearchSite[];
}) {
  const gettyKoreaSite = sites.find((s) => s.id === "gettyimageskorea-pro");
  const manualImageSearchSites = sites.filter((s) => s.id !== "gettyimageskorea-pro" && s.imageSearchUrl);
  const hasImageSearchCapableSite = Boolean(gettyKoreaSite) || manualImageSearchSites.length > 0;
  const siteLabels = sites.map((s) => s.label).join("·");

  const [searchText, setSearchText] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);
  const [cropMode, setCropMode] = useState(false);
  const [cropIntent, setCropIntent] = useState<"clipboard" | "download" | "search">("clipboard");
  const [dragOrigin, setDragOrigin] = useState<{ x: number; y: number } | null>(null);
  const [dragRect, setDragRect] = useState<Rect | null>(null);
  const [pendingThumbnail, setPendingThumbnail] = useState<string | null>(null);
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (pendingThumbnail) URL.revokeObjectURL(pendingThumbnail);
      if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only run on unmount, not every pendingThumbnail change
  }, []);

  function showToast(message: string) {
    if (toastTimeoutRef.current) clearTimeout(toastTimeoutRef.current);
    setToast(message);
    toastTimeoutRef.current = setTimeout(() => setToast(null), 2500);
  }

  /** Manual "copy to clipboard + open each capable site's entry point" flow, used both as the primary path for non-Getty-Korea sites and as Getty Korea's own fallback when auto-upload fails. */
  async function handleManualImageSearch(blob: Blob, targets: ImageSearchSite[], opts?: { autoDownload?: boolean }) {
    setError(null);
    try {
      await withTimeout(navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]), 1500);
    } catch {
      // Clipboard write can fail or hang indefinitely (permissions, a pending
      // prompt nobody answers, older browsers) — the draggable thumbnail
      // below still lets the user complete the hand-off manually either way.
    }
    if (pendingThumbnail) URL.revokeObjectURL(pendingThumbnail);
    setPendingBlob(blob);
    setPendingThumbnail(URL.createObjectURL(blob));
    if (opts?.autoDownload) {
      // 게티이미지코리아 자동 업로드(handleGettyKoreaAutoSearch)가 실패했을 때만 여기로 온다 —
      // 클립보드 붙여넣기가 안 통하는 사이트이므로, 새 탭을 열기 전에 파일을 미리 다운로드해
      // 사용자가 수동으로 업로드할 수 있게 한다.
      downloadBlob(blob, `screenshot-${Date.now()}.png`);
    }
    for (const target of targets) {
      if (target.imageSearchUrl) window.open(target.imageSearchUrl(), "_blank", "noopener,noreferrer");
    }
  }

  async function handleGettyKoreaAutoSearch(blob: Blob) {
    setError(null);
    setUploading(true);
    try {
      const form = new FormData();
      form.append("image", blob, "screenshot.png");
      const res = await fetch("/api/imageSearch/gettyimageskorea", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok || !data.resultUrl) throw new Error(data.error ?? "업로드에 실패했습니다");
      window.open(data.resultUrl, "_blank", "noopener,noreferrer");
    } catch {
      if (gettyKoreaSite) await handleManualImageSearch(blob, [gettyKoreaSite], { autoDownload: true });
      setError("자동 업로드에 실패해 수동 방식으로 전환했습니다");
    } finally {
      setUploading(false);
    }
  }

  /** Runs whichever of the two flows apply for the currently-selected sites — both, if both a Getty Korea and other capable sites are selected. */
  async function handleScreenshotSearch(blob: Blob) {
    if (gettyKoreaSite) await handleGettyKoreaAutoSearch(blob);
    if (manualImageSearchSites.length > 0) await handleManualImageSearch(blob, manualImageSearchSites);
  }

  async function handleCropToClipboard(blob: Blob) {
    setError(null);
    try {
      await withTimeout(navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]), 1500);
      showToast("클립보드에 복사했습니다");
    } catch {
      setError("클립보드 복사에 실패했습니다");
    }
  }

  function handleCropToDownload(blob: Blob) {
    downloadBlob(blob, `crop-${Date.now()}.png`);
  }

  function startCrop(intent: "clipboard" | "download" | "search") {
    if (cropMode && cropIntent === intent) {
      setCropMode(false);
      return;
    }
    setCropIntent(intent);
    setCropMode(true);
  }

  function handleSearch(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    for (const site of sites) {
      window.open(site.keywordSearchUrl(trimmed), "_blank", "noopener,noreferrer");
    }
  }

  function handleMouseDown(e: React.MouseEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragOrigin(point);
    setDragRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleMouseMove(e: React.MouseEvent<HTMLDivElement>) {
    if (!dragOrigin) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    setDragRect(normalizeRect(dragOrigin, point));
  }

  // Computes the final rect directly from this event's own coordinates (paired with the
  // recorded drag origin) rather than trusting the last mousemove-tracked dragRect state —
  // a fast drag can reach mouseup without an intermediate mousemove ever firing at the exact
  // release point, which left dragRect stale at zero-size and silently dropped every crop.
  async function handleMouseUp(e: React.MouseEvent<HTMLDivElement>) {
    const origin = dragOrigin;
    const intent = cropIntent;
    setDragOrigin(null);
    const img = imgRef.current;
    if (!img || !origin) {
      setDragRect(null);
      setCropMode(false);
      return;
    }
    const boxRect = e.currentTarget.getBoundingClientRect();
    const point = { x: e.clientX - boxRect.left, y: e.clientY - boxRect.top };
    const finalRect = normalizeRect(origin, point);
    if (finalRect.width < 8 || finalRect.height < 8) {
      setDragRect(null);
      setCropMode(false);
      return;
    }

    const box = { width: img.clientWidth, height: img.clientHeight };
    const natural = { width: img.naturalWidth, height: img.naturalHeight };
    const contain = computeContainRect(box, natural);
    const scale = natural.width / contain.width;

    // Clip the drag rect to the actual (letterboxed) image area before mapping to natural pixels.
    const clipped: Rect = {
      x: Math.max(finalRect.x, contain.x),
      y: Math.max(finalRect.y, contain.y),
      width: Math.min(finalRect.x + finalRect.width, contain.x + contain.width) - Math.max(finalRect.x, contain.x),
      height: Math.min(finalRect.y + finalRect.height, contain.y + contain.height) - Math.max(finalRect.y, contain.y),
    };
    setDragRect(null);
    setCropMode(false);
    if (clipped.width < 8 || clipped.height < 8) return;

    const sx = (clipped.x - contain.x) * scale;
    const sy = (clipped.y - contain.y) * scale;
    const sw = clipped.width * scale;
    const sh = clipped.height * scale;

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("영역 캡처에 실패했습니다");
        return;
      }
      if (intent === "search") void handleScreenshotSearch(blob);
      else if (intent === "download") handleCropToDownload(blob);
      else void handleCropToClipboard(blob);
    }, "image/png");
  }

  return (
    <div className="space-y-2">
      <form
        className="flex gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          handleSearch(searchText);
        }}
      >
        <Input
          type="text"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder={sites.length > 0 ? `${siteLabels}에서 검색어 입력` : "검색할 사이트를 먼저 선택하세요"}
          className="h-7 max-w-64 text-xs"
        />
        <Button type="submit" variant="outline" size="sm" disabled={sites.length === 0 || !searchText.trim()}>
          <Search className="size-3.5" />
          검색
        </Button>
      </form>

      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {keywords.map((kw) => (
            <Badge
              key={kw}
              variant="outline"
              className="cursor-pointer gap-1 hover:bg-muted"
              render={
                <button
                  type="button"
                  onClick={() => handleSearch(kw)}
                  title={sites.length > 0 ? `"${kw}" ${siteLabels}에서 검색` : "검색할 사이트를 먼저 선택하세요"}
                />
              }
            >
              <Search className="size-3" />
              {kw}
            </Badge>
          ))}
        </div>
      )}

      {imageUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => startCrop("clipboard")}>
            <Crop className="size-3.5" />
            {cropMode && cropIntent === "clipboard" ? "영역 선택 취소" : "이미지 크롭"}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => startCrop("download")}>
            <Download className="size-3.5" />
            {cropMode && cropIntent === "download" ? "영역 선택 취소" : "이미지 크롭 후 다운로드"}
          </Button>
          {hasImageSearchCapableSite && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => startCrop("search")}
              disabled={uploading}
              title="영역을 선택하면 이미지 검색을 지원하는 선택된 사이트로 검색합니다 (지원하지 않는 사이트는 건너뜁니다)"
            >
              <Camera className="size-3.5" />
              {uploading ? "업로드 중..." : cropMode && cropIntent === "search" ? "영역 선택 취소" : "스크린샷 검색"}
            </Button>
          )}
        </div>
      )}

      {cropMode && imageUrl && (
        <div className="relative w-fit max-w-full">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img ref={imgRef} src={imageUrl} alt="" className="max-h-64 rounded-lg border select-none" draggable={false} />
          <div
            className="absolute inset-0 cursor-crosshair"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={(e) => void handleMouseUp(e)}
          />
          {dragRect && (
            <div
              className="pointer-events-none absolute border-2 border-primary bg-primary/10"
              style={{ left: dragRect.x, top: dragRect.y, width: dragRect.width, height: dragRect.height }}
            />
          )}
        </div>
      )}

      {pendingThumbnail && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-2 text-xs text-muted-foreground">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pendingThumbnail} draggable alt="" className="size-12 shrink-0 cursor-grab rounded border object-cover" />
          <span>클립보드에 복사됨 — 새로 연 창에 Cmd+V로 붙여넣거나, 이 이미지를 그 창으로 드래그하세요.</span>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => pendingBlob && downloadBlob(pendingBlob, `screenshot-${Date.now()}.png`)}
          >
            <Download className="size-3.5" />
            스크린샷 저장
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setPendingThumbnail(null);
              setPendingBlob(null);
            }}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
      {toast && <p className="text-xs text-emerald-600">{toast}</p>}
    </div>
  );
}
