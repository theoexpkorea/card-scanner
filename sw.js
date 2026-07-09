const CACHE_NAME = 'card-app-v9';
const ASSETS = ['./', './index.html', './app.js?v=10', './manifest.json', './favicon.ico', './icons/icon-192.png', './icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  // 네트워크 우선, 실패 시 캐시 (앱 셸만 오프라인 지원, 저장 기능은 온라인 필요)
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
