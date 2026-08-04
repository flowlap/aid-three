import { spawn } from "child_process";
import { promises as fs, existsSync } from "fs";
import path from "path";
import readline from "readline";
import type { LocalImageModelSize } from "../pipeline/imageGenerationConfig";

export interface LocalImageBatchItem {
  sceneId: string;
  prompt: string;
  /** Absolute paths to reference images (e.g. fixed background/presenter) for image-conditioned edit mode. Omit/empty for plain text-to-image. */
  referenceImagePaths?: string[];
}

export interface LocalImageOptions {
  modelSize: LocalImageModelSize;
  width: number;
  height: number;
  steps: number;
  quantize: number;
  signal?: AbortSignal;
}

export interface LocalImageSceneResult {
  sceneId: string;
  image: Buffer;
}

export interface LocalImageClient {
  /**
   * Generates every item in one run. Batched (rather than one call per
   * scene) because the underlying model is expensive to load — see
   * docs/reference/local-image-generation.md. `onScene` fires as each scene
   * finishes so callers can stream progress the same way the OpenAI path
   * does. Concurrency is always 1 (one local GPU) — items are generated
   * strictly in order within the spawned process.
   */
  generateBatch(
    items: LocalImageBatchItem[],
    options: LocalImageOptions & { onScene?: (result: LocalImageSceneResult) => void | Promise<void> }
  ): Promise<void>;
}

interface GenerateLine {
  sceneId: string;
  status: "done" | "error";
  path?: string;
  message?: string;
}

/**
 * Spawns python/image/generate.py once per batch (not once per scene — the
 * FLUX.2 Klein model is expensive to load, so this Python process loads it
 * once and generates every pending scene before exiting). Progress is
 * relayed via one NDJSON line per finished scene on the child's stdout.
 * Mirrors LocalMlxTtsClient (lib/ai/localTtsClient.ts) exactly.
 */
export class LocalMlxImageClient implements LocalImageClient {
  constructor(
    private readonly pythonBin: string,
    private readonly scriptPath: string,
    private readonly imagesOutputDir: string
  ) {}

  async generateBatch(
    items: LocalImageBatchItem[],
    options: LocalImageOptions & { onScene?: (result: LocalImageSceneResult) => void | Promise<void> }
  ): Promise<void> {
    if (items.length === 0) return;

    console.log(
      `[LocalMlxImage] 시작 items=${items.length} model=${options.modelSize} size=${options.width}x${options.height} steps=${options.steps}`
    );
    const startedAt = Date.now();

    const child = spawn(this.pythonBin, [this.scriptPath], {
      signal: options.signal,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write(
      JSON.stringify({
        items,
        modelSize: options.modelSize,
        width: options.width,
        height: options.height,
        steps: options.steps,
        quantize: options.quantize,
        outputDir: this.imagesOutputDir,
      })
    );
    child.stdin.end();

    let firstErrorMessage: string | null = null;
    let chain: Promise<void> = Promise.resolve();

    child.stderr.on("data", (chunk: Buffer) => {
      // Model-loading / framework log noise — useful for debugging, never parsed as progress.
      process.stderr.write(`[LocalMlxImage] ${chunk}`);
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      chain = chain.then(async () => {
        let parsed: GenerateLine;
        try {
          parsed = JSON.parse(line);
        } catch {
          console.error(`[LocalMlxImage] NDJSON 파싱 실패, 무시: ${line}`);
          return;
        }
        if (parsed.status === "error") {
          firstErrorMessage ??= parsed.message ?? `씬 ${parsed.sceneId} 이미지 생성 실패`;
          return;
        }
        if (!parsed.path) return;
        const image = await fs.readFile(parsed.path);
        await options.onScene?.({ sceneId: parsed.sceneId, image });
      });
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject); // spawn failure (e.g. interpreter missing)
      child.on("close", (code) => resolve(code));
    });

    await chain;
    console.log(`[LocalMlxImage] 종료 code=${exitCode} elapsedMs=${Date.now() - startedAt}`);

    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (exitCode !== 0) {
      throw new Error(firstErrorMessage ?? `로컬 이미지 생성 프로세스가 오류로 종료되었습니다 (code=${exitCode})`);
    }
  }
}

export function createLocalImageClient(imagesOutputDir: string): LocalImageClient {
  const pythonBin =
    process.env.LOCAL_IMAGE_PYTHON_BIN || path.join(process.cwd(), "python", "image", ".venv", "bin", "python");
  if (!existsSync(pythonBin)) {
    throw new Error(
      `로컬 이미지 생성 Python 환경을 찾을 수 없습니다 (${pythonBin}). python/image/setup.sh를 먼저 실행해주세요.`
    );
  }
  const scriptPath = path.join(process.cwd(), "python", "image", "generate.py");
  return new LocalMlxImageClient(pythonBin, scriptPath, imagesOutputDir);
}
