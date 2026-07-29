import { describe, it, expect } from "vitest";
import { randomUUID } from "crypto";
import {
  startJob,
  getJob,
  finishJob,
  cancelJob,
  recordChunk,
  recordProgress,
  JobAlreadyRunningError,
  isPipelineJobStep,
} from "./registry";

function newProjectId(): string {
  return randomUUID();
}

describe("job registry", () => {
  it("starts a job and reports it as running", () => {
    const projectId = newProjectId();

    const job = startJob(projectId, "scenes");

    expect(job.status).toBe("running");
    expect(getJob(projectId, "scenes")?.status).toBe("running");
  });

  it("throws when starting a job that is already running for the same project+step", () => {
    const projectId = newProjectId();
    startJob(projectId, "scenes");

    expect(() => startJob(projectId, "scenes")).toThrow(JobAlreadyRunningError);
  });

  it("treats different steps for the same project as independent", () => {
    const projectId = newProjectId();
    startJob(projectId, "scenes");

    expect(() => startJob(projectId, "screen-design")).not.toThrow();
  });

  it("treats the same step for different projects as independent", () => {
    startJob(newProjectId(), "scenes");

    expect(() => startJob(newProjectId(), "scenes")).not.toThrow();
  });

  it("allows restarting a job once the previous run finished", () => {
    const projectId = newProjectId();
    startJob(projectId, "scenes");
    finishJob(projectId, "scenes", "done");

    expect(() => startJob(projectId, "scenes")).not.toThrow();
  });

  it("returns undefined for a job that was never started", () => {
    expect(getJob(newProjectId(), "scenes")).toBeUndefined();
  });

  it("cancelJob aborts the controller and returns true when running", () => {
    const projectId = newProjectId();
    const job = startJob(projectId, "scenes");

    const result = cancelJob(projectId, "scenes");

    expect(result).toBe(true);
    expect(job.controller.signal.aborted).toBe(true);
  });

  it("cancelJob returns false when nothing is running", () => {
    expect(cancelJob(newProjectId(), "scenes")).toBe(false);
  });

  it("cancelJob returns false for a job that already finished", () => {
    const projectId = newProjectId();
    startJob(projectId, "scenes");
    finishJob(projectId, "scenes", "done");

    expect(cancelJob(projectId, "scenes")).toBe(false);
  });

  it("recordChunk accumulates text on the job's partialRaw", () => {
    const projectId = newProjectId();
    startJob(projectId, "markdown");

    recordChunk(projectId, "markdown", "안녕");
    recordChunk(projectId, "markdown", "하세요");

    expect(getJob(projectId, "markdown")?.partialRaw).toBe("안녕하세요");
  });

  it("recordProgress updates the job's progress", () => {
    const projectId = newProjectId();
    startJob(projectId, "screen-design");

    recordProgress(projectId, "screen-design", 2, 5);

    expect(getJob(projectId, "screen-design")?.progress).toEqual({ index: 2, total: 5 });
  });

  it("isPipelineJobStep validates known steps only", () => {
    expect(isPipelineJobStep("scenes")).toBe(true);
    expect(isPipelineJobStep("storyboard")).toBe(false);
    expect(isPipelineJobStep("bogus")).toBe(false);
  });
});
