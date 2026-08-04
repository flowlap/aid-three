# 로컬 이미지 생성 (FLUX.2 Klein via mflux)

5단계(이미지 생성)에서 OpenAI Images API 대신, 이 Mac에서 로컬로 돌아가는 [FLUX.2 Klein](https://huggingface.co/black-forest-labs/FLUX.2-klein-4B)(Black Forest Labs)을 [mflux](https://github.com/filipstrand/mflux)(MLX 기반 구현)로 실행하는 옵션을 선택할 수 있다. MLX는 Apple Silicon(Metal) 전용이라 **이 기능은 Mac에서만 동작한다** — Windows 세션에서는 로컬 엔진을 선택해도 실패한다(OpenAI 엔진은 영향 없음).

## 최초 설정 (Mac 1대당 1회)

```bash
cd python/image
./setup.sh
```

`python/image/.venv`에 가상환경을 만들고 `mflux`를 설치한 뒤, `prefetch_model.py`로 **4B**(~15GB) 가중치를 미리 Hugging Face 캐시(`~/.cache/huggingface`)에 다운로드해둔다 — 그래서 실제 "AI로 이미지 생성" 첫 실행이 다운로드 대기 없이 바로 시작된다. `setup.sh` 실행 중 터미널에 다운로드 진행률이 그대로 보인다.

**9B도 이어서 시도한다**(~32GB) — 다만 게이팅된 모델이라(아래 "환경변수" 참고) 라이선스 동의 + `hf auth login`을 먼저 하지 않았으면 이 단계는 실패 메시지만 찍고 건너뛴다(스크립트 자체는 계속 정상 종료). 나중에 로그인한 뒤 `setup.sh`를 다시 실행하면(venv 생성/`pip install`은 이미 되어 있어 그냥 통과되고) 9B만 새로 받아온다.

## 모델 크기

이미지 생성 엔진 선택기에서 로컬 모델을 고르면 4B/9B 중 선택할 수 있다.

| | 4B (기본) | 9B (고품질) |
|---|---|---|
| 라이선스 | Apache 2.0 (상업 사용 가능) | FLUX.2-dev 비상업 라이선스 — **내부 검수 또는 비상업 용도로만 사용** |
| 가중치 크기 | 약 15GB | 약 32GB (FP16 기준, 8bit 양자화 시 더 작음) |
| 용도 | 기본 생성 엔진 | 고품질 재생성이 필요할 때만 |

두 크기 모두 8-bit 양자화(`quantize=8`)로 실행되어 메모리 사용량을 줄인다(`lib/pipeline/imageGenerationConfig.ts`의 `LOCAL_IMAGE_QUANTIZE`).

## 해상도

- 전체 배치 생성("AI로 이미지 생성"): 1024×576 (빠른 초안, 4-step)
- 씬 카드의 "이미지 재생성"(개별 씬): 1344×768 (고품질, 그 씬만 다시)

## 동작 방식

- Node(`lib/ai/localImageClient.ts`)는 Python을 직접 호출하지 않고, `python/image/generate.py`를 `child_process.spawn`으로 실행한다 — 로컬 TTS(`lib/ai/localTtsClient.ts`)와 동일한 패턴.
- **씬 하나당 프로세스를 새로 띄우지 않는다**(전체 배치 생성 시) — 모델 로딩 자체가 무거워서 매 씬마다 재실행하면 매우 느려진다. 대신 "이미지 생성" 작업을 한 번 시작할 때 Python 프로세스를 하나만 띄워 모델을 한 번 로드하고, 그 안에서 여러 씬을 순차 처리한다.
- **동시 생성은 항상 1개**(`LOCAL_IMAGE_CONCURRENCY`) — 로컬 GPU 한 대로는 병렬 처리 이점이 없다. OpenAI 경로의 `IMAGE_GENERATION_CONCURRENCY`(그룹 단위 동시 3개)와 달리 모든 대기 씬을 하나의 순서 있는 배치로 넘긴다.
- 진행 상황은 자식 프로세스가 stdout에 한 줄씩 찍는 NDJSON을 Node가 그대로 릴레이해서, 기존 이미지 생성 진행률/취소 UI를 재사용한다.
- 취소(cancel) 시 Node가 자식 프로세스를 kill한다.
- 한 씬 생성이 실패하면 재시도 없이 배치 전체가 중단된다(로컬 TTS와 동일 정책) — 이미 완료된 씬은 디스크에 남아 있으므로, 5단계의 "이어서 생성"(resume) 버튼으로 실패 지점부터 재개하면 된다.
- 씬별 "이미지 재생성"은 같은 씬에 대해 동시에 두 번 요청되지 않도록 서버에서 막는다(`images/[sceneId]/route.ts`의 in-flight 잠금) — 첫 실행 중 응답이 없다고 버튼을 다시 눌러도 두 번째 요청은 409로 즉시 거부되고, 모델을 중복으로 다운로드/로드하는 일은 없다.

## 참조 이미지(배경 고정 / 강사 표시)

OpenAI 경로가 `images/edits`로 참조 이미지를 조건부 생성에 사용하는 것처럼, 로컬 엔진도 FLUX.2의 이미지 조건부 편집 모드(`Flux2KleinEdit`, `image_paths`)로 동일하게 지원한다. "배경 고정"/"강사 표시" 토글이 켜져 있으면 저장된 참조 이미지 파일 경로(`data/projects/{id}/reference-background.png`, `reference-presenter.png`)를 그대로 `Flux2KleinEdit`에 넘긴다. 참조 이미지가 없으면 일반 텍스트-이미지 모드(`Flux2Klein`)를 사용한다. `python/image/generate.py`는 두 모델 핸들을 필요할 때만 지연 로드해 재사용한다.

## 텍스트 렌더링

로컬 엔진은 화면 유형과 무관하게 **자막/캡션 텍스트를 이미지에 굽지 않는다**(`allowTextInImage: false`) — 한글 타이포그래피를 이미지 생성 모델에 안정적으로 렌더링하기 어렵기 때문이다. 자막은 대신 PPTX 내보내기 시 별도의 텍스트 placeholder로 삽입된다(이미 `design.caption` 기반으로 동작 — 이 기능을 위해 추가로 바뀐 부분 없음).

## 환경변수

- `LOCAL_IMAGE_PYTHON_BIN` (선택): `python/image/.venv/bin/python`이 아닌 다른 Python 인터프리터를 쓰고 싶을 때만 설정.
- `HF_TOKEN`: 9B는 [FLUX.2-klein-9B](https://huggingface.co/black-forest-labs/FLUX.2-klein-9B) 저장소 자체가 게이팅되어 있어, 인증 없이 받으면 `401 Cannot access gated repo` 에러가 난다(`setup.sh`가 9B를 시도할 때도, 앱에서 처음 9B를 실제로 쓸 때도 동일). 9B를 쓰려면(4B는 해당 없음) `setup.sh` 실행 **전에** 미리:
  1. 위 저장소 페이지에서 Hugging Face 계정으로 로그인 후 라이선스 동의(접근 요청)
  2. https://huggingface.co/settings/tokens 에서 Read 권한 토큰 발급
  3. 터미널에서 `cd python/image && .venv/bin/hf auth login` 실행 후 토큰 입력(토큰을 코드/설정 파일에 직접 넣지 말 것 — 이 로그인은 `~/.cache/huggingface/token`에 저장되어 이후 자동 인증됨, `.env.local`/서버 재시작 불필요)

## 알려진 제약

- Windows에서는 사용 불가 (MLX는 Apple Silicon 전용).
- `setup.sh` 실행 시점에 HF 로그인/9B 라이선스 동의가 안 되어 있었다면 **9B는 여전히 처음 실제로 쓸 때 다운로드된다**(~32GB) — 이 진행 상황은 화면에 표시되지 않는다(버튼은 그냥 "생성 중..."으로만 보임, NDJSON 진행률 프로토콜에 다운로드 퍼센트 항목이 없음). 이 경우 처음 9B를 쓸 때는 몇 분간 멈춘 것처럼 보여도 정상이니 재시도하지 말고 기다릴 것 — 서버 콘솔 로그(`npm run dev` 실행 터미널)에서 `~/.cache/huggingface` 다운로드가 실제로 진행 중인지 확인 가능하다. 로그인 후 `setup.sh`를 다시 실행해뒀다면 이 대기 자체가 없다.
- 9B는 비상업 라이선스이므로 상업적 최종 산출물에는 4B(기본값)를 사용할 것.
