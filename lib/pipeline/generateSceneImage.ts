import { ImageApiError, type ImageClient, type ImageGenerateOptions } from "../ai/image/types";
import { TEXT_FORWARD_SCREEN_TYPES, PRESENTER_EXCLUDED_SCREEN_TYPES } from "../visual-templates";
import {
  IMAGE_GENERATION_MAX_RETRIES,
  IMAGE_GENERATION_RETRY_DELAY_MS,
  IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES,
  IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS,
} from "./imageGenerationConfig";
import type { Scene } from "./splitScenes";
import type { VisualDesign, PresenterPosition } from "./designVisuals";
import type { SceneSequenceContext } from "./selectScreenTypes";
import type { ShotType, SequenceCameraPlanEntry, OverlayType, SequenceOverlayEntry } from "./sequenceTypes";

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
   * Project-wide "강사 표시" toggle from the images step. When on, most
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
  /**
   * Project-wide "배경 고정" toggle. When on (and a background reference
   * image was generated/uploaded), every scene reuses that same background
   * instead of drawing a new one, so the deck reads as one consistent set
   * instead of a different background per scene.
   */
  backgroundFixed?: boolean;
  /**
   * Announcer gender, shown only in the text instruction — the reference
   * image itself (when present) is what actually pins down the exact
   * appearance; this is a fallback hint for when no reference image exists
   * yet, or as reinforcement alongside one.
   */
  presenterGender?: "male" | "female";
  /** Whether a presenter reference image is being attached to this call (see SceneReferenceImages) — switches the instruction from "pick a look" to "match this exact person". */
  hasPresenterReferenceImage?: boolean;
  /**
   * Whether a "톤앤매너 기준" style reference image (see SceneReferenceImages.style)
   * is being attached to this call — a project-wide sample image (no specific
   * scene content) generated once so every scene's independent AI call has a
   * visual, not just textual, anchor for color/illustration style/mood.
   */
  hasStyleReferenceImage?: boolean;
  /**
   * Whether the model may render the screen caption as in-image typography
   * for text-forward screen types. Defaults to true (existing OpenAI
   * behavior). The local FLUX.2 Klein engine passes false — captions are
   * placed as PPTX text at export time instead of baked into the image, so
   * every scene gets the plain NO_TEXT_INSTRUCTION regardless of screen type.
   */
  allowTextInImage?: boolean;
  /**
   * One-off extra instruction supplied only when regenerating this specific
   * scene from the images step's per-scene panel (see ImagesEditor.tsx) —
   * never persisted, unlike every other option here. Placed right after the
   * design spec and before the common style guide so a "just for this retry"
   * instruction can override the project-wide prompt when they conflict.
   */
  extraPrompt?: string;
  /**
   * Set internally by generateSceneImage() from whether
   * referenceImages.master was provided — mirrors
   * hasPresenterReferenceImage/hasStyleReferenceImage. Not meant to be set
   * directly by callers.
   */
  hasMasterReferenceImage?: boolean;
  /**
   * Sequence-mode-only textual context (continuity, camera shot, overlays
   * planned for this scene) — see SceneSequenceContext (selectScreenTypes.ts).
   * Presence of this field is what switches buildImagePrompt into "sequence
   * mode": it forces NO_TEXT_INSTRUCTION regardless of screen type (overlays
   * are composited later, see Task 9), adds a continuity/master-image
   * instruction, an optional camera-framing instruction, and an unconditional
   * overlay-exclusion instruction. Must be completely absent/undefined for
   * every scene-mode call — scene-mode's prompt output stays byte-identical
   * to before this field existed.
   */
  sequenceImageContext?: SceneSequenceContext;
  /**
   * Sequence mode only — how this scene's planned overlays (labels, arrows,
   * highlights, diagrams, charts) should be handled in the prompt. "exclude"
   * (the default when omitted) keeps the existing behavior: the model is told
   * not to draw any of them, because a separate deterministic renderer
   * composites them afterward (bakeSequenceSceneStill). "bake" is for AI-mode
   * sequence projects with no post-hoc renderer at all — the overlay content
   * is folded directly into the prompt so the model draws it into the image,
   * and the camera-framing pan/zoom margin instruction is suppressed since
   * AI-mode scenes always render as a static video frame.
   */
  sequenceOverlayRenderMode?: "exclude" | "bake";
}

/** Reference images attached to a single generateSceneImage(WithRetry) call — forwarded to the client as multi-image /images/edits input. */
export interface SceneReferenceImages {
  background?: Buffer;
  presenter?: Buffer;
  style?: Buffer;
  /** Sequence master visual plate (sequence mode only) — the shared background/location image this scene's shot should stay continuous with. */
  master?: Buffer;
}

const PRESENTER_POSITION_LABEL: Record<PresenterPosition, string> = {
  left: "좌측 등장(화면 좌측에 상반신, 우측에 시각 자료)",
  right: "우측 등장(화면 우측에 상반신, 좌측에 시각 자료)",
  center: "중앙 등장(화면 중앙에 상반신, 시각 자료는 배경/주변)",
  full: "풀샷(강사 전신이 화면에 크게 등장, 시각 자료는 최소화)",
};

const PRESENTER_GENDER_LABEL: Record<"male" | "female", string> = {
  male: "남성",
  female: "여성",
};

/**
 * Appended after every presenter instruction below regardless of position
 * ("full shot" included) — the announcer is a supporting element, not the
 * focus, so it must stay small and out of the way of the actual screen
 * content (visual aids, captions) even when the chosen position/composition
 * text would otherwise suggest a large, dominant appearance.
 */
const PRESENTER_SIZE_CONSTRAINT =
  "단, 등장 형태(좌측/우측/중앙/풀샷)와 무관하게 강사는 화면 전체 면적의 약 20% 정도를 차지하도록 배치하세요 — 지나치게 작아서 잘 보이지 않거나, 반대로 화면을 압도할 만큼 크게 등장해서는 안 됩니다. 화면의 주인공은 시각 자료이며 강사는 보조적인 역할입니다.";

/**
 * Appended when the project-wide "강사 표시" toggle is on. Prefers a
 * pre-decided `presenterPosition` (named explicitly, no choice left to this
 * one independent call) over the older "pick whichever of the 4 fits"
 * phrasing, which in practice converged on the same position every time
 * with no cross-scene memory to vary it. When a presenter reference image is
 * attached, the instruction shifts from "pick a look" to "match this exact
 * person" — that reference image (not this text) is what actually keeps the
 * announcer's face/outfit consistent across scenes.
 */
/**
 * Appended only when a presenter reference image is attached — locks two
 * things a plain "match this person" instruction doesn't cover: (1) items
 * like glasses or a microphone must not be added or removed relative to the
 * reference, even though pose/gesture/expression are free to vary; (2) when
 * the reference is a real photo, the presenter's likeness itself must stay
 * photorealistic even if the project's common style guide asks for flat
 * illustration — that conflict (DEFAULT_IMAGE_COMMON_PROMPT in
 * commonPromptDefaults.ts explicitly requests flat-illustration style and
 * forbids real faces) was the cause of photo references drifting into
 * illustrated output.
 */
const PRESENTER_LIKENESS_LOCK =
  "자세, 손동작, 표정은 이 화면 내용에 맞게 자연스럽게 바꿔도 되지만, 참고 이미지에 없던 안경, 마이크, 액세서리 등을 새로 추가하거나 반대로 참고 이미지에 있던 것을 빼지 마세요. 또한 참고 이미지가 실사(사진) 스타일이라면, 공통 스타일 가이드가 일러스트 톤을 요구하더라도 강사 인물만큼은 예외로 실사 그대로의 화풍을 유지하고 다른 화풍(일러스트 등)으로 바꾸지 마세요. 배경이나 다른 구성 요소는 공통 스타일 가이드를 따르되, 강사 인물의 외형과 화풍만은 참고 이미지를 그대로 따르세요.";

function buildPresenterInstruction(position?: PresenterPosition, gender?: "male" | "female", hasReferenceImage?: boolean): string {
  if (hasReferenceImage) {
    const positionPhrase = position ? `${PRESENTER_POSITION_LABEL[position]} 형태로` : "화면 내용과 구도에 가장 잘 어울리는 형태로";
    return `이 화면에는 제공된 강사 참고 이미지와 동일한 인물(얼굴, 헤어스타일, 의상)이 ${positionPhrase} 등장해야 합니다. 참고 이미지 속 인물의 외형을 그대로 유지하고, 위 화면 구성 명세와 자연스럽게 어우러지게 배치하세요. ${PRESENTER_SIZE_CONSTRAINT} ${PRESENTER_LIKENESS_LOCK}`;
  }

  const genderPrefix = gender ? `${PRESENTER_GENDER_LABEL[gender]} ` : "";
  if (position) {
    return `이 화면에는 ${genderPrefix}강사(발표자)가 ${PRESENTER_POSITION_LABEL[position]} 형태로 등장해야 합니다. 전문적이고 신뢰감 있는 모습으로, 위 화면 구성 명세와 자연스럽게 어우러지게 배치하세요. ${PRESENTER_SIZE_CONSTRAINT}`;
  }
  return `이 화면에는 ${genderPrefix}강사(발표자)가 등장해야 합니다. 화면 내용과 구도에 가장 잘 어울리는 형태를 다음 4가지 중에서 골라 반영하세요: 좌측 등장(화면 좌측에 상반신, 우측에 시각 자료), 우측 등장(화면 우측에 상반신, 좌측에 시각 자료), 중앙 등장(화면 중앙에 상반신, 시각 자료는 배경/주변), 풀샷(강사 전신이 화면에 크게 등장, 시각 자료는 최소화). 위 화면 구성 명세와 자연스럽게 어우러지는 형태를 선택하고, 강사는 전문적이고 신뢰감 있는 모습으로 표현하세요. ${PRESENTER_SIZE_CONSTRAINT}`;
}

/**
 * Appended when "배경 고정" is on and a background reference image is
 * attached — tells the model to reuse that exact background rather than
 * drawing a new one, so every scene shares one consistent backdrop.
 */
const BACKGROUND_FIXED_INSTRUCTION =
  "이 화면은 제공된 배경 참고 이미지를 그대로 배경으로 사용해야 합니다. 배경 자체를 새로 그리거나 다른 배경으로 바꾸지 말고, 그 위에 이 화면의 구성 요소(자막, 아이콘, 강사 등)만 배치하세요.";

/**
 * Appended when a project-wide "톤앤매너 기준" style reference image is
 * attached — an anchor for color/illustration style/mood, not content. Told
 * explicitly not to copy the reference's specific composition/content since
 * this one sample image gets reused across every scene's independent call.
 */
const STYLE_REFERENCE_INSTRUCTION =
  "제공된 톤앤매너 기준 이미지와 동일한 색감, 일러스트 스타일, 자막바(로어써드)·아이콘·인포그래픽 등 구성 요소의 디자인 방식과 전체적인 분위기를 유지해서 그려주세요. 기준 이미지 속 자막·숫자·라벨 등 구체적인 텍스트 내용은 이 화면과 무관한 샘플 문구이니 그대로 옮기지 말고, 실제 텍스트 내용과 화면 구성은 이 화면 자체의 구성 명세를 따르세요.";

/**
 * Sequence mode, master reference image attached (see
 * SceneReferenceImages.master / BuildImagePromptOptions.hasMasterReferenceImage).
 * Distinct from BACKGROUND_FIXED_INSTRUCTION, which is about a per-project
 * fixed background toggle — this is about a sequence's shared master plate
 * (generated by generateSequenceMasterImage.ts) that every scene in the
 * sequence must stay continuous with.
 */
const MASTER_CONTINUITY_LOCK_INSTRUCTION =
  "제공된 시퀀스 마스터 배경 참고 이미지가 함께 첨부되었습니다. 이 참고 이미지의 장소·배경·조명을 그대로 유지하고, 배경 자체를 새로 그리거나 다른 배경으로 바꾸지 마세요. 그 위에 이 화면의 강사와 콘텐츠 구성 요소만 자연스럽게 추가해서 그려주세요.";

/**
 * Sequence mode, no master reference image yet (Task 8 fallback path — the
 * sequence's master image hasn't been generated, or its file is missing
 * despite masterVisual.status saying "generated"). Best-effort stand-in using
 * only the sequence's textual continuity fields, with an explicit note that
 * this may drift slightly from the sequence's other scenes since there's no
 * shared visual anchor.
 */
function buildMasterContinuityFallbackInstruction(context: SceneSequenceContext): string {
  const { continuity, masterVisualDescription } = context;
  const fixedElementsPhrase =
    continuity.fixedElements.length > 0 ? ` 고정 요소: ${continuity.fixedElements.join(", ")}.` : "";
  const doNotChangePhrase =
    continuity.doNotChange.length > 0 ? ` 절대 변경 금지: ${continuity.doNotChange.join(", ")}.` : "";
  return `이 화면이 속한 시퀀스는 아직 마스터 참고 이미지가 생성되지 않았습니다. 다음 텍스트 설명을 이 시퀀스 전체가 공유하는 장소/배경처럼 취급해서 그려주세요 — 장소: ${continuity.location}, 스타일: ${continuity.visualStyle}.${fixedElementsPhrase}${doNotChangePhrase} 마스터 비주얼 설명: ${masterVisualDescription}. 다만 이는 마스터 참고 이미지가 없는 상태에서의 최선의 대체 수단이므로, 같은 시퀀스의 다른 씬들과 배경이 미세하게 달라질 수 있습니다.`;
}

/** Translates a sequence's planned shot type into a Korean framing instruction — see SequenceCameraPlanEntry (sequenceTypes.ts). */
const SHOT_FRAMING_LABEL: Record<ShotType, string> = {
  wide: "넓은 설정샷(장면 전체를 조망하는 구도)",
  medium: "중간샷(인물과 주변 요소가 적절히 함께 보이는 구도)",
  detail: "클로즈업에 가까운 세부 묘사(핵심 요소를 확대해서 보여주는 구도)",
  "close-up": "클로즈업(피사체를 화면 가득 확대한 구도)",
};

/**
 * Sequence mode, when this scene has a planned camera entry
 * (SceneSequenceContext.camera). Beyond naming the shot framing, a non-static
 * motion instructs the model to leave extra margin in the direction the
 * camera will move — Task 9's renderer crops/pans across this same source
 * image, so it needs margin to work with.
 */
function buildCameraFramingInstruction(camera: SequenceCameraPlanEntry): string {
  const framing = SHOT_FRAMING_LABEL[camera.shot];
  let marginInstruction = "";
  if (camera.motion === "pan-left" || camera.motion === "pan-right") {
    const side = camera.motion === "pan-left" ? "왼쪽" : "오른쪽";
    marginInstruction = ` 이후 후반 작업에서 이 이미지를 가로로 팬(카메라 이동)하며 크롭할 예정이므로, 카메라가 이동해 갈 ${side} 방향에 여백을 넉넉히 남겨 주요 피사체가 화면 가장자리에 붙지 않게 구도를 잡으세요.`;
  } else if (camera.motion !== "static") {
    marginInstruction =
      " 이후 후반 작업에서 이 이미지를 서서히 확대/축소하며 크롭할 예정이므로, 주요 피사체 주변 사방에 여백을 넉넉히 남겨 구도를 잡으세요.";
  }
  return `이 화면은 ${framing}으로 그려주세요.${marginInstruction}`;
}

/**
 * Sequence mode only, unconditional whenever sequenceImageContext is present
 * — even for a scene with an empty overlays array, since the point is "never
 * bake these in for ANY sequence-mode scene", not "avoid duplicating this
 * scene's specific planned overlay". Overlays (labels, arrows, charts,
 * captions) are composited later by a separate deterministic renderer (Task
 * 9), never by the image model, in sequence mode.
 */
const SEQUENCE_OVERLAY_EXCLUSION_INSTRUCTION =
  "이 이미지에는 자막, 라벨, 화살표, 실제 숫자가 들어간 차트/그래프, 캡션 등 어떠한 텍스트나 그래픽 오버레이도 직접 그려 넣지 마세요. 이러한 요소는 이미지 생성 이후 별도의 결정론적 렌더러가 합성하며, 이미지 모델이 텍스트나 오버레이를 시도해서는 안 됩니다.";

/** Translates a sequence's overlay entry type into a Korean label — see OverlayType (sequenceTypes.ts). */
const OVERLAY_TYPE_LABEL: Record<OverlayType, string> = {
  label: "라벨(짧은 텍스트 태그)",
  "arrow-flow": "화살표/흐름 표시",
  highlight: "강조(원, 사각형 등으로 특정 부분 부각)",
  diagram: "도식(구조/관계를 보여주는 다이어그램)",
  chart: "차트/그래프(실제 수치 포함)",
};

/**
 * AI-mode sequence projects only (sequenceOverlayRenderMode === "bake") — there
 * is no post-hoc compositing renderer in this mode, so unlike
 * SEQUENCE_OVERLAY_EXCLUSION_INSTRUCTION, this tells the model to draw the
 * scene's planned overlays directly into the image as real broadcast
 * graphics. Explicitly carves out an exception to NO_TEXT_INSTRUCTION (which
 * buildImagePrompt still applies unconditionally above) for just these
 * elements, and warns about the objectFit:"cover" crop the final video frame
 * applies so labels/callouts aren't placed too close to the frame edges.
 */
function buildSequenceOverlayBakeInstruction(overlays: SequenceOverlayEntry[]): string {
  const list = overlays.map((overlay) => `- ${OVERLAY_TYPE_LABEL[overlay.type]}: ${overlay.description}`).join("\n");
  return `위에서 텍스트나 사람 얼굴을 렌더링하지 말라고 안내했지만, 다음 오버레이 요소들만은 예외로 이 이미지 안에 실제 방송 그래픽처럼 직접 그려 넣어야 합니다(별도로 합성하는 렌더러가 없습니다):\n${list}\n각 요소는 실제 유튜브 강의나 TV 교육 프로그램에서 볼 수 있는 자막바(로어써드)/인포그래픽 오버레이처럼 자연스럽게 배치하세요. 이후 화면 출력 시 이미지 가장자리가 살짝 잘릴 수 있으니, 라벨이나 콜아웃을 이미지 맨 가장자리에 붙여 배치하지 말고 안쪽 여백을 두세요.`;
}

/**
 * Applies to every scene regardless of screen type — the overall "shot"
 * should read as a frame from a real YouTube/TV-style educational video
 * (broadcast graphics, lower-thirds, on-screen overlays), not a flat
 * illustration. Purpose is educational; format is ordinary video content.
 */
export const PRODUCTION_STYLE_INSTRUCTION =
  "이 이미지는 유튜브 강의 영상이나 TV 교육 프로그램에서 흔히 볼 수 있는 실제 영상 콘텐츠의 한 장면처럼 보여야 합니다. 목적은 교육이지만 형식은 일반 방송/영상 콘텐츠와 같아야 하며, 단순한 플랫 삽화보다는 화면 자막바(로어써드), 인포그래픽 오버레이, 스튜디오 그래픽 같은 실제 영상 화면 구성 요소를 활용하세요.";

export const NO_TEXT_INSTRUCTION = "실제 사람 얼굴이나 텍스트 렌더링 없이, 설명하는 개념을 시각적으로 표현하세요.";

function buildTextInstruction(scene: Scene, design: VisualDesign): string {
  return `이 화면은 화면 자막이 핵심 요소입니다. 다음 화면 자막과 나레이션 내용을 적절히 섞어서, 완결된 문장이 아닌 명사형 또는 짧은 핵심 문구(6~12자 내외)로 요약하여 이미지 안에 크고 읽기 쉬운 한글 타이포그래피로 반드시 포함해서 그려주세요. 화면 자막: "${design.caption}" / 나레이션: "${scene.narrationText}". 문구가 잘리거나 왜곡되지 않게, 배경과 대비되는 색으로 배치하세요.`;
}

export function buildImagePrompt(scene: Scene, design: VisualDesign, promptOptions?: BuildImagePromptOptions): string {
  const isTextForward = promptOptions?.screenType ? TEXT_FORWARD_SCREEN_TYPES.has(promptOptions.screenType) : false;
  const textInstruction = promptOptions?.sequenceImageContext
    ? NO_TEXT_INSTRUCTION
    : promptOptions?.allowTextInImage === false
      ? NO_TEXT_INSTRUCTION
      : isTextForward
        ? buildTextInstruction(scene, design)
        : NO_TEXT_INSTRUCTION;
  const extraInstruction = promptOptions?.extraPrompt?.trim()
    ? `\n\n추가 수정 지시(이번 생성에서 최우선으로 반영하세요): ${promptOptions.extraPrompt.trim()}`
    : "";
  const styleGuide = promptOptions?.commonPrompt?.trim()
    ? `\n\n공통 스타일 가이드(모든 화면에 일관되게 적용):\n${promptOptions.commonPrompt.trim()}`
    : "";
  const isPresenterExcluded = promptOptions?.screenType ? PRESENTER_EXCLUDED_SCREEN_TYPES.has(promptOptions.screenType) : false;
  const presenterInstruction =
    promptOptions?.presenterEnabled && !isPresenterExcluded
      ? `\n\n${buildPresenterInstruction(promptOptions.presenterPosition, promptOptions.presenterGender, promptOptions.hasPresenterReferenceImage)}`
      : "";
  const backgroundInstruction = promptOptions?.backgroundFixed ? `\n\n${BACKGROUND_FIXED_INSTRUCTION}` : "";
  const styleReferenceInstruction = promptOptions?.hasStyleReferenceImage ? `\n\n${STYLE_REFERENCE_INSTRUCTION}` : "";
  const relatedScenes = promptOptions?.relatedScenes ?? [];
  const relatedContext =
    relatedScenes.length > 0
      ? `\n\n관련 씬 참고자료(같은 이야기 흐름 — 시각적 일관성 참고용, 이 화면 자체를 대체하지 마세요):\n${relatedScenes
          .map((r) => `- [${r.sceneId}] 자막: "${r.caption}" / 화면: ${r.imageOrDiagramDescription}`)
          .join("\n")}`
      : "";
  const sequenceImageContext = promptOptions?.sequenceImageContext;
  const sequenceContinuityInstruction = sequenceImageContext
    ? `\n\n${
        promptOptions?.hasMasterReferenceImage
          ? MASTER_CONTINUITY_LOCK_INSTRUCTION
          : buildMasterContinuityFallbackInstruction(sequenceImageContext)
      }`
    : "";
  const isOverlayBakeMode = promptOptions?.sequenceOverlayRenderMode === "bake";
  const sequenceCameraInstruction = sequenceImageContext?.camera
    ? `\n\n${buildCameraFramingInstruction(
        isOverlayBakeMode ? { ...sequenceImageContext.camera, motion: "static" } : sequenceImageContext.camera
      )}`
    : "";
  const sequenceOverlayInstruction = !sequenceImageContext
    ? ""
    : isOverlayBakeMode
      ? sequenceImageContext.overlays.length > 0
        ? `\n\n${buildSequenceOverlayBakeInstruction(sequenceImageContext.overlays)}`
        : ""
      : `\n\n${SEQUENCE_OVERLAY_EXCLUSION_INSTRUCTION}`;

  return `이러닝 교육용 스토리보드 화면 이미지를 생성하세요.

다음 화면 구성 명세를 무엇보다 우선해서 정확히 따르세요 — 화면설계 단계에서 이 씬을 위해 구체적으로 작성한 지시입니다:
- 무엇을 그릴지: ${design.imageOrDiagramDescription}
- 요소 배치: ${design.objectPlacement}

${PRODUCTION_STYLE_INSTRUCTION} ${textInstruction}${extraInstruction}${styleGuide}${styleReferenceInstruction}${backgroundInstruction}${presenterInstruction}${relatedContext}${sequenceContinuityInstruction}${sequenceCameraInstruction}${sequenceOverlayInstruction}

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
  client: ImageClient,
  scene: Scene,
  design: VisualDesign,
  promptOptions?: BuildImagePromptOptions,
  clientOptions?: ImageGenerateOptions,
  referenceImages?: SceneReferenceImages
): Promise<Buffer> {
  const effectivePromptOptions: BuildImagePromptOptions = {
    ...promptOptions,
    hasPresenterReferenceImage: Boolean(referenceImages?.presenter),
    hasStyleReferenceImage: Boolean(referenceImages?.style),
    hasMasterReferenceImage: Boolean(referenceImages?.master),
  };
  const prompt = buildImagePrompt(scene, design, effectivePromptOptions);
  // Master (sequence base plate) goes first — the base everything else
  // composites onto — followed by the existing style/background/presenter
  // order, since forwarded reference-image order matters to some providers
  // as "layer order".
  const referenceBuffers = [
    referenceImages?.master,
    referenceImages?.style,
    referenceImages?.background,
    referenceImages?.presenter,
  ].filter((buf): buf is Buffer => buf !== undefined);
  return client.generateImage(prompt, { ...clientOptions, referenceImages: referenceBuffers });
}

/** True for a rate-limit ("too many requests") response from the configured image provider — the most likely failure when several scenes generate concurrently. */
export function isRateLimitError(err: unknown): boolean {
  return err instanceof ImageApiError && err.status === 429;
}

const MAX_ERROR_MESSAGE_LENGTH = 300;

/** A short, user-facing summary of an image generation failure — surfaced in the UI so a repeated failure is diagnosable instead of a generic "실패했습니다". */
export function describeImageError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.length > MAX_ERROR_MESSAGE_LENGTH ? `${message.slice(0, MAX_ERROR_MESSAGE_LENGTH)}...` : message;
}

/** Rejects with an AbortError as soon as `signal` aborts, instead of sleeping the full duration regardless. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/**
 * Wraps generateSceneImage with a retry. A 429 rate-limit response — the
 * likely failure when several scenes/groups are generating concurrently —
 * gets IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES retries spaced
 * IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS apart; any other error gets the
 * shorter generic policy (IMAGE_GENERATION_MAX_RETRIES /
 * IMAGE_GENERATION_RETRY_DELAY_MS). The retry policy is decided once from
 * the first failure and reused for every retry of that same call. Once
 * retries are exhausted, the failure is rethrown with the scene id and
 * underlying reason attached so the caller can surface exactly what went
 * wrong instead of a generic message.
 */
export async function generateSceneImageWithRetry(
  client: ImageClient,
  scene: Scene,
  design: VisualDesign,
  promptOptions?: BuildImagePromptOptions,
  signal?: AbortSignal,
  referenceImages?: SceneReferenceImages
): Promise<Buffer> {
  const effectiveSignal = signal ?? new AbortController().signal;

  try {
    return await generateSceneImage(client, scene, design, promptOptions, { signal: effectiveSignal }, referenceImages);
  } catch (err) {
    if (effectiveSignal.aborted) throw err;

    const rateLimited = isRateLimitError(err);
    const maxRetries = rateLimited ? IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES : IMAGE_GENERATION_MAX_RETRIES;
    const delayMs = rateLimited ? IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS : IMAGE_GENERATION_RETRY_DELAY_MS;
    let lastErr = err;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.error(
        `이미지 생성 실패(${attempt}/${maxRetries}, ${rateLimited ? "동시 사용 제한" : "일반 오류"}), ${delayMs / 1000}초 후 재시도 (scene: ${scene.id}):`,
        lastErr
      );
      await sleep(delayMs, effectiveSignal);
      try {
        return await generateSceneImage(client, scene, design, promptOptions, { signal: effectiveSignal }, referenceImages);
      } catch (retryErr) {
        if (effectiveSignal.aborted) throw retryErr;
        lastErr = retryErr;
      }
    }

    throw new Error(`씬 ${scene.id} 이미지 생성 실패: ${describeImageError(lastErr)}`);
  }
}
