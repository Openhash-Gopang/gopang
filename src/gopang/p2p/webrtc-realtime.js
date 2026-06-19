/**
 * webrtc-realtime.js — Supabase Realtime WebSocket 기반 시그널 구독
 *
 * 용도: _startSignalPoll() 의 HTTP 폴링을 WebSocket Push 로 대체.
 *   상대방이 offer/answer/ICE 를 전송하는 즉시(<1초) 수신.
 *   WebSocket 연결 실패 시 기존 HTTP 폴링이 폴백으로 계속 동작.
 *
 * 사용법 (webrtc.js _startSignalPoll 함수 body 상단에 추가):
 *   import { startRealtimeSignal } from './webrtc-realtime.js';
 *   startRealtimeSignal(myGuid, (signal) => _handleIncomingSignal(signal));
 */

const _SB_URL_RT  = 'wss://ebbecjfrwaswbdybbgiu.supabase.co/realtime/v1/websocket';
const _SB_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

let _ws             = null;
let _realtimeActive = false;
let _heartbeat      = null;
let _ref            = 1;

/** Realtime 이 정상 동작 중인지 (폴링 폴백 판단용) */
export function isRealtimeActive() { return _realtimeActive; }

/**
 * Supabase Realtime 구독 시작.
 * @param {string}   myGuid   - 내 GUID (to_guid 필터)
 * @param {function} onSignal - 시그널 도착 시 호출될 콜백 fn(row)
 * @returns {function}        - 구독 해제 함수
 */
export function startRealtimeSignal(myGuid, onSignal) {
  _close();

  const ws = new WebSocket(`${_SB_URL_RT}?apikey=${_SB_API_KEY}&vsn=1.0.0`);
  _ws = ws;

  const _send = (obj) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj));
  };

  ws.onopen = () => {
    console.info('[Realtime] 연결 ─ webrtc_signals 구독 시작');

    // Supabase Realtime Phoenix 채널 JOIN
    _send({
      topic: `realtime:public:webrtc_signals:to_guid=eq.${myGuid}`,
      event: 'phx_join',
      payload: {
        config: {
          broadcast:        { self: false },
          presence:         { key: '' },
          postgres_changes: [{
            event:  'INSERT',
            schema: 'public',
            table:  'webrtc_signals',
            filter: `to_guid=eq.${myGuid}`,
          }],
        },
      },
      ref: String(_ref++),
    });

    // 30초 Heartbeat (Supabase 서버가 60초 무응답 시 연결 끊음)
    _heartbeat = setInterval(() => {
      _send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(_ref++) });
    }, 30_000);
  };

  ws.onmessage = ({ data }) => {
    let msg;
    try { msg = JSON.parse(data); } catch { return; }

    const ev = msg.event;

    // ① postgres_changes INSERT — 새 시그널 row 수신
    if (ev === 'postgres_changes' || ev === 'INSERT') {
      const row = msg.payload?.data?.record
               ?? msg.payload?.record
               ?? null;
      if (row && row.to_guid === myGuid) {
        _realtimeActive = true;
        console.debug('[Realtime] 시그널 수신:', row.type,
          '← from', (row.from_guid || '').slice(0, 8));
        try { onSignal(row); } catch (e) {
          console.warn('[Realtime] onSignal 오류:', e.message);
        }
      }
    }

    // ② phx_reply ok — 구독 확인
    if (ev === 'phx_reply' && msg.payload?.status === 'ok') {
      _realtimeActive = true;
      console.info('[Realtime] 구독 확인 완료 ✓ — HTTP 폴링은 폴백 전용');
    }

    // ③ phx_error — 채널 오류 (재구독 트리거)
    if (ev === 'phx_error') {
      console.warn('[Realtime] 채널 오류 — 재구독 시도');
      _realtimeActive = false;
    }
  };

  ws.onerror = () => {
    console.warn('[Realtime] WebSocket 오류 — HTTP 폴링 폴백 유지');
    _realtimeActive = false;
  };

  ws.onclose = ({ code }) => {
    _clearHeartbeat();
    _realtimeActive = false;
    if (code !== 1000 && code !== 1001) {
      // 비정상 종료 → 5초 후 재연결
      console.info('[Realtime] 재연결 예약 (5초)...');
      setTimeout(() => startRealtimeSignal(myGuid, onSignal), 5_000);
    }
  };

  return _close; // 반환값으로 구독 해제 가능
}

function _close() {
  _clearHeartbeat();
  if (_ws) { _ws.close(1000, 'unsubscribe'); _ws = null; }
  _realtimeActive = false;
}

function _clearHeartbeat() {
  if (_heartbeat) { clearInterval(_heartbeat); _heartbeat = null; }
}
