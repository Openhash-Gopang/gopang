/**
 * ui/settings.js — 설정 패널
 */
import { CFG, loadSettings } from '../core/config.js';
import { _isRegistered } from '../core/auth.js';
import { _USER } from '../core/state.js';
import { appendBubble } from './bubble.js';

// saveSettings는 이 파일에 직접 구현됨

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
  if (typeof _updateLogoutBtn === 'function') _updateLogoutBtn();

  // LLM 섹션: 등록 사용자만 표시
  const llmSec = document.getElementById('llm-settings-section');
  if (llmSec) llmSec.style.display = registered ? 'block' : 'none';

  // 고팡 아이디 섹션: 항상 표시
  const idSec = document.getElementById('gopang-id-section');
  if (idSec) {
    idSec.style.display = 'block';
    if (!registered) {
      // 등록 유도 안내
      if (!document.getElementById('_id-section-guide') && idSec) {
        const g = document.createElement('p');
        g.id = '_id-section-guide';
        g.style.cssText = 'font-size:12px;color:#16a34a;font-weight:600;margin-bottom:8px;' +
                          'background:#dcfce7;border-radius:8px;padding:8px 10px;line-height:1.5';
        g.innerHTML = '👤 아이디를 등록하면 AI 비서와 P2P 채팅, GDC 결제를 사용할 수 있습니다.';
        idSec.insertBefore(g, idSec.firstChild);
      }
    }
  }

  if (registered) {
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
  }

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

// ── 보안 섹션 업데이트 ───────────────────────────────────
export function _updateSecuritySection() {
  const stored  = JSON.parse(localStorage.getItem('gopang_user_v3') || 'null');
  const levelEl = document.getElementById('auth-level-display');
  const idEl    = document.getElementById('gopang-id-display');
  const fpBtn   = document.getElementById('btn-register-fp');

  // 얼굴·지문 인증 버튼 숨김 (GDC 사용 시에만 필요)
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
