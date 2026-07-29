"use client";

import { useSearchParams } from "next/navigation";

/** Reads the `?auto=1` flag that carries the "2~6단계까지 자동 진행" pilot across step pages. */
export function useAutoProgressFlag(): boolean {
  const params = useSearchParams();
  return params.get("auto") === "1";
}

/** Appends `?auto=1` to a step href when auto-progress is active. */
export function withAutoProgress(href: string, auto: boolean): string {
  return auto ? `${href}?auto=1` : href;
}
