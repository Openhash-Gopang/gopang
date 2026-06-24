/**
 * ui/welcome.js — 초기 환영 메시지 + Profile 온보딩 트리거
 * - Profile 미완성: AI 비서에게 온보딩 시작 메시지를 주입
 * - Profile 완성: 닉네임 표시 후 일상 비서 모드
 */
import { appendBubble } from './bubble.js';
import { _USER } from '../core/state.js';
import { callAI } from '../ai/call-ai.js';
import { loadPersonalAssistantSP, resetSPLoader } from '../core/config.js';

// ── Profile 완성 여부 확인 ───────────────────────────────
function _isProfileDone() {
  try { return !!localStorage.getItem('hondi_profile_done'); } catch { return false; }
}

function _getProfileStep() {
  try { return localStorage.getItem('hondi_profile_step') || null; } catch { return null; }
}

// ── 초기 환영 메시지 — 첫 접속 1회만 ──────────────────
let _welcomeShown = false;
export async function _showWelcomeMessage() {
  if (_welcomeShown) return;   // 중복 호출 방지
  _welcomeShown = true;
  const list = document.getElementById('message-list');
  if (!list) return;

  // Personal Assistant SP 로드 (비동기, 캐시됨)
  await loadPersonalAssistantSP();

  const profileDone = _isProfileDone();
  const profileStep = _getProfileStep();

  // 첫 접속 안내 — localStorage 플래그로 1회만 표시
  const introShown = localStorage.getItem('hondi_intro_shown');
  if (!introShown) {
    localStorage.setItem('hondi_intro_shown', '1');
    const row = document.createElement('div');
    row.className = 'msg-row ai';
    const bubble = document.createElement('div');
    bubble.className = 'bubble bubble-ai';
    bubble.textContent = '찾기(🔍) 버튼으로 대화 상대를 검색할 수 있으며, 아래쪽 AI 버튼을 터치하거나, 화면 아래에서 위로 밀어올리면 나만의 AI 비서가 나타납니다.';
    row.appendChild(bubble);
    list.appendChild(row);
  }

  // 온보딩이 필요한 경우 — AI 패널이 열릴 때 시작 (메인 대화창에 표시 안 함)
  if (!profileDone) {
    // AI 패널 첫 열기 시 온보딩 자동 시작 플래그 설정
    const triggerMsg = profileStep
      ? `[SYSTEM] 이용자가 Profile 작성을 ${profileStep}단계에서 중단했습니다. 해당 단계부터 재개해 주세요.`
      : `[SYSTEM] 이용자의 Profile이 아직 없습니다. PHASE 1 온보딩을 시작해 주세요. STEP 1(이름 질문)부터 시작합니다.`;
    window._aiPanelOnboardingMsg = triggerMsg;
  }
}

// ── PROFILE_SUBMIT 파서 ───────────────────────────────────
// call-ai.js의 응답에서 PROFILE_SUBMIT {...} 블록을 감지하여
// Worker에 POST하고 IndexedDB PDV를 초기화
export async function handleProfileSubmit(aiResponseText) {
  const match = aiResponseText.match(/PROFILE_SUBMIT\s*(\{[\s\S]*?\})\s*(?:$|\n)/);
  if (!match) return false;

  let profile;
  try { profile = JSON.parse(match[1]); } catch (e) {
    console.warn('[Profile] PROFILE_SUBMIT JSON 파싱 실패:', e.message);
    return false;
  }

  // 사용자 GUID 주입
  const user = _USER || JSON.parse(localStorage.getItem('gopang_user_v4') || '{}');
  if (user?.ipv6) profile.guid = user.ipv6;
  if (user?.handle) profile.handle = profile.handle || user.handle;

  // 판매자 AI 비서 endpoint 설정 (사업자일 때)
  if (profile.entity_type === 'business' && profile.handle) {
    const ep = `https://market.gopang.net/webapp.html?seller=${profile.handle}`;
    const aiCfg = profile.extra?.public?.ai_assistant;
    if (aiCfg) {
      aiCfg.seller_ai_endpoint = ep;
      aiCfg.seller_guid = profile.guid || '';
    }
  }

  const PROXY = 'https://gopang-proxy.tensor-city.workers.dev';

  try {
    const res = await fetch(`${PROXY}/profile`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.detail || data.error || 'Profile 등록 실패');

    // ── 완성 플래그 설정 ──
    localStorage.setItem('hondi_profile_done', '1');
    localStorage.removeItem('hondi_profile_step');
    console.info('[Profile] 등록 완료:', profile.handle);

    // ── SP 로더 리셋 — 다음 loadPersonalAssistantSP() 호출 시 그림자 SP fresh fetch ──
    // _paSPLoaded=true가 유지되면 온보딩 SP가 세션 내내 고정되는 버그 방지
    resetSPLoader();

    // ── 위임 인증서 서명 (본인 키로 그림자 위임) ──
    // data.agent가 있을 때만 시도. 실패해도 가입 자체는 완료로 처리.
    if (data.agent?.ok && data.agent?.guid) {
      _triggerDelegationSignature(data.agent.guid, profile.guid || user?.ipv6).catch(
        e => console.warn('[Delegation] 위임 서명 실패 (비치명적):', e.message)
      );
    }

    // ── PDV IndexedDB 초기화 ──
    await _initPDV(profile.guid);

    // ── 그림자 SP 즉시 로드 (플래그 리셋 직후) ──
    await loadPersonalAssistantSP();

    return true;
  } catch (e) {
    console.error('[Profile] 등록 오류:', e.message);
    appendBubble('ai', `⚠️ 프로필 등록 중 오류가 발생했습니다: ${e.message}\n잠시 후 다시 시도해 주세요.`);
    return false;
  }
}

// ── PDV IndexedDB 초기화 ─────────────────────────────────
async function _initPDV(guid) {
  try {
    const DB_NAME    = 'hondi-pdv';
    const DB_VERSION = 1;
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // 대화·거래·Agent 보고서 저장소
      if (!db.objectStoreNames.contains('records')) {
        const store = db.createObjectStore('records', { keyPath: 'id', autoIncrement: true });
        store.createIndex('ts',   'ts',   { unique: false });
        store.createIndex('type', 'type', { unique: false });
        store.createIndex('guid', 'guid', { unique: false });
      }
      // Hash Chain 저장소
      if (!db.objectStoreNames.contains('hash_chain')) {
        db.createObjectStore('hash_chain', { keyPath: 'entryHash' });
      }
    };

    await new Promise((resolve, reject) => {
      req.onsuccess = resolve;
      req.onerror   = reject;
    });

    // 초기화 레코드 삽입
    const db = req.result;
    const tx  = db.transaction('records', 'readwrite');
    tx.objectStore('records').add({
      ts:      new Date().toISOString(),
      type:    'pdv_init',
      guid:    guid || '',
      summary: 'PDV IndexedDB 초기화 완료',
      content: { db: DB_NAME, version: DB_VERSION },
    });
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onerror    = reject;
    });

    console.info('[PDV] IndexedDB 초기화 완료 | DB:', DB_NAME, '| GUID:', guid?.slice(0, 16));
    appendBubble('ai', '✅ 로컬 데이터 저장소(PDV)가 준비되었습니다. 이제 모든 대화와 거래가 이 기기에 안전하게 기록됩니다.');
  } catch (e) {
    console.warn('[PDV] IndexedDB 초기화 실패:', e.message);
  }
}


// ── 위임 인증서 서명 헬퍼 ─────────────────────────────────────────────
// PROFILE_SUBMIT 완료 후 본인 지갑 키로 그림자를 위임 서명한다.
// window.gopangWallet.signPayload가 없으면 조용히 건너뜀.
async function _triggerDelegationSignature(agentGuid, principalGuid) {
  const PROXY = 'https://gopang-proxy.tensor-city.workers.dev';
  const wallet = window.gopangWallet;
  if (!wallet?.signPayload || typeof wallet.signPayload !== 'function') {
    console.warn('[Delegation] gopangWallet 미준비 — 위임 서명 건너뜀');
    return;
  }

  const delegateMsg = `delegate:${agentGuid}:${principalGuid}`;
  const signature   = await wallet.signPayload(delegateMsg);
  const pubkey      = wallet.publicKeyB64u || wallet.publicKeyB64 || '';

  const res = await fetch(`${PROXY}/profile/delegate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      principal_guid: principalGuid,
      agent_guid:     agentGuid,
      pubkey,
      signature,
    }),
  });

  const result = await res.json().catch(() => ({}));
  if (result.ok) {
    console.info('[Delegation] 위임 인증서 등록 완료 ✅', agentGuid);
  } else {
    console.warn('[Delegation] 서버 거부:', result.error, result.detail);
  }
}
