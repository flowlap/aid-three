"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { FileUp } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Lets the user upload a .pptx template (first slide holds {{placeholder}}
 * text) and immediately downloads a copy with that slide duplicated once per
 * scene, placeholders filled in from this project's data. No template is
 * stored — it's a single upload-in/file-out round trip.
 */
export function PptxExportButton({ projectId }: { projectId: string }) {
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
      const res = await fetch(`/api/projects/${projectId}/storyboard/pptx`, {
        method: "POST",
        body: formData,
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "pptx 생성에 실패했습니다");
        return;
      }

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
    } catch {
      setError("pptx 생성 요청 중 오류가 발생했습니다");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button variant="outline" disabled={exporting} onClick={() => inputRef.current?.click()}>
        <FileUp className="size-4" />
        {exporting ? "생성 중..." : "pptx 템플릿으로 내보내기"}
      </Button>
      <input ref={inputRef} type="file" accept=".pptx" onChange={handleFileChange} className="hidden" />
      {error && <p className="max-w-64 text-right text-xs text-destructive">{error}</p>}
    </div>
  );
}
