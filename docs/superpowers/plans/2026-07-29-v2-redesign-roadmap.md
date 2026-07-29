# v2 대규모 개선 — 로드맵 및 Phase 1 실행 계획

- 작성일: 2026-07-29
- 이 문서는 사용자가 한 번에 요청한 v2 전면 개편 요청을 여러 개의 독립적으로 검증 가능한 Phase로 분해한 지속 계획 문서다. 세션/사용량 한계로 작업이 중단되어도 이 문서만 보고 이어갈 수 있도록 각 Phase의 상세 설계를 남긴다.

## Context

사용자가 한 번에 요청한 변경 범위: 전체 디자인 개편(1000px 중앙정렬, 고정 헤더/푸터, shadcn 테마 일관 적용), 모든 AI 작업에 대한 상태 관리(중복 실행 방지, 시작→진행중(진행율)/취소→완료/재작업 상태 머신), 화면별 기능 변경(홈 신호등 상태, 새 프로젝트 텍스트 입력, 1단계 명칭 변경+자동 진행, 2단계 씬 삭제/병합, 3단계 즉시저장+재진입 시 유지, 3-4단계 통합+코드 기반 비주얼 설계+구조화 유형 20종, 미리보기 신규 개발), AI 모델 이원화(1,2단계 pro/3,4,5단계 flash), 7단계 신규(OpenAI 이미지 생성).

이 요청은 사실상 앱의 거의 모든 화면과 아키텍처를 건드리는 v2 전면 개편이다. `docs/ROADMAP.md`에 명시된 프로젝트 진행 방식 — "여러 개를 한 번에 묶지 말고 각각 독립된 작은 계획으로 처리할 것" (v1 최종 리뷰에서 계획을 한 번에 묶었다가 요구사항 누락이 발생했던 경험에서 나온 교훈) — 을 따라, 이번 요청 전체를 하나의 실행으로 밀어붙이지 않고 여러 개의 독립적으로 검증 가능한 Phase로 분해한다.

**2026-07-29 세션에서 Phase 0~7 전체를 구현 완료했다.** v2 전면 개편 요청 전체가 이 세션에서 끝남 — 이 문서에 남은 "미착수" 항목은 없음. 각 Phase의 상세 구현 내용은 아래 섹션 참고(다음 세션에서 특정 기능을 다시 손봐야 할 때 무엇을 어떻게 했는지 참고용으로 남겨둠).

## 확인 완료 사항 (사용자 답변 반영됨)

1. **이미지 생성 모델명**: "GPT Image 2 Low" 확정(사용자 확인) → 구현 시 `"gpt-image-2"`로 매핑. ✅ Phase 7에서 실제 API 호출로 검증 완료 — 이 모델명이 그대로 동작하며 실제 이미지가 정상 생성됨.
2. **1단계 자동 진행 버튼**: 반자동 확정 — 각 단계 검토는 유지하되, 사용자가 확인/수정 후 누르는 "다음 단계" 클릭을 자동으로 이어서 트리거(생성까지는 자동, 검토·승인 없이 건너뛰지 않음). Phase 4에 반영.
3. **구조화 유형 20종**: Claude가 초안 제안 확정 — 기존 5종을 확장한 8~12종 초안을 먼저 설계하고, 이후 필요시 20종으로 확장. Phase 5에 반영.
4. **OpenAI API 키 로테이션 권고**: 채팅에 평문으로 붙여넣어진 키는 이미 `.env.local`(gitignore 대상, 커밋 안 됨)에 저장 완료. 다만 대화 로그에 남아있을 수 있으므로 OpenAI 대시보드에서 재발급을 권장함 (구현과 무관, 사용자 액션 필요).

## Phase 순서 및 각 Phase 개요

| Phase | 내용 | 의존성 | 상태 |
|---|---|---|---|
| 0 | AI 모델 이원화 (pro/flash) | 없음 | ✅ 완료 |
| 1 | AI 작업 엔진 (중복방지/진행상태/취소/재진입 유지) | 없음 | ✅ 완료 |
| 2 | 디자인 셸 (1000px+배경+고정 헤더/푸터+shadcn 일관화) | 없음 (Phase 1과 독립) | ✅ 완료 |
| 3 | 홈 신호등 UI + 새 프로젝트 텍스트 입력 | Phase 1(상태 조회), Phase 2(셸) 권장 | ✅ 완료 |
| 4 | 1단계 명칭변경+자동진행, 2단계 씬 삭제/병합 | Phase 1 | ✅ 완료 |
| 5 | 3-4단계 통합 + 코드 기반 비주얼 설계 + 구조화 유형 확장 | Phase 1 | ✅ 완료 |
| 6 | 미리보기 신규 화면 | Phase 5(구조화 화면 데이터), Phase 7(이미지) | ✅ 완료 |
| 7 | 5단계 — OpenAI 이미지 생성 | Phase 1(작업엔진 재사용) | ✅ 완료 |

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

## Phase 2 — 디자인 셸 ✅

당초 계획대로 `Progress`/`Select`/`Dialog` shadcn 컴포넌트 추가는 보류 — 이번 Phase 범위(셸+버튼 이동+토큰 치환)에서 실제로 쓰이는 곳이 없어 미사용 컴포넌트를 추가하지 않았음. `Select`는 실제 사용처가 생기는 Phase 5에서 추가.

**구현**:
1. `lib/client/StepNavContext.tsx`(신규) — Editor가 자신의 "다음 단계" 버튼 스펙(label/disabled/onClick)을 셸 푸터에 등록하는 `useNextStepAction(label, disabled, onClick)` 훅. `onClick`은 ref로 들고 있어 매 렌더마다 재등록하지 않고, `label`/`disabled` 변경 시에만 이펙트 재실행.
2. `app/AppShell.tsx`(신규, client component) — `max-w-[1000px] mx-auto` 중앙 컬럼 + 좌우 `bg-muted` 여백, sticky 헤더(프로젝트명 + 6단계 진행 상황 배지, 현재 단계는 `Badge variant="default"`로 강조), sticky 푸터(왼쪽 "이전 단계"/1단계에서는 "홈"으로 링크, 오른쪽은 `StepNavProvider`로 등록된 다음 단계 버튼 — 없으면 빈 자리).
3. `app/projects/[projectId]/layout.tsx`는 서버 컴포넌트로 유지, `AppShell`을 렌더만 위임.
4. `app/layout.tsx`: `lang="en"` → `lang="ko"`.
5. 5개 Editor(`MarkdownEditor`/`SceneListEditor`/`ScreenTypeEditor`/`VisualDesignEditor`/`ReviewIssueList`) 내부의 "다음 단계"(또는 "최종 스토리보드 보기") 버튼 JSX를 제거하고 `useNextStepAction(...)` 호출로 대체.
6. 6개 step `page.tsx`에서 `<main className="mx-auto max-w-3xl p-8">` 래퍼 제거 — 셸이 이미 중앙 컬럼/패딩을 제공.
7. `text-gray-*`/`bg-gray-*`/`bg-white`/`text-red-600`/`text-blue-600` 등 raw 색상 클래스를 `text-muted-foreground`/`bg-muted`/`text-destructive`/`text-primary` shadcn 토큰으로 전 페이지(홈, 새 프로젝트, storyboard 포함) 치환. `border` 유틸은 `globals.css`의 `* { @apply border-border }`로 이미 테마 색을 쓰고 있어 별도 치환 불필요했음.

**범위 밖(의도적으로 유지)**: 홈/새 프로젝트 페이지는 여전히 자체 `mx-auto max-w-3xl p-8`(새 프로젝트는 `max-w-xl`) 래퍼를 씀 — `AppShell`은 프로젝트 하위 6단계 페이지에만 적용되고, 홈/새 프로젝트의 구조 개편(신호등 UI, 텍스트 입력, `max-w` 통일)은 Phase 3 몫.

Playwright(headless Chromium)로 전 6단계 + 홈/새 프로젝트 생성 플로우를 스크린샷과 콘솔 에러 체크로 검증 완료(콘솔 에러 0건), `npx tsc --noEmit`/`eslint`/`npm test`(67 tests) 모두 통과.

## Phase 3 — 홈 & 새 프로젝트 ✅

**구현**:
1. `lib/projects/pipelineStatus.ts`(신규) — `PipelineStep` 7단계를 3단계 상태로 매핑하는 순수 함수. `upload`=미시작(회색), `markdown`~`review`(중간 5단계)=진행중(amber), `storyboard`=완료(green). 색상은 shadcn에 별도 success/warning 토큰이 없어 `bg-amber-500`/`bg-green-500`을 직접 사용(기존 코드의 경고 텍스트가 이미 `amber-600`을 쓰고 있어 일관됨).
2. `app/ProjectListItem.tsx` — `<li className="rounded border p-4">` 대신 `Card`(`flex-row` 오버라이드)로 교체, 제목 왼쪽에 상태 색 점(`h-2 w-2 rounded-full`) 표시.
3. `app/projects/new/page.tsx` — `sourceMode` state(`"file" | "text"`)로 두 개의 토글 `Button`(선택된 쪽만 `variant="default"`) 전환. 파일 모드는 기존 `<input type=file>`에 `file:*` Tailwind 클래스로 점선 박스 스타일 추가, 텍스트 모드는 `Textarea`. `max-w-xl` → `max-w-3xl`.
4. `app/api/projects/upload/route.ts` — `text` 폼 필드 분기 추가: `file`이 없고 `text`가 있으면 `extractText` 없이 바로 `writeProjectFile(id, "extracted.txt", text)`.

**주의**: `currentStep`은 각 단계의 PUT(사용자 저장) 핸들러가 아니라 POST(AI 생성) 핸들러에서만 갱신되는 기존 설계(v1부터)라서, 신호등 상태는 "AI 생성을 완료한 단계"를 반영한다 — 아직 실행 전인 데이터를 사용자가 수동으로 채워 넣고 다음 단계로 넘어가는 경로(v1에는 없는 흐름)라면 상태가 뒤처져 보일 수 있음. 이번 Phase에서 고치지 않은 기존 동작이며, 문제로 확인되면 별도 이슈로 다룰 것.

Playwright로 검증: 홈에서 3개 상태(미시작/진행중/완료) 색이 서로 다른 계열(회색/amber/초록)인지 DOM 계산 스타일로 직접 확인, 새 프로젝트 페이지의 토글 클래스가 클릭 시 실제로 뒤바뀌는지 확인, 텍스트 붙여넣기로 생성한 프로젝트가 `/markdown`으로 정상 이동하는지 확인. `tsc`/`eslint`/`npm test`(67 tests) 통과.

## Phase 4 — 1단계/2단계 ✅

**구현**:
1. `lib/client/useAutoProgress.ts`(신규) — `useAutoProgressFlag()`(URL의 `?auto=1` 읽기)와 `withAutoProgress(href, auto)`(다음 URL에 플래그 전달) 헬퍼.
2. 1단계: 헤더 "마크다운 변환" → "원고 변환"(page.tsx, AppShell 배지 라벨 모두). `MarkdownEditor`에 "자동 진행 (2~6단계)" 버튼 추가 — 저장 후 `/scenes?auto=1`로 이동.
3. 2~5단계(`SceneListEditor`/`ScreenTypeEditor`/`VisualDesignEditor`/`ReviewIssueList`) 각각에 동일 패턴의 자동조종 이펙트 한 쌍을 추가:
   - **마운트 시 1회 자동 생성**: `auto=1`이고 기존 데이터가 비어 있으면(review는 항상) `handleGenerate()` 자동 호출.
   - **생성 완료 시 자동 다음단계**: `loading`이 `true→false`로 바뀌는 순간, 에러 없고 결과가 "완전"하면(scenes: 무결성 OK / screen-types·visual-design: 모든 씬에 값 배정 / review: **이슈 0건**) 다음 단계로 자동 이동, 아니면 그 자리에서 자동조종 중단(`autoPilotRef.current = false`) — 이 안전장치 덕분에 나레이션 무결성 위반이나 검수 이슈가 있으면 사용자 확인 없이 건너뛰지 않는다(로드맵의 "검토·승인 없이 건너뛰지 않음" 요건을 코드 레벨로 구현).
   - `react-hooks/set-state-in-effect` 린트 규칙 때문에 이펙트 안에서 직접 `handleNext()`를 호출하지 않고 `queueMicrotask(() => void handleNext())`로 감쌈.
4. 2단계(`SceneListEditor.tsx`): `· 사유: {scene.splitReason}` 텍스트 제거. 씬별 "삭제"(마지막 1개는 비활성화, 인접 씬으로 텍스트+시간 병합 — 다음 씬 우선, 없으면 이전 씬)와 "다음 씬과 병합" 버튼 추가. 병합/삭제 후 `order`만 1..N으로 재정렬하고 `id`는 유지(살아남은 씬의 기존 id 그대로) — 단계 간 무효화 없음 원칙상 뒤 단계가 이미 이 id들을 참조하고 있을 수 있어 불필요한 id 변경으로 인한 참조 깨짐을 피함. PUT 라우트는 기존 그대로(스키마 검증만, 무결성 재검사 없음 — 수동 편집은 원래도 무결성 재검사 대상이 아니었음).

Playwright + 실제 DeepSeek API로 검증: 새 프로젝트에서 1단계 자동 진행 버튼 클릭 → 씬 분할·화면 유형·비주얼 설계까지 자동으로 연쇄 진행되는 것을 `project.json`의 `currentStep` 변화로 직접 확인, 5단계(일관성 검수)에서 실제로 이슈 1건이 발견되자 자동조종이 정확히 멈추고 "최종 스토리보드 보기" 버튼이 수동 클릭 대기 상태로 남는 것을 스크린샷으로 확인, 수동 클릭 시 정상적으로 스토리보드 도달 확인. 2단계 삭제/병합은 별도 프로젝트에서 병합(시간 10+8=18초 합산, 텍스트 순서대로 연결) → 삭제(추가로 12초 합산되어 30초, 3개 문장 연결) 순으로 실제 클릭까지 재현해 확인. `tsc`/`eslint`/`npm test`(71 tests) 통과.

**참고**: Phase 5에서 3-4단계를 `screen-design`으로 통합하면 이 자동조종 배선(2번 항목의 이펙트 쌍)을 통합된 단계에 맞게 다시 배선해야 한다 — 지금 형태 그대로 재사용 불가.

## Phase 5 — 3-4단계 통합 + 코드 기반 비주얼 설계 ✅

**구조화 유형 10종** (기존 5종 확장, `lib/visual-templates/index.ts`의 `SCREEN_TYPE_OPTIONS`):

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

**구현**:
1. `lib/visual-templates/index.ts`(신규, +test) — `computeVisualDesign(scene, screenType): VisualDesign`. 유형별 레이아웃/등장순서/제작지시 템플릿 + 공용 키워드 추출(불용어 제거 후 처음 N개 고유 단어, 형태소 분석은 아님 — 조사가 붙은 채로 나올 수 있는 알려진 한계)/캡션 truncate 헬퍼. 인식 못하는 화면 유형 문자열은 "이미지 설명형" 템플릿으로 폴백. AI(`selectScreenTypes`)의 근거(`rationale`)는 `productionNotes`에 이어붙여 보존.
2. `lib/pipeline/selectScreenTypes.ts` — `AVAILABLE_SCREEN_TYPES`(5종, 로컬 정의) 제거하고 `SCREEN_TYPE_OPTIONS`(10종, 공유 상수) import. 기존 5종 라벨은 새 10종에 그대로 포함되어 있어 기존 테스트 무변경으로 통과.
3. `lib/pipeline/designVisuals.ts` — AI 호출 함수·검증기 전부 삭제, `VisualDesign` 타입 정의만 남김(더 이상 AI로 비주얼을 설계하지 않으므로). `designVisuals.test.ts` 삭제.
4. `PipelineStep`(`lib/projects/types.ts`)에서 `screen-types`/`visual-design` 제거하고 `screen-design` 하나로. `lib/jobs/registry.ts`의 `PIPELINE_JOB_STEPS`, `lib/projects/pipelineStatus.ts`의 상태 매핑도 동기화.
5. 라우트: `app/api/projects/[projectId]/screen-types/`, `.../visual-design/` 삭제 → `app/api/projects/[projectId]/screen-design/route.ts`(신규) — POST는 `selectScreenTypes`의 `onProgress` 콜백 안에서 `computeVisualDesign`을 즉시 호출해 씬 하나당 screenType+visualDesign을 함께 스트리밍하고 `screen-design.json`(`{screenTypes, visualDesigns}` 한 파일, 두 top-level 키 각각 `mergeProjectJsonMap` 호출)에 증분 저장. PUT은 두 맵을 함께 검증/저장(body가 `null`인 경우의 가드를 포함 — 이 가드 누락이 v1 `screen-types` PUT에 있던 기존 버그였는데, 새로 작성하면서 처음부터 포함시켜 해결됨. `docs/ROADMAP.md` 우선순위 A #1 항목도 정리).
6. `app/api/projects/[projectId]/screen-design/[sceneId]/route.ts`(신규) — 씬 하나만 재생성(AI 1회 호출 + 코드 계산). 즉시 끝나는 단발 요청이라 작업 레지스트리(Phase 1)를 쓰지 않는 별도의 가벼운 엔드포인트로 구현(전체 재생성만 job 엔진 사용).
7. `app/api/projects/[projectId]/jobs/[step]/route.ts`의 `PARTIAL_DATA_FILES`를 `screen-design` 하나로 교체.
8. `app/api/projects/[projectId]/review/route.ts` — `screen-types.json`+`visual-design.json` 두 파일 대신 `screen-design.json` 하나에서 `screenTypes`/`visualDesigns`를 함께 읽음. `reviewConsistency.ts`는 두 값을 여전히 별개 인자로 받으므로 **무변경**.
9. UI: `app/projects/[projectId]/screen-types/`, `.../visual-design/` 디렉터리 삭제 → `app/projects/[projectId]/screen-design/{page.tsx,ScreenDesignEditor.tsx}`(신규) — 화면 유형 필드(자유 텍스트, Phase 5 범위 밖 — 드롭다운 전환은 `docs/ROADMAP.md` 우선순위 B에 남김)와 비주얼 설계 필드를 씬 카드 하나에 함께 편집, 씬별 "이 씬만 재생성" 버튼 포함. Phase 4의 자동진행 이펙트 쌍(마운트 시 자동생성 / 완료 시 자동 다음단계, 무결성·완전성 체크로 안전정지)을 그대로 이식 — "완전함" 기준은 `scenes.every(s => screenTypes[s.id]?.screenType)`.
10. `app/AppShell.tsx`의 `STEPS`를 6개→5개로 축소(`1.원고변환/2.씬분할/3.화면설계/4.일관성검수/5.최종뷰`), `SceneListEditor`의 다음 이동지·`ReviewIssueList`의 "수정하러 가기" 링크·`storyboard/page.tsx`의 파일 읽기를 전부 `screen-design`으로 갱신.
11. `docs/reference/pipeline-steps.md`, `docs/PROJECT_OVERVIEW.md`, `docs/ROADMAP.md`를 새 구조(5단계, `screen-design.json`)에 맞춰 갱신.

**범위 밖(의도적으로 유지)**: 화면 유형 입력은 여전히 자유 텍스트 `Input`(드롭다운 전환은 `SCREEN_TYPE_OPTIONS`가 이미 공유 상수라 쉬워졌지만 별도 작업, shadcn `Select` 컴포넌트 추가 필요).

Playwright + 실제 DeepSeek API로 검증: 새 프로젝트에서 1~3단계를 실제로 진행해 `screen-design.json`에 `screenTypes`/`visualDesigns`가 씬별로 정상 저장되는지 확인, "이 씬만 재생성" 버튼이 정지 없이 완료되는지 확인, 4~5단계(일관성 검수 → 최종 스토리보드)까지 실제 클릭으로 도달해 스토리보드가 `screen-design.json` 하나에서 정상적으로 조합 렌더링되는지 확인. 콘솔 에러 0건. `next build` 프로덕션 빌드로 라우트 트리(구 `screen-types`/`visual-design` 라우트 소멸, 신규 `screen-design`/`screen-design/[sceneId]` 존재)까지 확인. `tsc`/`eslint`/`npm test`(67 tests) 통과.

## Phase 7 — 5단계: AI 이미지 생성 ✅

의존성 순서상(Phase 6이 이 Phase의 이미지 데이터를 필요로 함) Phase 6보다 먼저 구현.

**구현**:
1. `lib/ai/openaiImageClient.ts`(+ `.mock.ts`) — `deepseekClient.ts`와 동일한 인터페이스 분리 패턴(`OpenAiImageClient.generateImage(prompt, options) => Promise<Buffer>`). 모델명은 `OPENAI_IMAGE_MODELS.default = "gpt-image-2"` 한 곳에만 정의(실제로 호출해보니 이 모델명이 그대로 동작함 — 실제 이미지가 정상 생성됨, 검증 완료). `quality: "low"`, `size: "1536x1024"` 고정.
2. `lib/pipeline/generateSceneImage.ts`(+test) — `buildImagePrompt(scene, design)` 순수 함수(화면 설명+객체배치+나레이션 조합, 실제 얼굴/텍스트 렌더링 없이 삽화 스타일 지시) + `generateSceneImage(client, scene, design, options)`.
3. `lib/projects/store.ts` — `projectImagesDir`, `writeProjectImage`/`readProjectImage`(Buffer 단위, PNG 고정)/`listProjectImageIds`(존재하는 씬 id 목록, 별도 인덱스 파일 없이 디렉터리 스캔). `assertSafeSceneId`(영숫자/`-`/`_`만 허용)로 경로 검증.
4. `PipelineStep`에 `images` 추가(review와 storyboard 사이). `PIPELINE_JOB_STEPS`, `pipelineStatus.ts`도 동기화.
5. `app/api/projects/[projectId]/images/route.ts`(POST, 전체 씬 순차 생성 — job 엔진 사용, screen-design과 동일한 스트리밍+진행률 패턴이나 저장은 JSON 병합이 아니라 `writeProjectImage` 바이너리 저장). `app/api/projects/[projectId]/images/[sceneId]/route.ts`(GET: PNG 서빙, `Content-Type: image/png`, 404 처리 / POST: 씬 하나만 재생성 — `screen-design/[sceneId]`와 동일하게 job 엔진 미사용 단발 요청).
6. UI: `app/projects/[projectId]/images/{page.tsx,ImagesEditor.tsx}`(신규) — 씬 카드마다 `<img src="/api/.../images/{sceneId}?v={version}">`(재생성 시 버전 증가로 캐시 무력화) + "이 씬만 재생성"/"이 씬만 생성" 버튼. **이 단계는 필수가 아님** — "다음 단계" 버튼이 이미지 유무와 무관하게 항상 활성화(실제 과금되는 OpenAI 호출이라 강제하지 않음).
7. `ReviewIssueList.tsx`의 "최종 스토리보드 보기" 버튼을 "다음 단계"로 이름 바꾸고 목적지를 `/storyboard`(직접 이동+`currentStep` 갱신)에서 `/images`(단순 이동, `currentStep` 갱신 없음 — 이미지 단계 자체 생성 시에 갱신)로 변경. `images` 단계의 "다음 단계"가 기존에 review가 하던 `POST /api/projects/{id}/storyboard`(currentStep 갱신) 호출을 이어받음.
8. **자동진행 경계**: Phase 4의 `?auto=1` 자동조종은 review까지만 자동 진행하고 **images 단계로는 자동 진행하지 않도록 의도적으로 제한**(`ReviewIssueList.tsx`에서 자동-다음단계 이펙트 자체를 제거) — 무료/저비용 DeepSeek 텍스트 호출과 달리 이미지 생성은 실제 과금되는 호출이 씬마다 발생하므로, 사용자의 명시적 클릭 없이 자동으로 트리거되지 않게 함.
9. `app/AppShell.tsx`의 `STEPS`를 6개로 확장(`.../4.일관성검수/5.이미지생성/6.최종뷰`).

**범위 밖(의도적으로 유지)**: 스토리보드(`storyboard`) 뷰는 아직 이미지를 표시하지 않음 — 구조화 화면과 이미지를 나란히 보여주는 것은 Phase 6의 `preview` 화면 몫.

Playwright + **실제 OpenAI API**로 검증: 실제 `gpt-image-2` 호출로 "변수는 값을 저장하는 상자입니다" 나레이션에 대해 상자에 값이 담기는 삽화가 실제로 생성됨(1.16MB PNG, 200 응답, `image/png` Content-Type) — 나레이션 내용과 시각적으로 정확히 일치하는 결과물로 프롬프트 설계와 모델명이 모두 유효함을 확인. `next build` 프로덕션 빌드로 신규 라우트 확인. `tsc`/`eslint`/`npm test`(75 tests) 통과.

## Phase 6 — 미리보기 화면 ✅

**구조 결정**: 이 화면은 AppShell(1000px, 상단 헤더+하단 다음버튼)과 완전히 다른 셸(좌측 사이드바 TOC + 하단 씬 이동 바)이 필요했다. Next.js App Router는 레이아웃이 디렉터리 트리를 따라 강제 상속되므로, `app/projects/[projectId]/layout.tsx`(AppShell) 밑에 그냥 `preview/`를 추가하면 AppShell이 강제로 씌워진다. 이를 피하려고 **라우트 그룹으로 리팩터링**: 6개 파이프라인 단계 디렉터리(`markdown`/`scenes`/`screen-design`/`review`/`images`/`storyboard`)와 그 `layout.tsx`(AppShell 렌더)를 전부 `app/projects/[projectId]/(pipeline)/` 밑으로 이동(URL 경로에는 영향 없음 — 라우트 그룹은 URL에서 제외됨). `preview/`는 `(pipeline)/` 밖의 형제 디렉터리로 둬서 AppShell을 상속받지 않고 루트 레이아웃만 적용받게 함.

**구현**:
1. `app/projects/[projectId]/preview/{page.tsx,PreviewViewer.tsx}`(신규) — 서버 컴포넌트가 `scenes.json`+`screen-design.json`+`listProjectImageIds`를 읽어 클라이언트 뷰어에 전달.
2. `PreviewViewer.tsx` — 좌측 sticky 사이드바(전체 씬 목록, `<a href="#sceneId">` 앵커 링크, `IntersectionObserver`로 현재 보이는 씬을 감지해 강조), 본문은 모든 씬을 카드로 세로 나열(화면 유형 배지 + 이미지 유무에 따라 실제 이미지 또는 "생성된 이미지가 없습니다" 플레이스홀더 + 캡션/설명/키워드를 이미지 옆에, 나레이션은 카드 하단), 하단 고정 바에 "← 이전 씬"/"다음 씬 →" 버튼(`scrollIntoView`로 이동) + "N / 전체" 카운터.
3. `storyboard/page.tsx`에 "미리보기로 보기" 버튼 추가(발견 경로 확보 — 이 화면은 AppShell의 선형 단계 목록에는 없음, 스토리보드에서 진입).

**알려진 사소한 한계**: `IntersectionObserver`의 활성 씬 감지가 빠른 연속 스크롤 시 살짝 지연될 수 있음(TOC 강조/카운터가 실제 스크롤 위치보다 한 박자 늦게 갱신) — 스크롤/앵커 이동 자체는 항상 정확하게 동작하므로 기능상 문제는 아니고 강조 표시의 타이밍만 다소 부정확. 우선순위 낮음.

Playwright로 검증: 3개 씬(이미지 없음 상태)으로 미리보기 진입, TOC 클릭 시 실제 스크롤 이동 확인, 하단 "이전 씬" 버튼 클릭 시 스크롤 이동 확인, 콘솔 에러 0건. 라우트 그룹 리팩터링 직후 실수로 프로덕션 빌드(`next build`)를 개발 서버가 켜진 상태에서 실행해 `.next` 캐시가 깨져 개발 서버가 500을 반환하는 사고가 있었음 — 개발 서버 재시작(`.next` 삭제 후 `npm run dev` 재기동)으로 해결. **교훈: 개발 서버가 떠 있는 동안 `next build`를 같은 `.next` 디렉터리에 대고 실행하지 말 것.**
