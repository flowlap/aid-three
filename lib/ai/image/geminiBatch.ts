import { ImageApiError } from "./types";

/**
 * Direct Google Gemini API integration for **batch** image generation —
 * distinct from every other client in lib/ai/image/, which all call a
 * real-time per-image endpoint (see IMAGE_PROVIDER). This talks to Gemini's
 * actual asynchronous Batch API (`:batchGenerateContent`), used only for the
 * "일괄 생성" (2+ scenes at once) flow when `IMAGE_BATCH_PROVIDER=gemini` (see
 * app/api/projects/[projectId]/images/batch/route.ts). Batch jobs are
 * async by design — usually minutes, up to 24h — in exchange for a lower
 * per-image cost, so callers submit once and poll later; nothing here blocks
 * waiting for completion.
 *
 * REST shape confirmed against Google's own docs (ai.google.dev/gemini-api/docs/batch-mode,
 * ai.google.dev/api/files) at implementation time:
 *   - Files API resumable upload: POST {FILES_UPLOAD_BASE} with X-Goog-Upload-* headers,
 *     returns `{file: {name: "files/{id}"}}`.
 *   - Batch job creation: POST {API_BASE}/models/{model}:batchGenerateContent with
 *     `{batch: {display_name, input_config: {file_name}}}`, returns `{name: "batches/{id}"}`.
 *   - Status: GET {API_BASE}/{batchName} → `{metadata: {state: "BATCH_STATE_RUNNING" | "BATCH_STATE_SUCCEEDED" | ...}}`
 *     (live-confirmed by testing — the docs' `JOB_STATE_*` naming didn't match the actual
 *     response, see isBatchSucceeded below).
 *   - Results: small batches return `response.inlinedResponses`; larger ones return
 *     `response.responsesFile` (another Files API resource) that must be downloaded separately.
 * The exact model id for "Nano Banana 2 Lite" wasn't confirmed in the fetched docs — it's a
 * plain env override (GEMINI_BATCH_IMAGE_MODEL, see factory below) for exactly this reason.
 */

const API_BASE = "https://generativelanguage.googleapis.com/v1beta";
const FILES_UPLOAD_BASE = "https://generativelanguage.googleapis.com/upload/v1beta/files";

export interface GeminiBatchImageItem {
  /** Stable identifier round-tripped through the batch job — this project uses scene ids. */
  key: string;
  prompt: string;
  referenceImages?: Buffer[];
}

/**
 * Builds one JSONL line for a single batch item — pure and unit-testable
 * without any network access. Mirrors hchatGeminiImageClient.ts's
 * contents/parts shape (inline_data reference images first, prompt text
 * last) and NO_TEXT/production-style instructions are the CALLER's
 * responsibility (already baked into `prompt` by buildImagePrompt), same as
 * every other image client in this directory.
 */
export function buildBatchRequestLine(item: GeminiBatchImageItem): string {
  const imageParts = (item.referenceImages ?? [])
    .filter((buf) => buf.length > 0)
    .map((buf) => ({ inline_data: { mime_type: "image/png", data: buf.toString("base64") } }));

  const line = {
    key: item.key,
    request: {
      contents: [{ role: "user", parts: [...imageParts, { text: item.prompt }] }],
      generation_config: { responseModalities: ["TEXT", "IMAGE"] },
    },
  };
  return JSON.stringify(line);
}

/** Builds the full JSONL payload (one line per item, newline-joined) submitted as the batch's input file. */
export function buildBatchRequestJsonl(items: GeminiBatchImageItem[]): string {
  return items.map(buildBatchRequestLine).join("\n");
}

interface RawBatchResultLine {
  key?: string;
  metadata?: { key?: string };
  response?: {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string }; inline_data?: { data?: string } }> } }>;
  };
  error?: { message?: string; code?: number };
}

export interface GeminiBatchResultEntry {
  key: string;
  ok: true;
  buffer: Buffer;
}

export interface GeminiBatchResultError {
  key: string;
  ok: false;
  message: string;
}

/**
 * Parses the results JSONL (whatever GEMINI_BATCH_IMAGE_MODEL responded with
 * per key) into a per-key outcome map. Pure and unit-testable — no network.
 * Tolerates both `key` at the line's top level and `metadata.key` (the two
 * shapes Google's own docs show in different places) since which one the
 * live API actually echoes back wasn't confirmed at implementation time.
 */
export function parseBatchResultsJsonl(jsonl: string): Map<string, GeminiBatchResultEntry | GeminiBatchResultError> {
  const results = new Map<string, GeminiBatchResultEntry | GeminiBatchResultError>();
  for (const rawLine of jsonl.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    let parsed: RawBatchResultLine;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    const key = parsed.key ?? parsed.metadata?.key;
    if (!key) continue;

    if (parsed.error) {
      results.set(key, { key, ok: false, message: parsed.error.message ?? `배치 항목 오류 (code ${parsed.error.code ?? "?"})` });
      continue;
    }

    let b64: string | undefined;
    for (const candidate of parsed.response?.candidates ?? []) {
      for (const part of candidate.content?.parts ?? []) {
        const inline = part.inlineData ?? part.inline_data;
        if (inline?.data) b64 = inline.data;
      }
    }
    if (!b64) {
      results.set(key, { key, ok: false, message: "배치 응답에 이미지 데이터가 없습니다" });
      continue;
    }
    results.set(key, { key, ok: true, buffer: Buffer.from(b64, "base64") });
  }
  return results;
}

async function readErrorBody(res: Response): Promise<string> {
  return res.text().catch(() => "");
}

/**
 * Uploads a JSONL buffer via Gemini's resumable Files API upload protocol
 * (start request carrying metadata + size/type headers, then a second
 * request with the actual bytes) and returns the uploaded file's resource
 * name (`files/{id}`).
 */
export async function uploadBatchInputFile(jsonl: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const bytes = Buffer.from(jsonl, "utf-8");

  const startRes = await fetch(`${FILES_UPLOAD_BASE}?key=${encodeURIComponent(apiKey)}`, {
    method: "POST",
    headers: {
      "X-Goog-Upload-Protocol": "resumable",
      "X-Goog-Upload-Command": "start",
      "X-Goog-Upload-Header-Content-Length": String(bytes.length),
      "X-Goog-Upload-Header-Content-Type": "application/jsonl",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ file: { display_name: `image-batch-${Date.now()}.jsonl` } }),
    signal,
  });
  if (!startRes.ok) throw new ImageApiError(startRes.status, await readErrorBody(startRes));
  const uploadUrl = startRes.headers.get("x-goog-upload-url");
  if (!uploadUrl) throw new Error("Gemini Files API가 업로드 URL(x-goog-upload-url)을 반환하지 않았습니다");

  const uploadRes = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      "Content-Length": String(bytes.length),
      "X-Goog-Upload-Offset": "0",
      "X-Goog-Upload-Command": "upload, finalize",
    },
    body: new Uint8Array(bytes),
    signal,
  });
  if (!uploadRes.ok) throw new ImageApiError(uploadRes.status, await readErrorBody(uploadRes));
  const uploaded = (await uploadRes.json()) as { file?: { name?: string } };
  if (!uploaded.file?.name) throw new Error("Gemini Files API 업로드 응답에 file.name이 없습니다");
  return uploaded.file.name;
}

/** Creates the batch job referencing an already-uploaded input file, returning the batch resource name (`batches/{id}`). */
export async function createBatchJob(
  fileName: string,
  model: string,
  apiKey: string,
  signal?: AbortSignal
): Promise<string> {
  const res = await fetch(`${API_BASE}/models/${model}:batchGenerateContent`, {
    method: "POST",
    headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({
      batch: { display_name: `image-batch-${Date.now()}`, input_config: { file_name: fileName } },
    }),
    signal,
  });
  if (!res.ok) throw new ImageApiError(res.status, await readErrorBody(res));
  const created = (await res.json()) as { name?: string };
  if (!created.name) throw new Error("Gemini 배치 작업 생성 응답에 name이 없습니다");
  return created.name;
}

/** Convenience wrapper: JSONL build → upload → batch job creation in one call. Returns the batch resource name (`batches/{id}`) to persist. */
export async function submitGeminiImageBatch(
  items: GeminiBatchImageItem[],
  opts: { apiKey: string; model: string; signal?: AbortSignal }
): Promise<{ batchName: string }> {
  const jsonl = buildBatchRequestJsonl(items);
  const fileName = await uploadBatchInputFile(jsonl, opts.apiKey, opts.signal);
  const batchName = await createBatchJob(fileName, opts.model, opts.apiKey, opts.signal);
  return { batchName };
}

export interface GeminiBatchStatus {
  state: string;
  /** Present once state is a terminal success and results are small enough to inline. */
  inlinedResponsesRaw?: unknown;
  /** Present once state is a terminal success and results were written to a Files API resource instead. */
  responsesFileName?: string;
  errorMessage?: string;
}

/** One status check — GET {batchName}. Callers own the polling interval/schedule (see the batch status API route). */
export async function pollGeminiBatch(batchName: string, apiKey: string, signal?: AbortSignal): Promise<GeminiBatchStatus> {
  const res = await fetch(`${API_BASE}/${batchName}`, { headers: { "x-goog-api-key": apiKey }, signal });
  if (!res.ok) throw new ImageApiError(res.status, await readErrorBody(res));
  const body = (await res.json()) as {
    metadata?: { state?: string };
    state?: string;
    done?: boolean;
    error?: { message?: string };
    response?: { inlinedResponses?: unknown; responsesFile?: string };
  };
  const state = body.metadata?.state ?? body.state ?? (body.done ? "JOB_STATE_SUCCEEDED" : "JOB_STATE_RUNNING");
  return {
    state,
    inlinedResponsesRaw: body.response?.inlinedResponses,
    responsesFileName: body.response?.responsesFile,
    errorMessage: body.error?.message,
  };
}

/**
 * Downloads a Files API resource's raw bytes as text (used for the results
 * JSONL when responsesFileName is a `files/{id}`, not inline). The correct
 * download URL is `{API_BASE}/{fileName}:download?alt=media` (a `:download`
 * RPC on the file resource, confirmed by testing and by that same file
 * resource's own `downloadUri` field) — NOT `{API_BASE}/download/{fileName}`,
 * which returns "File download is not supported" despite looking plausible.
 * Google also 302-redirects this request to actual storage; `fetch` follows
 * redirects by default so no special handling is needed here.
 */
export async function downloadBatchResultsFile(fileName: string, apiKey: string, signal?: AbortSignal): Promise<string> {
  const res = await fetch(`${API_BASE}/${fileName}:download?alt=media`, {
    headers: { "x-goog-api-key": apiKey },
    signal,
  });
  if (!res.ok) throw new ImageApiError(res.status, await readErrorBody(res));
  return res.text();
}

/**
 * Whether a batch state string represents terminal success. Google's actual
 * live response uses `BATCH_STATE_SUCCEEDED` (confirmed by direct testing),
 * not `JOB_STATE_SUCCEEDED` as the (unconfirmed at doc-reading time) docs
 * suggested — matching on the `SUCCEEDED` substring instead of an exact
 * string is deliberately more permissive than either guess, since Google's
 * own docs disagreed with its own live behavior once already.
 */
export function isBatchSucceeded(state: string): boolean {
  return /SUCCEEDED/i.test(state);
}

/**
 * Resolves a terminal-success GeminiBatchStatus into the results JSONL text —
 * downloads from Files API when the results were too large to inline,
 * otherwise uses the inlined string as-is. Shared by every batch-status route
 * (scene images, sequence master visuals) so this fallback logic exists once.
 */
export async function resolveBatchResultsJsonl(status: GeminiBatchStatus, apiKey: string, signal?: AbortSignal): Promise<string> {
  if (status.responsesFileName) return downloadBatchResultsFile(status.responsesFileName, apiKey, signal);
  if (typeof status.inlinedResponsesRaw === "string") return status.inlinedResponsesRaw;
  throw new Error("배치 결과가 responsesFile도 아니고 문자열 inlinedResponses도 아닙니다 — 이 결과 형태는 아직 지원하지 않습니다");
}

/** Env accessors — kept together so app code never reads process.env for Gemini batch config directly. */
export function getGeminiBatchApiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY 환경변수가 설정되지 않았습니다");
  return key;
}

export function getGeminiBatchImageModel(): string {
  return process.env.GEMINI_BATCH_IMAGE_MODEL || "gemini-3.1-flash-lite-image";
}

export function isGeminiBatchProviderEnabled(): boolean {
  return (process.env.IMAGE_BATCH_PROVIDER || "none") === "gemini";
}
