"use client";

import { useEffect } from "react";

export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        // PWA 설치 기능은 부가 기능이므로 등록 실패해도 앱 사용에는 지장이 없다.
      });
    }
  }, []);

  return null;
}
