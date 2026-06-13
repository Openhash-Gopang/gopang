// ============================================================
// webrtc_p2p_module.js
// gopang-app.js의 P2P 채팅 함수들을 WebRTC로 교체
// 기존 _sendP2P(), _subscribePeer(), _startPolling() 대체
// 원칙: 메시지는 기기 PDV(IndexedDB)에만 저장, 서버 저장 없음
// ============================================================

// ── WebRTC 설정 ───────────────────────────────────────────────
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

// Supabase 시그널링 엔드포인트 (Worker 경유)
const SIGNAL_URL = 'https://gopang-proxy.tensor-city.workers.dev/signal';

// ── WebRTC 상태 ────────────────────────────────────────────────
let _rtcConn    = null;  // RTCPeerConnection
let _rtcChannel = null;  // RTCDataChannel
let _rtcPeer    = null;  // 현재 연결 상대
let _signalSub  = null;  // Supabase Realtime 시그널 구독

// ── 대화 상대 설정 (setPeer 재정의) ───────────────────────────
async function setPeer(peer) {
  // 기존 연결 정리
  _closeRTC();

  _peer     = peer;
  _rtcPeer  = peer;

  // 상단 peer-bar 표시
  const bar = document.getElementById('peer-bar');
  const ava = document.getElementById('peer-avatar');
  const nm  = document.getElementById('peer-name');
  const hnd = document.getElementById('peer-handle');
  if (bar) {
    ava.textContent = peer.avatar_emoji || '🙂';
    nm.textContent  = peer.name || peer.handle;
    hnd.textContent = peer.handle || '';
    bar.style.display = 'flex';
  }

  // placeholder 변경
  const inp = document.getElementById('msg-input');
  if (inp) inp.placeholder = `${peer.name || peer.handle}에게 메시지…`;

  // 시그널 수신 구독 시작 (Supabase Realtime)
  _subscribeSignals();

  // WebRTC offer 생성 (발신자가 먼저 연결 요청)
  await _createOffer();

  appendBubble('system',
    `🔗 ${peer.name || peer.handle}에게 연결 중…`);

  console.info('[WebRTC] setPeer:', peer.name, peer.guid);
}

// ── WebRTC offer 생성 ──────────────────────────────────────────
async function _createOffer() {
  _rtcConn = new RTCPeerConnection(RTC_CONFIG);
  _setupRTCEvents(_rtcConn);

  // DataChannel 생성 (발신자 측)
  _rtcChannel = _rtcConn.createDataChannel('gopang-p2p', {
    ordered: true,
  });
  _setupChannelEvents(_rtcChannel);

  // offer SDP 생성
  const offer = await _rtcConn.createOffer();
  await _rtcConn.setLocalDescription(offer);

  // ICE gathering 완료 대기 (최대 3초)
  await _waitICE(_rtcConn);

  // offer를 시그널 서버(Supabase 임시 테이블)로 전송
  await _sendSignal('offer', _rtcConn.localDescription);
}

// ── WebRTC answer 생성 (수신자 측) ────────────────────────────
async function _handleOffer(signal) {
  _rtcConn = new RTCPeerConnection(RTC_CONFIG);
  _setupRTCEvents(_rtcConn);

  // DataChannel 수신 이벤트 (수신자 측)
  _rtcConn.ondatachannel = (e) => {
    _rtcChannel = e.channel;
    _setupChannelEvents(_rtcChannel);
  };

  // offer 설정
  await _rtcConn.setRemoteDescription(
    new RTCSessionDescription(JSON.parse(signal.payload))
  );

  // answer 생성
  const answer = await _rtcConn.createAnswer();
  await _rtcConn.setLocalDescription(answer);
  await _waitICE(_rtcConn);

  // answer 전송
  await _sendSignal('answer', _rtcConn.localDescription, signal.from_guid);

  appendBubble('system',
    `📞 ${_rtcPeer?.name || signal.from_guid.slice(-6)}에게서 연결 요청`);
}

// ── ICE candidate 처리 ────────────────────────────────────────
async function _handleICE(signal) {
  if (!_rtcConn) return;
  try {
    await _rtcConn.addIceCandidate(
      new RTCIceCandidate(JSON.parse(signal.payload))
    );
  } catch(e) { /* 무시 */ }
}

// ── RTCPeerConnection 이벤트 ──────────────────────────────────
function _setupRTCEvents(conn) {
  conn.onicecandidate = async (e) => {
    if (e.candidate) {
      await _sendSignal('ice', e.candidate);
    }
  };

  conn.onconnectionstatechange = () => {
    const s = conn.connectionState;
    console.info('[WebRTC] 연결 상태:', s);
    if (s === 'connected') {
      appendBubble('system', '✅ P2P 연결 수립 완료 — 메시지는 기기 간 직접 전달됩니다.');
      // 연결 후 시그널 데이터 삭제
      _deleteMySignals();
    }
    if (s === 'disconnected' || s === 'failed') {
      appendBubble('system', '⚠️ 연결이 끊어졌습니다.');
    }
  };
}

// ── DataChannel 이벤트 ────────────────────────────────────────
function _setupChannelEvents(ch) {
  ch.onopen = () => {
    console.info('[WebRTC] DataChannel 열림');
  };

  ch.onmessage = (e) => {
    try {
      const msg = JSON.parse(e.data);
      // 수신 메시지 버블 표시
      appendBubble('peer', msg.text, false, _rtcPeer?.name || '상대방');
      // PDV(IndexedDB)에 저장
      _saveMsgPDV({
        dir:  'in',
        from: _rtcPeer?.guid,
        text: msg.text,
        ts:   msg.ts || new Date().toISOString(),
      });
    } catch(e) { console.warn('[WebRTC] 메시지 파싱 오류:', e); }
  };

  ch.onerror = (e) => {
    console.error('[WebRTC] DataChannel 오류:', e);
  };
}

// ── P2P 메시지 전송 (sendMessage에서 호출) ────────────────────
async function _sendP2P(text) {
  if (!_rtcChannel || _rtcChannel.readyState !== 'open') {
    appendBubble('system',
      '⏳ 연결 수립 중입니다. 잠시 후 다시 시도하세요.');
    return;
  }
  const msg = { text, ts: new Date().toISOString() };
  _rtcChannel.send(JSON.stringify(msg));
  // PDV에 저장 (내가 보낸 메시지)
  _saveMsgPDV({
    dir:  'out',
    to:   _rtcPeer?.guid,
    text,
    ts:   msg.ts,
  });
}

// ── 시그널 전송 (Supabase 임시 테이블) ───────────────────────
async function _sendSignal(type, payload, toGuid = null) {
  const to = toGuid || _rtcPeer?.guid;
  if (!to || !USER_GUID) return;
  try {
    await fetch(`${PROXY}/signal/send`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from_guid: USER_GUID,
        to_guid:   to,
        type,
        payload:   JSON.stringify(payload),
      }),
    });
  } catch(e) { console.warn('[Signal] 전송 실패:', e.message); }
}

// ── 시그널 수신 구독 (Supabase Realtime) ─────────────────────
function _subscribeSignals() {
  if (_signalSub) { try { _signalSub.unsubscribe(); } catch(e) {} }

  // Supabase Realtime 클라이언트가 없으면 폴링
  if (!window._supabaseClient) {
    _pollSignals();
    return;
  }

  _signalSub = window._supabaseClient
    .channel('signals-' + USER_GUID)
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'webrtc_signals',
      filter: `to_guid=eq.${USER_GUID}`,
    }, async (payload) => {
      await _handleSignal(payload.new);
    })
    .subscribe();

  console.info('[Signal] Realtime 구독 시작');
}

// ── 시그널 폴링 폴백 (Realtime 미지원 시) ────────────────────
let _sigPollTimer = null;
function _pollSignals() {
  if (_sigPollTimer) clearInterval(_sigPollTimer);
  _sigPollTimer = setInterval(async () => {
    if (!USER_GUID) return;
    try {
      const res  = await fetch(`${PROXY}/signal/poll?guid=${encodeURIComponent(USER_GUID)}`);
      const data = await res.json();
      if (!data.ok || !data.signals?.length) return;
      for (const sig of data.signals) {
        await _handleSignal(sig);
      }
    } catch(e) { /* 폴링 실패 무시 */ }
  }, 1500);
}

// ── 시그널 종류별 처리 ────────────────────────────────────────
async function _handleSignal(sig) {
  console.info('[Signal] 수신:', sig.type, 'from:', sig.from_guid?.slice(-6));
  // 연결 상대 자동 설정 (offer 수신 시)
  if (sig.type === 'offer' && !_rtcPeer) {
    // 발신자 정보 조회
    try {
      const res  = await fetch(`${PROXY}/profile?guid=${encodeURIComponent(sig.from_guid)}`);
      const data = await res.json();
      if (data.ok && data.profile) {
        _rtcPeer = data.profile;
        _peer    = data.profile;
        // peer-bar 표시
        const bar = document.getElementById('peer-bar');
        const nm  = document.getElementById('peer-name');
        if (bar && nm) {
          nm.textContent  = data.profile.name;
          bar.style.display = 'flex';
        }
      }
    } catch(e) {}
  }

  if (sig.type === 'offer')  await _handleOffer(sig);
  if (sig.type === 'answer') {
    if (_rtcConn) {
      await _rtcConn.setRemoteDescription(
        new RTCSessionDescription(JSON.parse(sig.payload))
      );
    }
  }
  if (sig.type === 'ice') await _handleICE(sig);

  // 처리 완료 후 시그널 삭제
  _deleteSignal(sig.id);
}

// ── 시그널 삭제 ───────────────────────────────────────────────
async function _deleteSignal(id) {
  try {
    await fetch(`${PROXY}/signal/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
  } catch(e) {}
}

async function _deleteMySignals() {
  try {
    await fetch(`${PROXY}/signal/delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from_guid: USER_GUID }),
    });
  } catch(e) {}
}

// ── ICE 수집 완료 대기 ────────────────────────────────────────
function _waitICE(conn, timeout = 3000) {
  return new Promise(resolve => {
    if (conn.iceGatheringState === 'complete') { resolve(); return; }
    const timer = setTimeout(resolve, timeout);
    conn.onicegatheringstatechange = () => {
      if (conn.iceGatheringState === 'complete') {
        clearTimeout(timer);
        resolve();
      }
    };
  });
}

// ── RTC 연결 종료 ─────────────────────────────────────────────
function _closeRTC() {
  if (_sigPollTimer) { clearInterval(_sigPollTimer); _sigPollTimer = null; }
  if (_signalSub)    { try { _signalSub.unsubscribe(); } catch(e) {} _signalSub = null; }
  if (_rtcChannel)   { try { _rtcChannel.close(); } catch(e) {} _rtcChannel = null; }
  if (_rtcConn)      { try { _rtcConn.close(); } catch(e) {} _rtcConn = null; }
  _rtcPeer = null;
}

// ── 대화 상대 해제 ────────────────────────────────────────────
function _clearPeer() {
  _closeRTC();
  _peer = null;
  const bar = document.getElementById('peer-bar');
  if (bar) bar.style.display = 'none';
  const inp = document.getElementById('msg-input');
  if (inp) inp.placeholder = '메시지를 입력하세요…';
  appendBubble('system', '🤖 AI 비서와 대화합니다.');
}

// ── PDV(IndexedDB) 메시지 저장 ───────────────────────────────
// 메시지는 서버에 절대 저장하지 않음 — 기기 PDV에만
const PDV_DB_NAME  = 'gopang_pdv_chat';
const PDV_DB_VER   = 1;
let   _pdvChatDB   = null;

async function _openPDVDB() {
  if (_pdvChatDB) return _pdvChatDB;
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PDV_DB_NAME, PDV_DB_VER);
    req.onupgradeneeded = (e) => {
      const db    = e.target.result;
      const store = db.createObjectStore('messages', {
        keyPath: 'id', autoIncrement: true,
      });
      store.createIndex('peer_ts', ['peer_guid', 'ts']);
    };
    req.onsuccess = (e) => { _pdvChatDB = e.target.result; resolve(_pdvChatDB); };
    req.onerror   = (e) => reject(e.target.error);
  });
}

async function _saveMsgPDV(msg) {
  try {
    const db = await _openPDVDB();
    const tx = db.transaction('messages', 'readwrite');
    tx.objectStore('messages').add({
      peer_guid: msg.dir === 'out' ? msg.to : msg.from,
      dir:       msg.dir,
      text:      msg.text,
      ts:        msg.ts,
    });
  } catch(e) { console.warn('[PDV] 메시지 저장 실패:', e); }
}

// ── 이전 대화 이력 로드 (PDV에서) ────────────────────────────
async function _loadChatHistory(peerGuid) {
  try {
    const db    = await _openPDVDB();
    const tx    = db.transaction('messages', 'readonly');
    const store = tx.objectStore('messages');
    const idx   = store.index('peer_ts');
    const range = IDBKeyRange.bound([peerGuid, ''], [peerGuid, '\uffff']);
    const msgs  = await new Promise((resolve, reject) => {
      const req = idx.getAll(range);
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
    // 버블로 렌더링
    msgs.forEach(m => {
      appendBubble(m.dir === 'out' ? 'user' : 'peer', m.text, false,
        m.dir === 'in' ? (_rtcPeer?.name || '상대방') : undefined);
    });
    if (msgs.length) {
      appendBubble('system', `— 이전 대화 ${msgs.length}건 —`);
    }
  } catch(e) { console.warn('[PDV] 이력 로드 실패:', e); }
}
