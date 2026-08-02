import { describe, it, expect } from "vitest";
import { splitScenesByBlankLines, trimLines } from "./splitScenesByBlankLines";

describe("splitScenesByBlankLines", () => {
  it("splits on a single blank line", () => {
    const text = "첫 번째 문단입니다.\n\n두 번째 문단입니다.";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes.map((s) => s.narrationText)).toEqual(["첫 번째 문단입니다.", "두 번째 문단입니다."]);
  });

  it("does not split within a paragraph that has no blank line", () => {
    const text = "한 문장.\n여전히 같은 문단.";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes).toHaveLength(1);
    expect(scenes[0].narrationText).toBe("한 문장. 여전히 같은 문단.");
  });

  it("trims leading/trailing whitespace on each line before joining", () => {
    const text = "  앞뒤 공백이 있는 줄  \n   다음 줄도 마찬가지   ";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes[0].narrationText).toBe("앞뒤 공백이 있는 줄 다음 줄도 마찬가지");
  });

  it("assigns sequential ids and order starting at 1", () => {
    const text = "A\n\n\nB\n\n\nC";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes.map((s) => s.id)).toEqual(["scene-001", "scene-002", "scene-003"]);
    expect(scenes.map((s) => s.order)).toEqual([1, 2, 3]);
  });

  it("ignores extra blank lines beyond the run and doesn't produce empty scenes", () => {
    const text = "A\n\n\n\n\n\nB";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes.map((s) => s.narrationText)).toEqual(["A", "B"]);
  });

  it("estimates a positive, non-trivial duration proportional to text length", () => {
    const scenes = splitScenesByBlankLines("가".repeat(45));
    expect(scenes[0].estimatedDurationSec).toBeGreaterThanOrEqual(10);
  });

  it("defaults chunks without a heading to content type", () => {
    const scenes = splitScenesByBlankLines("본문 문장입니다.");
    expect(scenes[0].sceneType).toBe("content");
    expect(scenes[0].depth).toBeUndefined();
  });

  it("splits a heading line into its own title scene", () => {
    const text = "# 1장 소개\n\n본문 문단입니다.";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes.map((s) => ({ sceneType: s.sceneType, narrationText: s.narrationText, depth: s.depth }))).toEqual([
      { sceneType: "title", narrationText: "1장 소개", depth: 1 },
      { sceneType: "content", narrationText: "본문 문단입니다.", depth: undefined },
    ]);
  });

  it("splits a heading immediately followed by content with no blank line", () => {
    const text = "## 1.2 절 제목\n같은 문단 첫 줄.\n같은 문단 둘째 줄.";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes).toHaveLength(2);
    expect(scenes[0]).toMatchObject({ sceneType: "title", narrationText: "1.2 절 제목", depth: 2 });
    expect(scenes[1]).toMatchObject({ sceneType: "content", narrationText: "같은 문단 첫 줄. 같은 문단 둘째 줄." });
  });

  it("supports multiple heading depths in sequence", () => {
    const text = "# 장 제목\n\n## 절 제목\n\n### 소절 제목\n\n본문.";
    const scenes = splitScenesByBlankLines(text);
    expect(scenes.map((s) => s.depth)).toEqual([1, 2, 3, undefined]);
    expect(scenes.map((s) => s.sceneType)).toEqual(["title", "title", "title", "content"]);
  });
});

describe("trimLines", () => {
  it("trims each line but preserves line breaks and blank lines", () => {
    const text = "  줄 1  \n\n   줄 2   ";
    expect(trimLines(text)).toBe("줄 1\n\n줄 2");
  });
});
