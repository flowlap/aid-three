"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

export function EditableProjectTitle({
  projectId,
  title,
  className,
  inputClassName,
  onRenamed,
}: {
  projectId: string;
  title: string;
  className?: string;
  inputClassName?: string;
  onRenamed?: (title: string) => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(title);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  useEffect(() => {
    if (!editing) setValue(title);
  }, [title, editing]);

  async function save() {
    const trimmed = value.trim();
    if (!trimmed || trimmed === title) {
      setValue(title);
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/projects/${projectId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: trimmed }),
      });
      if (res.ok) {
        onRenamed?.(trimmed);
        router.refresh();
        setEditing(false);
      } else {
        setValue(title);
        setEditing(false);
      }
    } catch {
      setValue(title);
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            setValue(title);
            setEditing(false);
          }
        }}
        disabled={saving}
        aria-label="프로젝트 이름"
        className={cn(
          "rounded-md border border-input bg-background px-1.5 py-0.5 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50",
          inputClassName
        )}
      />
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
      }}
      aria-label="프로젝트 이름 편집"
      className={cn("group/title inline-flex min-w-0 items-center gap-1.5 text-left", className)}
    >
      <span className="min-w-0 truncate">{title}</span>
      <Pencil className="size-3 shrink-0 opacity-0 transition-opacity group-hover/title:opacity-100" />
    </button>
  );
}
