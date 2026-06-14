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
        g.innerHTML = '👤 아이디를 등록하면 AI 비서와 P2P 채팅을 사용할 수 있습니다.';
        idSec.insertBefore(g, idSec.firstChild);
      }
    } else {
      document.getElementById('_id-section-guide')?.remove();
    }
  }

  // 4. GDC Wallet 섹션: GDC 사용자만 표시
  const gdcSec = document.getElementById('gdc-wallet-section');
  if (gdcSec) gdcSec.style.display = isGDC ? 'block' : 'none';

  // 5. AI 설정 버튼: 등록 사용자만 표시
  const aiBtn = document.getElementById('btn-ai-settings');
  if (aiBtn) aiBtn.style.display = registered ? 'block' : 'none';

  // 6. 로그아웃 버튼: 등록 사용자만 표시
  const logoutBtn = document.getElementById('btn-logout-or-login');
  if (logoutBtn) logoutBtn.style.display = registered ? 'block' : 'none';

  // 7. 기기 초기화 버튼: 등록 사용자만 표시
  const resetBtn = document.getElementById('btn-device-reset');
  if (resetBtn) resetBtn.style.display = registered ? 'block' : 'none';

  // 8. LLM 섹션: 항상 숨김 (AI 설정 슬라이드로 이동)
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
    if (levelEl) levelEl.textContent = '⚠️ 미등록 사용자';
    return;
  }

  if (levelEl) levelEl.innerHTML =
    `<span style="font-size:13px;color:var(--green)">✅ ${stored.handle || stored.ipv6}</span>`;
  if (idEl) idEl.textContent = '';
}

// ── 설정에서 아이디 등록 버튼 ────────────────────────────
export async function _settingsRegisterHandle() {
  const inp  = document.getElementById('gopang-id-input');
  const name = inp?.value?.trim() || '';
  if (!name) { inp?.focus(); return; }

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
