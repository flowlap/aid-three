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
});
