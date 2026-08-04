"""
One-time model download/cache warm-up, run by setup.sh right after the venv
is created. Without this, the first real "내레이션 음성 생성" request has to
download the model (hundreds of MB to a few GB) with no progress shown in
the UI, which looks like it's hung. Running it here instead means the
download happens once, up front, with normal terminal output — and it also
validates that mlx-audio actually loads on this machine before the app ever
tries to use it.

MODEL_ID must match generate.py's MODEL_ID constant.
"""

from mlx_audio.tts.utils import load_model

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"

print(f"[prefetch] downloading/loading {MODEL_ID} ...")
load_model(MODEL_ID)
print("[prefetch] done.")
