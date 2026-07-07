// ═══════════════════════════════════════════════════════════
// sw.js — 고팡 Service Worker v1.0
// PWA 오프라인 지원 + 캐시 전략
// ═══════════════════════════════════════════════════════════

const CACHE_NAME    = 'gopang-20260707-1816';
const CACHE_TIMEOUT = 5000; // 네트워크 타임아웃 5초

// 설치 시 사전 캐시할 핵심 파일
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/desktop.html',
  '/webapp.html',
  '/left-menu.html',
  '/right-menu.html',
  '/user-manual.html',
  '/terms-of-use.html',
  '/manifest.json',
  '/favicon.ico',

  // ── 디자인 시스템
  '/gopang-style.css',

  // ── GWP 레지스트리
  '/gwp-registry.js',

  // ── 고팡 JS 모듈
  '/src/pwa/gopang-pwa.js',
  // src/auth/gopang-auth.js: 2026-07-01(20e267b) 죽은 중복 인증파일로 삭제됨.
  // 이 목록에 남아있어도 Promise.allSettled+개별 catch 덕에 설치는 안 깨지지만
  // (콘솔에 "사전 캐시 실패" 경고만 남음), 실제 없는 파일이라 정리한다.
  // gopang-app.js: 자주 변경되므로 PRECACHE 제외 — Network First로 항상 최신 로드

  // ── 인증
  '/auth/gopang-sso.js',
  '/auth/subsystem-auth.js',

  // ── 아이콘
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

// ── 설치 ───────────────────────────────────────────────────
self.addEventListener('install', (event) => {
  console.log('[SW] 설치 중...');
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // addAll() 대신 파일별 개별 캐시 — 한 파일 실패가 전체에 영향 없음
      let ok = 0, fail = 0;
      await Promise.allSettled(
        PRECACHE_URLS.map(url =>
          cache.add(url)
            .then(() => { ok++; })
            .catch(err => {
              fail++;
              console.warn('[SW] 사전 캐시 실패 (무시):', url, '—', err.message);
            })
        )
      );
      console.log(`[SW] 사전 캐시 완료 — 성공: ${ok}, 실패: ${fail}`);
    }).then(() => {
      console.log('[SW] 설치 완료 — skipWaiting');
      return self.skipWaiting();
    })
  );
});

// ── 활성화 ─────────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  console.log('[SW] 활성화 — 이전 캐시 정리');
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => {
            console.log('[SW] 삭제:', key);
            return caches.delete(key);
          })
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch 전략: Network First + Cache Fallback ─────────────
self.addEventListener('fetch', (event) => {
  // ★ http/https 이외 스킴 제외 (chrome-extension://, data: 등)
  // Cache API는 http/https 스킴만 허용하므로 그 외는 즉시 반환
  if (!event.request.url.startsWith('http')) return;

  // 미디어 파일 캐시 안 함 (206 Partial Content 오류 방지)
  if (new URL(event.request.url).pathname.match(/\.(mp3|ogg|wav|mp4|webm)$/)) return;

  const url = new URL(event.request.url);

  // ── 외부 API 요청은 캐시 안 함 ──────────────────────────
  if (
    url.hostname.includes('supabase.co')     ||
    url.hostname.includes('workers.dev')     ||
    url.hostname.includes('deepseek.com')    ||
    url.hostname.includes('openai.com')      ||
    url.hostname.includes('kakao.com')       ||
    url.hostname.includes('googleapis.com')  ||
    url.hostname.includes('raw.githubusercontent.com')
  ) {
    return; // 기본 fetch 사용
  }

  // ── 고팡 자체 리소스: Network First ─────────────────────
  if (event.request.method !== 'GET') return;

  event.respondWith(
    (async () => {
      try {
        // 네트워크 우선 시도 (타임아웃 포함)
        // cache:'no-store' — 브라우저 HTTP 디스크 캐시까지 완전히 우회해야
        // GitHub Pages의 Cache-Control(max-age)에 의해 "네트워크 우선"이
        // 사실상 무력화되는 문제(구버전 파일이 계속 보이는 버그)를 막을 수 있다.
        const networkRes = await Promise.race([
          fetch(event.request.clone(), { cache: 'no-store' }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error('timeout')), CACHE_TIMEOUT)
          ),
        ]);

        // 성공 시 캐시 업데이트
        if (networkRes.ok) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, networkRes.clone());
        }
        return networkRes;

      } catch (err) {
        // 네트워크 실패 → 캐시 폴백
        const cached = await caches.match(event.request);
        if (cached) {
          console.log('[SW] 캐시 폴백:', url.pathname);
          return cached;
        }

        // 캐시도 없으면 오프라인 페이지
        if (event.request.mode === 'navigate') {
          const offlineCache = await caches.match('/index.html');
          if (offlineCache) return offlineCache;
        }

        return new Response('오프라인 상태입니다.', {
          status: 503,
          headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
      }
    })()
  );
});

// ── 메시지 수신 (skipWaiting 명령) ────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    console.log('[SW] SKIP_WAITING 수신 → 즉시 활성화');
    self.skipWaiting();
  }
});

// ── Push 알림 수신 ─────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { data = { title: '고팡', body: event.data?.text() || '새 메시지' }; }

  const title   = data.title || '고팡';
  const body    = data.body  || '새 메시지가 도착했습니다.';
  const sound   = data.sound || 'ping';
  const tag     = data.tag   || 'gopang-msg';
  const url     = data.url   || '/webapp.html';

  // PC가 AI 비서 Key를 전송한 경우(tag가 gopang-ai-setup-로 시작) — 열려있는
  // 모든 탭에 즉시 동기화 신호를 보낸다. 앱이 켜져 있으면 화면을 보고 있지
  // 않아도(채팅창이든 다른 화면이든) 즉시 PC 설정이 자동 적용된다.
  const isAiSetupSync   = tag.startsWith('gopang-ai-setup-');
  const isVersionUpdate = tag === 'gopang-version-update';

  // ── TEST: push 도착 즉시(클릭 대기 없이) 열려있는 모든 탭에 강제
  // 사운드 신호를 브로드캐스트한다 — 클릭 시점까지 기다리지 않고 도착
  // 시점에 바로 소리가 나는지 확인하기 위한 단순화된 테스트 경로.
  const _broadcastSound = clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    console.info('[TEST-SOUND] push 도착 — 열린 탭', list.length, '개에 브로드캐스트');
    for (const client of list) {
      client.postMessage({ type: 'PLAY_SOUND', sound: 'ping' });
    }
  });

  event.waitUntil(
    Promise.all([
      self.registration.showNotification(title, {
        body,
        icon:  '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag,
        data:  { url, sound },
        vibrate: [200, 100, 200],
      }),
      _broadcastSound,
      (isAiSetupSync || isVersionUpdate)
        ? clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
            for (const client of list) {
              client.postMessage({ type: isVersionUpdate ? 'CHECK_FOR_UPDATE' : 'SYNC_AI_SETTING' });
            }
          })
        : Promise.resolve(),
    ])
  );
});

// ── 알림 클릭 → 앱 열기 + 소리 재생 ──────────────────────
// 버그: 탭이 닫혀 있어 새 창을 열어야 하는 경우, clients.openWindow()가
// resolve된 직후 postMessage를 보내면 새 페이지의 JS(gopang-app.js)가
// 아직 로드·리스너 등록 전이라 메시지가 받는 사람 없이 사라진다(경쟁 상태).
// → 새 창 케이스는 URL 쿼리 파라미터로 사운드 정보를 실어 보내, 페이지가
//    로드되자마자(리스너 등록을 기다릴 필요 없이) 직접 읽어 재생하게 한다.
// 이미 열려있는 창(focus만 하면 되는 경우)은 리스너가 이미 살아있으므로
// 기존 postMessage 방식 그대로 둔다.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url   = event.notification.data?.url   || '/webapp.html';
  const sound = event.notification.data?.sound || 'ping';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      // 이미 열린 창이 있으면 포커스 + postMessage (리스너가 이미 살아있음)
      for (const client of list) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'PLAY_SOUND', sound });
          return client.focus();
        }
      }
      // 없으면 새 창 — postMessage 대신 URL 파라미터로 전달(경쟁 상태 회피)
      const sep = url.includes('?') ? '&' : '?';
      return clients.openWindow(url + sep + 'playSound=' + encodeURIComponent(sound));
    })
  );
});

// ── Push 구독 변경 감지 ────────────────────────────────────
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    self.registration.pushManager.subscribe({ userVisibleOnly: true })
      .then(sub => {
        // 새 구독을 서버에 재등록
        return fetch('https://hondi-proxy.tensor-city.workers.dev/push/subscribe', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ subscription: sub }),
        });
      })
  );
});
