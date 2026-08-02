# DeepSeek API 레퍼런스 (확인일: 2026-07-27)

## 기본 정보

- Base URL (OpenAI 호환 포맷): `https://api.deepseek.com`
- Base URL (Anthropic 호환 포맷): `https://api.deepseek.com/anthropic`
- Chat Completions 엔드포인트: `POST /chat/completions` (OpenAI 규격과 호환)
- 인증: `Authorization: Bearer $DEEPSEEK_API_KEY` 헤더

## 사용 가능한 모델 (2026-07-27 기준)

- `deepseek-v4-pro` — 고급 추론/에이전틱 작업용
- `deepseek-v4-flash` — 저비용/고속용

**중요**: 레거시 모델 별칭 `deepseek-chat`, `deepseek-reasoner`는 **2026-07-24 15:59 UTC부로 완전히 폐지**되었다 (오늘 기준 3일 전). 과거 튜토리얼이나 학습 데이터에 남아있는 `deepseek-chat`/`deepseek-reasoner` 이름을 쓰면 요청이 실패하므로, 반드시 `deepseek-v4-pro` 또는 `deepseek-v4-flash`를 사용할 것.

## 이 프로젝트에서의 사용처

파이프라인의 텍스트 분석 단계에서 공통으로 사용. 모델 선택 기준은 "원문 전체를 한 번에 다루며 원문 보존 같은 정밀도가 중요한가"(→ `-pro`) vs "짧은 판단/요약을 반복적으로 빠르게 처리하면 되는가"(→ `-flash`).

| 모듈 | 단계 | 모델 | 이유 |
|---|---|---|---|
| `lib/pipeline/convertMarkdown.ts` | 원고 변환 | `-pro` | 원문 전체를 나레이션체 마크다운으로 재구성 |
| `lib/pipeline/splitScenes.ts` | 씬 분할 | `-pro` | 전체 나레이션을 의미 단위로 정확히 분절 + 원문 보존 검증 필요 |
| `lib/pipeline/summarizeDocument.ts` | 원고 변환 (부가) | `-flash` | 문서 전체를 3~5문장으로 요약하는 짧은 단발 작업 |
| `lib/pipeline/selectScreenTypes.ts` | 화면 설계 | `-flash` | 씬 1개당 화면 유형 14종 중 하나를 고르는 반복적 분류 작업 |
| `lib/pipeline/reviewConsistency.ts` | 일관성 검수 | `-flash` | 이미 만들어진 데이터를 검토하는 작업, 새로운 원문 생성 없음 |

`deepseekClient.ts`의 `DEFAULT_MODEL`도 `-pro`로 기본 설정되어 있어, 호출부가 `model`을 명시하지 않으면 `-pro`가 쓰인다.

비주얼 설계(레이아웃/캡션 템플릿 문구)는 AI 호출 없이 `lib/visual-templates`의 코드 템플릿으로 결정적으로 계산한다(위 표에 없는 이유) — `selectScreenTypes`가 고른 화면 유형만 넘겨받아 로컬에서 조합한다.

## 참고 사항

- OpenAI SDK와 호환되므로 Node에서 `openai` 패키지에 `baseURL: "https://api.deepseek.com"`만 지정해 사용 가능
- API 키는 로컬 `.env` (`DEEPSEEK_API_KEY`)로 관리, 저장소에 커밋하지 않음
- 최신 변경 사항은 공식 문서의 Change Log에서 확인: https://api-docs.deepseek.com/updates/

## 출처

- [Change Log | DeepSeek API Docs](https://api-docs.deepseek.com/updates/)
- [DeepSeek API 공식 문서 - Pricing/Quick Start](https://api-docs.deepseek.com/quick_start/pricing)
