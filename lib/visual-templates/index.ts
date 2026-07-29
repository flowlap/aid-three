import type { Scene } from "../pipeline/splitScenes";
import type { ScreenTypeAssignment } from "../pipeline/selectScreenTypes";
import type { VisualDesign } from "../pipeline/designVisuals";

/**
 * The 10 structured screen types this app can lay out purely in code.
 * `selectScreenTypes` (AI, flash model) must choose one of these exact labels —
 * `computeVisualDesign` looks the label up verbatim, with a generic fallback
 * for anything that doesn't match (e.g. a stale AI response from before this list changed).
 */
export const SCREEN_TYPE_OPTIONS = [
  "텍스트 강조형",
  "인물 등장형",
  "이미지 설명형",
  "표/그래프형",
  "절차 애니메이션형",
  "비교 대조형",
  "타임라인형",
  "인용/사례형",
  "체크리스트형",
  "요약/정리형",
] as const;

export type ScreenTypeOption = (typeof SCREEN_TYPE_OPTIONS)[number];

const STOPWORDS = new Set([
  "그리고", "그러나", "하지만", "또한", "이번", "입니다", "합니다", "있습니다",
  "때문에", "위해", "통해", "대한", "에서", "으로", "이런", "저런", "그런", "것을", "것은",
]);

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
 * The template body/keywords are computed locally (no AI call here), but
 * `caption` is passed straight through from `screenType.caption` — an
 * AI-written summary from selectScreenTypes, not a local truncation, so it
 * never carries an ellipsis.
 */
export function computeVisualDesign(scene: Scene, screenType: ScreenTypeAssignment): VisualDesign {
  const bodyFn = TEMPLATE_BODIES[screenType.screenType as ScreenTypeOption] ?? DEFAULT_BODY;
  const body = bodyFn(scene);
  return {
    caption: screenType.caption?.trim() || scene.narrationText,
    keywords: extractKeywords(scene.narrationText),
    imageOrDiagramDescription: body.imageOrDiagramDescription,
    objectPlacement: body.objectPlacement,
    appearanceOrder: body.appearanceOrder,
    productionNotes: withRationale(body.productionNotes, screenType),
  };
}
