"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { FileDown, FileUp, Download } from "lucide-react";
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
 * same category as "HTML로 다운로드"/"PDF로 저장", just another instant result.
 */
export function PptxQuickExportButton({
  projectId,
  mockupStyle = "storyboard",
}: {
  projectId: string;
  mockupStyle?: MockupStyle;
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
      <Button variant="outline" onClick={handleClick} disabled={exporting}>
        <FileDown className="size-4" />
        {exporting ? "생성 중..." : "PPTX로 저장"}
      </Button>
      {error && <p className="max-w-64 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

/**
 * "템플릿 등록" workflow: download a starter .pptx (fields already laid out
 * as `{{placeholder}}`), edit it in PowerPoint, then upload it here to get a
 * copy with that slide duplicated once per scene, placeholders filled in.
 * Separate from PptxQuickExportButton because this is a multi-step, opt-in
 * customization path, not an instant download.
 */
export function PptxTemplateSection({
  projectId,
  mockupStyle = "storyboard",
}: {
  projectId: string;
  mockupStyle?: MockupStyle;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setExporting(true);
    try {
      const formData = new FormData();
      formData.append("template", file);
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
      <div className="flex items-center gap-2">
        <a
          href={STYLE_TEMPLATE_URL[mockupStyle]}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
        >
          <Download className="size-3.5" />
          {STYLE_LABEL[mockupStyle]} 템플릿 다운로드
        </a>
        <Button variant="outline" size="sm" disabled={exporting} onClick={() => inputRef.current?.click()}>
          <FileUp className="size-3.5" />
          {exporting ? "생성 중..." : "직접 만든 템플릿 업로드"}
        </Button>
      </div>
      <input ref={inputRef} type="file" accept=".pptx" onChange={handleFileChange} className="hidden" />
      {error && <p className="max-w-64 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}

/** Combined convenience wrapper (quick export + template registration together) for places without a split download/template layout. */
export function PptxExportButton({ projectId, mockupStyle = "storyboard" }: { projectId: string; mockupStyle?: MockupStyle }) {
  return (
    <div className="flex flex-col items-end gap-1.5">
      <PptxTemplateSection projectId={projectId} mockupStyle={mockupStyle} />
      <PptxQuickExportButton projectId={projectId} mockupStyle={mockupStyle} />
    </div>
  );
}
