// gopang-input.js — autoResize·sendMessage·handleKey
function autoResize(el) {
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 140) + 'px';
}
function updateSendBtn() {
  const v = document.getElementById('msg-input').value.trim();
  const hasInput = !!(v || attachFile);
  document.getElementById('send-btn').disabled = !hasInput;

  // 입력 시작 시 AI 자동 활성화
  // (대화 상대 미지정 상태 = aiActive가 false인 상태)
  if (hasInput && !aiActive) {
    activateAI(true);  // silent=true: 활성화 메시지 미표시
  }
}
function handleKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
}

// ── 메시지 전송 ─────────────────────────────────────────
async function sendMessage() {
  const inp  = document.getElementById('msg-input');
  const text = inp.value.trim();
  if (!text && !attachFile) return;

  // 첫 메시지 전송 시 GPS 요청 — PWA 배너가 이미 처리된 후이므로 충돌 없음
  if (!_locationReady && !_locationPending) _initLocation();

  const capturedFile = attachFile;   // 전송 전에 캡처 (removeAttach 전)

  // 사용자 버블 — 이미지 첨부 시 미리보기 포함
  if (capturedFile && capturedFile.type.startsWith('image/')) {
    const objUrl = URL.createObjectURL(capturedFile);
    const imgId  = 'img-' + Date.now();
    appendBubble('user',
      `${text ? text + '<br>' : ''}<img id="${imgId}" src="${objUrl}"
        style="max-width:220px;max-height:180px;border-radius:10px;
               margin-top:${text?'6px':'0'};display:block">`, true);
    // CSP 친화적: 인라인 onload 대신 JS 이벤트 리스너
    requestAnimationFrame(() => {
      const imgEl = document.getElementById(imgId);
      if (imgEl) imgEl.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
    });
  } else {
    if (text) appendBubble('user', text);
    if (capturedFile) appendBubble('user', `📎 ${capturedFile.name}`, false);
  }

  // ★ history.push(user)는 callAI 내부에서 처리
  //   (callAI 진입 전에 push하면 isFirstTurn 감지 오작동)
  inp.value = '';
  inp.style.height = 'auto';
  updateSendBtn();
  removeAttach();

  // ── SP-00 v10.0: LLM이 직접 판단 → [GWP:id] 태그 감지 → 새 탭
  // _gwpMatch / runRouter 제거 — LLM 1회 호출로 통합
  if (text) {
    if (aiActive) {
      // 모바일 팝업 차단 우회: 사용자 탭 직후(동기) 빈 탭 예약
      // LLM 응답 완료 후 비동기 시점에 window.open()하면 차단됨
