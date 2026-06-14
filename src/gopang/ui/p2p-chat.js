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

// ── P2P 통화 시작 (발신측) ───────────────────────────────
export async function startP2PCall(targetUser) {
  _peerInfo = targetUser;
  _openChatUI(targetUser, 'calling');

  const conn    = new RTCPeerConnection(RTC_CONFIG);
  const channel = conn.createDataChannel('chat', { ordered: true });
  setRtcConn(conn);
  setRtcChannel(channel);

  _setupChannel(channel);
  _setupConn(conn, targetUser);

  // SDP offer 생성
  const offer = await conn.createOffer();
  await conn.setLocalDescription(offer);

  // ICE 수집 완료 대기 (최대 2초)
  await _waitForIce(conn);

  // offer 전송
  await _signalSend({
    from_guid: _USER.ipv6,
    to_guid:   targetUser.guid,
    type:      'offer',
    payload:   { sdp: conn.localDescription, from_handle: _USER.handle },
  });

  _appendMsg('system', `📞 ${targetUser.nickname || targetUser.handle}님께 연결 요청을 보냈습니다...`);

  // answer 폴링 시작
  _startPoll(_USER.ipv6, async signal => {
    if (signal.type === 'answer' && signal.from_guid === targetUser.guid) {
      await conn.setRemoteDescription(signal.payload.sdp);
      _appendMsg('system', '✅ 연결됐습니다.');
      _stopPoll();
    }
    if (signal.type === 'ice' && signal.from_guid === targetUser.guid) {
      await conn.addIceCandidate(signal.payload.candidate).catch(() => {});
    }
  });
}

// ── P2P 수신측 처리 ──────────────────────────────────────
export async function handleIncomingOffer(signal) {
  const fromHandle  = signal.payload?.from_handle || signal.from_guid;
  const fromGuid    = signal.from_guid;

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

  _setupConn(conn, _peerInfo);

  // SDP answer 생성
  await conn.setRemoteDescription(signal.payload.sdp);
  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);
  await _waitForIce(conn);

  // answer 전송
  await _signalSend({
    from_guid: _USER.ipv6,
    to_guid:   fromGuid,
    type:      'answer',
    payload:   { sdp: conn.localDescription, from_handle: _USER.handle },
  });

  _appendMsg('system', `✅ ${fromHandle}님과 연결됐습니다.`);

  // ICE 폴링
  _startPoll(_USER.ipv6, async sig => {
    if (sig.type === 'ice' && sig.from_guid === fromGuid) {
      await conn.addIceCandidate(sig.payload.candidate).catch(() => {});
    }
  });
}

// ── RTCPeerConnection 공통 설정 ───────────────────────────
function _setupConn(conn, peer) {
  conn.onicecandidate = async e => {
    if (!e.candidate) return;
    await _signalSend({
      from_guid: _USER.ipv6,
      to_guid:   peer.guid,
      type:      'ice',
      payload:   { candidate: e.candidate },
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

  // 뒤로가기
  document.getElementById('_p2p-back').onclick = () => {
    if (confirm('채팅을 종료하시겠습니까?')) _closeP2P();
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
  if (_rtcChannel) { _rtcChannel.close(); setRtcChannel(null); }
  if (_rtcConn)    { _rtcConn.close();    setRtcConn(null);    }
  _chatOverlay?.remove();
  _chatOverlay = null;
  _peerInfo    = null;
}

// ── 앱 시작 시 incoming offer 감시 ───────────────────────
export function startIncomingWatch(myGuid) {
  if (!myGuid) return;
  setInterval(async () => {
    try {
      // 이미 채팅 중이면 스킵
      if (_chatOverlay) return;
      const res  = await fetch(`${PROXY}/signal/poll?guid=${encodeURIComponent(myGuid)}`);
      const data = await res.json();
      for (const sig of (data.signals || [])) {
        if (sig.type === 'offer') {
          await handleIncomingOffer(sig);
          await fetch(`${PROXY}/signal/delete`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ id: sig.id }),
          });
          break;
        }
      }
    } catch {}
  }, 3000);
}

// ── 전역 노출 ─────────────────────────────────────────────
window._closeP2P = _closeP2P;
