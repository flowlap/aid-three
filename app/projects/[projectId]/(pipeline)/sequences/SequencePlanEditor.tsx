"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { AiJobStatus } from "@/components/AiJobStatus";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { Sequence, SequenceContinuity, SequenceIntegrityIssue, SequencePlan } from "@/lib/pipeline/sequenceTypes";
import { validateSequenceIntegrity } from "@/lib/pipeline/validateSequenceIntegrity";
import {
  deriveSequenceDurationSec,
  mergeAdjacentSequences,
  moveSceneToAdjacentSequence,
  renameSequence,
  sortedSequences,
  splitSequence,
  updateContinuity,
  updateMasterVisualDescription,
  type SequenceOpResult,
} from "@/lib/pipeline/sequenceEditorOps";
import type { ProductionMode } from "@/lib/projects/types";
import { useAiJob } from "@/lib/client/useAiJob";
import { useNextStepAction } from "@/lib/client/StepNavContext";
import { estimateSecondsForChars } from "@/lib/client/estimateAiDuration";
import { cn } from "@/lib/utils";

type SequenceStreamEvent =
  | { type: "chunk"; text: string }
  | { type: "result"; plan: SequencePlan; issues: SequenceIntegrityIssue[] }
  | { type: "error"; message: string }
  | { type: "cancelled" };

const MASTER_VISUAL_STATUS_LABEL: Record<Sequence["masterVisual"]["status"], string> = {
  "not-generated": "미생성",
  generated: "생성됨",
  stale: "재생성 필요 (변경됨)",
};

function textToLines(text: string): string[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

function narrationSnippet(scene: Scene | undefined): string {
  if (!scene) return "(scenes.json에서 찾을 수 없는 씬입니다)";
  const text = scene.narrationText.trim();
  return text.length > 90 ? `${text.slice(0, 90)}…` : text;
}

/** Small severity-tagged issue list, shared by the always-on client-side check and the PUT endpoint's returned issues. */
function IssueList({ issues }: { issues: SequenceIntegrityIssue[] }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1">
      {issues.map((issue) => (
        <li
          key={issue.id}
          className={cn(
            "rounded-md border px-3 py-1.5 text-xs",
            issue.severity === "error"
              ? "border-destructive/30 bg-destructive/5 text-destructive"
              : "border-warning/30 bg-warning/10 text-warning"
          )}
        >
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

export function SequencePlanEditor({
  projectId,
  initialScenes,
  initialPlan,
  productionMode,
}: {
  projectId: string;
  initialScenes: Scene[];
  initialPlan: SequencePlan | null;
  productionMode: ProductionMode;
}) {
  const [scenes] = useState<Scene[]>(initialScenes);
  const [plan, setPlan] = useState<SequencePlan | null>(initialPlan);
  const [rawPreview, setRawPreview] = useState("");
  const [opError, setOpError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveIssues, setSaveIssues] = useState<SequenceIntegrityIssue[]>([]);
  const [titleDrafts, setTitleDrafts] = useState<Record<string, string>>({});

  const { loading, discoveredRunning, error, startedAt, start, cancel } = useAiJob<SequenceStreamEvent>({
    projectId,
    step: "sequences",
    onEvent: (event) => {
      if (event.type === "chunk") {
        setRawPreview((prev) => prev + event.text);
      } else if (event.type === "result") {
        setPlan(event.plan);
        setOpError(null);
        setSaveIssues([]);
      }
    },
    onPollUpdate: (status) => {
      if (typeof status.partialRaw === "string") setRawPreview(status.partialRaw);
    },
  });

  const sceneById = useMemo(() => new Map(scenes.map((scene) => [scene.id, scene])), [scenes]);
  const narrationCharCount = useMemo(
    () => scenes.reduce((total, scene) => total + scene.narrationText.length, 0),
    [scenes]
  );

  const integrityIssues = useMemo(
    () => (plan ? validateSequenceIntegrity(scenes, plan) : []),
    [scenes, plan]
  );
  const hasBlockingIssues = integrityIssues.some((issue) => issue.severity === "error");
  const sequences = plan ? sortedSequences(plan) : [];

  async function handleGenerate() {
    setOpError(null);
    setRawPreview("");
    await start();
  }

  /** Applies a pure sequenceEditorOps result: replaces plan on success, surfaces `error` transiently otherwise. */
  function applyOp(result: SequenceOpResult) {
    if ("error" in result) {
      setOpError(result.error);
      return;
    }
    setOpError(null);
    setPlan(result.plan);
  }

  function handleTitleBlur(sequenceId: string) {
    const draft = titleDrafts[sequenceId];
    if (draft === undefined || !plan) return;
    applyOp(renameSequence(plan, sequenceId, draft));
    setTitleDrafts((prev) => {
      const next = { ...prev };
      delete next[sequenceId];
      return next;
    });
  }

  function handleContinuityField(sequenceId: string, patch: Partial<SequenceContinuity>) {
    if (!plan) return;
    applyOp(updateContinuity(plan, sequenceId, patch));
  }

  function handleMasterVisualDescription(sequenceId: string, description: string) {
    if (!plan) return;
    applyOp(updateMasterVisualDescription(plan, sequenceId, description));
  }

  function handleMoveScene(sceneId: string, direction: "prev" | "next") {
    if (!plan) return;
    applyOp(moveSceneToAdjacentSequence(plan, scenes, sceneId, direction));
  }

  function handleMerge(firstSequenceId: string, secondSequenceId: string) {
    if (!plan) return;
    applyOp(mergeAdjacentSequences(plan, scenes, firstSequenceId, secondSequenceId));
  }

  function handleSplit(sequenceId: string, splitAfterSceneId: string) {
    if (!plan) return;
    applyOp(splitSequence(plan, scenes, sequenceId, splitAfterSceneId));
  }

  /**
   * Saves via PUT (server-side validateSequenceIntegrity remains the sole
   * authority — see sequenceEditorOps.ts's header comment). When `destination`
   * is given and the save succeeds, navigates with a full page load rather
   * than router.push(): a plain SPA transition can reuse a stale cached
   * render of the shared (pipeline) layout (stepper checkmarks included),
   * which only reliably refetches project.currentStep on a real navigation
   * (same reasoning as SceneListEditor.tsx's saveAndGoTo). Omitting
   * `destination` performs a plain save-in-place so the user can review
   * server-reported warnings before advancing.
   */
  async function saveAndGoTo(destination?: string) {
    if (!plan) return;
    setSaving(true);
    setSaveError(null);
    setSaveIssues([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/sequences`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(plan),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error ?? "저장에 실패했습니다");
        if (Array.isArray(data.issues)) setSaveIssues(data.issues);
        return;
      }
      if (Array.isArray(data.issues)) setSaveIssues(data.issues);
      if (destination) {
        window.location.href = destination;
      }
    } catch {
      setSaveError("저장 요청 중 오류가 발생했습니다");
    } finally {
      setSaving(false);
    }
  }

  const saveDisabled = !plan || plan.sequences.length === 0 || saving || loading || hasBlockingIssues;

  useNextStepAction(
    saving ? "저장 중..." : "다음 단계",
    saveDisabled,
    () => void saveAndGoTo(`/projects/${projectId}/screen-design`)
  );

  // Defensive: this component is only ever mounted by sequences/page.tsx,
  // which already redirects scene-mode projects to /screen-design before
  // rendering it — this is a second, cheap guard in case that ever changes.
  // Placed after every hook call above so it never violates the rules of
  // hooks (hook call order/count must never depend on this prop).
  if (productionMode !== "sequence") return null;

  return (
    <div className="space-y-4">
      <Card className="gap-3 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={handleGenerate} disabled={loading}>
            {loading ? (discoveredRunning ? "이미 실행 중..." : "설계 중...") : plan ? "다시 생성" : "AI로 시퀀스 설계"}
          </Button>
          {loading && (
            <Button variant="outline" onClick={cancel}>
              취소
            </Button>
          )}
          <Button variant="outline" onClick={() => void saveAndGoTo()} disabled={saveDisabled}>
            {saving ? "저장 중..." : "저장"}
          </Button>
          <span className="ml-auto text-xs font-medium text-muted-foreground">
            {plan ? `총 ${plan.sequences.length}개 시퀀스` : "아직 시퀀스 계획이 없습니다"}
          </span>
        </div>
        <AiJobStatus
          loading={loading}
          label={discoveredRunning ? "다른 곳에서 시작된 시퀀스 설계가 진행 중입니다" : "AI가 씬을 시퀀스로 묶는 중입니다"}
          startedAt={startedAt}
          estimateSeconds={estimateSecondsForChars(narrationCharCount)}
          activityLines={rawPreview ? [rawPreview] : []}
        />
      </Card>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {error}
        </p>
      )}
      {opError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {opError}
        </p>
      )}
      {saveError && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {saveError}
        </p>
      )}
      {saveIssues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">저장 시 확인된 사항</p>
          <IssueList issues={saveIssues} />
        </div>
      )}
      {integrityIssues.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground">
            현재 계획 점검 결과{hasBlockingIssues ? " — 오류를 해결해야 저장/다음 단계로 진행할 수 있습니다" : ""}
          </p>
          <IssueList issues={integrityIssues} />
        </div>
      )}

      {!plan || sequences.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          아직 시퀀스 계획이 없습니다. 위의 &ldquo;AI로 시퀀스 설계&rdquo; 버튼으로 생성해주세요.
        </Card>
      ) : (
        <ul className="space-y-4">
          {sequences.map((seq, seqIndex) => {
            const nextSeq = sequences[seqIndex + 1];
            const derivedDuration = deriveSequenceDurationSec(seq.sceneIds, scenes);
            const durationMismatch = derivedDuration !== seq.estimatedDurationSec;
            const titleValue = titleDrafts[seq.id] ?? seq.title;

            return (
              <li key={seq.id}>
                <Card className="gap-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                      {seq.order}
                    </span>
                    <Input
                      value={titleValue}
                      onChange={(e) => setTitleDrafts((prev) => ({ ...prev, [seq.id]: e.target.value }))}
                      onBlur={() => handleTitleBlur(seq.id)}
                      className="h-8 max-w-xs text-sm font-semibold"
                    />
                    <span className="text-xs text-muted-foreground">{seq.id}</span>
                    {seq.needsReview && (
                      <Badge variant="destructive" title="AI가 검토가 필요하다고 표시한 시퀀스입니다">
                        검토 필요
                      </Badge>
                    )}
                    <span className={cn("text-xs", durationMismatch ? "text-warning" : "text-muted-foreground")}>
                      {durationMismatch
                        ? `예상 ${seq.estimatedDurationSec}초 (씬 합계 ${derivedDuration}초 — 불일치)`
                        : `${derivedDuration}초`}
                    </span>
                    {nextSeq && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="ml-auto"
                        onClick={() => handleMerge(seq.id, nextSeq.id)}
                      >
                        다음 시퀀스와 병합
                      </Button>
                    )}
                  </div>

                  {seq.purpose && <p className="text-sm text-muted-foreground">{seq.purpose}</p>}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="space-y-1 text-xs text-muted-foreground">
                      장소
                      <Input
                        value={seq.continuity.location}
                        onChange={(e) => handleContinuityField(seq.id, { location: e.target.value })}
                        className="h-8 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      시간대
                      <Input
                        value={seq.continuity.timeOfDay ?? ""}
                        onChange={(e) => handleContinuityField(seq.id, { timeOfDay: e.target.value })}
                        className="h-8 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      비주얼 스타일
                      <Input
                        value={seq.continuity.visualStyle}
                        onChange={(e) => handleContinuityField(seq.id, { visualStyle: e.target.value })}
                        className="h-8 text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground">
                      고정 요소 (줄바꿈으로 구분)
                      <Textarea
                        rows={2}
                        value={seq.continuity.fixedElements.join("\n")}
                        onChange={(e) => handleContinuityField(seq.id, { fixedElements: textToLines(e.target.value) })}
                        className="text-sm text-foreground"
                      />
                    </label>
                    <label className="space-y-1 text-xs text-muted-foreground sm:col-span-2">
                      변경 금지 항목 (줄바꿈으로 구분)
                      <Textarea
                        rows={2}
                        value={seq.continuity.doNotChange.join("\n")}
                        onChange={(e) => handleContinuityField(seq.id, { doNotChange: textToLines(e.target.value) })}
                        className="text-sm text-foreground"
                      />
                    </label>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <span>마스터 비주얼 설명</span>
                      <span
                        className={cn(
                          "rounded px-1.5 py-0.5 text-[10px] font-semibold",
                          seq.masterVisual.status === "generated" && "bg-primary/10 text-primary",
                          seq.masterVisual.status === "stale" && "bg-warning/10 text-warning",
                          seq.masterVisual.status === "not-generated" && "bg-muted text-muted-foreground"
                        )}
                      >
                        {MASTER_VISUAL_STATUS_LABEL[seq.masterVisual.status]}
                      </span>
                    </div>
                    <Textarea
                      rows={2}
                      value={seq.masterVisual.description}
                      onChange={(e) => handleMasterVisualDescription(seq.id, e.target.value)}
                      className="text-sm"
                    />
                  </div>

                  <ul className="space-y-1.5">
                    {seq.sceneIds.map((sceneId, sceneIndex) => {
                      const scene = sceneById.get(sceneId);
                      const camera = seq.cameraPlan.find((entry) => entry.sceneId === sceneId);
                      const overlays = seq.overlays.filter((entry) => entry.sceneId === sceneId);
                      const isFirst = sceneIndex === 0;
                      const isLast = sceneIndex === seq.sceneIds.length - 1;
                      const canMovePrev = isFirst && seqIndex > 0 && seq.sceneIds.length > 1;
                      const canMoveNext = isLast && seqIndex < sequences.length - 1 && seq.sceneIds.length > 1;
                      const canSplitHere = !isLast;

                      return (
                        <li key={sceneId} className="rounded-md border p-2.5 text-xs">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-muted-foreground">{sceneId}</span>
                            <span className="text-muted-foreground">
                              {scene ? `${scene.estimatedDurationSec}초` : ""}
                            </span>
                            <div className="ml-auto flex flex-wrap gap-1">
                              {canMovePrev && (
                                <Button variant="outline" size="sm" onClick={() => handleMoveScene(sceneId, "prev")}>
                                  ← 이전 시퀀스로
                                </Button>
                              )}
                              {canMoveNext && (
                                <Button variant="outline" size="sm" onClick={() => handleMoveScene(sceneId, "next")}>
                                  다음 시퀀스로 →
                                </Button>
                              )}
                              {canSplitHere && (
                                <Button variant="outline" size="sm" onClick={() => handleSplit(seq.id, sceneId)}>
                                  여기서 분할
                                </Button>
                              )}
                            </div>
                          </div>
                          <p className="mt-1 text-muted-foreground/90" title="나레이션은 여기서 수정할 수 없습니다 (씬 분할 단계 참고용)">
                            {narrationSnippet(scene)}
                          </p>
                          {(camera || overlays.length > 0) && (
                            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-muted-foreground">
                              {camera && (
                                <span>
                                  카메라: {camera.shot} / {camera.motion}
                                </span>
                              )}
                              {overlays.map((overlay, i) => (
                                <span key={i}>
                                  오버레이: {overlay.type} — {overlay.description}
                                </span>
                              ))}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
