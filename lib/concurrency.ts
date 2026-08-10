/**
 * Runs `worker` over `items` with at most `limit` calls in flight at once.
 * On the first rejection, no further items are dispatched, but calls
 * already in flight are left to finish rather than aborted. Once every
 * worker has wound down, the first error is re-thrown.
 */
export async function runWithConcurrencyLimit<T>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  let firstError: unknown;
  let failed = false;

  async function runNext(): Promise<void> {
    while (!failed) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      try {
        await worker(items[index], index);
      } catch (err) {
        if (!failed) firstError = err;
        failed = true;
        return;
      }
    }
  }

  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => runNext()));

  if (failed) throw firstError;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new DOMException("Aborted", "AbortError"));
      },
      { once: true }
    );
  });
}

/**
 * Paces how often *new* work may start, independent of how many are already
 * in flight — the complement to runWithConcurrencyLimit's cap on simultaneous
 * work. Useful when an upstream service enforces a requests-per-time-window
 * limit rather than a limit on concurrent connections: several slow calls
 * started `intervalMs` apart can legitimately overlap, so throughput isn't
 * bottlenecked by each call's own duration.
 *
 * The returned `acquire()` resolves immediately for the first caller, then no
 * more than once every `intervalMs` after that, first-come-first-served
 * across however many concurrent callers are waiting.
 */
export function createRateGate(intervalMs: number) {
  let nextAt = 0;
  return async function acquire(signal?: AbortSignal): Promise<void> {
    const now = Date.now();
    const scheduledAt = Math.max(now, nextAt);
    nextAt = scheduledAt + intervalMs;
    const wait = scheduledAt - now;
    if (wait > 0) await sleep(wait, signal);
  };
}
