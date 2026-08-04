"""
Batch scene image synthesis for one local image-generation job run. Loads the
FLUX.2 Klein MLX model (via mflux) once, then generates each item in order,
writing one PNG file per scene and printing one NDJSON line per completed
scene to stdout so the calling Node process (lib/ai/localImageClient.ts) can
relay progress as it happens. Mirrors python/tts/generate.py's spawn-once /
NDJSON-progress shape.

Input (stdin, one JSON object):
  {"items": [{"sceneId": "scene-001", "prompt": "...", "referenceImagePaths": ["/abs/reference-background.png"]}],
   "modelSize": "4b" | "9b", "width": 1024, "height": 576, "steps": 4,
   "quantize": 8, "outputDir": "/abs/path/to/data/projects/{id}/images"}

Output (stdout, one JSON object per line, flushed immediately):
  {"sceneId": "scene-001", "status": "done", "path": "..."}
  {"sceneId": "scene-002", "status": "error", "message": "..."}

Model loading log noise goes to stderr so it never gets parsed as an NDJSON
progress line. This includes noise mflux/huggingface_hub print on their own
(e.g. "Downloading model from HuggingFace: ..." and tqdm progress bars use
plain print()/stdout by default) — sys.stdout is redirected to stderr for the
whole process below, before those libraries are ever imported, so nothing
they print can land on the real stdout pipe Node reads as NDJSON. `emit()`
holds onto the original stdout handle from before the redirect so it can
still write there directly.

Items with referenceImagePaths use FLUX.2's image-conditioned edit mode
(Flux2KleinEdit); items without use plain text-to-image (Flux2Klein). Both
model handles are lazy-loaded (only the ones actually needed for this batch
get built) and reused across every item that needs them, since loading
either is expensive — on a first run (no cached weights yet) this includes a
multi-GB Hugging Face download, so a batch/scene can look idle for several
minutes before the first NDJSON line ever appears. That download progress
itself isn't relayed to the caller (no percentage in the NDJSON protocol
below), just muted to stderr — see docs/reference/local-image-generation.md.
"""

import json
import random
import sys
from pathlib import Path

MAX_SEED = 2**31 - 1

_real_stdout = sys.stdout
sys.stdout = sys.stderr  # mute any print()/tqdm noise from imported libraries — see module docstring


def log(*args):
    print(*args, file=sys.stderr, flush=True)


def emit(obj):
    print(json.dumps(obj, ensure_ascii=False), file=_real_stdout, flush=True)


class ModelPool:
    """Lazily builds and caches the txt2img / edit model handles this batch actually needs."""

    def __init__(self, model_size: str, quantize: int | None):
        self.model_size = model_size
        self.quantize = quantize
        self._txt2img = None
        self._edit = None

    def _model_config(self):
        from mflux.models.common.config import ModelConfig

        return ModelConfig.flux2_klein_9b() if self.model_size == "9b" else ModelConfig.flux2_klein_4b()

    def txt2img(self):
        if self._txt2img is None:
            log(f"loading Flux2Klein ({self.model_size}, quantize={self.quantize}) ...")
            from mflux.models.flux2.variants import Flux2Klein

            self._txt2img = Flux2Klein(model_config=self._model_config(), quantize=self.quantize)
            log("Flux2Klein loaded")
        return self._txt2img

    def edit(self):
        if self._edit is None:
            log(f"loading Flux2KleinEdit ({self.model_size}, quantize={self.quantize}) ...")
            from mflux.models.flux2.variants import Flux2KleinEdit

            self._edit = Flux2KleinEdit(model_config=self._model_config(), quantize=self.quantize)
            log("Flux2KleinEdit loaded")
        return self._edit


def main():
    payload = json.loads(sys.stdin.read())
    items = payload["items"]
    model_size = payload.get("modelSize") or "4b"
    width = payload.get("width") or 1024
    height = payload.get("height") or 576
    steps = payload.get("steps") or 4
    quantize = payload.get("quantize")
    output_dir = Path(payload["outputDir"])
    output_dir.mkdir(parents=True, exist_ok=True)

    if not items:
        return

    pool = ModelPool(model_size=model_size, quantize=quantize)
    log(f"starting batch: {len(items)} scene(s), {width}x{height}, steps={steps}")

    for item in items:
        scene_id = item["sceneId"]
        prompt = item["prompt"]
        reference_paths = item.get("referenceImagePaths") or []
        try:
            seed = random.randint(0, MAX_SEED)
            if reference_paths:
                image = pool.edit().generate_image(
                    seed=seed,
                    prompt=prompt,
                    image_paths=reference_paths,
                    num_inference_steps=steps,
                    width=width,
                    height=height,
                )
            else:
                image = pool.txt2img().generate_image(
                    seed=seed,
                    prompt=prompt,
                    num_inference_steps=steps,
                    width=width,
                    height=height,
                )

            out_path = output_dir / f"{scene_id}.png"
            image.save(out_path, overwrite=True)
            emit({"sceneId": scene_id, "status": "done", "path": str(out_path)})
        except Exception as err:  # noqa: BLE001 — report and let the caller (Node) decide whether to resume
            emit({"sceneId": scene_id, "status": "error", "message": str(err)})
            raise


if __name__ == "__main__":
    main()
