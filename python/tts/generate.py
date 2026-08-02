"""
Batch narration synthesis for one TTS job run. Loads the Qwen3-TTS MLX model
once, then synthesizes each item in order, writing one WAV file per scene and
printing one NDJSON line per completed scene to stdout so the calling Node
process (lib/ai/localTtsClient.ts) can relay progress as it happens.

Input (stdin, one JSON object):
  {"items": [{"sceneId": "scene-001", "text": "..."}], "voice": "Sohee",
   "langCode": "Korean", "outputDir": "/abs/path/to/data/projects/{id}/audio"}

Output (stdout, one JSON object per line, flushed immediately):
  {"sceneId": "scene-001", "status": "done", "path": "..."}
  {"sceneId": "scene-002", "status": "error", "message": "..."}

Model loading log noise goes to stderr so it never gets parsed as an NDJSON
progress line.
"""

import json
import sys
import wave
from pathlib import Path

import numpy as np

MODEL_ID = "mlx-community/Qwen3-TTS-12Hz-1.7B-CustomVoice-8bit"


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), flush=True)


def write_wav(path: Path, audio: np.ndarray, sample_rate: int):
    pcm = (np.clip(audio, -1.0, 1.0) * 32767).astype(np.int16)
    with wave.open(str(path), "wb") as f:
        f.setnchannels(1)
        f.setsampwidth(2)
        f.setframerate(sample_rate)
        f.writeframes(pcm.tobytes())


def main():
    payload = json.loads(sys.stdin.read())
    items = payload["items"]
    voice = payload.get("voice") or "Sohee"
    lang_code = payload.get("langCode") or "Korean"
    output_dir = Path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    if not items:
        return

    log(f"loading {MODEL_ID} ...")
    from mlx_audio.tts.utils import load_model

    model = load_model(MODEL_ID)
    log(f"loaded, synthesizing {len(items)} scene(s)")

    for item in items:
        scene_id = item["sceneId"]
        text = item["text"]
        try:
            chunks = []
            sample_rate = None
            for result in model.generate(text, voice=voice, lang_code=lang_code):
                chunks.append(np.array(result.audio, dtype=np.float32))
                sample_rate = result.sample_rate
            if not chunks or sample_rate is None:
                raise RuntimeError("모델이 오디오를 생성하지 않았습니다")

            audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
            out_path = output_dir / f"{scene_id}.wav"
            write_wav(out_path, audio, sample_rate)
            emit({"sceneId": scene_id, "status": "done", "path": str(out_path)})
        except Exception as err:  # noqa: BLE001 — report and continue to the next scene's caller decision is Node's
            emit({"sceneId": scene_id, "status": "error", "message": str(err)})
            raise


if __name__ == "__main__":
    main()
