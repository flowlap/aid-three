"use client";

import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { FileDown, FileUp, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export type MockupStyle = "storyboard" | "notebooklm";

const STYLE_LABEL: Record<MockupStyle, string> = {
  storyboard: "스토리보드",
  notebooklm: "노트북LM",
};

const STYLE_TEMPLATE_URL: Record<MockupStyle, string> = {
  storyboard: "/api/pptx-template",
  notebooklm: "/api/pptx-template-notebooklm",
};

async function downloadPptxBlob(res: Response): Promise<void> {
  const blob = await res.blob();
  const disposition = res.headers.get("Content-Disposition") ?? "";
  const match = disposition.match(/filename\*=UTF-8''([^;]+)/);
  const filename = match ? decodeURIComponent(match[1]) : "storyboard.pptx";
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * One-click pptx export using the bundled default template matching
 * `mockupStyle` — no upload needed. Belongs in a "다운로드" (download) group:
 * same category as "HTML로 다운로드", just another instant result.
 */
export function PptxQuickExportButton({
  projectId,
  mockupStyle = "storyboard",
  size = "default",
}: {
  projectId: string;
  mockupStyle?: MockupStyle;
  size?: "default" | "sm";
}) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setError(null);
    setExporting(true);
    try {
      const formData = new FormData();
      formData.append("style", mockupStyle);
      const res = await fetch(`/api/projects/${projectId}/storyboard/pptx`, { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "pptx 생성에 실패했습니다");
        return;
      }
      await downloadPptxBlob(res);
    } catch {
      setError("pptx 생성 요청 중 오류가 발생했습니다");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" size={size} onClick={handleClick} disabled={exporting}>
        <FileDown className={size === "sm" ? "size-3.5" : "size-4"} />
        {exporting ? "생성 중..." : "PPTX로 저장"}
      </Button>
      {error && <p className="max-w-64 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * "템플릿 등록" workflow: download a starter .pptx (fields already laid out
 * as `{{placeholder}}`), edit it in PowerPoint, then upload it here to save
 * it as the project's export template. Once saved, every later "PPTX로 저장"
 * click (PptxQuickExportButton) reuses it automatically — no need to
 * re-upload per export. Separate from PptxQuickExportButton because this is
 * a one-time, opt-in customization step, not an instant download.
 */
export function PptxTemplateSection({
  projectId,
  mockupStyle = "storyboard",
}: {
  projectId: string;
  mockupStyle?: MockupStyle;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [hasTemplate, setHasTemplate] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/projects/${projectId}/pptx-template`)
      .then((res) => (res.ok ? res.json() : { exists: false }))
      .then((data) => {
        if (!cancelled) setHasTemplate(Boolean(data.exists));
      })
      .catch(() => {
        if (!cancelled) setHasTemplate(false);
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setSaving(true);
    try {
      const formData = new FormData();
      formData.append("template", file);
      const res = await fetch(`/api/projects/${projectId}/pptx-template`, { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "템플릿 저장에 실패했습니다");
        return;
      }
      setHasTemplate(true);
    } catch {
      setError("템플릿 저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/pptx-template`, { method: "DELETE" });
      if (!res.ok) {
        setError("템플릿 제거에 실패했습니다");
        return;
      }
      setHasTemplate(false);
    } catch {
      setError("템플릿 제거 요청 중 오류가 발생했습니다");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-2">
        <a
          href={STYLE_TEMPLATE_URL[mockupStyle]}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Download className="size-3.5" />
          {STYLE_LABEL[mockupStyle]} 템플릿 다운로드
        </a>
        <Button variant="outline" size="sm" disabled={saving} onClick={() => inputRef.current?.click()}>
          <FileUp className="size-3.5" />
          {saving ? "저장 중..." : "직접 만든 템플릿 업로드"}
        </Button>
        {hasTemplate && (
          <Button variant="ghost" size="sm" disabled={removing} onClick={handleRemove}>
            <X className="size-3.5" />
            {removing ? "제거 중..." : "기본으로 되돌리기"}
          </Button>
        )}
      </div>
      {hasTemplate && <p className="text-xs text-muted-foreground">업로드한 템플릿이 적용되어 있습니다 — PPTX로 저장 시 이 템플릿을 사용합니다.</p>}
      <input ref={inputRef} type="file" accept=".pptx" onChange={handleFileChange} className="hidden" />
      {error && <p className="max-w-64 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Combined convenience wrapper (quick export + template registration together) for places without a split download/template layout. */
export function PptxExportButton({ projectId, mockupStyle = "storyboard" }: { projectId: string; mockupStyle?: MockupStyle }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <PptxTemplateSection projectId={projectId} mockupStyle={mockupStyle} />
      <PptxQuickExportButton projectId={projectId} mockupStyle={mockupStyle} size="sm" />
    </div>
  );
}
