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
  "플랫 일러스트 스타일의 깔끔한 교육용 배경입니다. 밝고 차분하며 프로페셔널한 느낌의 색상과 은은한 그라데이션을 사용하고, 화면 중앙은 비워두어 어떤 화면 내용을 올려도 잘 어울리게 만드세요. 장식용 소품, 복잡한 패턴, 불필요한 디테일은 넣지 말고 간결하고 최소화된 구도로 그려주세요. 텍스트, 로고, 특정 브랜드 요소는 포함하지 마세요.";

/** Default prompt for the one-time "강사 표시" reference presenter image, generated once per project and then reused as-is across every scene. */
export const DEFAULT_PRESENTER_IMAGE_PROMPT =
  "전문적이고 신뢰감 있는 이러닝 강사의 전신 모습입니다. 단정한 비즈니스 캐주얼 복장, 자연스러운 미소, 플랫 일러스트 스타일로 그려주세요. 배경은 단색 또는 투명하게 처리하세요.";

/**
 * Default prompt for the one-time "톤앤매너 기준 이미지" reference, generated
 * once per project and then attached to every scene's generation call so the
 * model has a visual (not just textual) anchor for color/illustration
 * style/mood. Earlier drafts asked for an abstract "style swatch" with no
 * concrete content, on the theory that leaving it empty of content would
 * stop later generations from copying it — in practice this produced a
 * meaningless image (e.g. a blank gradient with a circle) with nothing for
 * the model to actually anchor on, since PRODUCTION_STYLE_INSTRUCTION
 * (generateSceneImage.ts) asks every scene for concrete components — lower
 * thirds, icon badges, infographic cards — that a content-free reference
 * never demonstrated. This version instead asks for a fully composed sample
 * screen with those exact components, filled with placeholder/dummy text so
 * nothing scene-specific leaks into later generations while still giving the
 * model a real example of what "this style's lower third/icon/infographic"
 * looks like.
 */
export const DEFAULT_STYLE_IMAGE_PROMPT =
  "이러닝 강의 영상의 실제 화면 예시를 1장 그려주세요. 다음 구성 요소를 모두 포함한, 완성된 한 장면처럼 보이는 화면이어야 합니다: 화면 하단의 자막바(로어써드)와 그 안의 짧은 샘플 자막 텍스트, 화면 한쪽의 심플한 아이콘 또는 뱃지, 핵심 내용을 보여주는 간단한 인포그래픽 요소(원형 다이어그램, 막대 그래프, 아이콘 리스트 카드 중 택1). 플랫 일러스트 스타일, 밝고 차분한 파스텔톤 색상, 둥근 모서리와 여백을 살린 미니멀한 레이아웃을 사용해서 이 프로젝트의 대표 컬러 팔레트와 컴포넌트(자막바·아이콘·인포그래픽) 스타일을 명확히 보여주세요. 자막바의 문구와 그래픽 안의 숫자·라벨은 실제 강의 내용과 무관한 임의의 샘플 문구(예: \"샘플 자막입니다\", \"A / B / C\")를 사용하세요. 실존 인물의 얼굴이나 특정 브랜드 로고·상표는 포함하지 마세요.";

/**
 * Default for sequence + AI image mode's per-scene "추가 프롬프트" field.
 * That mode bakes overlay text (labels/captions/diagrams) directly into the
 * image with no post-hoc compositing renderer to fall back on (see
 * buildSequenceOverlayBakeInstruction in generateSceneImage.ts), and image
 * models occasionally default to English lettering for that baked-in text.
 * Pre-filled (not just a placeholder) so a new sequence+AI project gets this
 * guardrail from the start instead of silently risking English text.
 */
export const DEFAULT_SEQUENCE_SCENE_EXTRA_PROMPT =
  "이미지 안에 텍스트, 라벨, 자막, 다이어그램 안의 글자를 그려 넣을 때는 반드시 한글로만 작성하세요. 영어를 비롯한 외국어 텍스트는 절대 사용하지 마세요.";
