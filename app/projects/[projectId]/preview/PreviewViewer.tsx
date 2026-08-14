"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScreenMockup } from "@/components/ScreenMockup";
import { PptxQuickExportButton, PptxTemplateSection } from "@/components/PptxExportButton";
import { RelatedImageSearch } from "@/components/RelatedImageSearch";
import { computeMockupVariantIndexes } from "@/lib/visual-templates";
import { buildSceneHierarchy } from "@/lib/pipeline/sceneHierarchy";
import { cn } from "@/lib/utils";
import {
  IMAGE_SEARCH_SITES,
  DEFAULT_IMAGE_SEARCH_SITE,
  IMAGE_SEARCH_SITE_STORAGE_KEY,
  type ImageSearchSiteId,
} from "@/lib/imageSearchSites";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";

type MockupStyle = "storyboard" | "notebooklm";

export function PreviewViewer({
  projectId,
  projectTitle,
  scenes,
  screenTypes,
  visualDesigns,
  imageIds,
  imageVersions,
  imageAspectRatio,
}: {
  projectId: string;
  projectTitle: string;
  scenes: Scene[];
  screenTypes: Record<string, ScreenTypeAssignment>;
  visualDesigns: Record<string, VisualDesign>;
  imageIds: string[];
  /** Per-scene image file mtime (ms), keyed by sceneId — cache-busts the <img> URL so a regenerated image (e.g. composite → AI mode) isn't masked by a stale cache. See listProjectImageVersions. */
  imageVersions: Record<string, number>;
  /** Actual generated-image pixel ratio (see lib/pipeline/imageAspectRatio.ts) — OpenAI defaults to 3:2, Gemini to 16:9. */
  imageAspectRatio: { width: number; height: number };
}) {
  const imageIdSet = new Set(imageIds);
  const mockupVariants = useMemo(() => computeMockupVariantIndexes(scenes, screenTypes), [scenes, screenTypes]);
  const hierarchy = useMemo(() => buildSceneHierarchy(scenes), [scenes]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [mockupStyle, setMockupStyle] = useState<MockupStyle>("storyboard");
  const [imageSearchSite, setImageSearchSite] = useState<ImageSearchSiteId>(DEFAULT_IMAGE_SEARCH_SITE);
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({});
  const exportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const saved = localStorage.getItem(IMAGE_SEARCH_SITE_STORAGE_KEY);
        if (saved && IMAGE_SEARCH_SITES.some((s) => s.id === saved)) {
          setImageSearchSite(saved as ImageSearchSiteId);
        }
      } catch {
        // localStorage unavailable (private browsing) — keep the default.
      }
    });
  }, []);

  function handleImageSearchSiteChange(value: ImageSearchSiteId) {
    setImageSearchSite(value);
    try {
      localStorage.setItem(IMAGE_SEARCH_SITE_STORAGE_KEY, value);
    } catch {
      // localStorage unavailable — selection just won't persist across reloads.
    }
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) {
          const index = scenes.findIndex((s) => s.id === visible[0].target.id);
          if (index >= 0) setActiveIndex(index);
        }
      },
      { rootMargin: "-10% 0px -70% 0px" }
    );
    for (const scene of scenes) {
      const el = sectionRefs.current[scene.id];
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, [scenes]);

  function scrollToIndex(index: number) {
    const scene = scenes[index];
    if (!scene) return;
    // Update immediately rather than waiting for the IntersectionObserver to
    // catch up once the smooth-scroll animation finishes — otherwise the TOC
    // highlight and counter visibly lag behind the click/tap that caused them.
    setActiveIndex(index);
    sectionRefs.current[scene.id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // Produces a standalone HTML snapshot of the preview (image + mockup + text per
  // scene) that opens without the app running. Images are inlined as base64 data
  // URIs; page CSS is copied from the live stylesheets so the layout matches what's
  // on screen. Fonts loaded from /_next/static (next/font) stay as relative URLs, so
  // they only render correctly while this dev/prod server is still reachable —
  // acceptable for a quick offline snapshot, not pursued further here.
  async function handleDownloadHtml() {
    if (!exportRef.current) return;
    setDownloading(true);
    try {
      const clone = exportRef.current.cloneNode(true) as HTMLElement;

      const imgs = Array.from(clone.querySelectorAll("img"));
      await Promise.all(
        imgs.map(async (img) => {
          try {
            const res = await fetch(img.src);
            const blob = await res.blob();
            const dataUrl = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result as string);
              reader.onerror = reject;
              reader.readAsDataURL(blob);
            });
            img.setAttribute("src", dataUrl);
          } catch {
            // Leave the original src if the fetch fails — the offline copy just won't show that image.
          }
        })
      );

      let css = "";
      for (const sheet of Array.from(document.styleSheets)) {
        try {
          for (const rule of Array.from(sheet.cssRules)) {
            css += rule.cssText + "\n";
          }
        } catch {
          // Cross-origin stylesheet we can't read the rules of — skip it.
        }
      }

      const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${projectTitle} 스토리보드</title>
<style>${css}</style>
</head>
<body class="bg-background text-foreground">
${clone.outerHTML}
</body>
</html>`;

      const blob = new Blob([html], { type: "text/html" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${projectTitle.replace(/[\\/:*?"<>|]/g, "_")}-스토리보드.html`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted">
      <div className="mx-auto flex max-w-[1400px]">
        <aside className="sticky top-11 hidden h-[calc(100vh-2.75rem)] w-56 shrink-0 overflow-y-auto border-r bg-background p-4 md:block print:hidden">
          <Link href={`/projects/${projectId}/storyboard`} className="mb-4 block text-sm font-medium text-muted-foreground hover:text-foreground">
            ← {projectTitle}
          </Link>
          <nav className="space-y-0.5">
            {scenes.map((scene, index) => (
              <a
                key={scene.id}
                href={`#${scene.id}`}
                onClick={(e) => {
                  e.preventDefault();
                  scrollToIndex(index);
                }}
                style={{ marginLeft: `${(hierarchy[scene.id]?.indentDepth ?? 0) * 12}px` }}
                className={`block truncate rounded-lg px-2.5 py-1.5 text-sm transition-colors ${
                  index === activeIndex
                    ? "bg-primary text-primary-foreground"
                    : scene.sceneType === "title"
                      ? "font-semibold text-primary hover:bg-muted"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                {index + 1}. {scene.narrationText}
              </a>
            ))}
            {scenes.length === 0 && <p className="text-sm text-muted-foreground">씬 데이터가 없습니다.</p>}
          </nav>
        </aside>

        <main className="min-h-screen flex-1 bg-background p-6 pb-24 md:p-10 md:pb-24">
          <Link
            href={`/projects/${projectId}/storyboard`}
            className="mb-2 block text-sm font-medium text-muted-foreground hover:text-foreground md:hidden print:hidden"
          >
            ← {projectTitle}
          </Link>
          <div className="mb-6 flex flex-col gap-3 print:hidden">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-3">
                <div className="inline-flex rounded-full border bg-muted p-1">
                  {([
                    { value: "storyboard", label: "스토리보드" },
                    { value: "notebooklm", label: "노트북LM" },
                  ] as const).map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => setMockupStyle(option.value)}
                      className={cn(
                        "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                        mockupStyle === option.value
                          ? "bg-background text-foreground shadow-[0_1px_2px_rgba(15,15,15,0.06)]"
                          : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-medium text-muted-foreground">연관 이미지 검색</span>
                  <Select value={imageSearchSite} onValueChange={(value) => handleImageSearchSiteChange(value as ImageSearchSiteId)}>
                    <SelectTrigger size="sm" className="w-36">
                      <SelectValue>{(value: ImageSearchSiteId) => IMAGE_SEARCH_SITES.find((s) => s.id === value)?.label}</SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {IMAGE_SEARCH_SITES.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="flex flex-wrap items-start justify-end gap-2">
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[11px] font-medium text-muted-foreground">다운로드</span>
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button variant="outline" onClick={handleDownloadHtml} disabled={downloading}>
                      {downloading ? "다운로드 준비 중..." : "HTML로 다운로드"}
                    </Button>
                    <PptxQuickExportButton projectId={projectId} mockupStyle={mockupStyle} />
                  </div>
                </div>
              </div>
            </div>
            <div className="flex justify-end">
              <div className="flex flex-col items-end gap-1 border-t pt-3">
                <span className="text-[11px] font-medium text-muted-foreground">템플릿 등록</span>
                <PptxTemplateSection projectId={projectId} mockupStyle={mockupStyle} />
              </div>
            </div>
          </div>
          <div ref={exportRef} className="space-y-4">
          <h1 className="mb-6 text-3xl font-semibold tracking-tight">{projectTitle} — 미리보기</h1>
          {scenes.map((scene, index) => {
            const screenType = screenTypes[scene.id];
            const design = visualDesigns[scene.id];
            const hasImage = imageIdSet.has(scene.id);
            return (
              <Card
                key={scene.id}
                id={scene.id}
                ref={(el) => {
                  sectionRefs.current[scene.id] = el;
                }}
                className="scroll-mt-6 gap-0 p-0"
              >
                <div className="flex items-center gap-2 border-b p-4">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
                    {index + 1}
                  </span>
                  <span className="text-sm text-muted-foreground">
                    {screenType?.screenType ?? "화면 유형 미지정"} · {scene.estimatedDurationSec}초
                  </span>
                </div>
                <div className="grid gap-5 p-5 md:grid-cols-2">
                  <div>
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">이미지</p>
                    {hasImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={`/api/projects/${projectId}/images/${scene.id}?v=${imageVersions[scene.id] ?? 0}`}
                        alt={design?.caption ?? scene.narrationText}
                        className="w-full rounded-lg border object-cover"
                        style={{ aspectRatio: `${imageAspectRatio.width} / ${imageAspectRatio.height}` }}
                      />
                    ) : (
                      <div
                        className="flex items-center justify-center rounded-lg border border-dashed text-sm text-muted-foreground"
                        style={{ aspectRatio: `${imageAspectRatio.width} / ${imageAspectRatio.height}` }}
                      >
                        생성된 이미지가 없습니다
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-muted-foreground">화면 설계 목업</p>
                      {screenType?.screenType && (
                        <span className="w-fit rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground ring-1 ring-border">
                          {screenType.screenType}
                        </span>
                      )}
                    </div>
                    <ScreenMockup
                      screenType={screenType?.screenType}
                      design={design}
                      showTypeBadge={false}
                      variantIndex={mockupVariants[scene.id] ?? 0}
                      style={mockupStyle}
                      aspectRatio={imageAspectRatio}
                    />
                  </div>
                </div>
                <div className="space-y-2 border-t p-5 text-sm">
                  <p className="font-medium">{design?.caption ?? "(자막 없음)"}</p>
                  <p className="text-muted-foreground">{design?.imageOrDiagramDescription}</p>
                  <p className="text-muted-foreground">배치: {design?.objectPlacement}</p>
                  <RelatedImageSearch
                    imageUrl={hasImage ? `/api/projects/${projectId}/images/${scene.id}?v=${imageVersions[scene.id] ?? 0}` : undefined}
                    keywords={design?.keywords ?? []}
                    site={imageSearchSite}
                  />
                </div>
                <p className="border-t bg-muted/40 px-5 py-3 text-sm text-muted-foreground">{scene.narrationText}</p>
              </Card>
            );
          })}
          </div>
        </main>
      </div>

      <footer className="fixed bottom-0 left-0 right-0 border-t bg-background md:pl-56 print:hidden">
        <div className="mx-auto flex max-w-[1400px] items-center justify-between px-6 py-3">
          <Button variant="outline" onClick={() => scrollToIndex(activeIndex - 1)} disabled={activeIndex <= 0}>
            ← 이전 씬
          </Button>
          <span className="text-sm text-muted-foreground">
            {scenes.length > 0 ? `${activeIndex + 1} / ${scenes.length}` : "0 / 0"}
          </span>
          <Button
            variant="outline"
            onClick={() => scrollToIndex(activeIndex + 1)}
            disabled={activeIndex >= scenes.length - 1}
          >
            다음 씬 →
          </Button>
        </div>
      </footer>
    </div>
  );
}
