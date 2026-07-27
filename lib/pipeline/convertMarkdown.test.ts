import { describe, it, expect } from "vitest";
import { MockDeepSeekClient } from "../ai/deepseekClient.mock";
import { convertToMarkdown } from "./convertMarkdown";

describe("convertToMarkdown", () => {
  it("converts script-type text and returns the AI response", async () => {
    const client = new MockDeepSeekClient(["# 변환된 나레이션\n\n안녕하세요."]);

    const result = await convertToMarkdown(client, "원본 원고 텍스트", "script");

    expect(result).toBe("# 변환된 나레이션\n\n안녕하세요.");
    expect(client.calls[0].messages[1].content).toContain("나레이션체로 변환");
  });

  it("reformats narration-type text without content changes in the prompt", async () => {
    const client = new MockDeepSeekClient(["# 나레이션\n\n원문 그대로."]);

    const result = await convertToMarkdown(client, "원문 나레이션", "narration");

    expect(result).toBe("# 나레이션\n\n원문 그대로.");
    expect(client.calls[0].messages[1].content).toContain("내용은 절대 수정하지 말고");
  });
});
