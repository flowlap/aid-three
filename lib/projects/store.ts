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

const SCENE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertSafeSceneId(sceneId: string): void {
  if (!SCENE_ID_PATTERN.test(sceneId)) {
    throw new Error(`Invalid scene id: ${sceneId}`);
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

export function projectImagesDir(id: string): string {
  return path.join(projectDir(id), "images");
}

export function projectAudioDir(id: string): string {
  return path.join(projectDir(id), "audio");
}

export function projectVideoFramesDir(id: string): string {
  return path.join(projectDir(id), "video-frames");
}

export function projectVideoClipsDir(id: string): string {
  return path.join(projectDir(id), "video", "clips");
}

export function projectVideoPath(id: string): string {
  return path.join(projectDir(id), "video", "final.mp4");
}

export function projectVideoClipPath(id: string, sceneId: string): string {
  assertSafeSceneId(sceneId);
  return path.join(projectVideoClipsDir(id), `${sceneId}.mp4`);
}

export function projectVideoFramePath(id: string, sceneId: string): string {
  assertSafeSceneId(sceneId);
  return path.join(projectVideoFramesDir(id), `${sceneId}.png`);
}

export function projectAudioPath(id: string, sceneId: string): string {
  assertSafeSceneId(sceneId);
  return path.join(projectAudioDir(id), `${sceneId}.wav`);
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

export async function updateProjectTitle(id: string, title: string): Promise<ProjectMeta> {
  const meta = await readProject(id);
  if (!meta) throw new Error(`Project not found: ${id}`);
  meta.title = title;
  await fs.writeFile(path.join(projectDir(id), "project.json"), JSON.stringify(meta, null, 2), "utf-8");
  return meta;
}

export async function deleteProject(id: string): Promise<void> {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export function projectPptxTemplatePath(id: string): string {
  return path.join(projectDir(id), "pptx-template.pptx");
}

export async function writeProjectPptxTemplate(id: string, buffer: Buffer): Promise<void> {
  await fs.writeFile(projectPptxTemplatePath(id), buffer);
}

export async function readProjectPptxTemplate(id: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(projectPptxTemplatePath(id));
  } catch {
    return null;
  }
}

export async function deleteProjectPptxTemplate(id: string): Promise<void> {
  await fs.rm(projectPptxTemplatePath(id), { force: true });
}

export type ReferenceImageKind = "background" | "presenter";

export function projectReferenceImagePath(id: string, kind: ReferenceImageKind): string {
  return path.join(projectDir(id), `reference-${kind}.png`);
}

export async function writeProjectReferenceImage(id: string, kind: ReferenceImageKind, buffer: Buffer): Promise<void> {
  await fs.writeFile(projectReferenceImagePath(id, kind), buffer);
}

export async function readProjectReferenceImage(id: string, kind: ReferenceImageKind): Promise<Buffer | null> {
  try {
    return await fs.readFile(projectReferenceImagePath(id, kind));
  } catch {
    return null;
  }
}

export async function deleteProjectReferenceImage(id: string, kind: ReferenceImageKind): Promise<void> {
  await fs.rm(projectReferenceImagePath(id, kind), { force: true });
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

export async function writeProjectImage(id: string, sceneId: string, buffer: Buffer): Promise<void> {
  assertSafeSceneId(sceneId);
  await fs.mkdir(projectImagesDir(id), { recursive: true });
  await fs.writeFile(path.join(projectImagesDir(id), `${sceneId}.png`), buffer);
}

export async function readProjectImage(id: string, sceneId: string): Promise<Buffer | null> {
  try {
    assertSafeSceneId(sceneId);
    return await fs.readFile(path.join(projectImagesDir(id), `${sceneId}.png`));
  } catch {
    return null;
  }
}

export async function listProjectImageIds(id: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectImagesDir(id));
    return entries.filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -".png".length));
  } catch {
    return [];
  }
}

export async function writeProjectAudio(id: string, sceneId: string, buffer: Buffer): Promise<void> {
  assertSafeSceneId(sceneId);
  await fs.mkdir(projectAudioDir(id), { recursive: true });
  await fs.writeFile(path.join(projectAudioDir(id), `${sceneId}.wav`), buffer);
}

export async function readProjectAudio(id: string, sceneId: string): Promise<Buffer | null> {
  try {
    assertSafeSceneId(sceneId);
    return await fs.readFile(path.join(projectAudioDir(id), `${sceneId}.wav`));
  } catch {
    return null;
  }
}

export async function listProjectAudioIds(id: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectAudioDir(id));
    return entries.filter((name) => name.endsWith(".wav")).map((name) => name.slice(0, -".wav".length));
  } catch {
    return [];
  }
}

export async function writeProjectVideoFrame(id: string, sceneId: string, buffer: Buffer): Promise<void> {
  assertSafeSceneId(sceneId);
  await fs.mkdir(projectVideoFramesDir(id), { recursive: true });
  await fs.writeFile(path.join(projectVideoFramesDir(id), `${sceneId}.png`), buffer);
}

export async function readProjectVideoFrame(id: string, sceneId: string): Promise<Buffer | null> {
  try {
    assertSafeSceneId(sceneId);
    return await fs.readFile(path.join(projectVideoFramesDir(id), `${sceneId}.png`));
  } catch {
    return null;
  }
}

export async function listProjectVideoFrameIds(id: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectVideoFramesDir(id));
    return entries.filter((name) => name.endsWith(".png")).map((name) => name.slice(0, -".png".length));
  } catch {
    return [];
  }
}

export async function listProjectVideoClipIds(id: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectVideoClipsDir(id));
    return entries.filter((name) => name.endsWith(".mp4")).map((name) => name.slice(0, -".mp4".length));
  } catch {
    return [];
  }
}

export async function statProjectVideo(id: string): Promise<{ path: string; size: number } | null> {
  try {
    const filePath = projectVideoPath(id);
    const stat = await fs.stat(filePath);
    return { path: filePath, size: stat.size };
  } catch {
    return null;
  }
}

/**
 * Merges a single entry into a top-level map within a project JSON file,
 * e.g. { screenTypes: { "scene-001": {...} } }, without touching sibling
 * entries. Used for per-scene incremental saves during streaming generation.
 * Safe from read-modify-write races only because the AI job registry
 * (lib/jobs/registry.ts) guarantees a single loop owns writes to this file
 * at any given time — this helper does not add its own locking.
 */
export async function mergeProjectJsonMap(
  id: string,
  filename: string,
  topLevelKey: string,
  entryKey: string,
  value: unknown
): Promise<void> {
  assertSafeFilename(filename);
  const filePath = path.join(projectDir(id), filename);

  let parsed: Record<string, unknown> = {};
  try {
    parsed = JSON.parse(await fs.readFile(filePath, "utf-8"));
  } catch {
    parsed = {};
  }

  const existingMap = parsed[topLevelKey];
  const map: Record<string, unknown> =
    typeof existingMap === "object" && existingMap !== null ? { ...(existingMap as Record<string, unknown>) } : {};
  map[entryKey] = value;
  parsed[topLevelKey] = map;

  await fs.writeFile(filePath, JSON.stringify(parsed, null, 2), "utf-8");
}
