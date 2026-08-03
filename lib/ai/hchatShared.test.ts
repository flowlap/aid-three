import { describe, it, expect, afterEach, vi } from "vitest";
import { getHChatBaseUrl, getHChatHeaders } from "./hchatShared";

describe("getHChatBaseUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns the default internal gateway URL when HCHAT_BASE_URL is unset", () => {
    expect(getHChatBaseUrl()).toBe("https://internal-apigw-kr.hmg-corp.io/hchat-in/api/v3");
  });

  it("returns the override URL when HCHAT_BASE_URL is set", () => {
    vi.stubEnv("HCHAT_BASE_URL", "https://example.test/hchat");
    expect(getHChatBaseUrl()).toBe("https://example.test/hchat");
  });
});

describe("getHChatHeaders", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("throws when HCHAT_KEY is not set", () => {
    expect(() => getHChatHeaders()).toThrow(/HCHAT_KEY/);
  });

  it("returns the Authorization header set to the raw key (no Bearer prefix)", () => {
    vi.stubEnv("HCHAT_KEY", "test-hchat-key");
    expect(getHChatHeaders()).toEqual({
      "Content-Type": "application/json",
      Authorization: "test-hchat-key",
    });
  });
});
