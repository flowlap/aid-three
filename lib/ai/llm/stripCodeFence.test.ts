import { describe, it, expect } from "vitest";
import { stripCodeFence } from "./stripCodeFence";

describe("stripCodeFence", () => {
  it("passes through a response that isn't fenced", () => {
    const raw = '{"scenes":[]}';
    expect(stripCodeFence(raw)).toBe(raw);
  });

  it("strips a ```json fence", () => {
    const raw = '```json\n{"scenes":[]}\n```';
    expect(stripCodeFence(raw)).toBe('{"scenes":[]}');
  });

  it("strips a fence with no language tag", () => {
    const raw = '```\n{"scenes":[]}\n```';
    expect(stripCodeFence(raw)).toBe('{"scenes":[]}');
  });

  it("does not corrupt a non-fenced response that legitimately contains triple backticks", () => {
    const raw = '{"text":"예시 코드는 ```print(1)``` 입니다."}';
    expect(stripCodeFence(raw)).toBe(raw);
  });

  it("trims surrounding whitespace even when not fenced", () => {
    expect(stripCodeFence('  \n{"scenes":[]}\n  ')).toBe('{"scenes":[]}');
  });
});
