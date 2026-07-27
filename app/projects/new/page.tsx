"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function NewProjectPage() {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [scriptType, setScriptType] = useState<"script" | "narration">("script");
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) {
      setError("파일을 선택해주세요");
      return;
    }
    setSubmitting(true);
    setError(null);

    const formData = new FormData();
    formData.append("file", file);
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
    <main className="mx-auto max-w-xl p-8">
      <h1 className="mb-6 text-2xl font-bold">새 프로젝트</h1>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="mb-1 block text-sm font-medium">프로젝트 제목</label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} required />
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">타입</label>
          <select
            className="w-full rounded border p-2"
            value={scriptType}
            onChange={(e) => setScriptType(e.target.value as "script" | "narration")}
          >
            <option value="script">원고</option>
            <option value="narration">나레이션</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium">파일 (pdf, txt)</label>
          <input
            type="file"
            accept=".pdf,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <Button type="submit" disabled={submitting}>
          {submitting ? "업로드 중..." : "프로젝트 생성"}
        </Button>
      </form>
    </main>
  );
}
