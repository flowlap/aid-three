"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { ToastStack, type ToastItem } from "@/components/Toast";

/** How long a toast stays on screen before auto-dismissing. */
const TOAST_DURATION_MS = 2500;

interface ToastContextValue {
  showToast: (message: string) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

let nextToastId = 0;

/**
 * Mounted once in AppShell so every pipeline step page can call useToast()
 * without its own provider. Owns the toast list itself (unlike
 * StepNavContext, which lifts state up to AppShell) since nothing outside
 * this file needs to read the current toast list — it only needs to render
 * next to whatever page content is passed as children.
 */
export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const showToast = useCallback((message: string) => {
    const id = nextToastId++;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
    }, TOAST_DURATION_MS);
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <ToastStack toasts={toasts} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within a ToastProvider");
  return ctx;
}
