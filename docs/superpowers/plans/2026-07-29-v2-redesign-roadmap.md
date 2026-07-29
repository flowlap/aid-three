# v2 대규모 개선 — 로드맵 및 Phase 1 실행 계획

- 작성일: 2026-07-29
- 이 문서는 사용자가 한 번에 요청한 v2 전면 개편 요청을 여러 개의 독립적으로 검증 가능한 Phase로 분해한 지속 계획 문서다. 세션/사용량 한계로 작업이 중단되어도 이 문서만 보고 이어갈 수 있도록 각 Phase의 상세 설계를 남긴다.

## Context

사용자가 한 번에 요청한 변경 범위: 전체 디자인 개편(1000px 중앙정렬, 고정 헤더/푸터, shadcn 테마 일관 적용), 모든 AI 작업에 대한 상태 관리(중복 실행 방지, 시작→진행중(진행율)/취소→완료/재작업 상태 머신), 화면별 기능 변경(홈 신호등 상태, 새 프로젝트 텍스트 입력, 1단계 명칭 변경+자동 진행, 2단계 씬 삭제/병합, 3단계 즉시저장+재진입 시 유지, 3-4단계 통합+코드 기반 비주얼 설계+구조화 유형 20종, 미리보기 신규 개발), AI 모델 이원화(1,2단계 pro/3,4,5단계 flash), 7단계 신규(OpenAI 이미지 생성).

이 요청은 사실상 앱의 거의 모든 화면과 아키텍처를 건드리는 v2 전면 개편이다. `docs/ROADMAP.md`에 명시된 프로젝트 진행 방식 — "여러 개를 한 번에 묶지 말고 각각 독립된 작은 계획으로 처리할 것" (v1 최종 리뷰에서 계획을 한 번에 묶었다가 요구사항 누락이 발생했던 경험에서 나온 교훈) — 을 따라, 이번 요청 전체를 하나의 실행으로 밀어붙이지 않고 여러 개의 독립적으로 검증 가능한 Phase로 분해한다.

**2026-07-29 세션에서 Phase 0(모델 이원화)과 Phase 1(AI 작업 엔진)을 구현 완료.** Phase 2~7은 아래에 상세 스펙으로 남겨 다음 세션에서 바로 착수 가능.

## 확인 완료 사항 (사용자 답변 반영됨)

1. **이미지 생성 모델명**: "GPT Image 2 Low" 확정 (사용자 확인). ⚠️ 실존 여부 미검증 모델명이므로, Phase 7 구현 시 모델명을 상수 한 곳에만 두어 실패 시 1줄 수정으로 대응 가능하게 만든다.
2. **1단계 자동 진행 버튼**: 반자동 확정 — 각 단계 검토는 유지하되, 사용자가 확인/수정 후 누르는 "다음 단계" 클릭을 자동으로 이어서 트리거(생성까지는 자동, 검토·승인 없이 건너뛰지 않음). Phase 4에 반영.
3. **구조화 유형 20종**: Claude가 초안 제안 확정 — 기존 5종을 확장한 8~12종 초안을 먼저 설계하고, 이후 필요시 20종으로 확장. Phase 5에 반영.
4. **OpenAI API 키 로테이션 권고**: 채팅에 평문으로 붙여넣어진 키는 이미 `.env.local`(gitignore 대상, 커밋 안 됨)에 저장 완료. 다만 대화 로그에 남아있을 수 있으므로 OpenAI 대시보드에서 재발급을 권장함 (구현과 무관, 사용자 액션 필요).

## Phase 순서 및 각 Phase 개요

| Phase | 내용 | 의존성 | 상태 |
|---|---|---|---|
| 0 | AI 모델 이원화 (pro/flash) | 없음 | ✅ 완료 |
| 1 | AI 작업 엔진 (중복방지/진행상태/취소/재진입 유지) | 없음 | ✅ 완료 |
| 2 | 디자인 셸 (1000px+배경+고정 헤더/푸터+shadcn 일관화) | 없음 (Phase 1과 독립) | ⬜ 미착수 |
| 3 | 홈 신호등 UI + 새 프로젝트 텍스트 입력 | Phase 1(상태 조회), Phase 2(셸) 권장 | ⬜ 미착수 |
| 4 | 1단계 명칭변경+자동진행, 2단계 씬 삭제/병합 | Phase 1 | ⬜ 미착수 |
| 5 | 3-4단계 통합 + 코드 기반 비주얼 설계 + 구조화 유형 확장 | Phase 1 | ⬜ 미착수 |
| 6 | 미리보기 신규 화면 | Phase 5(구조화 화면 데이터), Phase 7(이미지) | ⬜ 미착수 |
| 7 | 7단계 — OpenAI 이미지 생성 | Phase 1(작업엔진 재사용) | ⬜ 미착수 |

---

## Phase 0 — AI 모델 이원화 ✅

DeepSeek는 이미 `deepseek-v4-pro`/`deepseek-v4-flash` 두 모델을 제공하고(`docs/reference/deepseek-api.md`), `lib/ai/deepseekClient.ts`의 `complete()`/`completeStream()`이 이미 `options?.model`을 받는다. 각 파이프라인 호출부에 `{ model: "deepseek-v4-flash" }`(또는 pro)를 명시.

- 1,2단계(pro): `lib/pipeline/convertMarkdown.ts`, `lib/pipeline/splitScenes.ts`
- 3,4,5단계(flash): `lib/pipeline/selectScreenTypes.ts`, `lib/pipeline/designVisuals.ts`, `lib/pipeline/reviewConsistency.ts`

## Phase 1 — AI 작업 엔진 ✅

**설계 원칙**: 세 가지 독립된 메커니즘으로 분리한다.
1. **작업 레지스트리**(`lib/jobs/registry.ts`) — 프로세스 내 메모리, `Map<"projectId:step", AiJob>`. `AbortController`를 들고 있으며 "지금 실행 중인가/취소" 판단의 유일한 근거. `startJob()`이 이미 실행 중이면 예외를 던져 파일 I/O가 시작되기도 전에 중복 실행을 원천 차단한다.
2. **증분 디스크 저장**(`lib/projects/store.ts`의 `mergeProjectJsonMap`) — `screen-types`/`visual-design`처럼 씬별로 실제 반복 호출하는 두 단계에만 적용.
3. **상태 폴링**(`GET/DELETE /api/projects/[projectId]/jobs/[step]`) — 새로 마운트된 화면이 이미 실행 중인 작업을 발견해 disk-backed 부분 데이터(screen-types/visual-design) 또는 메모리에 누적된 raw 텍스트(markdown/scenes/review)를 즉시 반영하고, 이후 폴링으로 계속 갱신.

메모리 기반 레지스트리는 서버(개발) 프로세스 재시작 시 소실됨(로컬 1인 도구 특성상 수용). `globalThis`에 Map을 스태시해 Turbopack의 무관한 모듈 재평가에서도 살아남게 함.

**핵심 파일**: `lib/jobs/registry.ts`(+test), `lib/ai/deepseekClient.ts`(signal 지원), `lib/pipeline/*.ts`(5개, signal 스레딩 + selectScreenTypes/designVisuals 옵션객체 리팩터링), `lib/projects/store.ts`(`mergeProjectJsonMap`), `app/api/projects/[projectId]/jobs/[step]/route.ts`(신규), 5개 AI 라우트(startJob/cancel/finishJob 훅), `lib/client/useAiJob.ts`(신규), 5개 Editor 컴포넌트 마이그레이션.

**채택한 기본값**: 취소 시 부분 저장 데이터는 롤백하지 않음 / 레지스트리는 메모리 전용(재시작 시 소실) / 라우트 레벨 테스트는 추가하지 않고 기존처럼 순수 모듈(`lib/**`) 단위 테스트 컨벤션 유지 / `scenes.json`은 씬별 반복 호출 구조가 아니라 단일 호출이라 이번 Phase의 증분 저장 대상에서 제외(진짜 씬 단위 저장은 `splitScenes` 자체의 재설계가 필요한 별도 작업).

## Phase 2 — 디자인 셸 (다음 세션 착수)

**현황**: shadcn "base-nova" 테마는 `app/globals.css`에 이미 완전히 세팅되어 있음(oklch 변수, 다크모드 토큰까지 정의되어 있으나 토글 UI는 없음). `components/ui/`에는 `badge, button, card, input, table, textarea` 6개만 존재 — `Card`/`Badge`는 정의만 되어 있고 앱 어디에서도 실제 사용되지 않음. 모든 페이지가 `mx-auto max-w-3xl p-8`를 손으로 반복 중(유일한 예외: `app/projects/new/page.tsx`의 `max-w-xl`). 상단 nav(`app/projects/[projectId]/layout.tsx`)는 sticky 아님, 푸터 없음.

**계획**:
1. `components/ui/`에 `shadcn add progress select dialog`로 부족한 컴포넌트 보강 — 최소 `Progress`, `Select`(Phase 5용)는 필수.
2. 공용 셸 컴포넌트 신설: `app/AppShell.tsx` — `max-w-[1000px] mx-auto` 중앙 컬럼 + 좌우 `bg-muted` 여백, sticky 헤더(프로젝트명 + 6단계 진행 상황 배지), sticky 푸터(이전/다음 단계 이동 버튼 — 현재 각 Editor 내부의 "다음 단계" 버튼을 이 공용 푸터로 이동).
3. `app/projects/[projectId]/layout.tsx`를 `AppShell` 사용하도록 교체.
4. `app/layout.tsx`: `lang="en"` → `lang="ko"`.
5. 기존 raw `border`/`bg-gray-*`/`text-gray-*` 클래스를 `Card`/shadcn 토큰으로 전 페이지 일괄 치환.
6. Editor의 "다음 단계" 버튼을 셸 푸터로 옮기려면 "지금 다음으로 넘어가도 되는지" 상태를 셸에 노출해야 함 — Context 또는 콜백 전달 방식 권장.

## Phase 3 — 홈 & 새 프로젝트 (다음 세션 착수)

**홈** (`app/page.tsx`, `app/ProjectListItem.tsx`): `PipelineStep` 7단계를 신호등 색상에 매핑(미시작=회색, 진행중=노랑, 완료=초록), `Badge` 컴포넌트 활용. 목록을 `Card`로 교체. 삭제 기능은 이미 존재, 유지.

**새 프로젝트** (`app/projects/new/page.tsx`, `app/api/projects/upload/route.ts`): 현재 파일 업로드가 필수이고 텍스트 입력 코드는 전무. 탭/라디오로 "파일 업로드" / "텍스트 붙여넣기" 전환 UI 추가. `upload/route.ts`에 분기 추가: `file` 없고 `text` 필드 있으면 `extractText` 생략하고 바로 `writeProjectFile(project.id, "extracted.txt", text)`. 파일 입력 박스 CSS 스타일링. `max-w-xl` → `max-w-3xl` 통일.

## Phase 4 — 1단계/2단계 (다음 세션 착수)

**1단계**: 헤더 텍스트 "마크다운 변환" → "원고 변환". "2~6단계까지 자동 진행" 버튼: 반자동 — 생성 완료 후 결과는 그대로 보여주되 "다음 단계" 클릭이 자동으로 이어짐. `useAiJob` 훅과 결합해 URL 쿼리 파라미터(`?auto=1`)로 페이지 간 자동진행 플래그 전달 권장.

**2단계** (`SceneListEditor.tsx`, `lib/pipeline/splitScenes.ts`):
- "사유:" 라벨 텍스트만 제거 (`SceneListEditor.tsx`의 `· 사유: {scene.splitReason}` 문구).
- 씬 삭제: 삭제된 텍스트는 인접 씬(다음 우선, 없으면 이전)의 `narrationText`에 자동 병합 권장(완전 삭제는 `validateNarrationIntegrity` 위반).
- 씬 병합: 인접 씬들의 `narrationText`를 원문 순서대로 이어붙이고 `estimatedDurationSec` 합산, `order`/`id` 재정렬.
- PUT 라우트는 이미 전체 배열 검증+덮어쓰기라 라우트 변경 불필요.

## Phase 5 — 3-4단계 통합 + 코드 기반 비주얼 설계 (다음 세션 착수, 가장 큰 Phase)

**구조화 유형 초안 제안** (기존 5종 확장):

| # | 유형 | 용도 |
|---|---|---|
| 1 | 텍스트 강조형 | 핵심 정의/한 문장 강조 |
| 2 | 인물 등장형 | 강사 등장, 도입/전환 |
| 3 | 이미지 설명형 | 단일 이미지+설명 |
| 4 | 표/그래프형 | 데이터 비교 |
| 5 | 절차 애니메이션형 | 순서/프로세스 |
| 6 | 비교 대조형(좌우 2분할) | A vs B 비교 |
| 7 | 타임라인형 | 시간 순서 나열 |
| 8 | 인용/사례형 | 사례·인용구 강조 |
| 9 | 체크리스트형 | 항목 나열(학습목표 등) |
| 10 | 요약/정리형 | 챕터 마무리 |

각 유형별로 코드로만 결정되는 레이아웃 스펙을 `lib/visual-templates/*.ts`에 순수 함수로 정의 — `(scene, screenType) => VisualDesign`(AI 호출 없음).

**단계 통합**: `PipelineStep`의 `screen-types`+`visual-design`을 하나(예: `screen-design`)로 축소. 화면/라우트 통합(`app/projects/[projectId]/screen-design/`). AI는 화면 유형 **선택**만 수행(flash), 선택 즉시 코드 템플릿으로 `VisualDesign` 계산. 씬별 재생성 버튼은 Phase 1 인프라 재사용. 이 통합이 `docs/ROADMAP.md`의 기존 성능 이슈(씬별 순차 AI 호출 지연)를 부수적으로 완화.

## Phase 6 — 미리보기 화면 (다음 세션 착수)

신규 페이지(`app/projects/[projectId]/preview/`) — 좌측 고정 목차(씬 id 앵커), 본문에 구조화 화면(Phase 5)과 AI 이미지(Phase 7)를 나란히 표시, 하단 고정 좌/우 이동 버튼.

## Phase 7 — 7단계: AI 이미지 생성 (다음 세션 착수)

- `lib/ai/openaiImageClient.ts`(+ `.mock.ts`) — `deepseekClient.ts`와 동일한 인터페이스 분리 패턴. 모델명 `"gpt-image-2"`(미검증, 상수 한 곳에만 정의), 옵션 `{ quality: "low", size: "1536x1024" }`.
- 새 파이프라인 모듈 `lib/pipeline/generateSceneImage.ts`.
- 저장 위치: `data/projects/{id}/images/{sceneId}.png` — `lib/projects/store.ts`에 바이너리 저장 헬퍼 신설 필요.
- `PipelineStep`에 `images` 신규 값 추가, 씬별 재생성은 Phase 1 job 엔진 재사용.
- `OPENAI_API_KEY`는 이미 `.env.local`에 저장 완료.
