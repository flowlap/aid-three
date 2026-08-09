import { LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type LlmClient } from "../ai/llm/types";
import { stripCodeFence } from "../ai/llm/stripCodeFence";
import type { Scene } from "./splitScenes";
import { groupContentScenesByParentTitle } from "./sceneHierarchy";
import type {
  CameraMotion,
  OverlayType,
  Sequence,
  SequenceCameraPlanEntry,
  SequenceOverlayEntry,
  SequencePlan,
  ShotType,
} from "./sequenceTypes";

/**
 * AI-facing sequence-planning module (see
 * docs/superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md,
 * Task 4). Groups adjacent content scenes into visually continuous
 * "sequences" for the sequence production mode. Mirrors splitScenes.ts's
 * shape: a pure prompt builder, a raw-JSON parser/type guard exposed
 * separately for tests, and a thin function that calls the injected
 * LlmClient and hands the result through the parser.
 *
 * Batching (2026-08-09): a very large project's scene list is split into
 * multiple AI calls (see buildSequenceBatches/MAX_SEQUENCE_BATCH_SCENES)
 * rather than always issuing a single call for every content scene at once —
 * a single call's JSON output (one entry per sequence plus a
 * cameraPlan/overlay entry per scene) was observed to exceed
 * LARGE_OUTPUT_MAX_TOKENS and get truncated for a 548-scene project,
 * deterministically failing the whole step. parseSequencePlanResponses
 * merges the batches' results back into one continuously-numbered plan; a
 * small project still produces exactly one batch/one call.
 *
 * Per-batch retry (2026-08-09): after batching fixed the truncation failure
 * above, the same 548-scene project (now ~100+ concurrent batch calls) hit a
 * second failure mode — one batch's response was syntactically invalid JSON
 * (a JSON.parse SyntaxError) despite a normal stop_reason. Mirrors
 * selectScreenTypes.ts's MAX_GROUP_ATTEMPTS precedent: fetchValidatedBatchRaw
 * retries only the failing batch's own call (not the whole plan) up to
 * MAX_SEQUENCE_BATCH_ATTEMPTS times before giving up.
 *
 * Concurrency cap (2026-08-09): the retry above did not make this project
 * succeed — dev.log showed malformed-JSON failures on nearly every run, and
 * the failures got *faster* over successive attempts (down to ~30s), which
 * is Promise.all's fail-fast behavior: with ~145 title-groups this project
 * fires ~145 concurrent streaming calls at once, and the whole plan rejects
 * the moment the single fastest batch to exhaust its retries does so,
 * without waiting for the many slower batches still in flight.
 * mapWithConcurrency caps in-flight batch calls at MAX_CONCURRENT_BATCHES so
 * a huge project no longer hammers the gateway with 100+ simultaneous
 * requests, while small projects (a handful of batches) are unaffected.
 *
 * Retry budget revised (2026-08-09): the concurrency cap alone didn't fix
 * it either — dev.log's outputChars always matched the JSON.parse error
 * position exactly, with a normal stop_reason "end_turn" nowhere near
 * maxTokens. So this is the model itself ending its turn before the JSON
 * object is closed, not a gateway/token-limit artifact — and not the rare
 * fluke selectScreenTypes.ts's own MAX_GROUP_ATTEMPTS=2 precedent assumes:
 * at n≈145 batches for this project, even a modest per-call failure rate
 * makes "every single batch survives within 2 attempts" unlikely (see
 * MAX_SEQUENCE_BATCH_ATTEMPTS's doc comment for the math). Raised the retry
 * budget instead of changing batching/continuity behavior.
 *
 * Design note: planSequences does NOT call validateSequenceIntegrity itself
 * — exactly like splitScenes.ts never calls validateNarrationIntegrity. That
 * check is the caller's (the API route's) responsibility, run against the
 * live scenes.json content at request time. This keeps this module a pure
 * "ask the AI, parse the answer" step and avoids duplicating the integrity
 * logic that already lives in lib/pipeline/validateSequenceIntegrity.ts. A
 * plan that references an unknown/omitted scene or a title scene therefore
 * parses successfully here and is caught one layer up.
 *
 * Sanitize-rather-than-fail: below the outer-envelope parse and the
 * required-field shape guard, per-entry problems (an unrecognized
 * camera/overlay type, a malformed continuity array, a whole entry missing a
 * required field) are dropped or coerced individually instead of failing the
 * entire AI response — mirrors selectScreenTypes.ts's sanitizeLayoutElements.
 * Anything coerced away that validateSequenceIntegrity can't independently
 * re-detect (currently: continuity.fixedElements/doNotChange, which
 * validateSequenceIntegrity never inspects) also sets `needsReview` on that
 * sequence so the loss isn't silent.
 */

const SHOT_TYPES: ReadonlySet<string> = new Set<ShotType>(["wide", "medium", "detail", "close-up"]);
const CAMERA_MOTIONS: ReadonlySet<string> = new Set<CameraMotion>([
  "static",
  "slow-push-in",
  "slow-pull-out",
  "pan-left",
  "pan-right",
  "follow-flow",
]);
const OVERLAY_TYPES: ReadonlySet<string> = new Set<OverlayType>([
  "label",
  "arrow-flow",
  "highlight",
  "diagram",
  "chart",
]);

function isContentScene(scene: Scene): boolean {
  return (scene.sceneType ?? "content") === "content";
}

/**
 * Caps how many content scenes a single AI call is asked to plan at once.
 * Real-world evidence (a 548-scene project) showed this step's JSON output
 * — one entry per sequence plus a cameraPlan/overlay entry per scene —
 * repeatedly hit LARGE_OUTPUT_MAX_TOKENS (64,000) and got truncated
 * mid-response, failing the whole generation deterministically on every
 * retry. That works out to well over 100 tokens/scene of output, so capping
 * batches at a small fraction of that budget leaves comfortable headroom.
 * Mirrors selectScreenTypes.ts's MAX_GROUP_SIZE chunking approach.
 */
const MAX_SEQUENCE_BATCH_SCENES = 50;

function chunkContiguous<T>(items: T[], maxSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += maxSize) {
    chunks.push(items.slice(i, i + maxSize));
  }
  return chunks;
}

/**
 * Splits the full scene list into batches small enough that a single AI
 * call's output can't exceed LARGE_OUTPUT_MAX_TOKENS (see
 * MAX_SEQUENCE_BATCH_SCENES). Batches are cut at title-heading boundaries
 * before falling back to the raw size cap — content under one heading is far
 * more likely to share the same location/subject/viewpoint than content
 * under a different one, so this keeps each AI call's scenes maximally
 * coherent as sequence-forming material instead of cutting at an arbitrary
 * position. Each batch is planned independently and merged back into one
 * plan by parseSequencePlanResponses, so a sequence can never span a batch
 * boundary — an acceptable, rare quality tradeoff for very large projects
 * (title boundaries already force a sequence break there in most documents
 * anyway).
 */
function buildSequenceBatches(scenes: Scene[]): Scene[][] {
  const titleGroups = groupContentScenesByParentTitle(scenes).map((group) => group.scenes);
  return titleGroups.flatMap((group) => chunkContiguous(group, MAX_SEQUENCE_BATCH_SCENES));
}

/**
 * Caps retries of a single batch's own AI call when its response comes back
 * as unusable JSON (see the module docstring's "Per-batch retry" note).
 *
 * Set well above selectScreenTypes.ts's MAX_GROUP_ATTEMPTS (2) on purpose:
 * confirmed via dev.log that this failure is the model ending its turn
 * (stop_reason "end_turn", nowhere near maxTokens) before the JSON object is
 * closed — not rare. A project with many small title-groups (e.g. 145)
 * produces that many batches, and if even a modest fraction of single calls
 * hit this, the odds that *every one* of ~145 batches survives within only 2
 * attempts collapses fast: P(any batch permanently fails) = 1-(1-p^k)^n. At
 * n=145 and a plausible per-call failure rate of even 10-15%, k=2 gives a
 * near-certain overall failure, while k=5 pushes the odds of any one batch
 * failing all five attempts low enough that the whole plan succeeds the
 * vast majority of runs. Each retry is cheap (these batches are tiny).
 */
const MAX_SEQUENCE_BATCH_ATTEMPTS = 5;

/**
 * Caps how many batch AI calls run at once (see the module docstring's
 * "Concurrency cap" note). Small/medium projects (a handful of batches)
 * never hit this cap and behave exactly as before.
 */
const MAX_CONCURRENT_SEQUENCE_BATCHES = 6;

/** Human-readable label for a batch, used to identify which one failed in error messages. */
function describeBatch(batch: Scene[]): string {
  const first = batch[0];
  const last = batch[batch.length - 1];
  if (!first || !last) return "빈 배치";
  return first.order === last.order ? `씬 ${first.order}` : `씬 ${first.order}~${last.order}`;
}

/**
 * Runs async work over `items` with at most `limit` calls in flight at once.
 * Preserves Promise.all's fail-fast behavior (the first rejection stops the
 * overall result), but bounds how many requests are ever issued
 * simultaneously — see the module docstring's "Concurrency cap" note for why
 * this matters for very large projects.
 */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await fn(items[index], index);
    }
  }
  const workerCount = Math.min(limit, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/**
 * Runs fetchRaw() (one AI call for one batch) and validates that its result
 * is at least parseable as the outer `{ sequences: [...] }` envelope,
 * retrying with a fresh call if not. Per-entry shape problems are left to
 * parseSequencePlanResponses's existing sanitize-rather-than-fail handling —
 * only a fully unparseable response triggers a retry here. On final failure,
 * rethrows an error that names which batch failed and includes the
 * underlying cause's message, so the API route can surface a specific reason
 * instead of a generic "실패했습니다".
 */
async function fetchValidatedBatchRaw(batch: Scene[], fetchRaw: () => Promise<string>): Promise<string> {
  const label = describeBatch(batch);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_SEQUENCE_BATCH_ATTEMPTS; attempt++) {
    const raw = await fetchRaw();
    try {
      parseRawSequences(raw);
      return raw;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_SEQUENCE_BATCH_ATTEMPTS) {
        console.warn(
          `[planSequences] 배치(${label}) 응답이 유효한 JSON이 아님, 재시도 (${attempt}/${MAX_SEQUENCE_BATCH_ATTEMPTS})`,
          err
        );
      }
    }
  }
  const cause = lastErr instanceof Error ? lastErr.message : String(lastErr);
  throw new Error(`배치(${label}) 응답 처리 실패: ${cause}`);
}

/**
 * Forces the response through Anthropic tool-use (see
 * hchatClaudeClient.ts's toAnthropicPayload/jsonSchema handling) instead of
 * relying on jsonMode's prompt-instruction request — this is the module that
 * actually hit the "Expected ',' or '}' after property value" failure class
 * in production (see the module docstring's retry-budget history), so it's
 * the one call site that has moved off jsonMode's soft enforcement. The enum
 * values below are drawn directly from SHOT_TYPES/CAMERA_MOTIONS/OVERLAY_TYPES
 * so the schema can never drift from what sanitizeCameraPlan/sanitizeOverlays
 * actually accept.
 */
const PLAN_SEQUENCES_JSON_SCHEMA = {
  name: "emit_sequence_plan",
  description: "이러닝 스토리보드 씬을 시각적으로 연속된 시퀀스로 묶은 계획을 반환합니다.",
  schema: {
    type: "object",
    properties: {
      sequences: {
        type: "array",
        items: {
          type: "object",
          properties: {
            order: { type: "number" },
            title: { type: "string" },
            sceneIds: { type: "array", items: { type: "string" } },
            estimatedDurationSec: { type: "number" },
            purpose: { type: "string" },
            continuity: {
              type: "object",
              properties: {
                location: { type: "string" },
                timeOfDay: { type: ["string", "null"] },
                visualStyle: { type: "string" },
                fixedElements: { type: "array", items: { type: "string" } },
                doNotChange: { type: "array", items: { type: "string" } },
              },
              required: ["location", "visualStyle", "fixedElements", "doNotChange"],
            },
            masterVisual: {
              type: "object",
              properties: { description: { type: "string" } },
              required: ["description"],
            },
            cameraPlan: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sceneId: { type: "string" },
                  shot: { type: "string", enum: Array.from(SHOT_TYPES) },
                  motion: { type: "string", enum: Array.from(CAMERA_MOTIONS) },
                },
                required: ["sceneId", "shot", "motion"],
              },
            },
            overlays: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sceneId: { type: "string" },
                  type: { type: "string", enum: Array.from(OVERLAY_TYPES) },
                  description: { type: "string" },
                },
                required: ["sceneId", "type", "description"],
              },
            },
          },
          required: [
            "order",
            "title",
            "sceneIds",
            "estimatedDurationSec",
            "purpose",
            "continuity",
            "masterVisual",
            "cameraPlan",
            "overlays",
          ],
        },
      },
    },
    required: ["sequences"],
  },
};

/**
 * Builds the single-call prompt. Only content scenes are listed — title
 * scenes are never sent to this step (see Sequence.sceneIds's title policy
 * doc comment in sequenceTypes.ts): there is nothing for the model to do
 * with them, and omitting them entirely is simpler and safer than asking the
 * model to also decide to skip them.
 */
export function buildPlanSequencesMessages(scenes: Scene[]): ChatMessage[] {
  const contentScenes = scenes.filter(isContentScene);
  const sceneBlocks = contentScenes
    .map((scene) => `[${scene.id}] (order=${scene.order}) ${scene.narrationText}`)
    .join("\n");

  const prompt = `다음은 이러닝 영상용으로 이미 확정된 씬 목록입니다(총 ${contentScenes.length}개). 이 씬들을 시각적으로 하나로 이어지는 "시퀀스" 단위로 묶는 계획을 세우세요.

중요: 아래 씬의 순서, 개수, 나레이션 문구는 절대 변경하지 마세요. 씬을 새로 만들거나 쪼개거나 합치지 마세요 — sceneIds에는 반드시 아래 목록에 있는 ID를 철자 그대로 사용하세요. 모든 씬은 정확히 하나의 시퀀스에, 원래 순서 그대로 포함되어야 합니다.

시퀀스로 묶는 기준: 장소, 등장 대상(피사체), 시점(카메라가 보는 관점), 시간대가 계속 이어지는 인접한 씬 2~6개를 하나의 시퀀스로 묶으세요. 장소·대상·시점·시간대 중 하나라도 바뀌면 새 시퀀스로 나누세요.

시퀀스 길이(예상 재생시간): 시퀀스 하나는 20~40초를 목표로 하세요. 다만 인사말이나 챕터 전환처럼 짧게 끝나는 도입/전환용 시퀀스는 이보다 짧아도 괜찮습니다.

각 시퀀스마다 아래 필드를 작성하세요.

title: 시퀀스를 한눈에 알아볼 수 있는 짧은 제목.

purpose: 이 시퀀스가 영상에서 어떤 역할을 하는지(무엇을 전달/설명하는 구간인지).

continuity: 이 시퀀스 안에서 절대 바뀌면 안 되는 시각 요소를 구체적으로 쓰세요.
- location: 장소/배경.
- timeOfDay: 시간대(해당 없으면 생략).
- visualStyle: 그림체/톤(예: 플랫 일러스트, 사실적 3D 렌더 등).
- fixedElements: 화면에 계속 등장해야 할 고정 요소들의 배열(인물, 사물 등).
- doNotChange: 씬이 바뀌어도 절대 변하면 안 되는 것들(예: 인물 복장, 배경 색, 조명 방향).

masterVisual.description: 이 시퀀스 전체가 공유할 배경/환경 마스터 이미지에 대한 설명. 이 이미지는 카메라 크롭·팬·줌으로 여러 씬에 재사용되므로 여유 공간이 있는 넓은 구도로 묘사하세요. 이 이미지에는 글자, 숫자, 표, 그래프, 자막 등 어떤 텍스트나 데이터 시각화도 절대 포함하지 마세요 — 그런 요소는 나중에 렌더러가 별도 레이어(오버레이)로 얹습니다. 배경·환경·인물·사물의 순수한 시각적 묘사만 쓰세요.

cameraPlan: 이 시퀀스에 포함된 씬 하나하나마다 빠짐없이 카메라 계획을 작성하세요. 각 항목은 { sceneId, shot, motion } 형태이며,
- shot은 다음 중 하나: wide, medium, detail, close-up
- motion은 다음 중 하나: static, slow-push-in, slow-pull-out, pan-left, pan-right, follow-flow

overlays: 이 시퀀스에서 화면에 별도로 얹어야 할 자막·라벨·화살표·강조·도표·차트를 나열하세요. 각 항목은 { sceneId, type, description } 형태이며 type은 다음 중 하나: label, arrow-flow, highlight, diagram, chart. description은 렌더러가 그대로 그릴 수 있을 만큼 위치·내용·타이밍을 구체적으로 쓰세요. 필요 없으면 빈 배열로 두세요.

씬 목록(순서대로):
${sceneBlocks}

JSON으로만 응답하세요: {"sequences": [{"order": number, "title": string, "sceneIds": string[], "estimatedDurationSec": number, "purpose": string, "continuity": {"location": string, "timeOfDay": string | null, "visualStyle": string, "fixedElements": string[], "doNotChange": string[]}, "masterVisual": {"description": string}, "cameraPlan": [{"sceneId": string, "shot": string, "motion": string}], "overlays": [{"sceneId": string, "type": string, "description": string}]}]} — sequences 배열은 order 오름차순으로, 위 씬 목록의 모든 씬을 정확히 한 번씩, 원래 순서 그대로 포함해야 합니다.`;

  return [
    { role: "system", content: "당신은 이러닝 스토리보드를 연속된 시각적 시퀀스로 설계하는 영상 연출 전문가입니다." },
    { role: "user", content: prompt },
  ];
}

export interface RawSequenceContinuity {
  location?: unknown;
  timeOfDay?: unknown;
  visualStyle?: unknown;
  fixedElements?: unknown;
  doNotChange?: unknown;
}

export interface RawSequenceMasterVisual {
  description?: unknown;
}

export interface RawSequence {
  order?: unknown;
  title?: unknown;
  sceneIds?: unknown;
  estimatedDurationSec?: unknown;
  purpose?: unknown;
  continuity?: RawSequenceContinuity;
  masterVisual?: RawSequenceMasterVisual;
  cameraPlan?: unknown;
  overlays?: unknown;
}

/**
 * Parses the outer `{ sequences: [...] }` envelope only — the "AI response
 * isn't usable at all" failure mode (mirrors splitScenes.parseRawScenes
 * exactly). See the module docstring for how this differs from per-entry
 * problems, which are sanitized/dropped individually further down.
 */
export function parseRawSequences(raw: string): RawSequence[] {
  let parsed = JSON.parse(stripCodeFence(raw)) as { sequences?: unknown };

  // Tool-use (jsonSchema) forces syntactically valid JSON but not always the
  // exact declared shape — occasionally the model double-encodes the
  // `sequences` array as a JSON string (either the array itself, or another
  // `{ sequences: [...] }` envelope) instead of a native array. Recover
  // rather than fail the whole batch, matching this module's general
  // sanitize-rather-than-fail policy.
  if (parsed && typeof parsed.sequences === "string") {
    try {
      const inner = JSON.parse(parsed.sequences);
      parsed = Array.isArray(inner) ? { sequences: inner } : inner;
    } catch {
      // leave parsed as-is; the shape check below will throw
    }
  }

  if (!parsed || !Array.isArray(parsed.sequences)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (sequences 배열 없음)");
  }
  return parsed.sequences as RawSequence[];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Required-field shape guard for a single raw sequence entry — anything
 * missing here can't be turned into a usable Sequence at all (see the module
 * docstring for what happens to entries that fail this).
 */
export function isValidRawSequenceShape(value: RawSequence): boolean {
  const continuity = value.continuity;
  const masterVisual = value.masterVisual;
  return (
    typeof value.title === "string" &&
    value.title.trim().length > 0 &&
    isStringArray(value.sceneIds) &&
    value.sceneIds.length > 0 &&
    typeof value.estimatedDurationSec === "number" &&
    typeof value.purpose === "string" &&
    typeof continuity === "object" &&
    continuity !== null &&
    typeof continuity.location === "string" &&
    typeof continuity.visualStyle === "string" &&
    typeof masterVisual === "object" &&
    masterVisual !== null &&
    typeof masterVisual.description === "string"
  );
}

/**
 * Coerces a continuity string-array field (fixedElements/doNotChange), which
 * is the one place in this module where a malformed value would otherwise be
 * silently dropped with no trace: `validateSequenceIntegrity` doesn't
 * inspect continuity fields at all, unlike scene-reference or camera/overlay
 * problems which surface there. `wasCoerced` lets toSequence flag
 * `needsReview` instead of losing that signal.
 */
function sanitizeContinuityArray(value: unknown): { value: string[]; wasCoerced: boolean } {
  if (value === undefined) return { value: [], wasCoerced: false };
  if (isStringArray(value)) return { value, wasCoerced: false };
  return { value: [], wasCoerced: true };
}

/** Drops individual camera-plan entries with an unrecognized shot/motion or missing sceneId (see the module docstring). */
function sanitizeCameraPlan(value: unknown): SequenceCameraPlanEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SequenceCameraPlanEntry => {
    const entry = item as Partial<SequenceCameraPlanEntry> | null;
    return (
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.sceneId === "string" &&
      typeof entry.shot === "string" &&
      SHOT_TYPES.has(entry.shot) &&
      typeof entry.motion === "string" &&
      CAMERA_MOTIONS.has(entry.motion)
    );
  });
}

/** Drops individual overlay entries with an unrecognized type or missing fields (see the module docstring). */
function sanitizeOverlays(value: unknown): SequenceOverlayEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is SequenceOverlayEntry => {
    const entry = item as Partial<SequenceOverlayEntry> | null;
    return (
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.sceneId === "string" &&
      typeof entry.type === "string" &&
      OVERLAY_TYPES.has(entry.type) &&
      typeof entry.description === "string"
    );
  });
}

/**
 * Converts one validated raw entry into a real Sequence. Ids/order are
 * assigned locally from array position (sequence-001, sequence-002, …)
 * rather than trusted from the model's own `order` field — mirrors
 * splitScenes.assignSceneIds's approach of stamping ids itself instead of
 * trusting AI-generated identifiers. masterVisual always starts
 * "not-generated": actual image generation is Task 7, out of scope here.
 */
function toSequence(raw: RawSequence, index: number): Sequence {
  const continuity = raw.continuity as RawSequenceContinuity;
  const masterVisual = raw.masterVisual as RawSequenceMasterVisual;
  // isValidRawSequenceShape already guarantees sceneIds is a non-empty
  // string[] (via isStringArray), so this is a plain cast — same as every
  // other required field below — not a re-filter.
  const sceneIds = raw.sceneIds as string[];
  const cameraPlan = sanitizeCameraPlan(raw.cameraPlan);
  const overlays = sanitizeOverlays(raw.overlays);
  const fixedElements = sanitizeContinuityArray(continuity.fixedElements);
  const doNotChange = sanitizeContinuityArray(continuity.doNotChange);

  const coveredByCamera = new Set(cameraPlan.map((entry) => entry.sceneId));
  const needsReview =
    sceneIds.some((id) => !coveredByCamera.has(id)) || fixedElements.wasCoerced || doNotChange.wasCoerced;

  const timeOfDay = typeof continuity.timeOfDay === "string" && continuity.timeOfDay.trim() ? continuity.timeOfDay : undefined;

  return {
    id: `sequence-${String(index + 1).padStart(3, "0")}`,
    order: index + 1,
    title: raw.title as string,
    sceneIds,
    estimatedDurationSec: raw.estimatedDurationSec as number,
    purpose: raw.purpose as string,
    continuity: {
      location: continuity.location as string,
      ...(timeOfDay ? { timeOfDay } : {}),
      visualStyle: continuity.visualStyle as string,
      fixedElements: fixedElements.value,
      doNotChange: doNotChange.value,
    },
    masterVisual: {
      description: masterVisual.description as string,
      status: "not-generated",
    },
    cameraPlan,
    overlays,
    ...(needsReview ? { needsReview: true } : {}),
  };
}

/**
 * Full parse: outer envelope + per-entry shape filtering + id assignment,
 * merged across one or more batch responses (see buildSequenceBatches — a
 * single, non-batched call is just the length-1 case). Each raw string's
 * envelope is parsed independently (an unusable envelope throws immediately,
 * same as before batching existed — a batch response either wasn't JSON or
 * had no `sequences` array at all is not something later batches can make
 * up for), and every batch's valid entries are concatenated in batch order
 * (== original scene order, since buildSequenceBatches preserves it) before
 * ids/order are assigned, so sequence-001, 002, … number continuously across
 * the whole plan regardless of how many batches produced it. Throws only
 * when every entry across every batch is malformed — anything an entry is
 * individually missing/wrong is either sanitized away (camera/overlay
 * sub-fields) or, if the whole entry is unusable, dropped so its scenes
 * surface as `missing-scene-reference` from validateSequenceIntegrity
 * instead of aborting the entire plan.
 */
export function parseSequencePlanResponses(raws: string[]): SequencePlan {
  const validRawSequences: RawSequence[] = [];
  let sawAnyEntry = false;

  for (const raw of raws) {
    const rawSequences = parseRawSequences(raw);
    if (rawSequences.length > 0) sawAnyEntry = true;
    validRawSequences.push(...rawSequences.filter(isValidRawSequenceShape));
  }

  if (sawAnyEntry && validRawSequences.length === 0) {
    throw new Error("AI 응답에 유효한 시퀀스가 하나도 없습니다");
  }

  return {
    version: 1,
    sequences: validRawSequences.map((entry, index) => toSequence(entry, index)),
  };
}

/** Single-response convenience wrapper around parseSequencePlanResponses. */
export function parseSequencePlanResponse(raw: string): SequencePlan {
  return parseSequencePlanResponses([raw]);
}

export interface PlanSequencesOptions {
  signal?: AbortSignal;
}

/** Non-streaming entry point: one JSON-mode call per batch (see buildSequenceBatches), then merge-parse. */
export async function planSequences(
  client: LlmClient,
  scenes: Scene[],
  options: PlanSequencesOptions = {}
): Promise<SequencePlan> {
  const batches = buildSequenceBatches(scenes);
  const raws = await mapWithConcurrency(batches, MAX_CONCURRENT_SEQUENCE_BATCHES, (batch) =>
    fetchValidatedBatchRaw(batch, () =>
      client.complete(buildPlanSequencesMessages(batch), {
        jsonMode: true,
        jsonSchema: PLAN_SEQUENCES_JSON_SCHEMA,
        tier: "accurate",
        maxTokens: LARGE_OUTPUT_MAX_TOKENS,
        signal: options.signal,
      })
    )
  );
  return parseSequencePlanResponses(raws);
}

export interface PlanSequencesStreamOptions {
  signal?: AbortSignal;
  /** Called with each raw text delta as it streams in, from whichever batch produced it — for a live "AI is thinking" preview only, not reparsed. */
  onChunk?: (text: string) => void;
}

/**
 * Streaming variant for the API route. Unlike the pre-batching version, this
 * is no longer necessarily a single AI call — very large projects are split
 * into multiple batches (see buildSequenceBatches), each streamed and
 * accumulated independently, run with bounded concurrency (see
 * MAX_CONCURRENT_SEQUENCE_BATCHES). onChunk fires for every batch's deltas
 * as they arrive so the caller can still show a live text preview; the
 * returned promise resolves to the fully merged SequencePlan once every
 * batch has completed and been parsed.
 */
export async function planSequencesStream(
  client: LlmClient,
  scenes: Scene[],
  options: PlanSequencesStreamOptions = {}
): Promise<SequencePlan> {
  const batches = buildSequenceBatches(scenes);
  const raws = await mapWithConcurrency(batches, MAX_CONCURRENT_SEQUENCE_BATCHES, (batch) =>
    fetchValidatedBatchRaw(batch, async () => {
      const chunkStream = await client.completeStream(buildPlanSequencesMessages(batch), {
        jsonMode: true,
        jsonSchema: PLAN_SEQUENCES_JSON_SCHEMA,
        tier: "accurate",
        maxTokens: LARGE_OUTPUT_MAX_TOKENS,
        signal: options.signal,
      });
      let raw = "";
      for await (const delta of chunkStream) {
        raw += delta;
        options.onChunk?.(delta);
      }
      return raw;
    })
  );
  return parseSequencePlanResponses(raws);
}
