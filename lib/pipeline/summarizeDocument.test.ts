import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { summarizeDocument } from "./summarizeDocument";

describe("summarizeDocument", () => {
  it("returns the AI's summary text", async () => {
    const client = new MockDeepSeekClient(["이 문서는 탄소배출권 제도와 친환경차 정책을 다루는 교육 자료입니다."]);

    const summary = await summarizeDocument(client, "# 탄소시장\n배출권 ETF에 대한 나레이션...");

    expect(summary).toBe("이 문서는 탄소배출권 제도와 친환경차 정책을 다루는 교육 자료입니다.");
  });

  it("includes the full narration markdown in the prompt", async () => {
    const client = new MockDeepSeekClient(["요약"]);

    await summarizeDocument(client, "전체 원고 본문 내용입니다");

    expect(client.calls[0].messages[1].content).toContain("전체 원고 본문 내용입니다");
  });

  it("requests the flash model", async () => {
    const client = new MockDeepSeekClient(["요약"]);

    await summarizeDocument(client, "본문");

    expect(client.calls[0].options?.model).toBe("deepseek-v4-flash");
  });

  it("forwards the abort signal", async () => {
    const client = new MockDeepSeekClient(["요약"]);
    const controller = new AbortController();
    controller.abort();

    await expect(summarizeDocument(client, "본문", controller.signal)).rejects.toThrow();
  });
});
