/**
 * p2p/webrtc.js — P2P WebRTC DataChannel + 시그널링 + PDV 채팅 저장
 */
import {
  _peer, _rtcConn, _rtcChannel, _signalPoll, _pdvChatDB,
  setPeerState, setRtcConn, setRtcChannel, setSignalPoll, setPdvChatDB,
  PROXY, RTC_CONFIG, USER_GUID,
} from '../core/state.js';
import { _isRegistered } from '../core/auth.js';
import { appendBubble } from '../ui/bubble.js';
import { _showRegisterFlowThenPeer } from '../ui/register-flow.js';

// ── 대화 상대 설정 ───────────────────────────────────────
export async function setPeer(peer) {
  if (!_isRegistered()) {
    _showRegisterFlowThenPeer(peer);
    return;
  }

  _closeRTC();
  setPeerState(peer);

  // peer-bar 표시
  const bar = document.getElementById('peer-bar');
  const ava = document.getElementById('peer-avatar');
  const nm  = document.getElementById('peer-name');
  const hnd = document.getElementById('peer-handle');
  if (bar) {
    if (ava) ava.textContent = peer.avatar_emoji || '🙂';
    if (nm)  nm.textContent  = peer.name || peer.handle || '상대방';
    if (hnd) hnd.textContent = peer.handle || '';
    bar.style.display = 'flex';
  }

  const inp = document.getElementById('msg-input');
  if (inp) inp.placeholder = `${peer.name || peer.handle || '상대방'}에게 메시지…`;

  await _loadChatHistory(peer.guid);
  _startSignalPoll();
  await _createOffer();

  appendBubble('system', `🔗 ${peer.name || peer.handle || '상대방'}에게 연결 중…`);
  console.info('[WebRTC] setPeer:', peer.name, peer.guid?.slice(-8));
}

// ── 대화 상대 해제 ───────────────────────────────────────
export function _clearPeer() {
  _closeRTC();
  setPeerState(null);
  const bar = document.getElementById('peer-bar');
  if (bar) bar.style.display = 'none';
  const inp = document.getElementById('msg-input');
  if (inp) inp.placeholder = '메시지를 입력하세요…';
  appendBubble('system', '🤖 AI 비서와 대화합니다.');
}

// ── WebRTC Offer 생성 (발신자) ────────────────────────────
async function _createOffer() {
  const conn = new RTCPeerConnection(RTC_CONFIG);
  setRtcConn(conn);
  _setupRTCEvents(conn);
  const ch = conn.createDataChannel('gopang-p2p', { ordered: true });
  setRtcChannel(ch);
  _setupChannelEvents(ch);

  const offer = await conn.createOffer();
  await conn.setLocalDescription(offer);
  await _waitICE(conn);
  await _sendSignal('offer', conn.localDescription);
}

// ── WebRTC Answer 생성 (수신자) ───────────────────────────
async function _handleOffer(sig) {
  const conn = new RTCPeerConnection(RTC_CONFIG);
  setRtcConn(conn);
  _setupRTCEvents(conn);
  conn.ondatachannel = (e) => {
    setRtcChannel(e.channel);
    _setupChannelEvents(e.channel);
  };
  await conn.setRemoteDescription(new RTCSessionDescription(JSON.parse(sig.payload)));
  const answer = await conn.createAnswer();
  await conn.setLocalDescription(answer);
  await _waitICE(conn);
  await _sendSignal('answer', conn.localDescription, sig.from_guid);
  appendBubble('system', `📞 ${_peer?.name || sig.from_guid?.slice(-6) || '상대방'}에게서 연결 요청`);
}

// ── ICE 후보 수집 완료 대기 ──────────────────────────────
function _waitICE(conn) {
  return new Promise(resolve => {
    if (conn.iceGatheringState === 'complete') { resolve(); return; }
    const t = setTimeout(resolve, 3000);
    conn.onicegatheringstatechange = () => {
      if (conn.iceGatheringState === 'complete') { clearTimeout(t); resolve(); }
    };
  });
}

// ── RTCPeerConnection 이벤트 ─────────────────────────────
function _setupRTCEvents(conn) {
  conn.onicecandidate = async (e) => {
    if (e.candidate) await _sendSignal('ice', e.candidate);
  };
  conn.onconnectionstatechange = () => {
    const s = conn.connectionState;
    console.info('[WebRTC] 연결 상태:', s);
    if (s === 'connected') {
      appendBubble('system', '✅ P2P 연결 완료 — 메시지는 기기 간 직접 전달됩니다.');
      _deleteMySignals();
    }
    if (s === 'disconnected' || s === 'failed') {
      appendBubble('system', '⚠️ 연결이 끊어졌습니다.');
    }
  };
}

// ── DataChannel 이벤트 ───────────────────────────────────
function _setupChannelEvents(ch) {
  ch.onmessage = async (e) => {
    try {
      const msg = JSON.parse(e.data);
      appendBubble('peer', msg.text, false, _peer?.name || '상대방');
      await _saveMsgPDV({ dir:'in', from: _peer?.guid, text: msg.text, ts: msg.ts });
    } catch(err) { console.warn('[WebRTC] 메시지 파싱 오류:', err); }
  };
  ch.onerror = (e) => console.error('[WebRTC] DataChannel 오류:', e);
}

// ── P2P 메시지 전송 ──────────────────────────────────────
export async function _sendP2P(text) {
  if (!_rtcChannel || _rtcChannel.readyState !== 'open') {
    appendBubble('system', '⏳ 연결 수립 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }
  const msg = { text, ts: new Date().toISOString() };
  _rtcChannel.send(JSON.stringify(msg));
  await _saveMsgPDV({ dir:'out', to: _peer?.guid, text, ts: msg.ts });
}

// ── RTC 연결 종료 ────────────────────────────────────────
export function _closeRTC() {
  if (_signalPoll) { clearInterval(_signalPoll); setSignalPoll(null); }
  if (_rtcChannel) { try { _rtcChannel.close(); } catch {} setRtcChannel(null); }
  if (_rtcConn)    { try { _rtcConn.close(); }    catch {} setRtcConn(null); }
}

// ── 시그널 전송 ──────────────────────────────────────────
async function _sendSignal(type, payload, toGuid = null) {
  const to = toGuid || _peer?.guid;
  if (!to || !USER_GUID) return;
  try {
    await fetch(`${PROXY}/signal/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_guid: USER_GUID, to_guid: to, type, payload: JSON.stringify(payload) }),
    });
  } catch(e) { console.warn('[Signal] 전송 실패:', e.message); }
}

// ── 시그널 폴링 (1.5초) ──────────────────────────────────
export function _startSignalPoll() {
  // (Realtime은 p2p-chat.js startIncomingWatch에서 처리)

  if (_signalPoll) clearInterval(_signalPoll);
  const id = setInterval(async () => {
    if (!USER_GUID) return;
    try {
      const res  = await fetch(`${PROXY}/signal/poll?guid=${encodeURIComponent(USER_GUID)}`);
      const data = await res.json();
      if (!data.ok || !data.signals?.length) return;
      for (const sig of data.signals) await _handleSignal(sig);
    } catch {}
  }, 1500);
  setSignalPoll(id);
}

// ── 시그널 처리 ──────────────────────────────────────────
async function _handleSignal(sig) {
  console.info('[Signal] 수신:', sig.type, 'from:', sig.from_guid?.slice(-6));

  if (false && sig.type === 'offer' && !_peer) { // p2p-chat.js로 이전
    try {
      const res  = await fetch(`${PROXY}/profile?guid=${encodeURIComponent(sig.from_guid)}`);
      const data = await res.json();
      if (data.ok && data.profile) {
        setPeerState(data.profile);
        const bar = document.getElementById('peer-bar');
        const nm  = document.getElementById('peer-name');
        if (bar && nm) { nm.textContent = data.profile.name; bar.style.display = 'flex'; }
      }
    } catch {}
  }

  if (sig.type === 'offer')  await _handleOffer(sig);
  if (sig.type === 'answer') {
    if (_rtcConn) await _rtcConn.setRemoteDescription(new RTCSessionDescription(JSON.parse(sig.payload)));
  }
  if (sig.type === 'ice') {
    if (_rtcConn) {
      try { await _rtcConn.addIceCandidate(new RTCIceCandidate(JSON.parse(sig.payload))); } catch {}
    }
  }
  _deleteSignal(sig.id);
}

async function _deleteSignal(id) {
  try { await fetch(`${PROXY}/signal/delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ id }) }); } catch {}
}
async function _deleteMySignals() {
  try { await fetch(`${PROXY}/signal/delete`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ from_guid: USER_GUID }) }); } catch {}
}

// ── PDV 채팅 저장 (IndexedDB) ────────────────────────────
async function _openPDVDB() {
  if (_pdvChatDB) return _pdvChatDB;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('gopang_pdv_chat', 1);
    req.onupgradeneeded = (e) => {
      const store = e.target.result.createObjectStore('messages', { keyPath:'id', autoIncrement:true });
      store.createIndex('peer_ts', ['peer_guid','ts']);
    };
    req.onsuccess = (e) => { setPdvChatDB(e.target.result); resolve(e.target.result); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function _saveMsgPDV(msg) {
  try {
    const db = await _openPDVDB();
    const tx = db.transaction('messages', 'readwrite');
    tx.objectStore('messages').add({
      peer_guid: msg.dir === 'out' ? msg.to : msg.from,
      dir: msg.dir, text: msg.text, ts: msg.ts,
    });
  } catch(e) { console.warn('[PDV] 메시지 저장 실패:', e); }
}

async function _loadChatHistory(peerGuid) {
  try {
    const db    = await _openPDVDB();
    const tx    = db.transaction('messages', 'readonly');
    const idx   = tx.objectStore('messages').index('peer_ts');
    const range = IDBKeyRange.bound([peerGuid,''], [peerGuid,'\uffff']);
    const msgs  = await new Promise((resolve, reject) => {
      const req = idx.getAll(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    if (msgs.length) {
      appendBubble('system', `— 이전 대화 ${msgs.length}건 —`);
      msgs.forEach(m => appendBubble(
        m.dir === 'out' ? 'user' : 'peer', m.text, false,
        m.dir === 'in' ? (_peer?.name || '상대방') : undefined
      ));
    }
  } catch(e) { console.warn('[PDV] 이력 로드 실패:', e); }
}
