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

  async function handleGenerate() {
    setLoading(true);
    const res = await fetch(`/api/projects/${projectId}/markdown`, { method: "POST" });
    const data = await res.json();
    setLoading(false);
    if (res.ok) setMarkdown(data.markdown);
  }

  async function handleNext() {
    await fetch(`/api/projects/${projectId}/markdown`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ markdown }),
    });
    router.push(`/projects/${projectId}/scenes`);
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
      <Button onClick={handleNext} disabled={!markdown}>
        다음 단계
      </Button>
    </div>
  );
}
