"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { ProjectMeta } from "@/lib/projects/types";

export function ProjectListItem({ project }: { project: ProjectMeta }) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (!confirm("정말 삭제하시겠습니까?")) return;

    setDeleting(true);
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        alert(data.error ?? "프로젝트 삭제에 실패했습니다");
        return;
      }
      router.refresh();
    } catch {
      alert("프로젝트 삭제 요청 중 오류가 발생했습니다");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <li className="flex items-center justify-between rounded border p-4">
      <div>
        <Link href={`/projects/${project.id}/markdown`} className="font-medium hover:underline">
          {project.title}
        </Link>
        <p className="text-sm text-gray-500">
          현재 단계: {project.currentStep} · 생성일:{" "}
          {new Date(project.createdAt).toLocaleDateString("ko-KR")}
        </p>
      </div>
      <Button variant="destructive" size="sm" onClick={handleDelete} disabled={deleting}>
        {deleting ? "삭제 중..." : "삭제"}
      </Button>
    </li>
  );
}
