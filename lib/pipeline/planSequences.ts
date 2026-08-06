import { LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type LlmClient } from "../ai/llm/types";
import { stripCodeFence } from "../ai/llm/stripCodeFence";
import type { Scene } from "./splitScenes";
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
 * Design note: planSequences does NOT call validateSequenceIntegrity itself
 * — exactly like splitScenes.ts never calls validateNarrationIntegrity. That
 * check is the caller's (the API route's) responsibility, run against the
 * live scenes.json content at request time. This keeps this module a pure
 * "ask the AI, parse the answer" step and avoids duplicating the integrity
 * logic that already lives in lib/pipeline/validateSequenceIntegrity.ts. A
 * plan that references an unknown/omitted scene or a title scene therefore
 * parses successfully here and is caught one layer up.
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
 * Parses the outer `{ sequences: [...] }` envelope only. Throws a plain
 * Error on non-JSON or a missing/malformed `sequences` array — this is the
 * "AI response isn't usable at all" failure mode (mirrors
 * splitScenes.parseRawScenes exactly), distinct from per-sequence shape
 * problems which sanitizeRawSequences below drops individually instead of
 * failing the whole response.
 */
export function parseRawSequences(raw: string): RawSequence[] {
  const parsed = JSON.parse(stripCodeFence(raw)) as { sequences?: RawSequence[] };
  if (!parsed || !Array.isArray(parsed.sequences)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (sequences 배열 없음)");
  }
  return parsed.sequences;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

/**
 * Required-field shape guard for a single raw sequence entry. A sequence
 * missing any of these can't be turned into a usable Sequence at all, so
 * entries failing this are dropped by parseSequencePlanResponse rather than
 * failing the whole response — any scenes they would have covered simply end
 * up reported as `missing-scene-reference` by validateSequenceIntegrity one
 * layer up, which is the correct, already-established way to surface that.
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

function sanitizeStringArray(value: unknown): string[] {
  return isStringArray(value) ? value : [];
}

/** Drops individual camera-plan entries with an unrecognized shot/motion or missing sceneId, rather than failing the whole sequence. */
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

/** Drops individual overlay entries with an unrecognized type or missing fields, rather than failing the whole sequence. */
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
  const sceneIds = (raw.sceneIds as unknown[]).filter((id): id is string => typeof id === "string");
  const cameraPlan = sanitizeCameraPlan(raw.cameraPlan);
  const overlays = sanitizeOverlays(raw.overlays);

  const coveredByCamera = new Set(cameraPlan.map((entry) => entry.sceneId));
  const needsReview = sceneIds.some((id) => !coveredByCamera.has(id));

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
      fixedElements: sanitizeStringArray(continuity.fixedElements),
      doNotChange: sanitizeStringArray(continuity.doNotChange),
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
 * Full parse: outer envelope + per-entry shape filtering + id assignment.
 * Throws only when the response isn't usable at all (bad JSON, missing
 * `sequences` array, or every single entry malformed) — anything an entry
 * is individually missing/wrong is either sanitized away (camera/overlay
 * sub-fields) or, if the whole entry is unusable, dropped so its scenes
 * surface as `missing-scene-reference` from validateSequenceIntegrity
 * instead of aborting the entire plan.
 */
export function parseSequencePlanResponse(raw: string): SequencePlan {
  const rawSequences = parseRawSequences(raw);
  const validRawSequences = rawSequences.filter(isValidRawSequenceShape);

  if (rawSequences.length > 0 && validRawSequences.length === 0) {
    throw new Error("AI 응답에 유효한 시퀀스가 하나도 없습니다");
  }

  return {
    version: 1,
    sequences: validRawSequences.map((entry, index) => toSequence(entry, index)),
  };
}

export interface PlanSequencesOptions {
  signal?: AbortSignal;
}

/** Non-streaming entry point: one JSON-mode call, then parse. */
export async function planSequences(
  client: LlmClient,
  scenes: Scene[],
  options: PlanSequencesOptions = {}
): Promise<SequencePlan> {
  const raw = await client.complete(buildPlanSequencesMessages(scenes), {
    jsonMode: true,
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal: options.signal,
  });
  return parseSequencePlanResponse(raw);
}

/**
 * Streaming variant for the API route — this is genuinely a single AI call
 * (unlike selectScreenTypes's many small per-group calls), so there's no
 * meaningful per-item progress to report mid-flight; the route streams raw
 * text chunks as they arrive (mirrors splitScenesStream) and parses once the
 * full response is in.
 */
export async function planSequencesStream(
  client: LlmClient,
  scenes: Scene[],
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildPlanSequencesMessages(scenes), {
    jsonMode: true,
    tier: "accurate",
    maxTokens: LARGE_OUTPUT_MAX_TOKENS,
    signal,
  });
}
