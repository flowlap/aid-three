# 프로젝트 개요 및 상세 문서

- 작성일: 2026-07-29
- 최근 갱신: 2026-08-11 — 로컬 TTS/영상 렌더링/PPTX 내보내기/Getty 이미지 검색 등 이전에 문서화되지 않았던 기능을 파일 구조·아키텍처 섹션에 반영, 이미지 생성 rate-gate 전환·시퀀스 계획 생성 JSON 파싱 안정화 등 최근 수정 사항 추가
- 대상 저장소: [flowlap/aid-three](https://github.com/flowlap/aid-three)
- 목적: 세션/기기(Windows → Mac 등) 전환 시 빠르게 컨텍스트를 파악할 수 있도록 프로젝트 전체를 한 문서에 정리

## 1. 프로젝트 소개

이러닝 교육 과정 원고(또는 나레이션)를 영상 제작용 스토리보드로 변환하는 로컬 실행 제작 지원 도구. 원고 1개를 프로젝트 1개로 관리하며, 사용자가 각 파이프라인 단계의 AI 산출물을 검토·수정하면서 순차적으로 스토리보드를 완성한다.

- 상세 요구사항/설계 배경: [`docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md`](superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)
- 구현 계획(13개 태스크 상세 스펙): [`docs/superpowers/plans/2026-07-28-elearning-storyboard-generator.md`](superpowers/plans/2026-07-28-elearning-storyboard-generator.md)

## 2. 파이프라인 흐름 (v2, Phase 7 이후)

```
업로드(pdf/txt/텍스트 붙여넣기) → 1단계 원고 변환 → 2단계 씬 분할 → 3단계 화면 설계
→ 4단계 일관성 검수 → 5단계 이미지 생성(선택) → 6단계 최종 스토리보드 뷰
→ (선택) 미리보기 / PPTX 내보내기 / 내레이션 음성 생성 + 동영상 생성(Mac 전용)
```

각 단계는 "AI 생성 → 사용자 검토/수정 → 다음 단계" 패턴을 따르는 선형 마법사(wizard) UI로 구현되어 있다. 1단계에서 "자동 진행" 버튼을 누르면 이후 단계들이 각자 도착 시 자동으로 생성을 트리거하고, 결과가 무결성 문제 없이 완전하면 자동으로 다음 단계까지 넘어간다(URL의 `?auto=1`로 전파) — 단, 씬 분할 무결성 경고나 일관성 검수 이슈가 발견되면 그 자리에서 자동 진행이 멈추고 사용자 확인을 기다린다. **자동진행은 4단계(일관성 검수)에서 끝나고 5단계(이미지 생성)로는 넘어가지 않는다** — 이미지 생성은 실제 과금되는 OpenAI 호출이라 사용자의 명시적 클릭이 항상 필요하도록 의도적으로 막아뒀다. 단계별 정확한 입출력 계약은 [`docs/reference/pipeline-steps.md`](reference/pipeline-steps.md) 참고.

| 단계 | 산출물 파일 | AI 호출 | 사용자 편집 |
|---|---|---|---|
| 업로드 | `source/`, `extracted.txt` | 없음(텍스트 추출만, 또는 텍스트 붙여넣기 시 추출 자체를 생략) | - |
| 1. 원고 변환 | `narration.md` | 있음 | 마크다운 직접 수정 |
| 2. 씬 분할 | `scenes.json` | 있음 | 씬 경계/시간 수정, 씬 삭제(인접 씬에 자동 병합)·인접 씬 병합 |
| 3. 화면 설계 | `screen-design.json`(`screenTypes`+`visualDesigns` 한 파일) | 화면 유형 선정만 AI(씬별 1회 호출), 비주얼 설계는 `lib/visual-templates`의 코드 템플릿(AI 호출 없음) | 전 필드 편집 가능, 씬별 재생성 버튼 |
| 4. 일관성 검수 | `review.json` | 있음(결정적 검사 3종 + AI 검사 1종) | 편집 없음, 이슈 목록 확인 후 다음 단계로 이동 |
| 5. 이미지 생성(선택) | `images/{sceneId}.png`(바이너리, 인덱스 파일 없음) | 있음 — 엔진 선택 가능: OpenAI(씬별 1회 호출, **실제 과금**) 또는 로컬 FLUX.2 Klein(mflux, Mac 전용, 무료) | 편집 불가, 씬별 재생성만 가능 — 필수 아님, 이미지 없이도 다음 단계 진행 가능 |
| 6. 최종 스토리보드 뷰 | 없음(조합 렌더링) | 없음 | 읽기 전용 |
| (선택) 미리보기 | 없음(조합 렌더링) | 없음 | 읽기 전용 — 좌측 씬 목차 + 구조화 화면/이미지 나란히 표시, Getty Images Korea 역방향 이미지 검색으로 유사 스톡 이미지 탐색 가능(`lib/imageSearch/`), `storyboard`에서 진입 |
| (선택) 내레이션 음성 생성 | `audio/{sceneId}.wav`, `audio-manifest.json`, `video/final.mp4` | 있음 — 로컬 Qwen3-TTS(mlx-audio, Mac 전용)로 씬별 음성 합성 후 ffmpeg로 동영상 합성 | 재생성만 가능, 별도 편집 없음. `app/projects/[projectId]/narration-audio/`(`(pipeline)` 밖의 형제 라우트, storyboard에서 "동영상으로 보기"로 진입). 상세: [`docs/reference/local-tts.md`](reference/local-tts.md) |
| (선택) PPTX 내보내기 | `.pptx` 다운로드(디스크에 영속 저장 안 함) | 없음 | 기본 템플릿 또는 프로젝트별 업로드 템플릿(`pptx-template/route.ts`) 선택, 최종 스토리보드 뷰에서 트리거. `lib/pptx/`가 pptxgenjs 같은 라이브러리 없이 OOXML/JSZip을 직접 조작해 생성 |

## 3. 기술 스택 & 아키텍처

- **앱**: Next.js 16 (App Router, TypeScript, Turbopack), 단일 프로세스, `npm run dev`로 로컬 실행
- **UI**: React + shadcn/ui(Base UI 기반, Radix 아님 — `asChild` 대신 `render`/`nativeButton` prop 사용) + Tailwind CSS v4
- **테스트**: Vitest — `lib/**/*.test.ts` (총 75개 테스트, 11개 파일)
- **AI(텍스트/이미지)**: provider 추상화 도입(2026-08-03) — `LlmClient`/`ImageClient` 인터페이스(`lib/ai/llm/types.ts`, `lib/ai/image/types.ts`)를 두고, `LLM_PROVIDER`/`IMAGE_PROVIDER` env var로 구현체를 선택한다. 기본값은 기존과 동일하게 `deepseek`/`openai`(하위호환, 설정 변경 없이 그대로 동작). 사내 게이트웨이 "H-CHAT"을 통한 Claude/ChatGPT/Gemini(텍스트), Gemini(이미지)도 선택지로 추가됨. 상세: [`docs/superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md`](superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md), DeepSeek 자체 스펙은 [`docs/reference/deepseek-api.md`](reference/deepseek-api.md)
- **AI(이미지, 로컬)**: 위 provider 추상화와 별도로, 5단계 상단 엔진 선택기(`ImageEngineSelector`)에서 프로젝트별로 클라우드(`IMAGE_PROVIDER`가 고르는 openai/hchat-gemini) 대신 이 Mac에서 완전히 로컬로 도는 FLUX.2 Klein(`lib/ai/localImageClient.ts` + `python/image/`, mflux/MLX 기반, Mac 전용, 무료)을 선택할 수 있다 — env var가 아니라 프로젝트별 런타임 토글이라는 점이 다르다. 상세: [`docs/reference/local-image-generation.md`](reference/local-image-generation.md)
- **PDF 파싱**: `pdf-parse` v2.x (v1과 API가 완전히 다름 — `PDFParse` 클래스의 `getText()`, `import pdfParse from "pdf-parse"` 형태의 v1 코드는 동작하지 않음)
- **저장소**: DB 없음. `data/projects/{project-id}/` 폴더 + JSON/markdown 파일 (전체 gitignore 대상)
- **로컬 TTS**: 내레이션 음성은 외부 API가 아니라 이 Mac에서 로컬로 도는 Qwen3-TTS(`mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`, mlx-audio)를 `python/tts/generate.py` 자식 프로세스로 실행(Mac 전용). 상세: [`docs/reference/local-tts.md`](reference/local-tts.md)
- **동영상 렌더링**: `lib/video/`(15개 파일) — ffmpeg 기반 클립 빌더(정지 프레임/시퀀스 카메라 모션), `crop`+`scale` 합성 모션 필터(`zoompan` 미사용, 아래 7절 참고), Satori 기반 오버레이 PNG 렌더링, 클립 fingerprint로 변경분만 다시 렌더링하는 증분 재빌드. ffmpeg 자체 설치는 필요(`brew install ffmpeg`), Node 코드는 플랫폼 무관.
- **PPTX 내보내기**: `lib/pptx/` — pptxgenjs 같은 서드파티 PPTX 생성 라이브러리 없이 OOXML XML + JSZip을 직접 조작해 생성(기본 템플릿 또는 프로젝트별 업로드 템플릿 기반).
- **스톡 이미지 검색**: `lib/imageSearch/` — Getty Images Korea 역방향 이미지 검색 프록시, 미리보기 페이지에서 사용.
- **AI 호출 동시성 제어**: `lib/concurrency.ts`가 `runWithConcurrencyLimit`(동시 실행 개수 상한)과 `createRateGate`(호출 시작 간 최소 간격 페이싱, 분당 호출 한도 대응)를 제공 — 씬/그룹 단위로 병렬 AI 호출을 날리는 모든 파이프라인 단계(이미지 생성, 시퀀스 계획, 화면 설계)가 이 두 헬퍼를 조합해 쓴다.

### 데이터 모델

```
data/projects/{project-id}/
  project.json         # id, title, createdAt, scriptType, currentStep
  source/               # 업로드 원본 (텍스트 붙여넣기 시 없음)
  extracted.txt          # 추출/붙여넣은 원본 텍스트
  narration.md
  scenes.json
  screen-design.json    # { screenTypes, visualDesigns } — Phase 5에서 두 단계가 파일 하나로 통합됨
  review.json
  images/{sceneId}.png  # Phase 7, 선택 사항 — 씬마다 있을 수도 없을 수도 있음, 인덱스 파일 없이 디렉터리 스캔으로 존재 확인
```

`lib/projects/store.ts`가 모든 파일 CRUD를 담당하며, `id`는 반드시 UUID 형식이어야 하고(`assertValidProjectId`) `filename`은 경로 구분자/`..`를 포함할 수 없다(`assertSafeFilename`) — 경로 순회(path traversal) 방지를 위해 `projectDir()` 한 곳에서 검증하도록 설계되어 있다.

### 파일 구조 (핵심)

```
lib/
  projects/       # store.ts(CRUD + 이미지 바이너리 CRUD), types.ts(ProjectMeta, PipelineStep, ScriptType), pipelineStatus.ts(신호등 상태 매핑)
  ai/             # llm/types.ts(LlmClient), image/types.ts(ImageClient) — provider별 실제구현 파일 + factory.ts(createLlmClient/createImageClient, LLM_PROVIDER/IMAGE_PROVIDER 선택)
                  #   llm/: deepseekClient, hchatClaudeClient, hchatChatGptClient, hchatGeminiClient (+ 공용 mockLlmClient)
                  #   image/: openaiImageClient, hchatGeminiImageClient (+ 공용 mockImageClient)
                  #   hchatShared.ts — H-CHAT 게이트웨이 공통 URL/인증 헤더
                  #   localImageClient.ts(+.mock) — factory 밖의 프로젝트별 로컬 엔진(FLUX.2 Klein via mflux), ImageEngineSelector가 선택
  pipeline/       # extractText, convertMarkdown, splitScenes, validateNarrationIntegrity,
                  # selectScreenTypes, designVisuals(VisualDesign 타입만, AI 함수는 Phase 5에서 제거됨), reviewConsistency, generateSceneImage
                  # → 모두 (input) => Promise<output> 순수 함수형, AI 클라이언트를 인자로 주입받음
                  #   (향후 특정 모듈을 Python 프로세스로 교체할 수 있도록 설계, 아직 미구현)
                  # 씬·시퀀스 이중 모드 관련 추가: sequenceTypes.ts(정본 타입), planSequences.ts(시퀀스 계획 AI 생성),
                  #   sequenceLookup.ts(groupScenesBySequence 등 조회 헬퍼), bakeSequenceSceneStill.ts(마스터+오버레이 결정적 합성),
                  #   imageGenerationConfig.ts, ttsGenerationConfig.ts(TTS_DEFAULT_VOICE/INSTRUCT 등 상수)
  visual-templates/  # Phase 5 신규 — computeVisualDesign(scene, screenType): AI 호출 없는 코드 기반 비주얼 설계 계산, SCREEN_TYPE_OPTIONS(10종)
  video/          # ffmpeg 기반 동영상 렌더링(15개 파일) — buildVideoClip.ts(정지 프레임형 + 시퀀스 카메라 모션형 두 빌더),
                  #   motionFilter.ts(crop+scale 기반 push-in/pull-out/pan/follow-flow, zoompan 미사용),
                  #   composeSequenceStill.ts(마스터+오버레이 정지 프레임 합성), renderSequenceFrameToPng.ts(Satori 오버레이 렌더링),
                  #   concat/전환 효과, computeSceneClipFingerprint(변경분만 재렌더링하는 증분 캐시)
  pptx/           # PPTX 내보내기 — pptxgenjs 미사용, OOXML XML + JSZip 직접 조작(기본/업로드 템플릿 지원)
  media/          # wavDuration.ts(WAV 헤더 파싱으로 재생 시간 계산), ffmpeg.ts(assertFfmpegAvailable, runFfmpeg 공용 래퍼)
  http/           # resilientStream.ts — 클라이언트 연결이 끊겨도 서버 작업은 계속 진행되게 하는 NDJSON 스트리밍 헬퍼(TTS/영상 라우트가 사용)
  imageSearch/    # Getty Images Korea 역방향 이미지 검색 프록시(미리보기 페이지의 PreviewViewer가 사용)
  concurrency.ts  # runWithConcurrencyLimit(동시 실행 상한), createRateGate(호출 시작 간 최소 간격 페이싱) — AI 호출 병렬화 공용 헬퍼
  jobs/           # registry.ts — AI 작업 레지스트리(중복 실행 방지/취소/진행률), PIPELINE_JOB_STEPS
                  #   inFlightLock.ts — 더 단순한 프로젝트별 배타적 락(레지스트리와 별도, 동시 요청 직렬화용)
  client/         # useAiJob.ts(작업 폴링+스트림 훅), StepNavContext.tsx(셸 푸터 다음-버튼 등록), useAutoProgress.ts(?auto=1 자동진행)
app/
  AppShell.tsx                     # 파이프라인 단계 전용 공용 셸: 1000px 중앙 컬럼, sticky 헤더(단계 배지)/푸터(이전·다음)
  ThemeToggle.tsx                  # 다크모드 토글(우상단 고정), 루트 layout.tsx에서 전역 렌더
  page.tsx, ProjectListItem.tsx    # 홈: 프로젝트 목록(신호등 상태 표시) + 삭제
  projects/new/page.tsx            # 업로드 폼 (파일 업로드 / 텍스트 붙여넣기 토글)
  projects/[projectId]/
    (pipeline)/                    # 라우트 그룹 — URL에는 안 나타남, AppShell을 쓰는 선형 단계만 묶음(모드별로 개수 다름, 7절 참고)
      layout.tsx                   # AppShell 렌더 위임(서버 컴포넌트)
      markdown|scenes|screen-design|sequences|review|images|storyboard/
        page.tsx (서버 컴포넌트, 파일 읽기)
        *Editor.tsx / *List.tsx (클라이언트 컴포넌트, "use client")
    preview/                       # (pipeline) 밖의 형제 — AppShell 미상속, 독자적인 좌측 TOC+하단 씬이동 셸(Phase 6)
      page.tsx, PreviewViewer.tsx
    narration-audio/                # (pipeline) 밖의 형제 — TTS 음성 생성 + 동영상 생성 UI(Mac 전용), storyboard의 "동영상으로 보기"에서 진입
      page.tsx
  api/projects/
    route.ts (GET 목록), upload/route.ts (POST 업로드, file 또는 text 필드)
    [projectId]/route.ts (DELETE)
    [projectId]/jobs/[step]/route.ts (GET 상태 폴링, DELETE 취소)
    [projectId]/{markdown,scenes,screen-design,images}/route.ts (POST 생성, PUT 저장 — images는 PUT 없음)
    [projectId]/images/engine/route.ts (PUT — 이미지 생성 엔진(openai/local) + 로컬 모델 크기 저장)
    [projectId]/screen-design/[sceneId]/route.ts, [projectId]/images/[sceneId]/route.ts (POST 씬 하나만 재생성, 작업 레지스트리 미사용 / images는 GET도 있음 — PNG 서빙)
    [projectId]/review/route.ts (POST만)
    [projectId]/storyboard/route.ts (POST — currentStep을 storyboard로 기록만 함, images 단계의 "다음 단계"가 호출)
    [projectId]/sequences/route.ts, [projectId]/sequences/[sequenceId]/master-image/route.ts (시퀀스 계획 생성/저장, 시퀀스 마스터 비주얼 생성)
    [projectId]/images/sequence-mode/route.ts (시퀀스 모드 씬 이미지 방식 사이드카 `sequence-image-mode.txt` 저장)
    [projectId]/tts/route.ts (POST — 로컬 Qwen3-TTS 배치 합성, NDJSON 스트리밍)
    [projectId]/audio/[sceneId]/route.ts (GET — WAV Range 요청 서빙)
    [projectId]/video/route.ts (POST — 렌더링 시작(NDJSON 스트리밍), GET — 완성된 mp4 서빙)
    [projectId]/pptx-template/route.ts (GET/POST/DELETE — 프로젝트별 PPTX 템플릿 업로드 관리)
```

### 확립된 코딩 패턴 (새 기능 추가 시 따를 것)

1. **API route 에러 처리**: AI 호출을 감싸는 catch 블록은 `console.error`로 서버 로그만 남기고, 클라이언트에는 절대 원본 에러 메시지를 노출하지 않는다(정보 노출 방지). 항상 일반적인 한국어 메시지 + 502.
2. **AI 응답 파싱**: `JSON.parse` 실패와 예상 스키마 불일치를 구분해서 처리(타입 가드 함수, 예: `isVisualDesign`).
3. **클라이언트 컴포넌트**: `res.ok` 체크 → 실패 시 화면에 에러 메시지 표시 → `try/finally`로 로딩 상태 항상 해제.
4. **PUT 핸들러**: 저장 전 요청 바디 형태 검증(타입 가드), `body`가 `null`/비객체인 경우도 방어.
5. **Next.js 16 동적 라우트**: `params`는 `Promise<{ projectId: string }>`이며 반드시 `const { projectId } = await params;`로 사용.
6. **병렬 AI 호출은 상한 없는 `Promise.all` 금지**: 씬/그룹을 여러 개 병렬로 AI 호출하는 코드는 반드시 `lib/concurrency.ts`의 `runWithConcurrencyLimit`(동시 개수 상한)과 `createRateGate`(호출 시작 간 최소 간격)를 조합해서 쓴다 — 상한 없는 `Promise.all`은 H-CHAT Gemini 같은 분당 호출 한도가 있는 provider에서 rate limit을 유발하고, 그중 하나라도 fail-fast로 던지면 이미 완료된 다른 그룹까지 전체 작업이 중단된다(`planSequences.ts`, `selectScreenTypes.ts`, 이미지 생성 라우트가 모두 이 패턴을 따름).
7. **그룹/배치 AI 호출은 호출 자체의 예외도 재시도 대상에 포함**: "응답은 왔지만 스키마가 일부 어긋난 경우"만 재시도하고 "요청 자체가 throw"하는 경우(JSON 파싱 실패 등)는 즉시 포기하는 재시도 루프는 놓치기 쉬운 버그다 — 두 실패 모드 모두 같은 재시도 루프로 감싸되, `signal.aborted`(사용자 취소, 또는 다른 그룹의 실패로 인한 내부 abort)는 재시도하지 않고 즉시 전파한다.
8. **Anthropic(H-CHAT Claude) 구조화 JSON 응답은 프롬프트 지시만으로 강제하지 않는다**: `hchatClaudeClient.ts`의 JSON 모드는 시스템 프롬프트로 "JSON만 응답하라"고 지시하는 방식이라 가끔 따옴표 이스케이프 실수 등으로 파싱 실패가 난다 — tool-use(강제 tool_choice)로 스키마를 강제하는 방식이 더 안정적이며, 새로 Claude 기반 JSON 생성 경로를 추가할 때는 이 방식을 우선 검토한다.
9. **배타적 락은 병목이 되지 않을 만큼 세분화**: 같은 프로젝트에 대한 동시 요청을 직렬화해야 하는 라우트는 `lib/jobs/inFlightLock.ts`(중복 실행 방지/진행률까지 필요 없는 단순 배타적 락, `withInFlightLockRetrying`로 락 획득 재시도까지 지원)를, 진행률·취소·재진입 UI까지 필요한 경우 `lib/jobs/registry.ts`를 쓴다 — 둘은 별도 메커니즘이라 섞어 쓰지 않는다. 락 키를 프로젝트 단위로 너무 넓게 잡으면 병렬화 가능한 작업(예: 시퀀스별 마스터 비주얼 생성)까지 직렬화돼버리므로, 실제 충돌 지점(예: `sequences.json` 파일 쓰기)만 감싸도록 락 범위를 최소화하고 느린 AI 호출 자체는 락 밖에서 수행한다.

## 4. 실행 방법

```bash
npm install
cp .env.example .env.local   # DEEPSEEK_API_KEY 입력
npm run dev                   # http://localhost:3000
npm test                      # 전체 유닛 테스트
npx tsc --noEmit               # 타입 체크 (테스트에 안 걸리는 실제 버그를 여러 번 잡아냈음 — 항상 같이 확인할 것)
```

## 5. 현재 상태 (2026-08-11 기준)

- (이전 세션들에서 이미 구현됐으나 이 문서에는 반영되지 않았던 기능들 — 문서를 실제 코드 상태에 맞춰 동기화) 로컬 TTS(Qwen3-TTS, `narration-audio` 페이지) + ffmpeg 기반 동영상 렌더링(`lib/video/`), PPTX 내보내기(`lib/pptx/`, OOXML 직접 조작), Getty Images Korea 역방향 이미지 검색(`lib/imageSearch/`, 미리보기 페이지), fal.ai 이미지 provider(`IMAGE_PROVIDER=fal`, Nano Banana 2 계열은 참조 이미지도 지원, `e1f55ea`) 모두 이미 구현·동작 중.
- 2026-08-10 (`93732b7`): 로컬 TTS(Qwen3-TTS-CustomVoice)가 `instruct` 없이 호출하면 씬 텍스트 내용만 보고 톤을 추론해, 씬마다 독립 합성하는 구조상 슬픔/당참 등으로 톤이 널뛰던 문제를 고정 한국어 `instruct`(`TTS_DEFAULT_INSTRUCT`, `ttsGenerationConfig.ts`)로 해결.
- 2026-08-10 (`d984682`): 화면 설계가 시퀀스 설계 단계에 흡수되면서 `screenTypes`가 비어 있어도 "다음 단계" 저장이 막히지 않아 빈 `screen-design.json`이 저장되고 이후 씬 이미지 생성이 전부 깨지는 경로가 있었음 — 씬 모드의 `ScreenDesignEditor.tsx`와 동일한 게이트를 `SequencePlanEditor.tsx`에도 적용.
- 2026-08-10 (`0d27a71`): H-CHAT Gemini 이미지 게이트웨이가 200 OK에 빈 candidate를 얹어 조용히 스로틀링하는 현상(`NoImageDataError`)이 있어 동시성 1로 우회했으나 처리량이 너무 낮았던 문제를, "새 호출 시작" 간격만 최소 4초로 페이싱하는 `createRateGate`로 전환(동시 호출 상한 자체는 안전장치로 6까지 완화)해 처리량을 Gemini의 분당 호출 한도(~15 RPM)에 가깝게 개선. 같은 커밋에서 시퀀스 마스터 비주얼 생성 락도 프로젝트 단위 → 시퀀스 단위로 세분화(`withInFlightLockRetrying`)해 여러 시퀀스를 동시에 생성할 수 있게 함.
- 2026-08-10 (`6a1dc8a`): 대형 프로젝트에서 시퀀스 모드 화면 설계 "이어서 생성"이 반복적으로 중간에 멈추는 문제 수정(`selectScreenTypes.ts`) — 시퀀스 단위 그룹 AI 호출이 상한 없는 `Promise.all`이라 그룹 수가 많을수록(수십~100개) 하나라도 실패할 확률이 실행마다 사실상 100%에 가까웠고, 그룹 호출 자체가 throw하는 경우(JSON 파싱 실패 등)는 재시도가 전혀 없었던 것이 근본 원인. `planSequences.ts`에서 이미 검증된 패턴(`mapWithConcurrency`로 동시 호출 상한 + 재시도 강화)을 그대로 이식해 `MAX_CONCURRENT_GROUPS=6` 상한 추가, 호출 자체의 예외도 재시도 대상에 포함, `MAX_GROUP_ATTEMPTS` 2→5로 상향.
- 2026-08-09 (`48ef90f`): H-CHAT Claude 게이트웨이의 JSON 모드가 프롬프트 지시문에만 의존해 시퀀스 계획 생성 배치가 반복적으로 유효하지 않은 JSON으로 실패하던 근본 원인을, Anthropic tool-use(`tools`/`tool_choice`+`input_schema`) 강제로 전환해 구조적으로 해결(모델이 이중 인코딩된 문자열로 반환하는 경우 복구하는 방어 로직도 추가). 같은 커밋에서 시퀀스 모드 이미지/목업 단계의 씬 이미지 생성 방식 기본값을 `"composite"`에서 `"ai"`(AI 생성)로 바꿨는데, 이 변경은 페이지 초기 표시값(`images/page.tsx`)에만 적용되고 실제 생성 라우트(`images/route.ts`/`video/route.ts`/`images/[sceneId]/route.ts`)의 사이드카 파일 부재 시 기본값은 여전히 `"composite"`로 남아 있다 — 아래 6절 "알려진 제약"에 기록.
- 2026-08-09: 시퀀스 모드 화면 설계 품질 개선 3종 완료 — (1) 화면 설계 AI 호출을 제목 계층이 아니라 시퀀스 단위로 그룹화해 같은 시퀀스에 속한 씬들이 서로를 보며 함께 설계되도록 수정, (2) 시퀀스 마스터 비주얼 생성 기능을 시퀀스 설계 단계에서 이미지/목업 단계로 이동(엔진 선택·공통 프롬프트·배경 고정·스타일 참조 이미지 설정을 그대로 재사용), (3) 시퀀스 모드에서 화면 설계를 별도 단계로 두지 않고 시퀀스 설계 단계가 흡수하도록 통합(파이프라인이 시퀀스 설계 → 일관성 검수로 바로 이어짐). 씬 모드는 세 변경 모두 영향 없음(byte-for-byte 유지). 상세는 아래 "7. 씬·시퀀스 이중 제작 모드" 섹션 갱신 내용 참고.
- 2026-08-07: 씬·시퀀스 이중 제작 모드(dual production mode) 구현 완료 — 상세는 아래 "7. 씬·시퀀스 이중 제작 모드" 섹션과 [`docs/superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md`](superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md) 참고.
- 2026-08-04: 5단계(이미지 생성)에 로컬 모델(FLUX.2 Klein 4B/9B, mflux/MLX 기반) 옵션 추가 — 상단 엔진 선택기로 OpenAI/로컬 전환, 참조 이미지(배경 고정/강사 표시) 조건부 생성도 로컬에서 동일 지원, 텍스트는 이미지에 굽지 않고 PPTX 텍스트로 배치. 상세: [`docs/reference/local-image-generation.md`](reference/local-image-generation.md).
- v1 전체 파이프라인 구현 완료 후, 같은 세션에서 사용자가 요청한 v2 전면 개편(Phase 0~7)을 전부 구현 완료 — 더 이상 미착수 Phase 없음. 상세는 [`docs/superpowers/plans/2026-07-29-v2-redesign-roadmap.md`](superpowers/plans/2026-07-29-v2-redesign-roadmap.md).
- v2에서 바뀐 것: AI 모델 이원화(1·2단계 pro / 3·4단계 flash), 작업 엔진(중복실행 방지·진행률·취소·재진입 유지), 디자인 셸(1000px+sticky 헤더/푸터), 홈 신호등 상태+텍스트 붙여넣기, 1단계 자동진행+2단계 씬 삭제/병합, 3-4단계를 "화면 설계" 한 단계로 통합(비주얼 설계는 AI 대신 코드 템플릿), OpenAI 이미지 생성(선택 단계, 자동진행 범위 밖), 씬별 미리보기 화면(독자적 셸).
- 각 Phase마다 실제 DeepSeek/OpenAI API 키로 Playwright(headless Chromium) E2E 검증(이미지 생성은 실제 API 호출로 생성물까지 육안 확인) + `tsc`/`eslint`/`npm test`/`next build` 통과를 거쳐 완료 처리함.
- 구현 중 실제로 발견되어 수정된 보안 이슈(v1):
  - 경로 순회(path traversal): `lib/projects/store.ts`의 `id`/`filename`이 검증 없이 파일 경로에 사용되던 문제 → UUID/파일명 검증으로 해결
  - 정보 노출: AI 호출 실패 시 업스트림(DeepSeek) 응답 원문이 클라이언트에 그대로 노출되던 문제 → 전 라우트에서 일반 메시지로 통일

## 6. 알려진 제약 / 남은 개선 여지

우선순위가 낮아 의도적으로 보류(park)된 항목들. 심각도는 "로컬 1인 사용 도구" 기준. 자세한 우선순위와 제안은 [`docs/ROADMAP.md`](ROADMAP.md) 참고. (2026-07-29: [`docs/DESIGN_REVIEW.md`](DESIGN_REVIEW.md)의 D1~D8 개선 작업으로 모바일 레이아웃 버그 3건, 정보 위계, 검수 이슈 표시, 이미지 규격, 다크모드, 컴포넌트 일관성, 마이그레이션 안전망, 미리보기 하이라이트 지연을 전부 해결함 — 이 목록은 그 이후에도 남아있는 낮은 우선순위 항목만 정리.)

- 화면 설계 UI(`ScreenDesignEditor.tsx`)가 화면 유형 필드를 여전히 자유 텍스트 `Input`으로 받음 — `lib/visual-templates`의 `SCREEN_TYPE_OPTIONS`(10종)와 `components/ui/select.tsx`(D6에서 추가됨)가 모두 준비되어 있으니 `Select`로 교체하는 것만 남음.
- 일관성 검수 7개 항목 중 "중복 화면 확인"(화면 자체의 중복, 레이아웃 중복과는 별개)은 미구현
- `splitScenes.ts`는 AI 응답의 배열 유무만 검증하고 각 씬 객체의 필드 형태는 검증하지 않음(형제 모듈들은 요소 단위까지 검증)
- 6개 서버 페이지가 `JSON.parse`를 가드 없이 호출 — 손상된 JSON 파일이 있으면 Next 에러 화면이 뜸(500이 아니라 사용자 친화적 처리로 개선 여지)
- `next dev`가 모든 인터페이스에 바인딩됨 — 로컬 1인 도구 특성상 `-H 127.0.0.1`로 제한하는 게 더 안전
- `currentStep`은 각 단계의 저장(PUT)이 아니라 AI 생성(POST) 성공 시에만 갱신됨 — 홈 신호등 상태가 "AI 생성을 완료한 단계"를 반영하는 것이지 "사용자가 검토를 마친 단계"가 아님(단, 알 수 없는 과거 단계 값이 와도 화면이 깨지지는 않도록 `getProjectStatus`에 폴백은 추가됨 — D7)
- 콘텐츠가 짧은 파이프라인 단계(원고 변환/씬 분할 등)에서 화면 하단 여백이 큼 — 없애는 게 나은지 여백으로 유지하는 게 나은지 디자인 판단이 필요해 보류(`DESIGN_REVIEW.md` 항목 12)
- **시퀀스 모드 씬 이미지 생성 방식(`sequence-image-mode.txt` 사이드카)의 기본값이 UI와 백엔드에서 서로 다르다**: `images/page.tsx`(2026-08-09, `48ef90f`)는 사이드카 파일이 없으면 초기 선택값을 `"ai"`로 보여주지만, 실제 생성을 수행하는 `images/route.ts`·`video/route.ts`·`images/[sceneId]/route.ts`는 사이드카 파일이 없으면 여전히 `"composite"`로 처리한다. 즉 새 시퀀스 모드 프로젝트에서 사용자가 이미지/목업 단계 UI에 진입만 하고 방식을 한 번도 명시적으로 저장(`POST /images/sequence-mode`)한 적이 없으면, 화면에는 "AI 생성"이 선택된 것처럼 보이지만 실제 생성 호출은 합성(`composite`) 방식으로 동작한다.

## 7. 씬·시퀀스 이중 제작 모드 (2026-08-07, 2026-08-09 갱신)

프로젝트 생성 시 선택하는 `productionMode`(`"scene"` | `"sequence"`)에 따라 파이프라인 중간 단계와 이미지/영상 생성 방식이 갈라진다. 상세 배경/태스크 분해는 [`docs/superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md`](superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md) 참고.

### 두 모드의 차이

|  | 씬 모드(`"scene"`, 기본값) | 시퀀스 모드(`"sequence"`) |
|---|---|---|
| 대상 | 대부분의 이러닝 과정(기존 방식 그대로) | 연속된 비주얼 영상 제작(카메라 워크가 있는 하나의 흐름) |
| 파이프라인 단계 | 원고 변환 → 씬 분할 → 화면 설계 → 일관성 검수 → 이미지 생성 → 최종 뷰 | 원고 변환 → 씬 분할 → **시퀀스 설계**(화면 설계 흡수) → 일관성 검수 → 이미지 생성 → 최종 뷰 — 화면 설계는 2026-08-09부터 별도 단계가 아니라 시퀀스 설계 단계 안에서 씬별로 인라인 편집한다(`SequencePlanEditor.tsx`가 `screen-design` 스텝의 `ScreenDesignSceneCard`를 그대로 재사용). `/screen-design`으로 직접 진입하면 `/sequences`로 리다이렉트된다. |
| 추가 산출물 | 없음 | `sequences.json`, `sequence-assets/{sequenceId}/{assetId}.png` |
| 씬 이미지 생성 | 씬 단위로 독립 AI 이미지 생성 | 프로젝트 단위 `sequence-image-mode.txt` 사이드카로 두 방식 중 선택 — **사이드카가 없을 때의 기본값이 UI(`"ai"`)와 실제 생성 라우트(`"composite"`)에서 서로 다르다(6절 "알려진 제약" 참고)**. **`"composite"`(기본)**: 씬별 AI 이미지 생성 없음 — 각 콘텐츠 씬 = 시퀀스 마스터 비주얼(카메라 시작 프레임 크롭) + 오버레이 레이어를 결정적으로 합성해 `images/{sceneId}.png`에 굽는다(`lib/pipeline/bakeSequenceSceneStill.ts` + `lib/video/composeSequenceStill.ts`). 이미지 모델은 시퀀스당 마스터 1장에만 사용 — **마스터 생성은 2026-08-09부터 시퀀스 설계 단계가 아니라 이미지/목업 단계에서 하며**, 그 단계의 엔진 선택기(로컬/OpenAI/H-CHAT)·공통 프롬프트·배경 고정·스타일 참조 이미지 설정을 그대로 재사용한다(`ImagesEditor.tsx`의 "시퀀스 마스터 비주얼" 섹션). 마스터 없음/타이틀 씬은 캡션 카드로 폴백. **`"ai"`**: 씬마다 실제 AI 이미지 생성 호출(씬 모드와 동일 경로 재사용) — 오버레이(라벨/화살표/강조/도식/차트)를 합성하지 않고 프롬프트에 녹여 이미지 자체에 직접 그려 넣는다(`generateSceneImage.ts`의 `sequenceOverlayRenderMode: "bake"`). 시퀀스 마스터는 참조 이미지로만 첨부해 배경 연속성을 유지. |
| 영상 렌더링 | `buildVideoClip`(정지 프레임 + 내레이션 + 0.65초 홀드 + 균일 fade) — byte-for-byte 유지 | `sequence-image-mode`가 `"composite"`인 씬은 `buildSequenceVideoClip`: 콘텐츠 씬 베이스 프레임은 `images/{sceneId}.png`가 아니라 **원본 마스터 에셋**을 써서 ffmpeg crop이 전체 범위를 애니메이션하고(오버레이는 고정), 정지 프리뷰(`images/{sceneId}.png`)는 그 클립의 t=0 프레임과 일치(`startCropRect`). Satori 오버레이 합성 + 시퀀스 경계별 전환 효과. `"ai"`인 씬(타이틀 제외)은 오버레이가 이미 이미지에 구워져 있으므로 씬 모드와 동일하게 `buildVideoClip`으로 **정지 프레임**(카메라 모션 없음) 렌더링 — 두 빌더가 만든 클립도 `SCENE_BREAK_HOLD_SEC` 상수를 공유해 길이가 어긋나지 않아 한 프로젝트 안에서 섞여도 안전하다. |

`getProductionMode(project)`(`lib/projects/types.ts`)가 이 분기의 단일 진입점이다 — `project.productionMode ?? "scene"`으로 레거시 `project.json`(필드 자체가 없는 과거 프로젝트)도 안전하게 씬 모드로 취급한다. 파이프라인 내비게이션(`lib/projects/pipelineSteps.ts`의 `getPipelineSteps(mode)`), 화면 설계 프롬프트, 씬 이미지 생성, 영상 생성 라우트가 전부 이 함수 하나로 모드를 판별하며, 어디서도 `project.productionMode`를 직접 비교하지 않는다.

### `sequences.json`은 무엇이고 무엇이 아닌가

- 시퀀스 모드 프로젝트에만, 그것도 "시퀀스 설계" 단계에서 AI 생성 또는 사용자가 명시적으로 저장(PUT)한 뒤에만 생성된다 — 레거시 프로젝트를 열거나 씬 모드 프로젝트를 다루는 동안에는 절대 쓰이지 않는다.
- **나레이션 원문을 절대 복제하지 않는다.** 각 시퀀스는 `sceneIds: string[]`로 `scenes.json`의 씬 ID만 순서대로 참조하고, 나레이션은 항상 `scenes.json`에서 조회한다.
- 타이틀 씬(`sceneType === "title"`)은 `sceneIds`에 포함되지 않는 것이 정책이며, 포함되면 `validateSequenceIntegrity`가 검증 오류로 처리한다(조용히 무시하지 않음) — 기존 렌더러가 이미지 생성 없이 타이틀 카드를 직접 만들기 때문에 시퀀스가 다룰 시각적 연속성이 없다.
- 시퀀스별로 연속성(`continuity`: 장소/시간대/비주얼 스타일/고정 요소/변경 금지 요소), 마스터 비주얼(`masterVisual`: 설명/프롬프트/상태/에셋 ID), 카메라 플랜(씬별 샷/모션), 오버레이(씬별 라벨/화살표/강조/도식/차트 지시)를 소유한다.
- 정확한 타입 정의는 `lib/pipeline/sequenceTypes.ts`를 정본으로 삼는다(아래 pipeline-steps.md에서도 이 파일을 가리킴).
- 저장 경로: `data/projects/{project-id}/sequences.json`. 마스터 이미지는 `data/projects/{project-id}/sequence-assets/{sequenceId}/{assetId}.png` — 씬별 이미지(`images/{sceneId}.png`)와는 완전히 별도 디렉터리다.

### 시퀀스 모드 영상 렌더링이 다른 점

- **모션**: `zoompan` 필터는 쓰지 않는다(프레임 카운터 상태가 누적되며 정지 이미지 `-loop 1` 입력에서 지터/멈춤/리셋을 일으키는 것으로 알려진 취약점 — `buildVideoClip.ts`의 기존 주석이 경고하던 문제를 다시 끌어들이지 않기 위함). 대신 `lib/video/motionFilter.ts`가 `crop`(x/y/w/h를 `t`(경과 초) 함수로 표현) + `scale`을 조합해 push-in/pull-out/pan-left/pan-right/follow-flow를 구현한다 — 모든 프레임의 크롭 창이 `t`의 순수 함수라 누적 상태가 없다. 소스 이미지 여백이 부족하면 해당 클립은 `static`으로 자동 폴백한다(렌더 실패시키지 않음).
- **오버레이**: `label`/`highlight`/`arrow-flow`/`diagram`/`chart`는 이미지 모델이 아니라 `lib/video/renderSequenceFrameToPng.ts`(Satori 기반 결정적 SVG/HTML 레이어)로 렌더링해 투명 PNG로 합성한다.
- **전환 효과**: 시퀀스 경계에서는 fade(`PAGE_TRANSITION_DURATION_SEC`), 같은 시퀀스 내부의 씬 전환은 hard cut(`SEQUENCE_HARD_CUT_DURATION_SEC`)을 쓴다 — 씬 모드처럼 모든 전환이 균일한 fade가 아니다.
- **캐시 무효화**: 씬 이미지, 오디오, 카메라 플랜, 마스터 에셋, 오버레이 중 하나라도 바뀌면 `computeSceneClipFingerprint`가 다른 지문을 만들어 해당 클립을 다시 렌더링한다 — 씬 ID가 그대로라는 이유만으로 오래된 클립을 재사용하지 않는다.
- 씬 모드의 `buildVideoClip`(정지 프레임 + 내레이션 + 0.65초 홀드 + 균일 fade, 단일 ffmpeg 프로세스)은 이 기능과 무관하게 byte-for-byte 그대로 유지된다 — 두 렌더러는 `lib/video/buildVideoClip.ts` 안에서 별도 함수(`buildVideoClip` vs `buildSequenceVideoClip`)로 분리되어 있다.

### 제작 모드 전환 불가 규칙

**프로젝트 생성 후에는 제작 모드를 바꿀 수 없다.** UI에 모드 토글이 없으며, API/스토어 레벨에서도 `productionMode`를 변경하는 경로 자체가 존재하지 않는다. 모드를 잘못 선택했다면 새 프로젝트를 만드는 것이 유일한 방법이다(원고를 시퀀스 프로젝트로 "복제"하는 기능은 이 기능 범위 밖의 향후 후보로 `docs/ROADMAP.md`에 남겨둠).

### 화면 설계 품질 개선 + 마스터 비주얼 이동 + 단계 통합 (2026-08-09)

시퀀스 모드 비주얼 결과물의 품질이 낮다는 피드백에서 시작된 3가지 개선. 상세 배경/설계는 계획 파일(세션 중 승인된 plan, 저장소에는 커밋되지 않음) 참고, 여기서는 결과만 정리. 셋 다 **시퀀스 모드에만** 적용되며 씬 모드는 무변경.

1. **화면 설계 AI 호출을 시퀀스 단위로 그룹화**: 기존에는 `selectScreenTypes.ts`가 화면 설계 호출을 제목 계층 구조(`groupContentScenesByParentTitle`)로 묶어, 같은 시퀀스에 속한 씬들이 서로 다른 AI 호출에서 서로를 모른 채 독립적으로 설계되는 것이 품질 저하의 근본 원인이었다. `selectScreenTypes()`가 `sequencePlan`을 받으면 `groupScenesBySequence`(`lib/pipeline/sequenceLookup.ts`)로 시퀀스 경계를 넘지 않게 그룹화하고, 그룹이 공유하는 목적/연속성/마스터 비주얼 설명을 그룹 프롬프트 상단에 한 번만 배치한다 — 씬 모드(`sequencePlan` 없음)는 기존 제목 계층 그룹화 그대로.
2. **마스터 비주얼 생성을 이미지/목업 단계로 이동**: 기존에는 `sequences/[sequenceId]/master-image/route.ts`가 프로젝트가 선택한 이미지 엔진(로컬/OpenAI/H-CHAT)과 무관하게 `createImageClient()`를 무조건 호출하고 공통 프롬프트(톤앤매너)도 반영하지 않았다. 이제 `images/route.ts`와 동일한 엔진 분기(`image-engine.txt` 읽어 로컬/클라우드 선택) + 공통 프롬프트(`image-common-prompt.txt`)를 반영하며, 생성 트리거 UI 자체도 `SequencePlanEditor.tsx`에서 `ImagesEditor.tsx`의 새 "시퀀스 마스터 비주얼" 섹션(`SequenceMasterVisualsSection.tsx`)으로 옮겼다. 마스터 비주얼의 **설명(description) 텍스트 편집**은 시퀀스 설계 데이터이므로 시퀀스 설계 단계에 그대로 남아 있다 — 이미지/목업 단계 쪽 안내 문구는 "설명 수정은 시퀀스 설계 단계에서" 하라고 안내한다.
3. **화면 설계를 시퀀스 설계 단계로 통합**: `SEQUENCE_MODE_STEPS`(`lib/projects/pipelineSteps.ts`)에서 `screen-design` 항목을 제거하고, 씬별 편집 필드를 `ScreenDesignFields.tsx`(`ScreenDesignSceneCard`)로 추출해 `ScreenDesignEditor.tsx`(씬 모드)와 `SequencePlanEditor.tsx`(시퀀스 모드) 양쪽에서 공유한다. 시퀀스 설계 페이지가 시퀀스 계획 생성/편집에 더해 "AI로 화면 설계 생성" 버튼(기존 `POST /screen-design` 스트리밍 엔드포인트 재사용, 위 1번 그룹화 개선 자동 적용)과 각 시퀀스 카드 안 씬별 인라인 화면 설계 편집을 제공한다. `saveAndGoTo`가 `sequences.json`과 `screen-design.json`을 함께 저장한 뒤 `/review`로 이동한다(기존 `/screen-design` 경유 없음). 시퀀스 계획을 편집(`applyOp` 경유 — 이름 변경/연속성/씬 이동/병합/분할 등)하면 `planDirty` 플래그가 켜져 "화면 설계 생성" 버튼이 비활성화되고 경고 문구가 뜬다 — `loadSequenceContextByScene`이 디스크의 `sequences.json`을 읽으므로 저장 전 화면 설계를 생성하면 오래된 컨텍스트로 설계되는 것을 막기 위함이다. `/screen-design` 직접 접근 시 `/sequences`로, 씬 모드에서 `/sequences` 직접 접근 시 `/screen-design`으로 서로 리다이렉트한다(기존 패턴의 대칭).

### 수동 E2E 체크리스트

아래는 이 기능을 머지하기 전에 사람이 브라우저로 직접 실행해서 확인해야 하는 체크리스트다(자동 테스트가 유닛/통합 레벨은 광범위하게 커버하므로, 이 체크리스트는 실제 브라우저 흐름과 생성물 육안 확인에 집중한다).

1. **레거시 프로젝트 회귀 확인**: `productionMode` 필드가 없는(또는 `"scene"`인) 기존 프로젝트를 열어 이미지 생성 → TTS(내레이션 음성) → 영상 생성까지 끝까지 완료한다. 이 과정에서 `sequences.json`이 전혀 생성되지 않아야 한다.
2. **새 씬 모드 프로젝트**: 새 프로젝트를 씬 모드로 생성하고, 파이프라인 단계 바에 "시퀀스 설계" 단계가 나타나지 않는지, `/sequences` 페이지나 관련 API 호출 없이도 화면 설계 단계로 정상 진입하는지 확인한다.
3. **새 시퀀스 모드 프로젝트**: 새 프로젝트를 시퀀스 모드로 생성하고, 시퀀스 설계 단계에서 AI로 계획을 생성 → 사람이 이름 변경/연속성 수정/씬 이동/병합/분할 등을 편집 → 저장한다. 이 과정에서 각 씬의 ID·순서·나레이션(`scenes.json`)이 전혀 바뀌지 않았는지 확인한다.
4. **마스터 비주얼 → 씬 이미지 → TTS/영상 순서 확인**: **이미지/목업 단계**(2026-08-09부터 — 이전에는 시퀀스 설계 단계)에서 엔진/공통 프롬프트를 설정한 뒤 시퀀스별 마스터 비주얼을 명시적으로 생성하고, 씬 이미지를 생성하고, TTS와 영상을 생성한다. 최종 영상에서 같은 시퀀스 내 장면들의 시각적 연속성(장소/스타일 유지)과 오버레이(라벨/화살표/강조 등)가 의도대로 나타나는지 육안 확인한다.
5. **분할/병합/삭제 후 안전성 확인**: 시퀀스 계획이 이미 존재하는 상태에서 씬 분할·병합·삭제를 수행한 뒤, 시퀀스 계획이 `needsReview`/오래된(stale) 상태로 올바르게 표시되는지, 그리고 이미지·마스터 에셋 등이 사용자 확인 없이 조용히 재생성(과금 발생)되지 않는지 확인한다.
6. **화면 설계 통합 확인(2026-08-09)**: 시퀀스 모드 프로젝트의 파이프라인 단계 바에 "화면 설계"가 더 이상 나타나지 않고 "시퀀스 설계" 하나로 합쳐져 있는지, `/screen-design`으로 직접 진입 시 `/sequences`로 리다이렉트되는지, 시퀀스 설계 단계에서 시퀀스 계획 저장 후 "AI로 화면 설계 생성"이 활성화되고 각 시퀀스 카드 안에서 씬별 화면 설계를 인라인으로 편집할 수 있는지, 시퀀스 계획을 편집(이름 변경 등)하면 화면 설계 생성 버튼이 비활성화(dirty 경고)되는지, 저장 후 `/review`로 바로 이동하는지 확인한다. 씬 모드 프로젝트는 "화면 설계"가 독립 단계로 그대로 남아 있고 `/sequences` 직접 접근 시 `/screen-design`으로 리다이렉트되는지 회귀 확인한다.
7. **시퀀스 단위 그룹화로 인한 품질 확인(2026-08-09)**: 여러 씬이 한 시퀀스로 묶인 프로젝트에서 화면 설계를 AI로 생성했을 때, 같은 시퀀스 안 씬들의 화면 구성(레이아웃/톤)이 이전보다 일관되게 나오는지 육안 비교한다.

> 2026-08-07 기준 이 체크리스트 자체는 브라우저로 사람이 실행해야 한다(브라우저 자동화 도구 없이 진행된 세션). 대신 API 레벨로 다음을 `curl`/합성 데이터로 확인함: (a) `productionMode=scene`/`sequence`로 프로젝트 생성 시 `project.json`에 값이 올바르게 저장되고 `sequences.json`은 생성되지 않는지, (b) 씬 모드 프로젝트에 오디오만 채운 합성 씬으로 `POST /video`를 호출해 클립 생성 → concat → `final.mp4` 생성 → `GET /video`로 재생 가능한 mp4가 서빙되는지(엔드투엔드 성공), (c) 시퀀스 모드 프로젝트에서 오디오는 있지만 `sequences.json`이 없을 때 `POST /video`가 정확히 "시퀀스 계획이 없습니다..." 400을 반환하는지. 위 1~5번 체크리스트(AI 생성 품질 육안 확인, 시퀀스 편집 UI, 마스터 비주얼 생성, 카메라 모션/오버레이 실제 영상 확인, 분할/병합 후 stale 처리)는 아직 사람이 브라우저로 확인해야 한다.
>
> 2026-08-09 기준(항목 6, 7 관련 작업, 브라우저 자동화 도구 없이 진행된 세션): 실행 중인 개발 서버에 `curl`로 실제 라우트를 호출해 다음을 확인함 — 5씬짜리 테스트 프로젝트(`narration_pre_edited`로 부트스트랩, 검증 후 삭제)에서 실제 AI 호출로 시퀀스 계획 생성 → 3개 시퀀스로 그룹화되고 "정보보안 3대 수칙" 하위 3개 씬이 한 시퀀스·한 화면 설계 호출로 묶이는지 확인(항목 7 대체 확인), 화면 설계 스트리밍 생성 → PUT 저장까지 전체 흐름, `/screen-design`(시퀀스 모드) → `/sequences` 및 `/sequences`(씬 모드) → `/screen-design` 양방향 리다이렉트, 씬 모드 프로젝트(201씬)의 `/screen-design`이 기존과 동일하게 렌더링되는지, 저장 후 `/review`·`/images`(시퀀스 마스터 비주얼 섹션 렌더링 포함) 정상 로드까지 확인함(항목 6 대체 확인). 다만 이것도 실제 브라우저 클릭/상태 전이(버튼 클릭에 따른 클라이언트 상태 변화)를 육안으로 본 것은 아니므로, 항목 6·7을 포함한 위 체크리스트 전체는 여전히 사람이 브라우저로 최종 확인하는 것을 권장한다.

## 8. 참고 문서 인덱스

- [설계 스펙](superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)
- [구현 계획 (13개 태스크, v1)](superpowers/plans/2026-07-28-elearning-storyboard-generator.md)
- [v2 전면 개편 로드맵 (Phase 0~7)](superpowers/plans/2026-07-29-v2-redesign-roadmap.md)
- [씬·시퀀스 이중 제작 모드 구현 계획 (10개 태스크)](superpowers/plans/2026-08-07-dual-production-mode-sequence-plan.md)
- [파이프라인 단계별 입출력 계약](reference/pipeline-steps.md)
- [DeepSeek API 레퍼런스](reference/deepseek-api.md)
- [로컬 이미지 생성 레퍼런스 (FLUX.2 Klein via mflux)](reference/local-image-generation.md)
- [로컬 TTS 레퍼런스 (Qwen3-TTS via mlx-audio)](reference/local-tts.md)
- [향후 개발 계획](ROADMAP.md)
- [디자인 평가 및 개선 계획 (2026-07-29)](DESIGN_REVIEW.md) — v2 개편 직후 전체 화면 스크린샷 기반 평가, 모바일 레이아웃 버그 3건 포함
- 루트 [`CLAUDE.md`](../CLAUDE.md) — Claude Code 세션용 빠른 요약(이 문서와 중복 최소화, 여기 문서를 정본으로 참조)
