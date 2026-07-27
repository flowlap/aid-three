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
});
