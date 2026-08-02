"use client";

import { useRef, useState, type ChangeEvent } from "react";
import { RefreshCw, FileUp, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export type ReferenceImageKind = "background" | "presenter";
export type PresenterGender = "male" | "female";

/**
 * One-time reference image (fixed background, or presenter/announcer) that
 * every scene's image generation call reuses via OpenAI's multi-image
 * /images/edits — this is what keeps the announcer's face or the backdrop
 * identical scene to scene, instead of a fresh (and different-looking) draw
 * per scene. Generate from a prompt (default pre-filled) or upload one
 * directly; either way it's saved per-project and reused until replaced.
 */
export function ReferenceImageSection({
  projectId,
  kind,
  initialPrompt,
  initialHasImage,
  showGenderSelect = false,
  initialGender = "female",
}: {
  projectId: string;
  kind: ReferenceImageKind;
  initialPrompt: string;
  initialHasImage: boolean;
  showGenderSelect?: boolean;
  initialGender?: PresenterGender;
}) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [gender, setGender] = useState<PresenterGender>(initialGender);
  const [hasImage, setHasImage] = useState(initialHasImage);
  const [version, setVersion] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const baseUrl = `/api/projects/${projectId}/images/${kind}-reference`;
  const busy = generating || uploading || removing;

  async function handleGenerate() {
    setError(null);
    setGenerating(true);
    try {
      const res = await fetch(`${baseUrl}/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(showGenderSelect ? { prompt, gender } : { prompt }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "이미지 생성에 실패했습니다");
        return;
      }
      setHasImage(true);
      setVersion((v) => v + 1);
    } catch {
      setError("이미지 생성 요청 중 오류가 발생했습니다");
    } finally {
      setGenerating(false);
    }
  }

  async function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;

    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("image", file);
      const res = await fetch(baseUrl, { method: "POST", body: formData });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "이미지 업로드에 실패했습니다");
        return;
      }
      setHasImage(true);
      setVersion((v) => v + 1);
    } catch {
      setError("이미지 업로드 요청 중 오류가 발생했습니다");
    } finally {
      setUploading(false);
    }
  }

  async function handleRemove() {
    setError(null);
    setRemoving(true);
    try {
      const res = await fetch(baseUrl, { method: "DELETE" });
      if (!res.ok) {
        setError("이미지 제거에 실패했습니다");
        return;
      }
      setHasImage(false);
    } catch {
      setError("이미지 제거 요청 중 오류가 발생했습니다");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <div className="flex gap-4">
      <div className="w-32 shrink-0">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`${baseUrl}?v=${version}`}
            alt=""
            className="aspect-[3/2] w-full rounded-lg border object-cover"
          />
        ) : (
          <div className="flex aspect-[3/2] w-full items-center justify-center rounded-lg border border-dashed text-center text-[11px] text-muted-foreground">
            아직 없음
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-2">
        <Textarea
          rows={2}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          className="text-sm"
          disabled={busy}
        />
        {showGenderSelect && (
          <div className="flex items-center gap-3 text-sm">
            {(["female", "male"] as const).map((option) => (
              <label key={option} className={cn("flex cursor-pointer items-center gap-1.5", busy && "cursor-not-allowed opacity-60")}>
                <input
                  type="radio"
                  name={`${kind}-gender`}
                  checked={gender === option}
                  onChange={() => setGender(option)}
                  disabled={busy}
                  className="accent-primary"
                />
                {option === "female" ? "여성" : "남성"}
              </label>
            ))}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="outline" onClick={handleGenerate} disabled={busy}>
            <RefreshCw className="size-3.5" />
            {generating ? "생성 중..." : hasImage ? "재생성" : "이미지 생성"}
          </Button>
          <Button type="button" size="sm" variant="outline" onClick={() => inputRef.current?.click()} disabled={busy}>
            <FileUp className="size-3.5" />
            {uploading ? "업로드 중..." : "직접 업로드"}
          </Button>
          {hasImage && (
            <Button type="button" size="sm" variant="ghost" onClick={handleRemove} disabled={busy}>
              <X className="size-3.5" />
              {removing ? "제거 중..." : "제거"}
            </Button>
          )}
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    </div>
  );
}
