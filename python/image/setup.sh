#!/usr/bin/env bash
# Sets up the local FLUX.2 Klein (mflux) Python environment. Apple Silicon
# only (MLX runs on Metal, not CUDA) — run this once per Mac.
set -euo pipefail
cd "$(dirname "$0")"

python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
pip install -r requirements.txt

echo "downloading model weights (4B ~15GB + 9B ~32GB if licensed, first run only — may take a while)..."
python prefetch_model.py

echo "done. Python: $(pwd)/.venv/bin/python"
