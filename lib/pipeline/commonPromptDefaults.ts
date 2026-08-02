/**
 * Generic starting content for the "공통 프롬프트" fields, shown pre-filled
 * (not just as a placeholder) so a project has sensible baseline guidance
 * from the start instead of nothing. Read wherever the saved prompt file is
 * empty/missing — both for what's displayed and for what's actually sent to
 * the AI — so the two never drift apart. Also reused as the field's
 * placeholder, so clearing the field back to empty shows the same text as a
 * hint instead of a made-up example.
 */
export const DEFAULT_SCREEN_DESIGN_COMMON_PROMPT =
  "일반 성인 학습자를 대상으로 하는 이러닝 강의입니다. 전문적이고 신뢰감 있는 톤을 유지하고, 쉬운 표현을 사용하세요. 특정 브랜드명이나 상표는 노출하지 마세요. 화면 유형은 내용에 맞게 다양하게 활용하고, 자막은 간결하고 명확하게 작성하세요.";

export const DEFAULT_IMAGE_COMMON_PROMPT =
  "플랫 일러스트 스타일, 밝고 차분한 파스텔톤 색상, 둥근 모서리와 여백을 살린 미니멀한 레이아웃을 사용하세요. 실존 인물의 얼굴이나 특정 브랜드 로고·상표는 포함하지 마세요.";

/** Default prompt for the one-time "배경 고정" reference background image, generated once per project and then reused as-is across every scene. */
export const DEFAULT_BACKGROUND_IMAGE_PROMPT =
  "플랫 일러스트 스타일의 깔끔한 교육용 배경입니다. 밝고 차분하며 프로페셔널한 느낌의 색상과 은은한 그라데이션을 사용하고, 화면 중앙은 비워두어 어떤 화면 내용을 올려도 잘 어울리게 만드세요. 텍스트, 로고, 특정 브랜드 요소는 포함하지 마세요.";

/** Default prompt for the one-time "강사 표시" reference presenter image, generated once per project and then reused as-is across every scene. */
export const DEFAULT_PRESENTER_IMAGE_PROMPT =
  "전문적이고 신뢰감 있는 이러닝 강사의 전신 모습입니다. 단정한 비즈니스 캐주얼 복장, 자연스러운 미소, 플랫 일러스트 스타일로 그려주세요. 배경은 단색 또는 투명하게 처리하세요.";
