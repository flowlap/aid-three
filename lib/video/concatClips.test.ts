import { describe, expect, it } from "vitest";
import { buildTransitionFilter } from "./concatClips";

describe("buildTransitionFilter", () => {
  it("adds a video fade for every page boundary while keeping audio sequential", () => {
    const filter = buildTransitionFilter([10, 8, 12]);

    expect(filter).toContain("[0:v][1:v]xfade=transition=fade:duration=0.450:offset=9.550[v1]");
    expect(filter).toContain("[v1][2:v]xfade=transition=fade:duration=0.450:offset=17.100[v2]");
    expect(filter).toContain("[v2]tpad=stop_mode=clone:stop_duration=0.900[vout]");
    expect(filter).toContain("[0:a][1:a][2:a]concat=n=3:v=0:a=1[aout]");
  });

  it("shortens the transition for a very short page", () => {
    expect(buildTransitionFilter([0.4, 10])).toContain("duration=0.200:offset=0.200");
  });
});
