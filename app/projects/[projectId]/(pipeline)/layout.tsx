import { notFound } from "next/navigation";
import { readProject } from "@/lib/projects/store";
import { AppShell } from "@/app/AppShell";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const project = await readProject(projectId);
  if (!project) notFound();

  return (
    <AppShell projectId={projectId} projectTitle={project.title}>
      {children}
    </AppShell>
  );
}
