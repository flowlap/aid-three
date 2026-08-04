# 로컬 TTS (Qwen3-TTS via mlx-audio)

내레이션 음성 합성은 외부 API가 아니라 이 Mac에서 로컬로 돌아가는 [Qwen3-TTS-12Hz-1.7B-CustomVoice](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-CustomVoice)를 [mlx-community의 8bit MLX 변환판](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit)으로 사용한다. MLX는 Apple Silicon(Metal) 전용이라 **이 기능은 Mac에서만 동작한다** — Windows 세션에서는 TTS/동영상 생성 단계를 사용할 수 없다(다른 파이프라인 단계는 영향 없음).

## 최초 설정 (Mac 1대당 1회)

```bash
cd python/tts
./setup.sh
```

`python/tts/.venv`에 가상환경을 만들고 `mlx-audio`를 설치한 뒤, `prefetch_model.py`로 모델 가중치까지 미리 Hugging Face 캐시(`~/.cache/huggingface`)에 다운로드해둔다 — 그래서 실제 "내레이션 음성 생성" 첫 실행이 다운로드 대기 없이 바로 시작된다. `setup.sh` 실행 중 터미널에 다운로드 진행률이 그대로 보인다.

## 동작 방식

- Node(`lib/ai/localTtsClient.ts`)는 Python을 직접 호출하지 않고, `python/tts/generate.py`를 `child_process.spawn`으로 실행한다.
- **씬 하나당 프로세스를 새로 띄우지 않는다** — 1.7B 모델 로딩 자체가 무거워서 매 씬마다 재실행하면 매우 느려진다. 대신 "TTS 생성" 작업을 한 번 시작할 때 Python 프로세스를 하나만 띄워 모델을 한 번 로드하고, 그 안에서 여러 씬을 순차 처리한다.
- 진행 상황은 자식 프로세스가 stdout에 한 줄씩 찍는 NDJSON을 Node가 그대로 릴레이해서, 기존 이미지 생성 단계와 동일한 진행률/취소 UI를 재사용한다.
- 취소(cancel) 시 Node가 자식 프로세스를 kill한다.

## 환경변수

- `TTS_PYTHON_BIN` (선택): `python/tts/.venv/bin/python`이 아닌 다른 Python 인터프리터를 쓰고 싶을 때만 설정.

## 알려진 제약

- Windows에서는 사용 불가 (MLX는 Apple Silicon 전용).
- 첫 요청 시 모델 다운로드(수백 MB~수 GB)와 로딩 시간이 소요된다.
