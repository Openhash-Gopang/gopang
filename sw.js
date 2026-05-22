// ── 고팡 Service Worker v1.0 ────────────────────────────
// 캐시 전략: Cache First (정적 자산) + Network First (API)

const CACHE_NAME    = 'gopang-v2';
const CACHE_STATIC  = 'gopang-static-v2';
const CACHE_DYNAMIC = 'gopang-dynamic-v2';

// 앱 셸 — 최초 설치 시 캐시할 파일 목록
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── 설치 ────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      console.log('[SW] 앱 셸 캐싱');
      return cache.addAll(APP_SHELL);
    }).then(() => self.skipWaiting())
  );
});

// ── 활성화 ───────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => {
            console.log('[SW] 오래된 캐시 삭제:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── fetch 인터셉트 ────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 외부 API 요청 (DeepSeek, OpenAI 등) → 항상 네트워크
  if (!url.origin.includes('gopang.net') &&
      !url.origin.includes('localhost') &&
      !url.origin.includes('127.0.0.1')) {
    return;   // 인터셉트하지 않음
  }

  // GitHub Pages 정적 자산 → Cache First
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          // 성공 응답만 캐시
          if (response && response.status === 200 &&
              response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_DYNAMIC).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        }).catch(() => {
          // 오프라인 폴백 — index.html 반환
          if (request.destination === 'document') {
            return caches.match('/index.html');
          }
        });
      })
    );
  }
});

// ── 푸시 알림 (향후 확장) ────────────────────────────────
self.addEventListener('push', (event) => {
  const data = event.data?.json() ?? {};
  event.waitUntil(
    self.registration.showNotification(data.title || '고팡 알림', {
      body:    data.body  || '',
      icon:    '/icons/icon-192.png',
      badge:   '/icons/icon-192.png',
      vibrate: [200, 100, 200],
      data:    data.url ? { url: data.url } : {},
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  if (event.notification.data?.url) {
    event.waitUntil(clients.openWindow(event.notification.data.url));
  }
});
