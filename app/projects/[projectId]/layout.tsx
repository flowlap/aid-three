import Link from "next/link";
import { notFound } from "next/navigation";
import { readProject } from "@/lib/projects/store";

const STEPS = [
  { key: "markdown", label: "1. 마크다운" },
  { key: "scenes", label: "2. 씬 분할" },
  { key: "screen-types", label: "3. 화면 유형" },
  { key: "visual-design", label: "4. 비주얼 설계" },
  { key: "review", label: "5. 일관성 검수" },
  { key: "storyboard", label: "6. 최종 뷰" },
] as const;

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
    <div>
      <nav className="border-b bg-white">
        <div className="mx-auto flex max-w-3xl items-center gap-4 overflow-x-auto p-4 text-sm">
          <Link href="/" className="font-medium text-gray-500 hover:underline">
            ← {project.title}
          </Link>
          {STEPS.map((step) => (
            <Link
              key={step.key}
              href={`/projects/${projectId}/${step.key}`}
              className="whitespace-nowrap text-gray-700 hover:underline"
            >
              {step.label}
            </Link>
          ))}
        </div>
      </nav>
      {children}
    </div>
  );
}
