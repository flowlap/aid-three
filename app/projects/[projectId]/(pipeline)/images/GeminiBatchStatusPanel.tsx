"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BatchJobLike {
  batchId: string;
  googleBatchName: string;
  model: string;
  submittedAt: string;
  status: "submitted" | "succeeded" | "failed" | "applied";
  /** Scene ids (kind="scene") or sequence ids (kind="master") — only one is ever present, depending on which API route produced this record. */
  sceneIds?: string[];
  sequenceIds?: string[];
  sceneErrors?: Record<string, string>;
  errorMessage?: string;
  appliedAt?: string;
}

/** Gemini's real batch API is async by design (minutes to up to 24h) — no point polling faster than this. */
const POLL_INTERVAL_MS = 30_000;

const STATUS_LABEL: Record<BatchJobLike["status"], string> = {
  submitted: "제출됨 — Google에서 처리 중(수 분~최대 24시간 소요될 수 있습니다)",
  succeeded: "완료 — 결과 반영 중",
  applied: "완료",
  failed: "실패",
};

/**
 * Owns both the "배치로 생성" submit action(s) and the resulting job's status
 * display/polling — a real Google Batch API job (see lib/ai/image/geminiBatch.ts)
 * is asynchronous, so unlike the regular real-time generation flow this
 * submits once and returns immediately; the panel then polls a REST status
 * endpoint on an interval and survives a page reload by re-discovering the
 * most recent job on mount.
 *
 * Generalized to serve both the scene-image batch (kind="scene") and the
 * sequence master-visual batch (kind="master") — the two API route pairs
 * mirror each other exactly (see images/batch/ and
 * sequences/master-image/batch/), so this component only needs `kind` to
 * pick which URL prefix to call. All "what does resume/full mean, what
 * should the button say" logic stays in the caller (ImagesEditor.tsx /
 * SequenceMasterVisualsSection.tsx), which already computes the identical
 * three-way label for its own immediate-generation button — this panel just
 * reuses whatever the caller decides.
 */
export function GeminiBatchStatusPanel({
  projectId,
  kind,
  primaryMode,
  primaryCount,
  primaryLabel,
  showFullSecondary,
  fullCount,
  disabled,
  onApplied,
}: {
  projectId: string;
  /** Picks the API route prefix: /images/batch (scene) or /sequences/master-image/batch (master). */
  kind: "scene" | "master";
  /** Mode the primary button submits. */
  primaryMode: "resume" | "full";
  /** Target-item count for primaryMode — primary button is disabled below 2. */
  primaryCount: number;
  /** Primary button text, e.g. "이어서 생성 (12개)" / "전체 다시 생성" / "AI로 이미지 생성" — caller computes this to match its own immediate-generation button's label 1:1. */
  primaryLabel: string;
  /** Whether to also show a "배치로 전체 다시 생성" secondary button (always mode="full") — mirrors the immediate row's own secondary button visibility. */
  showFullSecondary: boolean;
  /** Target-item count for the secondary full-regenerate button. */
  fullCount: number;
  /** True while the regular real-time generation job is running — mutually exclusive with a batch submission. */
  disabled?: boolean;
  /** Called once, right when a job transitions into "applied", with the item ids that were actually written (excludes any per-item errors). */
  onApplied?: (ids: string[]) => void;
}) {
  const basePath = kind === "scene" ? `/api/projects/${projectId}/images/batch` : `/api/projects/${projectId}/sequences/master-image/batch`;

  const [job, setJob] = useState<BatchJobLike | null>(null);
  const [submittingMode, setSubmittingMode] = useState<"resume" | "full" | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const appliedNotifiedRef = useRef<string | null>(null);

  const checkJob = useCallback(
    async (batchId: string) => {
      setChecking(true);
      try {
        const res = await fetch(`${basePath}/${batchId}`);
        const data = await res.json();
        if (!res.ok) {
          setError(data.error ?? "배치 상태 확인에 실패했습니다");
          return;
        }
        const nextJob: BatchJobLike = data.job;
        setJob(nextJob);
        if (nextJob.status === "applied" && appliedNotifiedRef.current !== nextJob.batchId) {
          appliedNotifiedRef.current = nextJob.batchId;
          const itemIds = nextJob.sceneIds ?? nextJob.sequenceIds ?? [];
          const failedIds = new Set(Object.keys(nextJob.sceneErrors ?? {}));
          onApplied?.(itemIds.filter((id) => !failedIds.has(id)));
        }
      } catch {
        setError("배치 상태 확인 중 오류가 발생했습니다");
      } finally {
        setChecking(false);
      }
    },
    [basePath, onApplied]
  );

  // Resume showing the most recent batch job on mount, so a submitted job
  // survives a page reload — the whole point of a real async job.
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(basePath);
        const data = await res.json();
        const jobs: BatchJobLike[] = data.jobs ?? [];
        if (jobs[0]) setJob(jobs[0]);
      } catch {
        // No jobs yet, or request failed — panel just starts empty (submit button still works).
      }
    })();
  }, [basePath]);

  useEffect(() => {
    if (!job || job.status !== "submitted") return;
    const interval = setInterval(() => void checkJob(job.batchId), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [job, checkJob]);

  async function handleSubmit(mode: "resume" | "full") {
    setError(null);
    setSubmittingMode(mode);
    try {
      const res = await fetch(basePath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "배치 제출에 실패했습니다");
        return;
      }
      setDismissed(false);
      setJob({
        batchId: data.batchId,
        googleBatchName: "",
        model: "",
        submittedAt: new Date().toISOString(),
        status: "submitted",
      });
    } catch {
      setError("배치 제출 중 오류가 발생했습니다");
    } finally {
      setSubmittingMode(null);
    }
  }

  const jobRunning = Boolean(job && job.status === "submitted");
  const canSubmitPrimary = !disabled && !submittingMode && primaryCount >= 2 && !jobRunning;
  const canSubmitFull = !disabled && !submittingMode && fullCount >= 2 && !jobRunning;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={() => void handleSubmit(primaryMode)}
          disabled={!canSubmitPrimary}
          title="2개 이상의 항목이 있을 때만 제출할 수 있습니다"
        >
          {submittingMode === primaryMode ? "제출 중..." : `배치로 ${primaryLabel}`}
        </Button>
        {showFullSecondary && (
          <Button
            variant="outline"
            onClick={() => void handleSubmit("full")}
            disabled={!canSubmitFull}
            title="2개 이상의 항목이 있을 때만 제출할 수 있습니다"
          >
            {submittingMode === "full" ? "제출 중..." : "배치로 전체 다시 생성"}
          </Button>
        )}
        {job && !dismissed && (
          <span className="text-xs text-muted-foreground">
            {job.status === "submitted" && <Loader2 className="mr-1 inline size-3 animate-spin" />}
            {STATUS_LABEL[job.status]}
            {job.status === "applied" &&
              (() => {
                const itemIds = job.sceneIds ?? job.sequenceIds ?? [];
                return ` (${itemIds.length - Object.keys(job.sceneErrors ?? {}).length}/${itemIds.length}개 반영됨)`;
              })()}
          </span>
        )}
        {job && job.status === "submitted" && !dismissed && (
          <Button variant="ghost" size="sm" onClick={() => void checkJob(job.batchId)} disabled={checking}>
            {checking ? "확인 중..." : "지금 확인"}
          </Button>
        )}
        {job && job.status !== "submitted" && !dismissed && (
          <Button variant="ghost" size="sm" onClick={() => setDismissed(true)}>
            닫기
          </Button>
        )}
      </div>
      {job?.status === "failed" && !dismissed && (
        <p className="text-xs text-destructive">{job.errorMessage ?? "배치 작업이 실패했습니다"}</p>
      )}
      {job?.status === "applied" && job.sceneErrors && Object.keys(job.sceneErrors).length > 0 && !dismissed && (
        <p className="text-xs text-warning">
          일부 항목 실패: {Object.entries(job.sceneErrors).map(([id, msg]) => `${id}(${msg})`).join(", ")}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
