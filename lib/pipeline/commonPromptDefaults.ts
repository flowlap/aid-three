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
