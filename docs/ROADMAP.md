# 향후 개발 계획

- 작성일: 2026-07-29
- v1(업로드 ~ 최종 스토리보드 뷰) 완료 이후의 작업 후보를 정리한 문서. 실제 착수 시에는 각 항목을 `superpowers:brainstorming`으로 다시 스펙화한 뒤 `superpowers:writing-plans`로 태스크 분해할 것 — 이 문서는 "무엇을 할지"의 후보 목록이지 실행 계획은 아니다.
- **2026-07-29 업데이트**: v2 전면 개편 요청이 들어와 [`docs/superpowers/plans/2026-07-29-v2-redesign-roadmap.md`](superpowers/plans/2026-07-29-v2-redesign-roadmap.md)로 별도 Phase 계획을 남겼고, 같은 세션에서 **Phase 0~7 전체를 완료**함. 아래 우선순위 B의 "화면 유형 드롭다운"과 우선순위 C의 "씬별 AI 이미지 생성"은 그 문서의 Phase 5/7로 대체되어 이미 구현됨.
- **2026-07-29 추가 업데이트**: v2 완료 직후 전체 화면 디자인 평가를 진행해 [`docs/DESIGN_REVIEW.md`](DESIGN_REVIEW.md)에 발견 사항(모바일 레이아웃 버그 3건 포함)과 개선 계획(D1~D8)을 남김. D1~D8 전부 구현 완료.
- **2026-07-29 세 번째 업데이트**: D1~D8이 색상 토큰 위주였다는 피드백에 따라 Notion `DESIGN.md` 레퍼런스를 기반으로 레이아웃/여백/정보 위계 중심의 전체 UI 재설계를 완료 — 홈, 새 프로젝트, 6단계 파이프라인, 미리보기까지 9개 화면 전부. 상세 내용은 `DESIGN_REVIEW.md`의 "전체 UI 재설계" 섹션 참고. 이 문서(ROADMAP)의 우선순위 A/B/C 항목은 이 재설계와 무관하게 그대로 유효함 — 다음 착수 시 참고.
- **2026-08-07 업데이트**: 씬·시퀀스 이중 제작 모드(dual production mode) 기능을 브레인스토밍 → 계획(10개 태스크) → 구현까지 완료. 프로젝트 생성 시 선택하는 `productionMode`(`"scene"` 기본값 | `"sequence"` opt-in)에 따라 시퀀스 설계 단계, 시퀀스 마스터 비주얼, 시퀀스 인지 씬 이미지 생성, ffmpeg crop 기반 카메라 모션/오버레이 영상 렌더링이 추가된다. 레거시 프로젝트와 씬 모드의 기존 동작은 전부 하위호환 유지. 상세는 [`docs/superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md`](superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md), 아키텍처 요약은 [`docs/PROJECT_OVERVIEW.md`](PROJECT_OVERVIEW.md)의 "씬·시퀀스 이중 제작 모드" 섹션 참고.

## 우선순위 A — 다음에 바로 착수하기 좋은 작은 개선

기존 v1 최종 리뷰에서 발견됐지만 병합을 막을 정도는 아니라서 보류(park)된 항목들. 파일 하나~두 개, 각각 30분 내외로 끝날 만한 크기.

1. ~~`screen-types` PUT의 null-body 방어 누락~~ — Phase 5에서 `screen-types`/`visual-design`이 `screen-design`으로 통합되며 새 라우트(`app/api/projects/[projectId]/screen-design/route.ts`)를 처음부터 `typeof body !== "object" || body === null` 가드와 함께 작성해 해결됨.
2. **`splitScenes.ts` AI 응답 요소 검증 강화** — 현재 `Array.isArray(parsed.scenes)`만 확인. `selectScreenTypes.ts`/`reviewConsistency.ts`처럼 각 씬 객체의 필드 타입까지 검증하는 타입 가드 추가.
3. **서버 페이지의 `JSON.parse` 가드** — `scenes/page.tsx`, `screen-design/page.tsx`, `review/page.tsx`, `storyboard/page.tsx`에 반복되는 read→parse→fallback 패턴을 `lib/projects/readProjectJson<T>(id, filename, fallback)` 헬퍼로 추출. 손상된 JSON 파일이 있을 때 Next 에러 화면 대신 사용자 친화적 에러를 보여주는 효과도 겸함.
4. **`app/layout.tsx`의 `lang="en"` → `lang="ko"`** — 1줄.
5. **`next dev -H 127.0.0.1`** — `package.json`의 `dev` 스크립트에 바인딩 제한 추가. 1줄.

## 우선순위 B — 스펙 보강이 필요한 UX 개선

1. **화면 유형 선정을 드롭다운으로 전환** — Phase 5에서 화면 유형 10종 목록이 `lib/visual-templates`의 `SCREEN_TYPE_OPTIONS`(export된 상수)로 이미 공유 가능해졌다. `components/ui/select.tsx`도 [`docs/DESIGN_REVIEW.md`](DESIGN_REVIEW.md) D6 작업 중 추가됨(새 프로젝트 페이지의 "타입" 필드에 이미 사용 중). 남은 작업은 `ScreenDesignEditor.tsx`의 자유 텍스트 `Input`을 `SCREEN_TYPE_OPTIONS` 기반 `Select`로 교체하는 것뿐.
2. **일관성 검수 "중복 화면 확인" 구현** — 현재 "동일 레이아웃 반복"만 결정적 검사로 구현되어 있고, 스펙이 요구하는 7개 항목 중 "중복 화면 확인"(화면 구성 자체의 중복 — 캡션/이미지 설명 등 비주얼 설계 유사도 기준)은 미구현. 유사도 판단 기준을 먼저 브레인스토밍으로 정의 필요(단순 문자열 비교로 충분한지, AI 판단이 필요한지).

## 우선순위 C — 설계 스펙에 이미 명시된 v1 이후 발전 단계

설계 문서(`docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md`)의 "향후 발전" 섹션에 이미 명시되어 있던 두 항목. 각각 별도 스펙/계획이 필요한 규모.

1. **pptx 템플릿 업로드 → 씬별 삽입/내보내기**
   - pptx 템플릿 파일을 업로드하면 씬 별로 과정명/단원명/나레이션/설계 내용을 삽입해 내보내는 기능
   - `storyboard` 뷰(최종 단계)의 데이터를 소스로 사용
   - pptx 조작 라이브러리 선정(Node 생태계에서 `pptxgenjs` 등 검토 필요)이 첫 브레인스토밍 질문이 될 것
2. ~~**씬별 AI 이미지 초안 생성**~~ — 완료됨(`lib/pipeline/generateSceneImage.ts`, `data/projects/{id}/images/{sceneId}.png`). 이후 2026-08-03에 `lib/ai/deepseekClient.ts`/`lib/ai/openaiImageClient.ts`를 `LlmClient`/`ImageClient` 인터페이스로 일반화하고 사내 H-CHAT 게이트웨이(Claude/ChatGPT/Gemini/Gemini 이미지)를 provider 선택지로 추가함 — 상세는 [`docs/superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md`](superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md) 참고.

## 참고: 성능 관찰 (우선순위 미정, 재현되면 대응)

Task 13 라이브 E2E 검증 중 관찰된 사항: `selectScreenTypes.ts`는 씬마다 DeepSeek API를 순차 호출(for 루프)한다. 8씬 스크립트에서 한 번 `ECONNRESET`/502(재시도로 해결)가 발생했고, 전체 응답까지 90초 이상 걸렸다. 씬 수가 늘어나는 실제 사용 사례(예: 20~30씬)에서 이 지연이 문제가 되면 `Promise.all` 병렬 호출이나 배치 프롬프트(한 번의 호출로 여러 씬 처리)를 고려할 것. 지금은 씬별 문맥(이전/다음 씬)이 필요해서 순차 호출을 선택한 것이므로, 병렬화하려면 프롬프트 설계를 다시 검토해야 한다. (Phase 5에서 비주얼 설계 쪽 AI 호출은 코드 템플릿으로 대체되어 이 병목에서 빠졌지만, 화면 유형 선정 자체는 여전히 씬별 순차 호출이라 지연은 그대로 남아있음.)

## 진행 방식 메모

- 어떤 항목이든 착수 전에 `superpowers:brainstorming`부터 시작할 것 (특히 우선순위 C의 두 항목은 스펙 자체가 없음).
- 우선순위 A/B는 스펙 없이 바로 `writing-plans`로 넘어가도 될 만큼 범위가 작지만, 여러 개를 한 번에 묶지 말고 각각 독립된 작은 계획으로 처리할 것 — v1 최종 리뷰에서 "계획 자체가 놓친 요구사항"(비주얼 설계 편집 불가, 프로젝트 삭제 미연결)이 두 건 나왔던 만큼, 스펙-계획 매핑을 다시 한번 꼼꼼히 확인하는 습관이 필요함.
