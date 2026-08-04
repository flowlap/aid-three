import { LARGE_OUTPUT_MAX_TOKENS, type ChatMessage, type LlmClient } from "../ai/llm/types";
import { stripCodeFence } from "../ai/llm/stripCodeFence";
import { SCREEN_TYPE_OPTIONS, SCREEN_TYPE_INFO, PRESENTER_EXCLUDED_SCREEN_TYPES } from "../visual-templates";
import { LAYOUT_POSITIONS, PRESENTER_POSITIONS, type LayoutElement, type LayoutPosition, type PresenterPosition } from "./designVisuals";
import type { Scene } from "./splitScenes";
import { groupContentScenesByParentTitle } from "./sceneHierarchy";

export interface ScreenTypeAssignment {
  screenType: string;
  recommendedLayout: string;
  rationale: string;
  /**
   * Short on-screen caption/subtitle for this scene, written by the AI as a
   * fresh summary — never a truncated substring of the narration, so it
   * never needs an ellipsis. See computeVisualDesign, which copies this
   * straight into VisualDesign.caption.
   */
  caption: string;
  /**
   * 3-5 keywords picked by the AI after reading the *entire* scene narration
   * and judging importance, not just the first words that appear — replaces
   * the old local extractKeywords() heuristic, which just grabbed whichever
   * non-stopword tokens happened to come first. See computeVisualDesign.
   */
  keywords: string[];
  /**
   * What should actually appear on screen for THIS scene specifically — not
   * a generic per-screenType description. Feeds directly into the AI image
   * prompt (generateSceneImage.ts) as the structural blueprint for what to
   * draw. See computeVisualDesign, which prefers this over the generic
   * per-type template text.
   */
  imageOrDiagramDescription: string;
  /**
   * Where elements sit on screen for THIS scene specifically (e.g. "인물은
   * 좌측, 그래프는 우측" rather than a generic "왼쪽 또는 오른쪽"). Also feeds
   * generateSceneImage.ts, and ScreenMockup reads simple left/right cues
   * from this for the types where it can act on them (see ScreenMockup.tsx).
   */
  objectPlacement: string;
  /**
   * Structured version of `objectPlacement` — see VisualDesign.layoutElements
   * (designVisuals.ts) for why this exists alongside the freeform text.
   * Optional/best-effort: sanitizeLayoutElements drops anything malformed
   * rather than failing the whole response, since this is a newer field the
   * model won't always get in a perfectly clean shape.
   */
  layoutElements?: LayoutElement[];
  /**
   * Where a presenter/announcer should appear if the images step's toggle is
   * on — see VisualDesign.presenterPosition (designVisuals.ts). Decided here
   * (not left to each independent image-generation call) so it can be
   * chosen jointly with objectPlacement and varied against neighboring
   * scenes instead of defaulting to the same position every time.
   */
  presenterPosition?: PresenterPosition;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

const LAYOUT_POSITION_SET: ReadonlySet<string> = new Set(LAYOUT_POSITIONS);

function sanitizeLayoutElements(value: unknown): LayoutElement[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cleaned = value.filter(
    (item): item is LayoutElement =>
      typeof item === "object" &&
      item !== null &&
      typeof (item as LayoutElement).label === "string" &&
      (item as LayoutElement).label.trim().length > 0 &&
      LAYOUT_POSITION_SET.has((item as LayoutElement).position as LayoutPosition)
  );
  return cleaned.length > 0 ? cleaned : undefined;
}

const PRESENTER_POSITION_SET: ReadonlySet<string> = new Set(PRESENTER_POSITIONS);

function sanitizePresenterPosition(value: unknown, screenType: string): PresenterPosition | undefined {
  if (PRESENTER_EXCLUDED_SCREEN_TYPES.has(screenType)) return undefined;
  return typeof value === "string" && PRESENTER_POSITION_SET.has(value) ? (value as PresenterPosition) : undefined;
}

function isScreenTypeAssignment(value: unknown): value is ScreenTypeAssignment {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ScreenTypeAssignment).screenType === "string" &&
    typeof (value as ScreenTypeAssignment).recommendedLayout === "string" &&
    typeof (value as ScreenTypeAssignment).rationale === "string" &&
    typeof (value as ScreenTypeAssignment).caption === "string" &&
    isStringArray((value as ScreenTypeAssignment).keywords) &&
    typeof (value as ScreenTypeAssignment).imageOrDiagramDescription === "string" &&
    typeof (value as ScreenTypeAssignment).objectPlacement === "string"
  );
}

export type ScreenTypeProgress = (
  sceneId: string,
  index: number,
  total: number,
  assignment: ScreenTypeAssignment
) => void | Promise<void>;

export interface SelectScreenTypesOptions {
  onProgress?: ScreenTypeProgress;
  signal?: AbortSignal;
  /**
   * A short (3-5 sentence) overview of the whole document — topic,
   * structure, tone — from summarizeDocument. Included in every scene's
   * prompt so the AI isn't judging a scene from only its immediate
   * neighbors; it knows where the scene sits in the bigger picture.
   */
  documentSummary?: string;
  /**
   * Free-text guidance from the "공통 프롬프트" field at the top of the
   * screen-design step — applies to every scene (e.g. audience/tone
   * constraints, naming restrictions) the same way documentSummary does.
   */
  commonPrompt?: string;
  /**
   * Assignments already on disk from an earlier, interrupted run — scenes
   * with an entry here are reused verbatim (no AI call, no onProgress) so
   * "resume" only pays for the scenes that are actually still missing.
   * Reused entries still populate the internal result map, so the
   * diversity/anti-repetition check for freshly-generated neighbors sees
   * accurate prior-type context across the resume boundary.
   */
  existingAssignments?: Record<string, ScreenTypeAssignment>;
  /**
   * Full scene list to resolve `relatedSceneIds` against, when `scenes`
   * itself is a subset (e.g. the single-scene regenerate route passes just
   * `[scene]` as `scenes` but the full project scene list here) so related
   * scenes can still be looked up for context even when only one scene is
   * being (re)designed. Defaults to `scenes`.
   */
  allScenesForContext?: Scene[];
}

const SCREEN_TYPE_GUIDE = SCREEN_TYPE_OPTIONS.map((type) => `- ${type}: ${SCREEN_TYPE_INFO[type]}`).join("\n");

/**
 * Builds the "관련 씬" context block for a scene's prompt from its
 * `relatedSceneIds` (see Scene in splitScenes.ts) — related scenes already
 * designed earlier in this same run are summarized by their chosen
 * screenType+caption; ones not yet reached (or outside this batch) fall back
 * to their raw narration text.
 */
function buildRelatedSceneContext(
  scene: Scene,
  sceneById: Map<string, Scene>,
  result: Record<string, ScreenTypeAssignment>
): string {
  const relatedIds = scene.relatedSceneIds ?? [];
  if (relatedIds.length === 0) return "";

  const lines = relatedIds
    .map((id) => {
      const related = sceneById.get(id);
      if (!related) return null;
      const assignment = result[id];
      const summary = assignment ? `${assignment.screenType} · "${assignment.caption}"` : related.narrationText;
      return `- [${id}] ${summary}`;
    })
    .filter((line): line is string => Boolean(line));

  if (lines.length === 0) return "";

  return `\n관련 씬(같은 이야기 흐름으로 묶여 있습니다 — 이 씬이 이들을 잇거나 요약·비교하는 역할이라면 화면 유형·자막·화면 설명에 그 관계를 반영하세요):\n${lines.join("\n")}\n`;
}

/** Title scenes are excluded from AI grouping entirely — see MAX_GROUP_SIZE. */
const MAX_GROUP_SIZE = 8;

/** Splits a group into contiguous sub-batches of at most `maxSize`, bounding a single AI call's execution time for very large heading sections (real-world groups have run up to ~20 scenes). */
function chunkContiguous<T>(items: T[], maxSize: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += maxSize) {
    chunks.push(items.slice(i, i + maxSize));
  }
  return chunks;
}

/**
 * Fixed, code-only design for title scenes — no AI call. Title scenes are a
 * heading read aloud as a chapter announcement (see splitScenes.ts), so they
 * always render as a plain "간지/타이틀형" divider; computeVisualDesign
 * (visual-templates/index.ts) already has a template body for this type, and
 * TEXT_FORWARD_SCREEN_TYPES already includes it so image generation renders
 * the caption text directly.
 */
function buildTitleAssignment(scene: Scene): ScreenTypeAssignment {
  return {
    screenType: "간지/타이틀형",
    recommendedLayout: "간지/타이틀형",
    rationale: "제목 씬은 화면설계 AI 호출 없이 간지/타이틀형으로 고정 처리됩니다.",
    caption: scene.narrationText,
    keywords: [],
    imageOrDiagramDescription: "챕터/섹션 제목만 크게 보여주는 구분 화면(간지). 본문 내용 없음",
    objectPlacement: "화면 중앙, 제목 위/아래에 얇은 구분선 또는 장식 요소만",
  };
}

interface RawGroupSceneAssignment extends ScreenTypeAssignment {
  order: number;
}

function isRawGroupSceneAssignment(value: unknown): value is RawGroupSceneAssignment {
  return typeof value === "object" && value !== null && typeof (value as RawGroupSceneAssignment).order === "number" && isScreenTypeAssignment(value);
}

/**
 * Batch prompt for a group of content scenes that share the same nearest
 * (deepest) ancestor title — see groupContentScenesByParentTitle
 * (sceneHierarchy.ts). Reuses the same per-scene field instructions as the
 * old single-scene prompt; group-wide diversity is simplified to a single
 * "no 3 in a row" instruction instead of tracking the immediately-preceding
 * scene's type/presenter position across calls.
 */
function buildDesignGroupMessages(
  groupScenes: Scene[],
  documentContext: string,
  commonPromptContext: string,
  relatedContextByOrder: Map<number, string>
): ChatMessage[] {
  const sceneBlocks = groupScenes
    .map((scene) => `[order=${scene.order}] ${scene.narrationText}${relatedContextByOrder.get(scene.order) ?? ""}`)
    .join("\n\n");

  const prompt = `다음은 같은 소제목 아래 묶인 연속된 씬들입니다. 각 씬에 어울리는 화면 유형을 선택하고, 화면을 상세히 설계하세요.
${documentContext}${commonPromptContext}
사용 가능한 화면 유형과 설명(반드시 이 중 하나를 이름 그대로 정확히 선택):
${SCREEN_TYPE_GUIDE}

그룹 내 다양성: 같은 그룹 안에서 화면 유형을 3개 연속으로 동일하게 선택하지 마세요. 다만 내용상 명백히 같은 유형이 계속 이어져야 한다면(예: 같은 절차의 연속 단계) 그대로 유지해도 됩니다. 강사(발표자)가 등장하는 씬들은 내용이 이어지는 동안 같은 위치를 유지하고, 새로운 내용으로 전환되는 지점에서만 위치를 바꾸세요.

씬 목록(순서대로, 화면 전환이 이 순서로 이어집니다):
${sceneBlocks}

각 씬마다 아래 필드를 작성하세요.

caption: 화면 하단에 자막으로 쓸 짧은 문구를 직접 새로 요약해서 작성하세요. 나레이션 원문을 그대로 잘라내지 말고, 20자 내외의 완결된 문구로 핵심 의미를 요약하세요. 말줄임표(…)나 "..."는 사용하지 마세요.

keywords: 해당 씬 나레이션 전체를 끝까지 검토한 뒤, 등장 순서가 아니라 실제 중요도 기준으로 핵심 키워드 3~5개를 선정하세요. 각 키워드는 1~3단어의 명사(구)로 작성하세요.

imageOrDiagramDescription: 이 화면에 실제로 무엇이 그려져야 하는지 해당 씬의 구체적인 내용을 바탕으로 서술하세요. "나레이션 내용을 보여주는 이미지" 같은 일반적인 설명이 아니라, 그 씬에서 다루는 실제 대상·개념·수치를 직접 언급하며 무엇을 어떻게 시각화할지 구체적으로 쓰세요.

objectPlacement: 화면 안의 요소들이 정확히 어디에 배치되는지 구체적으로 쓰세요(예: "인물은 화면 좌측 1/3, 그래프는 우측 2/3", "중심 개념 '배출권 ETF'는 중앙, 관련 개념 3개는 그 주위에 방사형 배치"). 좌/우/상/하 등 방향을 명시하면 목업과 이미지 생성에 그대로 반영됩니다.

layoutElements: objectPlacement에서 서술한 배치를 3~6개의 (label, position) 쌍으로 압축하세요. label은 화면에 실제로 보이는 요소 이름(예: "배출권 ETF 카드", "인물", "핵심 문구"), position은 반드시 다음 9개 중 하나로만 선택하세요: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right. 이 값은 코드가 기계적으로 렌더링할 때 쓰이므로 objectPlacement 서술과 반드시 일치해야 합니다.

presenterPosition: 이 화면에 강사(발표자)가 등장한다면 어디에 배치할지 반드시 다음 4개 중 하나로 선택하세요: left, right, center, full. 방금 정한 objectPlacement/layoutElements와 겹치지 않게 — 다른 시각 요소가 이미 차지한 자리를 피해서 정하세요.

JSON으로만 응답하세요: {"scenes": [{"order": number, "screenType": string, "recommendedLayout": string, "rationale": string, "caption": string, "keywords": string[], "imageOrDiagramDescription": string, "objectPlacement": string, "layoutElements": {"label": string, "position": string}[], "presenterPosition": string}]} — scenes 배열에는 위 씬 목록의 모든 order가 하나씩, 목록과 같은 순서로 빠짐없이 포함되어야 합니다.`;

  return [
    { role: "system", content: "당신은 이러닝 스토리보드 화면 설계 전문가입니다." },
    { role: "user", content: prompt },
  ];
}

/**
 * A single group call to the AI. Split out from designSceneGroup so a
 * missing-scene response (see MAX_GROUP_ATTEMPTS) can be retried with a fresh
 * call instead of failing the whole group outright.
 */
async function requestSceneGroupAssignments(
  client: LlmClient,
  groupScenes: Scene[],
  documentContext: string,
  commonPromptContext: string,
  relatedContextByOrder: Map<number, string>,
  signal: AbortSignal
): Promise<Map<number, ScreenTypeAssignment>> {
  const raw = await client.complete(
    buildDesignGroupMessages(groupScenes, documentContext, commonPromptContext, relatedContextByOrder),
    { jsonMode: true, tier: "fast", maxTokens: LARGE_OUTPUT_MAX_TOKENS, signal }
  );

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error(`AI 응답이 유효한 JSON이 아닙니다 (scenes: ${groupScenes.map((s) => s.id).join(", ")})`);
  }

  const rawScenes = (parsed as { scenes?: unknown }).scenes;
  if (!Array.isArray(rawScenes)) {
    throw new Error(
      `AI 응답 형식이 올바르지 않습니다 (scenes 배열 없음, group: ${groupScenes.map((s) => s.id).join(", ")})`
    );
  }

  const byOrder = new Map<number, ScreenTypeAssignment>();
  for (const entry of rawScenes) {
    if (!isRawGroupSceneAssignment(entry)) continue;
    const { order, ...assignmentFields } = entry;
    const assignment: ScreenTypeAssignment = {
      ...assignmentFields,
      layoutElements: sanitizeLayoutElements((entry as { layoutElements?: unknown }).layoutElements),
      presenterPosition: sanitizePresenterPosition((entry as { presenterPosition?: unknown }).presenterPosition, entry.screenType),
    };
    byOrder.set(order, assignment);
  }

  return byOrder;
}

/**
 * A group call occasionally comes back missing one of the requested orders —
 * observed as non-deterministic (rerunning the exact same group succeeds),
 * so it's treated as an AI sampling fluke rather than a parsing bug: retried
 * with a fresh call before giving up.
 */
const MAX_GROUP_ATTEMPTS = 2;

/** Designs one contiguous group (or sub-batch) of content scenes with a single AI call, returning assignments keyed by scene order. */
async function designSceneGroup(
  client: LlmClient,
  groupScenes: Scene[],
  context: {
    documentContext: string;
    commonPromptContext: string;
    sceneById: Map<string, Scene>;
    result: Record<string, ScreenTypeAssignment>;
    signal: AbortSignal;
  }
): Promise<Map<number, ScreenTypeAssignment>> {
  const relatedContextByOrder = new Map(
    groupScenes.map((scene) => [scene.order, buildRelatedSceneContext(scene, context.sceneById, context.result)])
  );

  let missing: Scene[] = groupScenes;
  let byOrder = new Map<number, ScreenTypeAssignment>();

  for (let attempt = 1; attempt <= MAX_GROUP_ATTEMPTS; attempt++) {
    byOrder = await requestSceneGroupAssignments(
      client,
      groupScenes,
      context.documentContext,
      context.commonPromptContext,
      relatedContextByOrder,
      context.signal
    );
    missing = groupScenes.filter((scene) => !byOrder.has(scene.order));
    if (missing.length === 0) return byOrder;

    if (attempt < MAX_GROUP_ATTEMPTS) {
      console.warn(
        `[selectScreenTypes] 그룹 응답에 씬 누락, 재시도 (${attempt}/${MAX_GROUP_ATTEMPTS}): ${missing.map((s) => s.id).join(", ")}`
      );
    }
  }

  throw new Error(`AI 응답에 씬이 누락되었습니다 (${missing.map((s) => s.id).join(", ")})`);
}

export async function selectScreenTypes(
  client: LlmClient,
  scenes: Scene[],
  options: SelectScreenTypesOptions = {}
): Promise<Record<string, ScreenTypeAssignment>> {
  const { onProgress, signal, documentSummary, commonPrompt, existingAssignments, allScenesForContext } = options;
  const result: Record<string, ScreenTypeAssignment> = {};
  const sceneById = new Map((allScenesForContext ?? scenes).map((s) => [s.id, s]));
  const indexById = new Map(scenes.map((s, i) => [s.id, i]));

  /**
   * Workers run concurrently (one per content group / sub-batch); if any
   * single group's call fails, the whole operation is meant to fail fast —
   * but without an explicit abort, sibling workers had no way to know and
   * kept running their own scenes to completion in the background, writing
   * results via onProgress even after the caller had already been told the
   * job failed. This internal controller mirrors the external `signal` (so
   * real cancellation still works exactly as before) and is *additionally*
   * tripped the moment any worker throws, so every other worker's next
   * `signal.aborted` check (and any in-flight `client.complete` call, which
   * also receives this signal) stops promptly instead of running unseen.
   */
  const internalController = new AbortController();
  const onExternalAbort = () => internalController.abort();
  if (signal) {
    if (signal.aborted) internalController.abort();
    else signal.addEventListener("abort", onExternalAbort);
  }
  const internalSignal = internalController.signal;

  for (const scene of scenes) {
    const existing = existingAssignments?.[scene.id];
    if (existing) result[scene.id] = existing;
  }

  // Title scenes never call the AI — assign their fixed local design immediately.
  for (const scene of scenes) {
    if (scene.sceneType !== "title" || result[scene.id]) continue;
    const assignment = buildTitleAssignment(scene);
    result[scene.id] = assignment;
    await onProgress?.(scene.id, indexById.get(scene.id)!, scenes.length, assignment);
  }

  const documentContext = documentSummary ? `\n문서 전체 개요(맥락 참고용): ${documentSummary}\n` : "";
  const commonPromptContext = commonPrompt?.trim() ? `\n공통 지침(모든 씬에 적용): ${commonPrompt.trim()}\n` : "";

  const pendingGroups = groupContentScenesByParentTitle(scenes)
    .map((group) => group.scenes.filter((scene) => !result[scene.id]))
    .filter((group) => group.length > 0)
    .flatMap((group) => chunkContiguous(group, MAX_GROUP_SIZE));

  async function runGroupWorker(groupScenes: Scene[]): Promise<void> {
    if (internalSignal.aborted) throw new DOMException("Aborted", "AbortError");
    const byOrder = await designSceneGroup(client, groupScenes, {
      documentContext,
      commonPromptContext,
      sceneById,
      result,
      signal: internalSignal,
    });
    for (const scene of groupScenes) {
      const assignment = byOrder.get(scene.order)!;
      result[scene.id] = assignment;
      await onProgress?.(scene.id, indexById.get(scene.id)!, scenes.length, assignment);
    }
  }

  try {
    if (internalSignal.aborted) throw new DOMException("Aborted", "AbortError");
    await Promise.all(
      pendingGroups.map((group) =>
        runGroupWorker(group).catch((err) => {
          // Stop every other worker as soon as one fails, instead of leaving
          // them to keep designing scenes in the background after the caller
          // has already been told this call failed.
          internalController.abort();
          throw err;
        })
      )
    );
  } finally {
    signal?.removeEventListener("abort", onExternalAbort);
  }

  return result;
}
