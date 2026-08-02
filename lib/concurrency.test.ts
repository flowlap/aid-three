import { describe, it, expect } from "vitest";
import { runWithConcurrencyLimit } from "./concurrency";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("runWithConcurrencyLimit", () => {
  it("processes every item exactly once", async () => {
    const items = [1, 2, 3, 4, 5];
    const seen: number[] = [];
    await runWithConcurrencyLimit(items, 2, async (item) => {
      await delay(1);
      seen.push(item);
    });
    expect(seen.slice().sort((a, b) => a - b)).toEqual(items);
  });

  it("never runs more than `limit` workers at once", async () => {
    const items = Array.from({ length: 10 }, (_, i) => i);
    let active = 0;
    let maxActive = 0;
    await runWithConcurrencyLimit(items, 3, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await delay(5);
      active -= 1;
    });
    expect(maxActive).toBeLessThanOrEqual(3);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("rejects with the first error a worker throws", async () => {
    const items = [1, 2, 3, 4];
    await expect(
      runWithConcurrencyLimit(items, 2, async (item) => {
        if (item === 2) throw new Error("boom");
        await delay(1);
      })
    ).rejects.toThrow("boom");
  });

  it("lets in-flight work finish instead of aborting it after a failure", async () => {
    const items = [1, 2, 3, 4];
    const completed: number[] = [];
    await expect(
      runWithConcurrencyLimit(items, 2, async (item) => {
        if (item === 1) throw new Error("boom");
        await delay(5);
        completed.push(item);
      })
    ).rejects.toThrow("boom");
    // item 2 started concurrently alongside the failing item 1 and should
    // still have been allowed to finish.
    expect(completed).toContain(2);
  });
});
