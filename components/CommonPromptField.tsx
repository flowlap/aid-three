"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

/**
 * A persisted free-text field shown at the top of a generation step, whose
 * content gets folded into every AI call made in that step (see the
 * `commonPrompt`/`documentSummary`-style params on selectScreenTypes /
 * generateSceneImage). Lets the user steer every scene at once instead of
 * repeating the same instruction per scene.
 */
export function CommonPromptField({
  saveUrl,
  initialValue,
  label,
  placeholder,
  helperText,
}: {
  saveUrl: string;
  initialValue: string;
  label: string;
  placeholder?: string;
  helperText?: string;
}) {
  const [value, setValue] = useState(initialValue);
  const [lastSaved, setLastSaved] = useState(initialValue);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(saveUrl, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? "저장에 실패했습니다");
        return;
      }
      setLastSaved(value);
    } catch {
      setError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  const dirty = value !== lastSaved;

  return (
    <Card className="gap-2 p-4">
      <div className="flex items-center justify-between gap-2">
        <label className="text-sm font-medium">{label}</label>
        <Button size="sm" variant="outline" onClick={handleSave} disabled={saving || !dirty}>
          {saving ? "저장 중..." : dirty ? "저장" : "저장됨"}
        </Button>
      </div>
      {helperText && <p className="text-xs text-muted-foreground">{helperText}</p>}
      <Textarea
        rows={3}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        className="text-sm"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
    </Card>
  );
}
