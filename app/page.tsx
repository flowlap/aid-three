import Link from "next/link";
import { Plus } from "lucide-react";
import { listProjects } from "@/lib/projects/store";
import { Button } from "@/components/ui/button";
import { ProjectListItem } from "./ProjectListItem";

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <div className="flex min-h-dvh justify-center bg-muted px-6 py-10 md:px-8">
      <main className="w-full max-w-[1000px] rounded-xl border bg-background p-6 shadow-[0_1px_2px_rgba(15,15,15,0.04),0_4px_12px_rgba(15,15,15,0.06)] md:p-10">
        <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-3xl font-semibold tracking-tight">스토리보드 프로젝트</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              원고를 업로드하고 단계별로 검토하며 이러닝 스토리보드를 완성하세요.
            </p>
          </div>
          <Button
            size="lg"
            nativeButton={false}
            render={
              <Link href="/projects/new">
                <Plus className="size-4" />
                새 프로젝트
              </Link>
            }
          />
        </div>

        {projects.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-20 text-center">
            <p className="text-sm font-medium">아직 프로젝트가 없습니다</p>
            <p className="mt-1 text-sm text-muted-foreground">첫 프로젝트를 만들어 스토리보드 제작을 시작하세요.</p>
            <Button
              className="mt-4"
              nativeButton={false}
              render={<Link href="/projects/new">새 프로젝트 만들기</Link>}
            />
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2">
            {projects.map((project) => (
              <ProjectListItem key={project.id} project={project} />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
