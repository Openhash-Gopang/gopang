/**
 * ui/welcome.js — PROFILE_SUBMIT 처리 + PDV 초기화 + 본인 검증 헬퍼
 *
 * v1.6 — "가입 직후 PA가 자동으로 끼어든다"는 기존 설계를 폐기했다.
 * 이제 첫 대화의 이름짓기·프로필 작성 안내는 AGENT-COMMON이
 * call-ai.js의 _buildFirstContactContext()를 통해 직접 처리하고,
 * "프로필 작성"은 설정 화면에서 사용자가 자유 텍스트를 입력해 직접
 * 시작하는 별도 흐름이다(settings.js의 openProfileComposer() 참조).
 * 이 파일은 더 이상 온보딩을 트리거하지 않는다 — PROFILE_SUBMIT 처리와
 * PDV 초기화, 핸드셰이크 본인 검증 헬퍼만 남는다.
 */
import { appendBubble } from './bubble.js';
import { _USER } from '../core/state.js';
import { loadPersonalAssistantSP, resetSPLoader } from '../core/config.js';

// ── 초기 환영 메시지 — 더 이상 아무 일도 하지 않음 (v1.6) ──────────
// gopang-app.js가 부팅 시 호출하는 기존 진입점과의 호환을 위해 함수
// 자체는 남겨둔다. PA 자동 트리거(window._aiPanelOnboardingMsg 설정,
// openAIPanel() 강제 호출)는 전부 삭제했다 — 이제 "나만의 AI 비서"는
// 항상 AGENT-COMMON으로 시작하고, 프로필 작성은 설정에서 사용자가
// 명시적으로 시작한다.
let _welcomeShown = false;
export async function _showWelcomeMessage() {
  if (_welcomeShown) return;   // 중복 호출 방지
  _welcomeShown = true;
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
    const ep = `https://market.hondi.net/webapp.html?seller=${profile.handle}`;
    const aiCfg = profile.extra?.public?.ai_assistant;
    if (aiCfg) {
      aiCfg.seller_ai_endpoint = ep;
      aiCfg.seller_guid = profile.guid || '';
    }
  }

  const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

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

    // ── SP 로더 리셋 — 다음 loadPersonalAssistantSP() 호출 시 SP fresh fetch ──
    // _paSPLoaded=true가 유지되면 온보딩 SP가 세션 내내 고정되는 버그 방지
    resetSPLoader();

    // 2026-07-01: 위임 인증서 서명 단계 제거. 별도 그림자 정체성(별도
    // guid·키쌍)을 더 이상 만들지 않으므로(worker.js _mergeAgentSP 참조),
    // "위임"이라는 개념 자체가 무의미해졌다 — 단일 정체성이고, 운영자
    // 본인인지는 핸드셰이크(GET /profile/verify-owner)로 실시간 확인한다.

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


// ── 본인 검증 헬퍼 (핸드셰이크 실시간 판단용) ────────────────────────
// 2026-07-01: 옛 _triggerDelegationSignature(위임 인증서 서명, 1회성)를
// 대체. 별도 그림자 정체성이 없어졌으므로 "위임"은 더 이상 의미가 없고,
// 대신 대화 시작 시(AGENT-COMMON §4 핸드셰이크) "지금 상대가 본인인지"를
// 그때그때 묻는다. gopang-wallet.js의 sign()/verify()와 동일한 서명
// 체계 — 전체 시스템이 서명 체계를 하나만 공유한다는 원칙을 그대로 따름.
// 호출부(call-ai.js 등)에서 AI가 [VERIFY_OWNER] 태그를 출력하면 이 함수를
// 불러 결과를 다시 AI에게 시스템 메시지로 전달하는 식으로 와이어링한다.
export async function verifyOwnerHandshake(principalGuid) {
  const PROXY = 'https://hondi-proxy.tensor-city.workers.dev';
  const wallet = window.gopangWallet;
  if (!wallet?.signPayload || typeof wallet.signPayload !== 'function') {
    console.warn('[Handshake] gopangWallet 미준비 — 본인 검증 불가, false 처리');
    return { verified: false, reason: 'WALLET_NOT_READY' };
  }

  const ts = String(Math.floor(Date.now() / 1000));
  const sigMsg    = `VERIFY-OWNER:${principalGuid}:${ts}`;
  const signature = await wallet.signPayload(sigMsg);
  const pubkey    = wallet.publicKeyB64u || wallet.publicKeyB64 || '';

  const qs = new URLSearchParams({ guid: principalGuid, pubkey, signature, ts });
  try {
    const res = await fetch(`${PROXY}/profile/verify-owner?${qs.toString()}`, { cache: 'no-cache' });
    const result = await res.json().catch(() => ({}));
    if (result.ok) {
      console.info('[Handshake] 본인 검증 결과:', result.verified);
      return { verified: !!result.verified, reason: result.reason || null };
    }
    console.warn('[Handshake] 서버 거부:', result.error, result.detail);
    return { verified: false, reason: result.error || 'SERVER_ERROR' };
  } catch (e) {
    console.warn('[Handshake] 본인 검증 요청 실패:', e.message);
    return { verified: false, reason: 'NETWORK_ERROR' };
  }
}
