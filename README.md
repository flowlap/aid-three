# aid-three — 이러닝 스토리보드 제작 지원 도구

이러닝 교육 과정 원고(또는 나레이션)를 영상 제작용 스토리보드로 변환하는 로컬 실행 제작 지원 도구. 원고 1개를 프로젝트 1개로 관리하며, 사용자가 각 파이프라인 단계의 AI 산출물을 검토·수정하면서 순차적으로 스토리보드를 완성한다. DB 없이 `data/projects/{project-id}/` 폴더 아래 파일로 저장된다.

## 시작하기

```bash
npm install
cp .env.example .env.local   # 아래 "AI Provider 설정" 참고
npm run dev
```

http://localhost:9625 접속.

### AI Provider 설정

텍스트(LLM)와 이미지 생성은 각각 provider를 독립적으로 선택할 수 있다(`LlmClient`/`ImageClient` 인터페이스, `lib/ai/llm/`·`lib/ai/image/`). 기본값은 기존과 동일한 DeepSeek(텍스트)/OpenAI(이미지)라서, `.env.local`에 해당 키만 넣으면 추가 설정 없이 그대로 동작한다.

- `LLM_PROVIDER` (기본값 `deepseek`): `deepseek` | `hchat-claude` | `hchat-chatgpt` | `hchat-gemini`
- `IMAGE_PROVIDER` (기본값 `openai`): `openai` | `hchat-gemini` | `fal`

| Provider | 필요한 키 | 비고 |
|---|---|---|
| `deepseek` | `DEEPSEEK_API_KEY` | 원고 변환/씬 분할/화면 유형 선정/일관성 검수 등 텍스트 단계 |
| `openai` | `OPENAI_API_KEY` | 5단계 이미지 생성(선택 사항, 실제 과금). 이미지 생성을 안 쓸 거면 생략해도 나머지 단계는 정상 동작하고, 5단계에서 로컬 모델(FLUX.2 Klein, Mac 전용, 아래 참고)로 전환하면 이 키 없이도 이미지를 생성할 수 있다. |
| `hchat-claude` / `hchat-chatgpt` / `hchat-gemini` / (이미지) `hchat-gemini` | `HCHAT_KEY` | 사내 H-CHAT 게이트웨이 — 4개 provider가 키를 공유 |
| (이미지) `fal` | `FAL_KEY` | fal.ai 이미지 생성(큐 REST API). 기본 모델 `fal-ai/flux/schnell`(텍스트→이미지), `FAL_IMAGE_MODEL`로 변경 — `google/nano-banana-2-lite` 등 Nano Banana 계열로 바꾸면 배경 고정/강사 표시 등 참조 이미지도 지원(`/edit` 엔드포인트) |

Provider별 모델명은 `.env.example`에 나열된 `*_MODEL_ACCURATE`/`*_MODEL_FAST`(또는 `HCHAT_GEMINI_IMAGE_MODEL`) 변수로 오버라이드할 수 있고, 생략 시 기본 모델을 쓴다. 아키텍처 상세는 [H-CHAT provider 추상화 설계 문서](docs/superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md) 참고.

## 테스트 / 타입 체크

```bash
npm test              # vitest
npx tsc --noEmit       # 타입 체크
npm run lint           # eslint
```

## 제작 모드: 시퀀스 모드 vs 씬 모드

프로젝트를 만들 때 **제작 모드**를 고른다. 모드에 따라 파이프라인 중간 단계와 이미지/영상 생성 방식이 갈라지며, **생성 후에는 바꿀 수 없다**(모드를 잘못 골랐다면 새 프로젝트를 만들어야 한다).

> **기본값은 시퀀스 모드**다. `productionMode` 필드가 없는 과거(레거시) 프로젝트는 하위호환을 위해 계속 씬 모드로 취급된다.

|  | **시퀀스 모드** (`sequence`, 기본) | 씬 모드 (`scene`) |
|---|---|---|
| 언제 | 카메라 워크가 있는 하나의 흐름으로 이어지는 비주얼 영상 | 정적인 슬라이드형 과정, 씬마다 독립적인 화면 |
| 화면 구성 | 시퀀스당 **마스터 비주얼 1장**(배경 플레이트) + 씬별 **오버레이 레이어**를 합성 | 씬마다 **독립 AI 이미지** 생성 |
| 이미지 모델 호출 | 시퀀스당 마스터 1장에만(씬 합성은 비용 없음) | 씬마다 1회 |
| 영상 | 마스터를 **카메라 모션(crop pan/zoom)** 으로 애니메이션 + 오버레이 고정 합성, 시퀀스 경계 전환 효과 | 정지 프레임 + 내레이션 + 균일 fade |
| 추가 산출물 | `sequences.json`, `sequence-assets/{sequenceId}/{assetId}.png` | 없음 |

### 시퀀스 모드 진행 순서

```
업로드 → 1.원고 변환 → 2.씬 분할 → 3.시퀀스 설계 → 4.화면 설계
  → 5.일관성 검수 → 6.이미지/목업 생성 → 7.최종 뷰
  → (선택) 내레이션 음성 생성 + 동영상 생성(Mac 전용)
```

1. **시퀀스 설계**: AI가 씬들을 시퀀스로 묶고 각 시퀀스에 연속성·마스터 비주얼 설명·카메라 플랜·오버레이를 생성. 사용자가 검토·편집한 뒤, **"마스터 비주얼 일괄 생성"**(또는 시퀀스별 개별 생성) 버튼으로 실제 마스터 이미지를 만든다. **시퀀스 모드에서 이미지 모델을 쓰는 유일한 단계.**
2. **화면 설계 / 일관성 검수**: 씬별 화면 유형·캡션·검수(시퀀스 모드에선 주로 타이틀 카드·캡션용).
3. **이미지/목업 생성**: 각 콘텐츠 씬 = 마스터(카메라 시작 프레임 크롭) + 오버레이 레이어를 결정적으로 합성해 `images/{sceneId}.png`에 굽는다(이미지 모델 호출 없음). 마스터가 없는 시퀀스의 씬은 캡션 카드로 폴백.
4. **최종 뷰 → 내레이션 음성 → 동영상 생성**: 영상은 마스터를 카메라 모션으로 움직이고 오버레이를 고정 합성해 클립을 만들고 이어붙인다.

### 씬 모드 진행 순서

```
업로드 → 1.원고 변환 → 2.씬 분할 → 3.화면 설계 → 4.일관성 검수
  → 5.이미지/목업 생성(선택) → 6.최종 스토리보드 뷰
  → (선택) 미리보기 / PPTX 내보내기 / 내레이션 음성 생성 + 동영상 생성(Mac 전용)
```

아래 "파이프라인 기능 개요" 표는 씬 모드 기준이며, 시퀀스 모드는 위 순서(시퀀스 설계 단계 추가 + 이미지 단계가 합성 방식)를 따른다.

## 파이프라인 기능 개요

```
업로드(PDF/TXT/텍스트 붙여넣기)
  → 1단계 원고 변환 → 2단계 씬 분할 → 3단계 화면 설계
  → 4단계 일관성 검수 → 5단계 이미지/목업 생성(선택) → 6단계 최종 스토리보드 뷰
  → (선택) 미리보기 / PPTX 내보내기 / 내레이션 음성 생성 + 동영상 생성(Mac 전용)
```

각 단계는 "AI 생성 → 사용자 검토/수정 → 다음 단계" 패턴의 선형 마법사(wizard) UI다. 상단 스테퍼의 완료 체크 표시는 `project.currentStep`이 아니라 **각 단계의 실제 산출물이 디스크에 존재하는지**로 판단한다(예: 화면 설계는 제목 씬을 제외한 모든 씬에 화면 유형이 할당됐는지).

| 단계 | 산출물 | 설명 |
|---|---|---|
| 업로드 | `source/`, `extracted.txt` | PDF/TXT 업로드 또는 텍스트 붙여넣기로 시작 |
| 1. 원고 변환 | `narration.md` | AI가 원고를 나레이션체 마크다운으로 변환(직접 수정 가능) |
| 2. 씬 분할 | `scenes.json` | 원고의 `#`/`##`/`###` 헤더를 제목 씬(뎁스 포함)으로, 본문을 내용 씬으로 분할. 씬 병합/분리/삭제, 계층 들여쓰기·브레드크럼 표시 |
| 3. 화면 설계 | `screen-design.json` | 내용 씬을 최하위 제목 기준으로 그룹핑해 그룹당 1회 AI 호출로 화면 유형·자막·키워드·배치 설계(제목 씬은 AI 호출 없이 로컬 처리) |
| 4. 일관성 검수 | `review.json` | 결정적 검사(레이아웃 중복, 나레이션 길이, 씬 번호) + AI 의미 검사 |
| 5. 이미지/목업 생성 (선택) | `images/{sceneId}.png` | 상단에서 엔진 선택: 설정된 이미지 provider(기본값 OpenAI, `IMAGE_PROVIDER`로 변경 가능, 실제 과금)로 씬별 이미지 생성(제목 씬 제외) 또는 **로컬 FLUX.2 Klein**(mflux, Mac 전용, 무료 — 아래 참고). 새 호출은 최소 4초 간격으로만 시작되도록 페이싱하면서 여러 개를 동시에 진행(H-CHAT Gemini의 분당 호출 한도 대응), 실패 시 재시도(일반 오류 5초 후 1회, rate limit 30초 후 2회) 후에도 계속 실패하는 씬은 건너뛰고 나머지를 계속 진행(경고 표시, 전체 중단 아님) |
| 6. 최종 스토리보드 뷰 | 없음(조합 렌더링) | 읽기 전용 최종 결과, PPTX 내보내기 버튼 포함 |
| 미리보기 | 없음 | 좌측 씬 목차 + 우측 이미지/화면설계 나란히 보기 |
| 내레이션 음성 생성 | `audio/{sceneId}.wav`, `video/final.mp4` | 로컬 TTS로 씬별 음성 생성 후 동영상으로 합성 (**Mac 전용**, 아래 참고) |
| PPTX 내보내기 | `.pptx` 다운로드 | 기본 템플릿 또는 프로젝트별 업로드 템플릿으로 내보내기 |

## 로컬 TTS(내레이션 음성 생성) 실행 방법

내레이션 음성은 외부 API가 아니라 **이 Mac에서 로컬로 돌아가는 Qwen3-TTS**(`mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit`, MLX)를 사용한다. MLX는 Apple Silicon(Metal) 전용이라 **이 기능(내레이션 음성 생성 + 동영상 생성)은 Mac에서만 동작한다** — Windows에서는 이 두 기능만 못 쓰고 나머지 파이프라인 단계는 그대로 사용할 수 있다.

### 최초 설정 (Mac 1대당 1회)

```bash
cd python/tts
./setup.sh
```

`python/tts/.venv`에 가상환경을 만들고 `mlx-audio`를 설치한 뒤, 모델 가중치(수백 MB~수 GB)까지 미리 Hugging Face 캐시(`~/.cache/huggingface`)에 다운로드해둔다 — 그래서 실제 첫 음성 생성 요청은 대기 없이 바로 시작된다.

### 실행

별도로 띄울 서버/프로세스는 없다 — `npm run dev`로 앱을 띄운 상태에서 프로젝트의 "내레이션 음성 생성" 페이지에서 버튼을 누르면, Node가 `python/tts/generate.py`를 그때그때 자식 프로세스로 실행한다(1.7B 모델 로딩이 무거워서 씬마다 새로 띄우지 않고, 작업 1회 시작 시 프로세스 하나로 모든 씬을 순차 처리). 진행률/취소는 이미지 생성 단계와 동일한 UI를 재사용한다. 씬마다 독립적으로 합성하면 텍스트 내용에 따라 톤(슬픔/당참 등)이 들쭉날쭉해지는 문제가 있어, 모든 씬에 고정된 톤 지시(`instruct`, `TTS_DEFAULT_INSTRUCT`)를 함께 전달해 일정한 내레이션 톤을 유지한다 — 별도 UI 설정은 없다.

- 다른 Python 인터프리터를 쓰고 싶으면 `TTS_PYTHON_BIN` 환경변수로 경로를 지정할 수 있다(기본값: `python/tts/.venv/bin/python`).
- 동영상 생성(음성 + 프레임 → mp4)은 **ffmpeg**가 필요하다: `brew install ffmpeg`.

상세 내용은 [`docs/reference/local-tts.md`](docs/reference/local-tts.md) 참고.

## 로컬 이미지 생성(FLUX.2 Klein) 실행 방법

5단계 상단의 엔진 선택기에서 "로컬 모델"을 고르면 OpenAI 대신 **이 Mac에서 로컬로 돌아가는 FLUX.2 Klein**(Black Forest Labs, 4B/9B)을 [mflux](https://github.com/filipstrand/mflux)(MLX)로 실행한다. TTS와 마찬가지로 Apple Silicon 전용이라 **Mac에서만 동작한다** — Windows에서는 OpenAI 엔진만 사용 가능하다.

### 최초 설정 (Mac 1대당 1회)

```bash
cd python/image
./setup.sh
```

`python/image/.venv`에 가상환경을 만들고 `mflux`를 설치한 뒤, 4B(~15GB)와 9B(~32GB)를 미리 다운로드해둔다 — 그래서 실제 첫 이미지 생성 요청은 대기 없이 바로 시작된다. 9B는 게이팅된 모델이라 사전에 라이선스 동의 + 로그인이 안 되어 있으면 그 부분만 건너뛰고(설치 자체는 계속 성공) 실제로 9B를 처음 쓸 때 다운로드된다 — 로그인 방법은 [`docs/reference/local-image-generation.md`](docs/reference/local-image-generation.md) 참고.

### 실행

TTS와 동일하게 별도 서버 없이, "AI로 이미지 생성" 버튼을 누르면 Node가 `python/image/generate.py`를 자식 프로세스로 실행해 모델을 한 번 로드하고 대기 중인 씬을 순차 생성한다(동시 생성 1개). 전체 배치는 빠른 초안 해상도(1024×576)로, 씬별 "이미지 재생성"은 고품질 해상도(1344×768)로 생성한다. 배경 고정/강사 표시 참조 이미지도 OpenAI 경로와 동일하게 지원된다. 4B는 Apache 2.0(기본), 9B는 FLUX.2-dev 비상업 라이선스(내부 검수·비상업 용도로만 사용).

- 다른 Python 인터프리터를 쓰고 싶으면 `LOCAL_IMAGE_PYTHON_BIN` 환경변수로 경로를 지정할 수 있다(기본값: `python/image/.venv/bin/python`).

상세 내용은 [`docs/reference/local-image-generation.md`](docs/reference/local-image-generation.md) 참고.

## 문서

- [프로젝트 개요](docs/PROJECT_OVERVIEW.md) — 아키텍처, 파일 구조, 코딩 패턴 정리(새 세션 시작 시 먼저 읽을 문서)
- [향후 개발 계획](docs/ROADMAP.md)
- [설계 문서](docs/superpowers/specs/2026-07-27-elearning-storyboard-generator-design.md)
- [파이프라인 단계별 입출력 명세](docs/reference/pipeline-steps.md)
- [화면 유형 레퍼런스](docs/reference/screen-types.md)
- [로컬 TTS 레퍼런스](docs/reference/local-tts.md)
- [로컬 이미지 생성 레퍼런스](docs/reference/local-image-generation.md)
- [DeepSeek API 레퍼런스](docs/reference/deepseek-api.md)
- [H-CHAT provider 추상화 설계 문서](docs/superpowers/specs/2026-08-03-hchat-provider-abstraction-design.md) — LLM/이미지 provider 선택 구조(DeepSeek/OpenAI ↔ 사내 H-CHAT)
