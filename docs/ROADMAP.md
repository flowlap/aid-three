# 향후 개발 계획

- 작성일: 2026-07-29
- v1(업로드 ~ 최종 스토리보드 뷰) 완료 이후의 작업 후보를 정리한 문서. 실제 착수 시에는 각 항목을 `superpowers:brainstorming`으로 다시 스펙화한 뒤 `superpowers:writing-plans`로 태스크 분해할 것 — 이 문서는 "무엇을 할지"의 후보 목록이지 실행 계획은 아니다.

## 우선순위 A — 다음에 바로 착수하기 좋은 작은 개선

기존 v1 최종 리뷰에서 발견됐지만 병합을 막을 정도는 아니라서 보류(park)된 항목들. 파일 하나~두 개, 각각 30분 내외로 끝날 만한 크기.

1. **`screen-types` PUT의 null-body 방어 누락** — `app/api/projects/[projectId]/screen-types/route.ts:59-67`. 형제 라우트(`visual-design/route.ts`)는 이미 `typeof body !== "object" || body === null` 가드가 있음. 동일 패턴 적용.
2. **`splitScenes.ts` AI 응답 요소 검증 강화** — 현재 `Array.isArray(parsed.scenes)`만 확인. `selectScreenTypes.ts`/`designVisuals.ts`/`reviewConsistency.ts`처럼 각 씬 객체의 필드 타입까지 검증하는 타입 가드 추가.
3. **서버 페이지의 `JSON.parse` 가드** — `scenes/page.tsx`, `screen-types/page.tsx`, `visual-design/page.tsx`, `review/page.tsx`, `storyboard/page.tsx`에 반복되는 read→parse→fallback 패턴을 `lib/projects/readProjectJson<T>(id, filename, fallback)` 헬퍼로 추출. 손상된 JSON 파일이 있을 때 Next 에러 화면 대신 사용자 친화적 에러를 보여주는 효과도 겸함.
4. **`app/layout.tsx`의 `lang="en"` → `lang="ko"`** — 1줄.
5. **`next dev -H 127.0.0.1`** — `package.json`의 `dev` 스크립트에 바인딩 제한 추가. 1줄.

## 우선순위 B — 스펙 보강이 필요한 UX 개선

1. **화면 유형 선정을 드롭다운으로 전환** — `lib/pipeline/selectScreenTypes.ts`의 `AVAILABLE_SCREEN_TYPES` 배열을 클라이언트와 공유하는 API(또는 상수 export)로 만들고, `ScreenTypeEditor.tsx`의 자유 텍스트 `Input`을 `<select>`로 교체. 스펙(설계 문서)이 원래 드롭다운을 의도했던 부분.
2. **일관성 검수 "중복 화면 확인" 구현** — 현재 "동일 레이아웃 반복"만 결정적 검사로 구현되어 있고, 스펙이 요구하는 7개 항목 중 "중복 화면 확인"(화면 구성 자체의 중복 — 캡션/이미지 설명 등 비주얼 설계 유사도 기준)은 미구현. 유사도 판단 기준을 먼저 브레인스토밍으로 정의 필요(단순 문자열 비교로 충분한지, AI 판단이 필요한지).

## 우선순위 C — 설계 스펙에 이미 명시된 v1 이후 발전 단계

설계 문서(`docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md`)의 "향후 발전" 섹션에 이미 명시되어 있던 두 항목. 각각 별도 스펙/계획이 필요한 규모.

1. **pptx 템플릿 업로드 → 씬별 삽입/내보내기**
   - pptx 템플릿 파일을 업로드하면 씬 별로 과정명/단원명/나레이션/설계 내용을 삽입해 내보내는 기능
   - `storyboard` 뷰(6단계)의 데이터를 소스로 사용
   - pptx 조작 라이브러리 선정(Node 생태계에서 `pptxgenjs` 등 검토 필요)이 첫 브레인스토밍 질문이 될 것
2. **씬별 AI 이미지 초안 생성**
   - OpenAI GPT Image 1.5 Low API로 각 씬의 `imageOrDiagramDescription`을 기반으로 이미지 초안 생성
   - `lib/ai/deepseekClient.ts`와 유사한 형태로 `lib/ai/openaiImageClient.ts` 인터페이스+mock 분리가 자연스러운 확장 지점
   - 생성된 이미지를 어디에 저장할지(`data/projects/{id}/images/`?), 재생성/버전 관리를 어떻게 할지 결정 필요

## 참고: 성능 관찰 (우선순위 미정, 재현되면 대응)

Task 13 라이브 E2E 검증 중 관찰된 사항: `selectScreenTypes.ts`/`designVisuals.ts`는 씬마다 DeepSeek API를 순차 호출(for 루프)한다. 8씬 스크립트에서 한 번 `ECONNRESET`/502(재시도로 해결)가 발생했고, 전체 응답까지 90초 이상 걸렸다. 씬 수가 늘어나는 실제 사용 사례(예: 20~30씬)에서 이 지연이 문제가 되면 `Promise.all` 병렬 호출이나 배치 프롬프트(한 번의 호출로 여러 씬 처리)를 고려할 것. 지금은 씬별 문맥(이전/다음 씬)이 필요해서 순차 호출을 선택한 것이므로, 병렬화하려면 프롬프트 설계를 다시 검토해야 한다.

## 진행 방식 메모

- 어떤 항목이든 착수 전에 `superpowers:brainstorming`부터 시작할 것 (특히 우선순위 C의 두 항목은 스펙 자체가 없음).
- 우선순위 A/B는 스펙 없이 바로 `writing-plans`로 넘어가도 될 만큼 범위가 작지만, 여러 개를 한 번에 묶지 말고 각각 독립된 작은 계획으로 처리할 것 — v1 최종 리뷰에서 "계획 자체가 놓친 요구사항"(비주얼 설계 편집 불가, 프로젝트 삭제 미연결)이 두 건 나왔던 만큼, 스펙-계획 매핑을 다시 한번 꼼꼼히 확인하는 습관이 필요함.
