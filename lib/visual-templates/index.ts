import type { Scene } from "../pipeline/splitScenes";
import type { ScreenTypeAssignment } from "../pipeline/selectScreenTypes";
import type { VisualDesign } from "../pipeline/designVisuals";

/**
 * The structured screen types this app can lay out purely in code.
 * `selectScreenTypes` (AI, flash model) must choose one of these exact labels —
 * `computeVisualDesign` looks the label up verbatim, with a generic fallback
 * for anything that doesn't match (e.g. a stale AI response from before this list changed).
 *
 * The roster mixes classic e-learning/instructional-design patterns (체크리스트형,
 * 절차 애니메이션형, 요약/정리형) with broadcast/motion-graphics conventions
 * (간지/타이틀형 title cards, 인용/사례형 lower-third-style quote cards, 타임라인형)
 * and interactive-learning patterns (질문/퀴즈형). See docs/reference/screen-types.md
 * for the full rationale and detailed guidance per type — SCREEN_TYPE_INFO below is
 * the condensed version fed to the AI prompt.
 */
export const SCREEN_TYPE_OPTIONS = [
  "간지/타이틀형",
  "텍스트 강조형",
  "인물 등장형",
  "이미지 설명형",
  "표/그래프형",
  "인포그래픽형",
  "절차 애니메이션형",
  "비교 대조형",
  "타임라인형",
  "용어 정의형",
  "질문/퀴즈형",
  "인용/사례형",
  "체크리스트형",
  "요약/정리형",
] as const;

export type ScreenTypeOption = (typeof SCREEN_TYPE_OPTIONS)[number];

/**
 * Short descriptions handed to the AI in selectScreenTypes' prompt (and mirrored,
 * with more detail, in docs/reference/screen-types.md for humans). Keeping this as
 * the single source the prompt reads from means the AI and the docs can't drift apart.
 */
export const SCREEN_TYPE_INFO: Record<ScreenTypeOption, string> = {
  "간지/타이틀형":
    "챕터/섹션 제목만 담은 순수 구분 화면(간지). 나레이션이 '학습 개요', '헤드라인'처럼 부연 설명 없이 제목/구획명뿐일 때 선택. 요약/정리형(내용 리캡)이나 텍스트 강조형(내용이 있는 강조 문구)과 혼동하지 말 것 — 이 유형은 내용이 아니라 표지 역할.",
  "텍스트 강조형": "핵심 문구·개념 하나를 화면 전체에 크게 강조. 짧고 임팩트 있는 한 문장을 전달할 때.",
  "인물 등장형": "강사 또는 캐릭터가 등장해 설명하는 구도. 도입부, 친근한 전환, 사람 중심 설명에.",
  "이미지 설명형": "단일 이미지와 캡션으로 나레이션이 가리키는 구체적 대상을 시각화할 때.",
  "표/그래프형": "수치 데이터 비교. 통계, 수량, 추이 등 숫자가 중심일 때.",
  "인포그래픽형":
    "개념 간 관계·구조를 나타내는 다이어그램(허브-스포크, 계층 구조, 분류 트리 등). 순서가 있는 절차(절차 애니메이션형)나 수치 비교(표/그래프형)가 아니라, '무엇이 무엇과 어떻게 연결/포함되는지' 관계를 설명할 때.",
  "절차 애니메이션형": "순차적 단계나 프로세스. '먼저 ~하고 그다음 ~한다'처럼 순서가 있는 설명에.",
  "비교 대조형": "두 대상을 좌우로 나눠 대비. 'A와 B의 차이'를 설명할 때.",
  "타임라인형": "시간 순서에 따른 사건·변화 나열. 연혁, 히스토리, 발전 과정에.",
  "용어 정의형":
    "특정 용어나 개념을 소개하고 뜻을 설명하는 사전식 카드. '~란 무엇인가', '~는 ~를 뜻한다'처럼 용어 정의가 나레이션의 핵심일 때.",
  "질문/퀴즈형":
    "학습자에게 질문을 던지거나 간단한 퀴즈/자가 점검을 제시하는 화면. 나레이션이 반문형 질문이거나 학습자의 참여·생각을 유도할 때.",
  "인용/사례형": "인용구 또는 실제 사례를 카드형으로 강조. 발화 인용, 케이스 스터디에.",
  "체크리스트형": "항목을 목록으로 나열. 준수사항, 준비물, 요건 목록에.",
  "요약/정리형": "챕터·섹션을 마무리하며 핵심 포인트를 정리. 앞서 다룬 내용의 리캡에 (간지/타이틀형과 달리 실제 내용 요약을 담음).",
};

const STOPWORDS = new Set([
  "그리고", "그러나", "하지만", "또한", "이번", "입니다", "합니다", "있습니다",
  "때문에", "위해", "통해", "대한", "에서", "으로", "이런", "저런", "그런", "것을", "것은",
]);

/**
 * Local, position-based fallback used only when the AI didn't supply
 * `screenType.keywords` (e.g. hand-constructed data, very old projects).
 * The real, production path gets keywords from the AI in selectScreenTypes,
 * which reads the full narration and picks by importance rather than by
 * first appearance — this function can't do that since it has no way to
 * judge importance, only order.
 */
function extractKeywords(text: string, count = 3): string[] {
  const words = text
    .replace(/[.,!?"'()[\]]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w));
  const seen = new Set<string>();
  const result: string[] = [];
  for (const w of words) {
    if (!seen.has(w)) {
      seen.add(w);
      result.push(w);
    }
    if (result.length >= count) break;
  }
  return result;
}

function withRationale(note: string, screenType: ScreenTypeAssignment): string {
  return screenType.rationale ? `${note} (AI 근거: ${screenType.rationale})` : note;
}

type TemplateBody = Pick<VisualDesign, "imageOrDiagramDescription" | "objectPlacement" | "appearanceOrder" | "productionNotes">;

const TEMPLATE_BODIES: Record<ScreenTypeOption, (scene: Scene) => TemplateBody> = {
  "간지/타이틀형": () => ({
    imageOrDiagramDescription: "챕터/섹션 제목만 크게 보여주는 구분 화면(간지). 본문 내용 없음",
    objectPlacement: "화면 중앙, 제목 위/아래에 얇은 구분선 또는 장식 요소만",
    appearanceOrder: ["배경", "구분선", "제목"],
    productionNotes: "이전 화면과의 톤 전환을 알리는 짧은 정적 화면으로, 다음 내용에 대한 기대감만 형성",
  }),
  "텍스트 강조형": () => ({
    imageOrDiagramDescription: "핵심 문구를 화면 중앙에 큰 타이포그래피로 강조 표시",
    objectPlacement: "중앙 정렬, 여백 넉넉하게",
    appearanceOrder: ["배경", "핵심 문구", "포인트 강조 효과"],
    productionNotes: "핵심 키워드는 색상 또는 굵기로 강조 처리",
  }),
  "인물 등장형": () => ({
    imageOrDiagramDescription: "강사 또는 캐릭터가 화면에 등장하여 설명하는 구도",
    objectPlacement: "인물은 화면 좌측 또는 우측 1/3 지점, 텍스트는 반대쪽",
    appearanceOrder: ["배경", "인물", "설명 텍스트"],
    productionNotes: "인물의 표정과 제스처로 도입/전환의 느낌을 전달",
  }),
  "이미지 설명형": () => ({
    imageOrDiagramDescription: "나레이션 내용을 설명하는 단일 이미지와 캡션",
    objectPlacement: "이미지 중앙 배치, 캡션은 하단",
    appearanceOrder: ["이미지", "캡션 텍스트"],
    productionNotes: "이미지는 나레이션 핵심 대상을 직접적으로 시각화",
  }),
  "표/그래프형": () => ({
    imageOrDiagramDescription: "나레이션에서 언급된 항목을 비교하는 표 또는 그래프",
    objectPlacement: "표/그래프는 화면 중앙, 제목은 상단",
    appearanceOrder: ["제목", "표/그래프", "범례"],
    productionNotes: "데이터 항목 수에 맞춰 표 또는 막대/원형 그래프 중 적합한 형태 선택",
  }),
  "인포그래픽형": () => ({
    imageOrDiagramDescription: "개념 간 관계·구조를 보여주는 다이어그램(허브-스포크 또는 계층 구조)",
    objectPlacement: "중심 개념은 화면 중앙, 관련 개념들은 주위에 방사형 또는 트리 형태로 배치",
    appearanceOrder: ["중심 개념", "연결선", "주변 개념들"],
    productionNotes: "개념 사이의 관계(포함/연결/파생)를 선 또는 화살표로 명확히 표현",
  }),
  "절차 애니메이션형": () => ({
    imageOrDiagramDescription: "단계별 절차를 순서대로 보여주는 애니메이션 다이어그램",
    objectPlacement: "좌에서 우로 또는 위에서 아래로 순차 배치",
    appearanceOrder: ["1단계", "2단계", "다음 단계(반복)"],
    productionNotes: "각 단계는 이전 단계가 사라지거나 축소된 뒤 다음 단계 등장",
  }),
  "비교 대조형": () => ({
    imageOrDiagramDescription: "화면을 좌우로 분할하여 두 대상을 나란히 비교",
    objectPlacement: "좌측/우측 2분할, 중앙에 구분선 또는 VS 표시",
    appearanceOrder: ["좌측 항목", "우측 항목", "비교 포인트"],
    productionNotes: "대비되는 색상으로 두 영역을 구분",
  }),
  "타임라인형": () => ({
    imageOrDiagramDescription: "시간 순서에 따라 사건/단계를 나열하는 타임라인",
    objectPlacement: "화면 하단 또는 중앙에 가로 타임라인, 각 포인트에 라벨",
    appearanceOrder: ["타임라인 축", "시점별 포인트", "설명 텍스트"],
    productionNotes: "현재 언급 중인 시점을 강조 표시",
  }),
  "용어 정의형": () => ({
    imageOrDiagramDescription: "용어와 그 정의를 함께 보여주는 사전식 카드",
    objectPlacement: "용어는 상단에 크게, 정의 문장은 그 아래 카드 형태로",
    appearanceOrder: ["용어", "구분선", "정의 문장"],
    productionNotes: "용어는 강조 색상, 정의 문장은 차분한 본문 스타일로 대비",
  }),
  "질문/퀴즈형": () => ({
    imageOrDiagramDescription: "질문 또는 퀴즈 문항을 제시하는 화면",
    objectPlacement: "질문은 화면 중앙 상단, 보기/선택지가 있다면 그 아래 목록",
    appearanceOrder: ["물음표/퀴즈 아이콘", "질문 문구", "보기(있는 경우)"],
    productionNotes: "학습자가 잠시 생각할 여유를 주는 정적 화면, 정답은 다음 화면에서 공개",
  }),
  "인용/사례형": () => ({
    imageOrDiagramDescription: "인용구 또는 사례를 강조하는 카드형 레이아웃",
    objectPlacement: "인용구는 화면 중앙, 출처/맥락은 하단 소형 텍스트",
    appearanceOrder: ["인용 부호", "인용/사례 텍스트", "출처"],
    productionNotes: "인용구는 큰 따옴표 등 시각적 장치로 구분",
  }),
  "체크리스트형": () => ({
    imageOrDiagramDescription: "항목을 체크리스트 형태로 나열",
    objectPlacement: "좌측 정렬 리스트, 각 항목 앞에 체크 아이콘",
    appearanceOrder: ["제목", "항목 1", "항목 2"],
    productionNotes: "항목은 순차적으로 하나씩 나타나도록 구성",
  }),
  "요약/정리형": () => ({
    imageOrDiagramDescription: "챕터 내용을 요약하는 핵심 포인트 정리 화면",
    objectPlacement: "화면 중앙에 요약 포인트를 목록으로 배치",
    appearanceOrder: ["제목(정리)", "핵심 포인트 목록"],
    productionNotes: "이전 화면들에서 다룬 핵심 키워드를 재사용해 연결감 부여",
  }),
};

const DEFAULT_BODY: (scene: Scene) => TemplateBody = TEMPLATE_BODIES["이미지 설명형"];

/**
 * Derives a full VisualDesign from a scene + its AI-selected screen type.
 * The template body is computed locally (no AI call here), but `caption`
 * and `keywords` are passed straight through from the AI's own
 * selectScreenTypes response — a written summary and importance-ranked
 * keyword list, not a local truncation/first-occurrence guess — falling
 * back to local heuristics only if the AI didn't supply them.
 */
export function computeVisualDesign(scene: Scene, screenType: ScreenTypeAssignment): VisualDesign {
  const bodyFn = TEMPLATE_BODIES[screenType.screenType as ScreenTypeOption] ?? DEFAULT_BODY;
  const body = bodyFn(scene);
  return {
    caption: screenType.caption?.trim() || scene.narrationText,
    keywords: screenType.keywords?.length ? screenType.keywords : extractKeywords(scene.narrationText),
    // The AI now writes these per-scene (selectScreenTypes) instead of only
    // the generic per-screenType template text — prefer its version, and
    // fall back to the template only for older data that predates this
    // (existingAssignments reused from disk, or a stale AI response).
    imageOrDiagramDescription: screenType.imageOrDiagramDescription?.trim() || body.imageOrDiagramDescription,
    objectPlacement: screenType.objectPlacement?.trim() || body.objectPlacement,
    layoutElements: screenType.layoutElements,
    presenterPosition: screenType.presenterPosition,
    appearanceOrder: body.appearanceOrder,
    productionNotes: withRationale(body.productionNotes, screenType),
  };
}

/** Screen types repetitive enough in a typical deck to benefit from rotating mockup layouts (see ScreenMockup). */
export const MOCKUP_VARIANT_COUNTS: Partial<Record<ScreenTypeOption, number>> = {
  "간지/타이틀형": 3,
  "텍스트 강조형": 3,
};

/**
 * Screen types whose entire point is the on-screen caption text (a title
 * card, a definition, a pull quote...) rather than an illustration. The AI
 * image prompt (see generateSceneImage.ts) normally tells the model not to
 * render any text at all — for these types it does the opposite and asks
 * the model to render `design.caption` directly, since a textless "간지/타이틀형"
 * background defeats the entire purpose of the screen.
 */
export const TEXT_FORWARD_SCREEN_TYPES: ReadonlySet<string> = new Set<ScreenTypeOption>([
  "간지/타이틀형",
  "텍스트 강조형",
  "용어 정의형",
  "질문/퀴즈형",
  "인용/사례형",
  "요약/정리형",
]);

/**
 * Screen types that are pure transitions (a chapter divider, a title card —
 * no substantive content of their own) rather than a real explanatory
 * screen. The "강사 표시" toggle (generateSceneImage.ts) skips these even
 * when it's on for the rest of the project, since a presenter appearing on
 * a bare divider screen looks out of place.
 */
export const PRESENTER_EXCLUDED_SCREEN_TYPES: ReadonlySet<string> = new Set<ScreenTypeOption>(["간지/타이틀형"]);

/**
 * For each scene, computes how many times its screenType has already
 * appeared among the scenes so far (0-based), so ScreenMockup can rotate
 * through a few layout variants instead of rendering every occurrence of a
 * repeat-prone type (title cards, emphasis screens) identically. Consecutive
 * same-type scenes always land on different variants.
 */
/**
 * Reads a simple left/right cue out of the AI-written `objectPlacement` free
 * text (e.g. "인물은 화면 좌측 1/3, 텍스트는 반대쪽") so ScreenMockup's 인물 등장형
 * layout can at least honor the clearest, most common instruction instead of
 * always defaulting to left. Looks in a window right after the "인물"
 * mention so "그래프는 우측" elsewhere in the same sentence doesn't get
 * misread as the person's side.
 */
export function personGoesOnRight(placement: string): boolean {
  const personIdx = placement.indexOf("인물");
  const window = personIdx >= 0 ? placement.slice(personIdx, personIdx + 20) : placement;
  const firstIndexOf = (keywords: string[]) =>
    Math.min(...keywords.map((k) => (window.includes(k) ? window.indexOf(k) : Infinity)));
  return firstIndexOf(["우측", "오른쪽"]) < firstIndexOf(["좌측", "왼쪽"]);
}

export function computeMockupVariantIndexes(
  scenes: Scene[],
  screenTypes: Record<string, ScreenTypeAssignment | undefined>
): Record<string, number> {
  const counters: Record<string, number> = {};
  const result: Record<string, number> = {};
  for (const scene of scenes) {
    const type = screenTypes[scene.id]?.screenType;
    if (!type) continue;
    const variantCount = MOCKUP_VARIANT_COUNTS[type as ScreenTypeOption];
    if (!variantCount) continue;
    const occurrence = counters[type] ?? 0;
    result[scene.id] = occurrence % variantCount;
    counters[type] = occurrence + 1;
  }
  return result;
}
