import Link from "next/link";
import { listProjects } from "@/lib/projects/store";
import { Button } from "@/components/ui/button";
import { ProjectListItem } from "./ProjectListItem";

export default async function HomePage() {
  const projects = await listProjects();

  return (
    <main className="mx-auto max-w-3xl p-8">
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold">스토리보드 프로젝트</h1>
        <Button nativeButton={false} render={<Link href="/projects/new">새 프로젝트</Link>} />
      </div>
      <ul className="space-y-2">
        {projects.map((project) => (
          <ProjectListItem key={project.id} project={project} />
        ))}
        {projects.length === 0 && <p className="text-gray-500">아직 프로젝트가 없습니다.</p>}
      </ul>
    </main>
  );
}
