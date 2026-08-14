"use client";

export interface ToastItem {
  id: number;
  message: string;
}

/** Fixed bottom-center stack — see ToastContext.tsx for the provider that owns this list and auto-dismiss timing. */
export function ToastStack({ toasts }: { toasts: ToastItem[] }) {
  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background shadow-lg"
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}
