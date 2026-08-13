import { notFound } from "next/navigation";
import { readProject } from "@/lib/projects/store";
import { AppShell } from "@/app/AppShell";
import { getProductionMode } from "@/lib/projects/types";
import { computeStepCompletion } from "@/lib/projects/stepCompletion";

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

  const productionMode = getProductionMode(project);
  const stepCompletion = await computeStepCompletion(projectId, project.currentStep, productionMode);

  return (
    <AppShell
      projectId={projectId}
      projectTitle={project.title}
      productionMode={productionMode}
      stepCompletion={stepCompletion}
    >
      {children}
    </AppShell>
  );
}
