import { describe, it, expect } from "vitest";
import { buildSceneHierarchy, groupContentScenesByParentTitle } from "./sceneHierarchy";
import type { Scene } from "./splitScenes";

function scene(id: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    order: Number(id.replace("scene-", "")),
    narrationText: id,
    estimatedDurationSec: 5,
    splitReason: "-",
    sceneType: "content",
    ...overrides,
  };
}

function title(id: string, narrationText: string, depth: number): Scene {
  return scene(id, { narrationText, sceneType: "title", depth });
}

describe("buildSceneHierarchy", () => {
  it("gives top-level content scenes an empty breadcrumb and no parent", () => {
    const scenes = [scene("scene-001")];
    const hierarchy = buildSceneHierarchy(scenes);
    expect(hierarchy["scene-001"]).toEqual({ breadcrumb: [], parentTitleSceneId: undefined, indentDepth: 0 });
  });

  it("attaches content scenes to the nearest preceding title", () => {
    const scenes = [title("scene-001", "1장", 1), scene("scene-002")];
    const hierarchy = buildSceneHierarchy(scenes);
    expect(hierarchy["scene-002"].parentTitleSceneId).toBe("scene-001");
    expect(hierarchy["scene-002"].breadcrumb).toEqual(["1장"]);
    expect(hierarchy["scene-002"].indentDepth).toBe(1);
  });

  it("builds a multi-level breadcrumb through nested headings", () => {
    const scenes = [
      title("scene-001", "1장", 1),
      title("scene-002", "1.1절", 2),
      title("scene-003", "1.1.1소절", 3),
      scene("scene-004"),
    ];
    const hierarchy = buildSceneHierarchy(scenes);
    expect(hierarchy["scene-004"].breadcrumb).toEqual(["1장", "1.1절", "1.1.1소절"]);
    expect(hierarchy["scene-004"].parentTitleSceneId).toBe("scene-003");
    expect(hierarchy["scene-004"].indentDepth).toBe(3);
  });

  it("pops back to a shallower ancestor when a same-or-shallower heading appears", () => {
    const scenes = [
      title("scene-001", "1장", 1),
      title("scene-002", "1.1절", 2),
      scene("scene-003"),
      title("scene-004", "1.2절", 2),
      scene("scene-005"),
    ];
    const hierarchy = buildSceneHierarchy(scenes);
    expect(hierarchy["scene-003"].breadcrumb).toEqual(["1장", "1.1절"]);
    expect(hierarchy["scene-005"].breadcrumb).toEqual(["1장", "1.2절"]);
    expect(hierarchy["scene-004"].breadcrumb).toEqual(["1장"]);
    expect(hierarchy["scene-004"].parentTitleSceneId).toBe("scene-001");
  });

  it("handles a heading depth jump (e.g. # then ### with no ##) without crashing", () => {
    const scenes = [title("scene-001", "1장", 1), title("scene-002", "소절", 3), scene("scene-003")];
    const hierarchy = buildSceneHierarchy(scenes);
    expect(hierarchy["scene-003"].breadcrumb).toEqual(["1장", "소절"]);
  });
});

describe("groupContentScenesByParentTitle", () => {
  it("groups all top-level content scenes together when there are no headings", () => {
    const scenes = [scene("scene-001"), scene("scene-002")];
    const groups = groupContentScenesByParentTitle(scenes);
    expect(groups).toHaveLength(1);
    expect(groups[0].parentTitleSceneId).toBeNull();
    expect(groups[0].scenes.map((s) => s.id)).toEqual(["scene-001", "scene-002"]);
  });

  it("excludes title scenes from groups", () => {
    const scenes = [title("scene-001", "1장", 1), scene("scene-002"), scene("scene-003")];
    const groups = groupContentScenesByParentTitle(scenes);
    expect(groups).toHaveLength(1);
    expect(groups[0].parentTitleSceneId).toBe("scene-001");
    expect(groups[0].scenes.map((s) => s.id)).toEqual(["scene-002", "scene-003"]);
  });

  it("groups by the deepest ancestor title, matching the 1/2/4-title example shape", () => {
    const scenes = [
      title("scene-001", "1장", 1),
      title("scene-002", "1.1절", 2),
      title("scene-003", "1.1.1소절", 3),
      scene("scene-004"),
      scene("scene-005"),
      title("scene-006", "1.1.2소절", 3),
      scene("scene-007"),
      title("scene-008", "1.2절", 2),
      title("scene-009", "1.2.1소절", 3),
      scene("scene-010"),
    ];
    const groups = groupContentScenesByParentTitle(scenes);
    expect(groups.map((g) => g.parentTitleSceneId)).toEqual(["scene-003", "scene-006", "scene-009"]);
    expect(groups.map((g) => g.scenes.map((s) => s.id))).toEqual([
      ["scene-004", "scene-005"],
      ["scene-007"],
      ["scene-010"],
    ]);
  });

  it("starts a new group when content scenes are separated by an intervening title, even with the same parent", () => {
    const scenes = [title("scene-001", "1장", 1), scene("scene-002"), title("scene-003", "1장(재등장)", 1), scene("scene-004")];
    const groups = groupContentScenesByParentTitle(scenes);
    expect(groups).toHaveLength(2);
  });
});
