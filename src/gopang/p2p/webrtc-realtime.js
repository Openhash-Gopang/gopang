/**
 * webrtc-realtime.js v2 — L1 PocketBase SSE 우선 + Supabase WebSocket 폴백
 *
 * 흐름:
 *   1. L1 PocketBase SSE 구독 시도
 *   2. 5초 내 응답 없거나 오류 → Supabase Realtime WebSocket으로 폴백
 *   3. 어느 쪽이든 시그널 수신 시 onSignal(row) 호출
 *   4. HTTP 폴링(_startSignalPoll)은 두 경로 모두 실패할 때만 동작
 */

const L1_BASE   = 'https://l1-hanlim.gopang.net';
const SB_WS     = 'wss://ebbecjfrwaswbdybbgiu.supabase.co/realtime/v1/websocket';
const SB_KEY    = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

let _active = false;   // 어느 경로든 Realtime 동작 중
let _cleanup = null;   // 현재 활성 구독 해제 함수

export function isRealtimeActive() { return _active; }

/**
 * Realtime 구독 시작 (L1 SSE 우선)
 * @param {string}   myGuid   - 내 GUID
 * @param {function} onSignal - fn(signalRow)
 * @returns {function} 구독 해제
 */
export function startRealtimeSignal(myGuid, onSignal) {
  if (_cleanup) { _cleanup(); _cleanup = null; }

  // L1 먼저 시도, 5초 타임아웃
  const l1Promise = _startL1SSE(myGuid, onSignal);
  const timeout   = new Promise((_, rej) => setTimeout(() => rej(new Error('L1 SSE timeout')), 5000));

  Promise.race([l1Promise, timeout])
    .then((unsubFn) => {
      _active  = true;
      _cleanup = unsubFn;
      console.info('[Realtime] L1 PocketBase SSE 구독 성공 ✓');
    })
    .catch((err) => {
      console.warn('[Realtime] L1 실패 → Supabase WS 폴백:', err.message);
      _cleanup = _startSupabaseWS(myGuid, onSignal);
    });

  return () => { if (_cleanup) { _cleanup(); _cleanup = null; } _active = false; };
}

// ── L1 PocketBase SSE ──────────────────────────────────────
function _startL1SSE(myGuid, onSignal) {
  return new Promise((resolve, reject) => {
    let clientId = null;
    let confirmed = false;

    // Step 1: SSE 스트림 연결
    const es = new EventSource(`${L1_BASE}/api/realtime`);

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);

        // 최초 연결 시 clientId 수신
        if (data.clientId && !clientId) {
          clientId = data.clientId;

          // Step 2: 구독 등록
          fetch(`${L1_BASE}/api/realtime`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({
              clientId,
              subscriptions: [`webrtc_signals/${myGuid}`],
            }),
          }).then(r => {
            if (r.ok && !confirmed) {
              confirmed = true;
              console.info('[L1 SSE] 구독 등록 완료, clientId:', clientId.slice(0, 8));
              resolve(() => es.close());
            }
          }).catch(reject);
          return;
        }

        // 실제 변경 이벤트 수신
        if (data.action === 'create' && data.record?.to_guid === myGuid) {
          console.debug('[L1 SSE] 시그널 수신:', data.record.type,
            '← from', (data.record.from_guid || '').slice(0, 8));
          try { onSignal(data.record); } catch {}
        }
      } catch {}
    };

    es.onerror = (e) => {
      if (!confirmed) { es.close(); reject(new Error('L1 SSE 연결 오류')); }
      else {
        // 연결 중 끊김 → 재연결
        console.warn('[L1 SSE] 재연결 중...');
        _active = false;
        setTimeout(() => startRealtimeSignal(myGuid, onSignal), 3000);
      }
    };
  });
}

// ── Supabase Realtime WebSocket (폴백) ─────────────────────
function _startSupabaseWS(myGuid, onSignal) {
  const ws = new WebSocket(`${SB_WS}?apikey=${SB_KEY}&vsn=1.0.0`);
  let hb = null, ref = 1;
  const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

  ws.onopen = () => {
    send({
      topic:   `realtime:public:webrtc_signals:to_guid=eq.${myGuid}`,
      event:   'phx_join',
      payload: {
        config: {
          broadcast: { self: false }, presence: { key: '' },
          postgres_changes: [{ event: 'INSERT', schema: 'public',
            table: 'webrtc_signals', filter: `to_guid=eq.${myGuid}` }],
        },
      },
      ref: String(ref++),
    });
    hb = setInterval(() => send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref++) }), 30000);
  };

  ws.onmessage = ({ data }) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
      _active = true;
      console.info('[Realtime] Supabase WS 구독 확인 ✓');
    }
    if (msg.event === 'postgres_changes' || msg.event === 'INSERT') {
      const row = msg.payload?.data?.record ?? msg.payload?.record ?? null;
      if (row && row.to_guid === myGuid) {
        console.debug('[Supabase WS] 시그널 수신:', row.type);
        try { onSignal(row); } catch {}
      }
    }
  };

  ws.onerror = () => { _active = false; console.warn('[Supabase WS] 오류'); };
  ws.onclose = ({ code }) => {
    if (hb) { clearInterval(hb); hb = null; }
    _active = false;
    if (code !== 1000 && code !== 1001)
      setTimeout(() => { _cleanup = _startSupabaseWS(myGuid, onSignal); }, 5000);
  };

  return () => { if (hb) clearInterval(hb); ws.close(1000, 'unsubscribe'); _active = false; };
}
