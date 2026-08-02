#!/usr/bin/env bash
# Sets up the local Qwen3-TTS (mlx-audio) Python environment. Apple Silicon
# only (MLX runs on Metal, not CUDA) — run this once per Mac.
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

echo "done. Python: $(pwd)/.venv/bin/python"
