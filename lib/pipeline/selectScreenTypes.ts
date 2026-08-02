import { DEEPSEEK_MODELS, type DeepSeekClient } from "../ai/deepseekClient";
import { SCREEN_TYPE_OPTIONS, SCREEN_TYPE_INFO, PRESENTER_EXCLUDED_SCREEN_TYPES } from "../visual-templates";
import { LAYOUT_POSITIONS, PRESENTER_POSITIONS, type LayoutElement, type LayoutPosition, type PresenterPosition } from "./designVisuals";
import type { Scene } from "./splitScenes";

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

export async function selectScreenTypes(
  client: DeepSeekClient,
  scenes: Scene[],
  options: SelectScreenTypesOptions = {}
): Promise<Record<string, ScreenTypeAssignment>> {
  const { onProgress, signal, documentSummary, commonPrompt, existingAssignments, allScenesForContext } = options;
  const result: Record<string, ScreenTypeAssignment> = {};
  const sceneById = new Map((allScenesForContext ?? scenes).map((s) => [s.id, s]));

  for (let i = 0; i < scenes.length; i++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");

    const scene = scenes[i];

    const existing = existingAssignments?.[scene.id];
    if (existing) {
      result[scene.id] = existing;
      continue;
    }

    const prevScene = scenes[i - 1];
    const nextScene = scenes[i + 1];

    const prevType = i > 0 ? result[scenes[i - 1].id]?.screenType : undefined;
    const prevPrevType = i > 1 ? result[scenes[i - 2].id]?.screenType : undefined;
    let diversityNote = "";
    if (prevType && prevType === prevPrevType) {
      diversityNote = `\n제약: 최근 두 씬이 연속으로 "${prevType}" 유형이었습니다. 이 씬에 명백히 더 적합한 이유가 없는 한 "${prevType}"은 선택하지 말고 다른 유형을 선택하세요.`;
    } else if (prevType) {
      diversityNote = `\n참고: 바로 이전 씬은 "${prevType}" 유형이었습니다. 내용상 반드시 같은 유형이어야 하는 경우가 아니라면, 다양성을 위해 다른 유형을 우선 고려하세요.`;
    }

    const prevPresenterPosition = i > 0 ? result[scenes[i - 1].id]?.presenterPosition : undefined;
    const presenterContinuityNote = prevPresenterPosition
      ? `\n참고: 바로 이전 씬의 아나운서 위치는 "${prevPresenterPosition}"였습니다. 무조건 다르게 하지 마세요 — 이전 씬과 현재 씬이 같은 내용/주제의 연장선(예: 같은 개념을 이어서 설명, 답변이 계속됨)이라면 "${prevPresenterPosition}"을 그대로 유지하고, 새로운 주제나 내용으로 전환되는 지점이라면 다른 위치로 바꾸세요.`
      : "";

    const documentContext = documentSummary ? `\n문서 전체 개요(맥락 참고용): ${documentSummary}\n` : "";
    const commonPromptContext = commonPrompt?.trim() ? `\n공통 지침(모든 씬에 적용): ${commonPrompt.trim()}\n` : "";
    const relatedContext = buildRelatedSceneContext(scene, sceneById, result);

    const prompt = `다음 씬에 어울리는 화면 유형을 선택하고, 화면을 상세히 설계하세요.
${documentContext}${commonPromptContext}${relatedContext}
사용 가능한 화면 유형과 설명(반드시 이 중 하나를 이름 그대로 정확히 선택):
${SCREEN_TYPE_GUIDE}
${diversityNote}
이전 씬: ${prevScene?.narrationText ?? "(없음)"}
현재 씬: ${scene.narrationText}
다음 씬: ${nextScene?.narrationText ?? "(없음)"}

caption: 화면 하단에 자막으로 쓸 짧은 문구를 직접 새로 요약해서 작성하세요. 나레이션 원문을 그대로 잘라내지 말고, 20자 내외의 완결된 문구로 핵심 의미를 요약하세요. 말줄임표(…)나 "..."는 사용하지 마세요.

keywords: 현재 씬 나레이션 전체를 끝까지 검토한 뒤, 등장 순서가 아니라 실제 중요도 기준으로 핵심 키워드 3~5개를 선정하세요. 각 키워드는 1~3단어의 명사(구)로 작성하세요.

imageOrDiagramDescription: 이 화면에 실제로 무엇이 그려져야 하는지 이 씬의 구체적인 내용을 바탕으로 서술하세요. "나레이션 내용을 보여주는 이미지" 같은 일반적인 설명이 아니라, 이 씬에서 다루는 실제 대상·개념·수치를 직접 언급하며 무엇을 어떻게 시각화할지 구체적으로 쓰세요.

objectPlacement: 화면 안의 요소들이 정확히 어디에 배치되는지 구체적으로 쓰세요(예: "인물은 화면 좌측 1/3, 그래프는 우측 2/3", "중심 개념 '배출권 ETF'는 중앙, 관련 개념 3개는 그 주위에 방사형 배치"). 좌/우/상/하 등 방향을 명시하면 목업과 이미지 생성에 그대로 반영됩니다.

layoutElements: objectPlacement에서 서술한 배치를 3~6개의 (label, position) 쌍으로 압축하세요. label은 화면에 실제로 보이는 요소 이름(예: "배출권 ETF 카드", "인물", "핵심 문구"), position은 반드시 다음 9개 중 하나로만 선택하세요: top-left, top, top-right, left, center, right, bottom-left, bottom, bottom-right. 이 값은 코드가 기계적으로 렌더링할 때 쓰이므로 objectPlacement 서술과 반드시 일치해야 합니다.

presenterPosition: 이 화면에 아나운서(발표자)가 등장한다면 어디에 배치할지 반드시 다음 4개 중 하나로 선택하세요: left, right, center, full. 방금 정한 objectPlacement/layoutElements와 겹치지 않게 — 다른 시각 요소가 이미 차지한 자리를 피해서 정하세요.${presenterContinuityNote}

JSON으로만 응답하세요: {"screenType": string, "recommendedLayout": string, "rationale": string, "caption": string, "keywords": string[], "imageOrDiagramDescription": string, "objectPlacement": string, "layoutElements": {"label": string, "position": string}[], "presenterPosition": string}`;

    const raw = await client.complete(
      [
        { role: "system", content: "당신은 이러닝 스토리보드 화면 설계 전문가입니다." },
        { role: "user", content: prompt },
      ],
      { jsonMode: true, model: DEEPSEEK_MODELS.flash, signal }
    );

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(`AI 응답이 유효한 JSON이 아닙니다 (scene: ${scene.id})`);
    }

    if (!isScreenTypeAssignment(parsed)) {
      throw new Error(
        `AI 응답 형식이 올바르지 않습니다 (scene: ${scene.id}, screenType/recommendedLayout/rationale/caption/keywords/imageOrDiagramDescription/objectPlacement 필드 필요)`
      );
    }

    const assignment: ScreenTypeAssignment = {
      ...parsed,
      layoutElements: sanitizeLayoutElements((parsed as { layoutElements?: unknown }).layoutElements),
      presenterPosition: sanitizePresenterPosition(
        (parsed as { presenterPosition?: unknown }).presenterPosition,
        (parsed as ScreenTypeAssignment).screenType
      ),
    };
    result[scene.id] = assignment;
    await onProgress?.(scene.id, i, scenes.length, assignment);
  }

  return result;
}
