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
}

const WIDE_COMPOSITION_INSTRUCTION =
  "이 이미지는 하나의 시퀀스 전체가 공유할 배경/장소 마스터 비주얼입니다. 특정 피사체나 인물을 화면 중앙에 꽉 채우지 말고, 넓은 설정샷(establishing shot) 구도로 그려서 화면 상하좌우에 여유 공간(헤드룸/마진)을 넉넉히 남기세요 — 이후 단계에서 이 이미지를 와이드/미디엄/클로즈업 등으로 잘라 쓰고 자막·아이콘 같은 오버레이를 얹을 것이므로, 크롭하거나 오버레이를 배치해도 구도가 깨지지 않아야 합니다.";

const MASTER_SUBJECT_INSTRUCTION =
  "이 이미지는 시퀀스 전체가 재사용할 마스터 플레이트입니다. 연속성 정보의 고정 요소에 인물·제품·사물이 있다면 배경과 함께 이 이미지 안에 포함해 이후 씬에서도 같은 대상이 보이게 하세요. 다만 프로젝트별 강사 오버레이를 새로 추가하지 말고, 화면 자막·숫자·라벨 같은 온스크린 그래픽은 절대 넣지 마세요 — 교육 그래픽은 이후 단계에서 코드로 합성됩니다.";

/** See STYLE_REFERENCE_SAMPLE_TEXT_EXCLUSION (generateSceneImage.ts) for why this warning exists — a master visual never has a requested caption, so unlike a scene's version this one is unconditional. */
const STYLE_REFERENCE_TEXT_EXCLUSION_INSTRUCTION =
  `톤앤매너 참고 이미지가 함께 제공된 경우, ${STYLE_REFERENCE_SAMPLE_TEXT_EXCLUSION} 이 마스터 비주얼에는 별도로 요청된 자막이 없으므로 텍스트를 전혀 넣지 마세요.`;

const MINIMAL_BACKGROUND_INSTRUCTION =
  "배경은 간결하고 최소화된 구도로 만드세요. 설명에 필요한 고정 요소와 주요 피사체만 남기고, 의미 없는 장식물·소품·군중·복잡한 패턴을 과도하게 추가하지 마세요. 이후 교육 그래픽을 얹을 수 있도록 화면의 한 영역에는 깨끗한 여백과 낮은 시각적 복잡도를 유지하세요.";

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
 * Pure prompt builder for a sequence's master visual. Uses only
 * sequence.continuity and sequence.masterVisual.description, plus the
 * images step's project-wide "공통 프롬프트" (commonPrompt) so the master
 * plate shares the same tone-and-manner as every scene image generated
 * against it — deliberately no per-project presenter reference text (see
 * this file's header comment).
 *
 * `hasBackgroundReferenceImage` mirrors buildImagePrompt's
 * hasStyleReferenceImage/hasPresenterReferenceImage pattern
 * (generateSceneImage.ts) — true only when a "배경 고정" reference buffer is
 * actually being attached to this call (see callGenerateImage below), so the
 * emphasis instruction never appears with nothing for it to refer to.
 */
export function buildSequenceMasterImagePrompt(
  sequence: Sequence,
  commonPrompt?: string,
  hasBackgroundReferenceImage?: boolean
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

  return `이러닝 교육용 스토리보드 시퀀스가 공유할 배경/장소 마스터 비주얼 이미지를 생성하세요.

무엇을 그릴지(마스터 비주얼 설명): ${masterVisual.description}

이 시퀀스의 연속성 정보(모든 씬에 걸쳐 일관되게 유지되어야 할 배경 조건):
${continuityParts.map((part) => `- ${part}`).join("\n")}

${PRODUCTION_STYLE_INSTRUCTION} ${NO_TEXT_INSTRUCTION}${styleGuide}

${WIDE_COMPOSITION_INSTRUCTION}

${MASTER_SUBJECT_INSTRUCTION}

${STYLE_REFERENCE_TEXT_EXCLUSION_INSTRUCTION}

${MINIMAL_BACKGROUND_INSTRUCTION}${backgroundReferenceInstruction}`;
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
  const prompt = buildSequenceMasterImagePrompt(sequence, commonPrompt, Boolean(referenceImages?.background));
  const referenceBuffers = [referenceImages?.style, referenceImages?.background].filter(
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
