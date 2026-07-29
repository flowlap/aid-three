"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type SourceMode = "file" | "text";

const SCRIPT_TYPE_LABELS: Record<"script" | "narration", string> = {
  script: "원고",
  narration: "나레이션",
};

export default function NewProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scriptType, setScriptType] = useState<"script" | "narration">("script");
  const [sourceMode, setSourceMode] = useState<SourceMode>("file");
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (sourceMode === "file" && !file) {
      setError("파일을 선택해주세요");
      return;
    }
    if (sourceMode === "text" && !text.trim()) {
      setError("텍스트를 입력해주세요");
      return;
    }
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    if (sourceMode === "file" && file) {
      formData.append("file", file);
    } else {
      formData.append("text", text);
    }
    formData.append("title", title);
    formData.append("scriptType", scriptType);

    const res = await fetch("/api/projects/upload", { method: "POST", body: formData });
    const data = await res.json();
    setSubmitting(false);

    if (!res.ok) {
      setError(data.error ?? "업로드에 실패했습니다");
      return;
    }
    router.push(`/projects/${data.project.id}/markdown`);
  }

  return (
    <div className="flex min-h-dvh justify-center bg-muted px-6 py-10 md:px-8">
      <main className="w-full max-w-2xl rounded-xl border bg-background p-6 shadow-[0_1px_2px_rgba(15,15,15,0.04),0_4px_12px_rgba(15,15,15,0.06)] md:p-10">
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="size-4" />
          홈으로
        </Link>

        <h1 className="text-3xl font-semibold tracking-tight">새 프로젝트</h1>
        <p className="mt-1 mb-8 text-sm text-muted-foreground">
          원고 또는 나레이션을 업로드하면 스토리보드 제작을 시작할 수 있습니다.
        </p>

        <form onSubmit={handleSubmit} className="space-y-6">
          <Card className="gap-5 p-6">
            <div className="grid gap-5 sm:grid-cols-[1fr_auto]">
              <div>
                <label className="mb-1.5 block text-sm font-medium">프로젝트 제목</label>
                <Input value={title} onChange={(e) => setTitle(e.target.value)} required placeholder="예: 신입사원 온보딩 과정" />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium">타입</label>
                <Select value={scriptType} onValueChange={(value) => setScriptType(value as "script" | "narration")}>
                  <SelectTrigger className="w-full sm:w-32">
                    <SelectValue>{(value: "script" | "narration") => SCRIPT_TYPE_LABELS[value]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="script">{SCRIPT_TYPE_LABELS.script}</SelectItem>
                    <SelectItem value="narration">{SCRIPT_TYPE_LABELS.narration}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </Card>

          <Card className="gap-4 p-6">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">원고 입력</label>
              <div className="inline-flex rounded-full border bg-muted p-1">
                <button
                  type="button"
                  onClick={() => setSourceMode("file")}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                    sourceMode === "file"
                      ? "bg-background text-foreground shadow-[0_1px_2px_rgba(15,15,15,0.06)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  파일 업로드
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode("text")}
                  className={cn(
                    "rounded-full px-3.5 py-1.5 text-xs font-medium transition-colors",
                    sourceMode === "text"
                      ? "bg-background text-foreground shadow-[0_1px_2px_rgba(15,15,15,0.06)]"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  텍스트 붙여넣기
                </button>
              </div>
            </div>

            {sourceMode === "file" ? (
              <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border bg-muted/40 px-6 py-10 text-center transition-colors hover:border-primary/40 hover:bg-muted/70">
                <Upload className="size-7 text-muted-foreground" />
                <p className="text-sm">
                  <span className="font-medium text-primary">클릭하여 파일 선택</span>
                  <span className="text-muted-foreground"> (PDF 또는 TXT)</span>
                </p>
                {file && <p className="text-xs font-medium text-foreground">{file.name}</p>}
                <input
                  type="file"
                  accept=".pdf,.txt"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                  className="hidden"
                />
              </label>
            ) : (
              <Textarea
                rows={10}
                className="min-h-64"
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="여기에 원고 또는 나레이션 텍스트를 붙여넣으세요."
              />
            )}
          </Card>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <Button type="submit" size="lg" className="w-full" disabled={submitting}>
            {submitting ? "업로드 중..." : "프로젝트 생성"}
          </Button>
        </form>
      </main>
    </div>
  );
}
