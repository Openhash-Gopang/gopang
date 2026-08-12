/**
 * webrtc-realtime.js v2 — L1 PocketBase SSE 우선 + Supabase WS 폴백
 * startIncomingWatch(p2p-chat.js)에서 직접 L1 SSE를 사용하므로
 * 이 모듈은 webrtc.js _startSignalPoll의 폴백 Realtime용으로 유지.
 */

const L1_BASE = 'https://l1-hanlim.hondi.net';
// ★ 2026-08-12 — Supabase anon key 시크릿 유출 사고로 값 제거. 이 파일
// 자체 주석대로 주 경로(L1 PocketBase SSE, p2p-chat.js)는 이 값과 무관하게
// 계속 동작한다 — 여기서 비활성화되는 건 폴백 경로 하나뿐이다. Supabase
// Realtime(WebSocket)은 REST API와 프로토콜이 달라 단순 URL 치환으로
// PocketBase SSE와 못 바꾼다 — 폴백을 PocketBase SSE 폴링 재시도 등으로
// 재설계할지는 별도 판단 필요(TODO, 급하지 않음 — 주 경로가 이미 대체재).
const SB_WS  = '';
const SB_KEY = '';

let _active  = false;
let _cleanup = null;

export function isRealtimeActive() { return _active; }

export function startRealtimeSignal(myGuid, onSignal) {
  if (_cleanup) { _cleanup(); _cleanup = null; }
  if (!SB_WS || !SB_KEY) {
    console.warn('[Realtime WS] 폴백 비활성 — Supabase 시크릿 제거됨(주 경로는 L1 SSE, 정상 동작)');
    return () => {};
  }
  _cleanup = _startSupabaseWS(myGuid, onSignal); // Supabase WS만 사용 (SSE는 p2p-chat.js에서)
  return () => { if (_cleanup) { _cleanup(); _cleanup = null; } };
}

function _startSupabaseWS(myGuid, onSignal) {
  const ws = new WebSocket(`${SB_WS}?apikey=${SB_KEY}&vsn=1.0.0`);
  let hb = null, ref = 1;
  const send = (o) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

  ws.onopen = () => {
    send({
      topic: `realtime:public:webrtc_signals:to_guid=eq.${myGuid}`,
      event: 'phx_join',
      payload: {
        config: {
          broadcast: { self: false }, presence: { key: '' },
          postgres_changes: [{ event: 'INSERT', schema: 'public',
            table: 'webrtc_signals', filter: `to_guid=eq.${myGuid}` }],
        },
      },
      ref: String(ref++),
    });
    hb = setInterval(() =>
      send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref++) }), 30000);
  };

  ws.onmessage = ({ data }) => {
    let msg; try { msg = JSON.parse(data); } catch { return; }
    if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
      _active = true;
      console.info('[Realtime WS] Supabase 구독 확인 ✓');
    }
    if (msg.event === 'postgres_changes' || msg.event === 'INSERT') {
      const row = msg.payload?.data?.record ?? msg.payload?.record ?? null;
      if (row && row.to_guid === myGuid) {
        try { onSignal(row); } catch {}
      }
    }
  };

  ws.onerror = () => { _active = false; };
  ws.onclose = ({ code }) => {
    if (hb) { clearInterval(hb); hb = null; }
    _active = false;
    if (code !== 1000 && code !== 1001)
      setTimeout(() => { _cleanup = _startSupabaseWS(myGuid, onSignal); }, 5000);
  };

  return () => { if (hb) clearInterval(hb); ws.close(1000); _active = false; };
}
