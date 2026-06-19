/**
 * ui/p2p.js — WebRTC P2P 채팅 모듈 (GDUDA Phase 1)
 * - CF Worker /signal/* 경유 시그널링 (SDP/ICE 60초 TTL)
 * - 메시지 본문은 서버 저장 없음 — 순수 P2P
 * - from/to 모두 handle 기준 (전세계 유일)
 */
import {
  PROXY, RTC_CONFIG, _USER,
  setRtcConn, setRtcChannel, setSignalPoll,
  _rtcConn, _rtcChannel, _signalPoll,
} from '../core/state.js';

let _chatOverlay  = null;
let _peerInfo     = null;  // { guid, handle, nickname }
let _pollInterval = null;
let _p2pMessages  = [];    // P2P 대화 원문 누적 (PDV 저장용)
let _sessionStart = null;  // 세션 시작 시각
let _activeCallId = null;  // 현재 유효한 통화 시도 ID — 재연결 시 이전 watcher 자동 무력화
const _seenOfferIds = new Set();  // 처리한 offer callId — 중복 confirm() 방지

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

  // answer/ICE 수신 — Supabase WS Realtime (폴링 폴백 포함)
  _watchAnswerRealtime(conn, targetUser.guid, callId);
}

// ── answer/ICE 실시간 수신 (발신측) ─────────────────────
function _watchAnswerRealtime(conn, peerGuid, callId) {
  const SB_WS  = 'wss://ebbecjfrwaswbdybbgiu.supabase.co/realtime/v1/websocket';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';
  const myGuid = _USER.ipv6;

  let ws = null, hb = null, ref = 1, wsOk = false, done = false;

  // 더 새로운 통화 시도가 시작되면 이 watcher는 즉시 폐기
  function _stale() { return _activeCallId !== callId; }

  function _close() {
    done = true;
    if (hb) { clearInterval(hb); hb = null; }
    if (ws) { ws.close(1000); ws = null; }
    _stopPoll();
  }

  // Supabase WS로 answer/ICE 수신
  ws = new WebSocket(`${SB_WS}?apikey=${SB_KEY}&vsn=1.0.0`);
  const send = o => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

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

  ws.onmessage = async ({ data }) => {
    if (done) return;
    if (_stale()) { console.info('[P2P] 오래된 통화 시도 — watcher 종료'); _close(); return; }
    let msg; try { msg = JSON.parse(data); } catch { return; }

    if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
      console.info('[P2P] 발신측 WS 구독 완료 (대기 중) — 실제 데이터 수신 시 폴링 비활성화');
    }

    const row = msg.payload?.data?.record ?? msg.payload?.record ?? null;
    if (!row || row.to_guid !== myGuid) return;

    // 실제 매칭 시그널을 수신한 시점에만 폴백 폴링 비활성화.
    // (L1 저장 구조에서는 Supabase Realtime이 구독은 성공해도 데이터가
    //  오지 않으므로, 핸드셰이크 성공만으로 wsOk=true 하면 폴백이 영구 정지됨)
    wsOk = true;

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
        // answer 수신 후 WS 닫기 (ICE는 ondatachannel onopen 후 불필요)
        setTimeout(_close, 10000);
      } catch(e) { console.warn('[P2P] answer setRemoteDescription 실패:', e.message); }
    }

    if (row.type === 'ice' && row.from_guid === peerGuid) {
      try {
        const candidate = _rowPayload.candidate || _rowPayload;
        await conn.addIceCandidate(new RTCIceCandidate(candidate));
      } catch(e) { console.warn('[P2P] ICE 추가 실패:', e.message); }
    }

    // 처리 후 시그널 삭제
    fetch(`${PROXY}/signal/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: row.id }),
    }).catch(() => {});
  };

  ws.onerror = () => { wsOk = false; };
  ws.onclose = () => {
    if (hb) { clearInterval(hb); hb = null; }
    wsOk = false;
  };

  // 폴백: WS 미작동 시 1.5초 폴링
  _startPoll(myGuid, async signal => {
    if (wsOk || done) return;
    if (_stale()) { _close(); return; }
    const _sigPayload = typeof signal.payload === 'string'
      ? JSON.parse(signal.payload) : (signal.payload || {});
    if (_sigPayload.callId && _sigPayload.callId !== callId) return;

    if (signal.type === 'answer' && signal.from_guid === peerGuid) {
      try {
        const answerSdp = _sigPayload.sdp || _sigPayload;
        await conn.setRemoteDescription(new RTCSessionDescription(answerSdp));
        _appendMsg('system', '✅ 연결됐습니다.');
        _close();
      } catch(e) { console.warn('[P2P] 폴백 answer 실패:', e.message); }
    }
    if (signal.type === 'ice' && signal.from_guid === peerGuid) {
      try {
        await conn.addIceCandidate(new RTCIceCandidate(_sigPayload.candidate || _sigPayload));
      } catch {}
    }
  });
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

  // 수락 확인
  const accepted = confirm(`📞 ${fromHandle}님의 연결 요청\n수락하시겠습니까?`);
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

// ── 시그널 전송 ───────────────────────────────────────────
async function _signalSend(body) {
  await fetch(`${PROXY}/signal/send`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

// ── 시그널 폴링 ───────────────────────────────────────────
function _startPoll(myGuid, handler) {
  _stopPoll();
  _pollInterval = setInterval(async () => {
    try {
      const res     = await fetch(`${PROXY}/signal/poll?guid=${encodeURIComponent(myGuid)}`);
      const data    = await res.json();
      const signals = data.signals || [];
      for (const sig of signals) {
        await handler(sig);
        // 처리 후 삭제
        await fetch(`${PROXY}/signal/delete`, {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ id: sig.id }),
        });
      }
    } catch(e) { console.warn('[P2P] 폴링 오류:', e.message); }
  }, 1500);
}

function _stopPoll() {
  if (_pollInterval) { clearInterval(_pollInterval); _pollInterval = null; }
}

// ── 채팅 UI ───────────────────────────────────────────────
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
               background:#16a34a;color:#fff;font-size:18px;
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
        <div style="background:#16a34a;color:#fff;padding:8px 12px;
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

  // 상대방에게 종료 신호 전송 (DataChannel 우선, 실패 시 signal 경유)
  if (_peerInfo && _USER?.ipv6) {
    // ① DataChannel로 종료 메시지 전송
    try {
      if (_rtcChannel && _rtcChannel.readyState === 'open') {
        _rtcChannel.send(JSON.stringify({ type: 'bye', ts: new Date().toISOString() }));
      }
    } catch(e) { console.warn('[P2P] bye DataChannel 전송 실패:', e.message); }

    // ② signal 경유 종료 알림 (DataChannel 실패 대비)
    fetch(`${PROXY}/signal/send`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_guid: _USER.ipv6,
        to_guid:   _peerInfo.guid,
        type:      'ice',
        payload:   { bye: true },
      }),
    }).catch(() => {});
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
//   POST /pdv/report { block_hash: entryHash }
async function _saveP2PSession(messages, peer, startedAt) {
  const { _USER, PROXY } = await import('../core/state.js');
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

  // ⑦ POST /pdv/report (block_hash = entryHash → openhash_anchored: true)
  await fetch(`${PROXY}/pdv/report`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({
      report: {
        svc:          'gopang',
        type:         'p2p_conversation',
        session_id:   sessionId,
        reporter_svc: 'gopang-p2p',
        block_hash:   entryHash,
        who:   { ipv6: _USER.ipv6, handle: _USER.handle },
        when:  { period_start: startedAt || now, period_end: now },
        where: { svc_url: 'https://gopang.net' },
        what:  { summary: `P2P 대화 종료 — ${peer.handle}와 ${messages.length}턴` },
        how:   { method: 'WebRTC P2P DataChannel' },
        why:   { goal: 'P2P 대화 PDV 기록' },
      },
    }),
  }).catch(e => console.warn('[P2P] pdv_log 전송 실패 (무시):', e.message));

  console.info('[P2P] PDV 저장 완료',
    '| sessionId:', sessionId,
    '| turns:', messages.length,
    '| contentHash:', contentHash.slice(0,16),
    '| entryHash:', entryHash?.slice(0,16) ?? 'none',
    '| layer:', layer ?? 'none');
}

// ── 앱 시작 시 incoming offer 감시 — _P2P_SUPABASE_WS_APPLIED_ ──
// PocketBase SSE가 ERR_INCOMPLETE_CHUNKED_ENCODING으로 실패하므로
// Supabase Realtime WebSocket으로 교체
export function startIncomingWatch(myGuid) {
  if (!myGuid) return;

  const SB_WS  = 'wss://ebbecjfrwaswbdybbgiu.supabase.co/realtime/v1/websocket';
  const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';

  let ws = null, hb = null, ref = 1, wsOk = false;

  function _connectWS() {
    ws = new WebSocket(`${SB_WS}?apikey=${SB_KEY}&vsn=1.0.0`);
    const send = o => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

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
      hb = setInterval(() =>
        send({ topic: 'phoenix', event: 'heartbeat', payload: {}, ref: String(ref++) }), 30000);
    };

    ws.onmessage = async ({ data }) => {
      let msg; try { msg = JSON.parse(data); } catch { return; }

      if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
        console.info('[P2P Realtime] Supabase WS 구독 완료 (대기 중)');
      }

      const row = msg.payload?.data?.record ?? msg.payload?.record ?? null;
      if (!row || row.to_guid !== myGuid) return;

      // 실제 매칭 데이터 수신 시에만 폴백 폴링 비활성화
      wsOk = true;

      if (row.type === 'offer' && !_chatOverlay) {
        console.info('[P2P Realtime] offer 수신 → handleIncomingOffer');
        await handleIncomingOffer(row);
        fetch(`${PROXY}/signal/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: row.id }),
        }).catch(() => {});
      }
    };

    ws.onerror = () => { wsOk = false; };
    ws.onclose = ({ code }) => {
      if (hb) { clearInterval(hb); hb = null; }
      wsOk = false;
      if (code !== 1000 && code !== 1001) {
        console.info('[P2P Realtime] WS 재연결 (5초)...');
        setTimeout(_connectWS, 5000);
      }
    };
  }

  _connectWS();

  // 폴백: WS 미작동 시 3초 폴링
  setInterval(async () => {
    if (wsOk) return;
    try {
      if (_chatOverlay) return;
      const res  = await fetch(`${PROXY}/signal/poll?guid=${encodeURIComponent(myGuid)}`);
      const data = await res.json();
      for (const sig of (data.signals || [])) {
        if (sig.type === 'offer') {
          await handleIncomingOffer(sig);
          await fetch(`${PROXY}/signal/delete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: sig.id }),
          });
          break;
        }
      }
    } catch {}
  }, 3000);
}
window._closeP2P = _closeP2P;
