"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Sequence, SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { sortedSequences } from "@/lib/pipeline/sequenceEditorOps";
import type { ImageEngine } from "@/components/ImageEngineSelector";
import { runWithConcurrencyLimit, createRateGate } from "@/lib/concurrency";
import { IMAGE_GENERATION_CONCURRENCY, IMAGE_GENERATION_MIN_INTERVAL_MS, LOCAL_IMAGE_CONCURRENCY } from "@/lib/pipeline/imageGenerationConfig";
import { GeminiBatchStatusPanel } from "./GeminiBatchStatusPanel";

const MASTER_VISUAL_STATUS_LABEL: Record<Sequence["masterVisual"]["status"], string> = {
  "not-generated": "미생성",
  generated: "생성됨",
  stale: "재생성 필요 (변경됨)",
};

/**
 * Sequence-mode-only master-visual generation, moved here from
 * SequencePlanEditor.tsx and rendered after the images step's engine
 * selection, common prompt, and background/style reference settings so
 * generation reuses whatever the user just configured above. The
 * description text itself remains editable only in the sequence-design
 * step — this section links there instead of duplicating that editing UI.
 */
export function SequenceMasterVisualsSection({
  projectId,
  initialPlan,
  engine,
  imageBatchProviderEnabled,
}: {
  projectId: string;
  initialPlan: SequencePlan;
  engine: ImageEngine;
  /** Whether IMAGE_BATCH_PROVIDER=gemini is configured — shows a "배치로 생성" panel alongside the existing immediate-generation buttons when true. See GeminiBatchStatusPanel.tsx. */
  imageBatchProviderEnabled: boolean;
}) {
  const [plan, setPlan] = useState<SequencePlan>(initialPlan);
  const [generatingFor, setGeneratingFor] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [versions, setVersions] = useState<Record<string, number>>({});
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ done: number; total: number } | null>(null);
  const [batchSummary, setBatchSummary] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const batchCancelRef = useRef(false);

  const sequences = sortedSequences(plan);
  const pendingCount = sequences.filter((seq) => seq.masterVisual.status !== "generated").length;

  function toggleSelected(sequenceId: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(sequenceId)) next.delete(sequenceId);
      else next.add(sequenceId);
      return next;
    });
  }

  /**
   * Mirrors SequencePlanEditor.tsx's former handleGenerateMasterVisual — same
   * endpoint, same in-flight lock. `referenceSequenceId` (see
   * generateConsistentGroup) asks the server to attach another sequence's
   * already-generated master as an extra reference image, so this call's
   * result stays visually consistent with it.
   */
  async function generateOne(sequenceId: string, options?: { referenceSequenceId?: string }): Promise<boolean> {
    setGeneratingFor((prev) => new Set(prev).add(sequenceId));
    setErrors((prev) => ({ ...prev, [sequenceId]: "" }));
    try {
      const seq = plan.sequences.find((s) => s.id === sequenceId);
      const res = await fetch(`/api/projects/${projectId}/sequences/${sequenceId}/master-image`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: seq?.masterVisual.description,
          continuity: seq?.continuity,
          referenceSequenceId: options?.referenceSequenceId,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrors((prev) => ({ ...prev, [sequenceId]: data.error ?? "마스터 비주얼 생성에 실패했습니다" }));
        return false;
      }
      setPlan((prev) => ({
        ...prev,
        sequences: prev.sequences.map((s) =>
          s.id === sequenceId ? { ...s, masterVisual: { ...s.masterVisual, status: "generated", assetId: data.assetId } } : s
        ),
      }));
      setVersions((prev) => ({ ...prev, [sequenceId]: (prev[sequenceId] ?? 0) + 1 }));
      return true;
    } catch {
      setErrors((prev) => ({ ...prev, [sequenceId]: "요청 중 오류가 발생했습니다" }));
      return false;
    } finally {
      setGeneratingFor((prev) => {
        const next = new Set(prev);
        next.delete(sequenceId);
        return next;
      });
    }
  }

  /**
   * Runs several sequences' generation calls concurrently — the endpoint's
   * lock is now per-sequence (see the master-image route), so different
   * sequences no longer contend with each other. Capped like the main batch
   * scene-image job: LOCAL_IMAGE_CONCURRENCY (1, the local engine runs on a
   * single GPU process) or IMAGE_GENERATION_CONCURRENCY for remote engines.
   *
   * `force` mirrors the scene-image step's "전체 다시 생성" — normally this
   * only targets sequences that aren't already `"generated"` (missing or
   * stale), but a force run regenerates every sequence regardless of status,
   * for cases like "the common prompt/style reference changed and every
   * master should reflect it" where nothing is technically stale.
   */
  async function generateAll(force: boolean) {
    if (batchRunning) return;
    const all = sortedSequences(plan);
    const targets = force ? all : all.filter((seq) => seq.masterVisual.status !== "generated");
    if (targets.length === 0) return;

    setBatchRunning(true);
    setBatchSummary(null);
    batchCancelRef.current = false;
    let done = 0;
    let failures = 0;
    setBatchProgress({ done: 0, total: targets.length });

    const concurrency = engine === "local" ? LOCAL_IMAGE_CONCURRENCY : IMAGE_GENERATION_CONCURRENCY;
    // Rate-gated like the main scene-image batch job (see
    // IMAGE_GENERATION_MIN_INTERVAL_MS) — this hits the same image gateway,
    // so calls are paced to at most one new start per interval regardless of
    // how many are already in flight, instead of capping concurrency alone.
    const rateGate = createRateGate(IMAGE_GENERATION_MIN_INTERVAL_MS);
    await runWithConcurrencyLimit(targets, concurrency, async (target) => {
      if (batchCancelRef.current) return;
      if (engine !== "local") await rateGate();
      if (batchCancelRef.current) return;
      const ok = await generateOne(target.id);
      if (!ok) failures++;
      done++;
      setBatchProgress({ done, total: targets.length });
    });

    const cancelled = batchCancelRef.current;
    const succeeded = done - failures;
    setBatchProgress(null);
    setBatchRunning(false);
    setBatchSummary(
      `${cancelled ? "중지됨 — " : ""}${succeeded}개 생성 완료${failures > 0 ? `, ${failures}개 실패` : ""}` +
        (cancelled ? ` (${targets.length - done}개 남음)` : "")
    );
  }

  /**
   * Independently generated sequence masters can end up looking too
   * different from each other (direct user feedback). This generates the
   * first selected sequence (in sequence order) as an "anchor" — reusing its
   * image as-is if it's already generated, generating it fresh otherwise —
   * then generates every other selected sequence with `referenceSequenceId`
   * pointing at the anchor, so the server attaches the anchor's actual
   * generated image as a consistency reference (see generateSequenceMasterImage.ts's
   * CONSISTENCY_REFERENCE_INSTRUCTION). If the anchor itself fails to
   * generate, the rest are never attempted — generating them without a real
   * anchor image would silently degrade to independent, non-consistent
   * generation while still costing real API calls.
   */
  async function generateConsistentGroup() {
    if (batchRunning) return;
    const targets = sequences.filter((seq) => selected.has(seq.id));
    if (targets.length < 2) return;
    const [anchor, ...rest] = targets;

    setBatchRunning(true);
    setBatchSummary(null);
    batchCancelRef.current = false;
    let done = 0;
    let failures = 0;
    setBatchProgress({ done: 0, total: targets.length });

    const anchorAlreadyGenerated = anchor.masterVisual.status === "generated" && Boolean(anchor.masterVisual.assetId);
    if (!anchorAlreadyGenerated) {
      const ok = await generateOne(anchor.id);
      done++;
      setBatchProgress({ done, total: targets.length });
      if (!ok) {
        setBatchProgress(null);
        setBatchRunning(false);
        setBatchSummary("기준 이미지(선택한 첫 번째 시퀀스) 생성에 실패해 나머지는 생성하지 않았습니다");
        return;
      }
    } else {
      done++;
      setBatchProgress({ done, total: targets.length });
    }

    if (!batchCancelRef.current) {
      const concurrency = engine === "local" ? LOCAL_IMAGE_CONCURRENCY : IMAGE_GENERATION_CONCURRENCY;
      const rateGate = createRateGate(IMAGE_GENERATION_MIN_INTERVAL_MS);
      await runWithConcurrencyLimit(rest, concurrency, async (target) => {
        if (batchCancelRef.current) return;
        if (engine !== "local") await rateGate();
        if (batchCancelRef.current) return;
        const ok = await generateOne(target.id, { referenceSequenceId: anchor.id });
        if (!ok) failures++;
        done++;
        setBatchProgress({ done, total: targets.length });
      });
    }

    const cancelled = batchCancelRef.current;
    const succeeded = done - failures;
    setBatchProgress(null);
    setBatchRunning(false);
    setBatchSummary(
      `${cancelled ? "중지됨 — " : ""}${succeeded}개 통일감 있게 생성 완료${failures > 0 ? `, ${failures}개 실패` : ""}` +
        (cancelled ? ` (${targets.length - done}개 남음)` : "")
    );
  }

  function cancelBatch() {
    batchCancelRef.current = true;
  }

  if (sequences.length === 0) return null;

  return (
    <Card className="gap-3 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <div>
          <span className="text-sm font-medium">시퀀스 마스터 비주얼</span>
          <p className="text-xs text-muted-foreground">
            위 엔진/공통 프롬프트/배경·스타일 참조 설정을 사용해 시퀀스별 배경 마스터 이미지를 생성합니다. 설명 문구 수정은{" "}
            <Link href={`/projects/${projectId}/sequences`} className="underline">
              시퀀스 설계
            </Link>{" "}
            단계에서 하세요.
          </p>
        </div>
        {batchRunning ? (
          <Button variant="outline" size="sm" className="ml-auto" onClick={cancelBatch}>
            중지
          </Button>
        ) : (
          <div className="ml-auto flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void generateAll(false)}
              disabled={pendingCount === 0}
              title="마스터 비주얼이 없는(또는 재생성이 필요한) 시퀀스를 모두 병렬로 생성합니다"
            >
              {pendingCount === 0 ? "모두 생성됨" : `일괄 생성 (${pendingCount}개)`}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (!confirm(`이미 생성된 것을 포함해 전체 ${sequences.length}개 시퀀스의 마스터 비주얼을 다시 생성합니다. 계속할까요?`)) return;
                void generateAll(true);
              }}
              title="상태와 무관하게 모든 시퀀스의 마스터 비주얼을 다시 생성합니다"
            >
              전체 재생성
            </Button>
          </div>
        )}
      </div>
      {batchRunning && batchProgress && (
        <p className="text-xs font-medium text-muted-foreground">
          마스터 비주얼 생성 중… ({batchProgress.done}/{batchProgress.total})
        </p>
      )}
      {!batchRunning && batchSummary && <p className="text-xs font-medium text-muted-foreground">{batchSummary}</p>}

      {imageBatchProviderEnabled && (
        <GeminiBatchStatusPanel
          projectId={projectId}
          kind="master"
          primaryMode={pendingCount > 0 ? "resume" : "full"}
          primaryCount={pendingCount > 0 ? pendingCount : sequences.length}
          primaryLabel={pendingCount > 0 ? `일괄 생성 (${pendingCount}개)` : "전체 재생성"}
          showFullSecondary={pendingCount > 0}
          fullCount={sequences.length}
          disabled={batchRunning}
          onApplied={(appliedSequenceIds) => {
            const applied = new Set(appliedSequenceIds);
            setPlan((prev) => ({
              ...prev,
              sequences: prev.sequences.map((s) =>
                applied.has(s.id) ? { ...s, masterVisual: { ...s.masterVisual, status: "generated" } } : s
              ),
            }));
            setVersions((prev) => {
              const next = { ...prev };
              for (const id of appliedSequenceIds) next[id] = (next[id] ?? 0) + 1;
              return next;
            });
          }}
        />
      )}

      <div className="flex flex-wrap items-center gap-2 rounded-md border border-dashed p-2">
        <span className="text-xs text-muted-foreground">
          체크박스로 시퀀스를 여러 개 선택하면, 선택한 순서 중 첫 번째를 기준 이미지로 삼아 나머지를 그 이미지와 통일감 있게 생성합니다.
        </span>
        <div className="ml-auto flex gap-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelected(selected.size === sequences.length ? new Set() : new Set(sequences.map((s) => s.id)))}
            disabled={batchRunning}
          >
            {selected.size === sequences.length ? "선택 해제" : "전체 선택"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void generateConsistentGroup()}
            disabled={selected.size < 2 || batchRunning}
            title="선택한 시퀀스 중 첫 번째(시퀀스 순서 기준)를 기준 이미지로 삼아, 나머지를 그 이미지를 참고 이미지로 첨부해서 통일감 있게 생성합니다"
          >
            선택 {selected.size}개 통일감 있게 생성
          </Button>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {sequences.map((seq) => (
          <li key={seq.id} className="space-y-1.5 rounded-md border p-2.5 text-xs">
            <div className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={selected.has(seq.id)}
                onChange={() => toggleSelected(seq.id)}
                disabled={batchRunning}
                className="size-3.5 accent-primary"
                aria-label={`${seq.title} 선택`}
              />
              <span className="font-semibold">{seq.title}</span>
              <span
                className={
                  "ml-auto rounded px-1.5 py-0.5 text-[10px] font-semibold " +
                  (seq.masterVisual.status === "generated"
                    ? "bg-primary/10 text-primary"
                    : seq.masterVisual.status === "stale"
                      ? "bg-warning/10 text-warning"
                      : "bg-muted text-muted-foreground")
                }
              >
                {MASTER_VISUAL_STATUS_LABEL[seq.masterVisual.status]}
              </span>
            </div>
            <p className="line-clamp-2 text-muted-foreground">{seq.masterVisual.description}</p>
            {seq.masterVisual.assetId && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/projects/${projectId}/sequences/${seq.id}/master-image?v=${versions[seq.id] ?? 0}`}
                alt={`${seq.title} 마스터 비주얼`}
                className="max-h-32 w-full rounded-md border object-cover"
              />
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={generatingFor.has(seq.id) || batchRunning}
              onClick={() => void generateOne(seq.id)}
            >
              {generatingFor.has(seq.id) ? "생성 중..." : seq.masterVisual.status === "not-generated" ? "마스터 비주얼 생성" : "다시 생성"}
            </Button>
            {errors[seq.id] && <p className="text-destructive">{errors[seq.id]}</p>}
          </li>
        ))}
      </ul>
    </Card>
  );
}
