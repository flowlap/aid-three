import { spawn } from "child_process";
import { promises as fs, existsSync } from "fs";
import path from "path";
import readline from "readline";

export interface TtsOptions {
  voice?: string;
  langCode?: string;
  signal?: AbortSignal;
}

export interface TtsBatchItem {
  sceneId: string;
  text: string;
}

export interface TtsSceneResult {
  sceneId: string;
  /** WAV bytes. */
  audio: Buffer;
}

export interface TtsClient {
  /**
   * Synthesizes every item in one run. Batched (rather than one call per
   * scene) because the underlying model is expensive to load — see
   * docs/reference/local-tts.md. `onScene` fires as each scene finishes so
   * callers can stream progress the same way the images step does.
   */
  synthesizeBatch(
    items: TtsBatchItem[],
    options: TtsOptions & { onScene?: (result: TtsSceneResult) => void | Promise<void> }
  ): Promise<void>;
}

interface GenerateLine {
  sceneId: string;
  status: "done" | "error";
  path?: string;
  message?: string;
}

/**
 * Spawns python/tts/generate.py once per batch (not once per scene — the
 * 1.7B model is expensive to load, so this Python process loads it once and
 * synthesizes every pending scene before exiting). Progress is relayed via
 * one NDJSON line per finished scene on the child's stdout.
 */
export class LocalMlxTtsClient implements TtsClient {
  constructor(
    private readonly pythonBin: string,
    private readonly scriptPath: string,
    private readonly audioOutputDir: string
  ) {}

  async synthesizeBatch(
    items: TtsBatchItem[],
    options: TtsOptions & { onScene?: (result: TtsSceneResult) => void | Promise<void> }
  ): Promise<void> {
    if (items.length === 0) return;

    console.log(`[LocalMlxTts] 시작 items=${items.length} voice=${options.voice ?? "-"}`);
    const startedAt = Date.now();

    const child = spawn(this.pythonBin, [this.scriptPath], {
      signal: options.signal,
      stdio: ["pipe", "pipe", "pipe"],
    });

    child.stdin.write(
      JSON.stringify({
        items,
        voice: options.voice,
        langCode: options.langCode,
        outputDir: this.audioOutputDir,
      })
    );
    child.stdin.end();

    let firstErrorMessage: string | null = null;
    let chain: Promise<void> = Promise.resolve();

    child.stderr.on("data", (chunk: Buffer) => {
      // Model-loading / framework log noise — useful for debugging, never parsed as progress.
      process.stderr.write(`[LocalMlxTts] ${chunk}`);
    });

    const rl = readline.createInterface({ input: child.stdout });
    rl.on("line", (line) => {
      if (!line.trim()) return;
      chain = chain.then(async () => {
        let parsed: GenerateLine;
        try {
          parsed = JSON.parse(line);
        } catch {
          console.error(`[LocalMlxTts] NDJSON 파싱 실패, 무시: ${line}`);
          return;
        }
        if (parsed.status === "error") {
          firstErrorMessage ??= parsed.message ?? `씬 ${parsed.sceneId} 음성 생성 실패`;
          return;
        }
        if (!parsed.path) return;
        const audio = await fs.readFile(parsed.path);
        await options.onScene?.({ sceneId: parsed.sceneId, audio });
      });
    });

    const exitCode = await new Promise<number | null>((resolve, reject) => {
      child.on("error", reject); // spawn failure (e.g. interpreter missing)
      child.on("close", (code) => resolve(code));
    });

    await chain;
    console.log(`[LocalMlxTts] 종료 code=${exitCode} elapsedMs=${Date.now() - startedAt}`);

    if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    if (exitCode !== 0) {
      throw new Error(firstErrorMessage ?? `로컬 TTS 프로세스가 오류로 종료되었습니다 (code=${exitCode})`);
    }
  }
}

export function createLocalTtsClient(audioOutputDir: string): TtsClient {
  const pythonBin = process.env.TTS_PYTHON_BIN || path.join(process.cwd(), "python", "tts", ".venv", "bin", "python");
  if (!existsSync(pythonBin)) {
    throw new Error(
      `로컬 TTS Python 환경을 찾을 수 없습니다 (${pythonBin}). python/tts/setup.sh를 먼저 실행해주세요.`
    );
  }
  const scriptPath = path.join(process.cwd(), "python", "tts", "generate.py");
  return new LocalMlxTtsClient(pythonBin, scriptPath, audioOutputDir);
}
