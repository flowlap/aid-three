// Guards against a second concurrent call for the same key (e.g. an
// impatient double-click while the local image engine is still
// downloading/loading its model — that would otherwise spawn a second
// multi-GB download into the same HF cache dir instead of just... doing
// nothing). Stashed on globalThis so it survives Turbopack/Next.js
// re-evaluating this module's scope on unrelated file edits during dev
// (same pattern as lib/jobs/registry.ts's job map).
const g = globalThis as unknown as { __inFlightLocks?: Set<string> };
const locks: Set<string> = g.__inFlightLocks ?? (g.__inFlightLocks = new Set());

export class AlreadyInFlightError extends Error {
  constructor(key: string) {
    super(`이미 처리 중입니다: ${key}`);
    this.name = "AlreadyInFlightError";
  }
}

/** Runs `fn` under an exclusive lock for `key`, throwing AlreadyInFlightError instead of running `fn` if `key` is already locked. */
export async function withInFlightLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (locks.has(key)) throw new AlreadyInFlightError(key);
  locks.add(key);
  try {
    return await fn();
  } finally {
    locks.delete(key);
  }
}

/**
 * Like withInFlightLock, but retries instead of failing immediately when
 * `key` is already held — for short critical sections (e.g. a JSON
 * read-modify-write) where several callers may legitimately finish their own
 * slow work around the same time and each still needs its turn, rather than
 * losing already-completed work to a rejection (see the sequence
 * master-image route's write step, which serializes against both concurrent
 * master-image writes and the sequence-plan PUT route via the same key).
 */
export async function withInFlightLockRetrying<T>(
  key: string,
  fn: () => Promise<T>,
  { retries = 20, delayMs = 150 }: { retries?: number; delayMs?: number } = {}
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withInFlightLock(key, fn);
    } catch (err) {
      if (!(err instanceof AlreadyInFlightError) || attempt >= retries) throw err;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
