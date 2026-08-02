import type { OpenAiImageClient, OpenAiImageOptions } from "../ai/openaiImageClient";
import { TEXT_FORWARD_SCREEN_TYPES, PRESENTER_EXCLUDED_SCREEN_TYPES } from "../visual-templates";
import type { Scene } from "./splitScenes";
import type { VisualDesign, PresenterPosition } from "./designVisuals";

/** Reference info from another scene in the same story arc — see BuildImagePromptOptions.relatedScenes. */
export interface RelatedSceneImageContext {
  sceneId: string;
  caption: string;
  imageOrDiagramDescription: string;
}

export interface BuildImagePromptOptions {
  /** Selected screen type for this scene — switches on/off the "render this caption as text" instruction. */
  screenType?: string;
  /**
   * Project-wide style guide (character, color palette, background, concept...)
   * from the "공통 프롬프트" field in the images step, prepended to every
   * scene's prompt so generated images share a consistent tone and manner.
   */
  commonPrompt?: string;
  /**
   * Project-wide "아나운서 표시" toggle from the images step. When on, most
   * scenes' images should include a presenter/announcer. Skipped for pure
   * transition screens regardless of this flag — see
   * PRESENTER_EXCLUDED_SCREEN_TYPES.
   */
  presenterEnabled?: boolean;
  /**
   * The specific shot decided during screen design (selectScreenTypes),
   * chosen jointly with objectPlacement and varied against neighboring
   * scenes there. When present, the image prompt names this exact position
   * instead of leaving the choice to this one independent image call —
   * asking each call to freely pick among 4 options with no cross-scene
   * memory consistently defaulted to the same position every time.
   * Undefined falls back to the old "pick whichever fits" instruction (e.g.
   * older screen-design data from before this field existed).
   */
  presenterPosition?: PresenterPosition;
  /**
   * Other scenes in the same story arc (Scene.relatedSceneIds), passed as
   * reference so this scene's image can stay visually consistent with them
   * (e.g. reusing the same icon/color-coding for a concept introduced in an
   * earlier related scene) instead of being generated in isolation.
   */
  relatedScenes?: RelatedSceneImageContext[];
}

const PRESENTER_POSITION_LABEL: Record<PresenterPosition, string> = {
  left: "좌측 등장(화면 좌측에 상반신, 우측에 시각 자료)",
  right: "우측 등장(화면 우측에 상반신, 좌측에 시각 자료)",
  center: "중앙 등장(화면 중앙에 상반신, 시각 자료는 배경/주변)",
  full: "풀샷(아나운서 전신이 화면에 크게 등장, 시각 자료는 최소화)",
};

/**
 * Appended when the project-wide "아나운서 표시" toggle is on. Prefers a
 * pre-decided `presenterPosition` (named explicitly, no choice left to this
 * one independent call) over the older "pick whichever of the 4 fits"
 * phrasing, which in practice converged on the same position every time
 * with no cross-scene memory to vary it.
 */
function buildPresenterInstruction(position?: PresenterPosition): string {
  if (position) {
    return `이 화면에는 아나운서(발표자)가 ${PRESENTER_POSITION_LABEL[position]} 형태로 등장해야 합니다. 전문적이고 신뢰감 있는 모습으로, 위 화면 구성 명세와 자연스럽게 어우러지게 배치하세요.`;
  }
  return "이 화면에는 아나운서(발표자)가 등장해야 합니다. 화면 내용과 구도에 가장 잘 어울리는 형태를 다음 4가지 중에서 골라 반영하세요: 좌측 등장(화면 좌측에 상반신, 우측에 시각 자료), 우측 등장(화면 우측에 상반신, 좌측에 시각 자료), 중앙 등장(화면 중앙에 상반신, 시각 자료는 배경/주변), 풀샷(아나운서 전신이 화면에 크게 등장, 시각 자료는 최소화). 위 화면 구성 명세와 자연스럽게 어우러지는 형태를 선택하고, 아나운서는 전문적이고 신뢰감 있는 모습으로 표현하세요.";
}

/**
 * Applies to every scene regardless of screen type — the overall "shot"
 * should read as a frame from a real YouTube/TV-style educational video
 * (broadcast graphics, lower-thirds, on-screen overlays), not a flat
 * illustration. Purpose is educational; format is ordinary video content.
 */
const PRODUCTION_STYLE_INSTRUCTION =
  "이 이미지는 유튜브 강의 영상이나 TV 교육 프로그램에서 흔히 볼 수 있는 실제 영상 콘텐츠의 한 장면처럼 보여야 합니다. 목적은 교육이지만 형식은 일반 방송/영상 콘텐츠와 같아야 하며, 단순한 플랫 삽화보다는 화면 자막바(로어써드), 인포그래픽 오버레이, 스튜디오 그래픽 같은 실제 영상 화면 구성 요소를 활용하세요.";

const NO_TEXT_INSTRUCTION = "실제 사람 얼굴이나 텍스트 렌더링 없이, 설명하는 개념을 시각적으로 표현하세요.";

function buildTextInstruction(scene: Scene, design: VisualDesign): string {
  return `이 화면은 화면 자막이 핵심 요소입니다. 다음 화면 자막과 나레이션 내용을 적절히 섞어서, 완결된 문장이 아닌 명사형 또는 짧은 핵심 문구(6~12자 내외)로 요약하여 이미지 안에 크고 읽기 쉬운 한글 타이포그래피로 반드시 포함해서 그려주세요. 화면 자막: "${design.caption}" / 나레이션: "${scene.narrationText}". 문구가 잘리거나 왜곡되지 않게, 배경과 대비되는 색으로 배치하세요.`;
}

export function buildImagePrompt(scene: Scene, design: VisualDesign, promptOptions?: BuildImagePromptOptions): string {
  const isTextForward = promptOptions?.screenType ? TEXT_FORWARD_SCREEN_TYPES.has(promptOptions.screenType) : false;
  const textInstruction = isTextForward ? buildTextInstruction(scene, design) : NO_TEXT_INSTRUCTION;
  const styleGuide = promptOptions?.commonPrompt?.trim()
    ? `\n\n공통 스타일 가이드(모든 화면에 일관되게 적용):\n${promptOptions.commonPrompt.trim()}`
    : "";
  const isPresenterExcluded = promptOptions?.screenType ? PRESENTER_EXCLUDED_SCREEN_TYPES.has(promptOptions.screenType) : false;
  const presenterInstruction =
    promptOptions?.presenterEnabled && !isPresenterExcluded
      ? `\n\n${buildPresenterInstruction(promptOptions.presenterPosition)}`
      : "";
  const relatedScenes = promptOptions?.relatedScenes ?? [];
  const relatedContext =
    relatedScenes.length > 0
      ? `\n\n관련 씬 참고자료(같은 이야기 흐름 — 시각적 일관성 참고용, 이 화면 자체를 대체하지 마세요):\n${relatedScenes
          .map((r) => `- [${r.sceneId}] 자막: "${r.caption}" / 화면: ${r.imageOrDiagramDescription}`)
          .join("\n")}`
      : "";

  return `이러닝 교육용 스토리보드 화면 이미지를 생성하세요.

다음 화면 구성 명세를 무엇보다 우선해서 정확히 따르세요 — 화면설계 단계에서 이 씬을 위해 구체적으로 작성한 지시입니다:
- 무엇을 그릴지: ${design.imageOrDiagramDescription}
- 요소 배치: ${design.objectPlacement}

${PRODUCTION_STYLE_INSTRUCTION} ${textInstruction}${styleGuide}${presenterInstruction}${relatedContext}

관련 나레이션(맥락 참고용 — 화면 구성 명세와 배치를 우선하고, 나레이션 문장을 그대로 옮기지 마세요): ${scene.narrationText}`;
}

/** Resolves a scene's `relatedSceneIds` into the compact context generateSceneImage needs, from an already-loaded visualDesigns map. */
export function buildRelatedScenesContext(
  scene: Scene,
  visualDesigns: Record<string, VisualDesign>
): RelatedSceneImageContext[] {
  return (scene.relatedSceneIds ?? [])
    .map((sceneId) => {
      const design = visualDesigns[sceneId];
      if (!design) return null;
      return { sceneId, caption: design.caption, imageOrDiagramDescription: design.imageOrDiagramDescription };
    })
    .filter((entry): entry is RelatedSceneImageContext => entry !== null);
}

export async function generateSceneImage(
  client: OpenAiImageClient,
  scene: Scene,
  design: VisualDesign,
  promptOptions?: BuildImagePromptOptions,
  clientOptions?: OpenAiImageOptions
): Promise<Buffer> {
  return client.generateImage(buildImagePrompt(scene, design, promptOptions), clientOptions);
}
