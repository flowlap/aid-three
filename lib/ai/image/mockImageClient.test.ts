import { describe, it, expect } from "vitest";
import { MockImageClient } from "./mockImageClient";

describe("MockImageClient", () => {
  it("returns a non-empty image buffer and records the call", async () => {
    const client = new MockImageClient();

    const buffer = await client.generateImage("a prompt");

    expect(buffer.length).toBeGreaterThan(0);
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].prompt).toBe("a prompt");
  });

  it("returns a custom buffer when one is provided", async () => {
    const custom = Buffer.from([1, 2, 3]);
    const client = new MockImageClient(custom);

    const buffer = await client.generateImage("a prompt");

    expect(buffer).toBe(custom);
  });

  it("rejects when the signal is already aborted", async () => {
    const client = new MockImageClient();
    const controller = new AbortController();
    controller.abort();

    await expect(client.generateImage("a prompt", { signal: controller.signal })).rejects.toThrow();
  });

  it("records referenceImages passed in options", async () => {
    const client = new MockImageClient();
    const bg = Buffer.from("bg");

    await client.generateImage("a prompt", { referenceImages: [bg] });

    expect(client.calls[0].options?.referenceImages).toEqual([bg]);
  });
});
