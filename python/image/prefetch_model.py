"""
One-time model download/cache warm-up, run by setup.sh right after the venv
is created. Without this, the first real "AI로 이미지 생성" request has to
download the model (~15GB for 4B, ~32GB for 9B) with no progress shown in the
UI (see generate.py's module docstring — that download noise is deliberately
muted to stderr there so it doesn't corrupt the NDJSON protocol). Running it
here instead means the download happens once, up front, with normal terminal
output — and it also validates that mflux actually loads on this machine
before the app ever tries to use it.

4B (Apache 2.0, ungated) always downloads. 9B sits behind a separate,
gated Hugging Face license (see docs/reference/local-image-generation.md for
the accept-license + `hf auth login` steps) — attempted here too, but failure
is caught and just printed as a skip notice rather than aborting the script,
so setup.sh still succeeds for anyone who hasn't gone through that flow yet
(or doesn't plan to ever use 9B). Re-run this script after logging in to
pick up 9B.

QUANTIZE should match LOCAL_IMAGE_QUANTIZE in
lib/pipeline/imageGenerationConfig.ts and generate.py's ModelPool default.
"""

from mflux.models.common.config import ModelConfig
from mflux.models.flux2.variants import Flux2Klein

QUANTIZE = 8

print(f"[prefetch] downloading/loading FLUX.2 Klein 4b (quantize={QUANTIZE}) ...")
Flux2Klein(model_config=ModelConfig.flux2_klein_4b(), quantize=QUANTIZE)
print("[prefetch] 4b done.")

print(f"[prefetch] downloading/loading FLUX.2 Klein 9b (quantize={QUANTIZE}) ...")
try:
    Flux2Klein(model_config=ModelConfig.flux2_klein_9b(), quantize=QUANTIZE)
    print("[prefetch] 9b done.")
except Exception as err:  # noqa: BLE001 — gated-repo/auth failure shouldn't abort setup.sh for 4B-only users
    print(f"[prefetch] 9b 건너뜀 (라이선스 동의/로그인 필요할 수 있음): {err}")
    print(
        "[prefetch] 9b가 필요하면 https://huggingface.co/black-forest-labs/FLUX.2-klein-9B 에서 "
        "라이선스에 동의하고 `hf auth login`으로 로그인한 뒤 이 스크립트를 다시 실행하세요."
    )
