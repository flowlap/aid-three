"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function MarkdownEditor({
  projectId,
  initialMarkdown,
}: {
  projectId: string;
  initialMarkdown: string | null;
}) {
  const router = useRouter();
  const [markdown, setMarkdown] = useState(initialMarkdown ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/markdown`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "변환에 실패했습니다");
        return;
      }
      setMarkdown(data.markdown);
    } catch {
      setError("변환 요청 중 오류가 발생했습니다");
    } finally {
      setLoading(false);
    }
  }

  async function handleNext() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/markdown`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ markdown }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "저장에 실패했습니다");
        return;
      }
      router.push(`/projects/${projectId}/scenes`);
    } catch {
      setError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-4">
      <Button onClick={handleGenerate} disabled={loading}>
        {loading ? "변환 중..." : markdown ? "다시 생성" : "AI로 변환"}
      </Button>
      <Textarea
        rows={20}
        value={markdown}
        onChange={(e) => setMarkdown(e.target.value)}
        placeholder="변환 결과가 여기에 표시됩니다. 직접 수정할 수 있습니다."
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      <Button onClick={handleNext} disabled={!markdown || saving}>
        {saving ? "저장 중..." : "다음 단계"}
      </Button>
    </div>
  );
}
