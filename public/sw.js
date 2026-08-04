// PWA 설치 요건 충족을 위한 최소 서비스워커. 별도의 오프라인 캐싱 전략은
// 두지 않고 모든 요청을 네트워크로 그대로 통과시킨다.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
