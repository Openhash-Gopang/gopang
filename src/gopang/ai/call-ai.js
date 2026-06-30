/**
 * ai/call-ai.js — LLM API 호출·스트리밍·GWP 태그 처리 + PA 온보딩 관리 v1.1
 *
 * PA 온보딩 흐름:
 *   1. _buildProfileContext() — gopang_user_v4(가입 데이터) + hondi_profile_partial(진행 중 데이터)를
 *      읽어 [CONTEXT: PROFILE_ONBOARDING] 블록 생성 → PA SP에 주입
 *      → 이미 아는 항목은 PA가 다시 묻지 않음
 *   2. _callAIInner() — profile 미완료 시 PA SP 로드 + 컨텍스트 주입
 *   3. 응답 처리 — PROFILE_SUBMIT / PROFILE_SKIP / [N/6단계] 감지 → 상태 갱신 + SP 전환
 */
import { CFG, _modelSupportsVision, PROVIDER_INFO, getPriorityOrder, MODEL_MIGRATION } from '../core/config.js';
import { TOKEN_BUDGET } from '../core/token-policy.js';
import { isModelOnCooldown, markModelFailed, recordOpenRouterCall, getOpenRouterRemainingBudget }
  from '../core/free-model-pool.js';
import { aiActive, history, _userLocation, _lastRouterResult,
         setLastRouterResult, _USER, USER_GUID, _locationPending, _locationReady } from '../core/state.js';
import { appendBubble, showTyping, hideTyping,
         _createStreamBubble, _updateStreamBubble } from '../ui/bubble.js';
import { _buildLocNote } from '../services/location.js';
import { runRouter, applyRouterResult } from './router.js';
import { _injectAuthConfirmButton } from '../core/auth.js';
import { _klawReview } from '../services/klaw.js';
import { openSearch } from '../ui/p2p-search.js';
import { inviteByHandle } from '../ui/p2p-chat.js';
import { _openProfilePanel } from '../ui/settings.js';
import { _gwpLaunch } from '../gwp/engine.js';
import { maybeHandleExpertTurn, applyExpertSystemIfActive,
         isExpertActive, handleExpertTag } from './expert-session.js';


export let history_ref = history;  // 외부 참조용

// ── manifest 기반 SP 로더 ────────────────────────────────────────────
// prompts/manifest.json 은 CI 빌드 시 tools/build_manifest.py 가 자동 생성.
// *-LATEST.txt 포인터 파일 방식을 완전 대체 — manifest 단일 체계로 통일.
const _SP_BASE = '/prompts/';
let _manifestCache = null;

async function _loadManifest() {
  if (_manifestCache) return _manifestCache;
  const res = await fetch(_SP_BASE + 'manifest.json', { cache: 'no-cache' });
  if (!res.ok) throw new Error('manifest fetch 실패: ' + res.status);
  _manifestCache = await res.json();
  return _manifestCache;
}

async function _loadSpByKey(manifestKey, label) {
  const manifest = await _loadManifest();
  const fname = manifest[manifestKey];
  if (!fname) throw new Error(`${label} manifest 키 없음: ${manifestKey}`);
  const res = await fetch(_SP_BASE + fname);
  if (!res.ok) throw new Error(`${label} SP 로드 실패: ${res.status} (${fname})`);
  const sp = await res.text();
  console.info(`[SP] ${label} 로드 완료: ${fname} (${sp.length} chars)`);
  return sp;
}

// AGENT-COMMON (그림자 AI) — 세션당 1회 캐시
let _agentCommonCache = null;
// v1.3 — export: AI 패널(webapp.html _callPanelAI)도 같은 manifest 기반 로더를
// 쓰도록 공개. 이전엔 패널 전용 하드코딩 _PA_SYSTEM_PROMPT만 썼음.
export async function _loadAgentCommonSP() {
  if (_agentCommonCache) return _agentCommonCache;
  try {
    _agentCommonCache = await _loadSpByKey('AGENT-COMMON', 'AGENT-COMMON');
    return _agentCommonCache;
  } catch (e) {
    console.warn('[SP] AGENT-COMMON 로드 실패 (빈 문자열 사용):', e.message);
    return '';
  }
}

// 온보딩 PA SP (personal-assistant 계열) — 세션당 1회 캐시
let _onboardingSpCache = null;
export async function _loadPersonalAssistantOnboardingSP() {
  if (_onboardingSpCache) return _onboardingSpCache;
  try {
    _onboardingSpCache = await _loadSpByKey('personal-assistant', 'PA-Onboarding');
    return _onboardingSpCache;
  } catch (e) {
    console.warn('[SP] PA 온보딩 SP 로드 실패 (AGENT-COMMON 사용):', e.message);
    return null;
  }
}
// klaw.js 등이 배열 참조용으로 사용 (window.history와 구분)
if (typeof window !== 'undefined') window._callAiHistoryRef = history;

// ── 응답 생성 중지(Stop) 지원 ───────────────────────────────
// 전송 버튼이 "생성 중" 상태일 때 클릭하면 stopGeneration()이 호출되어
// 현재 진행 중인 스트리밍 fetch를 중단한다 (Claude의 정지 버튼과 동일한 동작).
let _currentAbort = null;

// ══════════════════════════════════════════════════════════════
// PA 온보딩 관련 함수
// ══════════════════════════════════════════════════════════════

/**
 * _buildProfileContext — [CONTEXT: PROFILE_ONBOARDING] 블록 생성
 *
 * call-ai.js가 "이미 아는 것"을 결정하는 유일한 주체입니다.
 * 아래 데이터 소스를 순서대로 병합하여 PA SP에 주입합니다:
 *   1. gopang_user_v4 — 가입 시 등록된 필드 (guid, handle, nickname, region, e164)
 *   2. hondi_profile_partial — 온보딩 도중 저장된 진행 중 데이터
 *
 * PA SP는 [CONTEXT]에 값이 있는 항목은 절대 다시 묻지 않습니다.
 * 재호출(설정 → 프로필 작성) 시에도 동일 로직으로 미작성 항목만 진행합니다.
 *
 * v1.3 — export: AI 패널도 온보딩 중에는 이 컨텍스트를 똑같이 주입해야
 * "이미 답한 걸 또 묻는" 문제가 안 생긴다.
 */
export function _buildProfileContext() {
  // 가입 시 저장 데이터 (항상 신뢰할 수 있는 기준 데이터)
  let reg = {};
  try { reg = JSON.parse(localStorage.getItem('gopang_user_v4') || '{}'); } catch {}

  // 온보딩 진행 중 저장 데이터 (reg보다 구체적인 항목을 가질 수 있음)
  let partial = {};
  try { partial = JSON.parse(localStorage.getItem('hondi_profile_partial') || '{}'); } catch {}

  // 두 소스 병합 — reg가 기본값, partial이 덮어씀 (진행 중 데이터 우선)
  const ctx = Object.assign({}, {
    guid:     reg.ipv6   || reg.guid || '',
    handle:   reg.handle || '',
    nickname: reg.nickname || '',
    region:   reg.region || '',
    e164:     reg.e164   || '',       // 가입 시 입력한 전화번호 — 다시 묻지 않음
  }, partial);

  // 현재 단계 (없으면 0 = 최초 시작)
  const step = parseInt(localStorage.getItem('hondi_profile_step') || '0', 10);

  // [CONTEXT] 블록 조립 — 값이 있는 항목만 포함
  // v1.3 — PHASE -1(최초 인사)·이름짓기 상태 (PA SP가 first_greeted/name_pending 참조)
  const firstGreeted  = localStorage.getItem('hondi_first_greeted')  === '1';
  const namePending   = localStorage.getItem('hondi_name_pending')   === '1';
  const assistantName = localStorage.getItem('hondi_assistant_name') || '';

  const lines = ['[CONTEXT: PROFILE_ONBOARDING]'];
  lines.push(`step: ${step}`);
  lines.push(`done: false`);
  lines.push(`skipped: false`);
  lines.push(`first_greeted: ${firstGreeted}`);
  lines.push(`name_pending: ${namePending}`);
  if (assistantName) lines.push(`assistant_name: ${assistantName}`);
  if (ctx.guid)           lines.push(`guid: ${ctx.guid}`);
  if (ctx.handle)         lines.push(`handle: ${ctx.handle}`);
  if (ctx.nickname)       lines.push(`nickname: ${ctx.nickname}`);
  if (ctx.region)         lines.push(`region: ${ctx.region}`);
  if (ctx.e164)           lines.push(`e164: ${ctx.e164}`);   // 있으면 PA가 phone을 묻지 않음
  if (ctx.name)           lines.push(`name: ${ctx.name}`);
  if (ctx.address)        lines.push(`address: ${ctx.address}`);
  if (ctx.phone)          lines.push(`phone: ${ctx.phone}`);
  if (ctx.entity_type)    lines.push(`entity_type: ${ctx.entity_type}`);
  if (ctx.entity_subtype) lines.push(`entity_subtype: ${ctx.entity_subtype}`);
  if (ctx.schema_id)      lines.push(`schema_id: ${ctx.schema_id}`);
  if (ctx.products)       lines.push(`products: ${JSON.stringify(ctx.products)}`);
  if (ctx.description)    lines.push(`description: ${ctx.description}`);
  if (ctx.platform_type)  lines.push(`platform_type: ${ctx.platform_type}`);
  if (ctx.member_count)   lines.push(`member_count: ${ctx.member_count}`);
  if (ctx.industry_fields) lines.push(`industry_fields: ${JSON.stringify(ctx.industry_fields)}`);
  if (ctx.gdc_accepted !== undefined) lines.push(`gdc_accepted: ${ctx.gdc_accepted}`);
  if (ctx.is_public !== undefined)    lines.push(`is_public: ${ctx.is_public}`);
  lines.push('[/CONTEXT]');

  return lines.join('\n');
}

/**
 * _handleProfileTags — PROFILE_SUBMIT / PROFILE_SKIP / 단계 업데이트 처리
 *
 * @param {string} fullReply — LLM 응답 전문
 * @param {HTMLElement|null} bubble — 스트림 버블 (SKIP 시 태그 제거용)
 * @returns {boolean} true = 태그 처리됨 (GWP 등 후속 처리 생략)
 */
// v1.3 — export: 내부 전용 태그를 화면에서 제거하는 헬퍼. 모듈 스코프로 끌어올려
// AI 패널(webapp.html) 등 _handleProfileTags를 거치지 않는 경로에서도 재사용 가능.
export const _stripInternalTags = (text) => text
  .replace(/PROFILE_SUBMIT\s*\{[\s\S]*?\n\}/, '')
  .replace(/\[PARTIAL_SAVE\]\s*\{[\s\S]*?\}/g, '')
  .replace(/\[\d+\/\d+단계\]/g, '')
  .replace(/\[FIRST_GREETED\]/g, '')
  .replace(/\[NAME_CAPTURED\]/g, '')
  .replace(/\[PROFILE_SKIP\]/g, '')
  .trim();

/**
 * _handleProfileTags — PROFILE_SUBMIT / PROFILE_SKIP / 단계 업데이트 처리
 *
 * v1.3 — export + sendFn 매개변수 추가: 메인 채팅(callAI)뿐 아니라 AI 패널
 * (webapp.html _callPanelAI) 등 다른 표면에서도 호출 가능. sendFn은 "인계
 * 안착 인사"를 어디로 보낼지 결정 — 기본값은 메인 채팅의 callAI, 패널에서
 * 호출할 때는 패널 자체의 전송 함수를 넘기면 그쪽 말풍선에 이어서 표시된다.
 */
export async function _handleProfileTags(fullReply, bubble, sendFn = callAI) {
  // ── FIRST_GREETED — PHASE -1 최초 인사 완료 (v1.3) ──────────
  if (fullReply.includes('[FIRST_GREETED]')) {
    console.log('[Profile] FIRST_GREETED 감지 — 최초 인사 완료, 이름짓기 대기');
    try {
      localStorage.setItem('hondi_first_greeted', '1');
      localStorage.setItem('hondi_name_pending', '1');
    } catch {}
  }

  // ── NAME_CAPTURED — 이름짓기 응답 처리 완료 (v1.3) ──────────
  let _justCapturedName = false;
  if (fullReply.includes('[NAME_CAPTURED]')) {
    console.log('[Profile] NAME_CAPTURED 감지 — 이름짓기 응답 처리 완료');
    try { localStorage.setItem('hondi_name_pending', '0'); } catch {}
    // assistant_name은 hondi_profile_partial이 아닌 별도 키에 영구 저장
    // (hondi_profile_partial은 PROFILE_SUBMIT 시 삭제되므로, 거기 두면 사라짐)
    const nameMatch = fullReply.match(/\[PARTIAL_SAVE\]\s*(\{[^}]*"assistant_name"[^}]*\})/);
    if (nameMatch) {
      try {
        const parsed = JSON.parse(nameMatch[1]);
        if (parsed.assistant_name) localStorage.setItem('hondi_assistant_name', parsed.assistant_name);
      } catch {}
    }
    _justCapturedName = true;
  }

  // ── 진행 중 필드 저장 [PARTIAL_SAVE] — step 태그 유무와 무관하게 항상 처리 (v1.3) ──
  // 이전엔 [N/6단계] 태그가 같은 응답에 없으면 PARTIAL_SAVE를 무시했는데,
  // PA SP가 단계를 건너뛰며 동시에 값을 채우는 경우(추정 입력 등) 놓칠 수 있어 분리함.
  if (!localStorage.getItem('hondi_profile_done')) {
    const partialMatch = fullReply.match(/\[PARTIAL_SAVE\]\s*(\{[\s\S]*?\})/);
    if (partialMatch) {
      try {
        const incoming = JSON.parse(partialMatch[1]);
        const existing = JSON.parse(localStorage.getItem('hondi_profile_partial') || '{}');
        localStorage.setItem('hondi_profile_partial', JSON.stringify(Object.assign(existing, incoming)));
      } catch {}
    }
  }

  // ── 단계 업데이트 [N/6단계] ───────────────────────────────
  const stepMatch = fullReply.match(/\[(\d+)\/\d+단계\]/);
  if (stepMatch && !localStorage.getItem('hondi_profile_done')) {
    try { localStorage.setItem('hondi_profile_step', stepMatch[1]); } catch {}
  }

  // ── PROFILE_SUBMIT ────────────────────────────────────────
  if (fullReply.includes('PROFILE_SUBMIT')) {
    console.log('[Profile] PROFILE_SUBMIT 감지 — 프로필 등록 시작');
    try {
      const { handleProfileSubmit } = await import('../ui/welcome.js');
      await handleProfileSubmit(fullReply);
    } catch (e) {
      console.warn('[Profile] handleProfileSubmit 실패:', e.message);
    }
    // v1.3 — 사용자 화면에는 PROFILE_CARD 등 자연어만 남기고 내부 태그는 제거
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    // 상태 정리 (assistant_name은 의도적으로 보존 — AGENT-COMMON 등 이후에도 유지)
    try {
      localStorage.setItem('hondi_profile_done', '1');
      localStorage.removeItem('hondi_profile_step');
      localStorage.removeItem('hondi_profile_skipped');
      localStorage.removeItem('hondi_profile_partial');
      localStorage.removeItem('hondi_first_greeted');
      localStorage.removeItem('hondi_name_pending');
    } catch {}
    history.length = 0;
    await _switchToAssistantSP();
    await _triggerSeamlessHandoff(sendFn);
    return true;
  }

  // ── PROFILE_SKIP ──────────────────────────────────────────
  if (fullReply.includes('[PROFILE_SKIP]')) {
    console.log('[Profile] PROFILE_SKIP 감지 — 온보딩 건너뜀 (재개를 위해 단계·작성분 보존)');
    try {
      localStorage.setItem('hondi_profile_skipped', '1');
      // v1.4 — hondi_profile_step / hondi_profile_partial은 더 이상 지우지 않는다.
      // PA SP가 사용자에게 "나중에 설정 → 프로필에서 이어서 작성하실 수 있어요"라고
      // 약속하는데, 여기서 지워버리면 settings.js의 resumeProfileSetup()이 어느
      // 단계였는지도, 이미 입력한 값도 알 수 없게 돼 약속이 깨진다. 재개 시점
      // (resumeProfileSetup)에서 hondi_profile_skipped를 다시 해제하는 식으로 처리한다.
    } catch {}
    // v1.3 — 내부 태그 전체 제거(이전엔 [PROFILE_SKIP]만 지웠음)
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    history.length = 0;
    await _switchToAssistantSP();
    await _triggerSeamlessHandoff(sendFn);
    return true;
  }

  // ── 여기까지 SUBMIT/SKIP이 아니었어도, 내부 태그가 섞여 있었다면 화면은 정리 (v1.3) ──
  if (bubble) {
    const cleaned = _stripInternalTags(fullReply);
    if (cleaned !== fullReply.trim()) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, cleaned);
    }
  }

  // ── NAME_CAPTURED 자동 이어가기 (v1.4) ──────────────────────
  // SP 사양(PHASE 0): "[P0-NAME-CAPTURE] 처리 후 아래 1~3 평가"는 같은 응답
  // 안에서 모델이 스스로 이어 쓰는 것을 전제로 하지만, 모델이 이름 확인
  // 한 줄만 내고 응답을 끝내버리면 대화가 그대로 멈춘다(실사용에서 확인됨).
  // PROFILE_SUBMIT/SKIP과 동일하게, 모델의 판단에 맡기지 않고 클라이언트가
  // 명시적으로 한 번 더 트리거해 PHASE 1로 이어지게 한다. SUBMIT/SKIP은 위에서
  // 이미 return true로 빠지므로 여기 도달했다면 둘 다 아니었다는 뜻.
  if (_justCapturedName) {
    await _triggerProfileContinue(sendFn);
    return true;
  }

  return false;
}

/**
 * _switchToAssistantSP — AGENT-COMMON SP를 CFG.system_base / CFG.system에 적용
 * PROFILE_SUBMIT 또는 PROFILE_SKIP 직후 호출됩니다.
 * history가 비워진 상태이므로 다음 callAI 호출 시 새 system이 history[0]으로 삽입됩니다.
 */
async function _switchToAssistantSP() {
  try {
    if (!CFG.system_base || CFG.system_base.includes('나만의 AI 비서')) {
      // system_base가 아직 PA SP이거나 미로드 상태 → AGENT-COMMON manifest 키로 재로드
      CFG.system_base = await _loadAgentCommonSP();
    }
    CFG.system = CFG.system_base;
    // 설정 저장 (다음 페이지 로드 시 복원)
    try {
      const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
      cfg.system = CFG.system;
      cfg.system_base = CFG.system_base;
      localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
    } catch {}
    console.log('[Profile] AGENT-COMMON SP로 전환 완료');
  } catch (e) {
    console.warn('[Profile] SP 전환 실패 (무시):', e.message);
  }
}

/**
 * _triggerProfileContinue — NAME_CAPTURED 직후, SP를 바꾸지 않은 채(여전히 PA SP)
 * "PHASE 0의 1~3 평가를 계속해서 PHASE 1로 이어가라"는 내부 신호를 한 번 더
 * 보낸다. _triggerSeamlessHandoff와 달리 _switchToAssistantSP를 호출하지
 * 않는다 — 아직 온보딩 중이므로 system은 PA SP 그대로 유지돼야 한다.
 */
async function _triggerProfileContinue(sendFn = callAI) {
  try {
    const handoff = `[INTERNAL: 방금 이름짓기(P0-NAME-CAPTURE)에 응답했습니다. 사용자에게 ` +
      `보이지 않는 내부 신호입니다 — 다시 인사하지 말고, PHASE 0의 1~3 평가를 이어서 ` +
      `진행해 해당하는 PHASE로 자연스럽게 이어가세요(예: step=0이면 PHASE 1-INTRO부터 시작).]`;
    await sendFn(handoff);
  } catch (e) {
    console.warn('[Profile] PHASE 1 자동 이어가기 트리거 실패(무시 — 다음 사용자 메시지에서 정상 처리됨):', e.message);
  }
}

/**
 * _triggerSeamlessHandoff — PA→AGENT-COMMON 전환을 사용자가 체감하지 못하게,
 * 사용자 입력 없이 즉시 AGENT-COMMON의 "인계 안착 인사"를 한 번 트리거합니다(v1.3).
 *
 * _switchToAssistantSP() 직후 callAI()를 내부적으로 한 번 더 호출해, 같은 흐름
 * 안에서 AGENT-COMMON이 자연스럽게 이어 말하도록 만듭니다. 사용자에게는 AI
 * 말풍선 두 개가 끊김 없이 이어지는 것처럼 보입니다(중간에 사용자 입력 불필요).
 *
 * 이 시점에 hondi_assistant_name이 있으면 AGENT-COMMON에게 그 이름을 직접
 * 알려줍니다 — PA가 이름을 AGENT-COMMON에 전달하는 통로가 바로 이 메시지입니다.
 * (보조 수단으로 _buildEnhancedUserContent의 "이름:" 컨텍스트도 매 턴 동봉됨 —
 * 새로고침으로 history가 끊겨도 이름이 유지되도록.)
 */
async function _triggerSeamlessHandoff(sendFn = callAI) {
  try {
    const assistantName = localStorage.getItem('hondi_assistant_name') || '';
    const handoff = assistantName
      ? `[INTERNAL: 그림자 AI 인계 — 사용자가 이 비서를 "${assistantName}"이라고 부르기로 ` +
        `했습니다. 이후 자기 자신을 "${assistantName}"으로 칭하세요. 사용자에게 보이지 ` +
        `않는 내부 신호입니다 — 새로 인사·자기소개하지 말고, 자연스럽게 이어서 짧게 ` +
        `한두 문장만 안착 인사를 건네세요.]`
      : `[INTERNAL: 그림자 AI 인계 — 사용자에게 보이지 않는 내부 신호입니다. 새로 ` +
        `인사·자기소개하지 말고, 자연스럽게 이어서 짧게 한두 문장만 안착 인사를 건네세요.]`;
    await sendFn(handoff);
  } catch (e) {
    console.warn('[Profile] 인계 안착 인사 트리거 실패(무시 — 다음 사용자 메시지에서 정상 처리됨):', e.message);
  }
}

/**
 * _buildEnhancedUserContent — 동적 컨텍스트를 사용자 메시지 앞에 병합
 *
 * DeepSeek Auto Prompt Caching 최적화의 핵심:
 *   • system 메시지는 완전히 정적 → 캐시 prefix 100% 보존
 *   • GUID·위치·PDV 요약은 ctxMsg(별도 메시지)가 아닌 현재 user 메시지 앞에 주입
 *   → 캐시 prefix(system)가 매 호출 동일 → DeepSeek 캐시 적중률 95%+
 *
 * PA 온보딩 중일 때는 [CONTEXT: PROFILE_ONBOARDING] 블록을 대신 삽입합니다.
 *
 * @param {string|Array} userContent — 현재 사용자 메시지 (텍스트 또는 multipart)
 * @param {boolean} isOnboarding — true이면 프로필 컨텍스트 블록 삽입
 * @returns {string|Array} 컨텍스트가 병합된 사용자 메시지
 */
async function _buildEnhancedUserContent(userContent, isOnboarding) {
  const parts = [];

  if (isOnboarding) {
    // PA 온보딩: 이미 아는 항목 + 진행 단계를 PA SP에 알림
    parts.push(_buildProfileContext());
  } else {
    // 일반 비서 모드: GUID + 위치 + PDV 요약 (RAG 스타일, 압축)
    if (USER_GUID) parts.push(`GUID:${USER_GUID.slice(-8)}`);

    // v1.3 — 이용자가 지어준 AI 비서 이름을 매 턴 함께 전달(새로고침으로 history가
    // 끊겨도 AGENT-COMMON이 계속 같은 이름을 쓸 수 있도록)
    const assistantName = localStorage.getItem('hondi_assistant_name') || '';
    if (assistantName) parts.push(`이름:${assistantName}`);

    const locNote = _buildLocNote();
    if (locNote) parts.push(locNote.trim());

    // PDV 요약 — IndexedDB 대신 localStorage log 사용 (동기, 압축)
    try {
      const log = JSON.parse(localStorage.getItem('gopang_pdv_log') || '[]');
      if (Array.isArray(log) && log.length) {
        const summaries = log.slice(-8).reverse()
          .map(r => r.summary || r.what || '').filter(Boolean);
        if (summaries.length) parts.push(`[이력]${summaries.join('; ')}`);
      }
    } catch {}
  }

  if (!parts.length) return userContent;

  const ctxBlock = `[ctx]\n${parts.join('\n')}\n\n`;

  // multipart(이미지 포함) 메시지 처리
  if (Array.isArray(userContent)) {
    return [{ type: 'text', text: ctxBlock }, ...userContent];
  }
  return ctxBlock + (userContent || '');
}

// ══════════════════════════════════════════════════════════════

export function stopGeneration() {
  if (_currentAbort) {
    console.log('[AI] 사용자 요청으로 응답 생성 중지');
    _currentAbort.abort();
  }
}

function _setSendBtnGenerating(active) {
  const btn = document.getElementById('send-btn');
  if (!btn) return;
  btn.classList.toggle('generating', active);
  if (active) {
    btn.disabled = false; // 생성 중에는 항상 클릭 가능해야 중지 버튼으로 동작
  } else {
    const input = document.getElementById('msg-input');
    btn.disabled = !(input && input.value.trim());
  }
}

// callAI는 얇은 래퍼 — 실제 로직(_callAIInner)이 어떤 경로로 끝나든(정상 종료/
// 에러/중지) try/finally가 버튼 상태와 AbortController를 항상 정리한다.
export async function callAI(userText, imageFile = null, _preTab = null) {
  _currentAbort = new AbortController();
  _setSendBtnGenerating(true);
  try {
    await _callAIInner(userText, imageFile, _preTab);
  } finally {
    _setSendBtnGenerating(false);
    _currentAbort = null;
  }
}

// ── 호출 후보 목록 생성 ────────────────────────────────────
// 우선순위는 getPriorityOrder()(config.js)가 결정한다. 기본값은
// OpenRouter(무료풀) → Claude → Gemini → DeepSeek → ChatGPT → Grok 이지만,
// 사용자가 ai-setup-mobile.html에서 드래그로 순서를 바꿨으면 그 순서가 우선 적용된다.
// → 마지막 안전망으로 고팡 프록시(키 불필요)
// OR 풀 내부는 기본적으로 컨텍스트·파라미터 기준 품질 순서다. 단, Claude·Grok이
// OpenRouter에 무료 모델을 새로 올리면 free-model-pool.js가 발견 즉시 풀 최상단으로
// 자동 승격한다(OR_AUTO_PROMOTE_VENDORS 참고) — 오늘은 보통 해당 없음.
// 등록된(키 입력된) provider만 후보가 되며, 한도 초과(429)·크레딧부족(402)·404 등
// 모든 실패 상황에서 callAI()가 다음 후보로 자동 전환한다.
// OR 후보는 추가로 (1) 24h 쿨다운 캐시, (2) 분당 호출 예산 두 가지 필터를 통과해야 한다.
function _buildCallCandidates() {
  const candidates = [];

  // 1) 사용자가 등록한 provider 키들 (ai-setup-mobile.html에서 등록)
  //    저장 순서와 무관하게 PRIORITY_ORDER(OR→Claude→Gemini→DeepSeek→ChatGPT→Grok)로
  //    항상 재정렬 — 키가 등록된 provider만 그 순서대로 호출된다.
  //    OR 슬롯은 무료 모델 풀 전체(여러 model 항목)가 들어있으므로,
  //    같은 provider 내부 상대 순서는 stable sort로 보존된다(OR 풀 자체의 우선순위 유지).
  if (Array.isArray(CFG.providers)) {
    // 사용자가 ai-setup-mobile.html에서 드래그로 순서를 바꿨으면 그 순서를,
    // 아니면 기본 순서(OR→Claude→Gemini→DeepSeek→ChatGPT→Grok)를 사용한다.
    const priorityOrder = getPriorityOrder();
    const sorted = [...CFG.providers].sort((a, b) => {
      const ia = priorityOrder.indexOf(a?.provider);
      const ib = priorityOrder.indexOf(b?.provider);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    // OR 분당 호출 예산 — 이번 callAI() 호출에서 추가로 시도 가능한 OR 후보 수.
    // 0이면 OR 후보를 전부 건너뛰고 곧장 사용자 직접등록 키(또는 프록시)로 넘어간다.
    let orBudget = getOpenRouterRemainingBudget();
    // 분당 예산이 충분히 남아있어도 한 메시지당 시도 횟수는 별도로 상한을 둔다
    // — 그래야 "분당 한도 미달이지만 26개 중 앞쪽 여러 개가 동시에 막힌" 최악의
    //   경우에도 응답 지연이 일정 수준 이상으로 길어지지 않는다.
    const MAX_OR_TRIES_PER_MESSAGE = 6;
    let orTriesLeft = MAX_OR_TRIES_PER_MESSAGE;

    for (const p of sorted) {
      if (!p?.apiKey || !p?.model) continue;
      const info = PROVIDER_INFO[p.provider];
      if (!info) continue;

      if (p.provider === 'openrouter') {
        if (isModelOnCooldown(p.model)) continue; // 24h 쿨다운 중 — 건너뜀
        if (orBudget <= 0 || orTriesLeft <= 0) continue; // 분당 한도 또는 메시지당 상한 초과
        orBudget--; orTriesLeft--;
      }

      candidates.push({
        provider: p.provider,
        baseUrl:  (p.baseUrl || info.baseUrl).replace(/\/+$/, ''),
        model:    p.model,
        apiKey:   p.apiKey,
        isProxy:  false,
      });
    }
  }

  // 2) 하위 호환 — CFG.apiKey/geminiKey 단일 키만 있던 기존 사용자
  if (!candidates.some(c => !c.isProxy)) {
    if (CFG.apiKey && !CFG.endpoint.includes('workers.dev')) {
      candidates.push({
        provider: 'legacy', baseUrl: CFG.endpoint.replace(/\/+$/, ''),
        model: CFG.model, apiKey: CFG.apiKey, isProxy: false,
      });
    } else if (CFG.geminiKey) {
      candidates.push({
        provider: 'gemini', baseUrl: PROVIDER_INFO.gemini.baseUrl,
        model: CFG.model.startsWith('gemini') ? CFG.model : 'gemini-2.5-flash',
        apiKey: CFG.geminiKey, isProxy: false,
      });
    }
  }

  // ※ 2026-06-29: 고팡 프록시(deepseek-v4-flash) 무료 폴백을 완전히 제거함 —
  // 제품 결정: 사용자에게 무료로 제공하는 LLM이 없다. 후보가 0개면(아무
  // provider도 등록 안 함) callAI() 쪽에서 "LLM을 설정해주세요" 안내로 처리.

  // 모델명 교정 — config.js의 MODEL_MIGRATION을 여기 한 곳에서 일괄 적용한다.
  // (desktop.html의 구형 선택값, DEV_MODE 주입값 등 출처가 어디든 상관없이
  // 전부 통과하게 됨 — 만들어져 있었지만 아무 데서도 안 쓰이고 있던 맵이었음.
  // 특히 deepseek-chat/reasoner는 2026-07-24 완전히 막히므로 시급함.)
  for (const c of candidates) {
    if (MODEL_MIGRATION[c.model]) c.model = MODEL_MIGRATION[c.model];
  }

  return candidates;
}

/**
 * _callLLM — 후보 페일오버 + SSE 스트리밍을 갖춘 범용 LLM 호출 헬퍼.
 *
 * routing-engine.js 등이 메인 채팅(history/스트림 버블)과 무관하게 자체적으로
 * 구성한 messages로 LLM을 호출할 때 쓴다. _buildCallCandidates()를 그대로
 * 재사용하므로, 메인 채팅(_callAIInner)과 동일한 페일오버 순서·OR 분당 예산·
 * 24h 쿨다운 규칙을 따른다.
 *
 * (이전엔 routing-engine.js가 이 함수를 import하고 있었지만 정작 call-ai.js에
 * export가 없어서 호출하는 즉시 깨졌습니다 — "기존 callAI의 내부 fetch 분리
 * 버전"이라는 주석만 있고 실제 분리 작업이 빠져 있었습니다.)
 *
 * @param {Array<{role: string, content: any}>} messages — 이미 완성된 메시지 배열
 * @param {{max_tokens?: number, temperature?: number, bubble?: HTMLElement}} options
 *   bubble을 주면 스트리밍 중 실시간으로 그 엘리먼트에 렌더링한다(메인 채팅과
 *   동일한 _updateStreamBubble 사용). bubble이 없으면 조용히 끝까지 모아서
 *   한 번에 반환한다(streaming 여부는 API 호출 방식일 뿐, 반환값은 항상 완성된
 *   문자열이라는 점에서 호출자 입장에선 동일하다).
 * @returns {Promise<string>} 모델 응답 전체 텍스트
 */
export async function _callLLM(messages, options = {}) {
  const { max_tokens = TOKEN_BUDGET.CHAT_REPLY, temperature = 0.6, bubble = null } = options;
  const candidates = _buildCallCandidates();

  let res = null, lastErr = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (c.provider === 'openrouter') recordOpenRouterCall();
    try {
      const reqBody = { model: c.model, messages, max_tokens, temperature, stream: true };
      if (!PROVIDER_INFO[c.provider]?.noStreamOptions) {
        reqBody.stream_options = { include_usage: true };
      }
      // 'legacy'(사용자가 직접 운영하는 커스텀 엔드포인트)는 알려진 벤더가
      // 아니므로 중계 허용목록에 없다 — 중계를 거치면 무조건 막힌다. 이
      // 경로만 예외적으로 원래대로 직접 호출한다(원래도 사용자 본인이
      // CORS를 직접 책임지는 시나리오였음).
      const attempt = c.provider === 'legacy'
        ? await fetch(`${c.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.apiKey}` },
            body: JSON.stringify(reqBody),
          })
        : await fetch(`${CFG.endpoint.replace(/\/+$/, '')}/llm/relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              provider: c.provider, baseUrl: c.baseUrl, apiKey: c.apiKey,
              model: reqBody.model, messages: reqBody.messages,
              max_tokens: reqBody.max_tokens, temperature: reqBody.temperature,
              stream: true,
            }),
          });
      if (attempt.ok) { res = attempt; break; }
      const errBody = await attempt.text().catch(() => '');
      lastErr = new Error(`API ${attempt.status}: ${errBody.slice(0, 300) || '응답없음'}`);
      console.warn(`[_callLLM] ${c.provider}(${c.model}) 실패(${attempt.status}) — 다음 후보로 전환`);
      if (c.provider === 'openrouter') markModelFailed(c.model, attempt.status);
      continue;
    } catch (fetchErr) {
      lastErr = fetchErr;
      continue;
    }
  }
  if (!res) throw (lastErr || new Error('모든 LLM 호출에 실패했습니다.'));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullReply = '', buf = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop();
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const payload = line.slice(6).trim();
      if (payload === '[DONE]') break;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content ?? '';
        if (delta) {
          fullReply += delta;
          if (bubble) _updateStreamBubble(bubble, fullReply);
        }
      } catch {}
    }
  }
  return fullReply || '';
}

// ── §9 실행 태그 공용 디스패처 (Phase 0, 2026-07-01 신설) ──────
// fullReply를 한 번만 스캔해 §9에 정의된 실행 태그를 찾아 처리한다.
// 태그 하나의 처리 실패가 나머지 태그 처리를 막지 않도록 각각 독립적인
// try/catch로 감싼다. 새 태그를 추가할 때는 이 함수 안에 블록 하나만
// 더 붙이면 된다(0단계 설계 원칙).
//
// 현재 처리: GWP(기존 로직 그대로 이전, 동작 변경 없음),
//            SEARCH / OPEN_PROFILE / P2P_INVITE(Phase 1 — 이미 존재하는
//            실행 함수에 배선만 추가).
// 아직 미처리(Phase 2~5 예정): PDV_STORE, HANDSHAKE, VERIFY_OWNER, ESCALATE, TRADE.
function _parseAgentTags(fullReply, bubble, userText, _preTab) {
  // [GWP: serviceId] — 하위 시스템 새 탭 오픈 (SP-00 v10.0, 기존 로직 그대로 이전)
  try {
    const gwpMatch = fullReply.match(/\[GWP:([\w-]+)\]/);
    if (gwpMatch) {
      const svcId  = gwpMatch[1];
      const svcDef = (typeof getService === 'function') ? getService(svcId) : null;
      if (svcDef) {
        console.info('[GWP] LLM 판단 → 새 탭:', svcId);
        if (bubble) _updateStreamBubble(bubble, fullReply.replace(/\[GWP:[\w-]+\]\s*/, ''));
        _gwpLaunch(svcDef, userText, _preTab);
      } else {
        console.warn('[GWP] 알 수 없는 서비스 ID:', svcId);
        if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) { _preTab.close(); }
      }
    } else {
      if (_preTab && typeof _preTab.close === 'function' && !_preTab.closed) {
        _preTab.close();
        console.info('[GWP] 직접 처리 — 예약 탭 닫힘');
      }
    }
  } catch (e) {
    console.warn('[Tags] GWP 처리 오류 (무시):', e.message);
  }

  // [SEARCH: query={검색어}, type=user] — 혼디 사용자 검색 패널 오픈
  try {
    const searchMatch = fullReply.match(/\[SEARCH:\s*query=([^,\]]+),\s*type=user\s*\]/);
    if (searchMatch) {
      const q = searchMatch[1].trim();
      console.info('[Tags] SEARCH →', q);
      openSearch(q);
    }
  } catch (e) {
    console.warn('[Tags] SEARCH 처리 오류 (무시):', e.message);
  }

  // [OPEN_PROFILE: handle={@handle}] — 공급자 프로필 페이지 새 패널로 열기
  try {
    const openProfileMatch = fullReply.match(/\[OPEN_PROFILE:\s*handle=(@[\w.-]+)\s*\]/);
    if (openProfileMatch) {
      const handle = openProfileMatch[1];
      console.info('[Tags] OPEN_PROFILE →', handle);
      _openProfilePanel(handle);
    }
  } catch (e) {
    console.warn('[Tags] OPEN_PROFILE 처리 오류 (무시):', e.message);
  }

  // [P2P_INVITE: handle={@handle}, message={...}] — P2P 채팅 초청 발송
  try {
    const inviteMatch = fullReply.match(/\[P2P_INVITE:\s*handle=(@[\w.-]+)/);
    if (inviteMatch) {
      const handle = inviteMatch[1];
      console.info('[Tags] P2P_INVITE →', handle);
      inviteByHandle(handle).catch(e =>
        console.warn('[Tags] P2P_INVITE 호출 실패 (무시):', e.message)
      );
    }
  } catch (e) {
    console.warn('[Tags] P2P_INVITE 처리 오류 (무시):', e.message);
  }
}


async function _callAIInner(userText, imageFile = null, _preTab = null) {
  showTyping();

  // urgent=true → kemergency면 경고 표시 후 계속 처리
  // (고팡 비서가 추가로 응급 가이드 제공)

  // ── 위치 준비 대기 (최대 6초, race condition 방지) ──────
  if (_locationPending) {
    await new Promise(resolve => {
      const deadline = Date.now() + 6000;
      const poll = () => {
        if (_locationReady || Date.now() >= deadline) resolve();
        else setTimeout(poll, 200);
      };
      poll();
    });
  }

  // ── SP 결정 (캐시 최적화 v1.1) ───────────────────────────
  // 원칙: system 메시지는 세션 내 절대 변경하지 않는다 (DeepSeek 캐시 prefix 보존).
  //   • AGENT-COMMON: system_base에 최초 1회 로드 후 고정
  //   • PA SP: profile 미완료 세션에서만 사용 — history가 비어있을 때만 삽입
  //   • 동적 데이터(GUID·위치·PDV): system이 아닌 user 메시지 앞에 병합
  //     (_buildEnhancedUserContent 참조)
  //   • 그림자 컨텍스트(_buildShadowContext): 제거 — user 메시지 병합 방식으로 대체

  // ── 전문가 AI(페르소나) 세션 처리 ────────────────────────
  // 명시적 종료 발화("끝났어" 등) 감지 시 endExpertSession()이 즉시 실행되어
  // CFG.system을 그림자 AI(AGENT-COMMON)로 복원한다 — 이 경우 아래 SP 결정
  // 로직을 정상적으로 통과시켜 그림자 AI가 이번 발화에 바로 응답하게 한다.
  await maybeHandleExpertTurn(userText);

  // ⚠️ _isOnboarding은 아래 if/else 밖(_buildEnhancedUserContent 등)에서도
  //    참조되므로 반드시 블록 스코프 밖에서 선언한다.
  const _profileDone    = localStorage.getItem('hondi_profile_done')    === '1';
  const _profileSkipped = localStorage.getItem('hondi_profile_skipped') === '1';
  const _isOnboarding   = !_profileDone && !_profileSkipped;

  if (isExpertActive()) {
    // 전문가 세션이 이번 턴에도 유지됨 — PA/AGENT-COMMON 결정 로직을 건너뛰고
    // 페르소나 System Prompt를 그대로 유지한다(history는 공유 — 맥락 보존,
    // PA→AGENT-COMMON 전환과 달리 여기서는 history를 비우지 않는다).
    applyExpertSystemIfActive();
  } else {

  // AGENT-COMMON 최초 1회 로드 (이후 캐시) — manifest["AGENT-COMMON"] 키로 버전 결정
  if (!CFG.system_base) {
    CFG.system_base = await _loadAgentCommonSP();
  }

  // PA SP는 신규 세션(history 비어있음)일 때만 적용
  // — 이미 대화 중인 세션에서는 history[0]의 system을 교체하지 않음 (캐시 보존)
  if (_isOnboarding && history.length === 0) {
    // manifest["personal-assistant"] 키로 버전 결정
    const paSP = await _loadPersonalAssistantOnboardingSP();
    CFG.system = paSP || CFG.system_base || '';
  } else {
    // 일반 비서 모드 또는 계속 진행 중인 온보딩 세션 — system 변경 없음
    if (!CFG.system) CFG.system = CFG.system_base || '';
  }

  } // ← isExpertActive() else 블록 종료

  // ── 이미지 첨부 시: Gemini 범용 분석 → SP-00 컨텍스트 주입 ──
  if (imageFile && CFG.geminiKey) {
    try {
      const _gpTimer = _showGeminiProgress();
      console.log('[IMG] Gemini 범용 이미지 분석 시작');
      const genResult = await _callGeminiGeneral(imageFile, CFG.geminiKey, userText);
      _hideGeminiProgress(_gpTimer);
      if (genResult) {
        const analysisText = _geminiResultToText(genResult, userText);
        userContent = analysisText;
        imageFile   = null;
        console.log('[IMG] Gemini 분석 완료 → SP-00 컨텍스트로 전달');
      }
    } catch(e) {
      console.warn('[IMG] Gemini 분석 실패:', e.message);
    }
  }

  // ── 이미지 → content 배열 변환 ──────────────────────
  let userContent;

  if (imageFile && imageFile.type.startsWith('image/')) {
    if (!_modelSupportsVision(CFG.model)) {
      // 비전 미지원 모델 — 이미지 무시, 사용자에게 안내
      hideTyping();
      appendBubble('ai',
        `⚠️ 현재 모델(${CFG.model})은 이미지를 지원하지 않습니다.\n` +
        `설정에서 "DeepSeek V4" 또는 "GPT-4o"로 변경하세요.`);
      if (userText) {
        // 텍스트만이라도 처리
        showTyping();
      } else {
        return;
      }
      userContent = userText;
    } else {
      // 비전 지원 모델 — base64 변환 후 multipart content
      // DeepSeek API: image_url 형식 미지원 → base64를 텍스트로 포함
      // OpenAI 호환 모델(gpt-4o 등): image_url 형식 사용
      try {
        const dataUrl  = await _fileToBase64(imageFile);
        const mimeType = imageFile.type;
        const base64   = dataUrl.split(',')[1];

        const isOpenAI = CFG.endpoint.includes('openai.com') ||
                         CFG.endpoint.includes('azure') ||
                         CFG.model.startsWith('gpt-');
        const isDeepSeek = CFG.endpoint.includes('deepseek') ||
                           CFG.endpoint.includes('workers.dev');

        userContent = [];
        if (userText) {
          userContent.push({ type: 'text', text: userText });
        }

        if (isOpenAI) {
          // OpenAI 형식: image_url
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${mimeType};base64,${base64}` },
          });
          // 텍스트 없이 이미지만 전송 시 — 의도 자율 파악 지시
          if (!userText) {
            userContent.push({
              type: 'text',
              text: '[텍스트 없이 이미지만 전송됨]\n사용자의 의도를 이미지에서 직접 파악하여 처리하라.\n환경 오염·쓰레기 현장이면 K-Cleaner v1.2 신고·견적을 자동 실행하고,\n그 외 이미지는 내용에 맞는 적절한 도움을 제공하라.\n불명확할 때만 한 가지 확인 질문을 한다.',
            });
          }
        } else {
          // DeepSeek 형식: base64를 텍스트로 포함
          // DeepSeek API는 image_url 미지원 → base64 데이터를 직접 전달
          userContent = [];
          if (userText) userContent.push({ type: 'text', text: userText });
          // 텍스트 없이 이미지만 전송 시 — 의도 자율 파악 지시
          const imgIntentNote = userText
            ? ''
            : '\n[텍스트 없이 이미지만 전송됨] 사용자 의도를 이미지에서 직접 파악하여 처리하라. 환경 오염·쓰레기 현장이면 K-Cleaner v1.2 신고·견적 자동 실행. 그 외는 내용에 맞는 도움 제공. 불명확할 때만 한 가지 확인 질문.';
          userContent.push({
            type: 'text',
            text: `[이미지 첨부됨 — base64 데이터: data:${mimeType};base64,${base64.slice(0,100)}... (${Math.round(base64.length*0.75/1024)}KB)]\n이 이미지를 분석해 주세요.${imgIntentNote}`,
          });
        }
      } catch (e) {
        hideTyping();
        appendBubble('ai', `⚠️ 이미지 변환 오류: ${e.message}`);
        return;
      }
    }
  } else {
    // 일반 텍스트
    userContent = userText;
  }

  // ── history에 system(최초) 및 user 추가 ─────────────────
  // 1) system: 세션 최초 1회만 history[0]으로 삽입
  //    ★ 캐시 최적화: system은 완전 정적 — 동적 데이터는 user 메시지에 병합
  //    DeepSeek Auto Prompt Caching이 system prefix를 영구 캐시
  //    → 수백 번 호출해도 system 토큰 비용 사실상 0
  if (history.length === 0) {
    history.push({ role: 'system', content: CFG.system });
    console.log('[Cache] 세션 최초 — 정적 system 삽입 (DeepSeek 캐시 최적화)');
  }

  // 2) 동적 컨텍스트를 현재 user 메시지 앞에 병합
  //    ★ system prefix를 건드리지 않으므로 캐시 적중률 95%+ 유지
  //    온보딩 중: [CONTEXT: PROFILE_ONBOARDING] 블록 삽입
  //    일반 모드: GUID + 위치 + PDV 요약 (RAG 스타일, 압축)
  const enhancedUserContent = await _buildEnhancedUserContent(userContent, _isOnboarding);

  // 3) user 레코드는 원본(userContent)으로 history에 저장
  //    → enhancedUserContent(컨텍스트 포함)는 messages 전송용으로만 사용
  const userRecord = { role: 'user', content: typeof userContent === 'string' ? userContent : '[첨부: 이미지]' };
  history.push(userRecord);

  // 4) messages 구성
  //    ★ 구조: [system(고정·캐시)] → [대화이력] → [user(동적ctx 병합)]
  //    기존의 ctxMsg([ctx]GUID+위치 별도 메시지 쌍) 완전 제거
  //    — ctxMsg가 system 바로 뒤에 오면 캐시 prefix가 매번 달라져 캐시 0% 적중
  const sysMsg  = history[0]?.role === 'system' ? [history[0]] : [];
  const dialogs = history.slice(1);           // system 제외 대화
  const recent  = dialogs.slice(-18);         // 최근 18턴

  const messages = [
    ...sysMsg,                                // ★ system (완전 정적 → DeepSeek 캐시 100%)
    ...recent.slice(0, -1),                   // 대화 이력 (userRecord 제외)
    { role: 'user', content: enhancedUserContent }, // ★ 동적 ctx + 현재 질문 (캐시 무관)
  ];

  // ── 호출 후보 목록 생성 (순차 페일오버) ──────────────────
  // 1순위: 고팡 프록시(키 불필요, 기본) → 등록된 BYOK provider들 순서대로
  // 한도 초과(429) 또는 크레딧 부족(402) 시 다음 후보로 자동 전환
  const candidates = _buildCallCandidates();
  const activeModel = CFG.model;
  console.log(`[AI] 호출 후보 ${candidates.length}개 준비 — 1번부터 순차 시도`);

  // ── LLM 미설정 시 — 더 이상 무료 폴백이 없으므로 명확히 안내하고 중단 ──
  if (candidates.length === 0) {
    hideTyping();
    appendBubble('ai',
      '🔑 <b>AI 비서를 쓰려면 먼저 LLM을 설정해야 합니다.</b><br>' +
      '혼디는 자체 제공하는 무료 LLM이 없습니다 — Gemini·DeepSeek 등 ' +
      '벤더 중 하나를 골라 키를 등록해 주세요.<br>' +
      '<button onclick="window.open(\'/pages/ai-setup-mobile.html\',\'_blank\')" ' +
      'style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;' +
      'background:#16a34a;color:#fff;font-weight:600;cursor:pointer">LLM 설정하러 가기</button>',
      true
    );
    return;
  }

  // ── 스트리밍 호출 (페일오버 포함) ───────────────────────
  try {
    let res = null, usedCandidate = null, lastErr = null;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      console.log(`[AI] 시도 ${i + 1}/${candidates.length} → ${c.baseUrl}/chat/completions | 모델: ${c.model} | ${c.isProxy ? '프록시(보안)' : 'provider: ' + c.provider}`);
      if (c.provider === 'openrouter') recordOpenRouterCall(); // 분당 슬라이딩 윈도우에 기록
      try {
        const reqBody = {
          model: c.model,
          messages,
          max_tokens:  TOKEN_BUDGET.CHAT_REPLY,
          temperature: 0.6,
          stream:      true,
        };
        // Gemini·OpenRouter 등 일부 provider는 stream_options를 거부함(400)
        // PROVIDER_INFO[provider].noStreamOptions 플래그로 일반화 처리
        if (!PROVIDER_INFO[c.provider]?.noStreamOptions) {
          reqBody.stream_options = { include_usage: true };
        }
        // ※ 2026-06-29: 벤더에 브라우저에서 직접 fetch하면 대부분 CORS에
        // 막힌다(서버 간 호출만 허용하는 게 일반적). 무료 폴백이 항상
        // 마지막에 받아주던 시절엔 이게 안 드러났다 — 그게 사라진 지금은
        // 직접 호출이 그냥 실패한다. 서버(/llm/relay)를 한 번 거쳐서 보낸다
        // (여전히 사용자 본인 키·본인이 고른 모델 그대로 — 무료 모델이 아님).
        // 'legacy'(사용자가 직접 운영하는 커스텀 엔드포인트)는 알려진 벤더가
        // 아니므로 중계 허용목록에 없다 — 이 경로만 예외적으로 직접 호출한다.
        const attempt = c.provider === 'legacy'
          ? await fetch(`${c.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.apiKey}` },
              body: JSON.stringify(reqBody),
              signal: _currentAbort?.signal,
            })
          : await fetch(`${CFG.endpoint.replace(/\/+$/, '')}/llm/relay`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                provider: c.provider, baseUrl: c.baseUrl, apiKey: c.apiKey,
                model: reqBody.model, messages: reqBody.messages,
                max_tokens: reqBody.max_tokens, temperature: reqBody.temperature,
                stream: true,
              }),
              signal: _currentAbort?.signal,
            });

        if (attempt.ok) { res = attempt; usedCandidate = c; break; }

        // 실패(429/402/404/400/5xx 등 모든 상황) → 다음 후보로 항상 페일오버
        // (단종된 모델일 때도, 한도 초과도, 일시 장애도 어떻든 다음 LLM을 시도한다)
        const errBody = await attempt.text().catch(() => '');
        lastErr = new Error(`API ${attempt.status}: ${errBody.slice(0, 300) || '응답없음'}`);
        console.warn(`[AI] ${c.provider}(${c.model}) 실패(${attempt.status}) — 다음 LLM으로 전환:`, errBody.slice(0, 150));
        if (c.provider === 'openrouter') markModelFailed(c.model, attempt.status); // 24h 쿨다운
        continue;
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError') throw fetchErr; // 사용자 중지 — 페일오버 없이 즉시 중단
        lastErr = fetchErr;
        // 네트워크 오류 등도 다음 후보가 있으면 계속 시도
        if (i < candidates.length - 1) continue;
        throw fetchErr;
      }
    }

    if (!res) throw (lastErr || new Error('모든 LLM 호출에 실패했습니다.'));
    if (usedCandidate && usedCandidate.model !== CFG.model) {
      console.info(`[AI] 페일오버로 모델 전환됨: ${CFG.model} → ${usedCandidate.model}`);
    }

    console.log(`[AI] 응답 시작 — status:${res.status}, streaming...`);

    // ── SSE 스트림 수신 + 실시간 렌더링 ─────────────────────
    hideTyping();

    const bubble = _createStreamBubble();
    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let   fullReply = '';
    let   buf       = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break;
        try {
          const chunk = JSON.parse(payload);
          if (chunk.usage) {
            const u = chunk.usage;
            const cached = u.prompt_tokens_details?.cached_tokens ?? 0;
            console.log(`[Cache] prompt=${u.prompt_tokens} cached=${cached} completion=${u.completion_tokens} (절감율 ${cached ? Math.round(cached/u.prompt_tokens*100) : 0}%)`);
          }
          const delta = chunk.choices?.[0]?.delta?.content ?? '';
          if (delta) {
            fullReply += delta;
            // CLN 신고가 아닐 때만 실시간 렌더링
            if (bubble) _updateStreamBubble(bubble, fullReply);
          }
        } catch (parseErr) {
          if (payload && payload !== '[DONE]') {
            console.warn('[Stream] 파싱 실패:', payload.slice(0, 80));
          }
        }
      }
    }

    if (!fullReply) fullReply = '(응답 없음)';
    console.log(`[AI] 응답 완료 — ${fullReply.length}자`);
    if (CFG._modelOverride) { CFG.model = CFG._modelOverride; CFG._modelOverride = null; }
    history.push({ role: 'assistant', content: fullReply });
    if (bubble) bubble.classList.remove('streaming');


    // ── PROFILE 태그 처리 (SUBMIT / SKIP / 단계 업데이트) ───
    // 온보딩 세션(_isOnboarding)에서만 실질적으로 동작.
    // SUBMIT/SKIP 감지 시 history 초기화 + SP 전환 후 true 반환 → 후속 처리 생략.
    const _profileHandled = await _handleProfileTags(fullReply, bubble);
    if (_profileHandled) return;

    // ── §9 실행 태그 공용 디스패처 (Phase 0) ────────────────
    // 이전엔 GWP가 자체 정규식으로 fullReply를 스캔했고, 별도로
    // _parseShadowTags(fullReply)라는 미정의 함수가 호출돼 매번
    // ReferenceError를 던지며 이 지점 이후(GWP/EXPERT/AUTH/klaw 감시)를
    // 통째로 막고 있었다(2026-07-01 발견, AGENT-COMMON §0 보유 응답마다
    // 100% 재현). 이제 한 번만 스캔해서 발견된 태그를 순서대로 처리한다.
    _parseAgentTags(fullReply, bubble, userText, _preTab);

    // ── EXPERT 태그 감지 → 전문가 AI(같은 스레드 페르소나) 세션 시작 ──
    // 그림자 AI(AGENT-COMMON) 응답에서만 인식한다 — 페르소나 본인이 발급한
    // 텍스트가 우연히 같은 패턴을 포함해도 재귀적으로 세션을 바꾸지 않도록.
    if (!isExpertActive() && CFG.system?.includes('§0. 정체성')) {
      handleExpertTag(fullReply).catch(e =>
        console.warn('[Expert] 태그 처리 오류 (무시):', e.message)
      );
    }

    // ── AUTH 태그 감지 → 인증 요구 ──────────────────────────
    const authMatch = fullReply.match(/\[AUTH:(L[0-3])\]/);
    if (authMatch) {
      const requiredLevel = authMatch[1];
      const stored = JSON.parse(localStorage.getItem('gopang_user_v4') || 'null');
      const currentLevel = stored?.authLevel || 'L0';
      const levels = ['L0','L1','L2','L3'];
      if (levels.indexOf(requiredLevel) > levels.indexOf(currentLevel)) {
        setTimeout(() => _injectAuthConfirmButton(requiredLevel), 400);
      }
    }

    // K-Law 백그라운드 감시 트리거 — 대화 내용 자동 검토 (비동기)
    setTimeout(() => _klawReview('conversation', null), 3000);


  } catch (err) {
    hideTyping();
    if (err.name === 'AbortError') {
      console.log('[AI] 응답 생성이 중지되었습니다 (사용자 요청)');
      document.querySelector('.bubble-ai.streaming')?.classList.remove('streaming');
      return;
    }
    const existingBubble = document.querySelector('.bubble-ai.streaming');
    let userMsg = `⚠️ API 오류: ${err.message}`;
    if (err.message.includes('402') || err.message.includes('Insufficient Balance')) {
      // 402는 프록시 크레딧 부족 — 사용자에게 노출하지 않음
      // OR 키가 등록돼 있으면 자동 페일오버로 이미 처리됐어야 하고,
      // 없으면 AI 설정 유도 메시지만 표시
      const hasUserKey = Array.isArray(CFG?.providers) && CFG.providers.length > 0;
      if (!hasUserKey) {
        // OR 키 미등록 — 메시지 대신 ai-setup 페이지로 즉시 이동
        if (existingBubble) existingBubble.remove();
        const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
        if (isMobile) {
          window.location.href = '/pages/ai-setup-mobile.html';
        } else {
          window.open('/pages/ai-setup-mobile.html', '_blank');
        }
        return;
      }
      userMsg = '⚠️ 모든 AI 모델 한도가 일시적으로 초과됐습니다. 잠시 후 다시 시도해 주세요.';
    }
    if (existingBubble) {
      existingBubble.classList.remove('streaming');
      existingBubble.innerHTML = userMsg.replace(/\n/g, '<br>');
    } else {
      appendBubble('ai', userMsg);
    }
    console.error('[AI]', err);
  }
}



// ── _buildShadowContext — DEPRECATED (v1.1) ─────────────────────────
// 동적 컨텍스트를 system에 주입하던 방식 → _buildEnhancedUserContent로 대체.
// DeepSeek Auto Prompt Caching: system을 완전 정적으로 유지해야 캐시 적중.
// 이 함수는 더 이상 호출되지 않으며, 다음 버전에서 제거됩니다.
async function _buildShadowContext() {
  console.warn('[Shadow] _buildShadowContext는 deprecated — _buildEnhancedUserContent 사용');
  return '';
}

// ── _loadPdvSummary — PDV IndexedDB에서 요약 항목 인출 ──────────────
// _buildEnhancedUserContent 내부에서 localStorage 기반으로 간소화됨.
// IndexedDB 기반 상세 조회가 필요한 경우를 위해 보존.
async function _loadPdvSummary() {
  return new Promise((resolve) => {
    const SAFE_TYPES = ['preference', 'relation', 'economic', 'location'];
    const req = indexedDB.open('gopang_pdv_chat', 1);
    req.onerror = () => resolve([]);
    req.onsuccess = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains('messages')) { resolve([]); return; }
      try {
        const tx = db.transaction('messages', 'readonly');
        const store = tx.objectStore('messages');
        const all = store.getAll();
        all.onsuccess = () => {
          const items = (all.result || [])
            .filter(m => m.pdv && SAFE_TYPES.includes(m.pdv.type))
            .sort((a, b) => new Date(b.ts || 0) - new Date(a.ts || 0))
            .slice(0, 20)
            .reduce((acc, m) => {
              if (!acc.find(x => x.key === m.pdv.key)) {
                acc.push({ key: m.pdv.key, value: m.pdv.value });
              }
              return acc;
            }, []);
          resolve(items);
        };
        all.onerror = () => resolve([]);
      } catch { resolve([]); }
    };
  });
}
