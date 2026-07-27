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

씬 분할, 화면 유형 선정, 비주얼 설계, 마크다운 변환 등 텍스트 분석 전 단계에서 공통으로 사용. 구현 시 모델 선택 기준(예: 정확도가 중요한 단계는 `-pro`, 단순 변환은 `-flash`)은 실제 응답 품질을 보면서 조정한다.

## 참고 사항

- OpenAI SDK와 호환되므로 Node에서 `openai` 패키지에 `baseURL: "https://api.deepseek.com"`만 지정해 사용 가능
- API 키는 로컬 `.env` (`DEEPSEEK_API_KEY`)로 관리, 저장소에 커밋하지 않음
- 최신 변경 사항은 공식 문서의 Change Log에서 확인: https://api-docs.deepseek.com/updates/

## 출처

- [Change Log | DeepSeek API Docs](https://api-docs.deepseek.com/updates/)
- [DeepSeek API 공식 문서 - Pricing/Quick Start](https://api-docs.deepseek.com/quick_start/pricing)
