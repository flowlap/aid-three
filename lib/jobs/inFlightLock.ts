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
