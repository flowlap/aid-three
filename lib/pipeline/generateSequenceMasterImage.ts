import type { ImageClient, ImageGenerateOptions } from "../ai/image/types";
import {
  IMAGE_GENERATION_MAX_RETRIES,
  IMAGE_GENERATION_RETRY_DELAY_MS,
  IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES,
  IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS,
} from "./imageGenerationConfig";
import {
  isRateLimitError,
  describeImageError,
  PRODUCTION_STYLE_INSTRUCTION,
  NO_TEXT_INSTRUCTION,
  STYLE_REFERENCE_SAMPLE_TEXT_EXCLUSION,
} from "./generateSceneImage";
import type { Sequence } from "./sequenceTypes";

/**
 * A sequence's master visual is a single background/location plate shared by
 * every scene in the sequence — later camera-crop and overlay steps composite
 * on top of it. So unlike
 * buildImagePrompt (a specific screen's exact content), this prompt only
 * ever asks for a wide, text-free establishing shot with its fixed
 * subjects/objects and generous margin, built from the sequence's continuity/master description
 * alone — no per-project style/presenter reference *text* injection (those
 * are attached as actual reference *images* to the generateImage call
 * instead, mirroring SceneReferenceImages).
 */

/**
 * Reference images optionally attached to a master-visual generation call.
 * No `presenter` field — the project-wide presenter toggle remains separate,
 * while sequence-specific people/objects are continuity subjects in the master.
 */
export interface SequenceMasterReferenceImages {
  background?: Buffer;
  style?: Buffer;
  /**
   * Another sequence's already-generated master visual, attached so this
   * generation stays visually consistent with it — the multi-select "선택한
   * 시퀀스 통일감 있게 생성" flow in SequenceMasterVisualsSection.tsx picks one
   * already-generated (or freshly-generated) sequence as an anchor and
   * attaches its image here for every other selected sequence's call.
   * Distinct from `style` (an abstract, content-free design-system sample):
   * this is a real generated master from the same project, so the model has
   * a concrete example of "what this project's masters actually look like."
   */
  consistencyReference?: Buffer;
}

const WIDE_COMPOSITION_INSTRUCTION =
  "이 이미지는 하나의 시퀀스 전체가 공유할 배경/장소 마스터 비주얼입니다. 특정 피사체나 인물을 화면 중앙에 꽉 채우지 말고, 넓은 설정샷(establishing shot) 구도로 그려서 화면 상하좌우에 여유 공간(헤드룸/마진)을 넉넉히 남기세요 — 이후 단계에서 이 이미지를 와이드/미디엄/클로즈업 등으로 잘라 쓰고 자막·아이콘 같은 오버레이를 얹을 것이므로, 크롭하거나 오버레이를 배치해도 구도가 깨지지 않아야 합니다.";

const MASTER_SUBJECT_INSTRUCTION =
  "이 이미지는 시퀀스 전체가 재사용할 마스터 플레이트이며, 순수하게 배경 역할만 하는 조연입니다 — 주된 내용 전달은 전부 각 씬 이미지에서 이루어지므로, 이 마스터는 정보나 개념을 전달하려 하지 말고 오직 장소/공간의 분위기만 조성하세요. 이후 각 씬에서 그려질 강사와 콘텐츠(핵심 개념, 도식, 아이콘, 상징물, 텍스트 카드 등)가 화면의 유일한 주인공이어야 하므로, 이 마스터가 그것보다 시각적으로 튀거나 주목을 끌어서는 절대 안 됩니다. 연속성 정보의 고정 요소·절대 변경 금지 항목에 특정 개념을 상징하는 아이콘이나 오브제(예: 이론·주제를 나타내는 상징물)가 언급되어 있더라도, 이 마스터에서는 그것을 뚜렷하고 구체적인 주인공으로 그리지 마세요 — 장소 자체의 특징(공간 형태, 조명, 색감, 기본적인 가구 배치 정도)만 반영하고, 개념을 상징하는 구체적 오브제·아이콘·상징물은 절대 넣지 마세요. 그런 요소는 각 씬 단계에서 그 씬의 내용에 맞게 개별적으로, 화면의 주인공으로서 그려집니다. 프로젝트별 강사 오버레이를 새로 추가하지 말고, 화면 자막·숫자·라벨 같은 온스크린 그래픽은 절대 넣지 마세요 — 교육 그래픽은 이후 단계에서 코드로 합성됩니다.";

/** See STYLE_REFERENCE_SAMPLE_TEXT_EXCLUSION (generateSceneImage.ts) for why this warning exists — a master visual never has a requested caption, so unlike a scene's version this one is unconditional. */
const STYLE_REFERENCE_TEXT_EXCLUSION_INSTRUCTION =
  `톤앤매너 참고 이미지가 함께 제공된 경우, ${STYLE_REFERENCE_SAMPLE_TEXT_EXCLUSION} 이 마스터 비주얼에는 별도로 요청된 자막이 없으므로 텍스트를 전혀 넣지 마세요.`;

/**
 * Appended whenever a style reference image is attached. The "톤앤매너 기준
 * 이미지" is project-wide design-system material — its purpose is to keep
 * every sequence's master visual consistent in color/mood, not to dictate
 * what any single master should literally contain. Strengthened (per direct
 * user feedback that generated masters looked too different from the
 * reference, and separately too complex/detailed compared to the reference's
 * own simple, sparse background) to weight color/lighting/illustration-style
 * fidelity heavily, the same way BACKGROUND_REFERENCE_EMPHASIS_INSTRUCTION
 * already does for a background-fixed reference, and to explicitly require
 * matching the reference's level of visual simplicity/emptiness too — only
 * the composition/layout stays independent, since copying THAT from a sample
 * reference image (rather than this sequence's own wide establishing-shot
 * needs) was the original, separate problem this instruction guards against.
 */
const STYLE_REFERENCE_TONE_ONLY_INSTRUCTION =
  "톤앤매너 참고 이미지가 함께 제공되었습니다. 이 참고 이미지를 가벼운 참고 자료로 다루지 말고, 이 마스터 비주얼도 같은 프로젝트의 한 장면처럼 보이도록 강하게 반영하세요 — 주조색과 보조색 팔레트, 채도·명도, 조명 방식과 그림자 처리, 일러스트 화풍(선 굵기, 음영·텍스처 표현)을 참고 이미지와 최대한 동일하게 재현해야 합니다. 특히 참고 이미지의 배경이 단순하고 여백이 많다면, 이 마스터도 그만큼(혹은 그보다 더) 단순하고 여백이 넉넉해야 합니다 — 참고 이미지보다 요소가 많고 복잡한 그림이 되어서는 절대 안 됩니다. 이 마스터만 따로 봤을 때 참고 이미지와 다른 프로젝트처럼 보이거나, 참고 이미지보다 시각적으로 더 복잡해 보인다면 잘못된 것입니다. 다만 참고 이미지 속 구체적인 구도, 요소 배치, 화면 레이아웃(예: 카드나 아이콘의 정확한 위치)까지 그대로 옮기지는 마세요 — 그 부분은 위의 넓은 설정샷 구도 지시를 따르는 이 마스터만의 독립적인 장면이어야 합니다.";

const MINIMAL_BACKGROUND_INSTRUCTION =
  "배경은 간결하고 최소화된 구도로 만드세요. 설명에 필요한 고정 요소만 옅게 남기고, 의미 없는 장식물·소품·군중·복잡한 패턴을 과도하게 추가하지 마세요. 색감·채도·명암 대비는 톤앤매너 기준 이미지(제공된 경우)나 공통 스타일 가이드를 그대로 따르고 — 이 지시 때문에 임의로 탁하게 낮추지 마세요 — 대신 화면 안 요소의 개수와 디테일을 최소화하는 방식으로 배경을 단순하게 유지해서, 이후 이 위에 올라올 씬 콘텐츠(강사, 자막, 아이콘 등)가 화면에서 가장 눈에 띄는 요소가 되도록 하세요. 이 마스터 자체가 시선을 끄는 그림이 되어서는 안 되며, 화면의 넓은 영역에 깨끗한 여백을 유지하세요.";

/**
 * Direct user feedback: even after MASTER_SUBJECT_INSTRUCTION/
 * MINIMAL_BACKGROUND_INSTRUCTION, masters still read as too sharp/detailed a
 * picture in their own right. A photography-style shallow-depth-of-field
 * blur is a concrete, unambiguous way to ask an image model to make
 * something recede — much harder to under-comply with than an abstract
 * "keep it simple" request, and it directly matches the "camera focuses on
 * scene content, master is just the soft backdrop behind it" framing.
 */
const MASTER_BLUR_INSTRUCTION =
  "이 마스터 비주얼 전체를 카메라 아웃포커스(얕은 심도, shallow depth of field)로 촬영한 것처럼 살짝 흐릿하게(soft blur) 그려주세요 — 사진에서 배경이 초점 밖에 있어 부드럽게 번져 보이는 느낌입니다. 윤곽선과 디테일이 또렷하고 날카롭게 보이면 안 되며, 전체적으로 부드럽고 흐릿한 배경처럼 느껴져야 합니다. 이렇게 흐리게 처리하는 이유는 이 마스터가 배경일 뿐이고, 이후 그 위에 얹힐 선명한 씬 콘텐츠와 확실히 구분되게 하기 위함입니다. 지금까지의 결과물보다 훨씬 더 단순하고 훨씬 더 흐릿해야 합니다.";

/**
 * Appended only when a "배경 고정" background reference image is attached
 * (see SequenceMasterReferenceImages.background). Unlike
 * BACKGROUND_FIXED_INSTRUCTION (generateSceneImage.ts), which tells a scene
 * to reuse that image verbatim as-is, a master visual still needs to draw an
 * actual wide establishing shot with its own subjects/composition — so this
 * asks the model to weight the reference heavily as the source of the
 * location's color/lighting/mood rather than treating it as a loose,
 * easily-ignored style suggestion.
 */
const BACKGROUND_REFERENCE_EMPHASIS_INSTRUCTION =
  "제공된 배경 참고 이미지(배경 고정)가 함께 첨부되었습니다. 이 참고 이미지를 가벼운 참고 자료로 다루지 말고, 이 마스터 비주얼이 실제로 그 배경 위에서 벌어지는 장면인 것처럼 참고 이미지의 장소감·색감·조명·질감을 최대한 그대로 반영해서 그려주세요. 연속성 정보의 고정 요소나 피사체를 자연스럽게 추가하되, 배경 자체의 톤과 분위기는 참고 이미지에서 최대한 벗어나지 마세요.";

/**
 * Appended only when another sequence's already-generated master visual is
 * attached as SequenceMasterReferenceImages.consistencyReference — the
 * multi-select "통일감 있게 생성" flow's whole point is that independently
 * generated sequence masters ended up looking too different from each other
 * (direct user feedback), so this is deliberately as forceful as
 * STYLE_REFERENCE_TONE_ONLY_INSTRUCTION/BACKGROUND_REFERENCE_EMPHASIS_INSTRUCTION
 * about color/lighting/style fidelity, while still keeping this sequence's
 * own place/composition independent (a different sequence's master showing
 * the same location would defeat sequences existing at all).
 */
const CONSISTENCY_REFERENCE_INSTRUCTION =
  "같은 프로젝트의 다른 시퀀스에서 이미 생성된 마스터 비주얼이 참고 이미지로 함께 첨부되었습니다. 이 참고 이미지를 가벼운 참고 자료로 다루지 말고, 두 마스터가 같은 영상 시리즈의 서로 다른 장면처럼 보이도록 색감(주조색·보조색 팔레트), 채도·명도, 조명 방식, 일러스트 화풍(선 굵기, 음영·텍스처 표현)을 참고 이미지와 최대한 동일하게 재현하세요. 다만 장소·구도·고정 요소는 참고 이미지를 따라 하지 말고 이 시퀀스만의 고유한 내용(위의 마스터 비주얼 설명과 연속성 정보)을 그대로 따르세요 — 다른 시퀀스의 장소나 사물을 이 마스터에 옮겨 그리면 안 됩니다.";

/**
 * Pure prompt builder for a sequence's master visual. Uses only
 * sequence.continuity and sequence.masterVisual.description, plus the
 * images step's project-wide "공통 프롬프트" (commonPrompt) so the master
 * plate shares the same tone-and-manner as every scene image generated
 * against it — deliberately no per-project presenter reference text (see
 * this file's header comment).
 *
 * `hasBackgroundReferenceImage`/`hasConsistencyReferenceImage` mirror
 * buildImagePrompt's hasStyleReferenceImage/hasPresenterReferenceImage
 * pattern (generateSceneImage.ts) — true only when that reference buffer is
 * actually being attached to this call (see callGenerateImage below), so an
 * emphasis instruction never appears with nothing for it to refer to.
 */
export function buildSequenceMasterImagePrompt(
  sequence: Sequence,
  commonPrompt?: string,
  hasBackgroundReferenceImage?: boolean,
  hasConsistencyReferenceImage?: boolean
): string {
  const { continuity, masterVisual } = sequence;

  const continuityParts = [
    `장소: ${continuity.location}`,
    continuity.timeOfDay ? `시간대: ${continuity.timeOfDay}` : null,
    `비주얼 스타일: ${continuity.visualStyle}`,
    continuity.fixedElements.length > 0 ? `고정 요소: ${continuity.fixedElements.join(", ")}` : null,
    continuity.doNotChange.length > 0 ? `절대 변경 금지: ${continuity.doNotChange.join(", ")}` : null,
  ].filter((part): part is string => part !== null);

  const styleGuide = commonPrompt?.trim() ? `\n\n공통 스타일 가이드(모든 화면에 일관되게 적용):\n${commonPrompt.trim()}` : "";
  const backgroundReferenceInstruction = hasBackgroundReferenceImage ? `\n\n${BACKGROUND_REFERENCE_EMPHASIS_INSTRUCTION}` : "";
  const consistencyReferenceInstruction = hasConsistencyReferenceImage ? `\n\n${CONSISTENCY_REFERENCE_INSTRUCTION}` : "";

  return `이러닝 교육용 스토리보드 시퀀스가 공유할 배경/장소 마스터 비주얼 이미지를 생성하세요.

무엇을 그릴지(마스터 비주얼 설명): ${masterVisual.description}

이 시퀀스의 연속성 정보(모든 씬에 걸쳐 일관되게 유지되어야 할 배경 조건):
${continuityParts.map((part) => `- ${part}`).join("\n")}

${PRODUCTION_STYLE_INSTRUCTION} ${NO_TEXT_INSTRUCTION}${styleGuide}

${WIDE_COMPOSITION_INSTRUCTION}

${MASTER_SUBJECT_INSTRUCTION}

${STYLE_REFERENCE_TEXT_EXCLUSION_INSTRUCTION}

${STYLE_REFERENCE_TONE_ONLY_INSTRUCTION}

${MINIMAL_BACKGROUND_INSTRUCTION}

${MASTER_BLUR_INSTRUCTION}${backgroundReferenceInstruction}${consistencyReferenceInstruction}`;
}

/** Rejects with an AbortError as soon as `signal` aborts, instead of sleeping the full duration regardless. Mirrors generateSceneImage.ts's private sleep helper. */
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

function callGenerateImage(
  client: ImageClient,
  sequence: Sequence,
  referenceImages: SequenceMasterReferenceImages | undefined,
  commonPrompt: string | undefined,
  clientOptions?: ImageGenerateOptions
): Promise<Buffer> {
  const prompt = buildSequenceMasterImagePrompt(
    sequence,
    commonPrompt,
    Boolean(referenceImages?.background),
    Boolean(referenceImages?.consistencyReference)
  );
  const referenceBuffers = [referenceImages?.style, referenceImages?.background, referenceImages?.consistencyReference].filter(
    (buf): buf is Buffer => buf !== undefined
  );
  return client.generateImage(prompt, { ...clientOptions, referenceImages: referenceBuffers });
}

/**
 * Generates a sequence's master visual, with a retry loop analogous to
 * generateSceneImageWithRetry's: a 429 rate-limit failure gets the longer
 * IMAGE_GENERATION_RATE_LIMIT_* policy, any other error gets the shorter
 * generic IMAGE_GENERATION_* policy — decided once from the first failure
 * and reused for every retry of that same call. Once retries are exhausted,
 * the failure is rethrown with the sequence id and underlying reason
 * attached.
 */
export async function generateSequenceMasterImage(
  client: ImageClient,
  sequence: Sequence,
  referenceImages?: SequenceMasterReferenceImages,
  signal?: AbortSignal,
  commonPrompt?: string
): Promise<Buffer> {
  const effectiveSignal = signal ?? new AbortController().signal;

  try {
    return await callGenerateImage(client, sequence, referenceImages, commonPrompt, { signal: effectiveSignal });
  } catch (err) {
    if (effectiveSignal.aborted) throw err;

    const rateLimited = isRateLimitError(err);
    const maxRetries = rateLimited ? IMAGE_GENERATION_RATE_LIMIT_MAX_RETRIES : IMAGE_GENERATION_MAX_RETRIES;
    const delayMs = rateLimited ? IMAGE_GENERATION_RATE_LIMIT_RETRY_DELAY_MS : IMAGE_GENERATION_RETRY_DELAY_MS;
    let lastErr = err;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      console.error(
        `시퀀스 마스터 비주얼 생성 실패(${attempt}/${maxRetries}, ${rateLimited ? "동시 사용 제한" : "일반 오류"}), ${delayMs / 1000}초 후 재시도 (sequence: ${sequence.id}):`,
        lastErr
      );
      await sleep(delayMs, effectiveSignal);
      try {
        return await callGenerateImage(client, sequence, referenceImages, commonPrompt, { signal: effectiveSignal });
      } catch (retryErr) {
        if (effectiveSignal.aborted) throw retryErr;
        lastErr = retryErr;
      }
    }

    throw new Error(`시퀀스 ${sequence.id} 마스터 비주얼 생성 실패: ${describeImageError(lastErr)}`);
  }
}
