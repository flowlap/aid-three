import type { ChatMessage, LlmClient } from "../ai/llm/types";
import { stripCodeFence } from "../ai/llm/stripCodeFence";
import type { Scene } from "./splitScenes";
import type { ScreenTypeAssignment } from "./selectScreenTypes";
import type { VisualDesign } from "./designVisuals";

export interface ReviewIssue {
  id: string;
  type: string;
  severity: "info" | "warning" | "error";
  sceneIds: string[];
  message: string;
}

/**
 * Korean labels for the deterministic checks below (a fixed, known set).
 * AI-generated semantic issues have a free-text `type` with no fixed set of
 * values, so they're intentionally left out — the UI falls back to just the
 * severity badge + message for those, since the message is already a full
 * Korean sentence.
 */
export const DETERMINISTIC_ISSUE_LABELS: Record<string, string> = {
  "duplicate-layout": "레이아웃 반복",
  "overlong-narration": "나레이션 과다",
  "numbering-gap": "씬 번호 오류",
};

const MAX_REASONABLE_DURATION_SEC = 40;
const REPEATED_LAYOUT_THRESHOLD = 3;

export function checkDuplicateLayouts(
  scenes: Scene[],
  screenTypes: Record<string, ScreenTypeAssignment>
): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  let streak: string[] = [];
  let streakLayout: string | null = null;

  function flushStreak() {
    if (streak.length >= REPEATED_LAYOUT_THRESHOLD) {
      issues.push({
        id: `dup-layout-${streak[0]}`,
        type: "duplicate-layout",
        severity: "warning",
        sceneIds: [...streak],
        message: `동일한 레이아웃(${streakLayout})이 ${streak.length}개 씬 연속 반복됩니다`,
      });
    }
  }

  for (const scene of scenes) {
    const layout = screenTypes[scene.id]?.recommendedLayout ?? "";
    if (layout && layout === streakLayout) {
      streak.push(scene.id);
    } else {
      flushStreak();
      streak = layout ? [scene.id] : [];
      streakLayout = layout || null;
    }
  }
  flushStreak();

  return issues;
}

export function checkOverlongNarration(scenes: Scene[]): ReviewIssue[] {
  return scenes
    .filter((scene) => scene.estimatedDurationSec > MAX_REASONABLE_DURATION_SEC)
    .map((scene) => ({
      id: `overlong-${scene.id}`,
      type: "overlong-narration",
      severity: "warning" as const,
      sceneIds: [scene.id],
      message: `예상 재생시간(${scene.estimatedDurationSec}초)이 권장 최대치(${MAX_REASONABLE_DURATION_SEC}초)를 초과합니다`,
    }));
}

export function checkSceneNumbering(scenes: Scene[]): ReviewIssue[] {
  const issues: ReviewIssue[] = [];
  const sorted = [...scenes].sort((a, b) => a.order - b.order);
  sorted.forEach((scene, index) => {
    const expectedOrder = index + 1;
    if (scene.order !== expectedOrder) {
      issues.push({
        id: `numbering-${scene.id}`,
        type: "numbering-gap",
        severity: "error",
        sceneIds: [scene.id],
        message: `씬 번호가 순차적이지 않습니다 (기대값: ${expectedOrder}, 실제값: ${scene.order})`,
      });
    }
  });
  return issues;
}

function isValidSeverity(value: unknown): value is ReviewIssue["severity"] {
  return value === "info" || value === "warning" || value === "error";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isSemanticIssue(value: unknown): value is Omit<ReviewIssue, "id"> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as ReviewIssue).type === "string" &&
    isValidSeverity((value as ReviewIssue).severity) &&
    isStringArray((value as ReviewIssue).sceneIds) &&
    typeof (value as ReviewIssue).message === "string"
  );
}

function isSemanticReviewResponse(value: unknown): value is { issues: Array<Omit<ReviewIssue, "id">> } {
  return (
    typeof value === "object" &&
    value !== null &&
    Array.isArray((value as { issues: unknown }).issues) &&
    (value as { issues: unknown[] }).issues.every(isSemanticIssue)
  );
}

function buildSemanticReviewMessages(
  scenes: Scene[],
  visualDesigns: Record<string, VisualDesign>
): ChatMessage[] {
  const summary = scenes.map((scene) => ({
    sceneId: scene.id,
    narrationText: scene.narrationText,
    caption: visualDesigns[scene.id]?.caption ?? "",
    keywords: visualDesigns[scene.id]?.keywords ?? [],
  }));

  const prompt = `다음은 이러닝 스토리보드의 씬별 나레이션과 화면 정보입니다. 아래 항목을 점검하고 이슈를 찾아주세요:
- 용어 통일 (같은 개념에 다른 용어 사용)
- 나레이션과 화면 불일치
- 학습 목표 누락

데이터:
${JSON.stringify(summary, null, 2)}

JSON으로만 응답하세요: {"issues": [{"type": string, "severity": "info"|"warning"|"error", "sceneIds": string[], "message": string}]}`;

  return [
    { role: "system", content: "당신은 이러닝 스토리보드 품질 검수 전문가입니다." },
    { role: "user", content: prompt },
  ];
}

export function parseSemanticReviewResponse(raw: string): ReviewIssue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(raw));
  } catch {
    throw new Error("AI 응답이 유효한 JSON이 아닙니다 (일관성 검수)");
  }

  if (!isSemanticReviewResponse(parsed)) {
    throw new Error("AI 응답 형식이 올바르지 않습니다 (issues 배열, type/severity/sceneIds/message 필드 필요)");
  }

  return parsed.issues.map((issue, index) => ({
    id: `semantic-${index + 1}`,
    ...issue,
  }));
}

export async function reviewSemanticConsistency(
  client: LlmClient,
  scenes: Scene[],
  visualDesigns: Record<string, VisualDesign>
): Promise<ReviewIssue[]> {
  const raw = await client.complete(buildSemanticReviewMessages(scenes, visualDesigns), {
    jsonMode: true,
    tier: "fast",
  });
  return parseSemanticReviewResponse(raw);
}

export async function reviewSemanticConsistencyStream(
  client: LlmClient,
  scenes: Scene[],
  visualDesigns: Record<string, VisualDesign>,
  signal?: AbortSignal
): Promise<AsyncIterable<string>> {
  return client.completeStream(buildSemanticReviewMessages(scenes, visualDesigns), {
    jsonMode: true,
    tier: "fast",
    signal,
  });
}
