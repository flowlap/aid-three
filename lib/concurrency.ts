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
