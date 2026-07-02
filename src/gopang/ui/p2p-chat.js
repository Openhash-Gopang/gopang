/**
 * ui/p2p.js — WebRTC P2P 채팅 모듈 (GDUDA Phase 1)
 * - CF Worker /signal/* 경유 시그널링 (SDP/ICE 60초 TTL)
 * - 메시지 본문은 서버 저장 없음 — 순수 P2P
 * - from/to 모두 handle 기준 (전세계 유일)
 */
import {
  PROXY, L1_SIGNAL_BASE, L1_PDV_URL, L1_ANCHOR_URL, L1_URL, RTC_CONFIG, _USER,
  setRtcConn, setRtcChannel, setSignalPoll,
  _rtcConn, _rtcChannel, _signalPoll,
} from '../core/state.js';

// ── 탈중앙화 이관 ③: 시그널링 전송/수신/삭제를 L1 직접으로 ──────────────
// Worker가 이미 L1 webrtc_signals 컬렉션을 직접 쓰는 구조이므로,
// 단말도 같은 경로로 직접 접근. Worker 경유 불필요.
const _L1_SIGNAL = L1_SIGNAL_BASE;

async function _signalSendDirect(from_guid, to_guid, type, payload) {
  const expires_at = new Date(Date.now() + 60_000).toISOString();
  const res = await fetch(_L1_SIGNAL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from_guid, to_guid, type, payload, expires_at }),
  });
  if (!res.ok) throw new Error(`L1 signal send ${res.status}`);
}

async function _signalPollDirect(guid) {
  const now    = new Date().toISOString();
  const filter = encodeURIComponent(`to_guid='${guid}' && expires_at>'${now}'`);
  const res    = await fetch(`${_L1_SIGNAL}?filter=${filter}&sort=created&perPage=50`);
  if (!res.ok) throw new Error(`L1 signal poll ${res.status}`);
  const data = await res.json();
  return (data.items || []).map(r => ({
    from_guid: r.from_guid,
    to_guid:   r.to_guid,
    type:      r.type,
    payload:   r.payload,
    id:        r.id,
  }));
}

async function _signalDeleteDirect(id) {
  if (!id) return;
  await fetch(`${_L1_SIGNAL}/${id}`, { method: 'DELETE' }).catch(() => {});
}

// ── L1 PocketBase 자체 Realtime(SSE) 구독 — Supabase WS 대체 ──────────
// 2026-06-28: ERR_INCOMPLETE_CHUNKED_ENCODING 때문에 Supabase Realtime
// WebSocket으로 임시 우회했던 기록이 있었으나, 실제로 서버(nginx
// proxy_buffering off + PocketBase 자체)에서 curl로 직접 확인한 결과
// SSE가 정상 동작했다(PB_CONNECT까지 정상 수신). 즉 막혔던 원인은 이미
// 해결돼 있었고 클라이언트만 옛 방식(Supabase)에 남아있던 상태였다.
// 이걸로 교체하면 "쓰기는 L1, 구독은 제3자"인 반쪽 이관 상태가 끝나고,
// 오픈해시 탈중앙화 방향(Supabase 점진적 축소)과도 맞는다.
//
// PocketBase Realtime 프로토콜: SSE로 접속하면 먼저 PB_CONNECT 이벤트로
// clientId를 받고, 그 clientId로 POST /api/realtime { clientId, subscriptions }
// 해야 실제 구독이 시작된다. 이후 구독한 컬렉션명과 같은 이름의 이벤트로
// { action: 'create'|'update'|'delete', record } 가 들어온다.
// ※ PocketBase 구독은 Supabase의 postgres_changes filter처럼 서버에서
//   to_guid로 걸러주지 않는다 — 컬렉션 전체 변경을 받고 클라이언트에서
//   to_guid로 걸러야 한다(REST 폴링도 원래 그렇게 하고 있었으니 동일 신뢰모델).
const _L1_BASE = 'https://l1-hanlim.hondi.net';

function _watchL1Realtime(myGuid, onRow) {
  let es = null, retryTimer = null, closed = false;

  function _connect() {
    es = new EventSource(`${_L1_BASE}/api/realtime`);

    es.addEventListener('PB_CONNECT', async (e) => {
      try {
        const { clientId } = JSON.parse(e.data);
        await fetch(`${_L1_BASE}/api/realtime`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ clientId, subscriptions: ['webrtc_signals'] }),
        });
        console.info('[P2P L1Realtime] 구독 완료 (대기 중)');
      } catch (e) {
        console.warn('[P2P L1Realtime] 구독 요청 실패:', e.message);
      }
    });

    es.addEventListener('webrtc_signals', (e) => {
      let msg; try { msg = JSON.parse(e.data); } catch { return; }
      const row = msg?.record;
      if (!row || row.to_guid !== myGuid) return;
      onRow(row);
    });

    es.onerror = () => {
      if (closed) return;
      es.close();
      // 짧은 대기 후 재연결 — 폴백 폴링이 그동안 메워준다
      retryTimer = setTimeout(_connect, 3000);
    };
  }

  _connect();

  return function _stopL1Realtime() {
    closed = true;
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    if (es) { es.close(); es = null; }
  };
}

let _chatOverlay  = null;
let _peerInfo     = null;  // { guid, handle, nickname }
let _pollInterval = null;
let _p2pMessages  = [];    // P2P 대화 원문 누적 (PDV 저장용)
let _sessionStart = null;  // 세션 시작 시각
let _activeCallId = null;  // 현재 유효한 통화 시도 ID — 재연결 시 이전 watcher 자동 무력화
const _seenOfferIds = new Set();  // 처리한 offer callId — 중복 confirm() 방지

// ── handle로 즉시 초대 (발신측) ──────────────────────────
// 그림자 AI가 [P2P_INVITE: handle=@xxx] 태그를 출력했을 때 호출됨.
// 모호한 이름(예: "김동")은 이 함수를 쓰지 않고 [SEARCH]로 먼저 후보를 보여준 뒤,
// 사용자가 정확한 handle을 확인한 경우에만 이 함수로 즉시 연결한다.
export async function inviteByHandle(handle) {
  const clean = String(handle || '').replace(/^@/, '').trim();
  if (!clean) throw new Error('handle 누락');
  const filter = encodeURIComponent(`handle='${clean}'`);
  const res = await fetch(`${L1_URL}?filter=${filter}&perPage=1`);
  if (!res.ok) throw new Error('프로필 조회 실패');
  const raw = await res.json();
  const u = raw.items?.[0];
  if (!u) throw new Error(`@${clean} 사용자를 찾을 수 없습니다`);
  const targetUser = {
    guid: u.guid, handle: u.handle, nickname: u.nickname,
    region: u.region, country_code: u.country_code, current_l1: u.current_l1,
  };
  await startP2PCall(targetUser);
  return targetUser;
}

// ── P2P 통화 시작 (발신측) ───────────────────────────────
export async function startP2PCall(targetUser) {
  // 이전 시도(재연결 등)가 정리되지 않고 남아있으면 먼저 로컬 정리.
  // (이전 watcher는 _activeCallId가 바뀌는 즉시 스스로 종료됨 — 아래 참고)
  if (_rtcConn || _rtcChannel) {
    try { _rtcChannel?.close(); } catch {}
    try { _rtcConn?.close(); } catch {}
    setRtcChannel(null);
    setRtcConn(null);
  }

  // 통화 시도마다 고유 ID — 재연결 시 이전/새 시도를 구분하는 핵심 키
  const callId = (crypto.randomUUID
    ? crypto.randomUUID()
    : `call-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  _activeCallId = callId;

  _peerInfo     = targetUser;
  _p2pMessages  = [];
  _sessionStart = new Date().toISOString();
  _openChatUI(targetUser, 'calling');

  const conn    = new RTCPeerConnection(RTC_CONFIG);
  const channel = conn.createDataChannel('chat', { ordered: true });
  setRtcConn(conn);
  setRtcChannel(channel);

  _setupChannel(channel);
  _setupConn(conn, targetUser, callId);

  // SDP offer 생성
  const offer = await conn.createOffer();
  await conn.setLocalDescription(offer);

  // ICE 수집 완료 대기 (최대 2초)
  await _waitForIce(conn);

  // offer 전송 (callId 포함 — 재연결 시 이전/이후 시도 구분용)
  await _signalSend({
    from_guid: _USER.ipv6,
    to_guid:   targetUser.guid,
    type:      'offer',
    payload:   { sdp: conn.localDescription, from_handle: _USER.handle, callId },
  });

  _appendMsg('system', `📞 ${targetUser.nickname || targetUser.handle}님께 연결 요청을 보냈습니다...`);

  // answer/ICE 수신 — L1 PocketBase Realtime (폴링 폴백 포함)
  _watchAnswerRealtime(conn, targetUser.guid, callId);
}

// ── answer/ICE 실시간 수신 (발신측) ─────────────────────
function _watchAnswerRealtime(conn, peerGuid, callId) {
  const myGuid = _USER.ipv6;

  let done = false, stopRealtime = null;
  // realtime과 폴백 폴링이 거의 동시에 같은 신호를 집어올 수 있어서(특히
  // realtime이 막 켜진 순간), wsOk 같은 거친 on/off 플래그로는 둘 다 같은
  // answer/ICE를 따로 처리하는 경쟁이 생긴다(같은 answer를 두 번
  // setRemoteDescription하려다 두 번째가 "wrong state: stable"로 실패,
  // 같은 ICE가 순서 뒤바뀌어 처리되는 등 — 2026-06-28 실제로 관찰됨).
  // Supabase 시절엔 wsOk가 사실상 영원히 false였어서 이 경쟁이 드러난 적이
  // 없었을 뿐, 원래부터 있던 설계 결함이었다. 신호 id 단위로 한 번만
  // 처리되게 하여 어느 경로가 먼저 잡든 안전하게 만든다.
  const _seenSignalIds = new Set();

  // 더 새로운 통화 시도가 시작되면 이 watcher는 즉시 폐기
  function _stale() { return _activeCallId !== callId; }

  function _close() {
    done = true;
    if (stopRealtime) { stopRealtime(); stopRealtime = null; }
    _stopPoll();
  }

  async function _handleSignalRow(row) {
    if (done) return;
    if (_stale()) { console.info('[P2P] 오래된 통화 시도 — watcher 종료'); _close(); return; }
    if (_seenSignalIds.has(row.id)) return;  // 이미 처리한 신호 — realtime/폴링 중복 방지
    _seenSignalIds.add(row.id);

    const _rowPayload = typeof row.payload === 'string'
      ? JSON.parse(row.payload) : (row.payload || {});

    // callId가 있는데 이 시도와 다르면 — 다른(이전/이후) 통화 시도의 시그널이므로 무시
    if (_rowPayload.callId && _rowPayload.callId !== callId) return;

    if (row.type === 'answer' && row.from_guid === peerGuid) {
      try {
        const answerSdp = _rowPayload.sdp || _rowPayload;
        await conn.setRemoteDescription(new RTCSessionDescription(answerSdp));
        _appendMsg('system', '✅ 연결됐습니다. 채널이 열리면 메시지를 입력하세요.');
        console.info('[P2P] answer 수신 완료');
        // answer 수신 후 잠시 뒤 watcher 종료 (ICE는 ondatachannel onopen 후 불필요)
        setTimeout(_close, 10000);
      } catch(e) { console.warn('[P2P] answer setRemoteDescription 실패:', e.message); }
    }

    if (row.type === 'ice' && row.from_guid === peerGuid) {
      try {
        const candidate = _rowPayload.candidate || _rowPayload;
        await conn.addIceCandidate(new RTCIceCandidate(candidate));
      } catch(e) { console.warn('[P2P] ICE 추가 실패:', e.message); }
    }

    // 처리 후 시그널 삭제 — 중복 호출돼도(이미 지워졌으면) 404는 무해하므로 무시
    _signalDeleteDirect(row.id);
  }

  // L1 PocketBase Realtime(SSE)으로 answer/ICE 수신
  stopRealtime = _watchL1Realtime(myGuid, _handleSignalRow);

  // 폴백: realtime이 못 잡은 신호를 1.5초 폴링으로 보완(같은 핸들러 재사용 —
  // _seenSignalIds가 있어서 realtime이 이미 처리한 신호는 자동으로 건너뜀).
  // autoDelete:false — _handleSignalRow가 이미 자기 책임으로 지우므로,
  // _startPoll이 또 지우려다 404(이미 없음)가 나는 걸 막는다.
  _startPoll(myGuid, _handleSignalRow, { autoDelete: false });
}

// ── P2P 수신측 처리 ──────────────────────────────────────
export async function handleIncomingOffer(signal) {
  const fromHandle  = signal.payload?.from_handle || signal.from_guid;
  const fromGuid    = signal.from_guid;

  // payload 방어적 파싱 (webrtc.js/p2p-chat.js 양쪽 호환) — callId 추출용으로 먼저 파싱
  const _offerPayload = typeof signal.payload === 'string'
    ? JSON.parse(signal.payload) : (signal.payload || {});
  const callId = _offerPayload.callId || null;

  // 같은 callId의 offer가 중복 도착(재시도/레이스 컨디션)하면 두 번째부터는 무시
  if (callId) {
    if (_seenOfferIds.has(callId)) {
      console.info('[P2P] 중복 offer 무시 (callId 이미 처리됨):', callId);
      return;
    }
    _seenOfferIds.add(callId);
    if (_seenOfferIds.size > 50) {
      _seenOfferIds.delete(_seenOfferIds.values().next().value);
    }
  }

  // ── 활성 상태 알림음 — <audio> 자동재생 대신 시스템 알림 사용 ──────
  // <audio>.play()는 사용자 동작과 같은 호출 스택 안에서 일어나야만
  // 허용되는 것으로 확인됨(탭으로 미리 풀어둬도 효과 없음, 콘솔 로그로
  // 검증 — play() Promise가 사용자가 모달의 "확인"을 누르기 전까지
  // pending 상태로 멈춰있다가 그 순간에야 resolve됨). 페이지 오디오
  // 자동재생 정책이 아니라 알림 권한 체계를 타는 showNotification()을
  // 쓰면 이 제약을 받지 않는다 — 닫힌 상태(push)에서 쓰던 것과 동일한
  // 메커니즘을 활성 상태에서도 그대로 사용.
  console.info('[TEST-SOUND] handleIncomingOffer 진입 — 시스템 알림으로 재생 시도');
  try { if (navigator.vibrate) navigator.vibrate([300, 100, 300]); }
  catch (e) { console.warn('[TEST-SOUND] vibrate 실패:', e.message); }
  try {
    if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification('혼디', {
        body: `${fromHandle}님이 대화를 요청했습니다`,
        icon: '/icons/icon-192.png',
        tag:  'gopang-incoming-call',
        vibrate: [300, 100, 300],
        silent: false,
      });
      console.info('[TEST-SOUND] showNotification 호출 성공');
    } else {
      console.warn('[TEST-SOUND] 알림 권한 없음(permission:', Notification.permission, ') — showNotification 건너뜀');
    }
  } catch (e) { console.warn('[TEST-SOUND] showNotification 실패:', e.message); }

  // 수락 확인 — confirm()은 메인 스레드를 동기적으로 막기 때문에 막지
  // 않는 커스텀 모달을 사용한다.
  const accepted = await _showIncomingCallModal(fromHandle);
  if (!accepted) return;

  _peerInfo = { guid: fromGuid, handle: fromHandle, nickname: fromHandle };
  _openChatUI(_peerInfo, 'answering');

  const conn = new RTCPeerConnection(RTC_CONFIG);
  setRtcConn(conn);

  // DataChannel 수신
  conn.ondatachannel = e => {
    const channel = e.channel;
    setRtcChannel(channel);
    _setupChannel(channel);
  };

  _setupConn(conn, _peerInfo, callId);

  // SDP answer 생성
  const _offerSdp = _offerPayload.sdp || _offerPayload;
  await conn.setRemoteDescription(new RTCSessionDescription(_offerSdp));
  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);
  await _waitForIce(conn);

  // answer 전송 (callId 포함 — 발신측이 어느 시도에 대한 answer인지 구분)
  await _signalSend({
    from_guid: _USER.ipv6,
    to_guid:   fromGuid,
    type:      'answer',
    payload:   { sdp: conn.localDescription, from_handle: _USER.handle, callId },
  });

  _appendMsg('system', `✅ ${fromHandle}님과 연결됐습니다.`);

  // ICE 폴링
  _startPoll(_USER.ipv6, async sig => {
    if (sig.type === 'ice' && sig.from_guid === fromGuid) {
      const _p = typeof sig.payload === 'string'
        ? JSON.parse(sig.payload) : (sig.payload || {});
      await conn.addIceCandidate(new RTCIceCandidate(_p.candidate || _p)).catch(() => {});
    }
  });
}

// ── RTCPeerConnection 공통 설정 ───────────────────────────
function _setupConn(conn, peer, callId) {
  conn.onicecandidate = async e => {
    if (!e.candidate) return;
    await _signalSend({
      from_guid: _USER.ipv6,
      to_guid:   peer.guid,
      type:      'ice',
      payload:   { candidate: e.candidate, callId },
    });
  };

  conn.onconnectionstatechange = () => {
    const state = conn.connectionState;
    console.info('[P2P] 연결 상태:', state);
    if (state === 'connected') {
      _appendMsg('system', '🔒 암호화 채널 개설됨.');
      _stopPoll();
    }
    if (state === 'disconnected' || state === 'failed' || state === 'closed') {
      _appendMsg('system', '🔴 연결이 끊어졌습니다.');
      _stopPoll();
    }
  };
}

// ── DataChannel 공통 설정 ─────────────────────────────────
function _setupChannel(channel) {
  channel.onopen = () => {
    _appendMsg('system', '💬 채팅 채널 열림. 메시지를 입력하세요.');
    const input = document.getElementById('_p2p-input');
    if (input) input.disabled = false;
  };

  channel.onmessage = e => {
    try {
      const msg = JSON.parse(e.data);
      if (msg.type === 'bye') {
        _appendMsg('system', '🔴 상대방이 대화를 종료했습니다.');
        // James 쪽도 PDV 저장 후 종료
        if (_p2pMessages.length > 0 && _peerInfo) {
          _saveP2PSession(_p2pMessages, _peerInfo, _sessionStart)
            .catch(e => console.warn('[P2P] PDV 저장 실패:', e.message));
        }
        setTimeout(() => _closeP2P(), 1500);
        return;
      }
      _appendMsg('peer', msg.text, msg.ts);
    } catch {
      _appendMsg('peer', e.data);
    }
  };

  channel.onclose = () => {
    _appendMsg('system', '채널이 닫혔습니다.');
  };
}

// ── ICE 수집 완료 대기 ────────────────────────────────────
function _waitForIce(conn, timeout = 2000) {
  return new Promise(resolve => {
    if (conn.iceGatheringState === 'complete') { resolve(); return; }
    const done = () => { conn.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (conn.iceGatheringState === 'complete') done(); };
    conn.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeout);
  });
}

// ── 시그널 전송 ③: L1 직접 (2026-06-23 이관) ──────────────
async function _signalSend(body) {
  // 이전: PROXY /signal/send → Worker → L1
  // 이후: L1 직접 (Worker 경유 없음)
  await _signalSendDirect(body.from_guid, body.to_guid, body.type, body.payload);
}

// ── 시그널 폴링 ───────────────────────────────────────────
function _startPoll(myGuid, handler, { autoDelete = true } = {}) {
  _stopPoll();
  _pollInterval = setInterval(async () => {
    try {
      const signals = await _signalPollDirect(myGuid);
      for (const sig of signals) {
        await handler(sig);
        // 처리 후 삭제 — L1 직접 DELETE. autoDelete=false면 handler가
        // 이미 자기 책임으로 지웠다는 뜻(_handleSignalRow 등) — 중복 DELETE로
        // 404가 또 나는 걸 막기 위해 여기서는 건너뛴다.
        if (autoDelete) await _signalDeleteDirect(sig.id);
      }
    } catch(e) { console.warn('[P2P] 폴링 오류:', e.message); }
  }, 1500);
}

function _stopPoll() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}

// ── 채팅 UI ───────────────────────────────────────────────
// 막지 않는(non-blocking) 연결 요청 확인 모달 — confirm()을 대체한다.
// confirm()은 메인 스레드를 동기적으로 막아 그 직전에 시작한 오디오
// 재생이 다이얼로그가 닫힐 때까지 들리지 않는 문제가 있었다(p2p-chat.js
// handleIncomingOffer 호출부 주석 참고).
function _showIncomingCallModal(fromHandle) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed;inset:0;z-index:9998',
      'background:rgba(0,0,0,0.4)',
      'display:flex;align-items:center;justify-content:center',
    ].join(';');

    overlay.innerHTML = `
      <div style="background:#fff;border-radius:16px;padding:24px;
                  width:min(320px,85vw);text-align:center;
                  box-shadow:0 10px 30px rgba(0,0,0,0.2)">
        <div style="font-size:32px;margin-bottom:8px">📞</div>
        <div style="font-size:16px;font-weight:600;color:#111827;margin-bottom:4px">
          ${fromHandle}님의 연결 요청
        </div>
        <div style="font-size:13px;color:#6b7280;margin-bottom:20px">
          수락하시겠습니까?
        </div>
        <div style="display:flex;gap:8px">
          <button id="_p2p-decline"
            style="flex:1;padding:11px;border:none;border-radius:10px;
                   background:#f3f4f6;color:#374151;font-size:14px;
                   font-weight:600;cursor:pointer;font-family:inherit">거절</button>
          <button id="_p2p-accept"
            style="flex:1;padding:11px;border:none;border-radius:10px;
                   background:#1A73E8;color:#fff;font-size:14px;
                   font-weight:600;cursor:pointer;font-family:inherit">수락</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    const cleanup = (result) => { overlay.remove(); resolve(result); };
    overlay.querySelector('#_p2p-accept').onclick  = () => cleanup(true);
    overlay.querySelector('#_p2p-decline').onclick = () => cleanup(false);
  });
}

function _openChatUI(peer, mode) {
  if (_chatOverlay) _chatOverlay.remove();

  const overlay = document.createElement('div');
  overlay.id = '_p2p-overlay';
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:9997',
    'background:#fff',
    'display:flex;flex-direction:column',
  ].join(';');

  overlay.innerHTML = `
    <!-- 헤더 -->
    <div style="display:flex;align-items:center;padding:14px 16px;
                border-bottom:1px solid #f0f0f0;background:#fff;flex-shrink:0">
      <button id="_p2p-back"
        style="border:none;background:none;font-size:20px;cursor:pointer;
               color:#6b7280;margin-right:10px">←</button>
      <div style="flex:1">
        <div style="font-size:15px;font-weight:600;color:#111827">
          ${peer.nickname || peer.handle}
        </div>
        <div style="font-size:11px;color:#9ca3af">${peer.handle}</div>
      </div>
      <div id="_p2p-status"
        style="font-size:12px;color:#9ca3af">
        ${mode === 'calling' ? '연결 중...' : '수락됨'}
      </div>
      <button id="_p2p-leave"
        style="border:none;background:#fee2e2;color:#dc2626;
               font-size:12px;font-weight:600;padding:6px 12px;
               border-radius:8px;cursor:pointer;margin-left:8px;
               font-family:inherit">나가기</button>
    </div>

    <!-- 메시지 목록 -->
    <div id="_p2p-messages"
      style="flex:1;overflow-y:auto;padding:16px;
             display:flex;flex-direction:column;gap:8px;
             background:#f9fafb">
    </div>

    <!-- 입력창 -->
    <div style="display:flex;align-items:center;padding:10px 12px;
                border-top:1px solid #f0f0f0;background:#fff;flex-shrink:0;gap:8px">
      <input id="_p2p-input" type="text"
        placeholder="메시지 입력..."
        disabled
        style="flex:1;padding:10px 14px;border:1px solid #e5e7eb;
               border-radius:20px;font-size:14px;font-family:inherit;
               outline:none;background:#f9fafb;color:#111827"/>
      <button id="_p2p-send"
        style="width:40px;height:40px;border:none;border-radius:50%;
               background:#1A73E8;color:#fff;font-size:18px;
               cursor:pointer;flex-shrink:0;display:flex;
               align-items:center;justify-content:center">
        ➤
      </button>
    </div>`;

  document.body.appendChild(overlay);
  _chatOverlay = overlay;

  // 뒤로가기 (← 버튼)
  document.getElementById('_p2p-back').onclick = () => {
    if (confirm('채팅을 종료하시겠습니까?')) _closeP2P();
  };

  // 나가기 버튼
  document.getElementById('_p2p-leave').onclick = () => {
    if (confirm('대화방에서 나가시겠습니까?\n대화 내용이 PDV에 저장됩니다.')) _closeP2P();
  };

  // 메시지 전송
  const input   = document.getElementById('_p2p-input');
  const sendBtn = document.getElementById('_p2p-send');

  const _send = () => {
    const text = input.value.trim();
    if (!text || !_rtcChannel || _rtcChannel.readyState !== 'open') return;
    const msg = { text, ts: new Date().toISOString() };
    _rtcChannel.send(JSON.stringify(msg));
    _appendMsg('me', text);
    input.value = '';
  };

  sendBtn.onclick = _send;
  input.addEventListener('keydown', e => { if (e.key === 'Enter') _send(); });
}

// ── 메시지 추가 ───────────────────────────────────────────
function _appendMsg(role, text, ts) {
  const el = document.getElementById('_p2p-messages');
  if (!el) return;

  // PDV 저장용 메시지 누적 (system 메시지 제외)
  if (role !== 'system') {
    _p2pMessages.push({
      role,
      content: text,
      ts: ts || new Date().toISOString(),
    });
  }

  const time = ts ? new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }) : '';

  if (role === 'system') {
    el.innerHTML += `
      <div style="text-align:center;font-size:12px;color:#9ca3af;padding:4px 0">
        ${text}
      </div>`;
  } else if (role === 'me') {
    el.innerHTML += `
      <div style="display:flex;justify-content:flex-end;align-items:flex-end;gap:6px">
        <span style="font-size:10px;color:#9ca3af">${time}</span>
        <div style="background:#1A73E8;color:#fff;padding:8px 12px;
                    border-radius:16px 16px 4px 16px;max-width:70%;
                    font-size:14px;line-height:1.4;word-break:break-word">
          ${_esc(text)}
        </div>
      </div>`;
  } else {
    el.innerHTML += `
      <div style="display:flex;justify-content:flex-start;align-items:flex-end;gap:6px">
        <div style="background:#fff;color:#111827;padding:8px 12px;
                    border:1px solid #e5e7eb;
                    border-radius:16px 16px 16px 4px;max-width:70%;
                    font-size:14px;line-height:1.4;word-break:break-word">
          ${_esc(text)}
        </div>
        <span style="font-size:10px;color:#9ca3af">${time}</span>
      </div>`;
  }

  el.scrollTop = el.scrollHeight;
}

function _esc(str) {
  return String(str)
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── P2P 종료 ─────────────────────────────────────────────
function _closeP2P() {
  _stopPoll();
  _activeCallId = null;

  // BUG-FIX(2026-07-01): 튜토리얼 STEP 4 — 사용자가 검색 결과에서 실제로
  // 상대를 선택해 대화창을 열었다가 닫는 경우, p2p-search.js의
  // _closeSearch()보다 이 시점이 "사용자가 실제로 해본 것"에 더 가깝다.
  // 두 곳 모두 신호를 보내지만 _tutorialSignal 내부에서 이미 진행된
  // 단계는 무시하므로 중복 호출로 인한 부작용은 없다.
  if (typeof window._tutorialSignal === 'function') window._tutorialSignal('search_flow_done');

  // 상대방에게 종료 신호 전송 (DataChannel 우선, 실패 시 signal 경유)
  if (_peerInfo && _USER?.ipv6) {
    // ① DataChannel로 종료 메시지 전송
    try {
      if (_rtcChannel && _rtcChannel.readyState === 'open') {
        _rtcChannel.send(JSON.stringify({ type: 'bye', ts: new Date().toISOString() }));
      }
    } catch(e) { console.warn('[P2P] bye DataChannel 전송 실패:', e.message); }

    // ② signal 경유 종료 알림 (DataChannel 실패 대비) — L1 직접
    _signalSendDirect(_USER.ipv6, _peerInfo.guid, 'ice', { bye: true }).catch(() => {});
  }

  if (_rtcChannel) { _rtcChannel.close(); setRtcChannel(null); }
  if (_rtcConn)    { _rtcConn.close();    setRtcConn(null);    }
  _chatOverlay?.remove();
  _chatOverlay = null;

  // ── PDV 저장 + OpenHash 앵커링 ───────────────────────
  // P2P 세션 종료 시 대화 원문을 vault에 저장하고 OpenHash에 앵커링
  if (_p2pMessages.length > 0 && _peerInfo) {
    _saveP2PSession(_p2pMessages, _peerInfo, _sessionStart)
      .catch(e => console.warn('[P2P] PDV 저장 실패 (무시):', e.message));
  }

  _peerInfo     = null;
  _p2pMessages  = [];
  _sessionStart = null;
}

// ── P2P 세션 PDV 저장 + OpenHash 앵커링 ─────────────────
// 설계:
//   원본 = { sessionId, myGuid, peerGuid, peerHandle, startedAt, endedAt, messages[] }
//   vault.js → IndexedDB AES-256-GCM 저장 (원본 보관)
//   contentHash = SHA-256(원본)
//   userSig = gopangWallet.sign(contentHash)
//   hashChain.anchor(contentHash, [userSig], sessionId)
//   T-C: L1 pdv_records 직접 POST { block_hash: entryHash } (+ entryHash 있으면 anchor_records도 직접 POST)
async function _saveP2PSession(messages, peer, startedAt) {
  const { _USER } = await import('../core/state.js');
  if (!_USER?.ipv6) return;

  const now       = new Date().toISOString();
  const sessionId = `P2P-${_USER.ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;

  // ① 세션 원본 구성
  const sessionData = {
    sessionId,
    type:      'p2p_conversation',
    myGuid:    _USER.ipv6,
    myHandle:  _USER.handle,
    peerGuid:  peer.guid,
    peerHandle: peer.handle,
    peerNickname: peer.nickname || peer.handle,
    startedAt: startedAt || now,
    endedAt:   now,
    turns:     messages.length,
    messages,  // 대화 원문 전체
  };
  const sessionRaw = JSON.stringify(sessionData);

  // ② contentHash = SHA-256(sessionRaw)
  const buf         = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(sessionRaw));
  const contentHash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');

  // ③ Ed25519 서명 (vault 저장 전에 먼저 생성)
  let userSig = _USER.ipv6;
  try {
    if (window.gopangWallet?.sign) {
      userSig = await window.gopangWallet.sign(contentHash);
    }
  } catch(e) {
    console.warn('[P2P] Ed25519 서명 실패, guid로 대체:', e.message);
  }

  // ④ vault.js — 원본 저장 (IndexedDB AES-256-GCM)
  try {
    const { storeMessage } = await import('../../pdv/vault.js');
    const pubKeyB64 = window.gopangWallet?.publicKeyB64u || '';
    await storeMessage({
      msgId:           sessionId,
      senderId:        _USER.ipv6,
      senderPubKeyB64: pubKeyB64,
      signature:       userSig || _USER.ipv6,
      role:            'p2p_session',
      content:         sessionRaw,
      timestamp:       now,
      riskLevel:       'S0',
      sessionId,
    });
    console.info('[P2P] vault 저장 완료 | sessionId:', sessionId);
  } catch(e) {
    console.warn('[P2P] vault 저장 실패 (무시):', e.message);
  }

  // ⑤ OpenHash 앵커링
  let entryHash = null;
  let layer     = null;
  try {
    const { anchor } = await import('../../openhash/hashChain.js');
    const result = await anchor(contentHash, [userSig], sessionId);
    entryHash    = result.entryHash;
    layer        = result.layer;
    console.info('[P2P] OpenHash 앵커링 완료',
      '| contentHash:', contentHash.slice(0,16),
      '| entryHash:', entryHash.slice(0,16),
      '| layer:', layer);
  } catch(e) {
    console.warn('[P2P] OpenHash 앵커링 실패 (무시):', e.message);
  }

  // ⑥ localStorage 백업
  try {
    const today = now.slice(0,10);
    const key   = `gopang_history_${_USER.ipv6}_${today}`;
    const existing = JSON.parse(localStorage.getItem(key) || '[]');
    existing.push({
      ts:        now,
      domain:    'P2P',
      turns:     messages.length,
      sessionId,
      entryHash,
      peerHandle: peer.handle,
      summary:   messages.slice(-4),
    });
    localStorage.setItem(key, JSON.stringify(existing));
  } catch(e) {
    console.warn('[P2P] localStorage 백업 실패:', e.message);
  }

  // ⑦ T-C: L1 pdv_records 직접 기록 (Worker pdv 리포트 대체)
  {
    const _who   = { ipv6: _USER.ipv6, handle: _USER.handle };
    const _when  = { period_start: startedAt || now, period_end: now };
    const _where = { svc_url: 'https://hondi.net' };
    const _what  = { summary: `P2P 대화 종료 — ${peer.handle}와 ${messages.length}턴` };
    const _how   = { method: 'WebRTC P2P DataChannel' };
    const _why   = { goal: 'P2P 대화 PDV 기록' };

    await fetch(L1_PDV_URL, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid:         _USER.ipv6,
        report_id:    `${sessionId}:gopang-p2p`,
        reporter_svc: 'gopang-p2p',
        svc:          'gopang',
        type:         'p2p_conversation',
        summary:      _what.summary,
        summary_6w:   JSON.stringify({ who: _who, when: _when, where: _where, what: _what, how: _how, why: _why }),
        block_hash:   entryHash,
        risk_level:   'low',
        source:       'gopang',
        openhash_anchored: !!entryHash,
      }),
    }).catch(e => console.warn('[P2P] L1 pdv_records 전송 실패 (무시):', e.message));

    if (entryHash) {
      fetch(L1_ANCHOR_URL, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          entry_hash:   entryHash,
          content_hash: contentHash,
          msg_id:       sessionId,
          source:       'pdv_records',
        }),
      }).catch(e => console.warn('[P2P] L1 anchor_records 전송 실패 (무시):', e.message));
    }
  }

  console.info('[P2P] PDV 저장 완료',
    '| sessionId:', sessionId,
    '| turns:', messages.length,
    '| contentHash:', contentHash.slice(0,16),
    '| entryHash:', entryHash?.slice(0,16) ?? 'none',
    '| layer:', layer ?? 'none');
}

// ── 앱 시작 시 incoming offer 감시 ──────────────────────
// 2026-06-28: L1 PocketBase Realtime(SSE)으로 복귀 — 아래 _watchL1Realtime
// 정의부 주석 참고(ERR_INCOMPLETE_CHUNKED_ENCODING은 nginx 설정으로 이미 해결됨).
export function startIncomingWatch(myGuid) {
  if (!myGuid) return;

  // realtime과 폴백 폴링이 같은 offer 레코드를 동시에 집어올 수 있어서
  // (_watchAnswerRealtime과 동일한 경쟁 — §주석 참고), 레코드 id 단위로
  // 한 번만 처리되게 한다. handleIncomingOffer 안에 callId 기준 중복 체크가
  // 이미 있지만, 그건 "같은 통화를 두 번 안 열기" 용도고 이건 "같은 레코드를
  // 두 번 안 만지기"(중복 DELETE로 404 나던 것 등) 용도라 별개로 둔다.
  const _seenSignalIds = new Set();

  // startIncomingWatch는 앱 시작 시 1회 호출돼 세션 내내 살아있다 — _seenOfferIds
  // (callId 기준, 캡 있음)와 달리 이 Set은 처음에 캡이 없어서, 받은 모든 신호
  // id(offer뿐 아니라 무시한 ice/answer까지)가 무한정 쌓일 뻔했다. 동일하게
  // 캡을 둔다(_watchAnswerRealtime 쪽은 통화 1건마다 새로 생기는 지역 변수라
  // 통화 종료 시 자동 회수되므로 캡이 필요 없음 — 그쪽과는 다른 사정).
  const _SEEN_SIGNAL_CAP = 100;
  async function _handleSignalRow(row) {
    if (_seenSignalIds.has(row.id)) return;
    _seenSignalIds.add(row.id);
    if (_seenSignalIds.size > _SEEN_SIGNAL_CAP) {
      _seenSignalIds.delete(_seenSignalIds.values().next().value);
    }
    if (row.type === 'offer' && !_chatOverlay) {
      await handleIncomingOffer(row);
      _signalDeleteDirect(row.id);
    }
  }

  // L1 PocketBase 자체 Realtime(SSE)으로 incoming offer 감시.
  // 이전엔 "PocketBase SSE가 ERR_INCOMPLETE_CHUNKED_ENCODING으로 실패"해서
  // Supabase Realtime WebSocket으로 교체했었지만, 서버(nginx proxy_buffering
  // off 적용됨)에서 curl로 직접 재확인한 결과 SSE가 정상 동작한다(2026-06-28).
  // 막혔던 이유는 이미 해결돼 있었다 — 그래서 L1 자체 realtime으로 되돌린다.
  _watchL1Realtime(myGuid, _handleSignalRow);

  // 폴백: realtime이 못 잡은 offer를 3초 폴링으로 보완(같은 핸들러 재사용 —
  // _seenSignalIds가 있어서 realtime이 이미 처리한 레코드는 자동으로 건너뜀)
  setInterval(async () => {
    try {
      if (_chatOverlay) return;
      const signals = await _signalPollDirect(myGuid);
      for (const sig of signals) {
        if (sig.type === 'offer') { await _handleSignalRow(sig); break; }
      }
    } catch {}
  }, 3000);
}
window._closeP2P = _closeP2P;
