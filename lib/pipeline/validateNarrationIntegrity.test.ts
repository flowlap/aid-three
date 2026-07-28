import { describe, it, expect } from "vitest";
import { validateNarrationIntegrity } from "./validateNarrationIntegrity";

describe("validateNarrationIntegrity", () => {
  it("returns true when scene texts reconstruct the original exactly", () => {
    const original = "안녕하세요. 오늘은 이러닝을 배웁니다.";
    const scenes = ["안녕하세요.", " 오늘은 이러닝을 배웁니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(true);
  });

  it("ignores whitespace-only differences", () => {
    const original = "안녕하세요.\n오늘은 이러닝을 배웁니다.";
    const scenes = ["안녕하세요.", "오늘은 이러닝을 배웁니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(true);
  });

  it("returns false when scene text changes the wording", () => {
    const original = "안녕하세요. 오늘은 이러닝을 배웁니다.";
    const scenes = ["안녕하십니까.", " 오늘은 이러닝을 배웁니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(false);
  });

  it("returns false when a scene is missing content", () => {
    const original = "첫 문장. 둘째 문장. 셋째 문장.";
    const scenes = ["첫 문장.", " 둘째 문장."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(false);
  });

  it("ignores markdown heading and bullet syntax when the wording matches", () => {
    const original = "# 도입부\n\n오늘은 이러닝을 배웁니다.\n\n- 첫째 항목\n- 둘째 항목";
    const scenes = ["도입부", "오늘은 이러닝을 배웁니다.", "첫째 항목", "둘째 항목"];

    expect(validateNarrationIntegrity(original, scenes)).toBe(true);
  });

  it("ignores emphasis markers (bold/italic/code) when the wording matches", () => {
    const original = "이것은 **중요한** 개념이며 `핵심 용어`입니다. 그리고 _강조_ 표현도 있습니다.";
    const scenes = ["이것은 중요한 개념이며 핵심 용어입니다.", "그리고 강조 표현도 있습니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(true);
  });

  it("still returns false when wording genuinely changed, even after markdown stripping", () => {
    const original = "# 도입부\n\n오늘은 이러닝을 배웁니다.";
    const scenes = ["도입부", "오늘은 이러닝을 학습합니다."];

    expect(validateNarrationIntegrity(original, scenes)).toBe(false);
  });
});
