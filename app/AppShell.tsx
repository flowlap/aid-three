"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Check, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EditableProjectTitle } from "@/components/EditableProjectTitle";
import { StepNavProvider, type NextStepAction } from "@/lib/client/StepNavContext";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "markdown", label: "원고 변환" },
  { key: "scenes", label: "씬 분할" },
  { key: "screen-design", label: "화면 설계" },
  { key: "review", label: "일관성 검수" },
  { key: "images", label: "이미지/목업 생성" },
  { key: "storyboard", label: "최종 뷰" },
] as const;

export function AppShell({
  projectId,
  projectTitle,
  children,
}: {
  projectId: string;
  projectTitle: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [nextAction, setNextAction] = useState<NextStepAction | null>(null);

  const currentIndex = STEPS.findIndex((step) => pathname.endsWith(`/${step.key}`));
  const prevStep = currentIndex > 0 ? STEPS[currentIndex - 1] : null;
  const prevHref = prevStep ? `/projects/${projectId}/${prevStep.key}` : "/";
  const prevLabel = prevStep ? "이전 단계" : "홈";
  const currentStep = STEPS[currentIndex];

  return (
    <div className="flex min-h-dvh flex-col bg-muted">
      <header className="sticky top-0 z-10 shrink-0 transform-gpu border-b bg-background shadow-[0_1px_2px_rgba(15,15,15,0.04)] [backface-visibility:hidden]">
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
            {STEPS.map((step, index) => {
              const isComplete = index < currentIndex;
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
                  {index < STEPS.length - 1 && (
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
        {currentStep && (
          <p className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {currentIndex + 1}단계 · {currentStep.label}
          </p>
        )}
        <StepNavProvider setNextAction={setNextAction}>{children}</StepNavProvider>
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
