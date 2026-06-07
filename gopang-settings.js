// gopang-settings.js — 설정·검색·첨부·DOMContentLoaded
function openSettings() {
  // API 키는 하드코딩 — 설정 화면에 별표로 마스킹 표시
  document.getElementById('setting-apikey').value     = CFG.apiKey    ? '••••••••••••••••••••••••••••••••' : '';
  document.getElementById('setting-gemini-key').value = CFG.geminiKey ? '••••••••••••••••••••••••••••••••' : '';
  document.getElementById('setting-system').value     = CFG.system;
  const modelSel = document.getElementById('setting-model');
  if (modelSel) modelSel.value = CFG.model;
  const epSel = document.getElementById('setting-endpoint');
  if (epSel) epSel.value = CFG.endpoint;

  // ── 보안 섹션 업데이트 ──────────────────────────────
  _updateSecuritySection();

  document.getElementById('settings-overlay').classList.add('open');
}

function _updateSecuritySection() {
  const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
  const levelEl = document.getElementById('auth-level-display');
  const idEl    = document.getElementById('gopang-id-display');
  const fpBtn   = document.getElementById('btn-register-fp');

  if (!stored?.ipv6) {
    if (levelEl) levelEl.innerHTML = '⚠️ 미등록 사용자';
    return;
  }

  const level  = stored.authLevel || 'L0';
  const hasFace = !!stored.faceVec;
  const hasFp   = !!stored.webauthn?.credentialId;
  const hasSeed = !!stored.seedHex;

  const levelColors = { L0:'#FF9F0A', L1:'#30D158', L2:'#0A84FF', L3:'#BF5AF2' };
  const color = levelColors[level] || '#AEAEB2';

  if (levelEl) levelEl.innerHTML = `
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
      <span style="font-size:18px;font-weight:700;color:${color};">${level}</span>
      <span style="color:var(--label);">인증 레벨</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:4px;">
      <span>${hasFace  ? '✅' : '⬜'} 얼굴 인증 (L1)</span>
      <span>${hasFp    ? '✅' : '⬜'} 지문 인증 (L2)</span>
      <span>${hasSeed  ? '✅' : '⬜'} 4단어 시드</span>
    </div>`;

  if (idEl) idEl.textContent = `ID: ${stored.ipv6}`;

  // 지문 버튼 텍스트 동적 변경
  if (fpBtn) fpBtn.textContent = hasFp ? '🔐 지문 재등록' : '🔐 지문 등록';
}

// ── 설정에서 지문 등록 ───────────────────────────────────
window._settingsRegisterFingerprint = async function() {
  const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
  if (!stored?.ipv6) {
    appendBubble('ai', '⚠️ 먼저 고팡 등록을 완료해 주세요.', true);
    closeSettings();
    return;
  }
  closeSettings();
  await _registerFingerprint(stored.ipv6);
  // 등록 완료 후 설정 재오픈 시 업데이트 반영
};

// ── 설정에서 얼굴 재등록 ────────────────────────────────
window._settingsRegisterFace = async function() {
  const stored = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
  if (!stored?.ipv6) {
    appendBubble('ai', '⚠️ 먼저 고팡 등록을 완료해 주세요.', true);
    closeSettings();
    return;
  }
  closeSettings();
  appendBubble('ai', '📷 얼굴을 재등록합니다. 전면 카메라를 실행합니다…', true);

  const vec = await _captureFaceVector();
  if (!vec) {
    appendBubble('ai', '촬영이 취소됐습니다.', true);
    return;
  }
  // 기존 데이터 유지하며 faceVec만 교체
  const updated = {
    ...stored,
    faceVec:   vec,
    authLevel: stored.webauthn ? 'L2' : 'L1',
    lastSeenAt: new Date().toISOString(),
  };
  localStorage.setItem('gopang_user_v3', JSON.stringify(updated));
  appendBubble('ai', '✅ 얼굴 재등록 완료!', true);
};
function handleOverlayClick(e) {
  if (e.target.id === 'settings-overlay') closeSettings();
}
function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('open');
}

// ── 캐시 강제 초기화 (구버전 PWA 제거) ──────────────────────
async function clearSWCache() {
  try {
    // 1. 모든 SW 해제
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map(r => r.unregister()));
    // 2. 모든 캐시 삭제
    const keys = await caches.keys();
    await Promise.all(keys.map(k => caches.delete(k)));
    alert('캐시 초기화 완료. 페이지를 새로고침합니다.');
    location.reload(true);
  } catch (e) {
    alert('초기화 실패: ' + e.message);
  }
}
function saveSettings() {
  const model     = document.getElementById('setting-model').value;
  const epVal     = document.getElementById('setting-endpoint').value;
  const key       = document.getElementById('setting-apikey').value.trim();
  const geminiKey = document.getElementById('setting-gemini-key').value.trim();
  const sys       = document.getElementById('setting-system').value.trim();

  if (model) CFG.model = MODEL_MIGRATION[model] ?? model;
  // 별표(마스킹) 그대로면 기존 키 유지, 실제 새 키 입력 시만 교체
  if (key       && !key.startsWith('•'))       CFG.apiKey    = key;
  if (geminiKey && !geminiKey.startsWith('•')) CFG.geminiKey = geminiKey;
  if (sys) CFG.system = sys;

  if (epVal === 'custom') {
    const customUrl = document.getElementById('custom-endpoint-url').value.trim();
    if (customUrl) CFG.endpoint = customUrl;
  } else {
    CFG.endpoint = epVal;
  }

  // 로컬 저장 (API key 포함 — 강력 새로고침 후에도 유지)
  try {
    localStorage.setItem('gopang_cfg', JSON.stringify({
      model:     CFG.model,
      endpoint:  CFG.endpoint,
      system:    CFG.system,
      apiKey:    CFG.apiKey,
      geminiKey: CFG.geminiKey,
    }));
  } catch {}

  closeSettings();
  appendBubble('ai', `⚙️ 설정 저장: ${CFG.model}`);
}
// 구버전 모델명 → 현재 유효한 이름으로 교정 매핑
const MODEL_MIGRATION = {
  'deepseek-v4':        'deepseek-v4-flash',
  'deepseek-v3':        'deepseek-chat',
  'deepseek-r1':        'deepseek-reasoner',
};

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
    if (saved.model) {
      CFG.model = MODEL_MIGRATION[saved.model] ?? saved.model;
    }
    if (saved.endpoint)  CFG.endpoint  = saved.endpoint;
    if (saved.system)    CFG.system    = saved.system;
    // 하드코딩 키가 있으면 localStorage 값으로 덮어쓰지 않음
    if (saved.apiKey    && !CFG.apiKey)    CFG.apiKey    = saved.apiKey;
    if (saved.geminiKey && !CFG.geminiKey) CFG.geminiKey = saved.geminiKey;
    // kakaoKey는 CFG에 하드코딩 — localStorage 복원 불필요
  } catch {}
}

// 커스텀 엔드포인트 필드 토글
document.getElementById('setting-endpoint').addEventListener('change', function() {
  document.getElementById('custom-endpoint-group').style.display =
    this.value === 'custom' ? 'block' : 'none';
});

// ── 검색 (대화 상대 + PDV 데이터 전용) ────────────────────
// ⚠️  웹 검색은 이 버튼의 기능이 아님.
//     웹 검색이 필요하면 AI 비서(AI 버튼)에게 직접 지시할 것.
function openSearch() {
  document.getElementById('search-overlay').classList.add('open');
  setTimeout(() => document.getElementById('search-input')?.focus(), 300);
}
function closeSearch() {
  document.getElementById('search-overlay').classList.remove('open');
}
function handleSearchOverlayClick(e) {
  if (e.target.id === 'search-overlay') closeSearch();
}

function runSearch() {
  const q = document.getElementById('search-input').value.trim();
  const resultEl = document.getElementById('search-result');
  if (!q) {
    resultEl.innerHTML = '';
    return;
  }

  // ── 1. 대화 상대 검색 (대화 이력 기반) ────────────────
  const contactMatches = _searchContacts(q);

  // ── 2. PDV 데이터 검색 (localStorage 기반) ─────────────
  const pdvMatches = _searchPDV(q);

  // ── 결과 렌더링 ────────────────────────────────────────
  let html = '';

  if (contactMatches.length > 0) {
    html += `<div style="font-size:11px;font-weight:600;color:var(--label-3);
                          letter-spacing:0.05em;text-transform:uppercase;
                          margin-bottom:6px">👤 대화 상대</div>`;
    contactMatches.forEach(c => {
      html += `<div style="padding:8px 10px;border-radius:var(--r-md);
                            background:var(--bg-input);margin-bottom:6px;
                            font-size:14px;cursor:pointer"
                   onclick="selectContact('${c.id}')">
                 <span style="color:var(--label)">${_highlight(c.name, q)}</span>
                 <span style="color:var(--label-3);font-size:12px;margin-left:8px">
                   ${c.guid ? c.guid.slice(0,8)+'…' : ''}
                 </span>
               </div>`;
    });
  }

  if (pdvMatches.length > 0) {
    html += `<div style="font-size:11px;font-weight:600;color:var(--label-3);
                          letter-spacing:0.05em;text-transform:uppercase;
                          margin:${contactMatches.length?'12px':0} 0 6px">
               🔐 PDV 데이터
             </div>`;
    pdvMatches.forEach(p => {
      html += `<div style="padding:8px 10px;border-radius:var(--r-md);
                            background:var(--bg-input);margin-bottom:6px;font-size:13px">
                 <span style="color:var(--label-2)">${_highlight(p.key, q)}</span>
                 <span style="color:var(--label-3);font-size:11px;margin-left:6px">
                   ${p.date}
                 </span>
               </div>`;
    });
  }

  if (!html) {
    html = `<div style="color:var(--label-3);font-size:13px;text-align:center;
                         padding:20px 0">
              검색 결과 없음
              <div style="font-size:11px;margin-top:6px">
                웹 검색은 AI 비서에게 직접 지시하세요.
              </div>
            </div>`;
  }

  resultEl.innerHTML = html;
}

// 대화 상대 검색 — history 기반 + localStorage 연락처
function _searchContacts(q) {
  const results = [];
  const seen = new Set();
  const lq = q.toLowerCase();

  // 현재 대화 이력에서 AI 이외 발신자 추출
  history.forEach(m => {
    if (m.role === 'assistant') return;
    // 향후 다자간 대화 시 senderId로 분류
  });

  // localStorage 저장된 연락처 검색
  try {
    const contacts = JSON.parse(localStorage.getItem('gopang_contacts') || '[]');
    contacts.forEach(c => {
      if (!seen.has(c.id) &&
          (c.name?.toLowerCase().includes(lq) ||
           c.guid?.toLowerCase().includes(lq))) {
        seen.add(c.id);
        results.push(c);
      }
    });
  } catch {}

  return results;
}

// PDV 데이터 검색 — localStorage 키 기반
function _searchPDV(q) {
  const results = [];
  const lq = q.toLowerCase();
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key.startsWith('gopang_')) continue;
      if (key === 'gopang_user_guid' || key === 'gopang_cfg' ||
          key === 'gopang_contacts') continue;
      if (key.toLowerCase().includes(lq)) {
        const val = localStorage.getItem(key);
        let date = '';
        try { date = JSON.parse(val)?.ts ?? ''; } catch {}
        results.push({ key: key.replace('gopang_',''), date });
      }
    }
  } catch {}
  return results.slice(0, 10);
}

// 검색어 강조
function _highlight(text, q) {
  if (!text) return '';
  const re = new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'gi');
  return text.replace(re,
    '<span style="color:var(--tint);font-weight:600">$1</span>');
}

// 연락처 선택 시 채팅으로 이동
function selectContact(id) {
  closeSearch();
  // 향후: 해당 연락처와의 대화 스레드로 전환
  console.log('[Search] 연락처 선택:', id);
}

// ── GUID 상태 스트립 표시 ────────────────────────────────
function showGUID() {
  const el = document.getElementById('status-text');
  if (el) el.title = `GUID: ${USER_GUID}`;
}

// ── 파일 첨부 ───────────────────────────────────────────
function triggerAttach() {
  document.getElementById('file-input').click();
}
function triggerCamera() {
  document.getElementById('camera-input').click();
}
function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  attachFile = file;

  const nameEl    = document.getElementById('attach-name');
  const previewEl = document.getElementById('attach-preview');

  if (file.type.startsWith('image/')) {
    // 이미지 — 썸네일만 표시 (파일명·경고문 제거)
    const objUrl  = URL.createObjectURL(file);
    const thumbId = 'thumb-' + Date.now();
    nameEl.innerHTML =
      `<img id="${thumbId}" src="${objUrl}"
        style="height:36px;width:36px;object-fit:cover;
               border-radius:8px;vertical-align:middle;display:block;">`;
    requestAnimationFrame(() => {
      const t = document.getElementById(thumbId);
      if (t) t.addEventListener('load', () => URL.revokeObjectURL(objUrl), { once: true });
    });
  } else {
    // 일반 파일 — 아이콘만 표시
    const ext = file.name.split('.').pop().toUpperCase();
    nameEl.innerHTML =
      `<span style="font-size:11px;font-weight:600;color:var(--label-2);
                    background:var(--bg-subtle);border-radius:6px;
                    padding:3px 7px;">${ext}</span>`;
  }

  previewEl.style.display = 'flex';
  e.target.value = '';
  updateSendBtn();
}

function removeAttach() {
  attachFile = null;
  document.getElementById('attach-preview').style.display = 'none';
  document.getElementById('attach-name').innerHTML = '';
  updateSendBtn();   // ★ 첨부 제거 후 버튼 상태 재계산
}


// ── 마이크 입력 후 1초 무입력 시 자동 전송 ─────────────────
let _micAutoSendTimer = null;
