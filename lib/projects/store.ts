import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import type { ProjectMeta, PipelineStep, ScriptType, ProductionMode } from "./types";
import type { Sequence, SequenceMasterVisual, SequencePlan } from "../pipeline/sequenceTypes";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const VALID_PRODUCTION_MODES: ProductionMode[] = ["scene", "sequence"];

function assertValidProductionMode(mode: ProductionMode): void {
  if (!VALID_PRODUCTION_MODES.includes(mode)) {
    throw new Error(`Invalid production mode: ${mode}`);
  }
}

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

// Shared defensive shape for all filename-component identifiers below
// (alphanumeric/underscore/dash only, no path separators or ".."). Sequence
// and asset ids intentionally reuse the same permissive shape as scene ids
// rather than a strict e.g. "sequence-NNN" regex, so a hand-edited or future
// non-zero-padded id doesn't hit a path-safety wall unrelated to its actual
// purpose.
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;

function assertSafeIdentifier(label: string, value: string): void {
  if (!SAFE_IDENTIFIER_PATTERN.test(value)) {
    throw new Error(`Invalid ${label}: ${value}`);
  }
}

function assertSafeSceneId(sceneId: string): void {
  assertSafeIdentifier("scene id", sceneId);
}

function assertSafeSequenceId(sequenceId: string): void {
  assertSafeIdentifier("sequence id", sequenceId);
}

function assertSafeAssetId(assetId: string): void {
  assertSafeIdentifier("asset id", assetId);
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

export function projectSequenceAssetsDir(id: string): string {
  return path.join(projectDir(id), "sequence-assets");
}

export function projectSequenceAssetDir(id: string, sequenceId: string): string {
  assertSafeSequenceId(sequenceId);
  return path.join(projectSequenceAssetsDir(id), sequenceId);
}

/**
 * File path (not buffer) for one generated sequence master image — mirrors
 * projectReferenceImagePath, for callers that need a path rather than
 * contents (e.g. the local image engine, which reads reference images
 * directly from disk by path — see images/route.ts). Matches the
 * `{assetId}.png` naming writeSequenceMasterImage/readSequenceMasterImage
 * already use internally.
 */
export function projectSequenceMasterImagePath(id: string, sequenceId: string, assetId: string): string {
  assertSafeAssetId(assetId);
  return path.join(projectSequenceAssetDir(id, sequenceId), `${assetId}.png`);
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

export async function createProject(
  title: string,
  scriptType: ScriptType,
  // New projects default to sequence mode. getProductionMode()'s "scene"
  // fallback is only for legacy project.json files that predate this field.
  productionMode: ProductionMode = "sequence"
): Promise<ProjectMeta> {
  assertValidProductionMode(productionMode);
  const id = randomUUID();
  await fs.mkdir(projectSourceDir(id), { recursive: true });

  const meta: ProjectMeta = {
    id,
    title,
    createdAt: new Date().toISOString(),
    scriptType,
    productionMode,
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

export type ReferenceImageKind = "background" | "presenter" | "style";

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

const SEQUENCES_FILENAME = "sequences.json";

/**
 * sequences.json is only ever written for sequence-mode projects — callers
 * decide when that's appropriate (this task only adds the capability, not
 * the write call sites). Like readProject's project.json handling, this does
 * a blind JSON.parse + cast with no runtime shape validation; that's the
 * existing convention for project files in this codebase (see store.ts's
 * readProject) — validateSequenceIntegrity is where real shape/integrity
 * checking happens, applied by callers after reading.
 */
export async function readSequencePlan(id: string): Promise<SequencePlan | null> {
  const raw = await readProjectFile(id, SEQUENCES_FILENAME);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as SequencePlan;
  } catch {
    return null;
  }
}

export async function writeSequencePlan(id: string, plan: SequencePlan): Promise<void> {
  await writeProjectFile(id, SEQUENCES_FILENAME, JSON.stringify(plan, null, 2));
}

/**
 * Patches one sequence's masterVisual field and persists the whole plan via a
 * plain read-modify-write. NOT atomic on its own — callers MUST serialize all
 * writers of sequences.json for a given project (see the
 * `sequence-master:${projectId}` lock shared by the master-image POST
 * route's write step and the plan-save PUT route) or concurrent calls can
 * silently clobber each other. The master-image route only holds this lock
 * around the write itself, not the (much slower, safely concurrent) image
 * generation call, so multiple sequences' master visuals can generate in
 * parallel while their sequences.json writes stay serialized. Returns the
 * updated Sequence, or null if the plan or the sequence doesn't exist.
 */
export async function updateSequenceMasterVisual(
  id: string,
  sequenceId: string,
  patch: Partial<SequenceMasterVisual>
): Promise<Sequence | null> {
  const plan = await readSequencePlan(id);
  if (!plan) return null;

  const idx = plan.sequences.findIndex((seq) => seq.id === sequenceId);
  if (idx === -1) return null;

  const updated: Sequence = { ...plan.sequences[idx], masterVisual: { ...plan.sequences[idx].masterVisual, ...patch } };
  const sequences = plan.sequences.map((seq, i) => (i === idx ? updated : seq));
  await writeSequencePlan(id, { ...plan, sequences });
  return updated;
}

/**
 * File path (not buffer) for one scene's already-generated image — mirrors
 * projectSequenceMasterImagePath, for callers that need a path rather than
 * contents (e.g. ffmpeg's `-i`, or sequence-mode video rendering reading the
 * raw generated PNG directly instead of going through the Satori frame
 * renderer — see the video route).
 */
export function projectImagePath(id: string, sceneId: string): string {
  assertSafeSceneId(sceneId);
  return path.join(projectImagesDir(id), `${sceneId}.png`);
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

/**
 * Per-scene image versions (file mtime in ms), keyed by sceneId, for
 * cache-busting <img src> in the read-only final views (storyboard/preview).
 * Those are server components with no client-side regenerate state — unlike
 * the images editor, which bumps its own `?v=` counter on each regenerate —
 * so an image regenerated in a different mode (e.g. composite → AI) served
 * from the same bare URL can otherwise stay masked by a stale browser/proxy
 * cache. Appending `?v={mtime}` makes the URL change whenever the file is
 * rewritten, so the view always reflects the most recently generated image.
 * Missing directory → empty map.
 */
export async function listProjectImageVersions(id: string): Promise<Record<string, number>> {
  const dir = projectImagesDir(id);
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return {};
  }
  const versions: Record<string, number> = {};
  await Promise.all(
    entries
      .filter((name) => name.endsWith(".png"))
      .map(async (name) => {
        try {
          const stat = await fs.stat(path.join(dir, name));
          versions[name.slice(0, -".png".length)] = Math.floor(stat.mtimeMs);
        } catch {
          // File vanished between readdir and stat — skip it.
        }
      })
  );
  return versions;
}

/**
 * Sequence master visuals, stored one directory deeper than per-scene images:
 * sequence-assets/{sequenceId}/{assetId}.png. `assetId` lets a sequence keep
 * more than one generated master (e.g. after regeneration) without
 * overwriting the previous file — masterVisual.assetId in sequences.json
 * points at whichever one is current. This task only adds the storage
 * helpers; actual generation is a later task.
 */
export async function writeSequenceMasterImage(
  id: string,
  sequenceId: string,
  assetId: string,
  buffer: Buffer
): Promise<void> {
  assertSafeAssetId(assetId);
  const dir = projectSequenceAssetDir(id, sequenceId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, `${assetId}.png`), buffer);
}

export async function readSequenceMasterImage(
  id: string,
  sequenceId: string,
  assetId: string
): Promise<Buffer | null> {
  try {
    assertSafeAssetId(assetId);
    return await fs.readFile(path.join(projectSequenceAssetDir(id, sequenceId), `${assetId}.png`));
  } catch {
    return null;
  }
}

export async function listSequenceMasterImageIds(id: string, sequenceId: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectSequenceAssetDir(id, sequenceId));
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

/**
 * Path for one scene's rasterized sequence-mode overlay layer (label/arrow/
 * highlight/diagram/chart banners) — a separate transparent PNG composited
 * onto the base frame by ffmpeg's overlay filter after motion cropping, not
 * baked into the base frame itself (see renderSequenceFrameToPng.ts).
 */
export function projectVideoOverlayPath(id: string, sceneId: string): string {
  assertSafeSceneId(sceneId);
  return path.join(projectVideoFramesDir(id), `${sceneId}.overlay.png`);
}

export async function writeProjectVideoOverlay(id: string, sceneId: string, buffer: Buffer): Promise<void> {
  assertSafeSceneId(sceneId);
  await fs.mkdir(projectVideoFramesDir(id), { recursive: true });
  await fs.writeFile(projectVideoOverlayPath(id, sceneId), buffer);
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

/**
 * Sequence-mode resume needs more than "does a clip file exist for this
 * scene ID" (that's scene mode's coarse check, and staying coarse there is
 * intentional — see sceneClipFingerprint.ts for why sequence mode can't reuse
 * it). This stores the computeSceneClipFingerprint() value alongside each
 * rendered clip so a later resume run can detect drift in the image, audio,
 * motion, overlays, or master visual and re-render instead of silently
 * reusing a stale clip.
 */
export function projectVideoClipFingerprintPath(id: string, sceneId: string): string {
  assertSafeSceneId(sceneId);
  return path.join(projectVideoClipsDir(id), `${sceneId}.fingerprint`);
}

export async function writeProjectVideoClipFingerprint(id: string, sceneId: string, fingerprint: string): Promise<void> {
  await fs.mkdir(projectVideoClipsDir(id), { recursive: true });
  await fs.writeFile(projectVideoClipFingerprintPath(id, sceneId), fingerprint, "utf-8");
}

export async function readProjectVideoClipFingerprint(id: string, sceneId: string): Promise<string | null> {
  try {
    return await fs.readFile(projectVideoClipFingerprintPath(id, sceneId), "utf-8");
  } catch {
    return null;
  }
}

export async function statProjectVideo(id: string): Promise<{ path: string; size: number } | null> {
  try {
    const filePath = projectVideoPath(id);
    const stat = await fs.stat(filePath);
    if (stat.size === 0) return null;
    return { path: filePath, size: stat.size };
  } catch {
    return null;
  }
}

/**
 * Gemini image-batch job records — one JSON file per batch, persisted so a
 * submitted (async, potentially hours-long) Google batch job survives a
 * server restart or the user navigating away and back. See
 * lib/ai/image/geminiBatch.ts and app/api/projects/[projectId]/images/batch/.
 */
export interface ImageBatchJobRecord {
  batchId: string;
  /** Google's batch resource name (`batches/{id}`), used to poll/query the job. */
  googleBatchName: string;
  model: string;
  submittedAt: string;
  /** Scene ids submitted in this batch, in submission order. */
  sceneIds: string[];
  status: "submitted" | "succeeded" | "failed" | "applied";
  /** Per-scene failure messages, if any scene's item errored — the rest of the batch can still succeed independently. */
  sceneErrors?: Record<string, string>;
  errorMessage?: string;
  appliedAt?: string;
}

function assertSafeBatchId(batchId: string): void {
  assertSafeIdentifier("batch id", batchId);
}

export function projectImageBatchJobsDir(id: string): string {
  return path.join(projectDir(id), "image-batch-jobs");
}

function projectImageBatchJobPath(id: string, batchId: string): string {
  assertSafeBatchId(batchId);
  return path.join(projectImageBatchJobsDir(id), `${batchId}.json`);
}

export async function writeImageBatchJob(id: string, record: ImageBatchJobRecord): Promise<void> {
  await fs.mkdir(projectImageBatchJobsDir(id), { recursive: true });
  await fs.writeFile(projectImageBatchJobPath(id, record.batchId), JSON.stringify(record, null, 2), "utf-8");
}

export async function readImageBatchJob(id: string, batchId: string): Promise<ImageBatchJobRecord | null> {
  try {
    return JSON.parse(await fs.readFile(projectImageBatchJobPath(id, batchId), "utf-8"));
  } catch {
    return null;
  }
}

export async function listImageBatchJobIds(id: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectImageBatchJobsDir(id));
    return entries.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
  }
}

/**
 * Same async-batch-job persistence pattern as ImageBatchJobRecord above, for
 * sequence master-visual batches (see app/api/projects/[projectId]/sequences/master-image/batch/).
 * `sceneErrors` intentionally reuses that field name (values are actually
 * sequence ids here) so the shared GeminiBatchStatusPanel client component
 * can read either job shape without branching on which kind it is.
 */
export interface MasterBatchJobRecord {
  batchId: string;
  googleBatchName: string;
  model: string;
  submittedAt: string;
  /** Sequence ids submitted in this batch, in submission order. */
  sequenceIds: string[];
  status: "submitted" | "failed" | "applied";
  sceneErrors?: Record<string, string>;
  errorMessage?: string;
  appliedAt?: string;
}

export function projectMasterBatchJobsDir(id: string): string {
  return path.join(projectDir(id), "master-batch-jobs");
}

function projectMasterBatchJobPath(id: string, batchId: string): string {
  assertSafeBatchId(batchId);
  return path.join(projectMasterBatchJobsDir(id), `${batchId}.json`);
}

export async function writeMasterBatchJob(id: string, record: MasterBatchJobRecord): Promise<void> {
  await fs.mkdir(projectMasterBatchJobsDir(id), { recursive: true });
  await fs.writeFile(projectMasterBatchJobPath(id, record.batchId), JSON.stringify(record, null, 2), "utf-8");
}

export async function readMasterBatchJob(id: string, batchId: string): Promise<MasterBatchJobRecord | null> {
  try {
    return JSON.parse(await fs.readFile(projectMasterBatchJobPath(id, batchId), "utf-8"));
  } catch {
    return null;
  }
}

export async function listMasterBatchJobIds(id: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(projectMasterBatchJobsDir(id));
    return entries.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -".json".length));
  } catch {
    return [];
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
