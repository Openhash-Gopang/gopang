/**
 * webrtc-realtime.js v2 — L1 PocketBase SSE 우선 + Supabase WS 폴백
 * startIncomingWatch(p2p-chat.js)에서 직접 L1 SSE를 사용하므로
 * 이 모듈은 webrtc.js _startSignalPoll의 폴백 Realtime용으로 유지.
 */

const L1_BASE = 'https://l1-hanlim.gopang.net';
const SB_WS   = 'wss://ebbecjfrwaswbdybbgiu.supabase.co/realtime/v1/websocket';
const SB_KEY  = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

let _active  = false;
let _cleanup = null;

export function isRealtimeActive() { return _active; }

export function startRealtimeSignal(myGuid, onSignal) {
  if (_cleanup) { _cleanup(); _cleanup = null; }
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
