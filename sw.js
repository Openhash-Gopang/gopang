// 고팡 Service Worker v1.1
// 캐시 전략: Cache First (정적 자산) + Network First (API)
const CACHE_NAME    = 'gopang-v2';
const CACHE_STATIC  = 'gopang-static-v2';
const CACHE_DYNAMIC = 'gopang-dynamic-v2';

// 앱 셸 — 반드시 캐시할 파일 목록
const APP_SHELL = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── 설치 ──────────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_STATIC).then((cache) => {
      console.log('[SW] 앱 셸 캐싱');
      return cache.addAll(APP_SHELL);
    })
    // ★ install 시 skipWaiting 제거 — message 핸들러로만 제어
    // (자동 skipWaiting은 배너 없이 강제 교체되어 사용자 혼란 유발)
  );
});

// ── 활성화 ────────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_STATIC && k !== CACHE_DYNAMIC)
          .map(k => {
            console.log('[SW] 구버전 캐시 삭제:', k);
            return caches.delete(k);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── SKIP_WAITING 메시지 수신 → 즉시 활성화 ───────────────────
// index.html의 _applyUpdate()가 이 메시지를 전송함
// → skipWaiting() → controllerchange → window.location.reload()
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING 수신 → skipWaiting 실행');
    self.skipWaiting();
  }
});

// ── fetch 인터셉트 ────────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // 외부 API 요청 (DeepSeek, OpenAI 등) → 인터셉트하지 않음
  if (!url.origin.includes('gopang.net') &&
      !url.origin.includes('localhost') &&
      !url.origin.includes('127.0.0.1')) {
    return;
  }

  // GET 요청 → Cache First
  if (request.method === 'GET') {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) return cached;
        return fetch(request).then((response) => {
          if (response && response.status === 200 &&
              response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_DYNAMIC).then((cache) => {
              cache.put(request, clone);
            });
          }
          return response;
        }).catch(() => {
          // 오프라인 시 index.html 반환
          if (request.destination === 'document') {
            return caches.match('/index.html');
          }
        });
      })
    );
  }
});

// ── 푸시 알림 ─────────────────────────────────────────────────
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
