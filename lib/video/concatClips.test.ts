import { describe, expect, it } from "vitest";
import { buildTransitionFilter } from "./concatClips";

describe("buildTransitionFilter", () => {
  it("adds a video fade and audio crossfade for every page boundary", () => {
    const filter = buildTransitionFilter([10, 8, 12]);

    expect(filter).toContain("[0:v][1:v]xfade=transition=fade:duration=0.450:offset=9.550[v1]");
    expect(filter).toContain("[v1][2:v]xfade=transition=fade:duration=0.450:offset=17.100[v2]");
    expect(filter).toContain("[0:a][1:a]acrossfade=d=0.450:c1=tri:c2=tri[a1]");
    expect(filter).toContain("[a1][2:a]acrossfade=d=0.450:c1=tri:c2=tri[a2]");
  });

  it("shortens the transition for a very short page", () => {
    expect(buildTransitionFilter([0.4, 10])).toContain("duration=0.200:offset=0.200");
  });
});
