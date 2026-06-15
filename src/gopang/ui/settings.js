/**
 * ui/settings.js — 설정 패널
 */
import { CFG, loadSettings } from '../core/config.js';
import { _isRegistered, _isGDCUser } from '../core/auth.js';
import { _USER } from '../core/state.js';
import { appendBubble } from './bubble.js';

// ── 핸들 칩 업데이트 ────────────────────────────────────
export function _updateHandleChip(h) {
  const c = document.getElementById('my-handle-chip');
  if (c) c.textContent = h || 'Guest';

  const s = document.getElementById('gopang-id-status');
  const b = document.getElementById('gopang-id-register-box');
  if (h) {
    if (s) s.innerHTML = `<b style="color:var(--green,#16a34a)">${h}</b> <span style="font-size:11px">(등록됨)</span>`;
    if (b) b.style.display = 'none';
  } else {
    if (s) s.textContent = '등록되지 않았습니다.';
    if (b) b.style.display = 'block';
  }
}

// ── 설정 패널 열기 ───────────────────────────────────────
export function openSettings() {
  const registered = _isRegistered();
  const isGDC      = _isGDCUser();

  if (typeof _updateLogoutBtn === 'function') _updateLogoutBtn();

  // 1. 아이디 등록 박스: Guest만 표시
  const registerBox = document.getElementById('gopang-id-register-box');
  if (registerBox) registerBox.style.display = registered ? 'none' : 'block';

  // 2. 아이디 상태 표시
  const idStatus = document.getElementById('gopang-id-status');
  if (idStatus) {
    if (registered) {
      const s = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}');
      idStatus.innerHTML = `<b style="color:var(--green,#16a34a)">${s.handle}</b> <span style="font-size:11px">(등록됨)</span>`;
    } else {
      idStatus.textContent = '등록되지 않았습니다.';
    }
  }

  // 3. Guest 등록 유도 안내
  const idSec = document.getElementById('gopang-id-section');
  if (idSec) {
    if (!registered) {
      if (!document.getElementById('_id-section-guide')) {
        const g = document.createElement('p');
        g.id = '_id-section-guide';
        g.style.cssText = 'font-size:12px;color:#16a34a;font-weight:600;margin-bottom:8px;' +
                          'background:#dcfce7;border-radius:8px;padding:8px 10px;line-height:1.5';
        g.innerHTML = '아이디를 등록하면 AI 비서와 P2P 채팅을 사용할 수 있습니다.';
        idSec.insertBefore(g, idSec.firstChild);
      }
    } else {
      document.getElementById('_id-section-guide')?.remove();
    }
  }

  // 4. GDC Wallet 섹션: GDC 사용자만 표시
  const gdcSec = document.getElementById('gdc-wallet-section');
  if (gdcSec) gdcSec.style.display = isGDC ? 'block' : 'none';

  // 5. AI 설정 카드: 등록 사용자만 표시
  const aiCard  = document.getElementById('_ai-card');
  const aiLabel = document.getElementById('_ai-label');
  if (aiCard)  aiCard.style.display  = registered ? 'block' : 'none';
  if (aiLabel) aiLabel.style.display = registered ? 'block' : 'none';

  // 6. 로그아웃 버튼: 등록 사용자만 표시
  const logoutBtn  = document.getElementById('btn-logout-or-login');
  const actionCard = document.getElementById('_action-card');
  if (logoutBtn)  logoutBtn.style.display  = registered ? 'flex' : 'none';
  if (actionCard) actionCard.style.display = registered ? 'block' : 'none';

  // 7. 기기 초기화 버튼: 등록 사용자만 표시
  const resetBtn = document.getElementById('btn-device-reset');
  if (resetBtn) resetBtn.style.display = registered ? 'flex' : 'none';

  // 8. LLM 섹션: 항상 숨김
  const llmSec = document.getElementById('llm-settings-section');
  if (llmSec) llmSec.style.display = 'none';

  _updateSecuritySection();
  document.getElementById('settings-overlay')?.classList.add('open');
}

// ── 설정 패널 닫기 ───────────────────────────────────────
export function closeSettings() {
  document.getElementById('settings-overlay')?.classList.remove('open');
}

export function handleOverlayClick(e) {
  if (e.target.id === 'settings-overlay') closeSettings();
}

// ── AI 설정 슬라이드 패널 ────────────────────────────────
export function openAISettings() {
  const apiEl   = document.getElementById('setting-apikey');
  const gKeyEl  = document.getElementById('setting-gemini-key');
  const sysEl   = document.getElementById('setting-system');
  const modelEl = document.getElementById('setting-model');
  const epEl    = document.getElementById('setting-endpoint');
  if (apiEl)   apiEl.value   = CFG.apiKey    ? '••••••••••••••••••••••••••••••••' : '';
  if (gKeyEl)  gKeyEl.value  = CFG.geminiKey ? '••••••••••••••••••••••••••••••••' : '';
  if (sysEl)   sysEl.value   = CFG.system;
  if (modelEl) modelEl.value = CFG.model;
  if (epEl)    epEl.value    = CFG.endpoint;
  document.getElementById('ai-settings-overlay')?.classList.add('open');
}

export function closeAISettings() {
  document.getElementById('ai-settings-overlay')?.classList.remove('open');
}

export function handleAISettingsOverlayClick(e) {
  if (e.target.id === 'ai-settings-overlay') closeAISettings();
}

// ── 보안 섹션 업데이트 ───────────────────────────────────
export function _updateSecuritySection() {
  const stored  = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || 'null');
  const levelEl = document.getElementById('auth-level-display');
  const idEl    = document.getElementById('gopang-id-display');
  const fpBtn   = document.getElementById('btn-register-fp');

  if (fpBtn) fpBtn.style.display = 'none';

  if (!stored?.ipv6) {
    if (levelEl) levelEl.textContent = '미등록 사용자';
    return;
  }

  if (levelEl) levelEl.innerHTML =
    `<span style="font-size:13px;color:var(--green)">${stored.handle || stored.ipv6}</span>`;
  if (idEl) idEl.textContent = '';
}

// ── 설정에서 아이디 등록 버튼 ────────────────────────────
export async function _settingsRegisterHandle() {
  const inp  = document.getElementById('gopang-id-input');
  const name = inp?.value?.trim().replace(/\D/g,'').slice(0,8) || '';
  if (!name || !/^\d{8}$/.test(name)) { inp?.focus(); return; }

  const btn = document.getElementById('gopang-id-register-btn') ||
              document.querySelector('#gopang-id-register-box button');
  if (btn) { btn.disabled = true; btn.textContent = '등록 중…'; }

  const { _registerToL1 } = await import('../core/auth.js');
  await _registerToL1(name);
  _updateHandleChip(_USER?.handle || null);
  if (typeof _updateLogoutBtn === 'function') _updateLogoutBtn();

  if (btn) { btn.disabled = false; btn.textContent = '아이디 등록'; }

  // [16] 등록 완료 후 설정 창 재호출 (상태 갱신)
  openSettings();
}

// ── SW 캐시 초기화 ───────────────────────────────────────
export async function clearSWCache() {
  if (!navigator.serviceWorker) { alert('Service Worker 없음'); return; }
  const keys = await caches.keys();
  await Promise.all(keys.map(k => caches.delete(k)));
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(regs.map(r => r.unregister()));
  alert('캐시 초기화 완료. 페이지를 새로고침합니다.');
  location.reload();
}

// ══════════════════════════════════════════════════════════════
// ① 이전 대화 기록
// ══════════════════════════════════════════════════════════════
export function openChatHistory() {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  // 모든 날짜의 기록 수집
  const allSessions = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(`gopang_history_${guid}`)) continue;
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    allSessions.push(...entries.filter(e => e.domain === 'P2P' || e.peerHandle));
  }
  allSessions.sort((a, b) => new Date(b.ts) - new Date(a.ts));

  _openSheet('이전 대화 기록', _renderHistoryList(allSessions));
}

function _renderHistoryList(sessions) {
  if (!sessions.length) {
    return '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">대화 기록이 없습니다.</div>';
  }
  return sessions.map((s, i) => `
    <div onclick="_openChatDetail(${i})" data-idx="${i}"
         style="padding:14px 16px;border-bottom:1px solid #f2f2f7;cursor:pointer;display:flex;align-items:center;gap:12px">
      <div style="width:40px;height:40px;border-radius:50%;background:#f0fdf4;
                  display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">💬</div>
      <div style="flex:1;min-width:0">
        <div style="font-size:15px;font-weight:500;color:#111827">${s.peerHandle || '알 수 없음'}</div>
        <div style="font-size:12px;color:#9ca3af;margin-top:2px">
          ${new Date(s.ts).toLocaleString('ko-KR')} · ${s.turns}턴
        </div>
      </div>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c7c7cc" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
  `).join('');
}

window._openChatDetail = async function(idx) {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  // IndexedDB에서 원본 찾기
  const allSessions = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(`gopang_history_${guid}`)) continue;
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    allSessions.push(...entries.filter(e => e.domain === 'P2P' || e.peerHandle));
  }
  allSessions.sort((a, b) => new Date(b.ts) - new Date(a.ts));
  const session = allSessions[idx];
  if (!session) return;

  // IndexedDB에서 원문 조회
  let messages = session.summary || [];
  try {
    const db = await new Promise(r => { const req = indexedDB.open('gopang_pdv_dev'); req.onsuccess = e => r(e.target.result); });
    const tx = db.transaction('messages', 'readonly');
    const rec = await new Promise(r => { const req = tx.objectStore('messages').get(session.sessionId); req.onsuccess = e => r(e.target.result); });
    if (rec?.content) {
      const data = JSON.parse(rec.content);
      messages = data.messages || messages;
    }
  } catch(e) {}

  const html = `
    <div style="padding:0">
      <div style="padding:12px 16px;border-bottom:1px solid #f2f2f7;display:flex;align-items:center;gap:10px">
        <button onclick="openChatHistory()" style="border:none;background:none;color:#16a34a;font-size:15px;cursor:pointer;padding:0">← 목록</button>
        <span style="font-size:15px;font-weight:600">${session.peerHandle || '대화'}</span>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:8px">
        ${messages.map(m => m.role === 'me' || m.role === 'user'
          ? `<div style="display:flex;justify-content:flex-end">
               <div style="background:#16a34a;color:#fff;padding:8px 12px;border-radius:16px 16px 4px 16px;max-width:70%;font-size:14px">${m.content}</div>
             </div>`
          : `<div style="display:flex;justify-content:flex-start">
               <div style="background:#f3f4f6;color:#111827;padding:8px 12px;border-radius:16px 16px 16px 4px;max-width:70%;font-size:14px">${m.content}</div>
             </div>`
        ).join('')}
      </div>
    </div>`;

  document.getElementById('_gopang-sheet-body').innerHTML = html;
};

// ══════════════════════════════════════════════════════════════
// ② Hash Chain 보기
// ══════════════════════════════════════════════════════════════
export function openHashChain() {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  // localStorage의 history에서 entryHash 수집
  const chains = [];
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(`gopang_history_${guid}`)) continue;
    const entries = JSON.parse(localStorage.getItem(key) || '[]');
    for (const e of entries) {
      if (e.entryHash) chains.push(e);
    }
  }
  chains.sort((a, b) => new Date(b.ts) - new Date(a.ts));

  const html = chains.length === 0
    ? '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">Hash Chain 기록이 없습니다.</div>'
    : chains.map((c, i) => `
      <div style="padding:12px 16px;border-bottom:1px solid #f2f2f7">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-size:11px;background:#f0fdf4;color:#16a34a;padding:2px 6px;border-radius:4px;font-weight:600">
            ${i === chains.length - 1 ? 'Genesis' : 'L' + (i + 1)}
          </span>
          <span style="font-size:11px;color:#9ca3af">${new Date(c.ts).toLocaleString('ko-KR')}</span>
        </div>
        <div style="font-family:monospace;font-size:11px;color:#374151;word-break:break-all;background:#f9fafb;padding:6px 8px;border-radius:6px">
          ${c.entryHash}
        </div>
        <div style="font-size:11px;color:#9ca3af;margin-top:4px">
          ${c.peerHandle ? `P2P: ${c.peerHandle}` : c.domain || ''} · ${c.turns || 0}턴
        </div>
      </div>`).join('');

  _openSheet('Hash Chain', html);
}

// ══════════════════════════════════════════════════════════════
// ③ Gopang Wallet
// ══════════════════════════════════════════════════════════════
export async function openGopangWallet() {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const guid = user.ipv6 || '';

  _openSheet('Gopang Wallet', '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">로딩 중...</div>');

  try {
    const { PROXY } = await import('../core/state.js');
    // Supabase에서 fs_ledger 조회
    const { _SUPABASE_URL, _SUPABASE_KEY } = await import('../core/state.js').catch(() => ({}));

    // extra.fs에서 잔액 조회
    const profileRes = await fetch(`${PROXY}/profile?guid=${encodeURIComponent(guid)}`);
    const profileData = await profileRes.json().catch(() => ({}));
    const fs = profileData.profile?.extra?.public?.finance?.fs || {};
    const balance = fs['bs-cash'] ?? 0;

    // pdv_log에서 거래 기록 조회
    const pdvRes = await fetch(`${PROXY}/pdv/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: {
          svc: 'gopang', ipv6: guid,
          scope: ['kmarket'],
          period: { start: '2026-01-01', end: new Date().toISOString().slice(0,10) },
          auth_token: { level: 'L0', exp: Math.floor(Date.now()/1000) + 3600 },
        }
      })
    }).catch(() => null);

    const html = `
      <div style="padding:20px 16px;border-bottom:1px solid #f2f2f7;text-align:center">
        <div style="font-size:32px;font-weight:700;color:#111827">₮${balance.toLocaleString()}</div>
        <div style="font-size:13px;color:#9ca3af;margin-top:4px">GDC 잔액</div>
        <div style="display:flex;gap:16px;margin-top:12px;justify-content:center">
          <div style="text-align:center">
            <div style="font-size:16px;font-weight:600;color:#dc2626">-₮${(fs['pl-purchase'] || 0).toLocaleString()}</div>
            <div style="font-size:11px;color:#9ca3af">지출</div>
          </div>
          <div style="width:1px;background:#f2f2f7"></div>
          <div style="text-align:center">
            <div style="font-size:16px;font-weight:600;color:#16a34a">+₮${(fs['pl-revenue'] || 0).toLocaleString()}</div>
            <div style="font-size:11px;color:#9ca3af">수입</div>
          </div>
        </div>
      </div>
      ${fs['last_tx_id'] ? `
      <div style="padding:0">
        <div style="padding:10px 16px;font-size:12px;color:#9ca3af;font-weight:600">최근 거래</div>
        <div onclick="_openWalletTxDetail()" style="padding:14px 16px;border-bottom:1px solid #f2f2f7;cursor:pointer;display:flex;align-items:center;gap:12px">
          <div style="width:40px;height:40px;border-radius:50%;background:#fef2f2;display:flex;align-items:center;justify-content:center;font-size:18px">💸</div>
          <div style="flex:1">
            <div style="font-size:14px;color:#111827">${fs['last_tx_id']?.slice(0,20)}...</div>
            <div style="font-size:12px;color:#9ca3af">${fs['last_updated_at'] ? new Date(fs['last_updated_at']).toLocaleString('ko-KR') : ''}</div>
          </div>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#c7c7cc" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>` : '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:13px">거래 내역이 없습니다.</div>'}`;

    document.getElementById('_gopang-sheet-body').innerHTML = html;
  } catch(e) {
    document.getElementById('_gopang-sheet-body').innerHTML =
      '<div style="padding:40px 16px;text-align:center;color:#ef4444;font-size:13px">데이터 로드 실패</div>';
  }
}

window._openWalletTxDetail = async function() {
  const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  const profileRes = await fetch(`https://gopang-proxy.tensor-city.workers.dev/profile?guid=${encodeURIComponent(user.ipv6)}`);
  const profileData = await profileRes.json().catch(() => ({}));
  const fs = profileData.profile?.extra?.public?.finance?.fs || {};

  let txRecord = {};
  try { txRecord = JSON.parse(fs['last_tx_record'] || '{}'); } catch {}

  const html = `
    <div style="padding:0">
      <div style="padding:12px 16px;border-bottom:1px solid #f2f2f7;display:flex;align-items:center;gap:10px">
        <button onclick="openGopangWallet()" style="border:none;background:none;color:#16a34a;font-size:15px;cursor:pointer;padding:0">← 뒤로</button>
        <span style="font-size:15px;font-weight:600">거래 상세</span>
      </div>
      <div style="padding:16px;display:flex;flex-direction:column;gap:10px">
        ${Object.entries({
          '거래 ID':    fs['last_tx_id'] || '-',
          '거래 시각':  fs['last_updated_at'] ? new Date(fs['last_updated_at']).toLocaleString('ko-KR') : '-',
          '상품명':     txRecord.item_name || '-',
          '금액':       txRecord.total ? `₮${Number(txRecord.total).toLocaleString()}` : '-',
          '수수료':     txRecord.fee   ? `₮${Number(txRecord.fee).toLocaleString()}` : '-',
          '거래 상대':  txRecord.seller_guid ? txRecord.seller_guid.slice(0,20) + '...' : '-',
          'Block Hash': fs['last_block_hash'] ? fs['last_block_hash'].slice(0,24) + '...' : '-',
        }).map(([k, v]) => `
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f9fafb">
            <span style="font-size:13px;color:#6b7280">${k}</span>
            <span style="font-size:13px;color:#111827;font-family:${k.includes('Hash') || k.includes('ID') ? 'monospace' : 'inherit'};word-break:break-all;text-align:right;max-width:60%">${v}</span>
          </div>`).join('')}
      </div>
    </div>`;

  document.getElementById('_gopang-sheet-body').innerHTML = html;
};

// ══════════════════════════════════════════════════════════════
// ④ 재무제표 (4탭: 대차대조표 / 손익계산서 / 현금흐름표 / 재무분석)
// ══════════════════════════════════════════════════════════════
export async function openFinancialStatement() {
  _openSheet('재무제표', '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">로딩 중...</div>');

  try {
    const user = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
    const guid = user.ipv6 || '';

    const profileRes = await fetch(`https://gopang-proxy.tensor-city.workers.dev/profile?guid=${encodeURIComponent(guid)}`);
    const profileData = await profileRes.json().catch(() => ({}));
    const fs = profileData.profile?.extra?.public?.finance?.fs || {};

    const bsCash     = fs['bs-cash']     || 0;
    const plPurchase = fs['pl-purchase'] || 0;
    const plRevenue  = fs['pl-revenue']  || 0;
    const netIncome  = plRevenue - plPurchase;
    const lastUpdated = fs['last_updated_at']
      ? new Date(fs['last_updated_at']).toLocaleString('ko-KR')
      : '거래 없음';

    const _row = (label, val, cls='', bold=false) => `
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:0.5px solid #f2f2f7">
        <span style="font-size:13px;color:${bold?'#111827':'#6b7280'};font-weight:${bold?'600':'400'}">${label}</span>
        <span style="font-size:13px;font-weight:${bold?'700':'500'};color:${cls==='green'?'#16a34a':cls==='red'?'#dc2626':'#111827'}">${val}</span>
      </div>`;

    const _card = (rows) =>
      `<div style="background:#f9fafb;border-radius:10px;padding:4px 12px;margin-bottom:14px">${rows}</div>`;

    const _title = (text, color='#16a34a') =>
      `<div style="font-size:12px;font-weight:600;color:#374151;margin:12px 0 6px;
                   padding-bottom:4px;border-bottom:2px solid ${color}">${text}</div>`;

    const _notice = `<div style="text-align:center;font-size:11px;color:#9ca3af;padding:8px 0">마지막 갱신: ${lastUpdated}</div>`;

    // ── 탭별 콘텐츠 ──────────────────────────────────────────
    const tabs = {
      bs: `
        ${_title('대차대조표 (Balance Sheet)', '#16a34a')}
        ${_card(
          _row('자산 · 현금 (bs-cash)', '₮' + bsCash.toLocaleString()) +
          _row('자산 합계', '₮' + bsCash.toLocaleString(), 'green', true)
        )}
        ${_title('부채 및 자본', '#3b82f6')}
        ${_card(
          _row('부채 합계', '₮0') +
          _row('자본 (순자산)', '₮' + bsCash.toLocaleString()) +
          _row('부채 + 자본 합계', '₮' + bsCash.toLocaleString(), 'green', true)
        )}
        ${_notice}`,

      pl: `
        ${_title('손익계산서 (P&L)', '#3b82f6')}
        ${_card(
          _row('수입 (pl-revenue)', '+₮' + plRevenue.toLocaleString(), 'green') +
          _row('지출 (pl-purchase)', '-₮' + plPurchase.toLocaleString(), 'red') +
          _row('순이익', (netIncome >= 0 ? '+' : '') + '₮' + netIncome.toLocaleString(),
               netIncome >= 0 ? 'green' : 'red', true)
        )}
        ${_notice}`,

      cf: `
        ${_title('현금흐름표 (Cash Flow)', '#8b5cf6')}
        ${_card(
          _row('영업 활동 현금흐름', '₮' + netIncome.toLocaleString(), netIncome >= 0 ? 'green' : 'red') +
          _row('투자 활동 현금흐름', '₮0') +
          _row('재무 활동 현금흐름', '₮0') +
          _row('순 현금 증감', (netIncome >= 0 ? '+' : '') + '₮' + netIncome.toLocaleString(),
               netIncome >= 0 ? 'green' : 'red', true)
        )}
        ${_title('현금 잔액', '#8b5cf6')}
        ${_card(
          _row('기초 현금', '₮0') +
          _row('기말 현금', '₮' + bsCash.toLocaleString(), 'green', true)
        )}
        ${_notice}`,

      fa: `
        ${_title('재무분석 (Financial Analysis)', '#f59e0b')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:14px">
          ${[
            ['수익률', plRevenue > 0 ? ((netIncome/plRevenue)*100).toFixed(1)+'%' : '0%', netIncome >= 0 ? '#16a34a' : '#dc2626'],
            ['유동비율', '100%', '#16a34a'],
            ['부채비율', '0%', '#111827'],
            ['총거래 횟수', (fs['last_tx_id'] ? '1건+' : '0건'), '#111827'],
          ].map(([label, val, color]) => `
            <div style="background:#f9fafb;border-radius:10px;padding:12px">
              <div style="font-size:11px;color:#9ca3af;margin-bottom:4px">${label}</div>
              <div style="font-size:18px;font-weight:500;color:${color}">${val}</div>
            </div>`).join('')}
        </div>
        ${_card(
          _row('총 수입', '+₮' + plRevenue.toLocaleString(), 'green') +
          _row('총 지출', '-₮' + plPurchase.toLocaleString(), 'red') +
          _row('평균 거래금액', fs['last_tx_id'] ? '₮' + plRevenue.toLocaleString() : '₮0') +
          _row('순자산', '₮' + bsCash.toLocaleString(), bsCash >= 0 ? 'green' : 'red', true)
        )}
        ${_notice}`,
    };

    // ── 탭 UI ────────────────────────────────────────────────
    const html = `
      <div>
        <div id="_fs-tabs" style="display:flex;border-bottom:0.5px solid #f2f2f7;background:#f9fafb">
          ${[['bs','대차대조표'],['pl','손익계산서'],['cf','현금흐름표'],['fa','재무분석']].map(([id,label],i) => `
            <button onclick="_fsSwitchTab('${id}')" id="_fs-tab-${id}"
              style="flex:1;padding:10px 2px;font-size:11px;font-weight:${i===0?'600':'400'};
                     color:${i===0?'#16a34a':'#9ca3af'};background:${i===0?'#fff':'transparent'};
                     border:none;border-bottom:${i===0?'2px solid #16a34a':'2px solid transparent'};
                     cursor:pointer;font-family:inherit;transition:all .15s">
              ${label}
            </button>`).join('')}
        </div>
        <div id="_fs-body" style="padding:12px 16px">
          ${tabs['bs']}
        </div>
      </div>`;

    document.getElementById('_gopang-sheet-body').innerHTML = html;

    // 탭 전환 함수 전역 등록
    window._fsSwitchTab = function(id) {
      const tabData = { bs: tabs.bs, pl: tabs.pl, cf: tabs.cf, fa: tabs.fa };
      ['bs','pl','cf','fa'].forEach(t => {
        const el = document.getElementById('_fs-tab-' + t);
        if (!el) return;
        const active = t === id;
        el.style.color      = active ? '#16a34a' : '#9ca3af';
        el.style.fontWeight = active ? '600' : '400';
        el.style.background = active ? '#fff' : 'transparent';
        el.style.borderBottom = active ? '2px solid #16a34a' : '2px solid transparent';
      });
      const body = document.getElementById('_fs-body');
      if (body) body.innerHTML = tabData[id];
    };

  } catch(e) {
    document.getElementById('_gopang-sheet-body').innerHTML =
      '<div style="padding:40px 16px;text-align:center;color:#ef4444;font-size:13px">데이터 로드 실패</div>';
  }
}

// ══════════════════════════════════════════════════════════════
// 공통 시트 패널
// ══════════════════════════════════════════════════════════════
function _openSheet(title, html) {
  let sheet = document.getElementById('_gopang-bottom-sheet');
  if (!sheet) {
    sheet = document.createElement('div');
    sheet.id = '_gopang-bottom-sheet';
    sheet.style.cssText = [
      'position:fixed;inset:0;z-index:10000',
      'background:#fff',
      'display:flex;flex-direction:column',
      'transform:translateY(100%)',
      'transition:transform 0.3s ease',
    ].join(';');
    sheet.innerHTML = `
      <div style="display:flex;align-items:center;padding:14px 16px;border-bottom:1px solid #f2f2f7;flex-shrink:0">
        <button id="_gopang-sheet-close"
          style="border:none;background:none;font-size:15px;color:#16a34a;cursor:pointer;padding:0;font-family:inherit">
          닫기
        </button>
        <div id="_gopang-sheet-title" style="flex:1;text-align:center;font-size:16px;font-weight:600"></div>
        <div style="width:36px"></div>
      </div>
      <div id="_gopang-sheet-body" style="flex:1;overflow-y:auto"></div>`;
    document.body.appendChild(sheet);
    document.getElementById('_gopang-sheet-close').onclick = () => {
      sheet.style.transform = 'translateY(100%)';
    };
  }

  document.getElementById('_gopang-sheet-title').textContent = title;
  document.getElementById('_gopang-sheet-body').innerHTML = html;
  requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });
}
