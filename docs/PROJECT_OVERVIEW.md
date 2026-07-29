# 프로젝트 개요 및 상세 문서

- 작성일: 2026-07-29
- 대상 저장소: [flowlap/aid-three](https://github.com/flowlap/aid-three)
- 목적: 세션/기기(Windows → Mac 등) 전환 시 빠르게 컨텍스트를 파악할 수 있도록 프로젝트 전체를 한 문서에 정리

## 1. 프로젝트 소개

이러닝 교육 과정 원고(또는 나레이션)를 영상 제작용 스토리보드로 변환하는 로컬 실행 제작 지원 도구. 원고 1개를 프로젝트 1개로 관리하며, 사용자가 각 파이프라인 단계의 AI 산출물을 검토·수정하면서 순차적으로 스토리보드를 완성한다.

- 상세 요구사항/설계 배경: [`docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md`](superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)
- 구현 계획(13개 태스크 상세 스펙): [`docs/superpowers/plans/2026-07-28-elearning-storyboard-generator.md`](superpowers/plans/2026-07-28-elearning-storyboard-generator.md)

## 2. 파이프라인 흐름

```
업로드(pdf/txt) → 1단계 마크다운 변환 → 2단계 씬 분할 → 3단계 화면 유형 선정
→ 4단계 비주얼 설계 → 5단계 일관성 검수 → 6단계 최종 스토리보드 뷰
```

각 단계는 "AI 생성 → 사용자 검토/수정 → 다음 단계" 패턴을 따르는 선형 마법사(wizard) UI로 구현되어 있다. 단계별 정확한 입출력 계약은 [`docs/reference/pipeline-steps.md`](reference/pipeline-steps.md) 참고.

| 단계 | 산출물 파일 | AI 호출 | 사용자 편집 |
|---|---|---|---|
| 업로드 | `source/`, `extracted.txt` | 없음(텍스트 추출만) | - |
| 1. 마크다운 변환 | `narration.md` | 있음 | 마크다운 직접 수정 |
| 2. 씬 분할 | `scenes.json` | 있음 | 씬 경계/시간 수정 |
| 3. 화면 유형 선정 | `screen-types.json` | 있음(씬별 1회 호출) | 화면 유형/레이아웃 수정 |
| 4. 비주얼 설계 | `visual-design.json` | 있음(씬별 1회 호출) | 전 필드 편집 가능 |
| 5. 일관성 검수 | `review.json` | 있음(결정적 검사 3종 + AI 검사 1종) | 편집 없음, 이슈 목록 확인 후 4단계로 이동 |
| 6. 최종 스토리보드 뷰 | 없음(조합 렌더링) | 없음 | 읽기 전용 |

## 3. 기술 스택 & 아키텍처

- **앱**: Next.js 16 (App Router, TypeScript, Turbopack), 단일 프로세스, `npm run dev`로 로컬 실행
- **UI**: React + shadcn/ui(Base UI 기반, Radix 아님 — `asChild` 대신 `render`/`nativeButton` prop 사용) + Tailwind CSS v4
- **테스트**: Vitest — `lib/**/*.test.ts` (총 37개 테스트, 9개 파일)
- **AI**: DeepSeek API 단독 사용. `deepseek-v4-pro`/`deepseek-v4-flash`만 유효(레거시 `deepseek-chat`/`deepseek-reasoner`는 2026-07-24 폐지됨). 상세: [`docs/reference/deepseek-api.md`](reference/deepseek-api.md)
- **PDF 파싱**: `pdf-parse` v2.x (v1과 API가 완전히 다름 — `PDFParse` 클래스의 `getText()`, `import pdfParse from "pdf-parse"` 형태의 v1 코드는 동작하지 않음)
- **저장소**: DB 없음. `data/projects/{project-id}/` 폴더 + JSON/markdown 파일 (전체 gitignore 대상)

### 데이터 모델

```
data/projects/{project-id}/
  project.json         # id, title, createdAt, scriptType, currentStep
  source/               # 업로드 원본
  extracted.txt          # 추출된 원본 텍스트
  narration.md
  scenes.json
  screen-types.json
  visual-design.json
  review.json
```

`lib/projects/store.ts`가 모든 파일 CRUD를 담당하며, `id`는 반드시 UUID 형식이어야 하고(`assertValidProjectId`) `filename`은 경로 구분자/`..`를 포함할 수 없다(`assertSafeFilename`) — 경로 순회(path traversal) 방지를 위해 `projectDir()` 한 곳에서 검증하도록 설계되어 있다.

### 파일 구조 (핵심)

```
lib/
  projects/       # store.ts(CRUD), types.ts(ProjectMeta, PipelineStep, ScriptType)
  ai/             # deepseekClient.ts(실제 구현), deepseekClient.mock.ts(테스트용)
  pipeline/       # extractText, convertMarkdown, splitScenes, validateNarrationIntegrity,
                  # selectScreenTypes, designVisuals, reviewConsistency
                  # → 모두 (input) => Promise<output> 순수 함수형, DeepSeekClient를 인자로 주입받음
                  #   (향후 특정 모듈을 Python 프로세스로 교체할 수 있도록 설계, 아직 미구현)
app/
  page.tsx, ProjectListItem.tsx    # 홈: 프로젝트 목록 + 삭제
  projects/new/page.tsx            # 업로드 폼
  projects/[projectId]/
    layout.tsx                     # 6단계 내비게이션 셸
    markdown|scenes|screen-types|visual-design|review|storyboard/
      page.tsx (서버 컴포넌트, 파일 읽기)
      *Editor.tsx / *List.tsx (클라이언트 컴포넌트, "use client")
  api/projects/
    route.ts (GET 목록), upload/route.ts (POST 업로드)
    [projectId]/route.ts (DELETE)
    [projectId]/{markdown,scenes,screen-types,visual-design}/route.ts (POST 생성, PUT 저장)
    [projectId]/review/route.ts (POST만)
    [projectId]/storyboard/route.ts (POST — currentStep을 storyboard로 기록만 함)
```

### 확립된 코딩 패턴 (새 기능 추가 시 따를 것)

1. **API route 에러 처리**: AI 호출을 감싸는 catch 블록은 `console.error`로 서버 로그만 남기고, 클라이언트에는 절대 원본 에러 메시지를 노출하지 않는다(정보 노출 방지). 항상 일반적인 한국어 메시지 + 502.
2. **AI 응답 파싱**: `JSON.parse` 실패와 예상 스키마 불일치를 구분해서 처리(타입 가드 함수, 예: `isVisualDesign`).
3. **클라이언트 컴포넌트**: `res.ok` 체크 → 실패 시 화면에 에러 메시지 표시 → `try/finally`로 로딩 상태 항상 해제.
4. **PUT 핸들러**: 저장 전 요청 바디 형태 검증(타입 가드), `body`가 `null`/비객체인 경우도 방어.
5. **Next.js 16 동적 라우트**: `params`는 `Promise<{ projectId: string }>`이며 반드시 `const { projectId } = await params;`로 사용.

## 4. 실행 방법

```bash
npm install
cp .env.example .env.local   # DEEPSEEK_API_KEY 입력
npm run dev                   # http://localhost:3000
npm test                      # 전체 유닛 테스트
npx tsc --noEmit               # 타입 체크 (테스트에 안 걸리는 실제 버그를 여러 번 잡아냈음 — 항상 같이 확인할 것)
```

## 5. 현재 상태 (2026-07-29 기준)

- v1 전체 파이프라인 구현 완료, `master`에 병합 및 GitHub push 완료.
- 13개 구현 태스크 + 최종 전체 브랜치 리뷰까지 모두 통과 (subagent-driven-development로 진행, 태스크별 리뷰 + 전체 통합 리뷰 2단계).
- 실제 DeepSeek API 키로 한국어 샘플 원고를 이용한 전체 흐름 라이브 E2E 검증 완료 (업로드 → 6단계까지 실제 클릭 경로로 확인).
- 테스트 37/37 통과, `tsc`/`eslint` 클린.
- 구현 중 실제로 발견되어 수정된 보안 이슈:
  - 경로 순회(path traversal): `lib/projects/store.ts`의 `id`/`filename`이 검증 없이 파일 경로에 사용되던 문제 → UUID/파일명 검증으로 해결
  - 정보 노출: AI 호출 실패 시 업스트림(DeepSeek) 응답 원문이 클라이언트에 그대로 노출되던 문제 → 전 라우트에서 일반 메시지로 통일

## 6. 알려진 제약 / 남은 개선 여지

최종 전체 브랜치 리뷰(2026-07-29)에서 발견되었고 우선순위가 낮아 의도적으로 보류(park)된 항목들. 심각도는 "로컬 1인 사용 도구" 기준. 자세한 우선순위와 제안은 [`docs/ROADMAP.md`](ROADMAP.md) 참고.

- 화면 유형 선정 UI가 자유 텍스트 입력이라, AI가 고르는 화면 유형 목록(`lib/pipeline/selectScreenTypes.ts`의 `AVAILABLE_SCREEN_TYPES`)과 사용자 입력이 일치하지 않을 수 있음(스펙은 드롭다운을 의도)
- 일관성 검수 7개 항목 중 "중복 화면 확인"(화면 자체의 중복, 레이아웃 중복과는 별개)은 미구현
- `screen-types` PUT 라우트는 요청 바디가 `null`일 때 처리되지 않은 예외를 던짐(형제 라우트들은 이미 방어됨) — `app/api/projects/[projectId]/screen-types/route.ts:59-67`
- `splitScenes.ts`는 AI 응답의 배열 유무만 검증하고 각 씬 객체의 필드 형태는 검증하지 않음(형제 모듈들은 요소 단위까지 검증)
- 5개 서버 페이지가 `JSON.parse`를 가드 없이 호출 — 손상된 JSON 파일이 있으면 Next 에러 화면이 뜸(500이 아니라 사용자 친화적 처리로 개선 여지)
- `next dev`가 모든 인터페이스에 바인딩됨 — 로컬 1인 도구 특성상 `-H 127.0.0.1`로 제한하는 게 더 안전
- `app/layout.tsx`가 `lang="en"`으로 남아 있음(UI는 전부 한국어)

## 7. 참고 문서 인덱스

- [설계 스펙](superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)
- [구현 계획 (13개 태스크, v1)](superpowers/plans/2026-07-28-elearning-storyboard-generator.md)
- [v2 전면 개편 로드맵 (Phase 0~7)](superpowers/plans/2026-07-29-v2-redesign-roadmap.md)
- [파이프라인 단계별 입출력 계약](reference/pipeline-steps.md)
- [DeepSeek API 레퍼런스](reference/deepseek-api.md)
- [향후 개발 계획](ROADMAP.md)
- 루트 [`CLAUDE.md`](../CLAUDE.md) — Claude Code 세션용 빠른 요약(이 문서와 중복 최소화, 여기 문서를 정본으로 참조)
