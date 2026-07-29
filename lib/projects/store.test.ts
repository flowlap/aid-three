import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import os from "os";
import {
  createProject,
  listProjects,
  readProject,
  updateProjectStep,
  deleteProject,
  writeProjectFile,
  readProjectFile,
  mergeProjectJsonMap,
} from "./store";

let tempRoot: string;

beforeEach(async () => {
  tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "projects-store-"));
  process.env.PROJECTS_DATA_DIR = tempRoot;
});

afterEach(async () => {
  delete process.env.PROJECTS_DATA_DIR;
  await fs.rm(tempRoot, { recursive: true, force: true });
});

describe("project store", () => {
  it("creates a project with upload as the initial step", async () => {
    const project = await createProject("샘플 원고", "script");

    expect(project.title).toBe("샘플 원고");
    expect(project.scriptType).toBe("script");
    expect(project.currentStep).toBe("upload");
    expect(project.id).toBeTruthy();
  });

  it("lists created projects newest first", async () => {
    const first = await createProject("첫번째", "script");
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await createProject("두번째", "narration");

    const projects = await listProjects();

    expect(projects.map((p) => p.id)).toEqual([second.id, first.id]);
  });

  it("reads back a created project", async () => {
    const project = await createProject("조회 테스트", "script");

    const found = await readProject(project.id);

    expect(found).toEqual(project);
  });

  it("returns null for a missing project", async () => {
    const found = await readProject("does-not-exist");
    expect(found).toBeNull();
  });

  it("updates the current step", async () => {
    const project = await createProject("단계 업데이트", "script");

    await updateProjectStep(project.id, "scenes");
    const updated = await readProject(project.id);

    expect(updated?.currentStep).toBe("scenes");
  });

  it("writes and reads a project file", async () => {
    const project = await createProject("파일 테스트", "script");

    await writeProjectFile(project.id, "narration.md", "# 제목\n내용");
    const content = await readProjectFile(project.id, "narration.md");

    expect(content).toBe("# 제목\n내용");
  });

  it("returns null when reading a missing project file", async () => {
    const project = await createProject("빈 파일", "script");
    const content = await readProjectFile(project.id, "scenes.json");
    expect(content).toBeNull();
  });

  it("deletes a project folder", async () => {
    const project = await createProject("삭제 테스트", "script");

    await deleteProject(project.id);
    const found = await readProject(project.id);

    expect(found).toBeNull();
  });

  it("rejects path-traversal attempts in project id", async () => {
    const found = await readProject("../../../../etc/passwd");
    expect(found).toBeNull();
  });

  it("rejects path-traversal attempts in filename", async () => {
    const project = await createProject("경로 검증", "script");
    await expect(writeProjectFile(project.id, "../../evil.txt", "bad")).rejects.toThrow();
  });
});

describe("mergeProjectJsonMap", () => {
  it("creates the file with the merged entry when it doesn't exist yet", async () => {
    const project = await createProject("병합 생성", "script");

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({ screenTypes: { "scene-001": { screenType: "A" } } });
  });

  it("preserves sibling entries already in the map", async () => {
    const project = await createProject("병합 보존", "script");
    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-002", { screenType: "B" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({
      screenTypes: { "scene-001": { screenType: "A" }, "scene-002": { screenType: "B" } },
    });
  });

  it("overwrites the same entry key in place", async () => {
    const project = await createProject("병합 갱신", "script");
    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "C" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({ screenTypes: { "scene-001": { screenType: "C" } } });
  });

  it("preserves other top-level keys already in the file", async () => {
    const project = await createProject("최상위 보존", "script");
    await writeProjectFile(project.id, "screen-types.json", JSON.stringify({ note: "keep me" }));

    await mergeProjectJsonMap(project.id, "screen-types.json", "screenTypes", "scene-001", { screenType: "A" });
    const content = await readProjectFile(project.id, "screen-types.json");

    expect(JSON.parse(content!)).toEqual({ note: "keep me", screenTypes: { "scene-001": { screenType: "A" } } });
  });

  it("rejects path-traversal attempts in filename", async () => {
    const project = await createProject("병합 경로 검증", "script");
    await expect(
      mergeProjectJsonMap(project.id, "../../evil.json", "screenTypes", "scene-001", {})
    ).rejects.toThrow();
  });
});
