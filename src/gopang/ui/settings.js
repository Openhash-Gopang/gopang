/**
 * ui/settings.js — 설정 패널
 */
import { CFG, loadSettings, PROVIDER_INFO } from '../core/config.js';
import { buildLiveFreeModelPool } from '../core/free-model-pool.js';
import { _isRegistered, _isGDCUser, ensureX25519Synced } from '../core/auth.js';
import { _USER } from '../core/state.js';
import { appendBubble } from './bubble.js';

// ── 핸들 칩 업데이트 ────────────────────────────────────
export function _updateHandleChip(h) {
  const c = document.getElementById('my-handle-chip');
  if (c) c.textContent = h || 'Guest';

  const s = document.getElementById('gopang-id-status');
  const b = document.getElementById('gopang-id-register-box');
  if (h) {
    const nickname = _USER?.nickname || _USER?.name || '';
    const nickPrefix = nickname ? `${nickname} ` : '';
    if (s) s.innerHTML = `${nickPrefix}<b style="color:var(--green,#16a34a)">${h}</b>`;
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
      const nickPrefix = s.nickname ? `${s.nickname} ` : '';
      idStatus.innerHTML = `${nickPrefix}<b style="color:var(--green,#16a34a)">${s.handle}</b>`;
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
  const aiCard      = document.getElementById('_ai-card');
  const aiLabel     = document.getElementById('_ai-label');
  const profileCard = document.getElementById('_profile-card');
  if (profileCard) profileCard.style.display = registered ? 'block' : 'none';
  if (aiCard)  aiCard.style.display  = registered ? 'block' : 'none';
  if (aiLabel) aiLabel.style.display = registered ? 'block' : 'none';

  // 6. 계정 완전 삭제 카드: 등록 사용자만 표시 (열 때마다 입력값 초기화)
  const deleteCard = document.getElementById('card-account-delete');
  if (deleteCard) deleteCard.style.display = registered ? 'block' : 'none';
  const nickIn = document.getElementById('delete-confirm-nickname');
  const hIn    = document.getElementById('delete-confirm-handle');
  const delBtn = document.getElementById('btn-device-full-reset');
  if (nickIn) nickIn.value = '';
  if (hIn)    hIn.value = '';
  if (delBtn) { delBtn.disabled = true; delBtn.style.background = '#fca5a5'; delBtn.style.cursor = 'not-allowed'; }

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
  const sysEl = document.getElementById('setting-system');
  if (sysEl) sysEl.value = CFG.system;
  document.getElementById('ai-settings-overlay')?.classList.add('open');

  // ── X25519 자동 부트스트랩 (공장초기화 후 첫 진입 시 자동 개시) ──
  // PC(ai-setup.html)가 이 공개키로 API 설정을 암호화해 보낼 수 있도록
  // 설정 창을 열 때마다 보장 — 이미 있으면 아무 일도 하지 않음
  _ensurePcSyncReady();
}

// ── "모델 갱신" 버튼 — 이미 등록된 OpenRouter 무료 모델 풀을
// 현재 시점 기준으로 다시 검증해 단종된 모델을 빼고 새 무료 모델을 채운다.
// PC에서 최초 등록할 때(ai-setup.html)뿐 아니라, 이미 등록을 마친 사용자도
// 폰에서 직접 갱신할 수 있도록 한다 — OpenRouter Key는 폰에 이미 저장돼 있으므로
// PC 재등록 없이 이 화면에서 바로 처리 가능.
// 결과 메시지는 대화창이 아니라 AI 설정 창의 #model-refresh-status에 표시한다
// (대화창 버블은 설정 시트 뒤에 가려져 사용자가 결과를 못 보는 문제가 있었음).
export async function _refreshFreeModelPool() {
  const btn = document.getElementById('btn-refresh-free-models');
  const statusEl = document.getElementById('model-refresh-status');
  const setStatus = (msg, color) => {
    if (statusEl) { statusEl.textContent = msg; statusEl.style.color = color || '#6b7280'; }
  };

  const openrouterEntries = Array.isArray(CFG.providers)
    ? CFG.providers.filter(p => p?.provider === 'openrouter' && p?.apiKey)
    : [];

  if (openrouterEntries.length === 0) {
    setStatus('⚠️ 등록된 OpenRouter 무료 모델이 없습니다. PC에서 "나만의 AI 비서 설정"으로 먼저 등록해 주세요.', '#dc2626');
    return;
  }

  const apiKey = openrouterEntries[0].apiKey;
  const firstIdx = CFG.providers.findIndex(p => p?.provider === 'openrouter' && p?.apiKey === apiKey);
  const wasUsingOpenrouter = typeof CFG.model === 'string' && CFG.model.includes('/');

  if (btn) { btn.disabled = true; btn.textContent = '확인 중…'; }
  setStatus('🔄 OpenRouter에서 현재 가용한 무료 모델을 확인하는 중…');

  try {
    const { pool, validated, error } = await buildLiveFreeModelPool();

    // 기존 openrouter 항목들을 제거하고, 같은 위치에 새 풀로 교체
    // (다른 provider 항목의 순서·우선순위는 그대로 유지)
    const others = CFG.providers.filter(p => !(p?.provider === 'openrouter' && p?.apiKey === apiKey));
    const insertAt = Math.min(firstIdx, others.length);
    const newEntries = pool.map(model => ({ provider: 'openrouter', model, apiKey }));
    CFG.providers = [...others.slice(0, insertAt), ...newEntries, ...others.slice(insertAt)];

    if (wasUsingOpenrouter) CFG.model = pool[0];

    try {
      localStorage.setItem('gopang_cfg', JSON.stringify({
        model: CFG.model, endpoint: CFG.endpoint,
        apiKey: CFG.apiKey, geminiKey: CFG.geminiKey,
        system: CFG.system, providers: CFG.providers,
      }));
    } catch {}

    setStatus(
      validated
        ? `✅ 무료 모델 갱신 완료 — 현재 활성 모델 ${pool.length}개를 확인했습니다.`
        : `⚠️ 실시간 확인에 실패해 기존 목록(${pool.length}개)을 유지합니다. (${error || '알 수 없는 오류'})`,
      validated ? '#16a34a' : '#d97706'
    );
  } catch (e) {
    setStatus(`⚠️ 모델 갱신 중 오류가 발생했습니다: ${e.message}`, '#dc2626');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '🔄 모델 갱신'; }
  }
}

// ── PC→휴대폰 동기화 준비: X25519 키 보장 + 등록 + 대기 중인 PC 설정 확인 ──
async function _ensurePcSyncReady() {
  const guid = _USER?.ipv6 || JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}')?.ipv6;
  if (!guid) {
    console.warn('[AI설정] guid를 찾을 수 없어 PC 동기화 안내를 건너뜁니다.');
    return;
  }

  try {
    const result = await ensureX25519Synced(guid);
    if (!result.ok) {
      console.warn('[AI설정] X25519 동기화 미완료:', result.reason || '(원인 미상)');
      const REASON_MSG = {
        guid_missing:              '사용자 식별 정보를 찾을 수 없습니다. 다시 로그인해 주세요.',
        wallet_module_not_loaded:  '지갑 모듈을 불러오지 못했습니다. 앱을 다시 열어 주세요.',
        wallet_not_found:          '지갑이 아직 생성되지 않았습니다. 잠시 후 다시 열어 주세요.',
        network:                   '네트워크 오류로 암호화 키를 등록하지 못했습니다. 잠시 후 다시 열어 주세요.',
      };
      _renderPcSyncBanner({
        _error: true,
        message: REASON_MSG[result.reason] || (result.reason || '암호화 키를 아직 준비하지 못했습니다. 설정 창을 한 번 더 열어 주세요.'),
      });
      return;
    }

    console.info('[AI설정] X25519 동기화 완료, PC 설정 확인 중...');
    _pollPcSealedSetting(guid, result.wallet);
  } catch(e) {
    console.warn('[AI설정] X25519 부트스트랩 실패:', e.message);
    _renderPcSyncBanner({ _error: true, message: '암호화 키 준비 중 오류가 발생했습니다: ' + e.message });
  }
}

// ── PC가 보낸 암호화 봉투가 있는지 확인하고, 있으면 복호화하여 안내 ──
async function _pollPcSealedSetting(guid, wallet) {
  try {
    const res  = await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}`);
    const data = await res.json();
    if (!data.ok || !data.sealed) {
      _renderPcSyncBanner({ _idle: true }, guid);
      return;
    }

    // 서버는 DB 컬럼명(snake_case)을 그대로 반환하지만, wallet.openSealed는
    // ephemeralPubKey(camelCase)를 기대한다 — 여기서 맞춰준다.
    const sealedCamel = {
      ephemeralPubKey: data.sealed.ephemeral_pubkey,
      iv:              data.sealed.iv,
      ciphertext:      data.sealed.ciphertext,
    };

    const plaintext = await wallet.openSealed(sealedCamel);
    const parsed = JSON.parse(plaintext);  // { provider, model, apiKey, systemPrompt? }
    _renderPcSyncBanner(parsed, guid);
  } catch(e) {
    console.warn('[AI설정] PC 봉투 확인 실패:', e.message);
    _renderPcSyncBanner({ _idle: true }, guid);
  }
}

// ── "PC에서 입력하세요" 안내 / "PC에서 보낸 설정이 있습니다" 배너 렌더링 ──
function _renderPcSyncBanner(parsed, guid) {
  const host = document.getElementById('btn-refresh-free-models')?.closest('.settings-body') || document.body;
  let banner = document.getElementById('_pc-sync-banner');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = '_pc-sync-banner';
    banner.style.cssText = 'margin:0 16px 12px;padding:14px 16px;border-radius:12px;font-size:13px;line-height:1.6';
    host.insertBefore(banner, host.firstChild);
  }

  if (!parsed) { banner.style.display = 'none'; return; }

  if (parsed._error) {
    banner.style.display = 'block';
    banner.style.background = '#fef2f2';
    banner.style.color = '#991b1b';
    banner.innerHTML = `⚠️ ${parsed.message}`;
    return;
  }

  // PC가 아직 아무것도 보내지 않은 기본 상태 — 단, 이미 LLM Key가 등록되어
  // 있다면(CFG.providers/apiKey/geminiKey 중 하나라도 있으면) 더 이상
  // "PC에서 등록하세요" 안내가 필요 없으므로 띄우지 않는다.
  if (parsed._idle) {
    const alreadyRegistered =
      (Array.isArray(CFG.providers) && CFG.providers.length > 0) ||
      !!CFG.apiKey || !!CFG.geminiKey;
    if (alreadyRegistered) {
      banner.style.display = 'none';
      return;
    }
    banner.style.display = 'block';
    banner.style.background = '#eff6ff';
    banner.style.color = '#1e3a8a';
    banner.innerHTML =
      `💻 API Key 입력은 PC에서 하는 것이 편리합니다.<br>` +
      `PC에서 <b>gopang.net</b> 접속 후, <b>"나만의 AI 비서 설정"</b> 버튼을 누르고,<br>` +
      `페이지의 지시대로 이행하십시오.`;
    return;
  }

  const _displayLabel = Array.isArray(parsed.freeModelPool) && parsed.freeModelPool.length
    ? 'OpenRouter (무료 모델 ' + parsed.freeModelPool.length + '개 자동 순환)'
    : (PROVIDER_INFO[parsed.provider]?.label || parsed.provider);

  banner.style.display = 'block';
  banner.style.background = '#dcfce7';
  banner.style.color = '#166534';
  banner.innerHTML = `
    🔒 PC에서 <b>${_displayLabel}</b> 설정이 암호화되어 도착했습니다.${parsed.systemPrompt ? '<br>시스템 프롬프트도 함께 도착했습니다.' : ''}<br>
    <button id="_pc-sync-accept" style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;background:#16a34a;color:#fff;font-size:12.5px;font-weight:600;cursor:pointer">이 설정으로 등록하기</button>
    <button id="_pc-sync-dismiss" style="margin-top:8px;margin-left:6px;padding:8px 14px;border:none;border-radius:8px;background:transparent;color:#166534;font-size:12.5px;cursor:pointer">무시</button>
  `;

  document.getElementById('_pc-sync-accept').onclick = async () => {
    await _acceptPcSyncedSetting(parsed, guid);
  };
  document.getElementById('_pc-sync-dismiss').onclick = async () => {
    await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}&consume=1`).catch(()=>{});
    banner.style.display = 'none';
  };
}

// ── 앱 부트스트랩 시점 자동 동기화 — AI 설정 화면을 열지 않아도 PC가 보낸
// LLM Key 설정을 확인 즉시 적용한다. 사용자 확인 버튼 없이 자동 적용.
// ── 백그라운드 수신 시 bubble 큐 — 포그라운드 복귀 시 flush ──
const _pendingBubbles = [];
let _pendingFlushRegistered = false;

function _enqueueBubble(role, text) {
  const list = document.getElementById('message-list');
  if (list) {
    // 채팅창이 이미 열려있으면 즉시 출력
    appendBubble(role, text);
    return;
  }
  // 백그라운드 상태 — 큐에 적재
  _pendingBubbles.push({ role, text });
  if (!_pendingFlushRegistered) {
    _pendingFlushRegistered = true;
    document.addEventListener('visibilitychange', function _flush() {
      if (document.visibilityState !== 'visible') return;
      const list = document.getElementById('message-list');
      if (!list) return;
      let item;
      while ((item = _pendingBubbles.shift())) {
        appendBubble(item.role, item.text);
      }
      document.removeEventListener('visibilitychange', _flush);
      _pendingFlushRegistered = false;
    });
  }
}

export async function _autoApplyPcSyncedSetting() {
  const guid = _USER?.ipv6 ||
    JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || '{}')?.ipv6;
  if (!guid) {
    console.info('[AI설정][자동] guid 없음 — 미등록 사용자, 건너뜀');
    return;
  }

  console.info('[AI설정][자동] 시작 — guid:', guid.slice(0, 12) + '...');

  let result = await ensureX25519Synced(guid);
  if (!result.ok) {
    console.warn('[AI설정][자동] X25519 1차 시도 실패:', result.reason, '— 1.5초 후 재시도');
    await new Promise(r => setTimeout(r, 1500));
    result = await ensureX25519Synced(guid);
    if (!result.ok) {
      console.error('[AI설정][자동] X25519 재시도도 실패:', result.reason, '— 자동 적용 중단');
      return;
    }
  }
  console.info('[AI설정][자동] X25519 준비 완료');

  try {
    const res  = await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}`);
    const data = await res.json();
    if (!data.ok || !data.sealed) {
      console.info('[AI설정][자동] 대기 중인 PC 설정 없음 — 정상 종료');
      return;
    }

    console.info('[AI설정][자동] PC 설정 발견 — 복호화 시도');
    const sealedCamel = {
      ephemeralPubKey: data.sealed.ephemeral_pubkey,
      iv:              data.sealed.iv,
      ciphertext:      data.sealed.ciphertext,
    };
    const plaintext = await result.wallet.openSealed(sealedCamel);
    const parsed = JSON.parse(plaintext);

    console.info('[AI설정][자동] 복호화 성공 — provider:', parsed.provider, 'model:', parsed.model);
    await _acceptPcSyncedSetting(parsed, guid, { silent: true });

    _enqueueBubble('ai', 'PC로부터 AI 키 도착 및 설정 완료. 상단 AI 버튼을 클릭하여, 자신 만의 AI 비서로 훈련하십시오.');
    console.info('[AI설정][자동] 적용 완료');
  } catch(e) {
    console.error('[AI설정][자동] 처리 중 오류:', e.message, e.stack);
  }
}

// ── PC가 보낸 설정을 휴대폰의 진짜 지갑으로 서명하여 최종 등록 ──
async function _acceptPcSyncedSetting(parsed, guid, opts = {}) {
  try {
    const wallet = await window.GopangWallet.load();
    if (!wallet) throw new Error('지갑을 찾을 수 없습니다.');

    const body = {
      guid,
      pubkey: wallet.publicKeyB64u,
      provider: parsed.provider,
      model: parsed.model,
      api_key: parsed.apiKey,
      ai_active: true,
      ...(parsed.systemPrompt && { custom_prompt: parsed.systemPrompt }),
    };
    const signature = await wallet.signPayload(JSON.stringify({ ...body, signature: undefined }));
    body.signature = signature;

    const res  = await fetch(`${CFG.endpoint}/ai-setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.detail || data.error || '등록 실패');

    // 사용 완료된 봉투는 폐기
    await fetch(`${CFG.endpoint}/ai-setup/seal?guid=${encodeURIComponent(guid)}&consume=1`).catch(()=>{});

    // 화면 갱신
    CFG.model = parsed.model;
    if (Array.isArray(parsed.freeModelPool) && parsed.freeModelPool.length) {
      // OpenRouter 등 무료 모델 풀 — CFG.providers 배열에 순서대로 등록
      // call-ai.js의 _buildCallCandidates()가 이 배열을 순차 페일오버 후보로 사용
      if (!Array.isArray(CFG.providers)) CFG.providers = [];
      CFG.providers = CFG.providers.filter(p => p.provider !== parsed.provider);
      for (const m of parsed.freeModelPool) {
        CFG.providers.push({ provider: parsed.provider, model: m, apiKey: parsed.apiKey });
      }
      console.info(`[AI설정] ${parsed.provider} 무료 모델 풀 ${parsed.freeModelPool.length}개 등록 (페일오버 순서 유지)`);
    } else if (parsed.provider === 'gemini') {
      CFG.geminiKey = parsed.apiKey;
    } else {
      CFG.apiKey = parsed.apiKey;
    }
    if (parsed.systemPrompt) CFG.system = parsed.systemPrompt;

    try {
      localStorage.setItem('gopang_cfg', JSON.stringify({
        model: CFG.model, endpoint: CFG.endpoint,
        apiKey: CFG.apiKey, geminiKey: CFG.geminiKey,
        system: CFG.system, providers: CFG.providers,
      }));
    } catch {}

    // (등록된 LLM 모델 섹션을 삭제했으므로 이 시점의 화면 갱신은 불필요)
    const sysEl = document.getElementById('setting-system');
    if (sysEl && parsed.systemPrompt) sysEl.value = parsed.systemPrompt;
    document.getElementById('_pc-sync-banner')?.style && (document.getElementById('_pc-sync-banner').style.display = 'none');
    if (!opts.silent) {
      const _doneLabel = Array.isArray(parsed.freeModelPool) && parsed.freeModelPool.length
        ? 'OpenRouter (무료 모델 ' + parsed.freeModelPool.length + '개 자동 순환)'
        : (PROVIDER_INFO[parsed.provider]?.label || parsed.provider);
      if (typeof appendBubble === 'function') appendBubble('ai', `⚙️ PC에서 보낸 ${_doneLabel} 설정이 등록되었습니다.`);
    }
  } catch(e) {
    alert('등록 중 오류가 발생했습니다: ' + e.message);
  }
}

export function closeAISettings() {
  document.getElementById('ai-settings-overlay')?.classList.remove('open');
}

export function handleAISettingsOverlayClick(e) {
  const sheet = document.querySelector('#ai-settings-overlay .settings-sheet');
  if (sheet && !sheet.contains(e.target)) closeAISettings();
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
  _updateHandleChip(_USER?.nickname || _USER?.handle || null);
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

export function openMyProfile() {
  const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || sessionStorage.getItem('gopang_user_v4') || 'null');
  const handle = stored?.handle;
  if (!handle) { alert('프로필을 먼저 등록해주세요.'); return; }
  window.open('/profile/' + handle, '_blank');
}

// ══════════════════════════════════════════════════════════════
// ⑤ 백업 키 — v6.0
// 이 기기를 잃어버리거나 바꿀 때, 같은 계정으로 다시 들어오기 위한 유일한
// 방법이다(전화번호/닉네임만으로는 더 이상 로그인되지 않음 — 의도된 동작).
// ══════════════════════════════════════════════════════════════
export async function openBackupKey() {
  _openSheet('백업 키', '<div style="padding:40px 16px;text-align:center;color:#9ca3af;font-size:14px">로딩 중...</div>');

  const html = `
    <div style="padding:20px 16px">
      <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;
                  padding:12px 14px;font-size:12px;color:#92400e;line-height:1.6;margin-bottom:20px">
        이 키를 아는 사람은 누구나 이 계정이 될 수 있습니다.<br>
        캡처/공유하지 말고, 본인만 아는 안전한 곳(예: 비밀번호 관리자)에<br>보관하세요. 고팡은 이 키를 서버에 저장하지 않습니다.
      </div>

      <p style="font-size:13px;font-weight:600;color:#111827;margin-bottom:8px">내 백업 키 내보내기</p>
      <div id="_bk-display" style="display:none;background:#f9fafb;border:1px solid #e5e7eb;
           border-radius:8px;padding:12px;font-family:monospace;font-size:12px;
           word-break:break-all;color:#111827;margin-bottom:8px"></div>
      <button id="_bk-show-btn" style="width:100%;padding:13px;border:1px solid #e5e7eb;border-radius:10px;
              background:none;color:#16a34a;font-weight:600;cursor:pointer;font-size:14px;margin-bottom:8px">
        키 표시
      </button>
      <button id="_bk-copy-btn" style="display:none;width:100%;padding:13px;border:none;border-radius:10px;
              background:#16a34a;color:#fff;font-weight:600;cursor:pointer;font-size:14px;margin-bottom:28px">
        복사
      </button>

      <div style="height:1px;background:#f2f2f7;margin-bottom:20px"></div>

      <p style="font-size:13px;font-weight:600;color:#111827;margin-bottom:4px">다른 기기의 백업 키로 복구</p>
      <p style="font-size:12px;color:#9ca3af;line-height:1.5;margin-bottom:10px">
        이 기기를 그 백업 키의 계정으로 등록합니다. 이 기기에 이미 있던<br>로컬 키는 교체됩니다.
      </p>
      <textarea id="_bk-restore-input" rows="3" placeholder="백업 키 붙여넣기"
        style="width:100%;border:1px solid #e5e7eb;border-radius:10px;padding:12px;
               font-size:13px;font-family:monospace;resize:none;box-sizing:border-box;
               margin-bottom:8px" autocomplete="off" autocorrect="off" spellcheck="false"></textarea>
      <div id="_bk-restore-err" style="display:none;font-size:12px;color:#dc2626;margin-bottom:8px"></div>
      <div id="_bk-restore-ok" style="display:none;font-size:12px;color:#16a34a;margin-bottom:8px"></div>
      <button id="_bk-restore-btn" style="width:100%;padding:13px;border:none;border-radius:10px;
              background:#111827;color:#fff;font-weight:600;cursor:pointer;font-size:14px">
        이 기기에 적용
      </button>
    </div>`;

  document.getElementById('_gopang-sheet-body').innerHTML = html;

  document.getElementById('_bk-show-btn').onclick = async () => {
    const { _exportBackupKey } = await import('../core/auth.js');
    const key = await _exportBackupKey();
    const disp = document.getElementById('_bk-display');
    if (!key) { alert('지갑을 아직 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.'); return; }
    disp.textContent = key;
    disp.style.display = 'block';
    document.getElementById('_bk-show-btn').style.display = 'none';
    document.getElementById('_bk-copy-btn').style.display = 'block';
  };

  document.getElementById('_bk-copy-btn').onclick = async () => {
    const text = document.getElementById('_bk-display').textContent;
    try {
      await navigator.clipboard.writeText(text);
      const btn = document.getElementById('_bk-copy-btn');
      btn.textContent = '복사됨';
      setTimeout(() => { btn.textContent = '복사'; }, 1500);
    } catch { alert('복사에 실패했습니다. 직접 길게 눌러 선택해 주세요.'); }
  };

  document.getElementById('_bk-restore-btn').onclick = async () => {
    const input  = document.getElementById('_bk-restore-input');
    const errEl  = document.getElementById('_bk-restore-err');
    const okEl   = document.getElementById('_bk-restore-ok');
    const btn    = document.getElementById('_bk-restore-btn');
    const val    = input.value.trim();
    errEl.style.display = 'none'; okEl.style.display = 'none';
    if (!val) { errEl.textContent = '백업 키를 입력해 주세요.'; errEl.style.display = 'block'; return; }

    btn.disabled = true; btn.textContent = '확인 중…';
    const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
    const { _restoreFromBackupKey } = await import('../core/auth.js');
    const result = await _restoreFromBackupKey(val, stored?.ipv6 || null, 'gopang');
    btn.disabled = false; btn.textContent = '이 기기에 적용';

    if (!result.ok) {
      const msg = result.reason === 'PUBKEY_MISMATCH'
        ? '이 백업 키는 현재 로그인된 계정의 키가 아닙니다.'
        : result.reason === 'invalid_key'
          ? '키 형식이 올바르지 않습니다.'
          : '적용에 실패했습니다 (' + result.reason + ').';
      errEl.textContent = msg;
      errEl.style.display = 'block';
      return;
    }
    okEl.textContent = '✅ 이 기기가 백업 키로 등록되었습니다.';
    okEl.style.display = 'block';
    input.value = '';
  };
}
