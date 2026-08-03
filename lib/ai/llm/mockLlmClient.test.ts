import { describe, it, expect } from "vitest";
import { MockLlmClient } from "./mockLlmClient";

describe("MockLlmClient", () => {
  it("returns queued responses in order", async () => {
    const client = new MockLlmClient(["첫 응답", "두번째 응답"]);

    const first = await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(first).toBe("첫 응답");
    expect(second).toBe("두번째 응답");
  });

  it("repeats the last response once queue is exhausted", async () => {
    const client = new MockLlmClient(["유일한 응답"]);

    await client.complete([{ role: "user", content: "a" }]);
    const second = await client.complete([{ role: "user", content: "b" }]);

    expect(second).toBe("유일한 응답");
  });

  it("records call messages and options for assertions", async () => {
    const client = new MockLlmClient(["응답"]);

    await client.complete([{ role: "user", content: "질문" }], { jsonMode: true, tier: "fast" });

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].messages[0].content).toBe("질문");
    expect(client.calls[0].options?.jsonMode).toBe(true);
    expect(client.calls[0].options?.tier).toBe("fast");
  });

  it("rejects complete() when the signal is already aborted", async () => {
    const client = new MockLlmClient(["응답"]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.complete([{ role: "user", content: "a" }], { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("rejects completeStream() when the signal is already aborted", async () => {
    const client = new MockLlmClient(["응답"]);
    const controller = new AbortController();
    controller.abort();

    await expect(
      client.completeStream([{ role: "user", content: "a" }], { signal: controller.signal })
    ).rejects.toThrow();
  });

  it("yields the queued response in chunks via completeStream", async () => {
    const client = new MockLlmClient(["안녕하세요"]);

    const iterable = await client.completeStream([{ role: "user", content: "a" }]);
    const chunks: string[] = [];
    for await (const chunk of iterable) chunks.push(chunk);

    expect(chunks.join("")).toBe("안녕하세요");
  });
});
