"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { readNdjsonStream } from "./ndjson";
import type { PipelineJobStep } from "@/lib/jobs/registry";

export interface JobStatusResponse {
  running: boolean;
  status?: "running" | "done" | "error" | "cancelled";
  startedAt?: string;
  progress?: { index: number; total: number } | null;
  partialRaw?: string;
  error?: string;
  partialData?: unknown;
}

interface StreamEventShape {
  type: string;
  index?: number;
  total?: number;
  message?: string;
}

export interface UseAiJobOptions<TEvent> {
  projectId: string;
  step: PipelineJobStep;
  /** This tab's own stream — forwarded verbatim for the component to update its data state. */
  onEvent: (event: TEvent) => void;
  /** Hydrate from a job that was started elsewhere (another tab, or before this one loaded). */
  onPollUpdate?: (status: JobStatusResponse) => void;
  /** Called once the job settles, whether via this tab's own stream or via polling. */
  onSettled?: () => void;
}

export interface UseAiJobResult {
  loading: boolean;
  discoveredRunning: boolean;
  error: string | null;
  progress: { index: number; total: number } | null;
  /** ISO timestamp of when the current/last run started — drives an elapsed-time display while `loading`. */
  startedAt: string | null;
  start: (options?: { body?: unknown }) => Promise<void>;
  cancel: () => Promise<void>;
}

const POLL_INTERVAL_MS = 1500;

export function useAiJob<TEvent>(opts: UseAiJobOptions<TEvent>): UseAiJobResult {
  const { projectId, step, onEvent, onPollUpdate, onSettled } = opts;
  const [loading, setLoading] = useState(false);
  const [discoveredRunning, setDiscoveredRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ index: number; total: number } | null>(null);
  const [startedAt, setStartedAt] = useState<string | null>(null);

  const pollHandle = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamingLocally = useRef(false);
  const statusUrl = `/api/projects/${projectId}/jobs/${step}`;

  const stopPolling = useCallback(() => {
    if (pollHandle.current) {
      clearInterval(pollHandle.current);
      pollHandle.current = null;
    }
  }, []);

  const checkStatus = useCallback(async (): Promise<JobStatusResponse> => {
    const res = await fetch(statusUrl);
    const status = (await res.json()) as JobStatusResponse;
    onPollUpdate?.(status);
    if (status.progress) setProgress(status.progress);
    if (status.startedAt) setStartedAt(status.startedAt);
    if (!status.running) {
      stopPolling();
      setLoading(false);
      setDiscoveredRunning(false);
      if (status.status === "error" && status.error) setError(status.error);
      onSettled?.();
    }
    return status;
  }, [statusUrl, onPollUpdate, onSettled, stopPolling]);

  const beginPolling = useCallback(() => {
    stopPolling();
    pollHandle.current = setInterval(() => {
      if (!streamingLocally.current) void checkStatus();
    }, POLL_INTERVAL_MS);
  }, [checkStatus, stopPolling]);

  // On mount: discover a job already running (from a previous mount, another
  // tab, or a page that was reloaded mid-generation) and start reflecting it.
  useEffect(() => {
    let stale = false;
    void (async () => {
      const res = await fetch(statusUrl);
      const status = (await res.json()) as JobStatusResponse;
      if (stale || !status.running) return;
      onPollUpdate?.(status);
      if (status.progress) setProgress(status.progress);
      if (status.startedAt) setStartedAt(status.startedAt);
      setLoading(true);
      setDiscoveredRunning(true);
      beginPolling();
    })();
    return () => {
      stale = true;
      stopPolling();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, step]);

  const start = useCallback(async (options?: { body?: unknown }) => {
    stopPolling();
    streamingLocally.current = true;
    setLoading(true);
    setDiscoveredRunning(false);
    setError(null);
    setProgress(null);
    setStartedAt(new Date().toISOString());

    // Set when we discover the job is actually still running elsewhere (409
    // + still-running status) and hand off to polling — the finally block
    // below must leave `loading` alone in that case, since the job hasn't
    // settled; checkStatus() will flip it to false once polling sees it end.
    let joinedRunningJob = false;

    try {
      const res = await fetch(`/api/projects/${projectId}/${step}`, {
        method: "POST",
        headers: options?.body ? { "Content-Type": "application/json" } : undefined,
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      if (res.status === 409) {
        // Someone else (another tab) already started this job — join it via
        // polling instead of surfacing an error.
        streamingLocally.current = false;
        const status = await checkStatus();
        if (status.running) {
          setDiscoveredRunning(true);
          beginPolling();
          joinedRunningJob = true;
        }
        return;
      }

      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "요청에 실패했습니다");
        return;
      }

      await readNdjsonStream<TEvent>(res, (event) => {
        onEvent(event);
        const shape = event as unknown as StreamEventShape;
        if (shape.type === "scene" && typeof shape.index === "number" && typeof shape.total === "number") {
          setProgress({ index: shape.index + 1, total: shape.total });
        } else if (shape.type === "error" && typeof shape.message === "string") {
          setError(shape.message);
        }
      });
    } catch {
      setError("요청 중 오류가 발생했습니다");
    } finally {
      streamingLocally.current = false;
      if (!joinedRunningJob) {
        setLoading(false);
        onSettled?.();
      }
    }
  }, [projectId, step, onEvent, onSettled, checkStatus, beginPolling, stopPolling]);

  const cancel = useCallback(async () => {
    await fetch(statusUrl, { method: "DELETE" });
  }, [statusUrl]);

  return { loading, discoveredRunning, error, progress, startedAt, start, cancel };
}
