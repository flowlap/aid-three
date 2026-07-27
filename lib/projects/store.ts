import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ProjectMeta, PipelineStep, ScriptType } from "./types";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertValidProjectId(id: string): void {
  if (!UUID_PATTERN.test(id)) {
    throw new Error(`Invalid project id: ${id}`);
  }
}

function assertSafeFilename(filename: string): void {
  if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    throw new Error(`Invalid filename: ${filename}`);
  }
}

function getProjectsRoot(): string {
  return process.env.PROJECTS_DATA_DIR || path.join(process.cwd(), "data", "projects");
}

function projectDir(id: string): string {
  assertValidProjectId(id);
  return path.join(getProjectsRoot(), id);
}

export function projectSourceDir(id: string): string {
  return path.join(projectDir(id), "source");
}

export async function createProject(title: string, scriptType: ScriptType): Promise<ProjectMeta> {
  const id = randomUUID();
  await fs.mkdir(projectSourceDir(id), { recursive: true });

  const meta: ProjectMeta = {
    id,
    title,
    createdAt: new Date().toISOString(),
    scriptType,
    currentStep: "upload",
  };
  await fs.writeFile(path.join(projectDir(id), "project.json"), JSON.stringify(meta, null, 2), "utf-8");
  return meta;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const root = getProjectsRoot();
  await fs.mkdir(root, { recursive: true });
  const entries = await fs.readdir(root, { withFileTypes: true });

  const metas: ProjectMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const meta = await readProject(entry.name);
    if (meta) metas.push(meta);
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function readProject(id: string): Promise<ProjectMeta | null> {
  try {
    const raw = await fs.readFile(path.join(projectDir(id), "project.json"), "utf-8");
    return JSON.parse(raw) as ProjectMeta;
  } catch {
    return null;
  }
}

export async function updateProjectStep(id: string, step: PipelineStep): Promise<void> {
  const meta = await readProject(id);
  if (!meta) throw new Error(`Project not found: ${id}`);
  meta.currentStep = step;
  await fs.writeFile(path.join(projectDir(id), "project.json"), JSON.stringify(meta, null, 2), "utf-8");
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export async function writeProjectFile(id: string, filename: string, content: string): Promise<void> {
  assertSafeFilename(filename);
  await fs.writeFile(path.join(projectDir(id), filename), content, "utf-8");
}

export async function readProjectFile(id: string, filename: string): Promise<string | null> {
  try {
    assertSafeFilename(filename);
    return await fs.readFile(path.join(projectDir(id), filename), "utf-8");
  } catch {
    return null;
  }
}
