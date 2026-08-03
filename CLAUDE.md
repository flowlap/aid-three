# aid-three — 이러닝 스토리보드 제작 지원 도구

## 프로젝트 개요

이러닝 교육 과정 원고(또는 나레이션)를 영상 제작용 스토리보드로 변환하는 로컬 실행 제작 지원 도구. 원고 1개 = 프로젝트 1개로 관리하며, 사용자가 각 파이프라인 단계의 AI 산출물을 검토·수정하면서 순차적으로 스토리보드를 완성한다.

**새 세션(다른 기기 포함)에서는 먼저 [`docs/PROJECT_OVERVIEW.md`](docs/PROJECT_OVERVIEW.md)를 읽을 것** — 아키텍처, 파일 구조, 확립된 코딩 패턴, 알려진 제약을 한 문서에 정리해둔 것. 전체 설계 배경은 [`docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md`](docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md) 참고.

## 현재 상태

- 2026-07-29: v1 파이프라인(업로드 ~ 최종 스토리보드 뷰) 구현 완료, 13개 태스크 + 최종 전체 브랜치 리뷰 통과, 실제 DeepSeek API로 라이브 E2E 검증 완료, `master`에 병합 및 GitHub push 완료.
- 2026-08-03: AI provider 추상화 도입 — DeepSeek(텍스트)/OpenAI(이미지) 전용 클라이언트를 `LlmClient`/`ImageClient` 인터페이스로 일반화하고, 사내 게이트웨이 H-CHAT(Claude/ChatGPT/Gemini/Gemini 이미지)을 `LLM_PROVIDER`/`IMAGE_PROVIDER` env var로 선택 가능하게 함. 기본값은 기존과 동일(`deepseek`/`openai`)해 하위호환 유지. 상세는 [`docs/superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md`](docs/superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md) 참고.
- 다음 작업은 [`docs/ROADMAP.md`](docs/ROADMAP.md) 참고 (작은 개선 항목부터 pptx 내보내기 같은 큰 후속 기능까지 우선순위별로 정리됨). 착수 전 `superpowers:brainstorming`부터 시작할 것.

## 기술 스택

- Next.js (App Router) 단일 앱, `npm run dev`로 로컬 실행 (Windows/Mac 웹앱)
- React + TypeScript + shadcn/ui + Tailwind CSS
- 백엔드 로직은 전부 Next.js API Route(Node.js)에서 처리 — 별도 서버 프로세스 없음
- AI: `LlmClient`(텍스트)/`ImageClient`(이미지) 인터페이스로 provider 추상화됨 — `LLM_PROVIDER`/`IMAGE_PROVIDER` env var로 DeepSeek/OpenAI(기본값) 또는 사내 H-CHAT 게이트웨이(Claude/ChatGPT/Gemini) 선택. DeepSeek 자체 스펙은 [`docs/reference/deepseek-api.md`](docs/reference/deepseek-api.md)
- 향후(v1 범위 아님): pptx 템플릿 내보내기

## 아키텍처 핵심 결정

- **저장 방식**: DB 없이 `data/projects/{project-id}/` 폴더 + 파일(JSON/markdown) 구조로 저장. 프로젝트 목록은 디렉터리 스캔으로 구성.
- **파이프라인 모듈화**: 처리 로직은 `lib/pipeline/*`에 단계별 순수 함수형 모듈(`input → output`)로 분리. 지금은 전부 Node로 구현하지만, 나중에 특정 모듈(예: PDF 파싱)을 Python 프로세스로 교체할 수 있도록 인터페이스만 바라보고 호출하게 설계한다. **아직 Python 코드는 작성하지 않는다** — 자리만 마련.
- **단계 간 무효화 없음**: 이전 단계를 나중에 수정해도 이후 단계 산출물을 자동 재생성하지 않음(v1 한정 단순화).
- 파이프라인 단계별 정확한 입출력 계약은 [`docs/reference/pipeline-steps.md`](docs/reference/pipeline-steps.md) 참고.

## 파이프라인 단계 요약

업로드 → 마크다운 변환 → 씬 분할 → 화면 유형 선정 → 비주얼 설계 → 일관성 검수 → 최종 스토리보드 뷰 (읽기 전용)

각 단계는 "AI 생성 → 사용자 검토/수정 → 다음 단계" 패턴의 선형 마법사로 구현.

## 참고 문서

- [**프로젝트 개요 및 상세**](docs/PROJECT_OVERVIEW.md) — 새 세션 시작 시 가장 먼저 읽을 문서
- [**향후 개발 계획**](docs/ROADMAP.md) — 우선순위별 다음 작업 후보
- [설계 문서](docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md) — 전체 아키텍처, 데이터 모델, 에러 처리, 테스트 전략
- [구현 계획 (13개 태스크)](docs/superpowers/plans/2026-07-28-elearning-storyboard-generator.md)
- [파이프라인 단계별 입출력 명세](docs/reference/pipeline-steps.md) — 각 단계 구현 시 참고할 상세 계약
- [화면 유형 레퍼런스](docs/reference/screen-types.md) — 화면 설계 단계가 쓰는 14개 화면 유형의 설계 방향과 유형별 상세 가이드
- [DeepSeek API 레퍼런스](docs/reference/deepseek-api.md) — 모델명, 엔드포인트, 사용 시 주의사항 (레거시 모델명 폐지 확인됨)

## 작업 시 유의사항

- 씬 분할 단계에서 나레이션 원문은 임의로 수정하지 않고 분절만 한다 — 이 원칙은 코드 레벨 검증(원문 재조합 diff 체크)으로도 지켜야 한다.
- AI 클라이언트(LLM/이미지)는 반드시 인터페이스로 분리해서 테스트 시 mock으로 대체 가능하게 유지한다. 새 provider를 추가할 때도 이 원칙을 따른다(`lib/ai/llm/*`, `lib/ai/image/*` 참고).
