"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Check, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableProjectTitle } from "@/components/EditableProjectTitle";
import { StepNavProvider, type NextStepAction } from "@/lib/client/StepNavContext";
import { ToastProvider } from "@/lib/client/ToastContext";
import { getPipelineSteps, type PipelineBarStep } from "@/lib/projects/pipelineSteps";
import type { ProductionMode } from "@/lib/projects/types";
import { cn } from "@/lib/utils";

/**
 * Whether each step's OWN output data is actually complete (see layout.tsx's
 * isMarkdownComplete/isScenesComplete/isSequencesComplete/
 * isScreenDesignComplete/isReviewComplete/isImagesComplete) — not whether
 * project.currentStep has merely reached a later step. currentStep only
 * records "the last step that finished," so revisiting and regenerating an
 * earlier step regresses it backward and would otherwise make every later
 * step's checkmark disappear even though its data is still on disk
 * untouched. storyboard has no separate output of its own (it's a read-only
 * composite view), so it's never marked complete here.
 *
 * The six mode-independent steps stay required (so layout.tsx's
 * computeStepCompletion can't silently drop one and have it read as
 * undefined/falsy) — only "sequences" is optional, since scene-mode projects
 * never populate (or need) that entry.
 */
export type StepCompletion = Record<Exclude<PipelineBarStep, "sequences">, boolean> & {
  sequences?: boolean;
};

export function AppShell({
  projectId,
  projectTitle,
  productionMode,
  stepCompletion,
  children,
}: {
  projectId: string;
  projectTitle: string;
  productionMode: ProductionMode;
  stepCompletion: StepCompletion;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [nextAction, setNextAction] = useState<NextStepAction | null>(null);

  const steps = getPipelineSteps(productionMode);
  const currentIndex = steps.findIndex((step) => pathname.endsWith(`/${step.key}`));
  const prevStep = currentIndex > 0 ? steps[currentIndex - 1] : null;
  const prevHref = prevStep ? `/projects/${projectId}/${prevStep.key}` : "/";
  const prevLabel = prevStep ? "이전 단계" : "홈";
  const viewedStep = steps[currentIndex];

  return (
    <div className="flex min-h-[calc(100dvh-2.75rem)] flex-col bg-muted">
      <header className="sticky top-11 z-10 shrink-0 transform-gpu border-b bg-background shadow-[0_1px_2px_rgba(15,15,15,0.04)] [backface-visibility:hidden]">
        <div className="mx-auto max-w-[1000px] px-6 md:px-8">
          <div className="flex items-center gap-2 pt-3 pr-14">
            <Link
              href="/"
              aria-label="홈으로"
              className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              <Home className="size-4" />
              홈
            </Link>
            <span className="shrink-0 text-muted-foreground/40">/</span>
            <EditableProjectTitle
              projectId={projectId}
              title={projectTitle}
              className="max-w-[60vw] text-sm font-medium text-muted-foreground hover:text-foreground sm:max-w-none"
            />
          </div>

          <div className="flex items-center py-4">
            {steps.map((step, index) => {
              const isComplete = stepCompletion[step.key];
              const isCurrent = index === currentIndex;
              return (
                <div key={step.key} className="flex flex-1 items-start last:flex-none">
                  <Link
                    href={`/projects/${projectId}/${step.key}`}
                    className="group flex shrink-0 flex-col items-center gap-1.5"
                    aria-current={isCurrent ? "step" : undefined}
                  >
                    <span
                      className={cn(
                        "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors",
                        isComplete && "bg-primary text-primary-foreground",
                        isCurrent && "bg-primary text-primary-foreground ring-4 ring-primary/15",
                        !isComplete && !isCurrent && "bg-transparent text-muted-foreground ring-1 ring-inset ring-border group-hover:ring-foreground/30"
                      )}
                    >
                      {isComplete ? <Check className="size-3.5" /> : index + 1}
                    </span>
                    <span
                      className={cn(
                        "max-w-[70px] truncate text-[10px] font-medium transition-colors sm:max-w-none",
                        isCurrent ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
                      )}
                    >
                      {step.label}
                    </span>
                  </Link>
                  {index < steps.length - 1 && (
                    <span
                      className={cn("mx-1.5 mt-3.5 h-px flex-1 md:mx-2", isComplete ? "bg-primary" : "bg-border")}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1000px] flex-1 bg-background px-6 py-8 md:px-8">
        {viewedStep && (
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {currentIndex + 1}단계 · {viewedStep.label}
          </p>
        )}
        <ToastProvider>
          <StepNavProvider setNextAction={setNextAction}>{children}</StepNavProvider>
        </ToastProvider>
      </main>

      <footer className="sticky bottom-0 z-10 shrink-0 transform-gpu border-t bg-background shadow-[0_-1px_2px_rgba(15,15,15,0.04)] [backface-visibility:hidden]">
        <div className="mx-auto flex max-w-[1000px] items-center justify-between px-6 py-4 md:px-8">
          <Button
            variant="outline"
            size="lg"
            nativeButton={false}
            render={<Link href={prevHref}>← {prevLabel}</Link>}
          />
          {nextAction ? (
            <Button size="lg" onClick={nextAction.onClick} disabled={nextAction.disabled}>
              {nextAction.label}
            </Button>
          ) : (
            <span />
          )}
        </div>
      </footer>
    </div>
  );
}
