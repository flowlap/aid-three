"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setIsDark(document.documentElement.classList.contains("dark")));
  }, []);

  function toggle() {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      // localStorage may be unavailable (private browsing) — theme just won't persist.
    }
  }

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={toggle}
      className="fixed top-4 right-4 z-50"
      aria-label={isDark ? "라이트 모드로 전환" : "다크 모드로 전환"}
    >
      {isDark ? <Sun /> : <Moon />}
    </Button>
  );
}
