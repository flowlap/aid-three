"use client";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { Scene } from "@/lib/pipeline/splitScenes";
import type { ScreenTypeAssignment } from "@/lib/pipeline/selectScreenTypes";
import type { VisualDesign } from "@/lib/pipeline/designVisuals";
import { cn } from "@/lib/utils";
import { getDepthBorderClass } from "@/lib/depthColors";

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/**
 * One scene's screen-design fields — extracted from ScreenDesignEditor.tsx so
 * SequencePlanEditor.tsx can render the same editing UI inline per sequence
 * (see the screen-design-merge plan doc). Title scenes render a small
 * read-only summary card (they're auto-produced, never AI-designed); content
 * scenes render the full AI-selection + editable-fields card.
 */
export function ScreenDesignSceneCard({
  scene,
  displayIndex,
  indentDepth = 0,
  assignment,
  design,
  regenerating,
  regenerateDisabled,
  onRegenerate,
  onUpdateScreenType,
  onUpdateDesign,
}: {
  scene: Scene;
  displayIndex: number;
  indentDepth?: number;
  assignment: ScreenTypeAssignment | undefined;
  design: VisualDesign | undefined;
  regenerating: boolean;
  regenerateDisabled: boolean;
  onRegenerate: () => void;
  onUpdateScreenType: (patch: Partial<ScreenTypeAssignment>) => void;
  onUpdateDesign: (patch: Partial<VisualDesign>) => void;
}) {
  if (scene.sceneType === "title") {
    return (
      <Card
        id={scene.id}
        className={cn("flex-row items-center gap-3 border-l-4 bg-muted/30 p-3.5", getDepthBorderClass(scene.depth ?? 1))}
        style={{ marginLeft: `${indentDepth * 24}px` }}
      >
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
          {displayIndex}
        </span>
        <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
          제목 · {scene.depth ?? 1}뎁스
        </span>
        <p className="min-w-0 flex-1 truncate text-sm font-semibold">{scene.narrationText}</p>
        <span className="shrink-0 text-xs text-muted-foreground">간지/타이틀형 (자동)</span>
      </Card>
    );
  }

  return (
    <Card id={scene.id} className="gap-5 p-5" style={{ marginLeft: `${indentDepth * 24}px` }}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-muted-foreground">
            {displayIndex}
          </span>
          <span className="text-xs font-medium text-muted-foreground">{scene.id}</span>
        </div>
        <Button type="button" variant="outline" size="sm" onClick={onRegenerate} disabled={regenerateDisabled}>
          {regenerating ? "재생성 중..." : "이 씬만 재생성"}
        </Button>
      </div>

      <p className="rounded-lg border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">{scene.narrationText}</p>

      <div className="rounded-lg border bg-muted/50 p-3.5">
        <p className="mb-2.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">AI 선택</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">화면 유형</span>
            <Input
              value={assignment?.screenType ?? ""}
              onChange={(e) => onUpdateScreenType({ screenType: e.target.value })}
              placeholder="화면 유형"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">추천 레이아웃</span>
            <Input
              value={assignment?.recommendedLayout ?? ""}
              onChange={(e) => onUpdateScreenType({ recommendedLayout: e.target.value })}
              placeholder="추천 레이아웃"
            />
          </label>
        </div>
        {assignment?.rationale && <p className="mt-2.5 text-xs text-muted-foreground italic">근거: {assignment.rationale}</p>}
      </div>

      <div className="space-y-4">
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium">화면 자막</span>
          <Input
            value={design?.caption ?? ""}
            onChange={(e) => onUpdateDesign({ caption: e.target.value })}
            placeholder="화면 자막"
          />
        </label>
        <label className="block">
          <span className="mb-1.5 block text-xs text-muted-foreground">이미지/도식 설명</span>
          <Textarea
            value={design?.imageOrDiagramDescription ?? ""}
            onChange={(e) => onUpdateDesign({ imageOrDiagramDescription: e.target.value })}
            placeholder="이미지 또는 도식에 대한 설명"
          />
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">핵심 키워드 (쉼표로 구분)</span>
            <Input
              value={design?.keywords?.join(", ") ?? ""}
              onChange={(e) => onUpdateDesign({ keywords: parseCommaList(e.target.value) })}
              placeholder="핵심 키워드1, 핵심 키워드2"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">객체 배치</span>
            <Input
              value={design?.objectPlacement ?? ""}
              onChange={(e) => onUpdateDesign({ objectPlacement: e.target.value })}
              placeholder="객체 배치"
            />
          </label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">등장 순서 (쉼표로 구분)</span>
            <Input
              value={design?.appearanceOrder?.join(", ") ?? ""}
              onChange={(e) => onUpdateDesign({ appearanceOrder: parseCommaList(e.target.value) })}
              placeholder="제목, 본문 텍스트, 아이콘"
            />
          </label>
          <label className="block">
            <span className="mb-1.5 block text-xs text-muted-foreground">제작 지시</span>
            <Input
              value={design?.productionNotes ?? ""}
              onChange={(e) => onUpdateDesign({ productionNotes: e.target.value })}
              placeholder="제작 지시"
            />
          </label>
        </div>
      </div>
    </Card>
  );
}
