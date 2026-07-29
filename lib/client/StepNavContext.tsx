"use client";

import { createContext, useContext, useEffect, useRef } from "react";

export interface NextStepAction {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

type SetNextStepAction = (action: NextStepAction | null) => void;

const StepNavContext = createContext<SetNextStepAction | null>(null);

export function StepNavProvider({
  setNextAction,
  children,
}: {
  setNextAction: SetNextStepAction;
  children: React.ReactNode;
}) {
  return <StepNavContext.Provider value={setNextAction}>{children}</StepNavContext.Provider>;
}

/**
 * Registers this step's "다음 단계" action with the AppShell footer.
 * Pass label=null to clear the button (e.g. while there's nothing to advance to).
 * onClick is read from a ref so callers don't need to memoize it themselves.
 */
export function useNextStepAction(label: string | null, disabled: boolean, onClick: () => void) {
  const setNextAction = useContext(StepNavContext);
  const onClickRef = useRef(onClick);

  useEffect(() => {
    onClickRef.current = onClick;
  });

  useEffect(() => {
    if (!setNextAction) return;
    if (label === null) {
      setNextAction(null);
      return;
    }
    setNextAction({ label, disabled, onClick: () => onClickRef.current() });
    return () => setNextAction(null);
  }, [setNextAction, label, disabled]);
}
