"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EditableProjectTitle } from "@/components/EditableProjectTitle";
import { cn } from "@/lib/utils";
import { getProjectStatus, PROJECT_STATUS_BADGE_CLASS, PROJECT_STATUS_LABEL } from "@/lib/projects/pipelineStatus";
import { getProductionMode, PRODUCTION_MODE_LABEL, type ProjectMeta } from "@/lib/projects/types";

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

  const status = getProjectStatus(project.currentStep);
  const productionMode = getProductionMode(project);

  return (
    <li>
      <Card className="group relative gap-3 p-5 transition-shadow hover:shadow-[0_1px_2px_rgba(15,15,15,0.04),0_4px_12px_rgba(15,15,15,0.06)]">
        <Link
          href={`/projects/${project.id}/markdown`}
          className="absolute inset-0 rounded-[inherit]"
          aria-label={project.title}
        />
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge className={cn("border-transparent font-medium", PROJECT_STATUS_BADGE_CLASS[status])}>
              {PROJECT_STATUS_LABEL[status]}
            </Badge>
            <Badge variant="outline">{PRODUCTION_MODE_LABEL[productionMode]}</Badge>
          </div>
          <button
            type="button"
            onClick={handleDelete}
            disabled={deleting}
            aria-label="프로젝트 삭제"
            className="relative z-10 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
          >
            <Trash2 className="size-4" />
          </button>
        </div>
        <div>
          <EditableProjectTitle
            projectId={project.id}
            title={project.title}
            className="relative z-10 font-semibold text-foreground group-hover:text-primary"
          />
          <p className="mt-0.5 text-xs text-muted-foreground">
            {new Date(project.createdAt).toLocaleDateString("ko-KR")}
          </p>
        </div>
      </Card>
    </li>
  );
}
