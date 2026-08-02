import type { Scene } from "./splitScenes";

export interface SceneHierarchyEntry {
  /** Ancestor title texts, root-first, not including the scene itself. */
  breadcrumb: string[];
  /** Nearest (deepest) ancestor title scene id, if any. */
  parentTitleSceneId?: string;
  /** 0-based nesting level for UI indentation, derived from actual document nesting (not raw heading depth). */
  indentDepth: number;
}

export type SceneHierarchyMap = Record<string, SceneHierarchyEntry>;

/**
 * Derives breadcrumb/indentation/parent-title info for every scene from
 * document order + heading depth. Always recomputed from the current scene
 * list — never persisted — so it stays correct after split/merge/reorder.
 */
export function buildSceneHierarchy(scenes: Scene[]): SceneHierarchyMap {
  const map: SceneHierarchyMap = {};
  const stack: { id: string; narrationText: string; depth: number }[] = [];

  for (const scene of scenes) {
    while (stack.length > 0 && scene.sceneType === "title" && stack[stack.length - 1].depth >= (scene.depth ?? 1)) {
      stack.pop();
    }

    const breadcrumb = stack.map((entry) => entry.narrationText);
    const parentTitleSceneId = stack.length > 0 ? stack[stack.length - 1].id : undefined;
    const indentDepth = stack.length;

    map[scene.id] = { breadcrumb, parentTitleSceneId, indentDepth };

    if (scene.sceneType === "title") {
      stack.push({ id: scene.id, narrationText: scene.narrationText, depth: scene.depth ?? 1 });
    }
  }

  return map;
}

export interface ContentSceneGroup {
  /** Nearest ancestor title scene id shared by all scenes in this group, or null if there is no ancestor title. */
  parentTitleSceneId: string | null;
  scenes: Scene[];
}

/**
 * Groups consecutive content scenes by their nearest (deepest) ancestor
 * title scene, for batching screen-design AI calls one request per group
 * instead of one per scene. Title scenes are excluded (screen design skips
 * them entirely and designs them locally).
 */
export function groupContentScenesByParentTitle(scenes: Scene[]): ContentSceneGroup[] {
  const hierarchy = buildSceneHierarchy(scenes);
  const groups: ContentSceneGroup[] = [];

  for (const scene of scenes) {
    if (scene.sceneType === "title") continue;

    const parentTitleSceneId = hierarchy[scene.id]?.parentTitleSceneId ?? null;
    const last = groups[groups.length - 1];
    if (last && last.parentTitleSceneId === parentTitleSceneId) {
      last.scenes.push(scene);
    } else {
      groups.push({ parentTitleSceneId, scenes: [scene] });
    }
  }

  return groups;
}
