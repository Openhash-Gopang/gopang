/**
 * ai/call-ai.js — LLM API 호출·스트리밍·GWP 태그 처리 + profile-assistant 온보딩 관리 v2.0
 *
 * (2026-07-08: PA/personal-assistant를 profile-assistant로 개명·역할 분리.
 *  "PA"라는 약칭은 이제 쓰지 않는다 — 프로필 작성만 다루는 SP가 됐다.)
 *
 * profile-assistant 온보딩 흐름:
 *   1. _buildProfileContext() — gopang_user_v4(가입 데이터) + hondi_profile_partial(진행 중 데이터)를
 *      읽어 [CONTEXT: PROFILE_ONBOARDING] 블록 생성 → profile-assistant SP에 주입
 *      → 이미 아는 항목은 다시 묻지 않음
 *   2. 호출 경로 둘 — ① settings.js 프로필 작성 패널(직접 호출)
 *      ② AGENT-COMMON의 [CALL_PROFILE_ASSISTANT] 위임(§0-E) → 이 창의
 *      system을 그대로 profile-assistant로 바꿔치기(_switchToProfileAssistantSP())
 *   3. 응답 처리 — PROFILE_SUBMIT / PROFILE_SKIP / [N/6단계] 감지 → 상태 갱신 + AC로 SP 전환
 *      / [PROFILE_INTERRUPT_HANDOFF] 감지 → 무관한 요청을 AC에게 즉시 반환
 */
import { CFG, _modelSupportsVision, PROVIDER_INFO, getPriorityOrder, MODEL_MIGRATION } from '../core/config.js';
import { TOKEN_BUDGET } from '../core/token-policy.js';
import { aiActive, history, _userLocation,
         _USER, USER_GUID, _locationPending, _locationReady, PROXY } from '../core/state.js';
import { appendBubble, showTyping, hideTyping,
         _createStreamBubble, _updateStreamBubble } from '../ui/bubble.js';
import { _buildLocNote, _buildRoutingFacts } from '../services/location.js';
import { _injectAuthConfirmButton } from '../core/auth.js';
import { _klawReview } from '../services/klaw.js';
import { openSearch } from '../ui/p2p-search.js';
import { inviteByHandle } from '../ui/p2p-chat.js';
import { _openProfilePanel } from '../ui/settings.js';
import { _gwpLaunch } from '../gwp/engine.js';
import { maybeHandleExpertTurn, applyExpertSystemIfActive,
         isExpertActive, handleExpertTag } from './expert-session.js';
import { buildHondiFaqContext } from './hondi-faq-router.js';


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
// 쓰도록 공개.
// v1.4(2026-07-05) — 실패 시 빈 문자열을 반환하는 건 그대로지만, 호출자가
// 이걸 "폴백으로 대체해도 되는 신호"로 쓰면 안 된다 — webapp.html에 있던
// 내장 _PA_SYSTEM_PROMPT 폴백(안전장치 전혀 없는 742자 축약판)을 완전히
// 제거하면서, 호출자는 빈 문자열을 받으면 명확한 오류를 보여주고 중단해야
// 한다. AGENT-COMMON은 유일한 정본이며, 그 대체물은 존재하지 않는다.
export async function _loadAgentCommonSP() {
  if (_agentCommonCache) return _agentCommonCache;
  try {
    _agentCommonCache = await _loadSpByKey('AGENT-COMMON', 'AGENT-COMMON');
    return _agentCommonCache;
  } catch (e) {
    console.error('[SP] AGENT-COMMON 로드 실패:', e.message);
    return '';
  }
}

// profile-assistant SP (2026-07-08: personal-assistant에서 프로필 작성
// 기능만 분리 독립 — 함수명도 개명. manifest 키도 'personal-assistant'→
// 'profile-assistant'로 변경(build_manifest.py 참조). 세션당 1회 캐시.
// 호출 경로 둘 다 이 함수를 공유한다: ① settings.js의 프로필 작성 패널
// (직접 호출) ② AC의 [CALL_PROFILE_ASSISTANT] 위임(§0-E) — 아래
// _switchToProfileAssistantSP()가 이 함수를 재사용.
let _profileAssistantSpCache = null;
export async function _loadProfileAssistantSP() {
  if (_profileAssistantSpCache) return _profileAssistantSpCache;
  try {
    _profileAssistantSpCache = await _loadSpByKey('profile-assistant', 'Profile-Assistant');
    return _profileAssistantSpCache;
  } catch (e) {
    console.warn('[SP] profile-assistant SP 로드 실패:', e.message);
    return null;
  }
}

// K-Search SP (2026-07-08 신설, SP-18_ksearch) — 세션당 1회 캐시.
// AC가 [KSEARCH_HANDOFF]로 호출할 때 쓴다(사용자 검색·호출 위임 —
// §0-C 역할4의 실제 구현체. 기존 §9의 "★ 미구현 — 사용 금지 ★" 대화
// 상대 호출 절을 이걸로 대체한다).
let _kSearchSpCache = null;
export async function _loadKSearchSP() {
  if (_kSearchSpCache) return _kSearchSpCache;
  try {
    _kSearchSpCache = await _loadSpByKey('SP-18_ksearch', 'K-Search');
    return _kSearchSpCache;
  } catch (e) {
    console.warn('[SP] K-Search SP 로드 실패:', e.message);
    return null;
  }
}
// klaw.js 등이 배열 참조용으로 사용 (window.history와 구분)
if (typeof window !== 'undefined') window._callAiHistoryRef = history;

// ── 응답 생성 중지(Stop) 지원 ───────────────────────────────
// 전송 버튼이 "생성 중" 상태일 때 클릭하면 stopGeneration()이 호출되어
// 현재 진행 중인 스트리밍 fetch를 중단한다 (Claude의 정지 버튼과 동일한 동작).
let _currentAbort = null;

// ── 유휴(idle) 타임아웃 공용 헬퍼 (2026-07-01) ───────────────────
// BUG-FIX: 아래 _callLLM/_callAIInner의 fetch()에는 타임아웃이 전혀 없어,
// 서버가 무응답으로 멈추면 await가 영원히 반환되지 않았다(패널 쪽 동일 버그를
// webapp.html에서 먼저 고쳤고, 메인 채팅 경로도 같은 문제가 있어 함께 고친다).
// "마지막 진행(연결 시도 또는 청크 수신)으로부터 N초"를 재는 유휴 타임아웃이며,
// linkedSignal(예: 사용자의 수동 "정지" 버튼용 _currentAbort.signal)이 먼저
// 중단되면 그것도 즉시 반영한다 — 단, 어느 쪽이 중단시켰는지는 반환된
// wasManualStop()으로 구분할 수 있어야 한다(수동 중지는 페일오버 없이 즉시
// 종료해야 하고, 유휴 타임아웃은 다음 후보로 페일오버해야 하므로 의미가 다르다).
function _makeIdleAbort(timeoutMs, linkedSignal) {
  const ctl = new AbortController();
  let timer = null;
  const onLinkedAbort = () => ctl.abort();
  if (linkedSignal) {
    if (linkedSignal.aborted) ctl.abort();
    else linkedSignal.addEventListener('abort', onLinkedAbort, { once: true });
  }
  const reset = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => ctl.abort(), timeoutMs);
  };
  const cancel = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    if (linkedSignal) linkedSignal.removeEventListener('abort', onLinkedAbort);
  };
  reset();
  return {
    signal: ctl.signal,
    reset,
    cancel,
    // true면 유휴 타임아웃이 아니라 linkedSignal(사용자 수동 중지 등)이 원인
    wasManualStop: () => !!(linkedSignal && linkedSignal.aborted),
  };
}
const _LLM_IDLE_TIMEOUT_MS = 45000; // 45초 무진행 시 자동 중단(다음 후보로 페일오버)

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
  // v1.6 — 이전엔 이 값을 항상 false로 하드코딩했다(당시엔 isOnboarding=
  // !done&&!skipped 게이트를 통과했을 때만 이 함수가 불렸으므로 실제로
  // 항상 false였음). 이제 settings.js의 프로필 작성 패널이 done=true(완료
  // 후 수정)·skipped=true(재개) 상태에서도 이 함수를 직접 부르므로, PA SP가
  // PHASE 0 분기를 정확히 타도록 실제 값을 그대로 전달해야 한다.
  let doneFlag = false, skippedFlag = false;
  try {
    doneFlag    = localStorage.getItem('hondi_profile_done')    === '1';
    skippedFlag = localStorage.getItem('hondi_profile_skipped') === '1';
  } catch {}
  lines.push(`done: ${doneFlag}`);
  lines.push(`skipped: ${skippedFlag}`);
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
  .replace(/\[TUTORIAL_ADVANCE:\d+\]/g, '')   // 튜토리얼 단계 태그
  .replace(/\[TUTORIAL_STEP:[^\]]*\]/g, '')    // 튜토리얼 컨텍스트 태그(실수로 AI가 출력하면)
  .replace(/\[PANEL_ACTION:close\]/g, '')      // AI 패널 닫기 지시 태그 (2026-07-02 신설)
  .replace(/\[GWP:\s*[\w-]+\]/g, '')           // 하위 시스템 라우팅 태그 (방어적 — 정상 경로는 _parseAgentTags가 처리)
  .replace(/\[EXPERT:\s*[@\w-]+\]/g, '')       // 전문가 세션 라우팅 태그 (방어적 — 정상 경로는 handleExpertTag가 처리)
  // 2026-07-07 신설 — 아래 5개는 이전부터 _parseAgentTags가 실제 동작은
  // 처리해왔지만 이 스트립 목록에는 빠져있어, 태그 원문이 채팅 버블에
  // 그대로 노출되던 기존 결함이었다(SEARCH/OPEN_PROFILE/P2P_INVITE).
  // 새로 추가한 3개(OPEN_SETTINGS_TAB/OPEN_K_SERVICES_TAB/SEARCH의
  // mode=tab 변형)와 함께 한 번에 정리한다.
  .replace(/\[SEARCH:\s*query=[^,\]]+,\s*type=user(?:,\s*mode=tab)?\s*\]/g, '')
  .replace(/\[OPEN_PROFILE:\s*handle=@[\w.-]+\s*\]/g, '')
  .replace(/\[P2P_INVITE:\s*handle=@[\w.-]+(?:,\s*message=[^\]]*)?\]/g, '')
  .replace(/\[OPEN_SETTINGS_TAB\]/g, '')
  .replace(/\[OPEN_K_SERVICES_TAB\]/g, '')
  .replace(/\[OPEN_MANUAL_TAB\]/g, '')
  // 2026-07-08 신설 — AC↔profile-assistant 핸드오프 태그(§0-E)
  .replace(/\[CALL_PROFILE_ASSISTANT\]/g, '')
  .replace(/\[PROFILE_INTERRUPT_HANDOFF\]/g, '')
  // 2026-07-08 신설 — AC↔K-Search 핸드오프 및 K-Search 내부 태그(SP-18)
  .replace(/\[KSEARCH_HANDOFF:\s*query=[^\]]+\]/g, '')
  .replace(/\[SEARCH\]\s*\{[\s\S]*?\}\s*\[\/SEARCH\]/g, '')
  .replace(/\[KSEARCH_CLARIFY:[^\]]*\]/g, '')
  .replace(/\[KSEARCH_CANDIDATES:\s*items=\[[\s\S]*?\]\]/g, '')
  .replace(/\[KSEARCH_RESULT:[^\]]*\]/g, '')
  .replace(/\[KSEARCH_HANDOFF_BACK:\s*reason=[\w-]+\]/g, '')
  .trim();

/**
 * _handleProfileTags — PROFILE_SUBMIT / PROFILE_SKIP / 단계 업데이트 처리
 *
 * v1.3 — export + sendFn 매개변수 추가: 메인 채팅(callAI)뿐 아니라 AI 패널
 * (webapp.html _callPanelAI) 등 다른 표면에서도 호출 가능. sendFn은 "인계
 * 안착 인사"를 어디로 보낼지 결정 — 기본값은 메인 채팅의 callAI, 패널에서
 * 호출할 때는 패널 자체의 전송 함수를 넘기면 그쪽 말풍선에 이어서 표시된다.
 *
 * v2.0 (2026-07-08) — userText 매개변수 추가: [PROFILE_INTERRUPT_HANDOFF]
 * 처리 시 "방금 사용자가 한 말"을 AC에게 그대로 재전달해야 하는데, 이
 * 함수는 fullReply(AI 응답)만 받고 있어서 그 원문에 접근할 방법이
 * 없었다. 호출부(_callAIInner)는 이미 userText를 갖고 있으므로 그대로
 * 넘겨받는다 — 기본값 ''은 하위 호환용(다른 호출부가 안 넘겨도 에러 안 남).
 */
export async function _handleProfileTags(fullReply, bubble, sendFn = callAI, userText = '') {
  // ── CALL_PROFILE_ASSISTANT — AC가 프로필 작성/수정으로 바톤 전달 (v2.0 신설, §0-E) ──
  // AGENT-COMMON의 출력에서만 나오는 태그이지만, 이 함수는 모든 응답 뒤에
  // 공통으로 호출되므로 여기서 함께 감지한다(어느 SP가 활성 상태든 상관없이
  // 동일한 디스패처를 거치는 기존 구조와 일관성 유지).
  if (fullReply.includes('[CALL_PROFILE_ASSISTANT]')) {
    console.log('[Profile] CALL_PROFILE_ASSISTANT 감지 — profile-assistant로 전환');
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    history.length = 0;
    await _switchToProfileAssistantSP();
    await _triggerProfileAssistantHandoff(sendFn);
    return true;
  }

  // ── PROFILE_INTERRUPT_HANDOFF — profile-assistant가 무관한 요청을 받아
  // AC로 즉시 반환 (v2.0 신설, profile-assistant SP §PROFILE-INTERRUPT-HANDOFF) ──
  if (fullReply.includes('[PROFILE_INTERRUPT_HANDOFF]')) {
    console.log('[Profile] PROFILE_INTERRUPT_HANDOFF 감지 — AGENT-COMMON으로 즉시 복귀');
    if (bubble) {
      const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
      if (_usb) _usb(bubble, _stripInternalTags(fullReply));
    }
    history.length = 0;
    await _switchToAssistantSP();
    // 원래 사용자 발화를 AC에게 그대로 재전달 — 사용자가 같은 말을
    // 두 번 입력할 필요가 없도록. userText가 없으면(예: 내부 인계
    // 신호 자체가 무관 판정된 극히 예외적 경우) 조용히 건너뛴다.
    if (userText) await sendFn(userText);
    return true;
  }

  // ── KSEARCH_HANDOFF — AC가 사람/AI비서 찾기·연결을 K-Search에 위임
  // (2026-07-08 신설, §9. AGENT-COMMON의 출력에서만 나온다) ──
  {
    const ksHandoffMatch = fullReply.match(/\[KSEARCH_HANDOFF:\s*query=([^\]]+)\]/);
    if (ksHandoffMatch) {
      console.log('[Search] KSEARCH_HANDOFF 감지 — K-Search로 전환');
      if (bubble) {
        const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
        if (_usb) _usb(bubble, _stripInternalTags(fullReply));
      }
      history.length = 0;
      await _switchToKSearchSP();
      await _triggerKSearchHandoff(sendFn, ksHandoffMatch[1].trim());
      return true;
    }
  }

  // ── [SEARCH]{...}[/SEARCH] — K-Search의 실제 조회 요청. CALL_PROFILE_
  // ASSISTANT 등과 달리 SP를 전환하지 않고(이미 K-Search가 활성 상태),
  // 결과만 조회해 재주입한다(2026-07-08 신설). CFG.system이 K-Search일
  // 때만 반응 — 다른 SP가 우연히 같은 문자열을 출력해도(사실상 불가능한
  // 태그 형식이지만 방어적으로) 오동작하지 않도록 가드.
  if (CFG.system?.includes('너는 K-Search')) {
    const handled = await _handleKSearchQuery(fullReply, sendFn);
    if (handled) {
      if (bubble) {
        const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
        if (_usb) _usb(bubble, _stripInternalTags(fullReply));
      }
      return true;
    }
  }

  // ── KSEARCH_RESULT — K-Search의 최종 결과. AC로 복귀 후 결과를 그대로
  // 전달해 AC가 [OPEN_PROFILE]/[P2P_INVITE] 등 후속 처리를 잇는다
  // (2026-07-08 신설) ──
  {
    const ksResultMatch = fullReply.match(/\[KSEARCH_RESULT:([^\]]*)\]/);
    if (ksResultMatch) {
      console.log('[Search] KSEARCH_RESULT 감지 — AGENT-COMMON으로 복귀:', ksResultMatch[1].trim());
      if (bubble) {
        const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
        if (_usb) _usb(bubble, _stripInternalTags(fullReply));
      }
      history.length = 0;
      await _switchToAssistantSP();
      await sendFn(`[INTERNAL: K-Search→AGENT-COMMON 인계 — 사용자에게 보이지 ` +
        `않는 내부 신호입니다. K-Search가 다음 결과를 반환했습니다: ` +
        `${ksResultMatch[1].trim()}. matched면 결과를 안내하고 필요시 ` +
        `[OPEN_PROFILE]/[P2P_INVITE]를 이어서 출력하세요. not_found/` +
        `insufficient면 솔직히 못 찾았다고 안내하세요.]`);
      return true;
    }
  }

  // ── KSEARCH_HANDOFF_BACK — K-Search가 자기 소관이 아니라고 판단해
  // 즉시 반환(자기 자신 검색·공적 기관 오인·응급 등, 2026-07-08 신설) ──
  {
    const ksBackMatch = fullReply.match(/\[KSEARCH_HANDOFF_BACK:\s*reason=([\w-]+)\]/);
    if (ksBackMatch) {
      console.log('[Search] KSEARCH_HANDOFF_BACK 감지(reason=' + ksBackMatch[1] + ') — AGENT-COMMON으로 즉시 복귀');
      if (bubble) {
        const { _updateStreamBubble: _usb } = await import('../ui/bubble.js').catch(() => ({}));
        if (_usb) _usb(bubble, _stripInternalTags(fullReply));
      }
      history.length = 0;
      await _switchToAssistantSP();
      // reason=emergency는 R0 응급 게이트와 동일한 우선순위 — 원 발화를
      // 그대로 넘겨 AC가 즉시 kemergency/kpolice 판단을 하게 한다.
      if (userText) await sendFn(userText);
      return true;
    }
  }

  // ── FIRST_GREETED — PHASE -1 최초 인사 완료 (v1.3) ──────────
  if (fullReply.includes('[FIRST_GREETED]')) {
    console.log('[Profile] FIRST_GREETED 감지 — 최초 인사 완료');
    try {
      localStorage.setItem('hondi_first_greeted', '1');
      // v2.0: 이름짓기는 UI에서 직접 처리 — name_pending 플래그 불필요
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

  // ── TUTORIAL_ADVANCE — 튜토리얼 단계 진행 (v2.0) ─────────
  const _tutAdvMatch = fullReply.match(/\[TUTORIAL_ADVANCE:(\d+)\]/);
  if (_tutAdvMatch) {
    const nextStep = parseInt(_tutAdvMatch[1], 10);
    try {
      if (nextStep >= 7) {
        localStorage.setItem('hondi_tutorial_done', '1');
        localStorage.removeItem('hondi_tutorial_step');
        console.log('[Tutorial] 완료');
      } else {
        localStorage.setItem('hondi_tutorial_step', String(nextStep));
        console.log('[Tutorial] 단계→', nextStep);
      }
    } catch {}
  }

  // ── PANEL_ACTION:close — 튜토리얼 마지막에 "닫을까요?"라고 물은 뒤
  // 사용자가 동의하면 AI가 이 태그를 출력해 실제로 패널을 닫는다
  // (2026-07-02 신설). closeAIPanel()은 webapp.html의 AI 패널 IIFE에서
  // window.closeAIPanel로 노출돼 있다 — 여기선 브라우저 전역이므로 그대로 호출.
  if (fullReply.includes('[PANEL_ACTION:close]')) {
    try {
      setTimeout(() => {
        if (typeof window !== 'undefined' && typeof window.closeAIPanel === 'function') {
          window.closeAIPanel();
        }
      }, 900); // 마지막 인사 버블을 사용자가 읽을 시간을 살짝 준 뒤 닫는다
    } catch {}
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
 * _switchToProfileAssistantSP — profile-assistant SP를 CFG.system_base /
 * CFG.system에 적용 (2026-07-08 신설, §0-E). AGENT-COMMON이
 * [CALL_PROFILE_ASSISTANT]를 출력한 직후 호출됩니다. _switchToAssistantSP()의
 * 반대 방향 — 구조는 동일(system_base/system 교체 + localStorage 저장),
 * 대상만 다르다.
 */
async function _switchToProfileAssistantSP() {
  try {
    CFG.system_base = await _loadProfileAssistantSP();
    if (!CFG.system_base) throw new Error('profile-assistant SP 로드 결과 비어있음');
    CFG.system = CFG.system_base;
    try {
      const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
      cfg.system = CFG.system;
      cfg.system_base = CFG.system_base;
      localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
    } catch {}
    console.log('[Profile] profile-assistant SP로 전환 완료');
  } catch (e) {
    console.warn('[Profile] profile-assistant SP 전환 실패 (무시):', e.message);
  }
}

/**
 * _triggerProfileAssistantHandoff — AC→profile-assistant 전환 직후, 사용자
 * 입력 없이 내부 인계 신호를 한 번 보내 profile-assistant가 곧바로
 * PHASE 0부터 이어가도록 한다(2026-07-08 신설). _triggerSeamlessHandoff와
 * 대칭 구조(반대 방향) — AC는 이미 프로필 작성 취지를 설명하고 동의를
 * 받은 뒤이므로, profile-assistant는 재인사하지 않고 바로 시작해야 한다.
 */
async function _triggerProfileAssistantHandoff(sendFn = callAI) {
  try {
    const handoff = `[INTERNAL: AGENT-COMMON→profile-assistant 인계 — 사용자에게 ` +
      `보이지 않는 내부 신호입니다. AC가 이미 프로필 작성 취지를 설명했고 ` +
      `사용자가 방금 동의했습니다. 재인사하지 말고, [CONTEXT]를 읽어 PHASE 0 ` +
      `분기부터 자연스럽게 이어서 시작하세요.]`;
    await sendFn(handoff);
  } catch (e) {
    console.warn('[Profile] profile-assistant 핸드오프 트리거 실패(무시 — 다음 사용자 메시지에서 정상 처리됨):', e.message);
  }
}

/**
 * _switchToKSearchSP — K-Search(SP-18_ksearch) SP를 CFG.system_base /
 * CFG.system에 적용 (2026-07-08 신설). AGENT-COMMON이
 * [KSEARCH_HANDOFF]를 출력한 직후 호출됩니다. _switchToProfileAssistantSP와
 * 동일 구조.
 */
async function _switchToKSearchSP() {
  try {
    CFG.system_base = await _loadKSearchSP();
    if (!CFG.system_base) throw new Error('K-Search SP 로드 결과 비어있음');
    CFG.system = CFG.system_base;
    try {
      const cfg = JSON.parse(localStorage.getItem('gopang_cfg') || '{}');
      cfg.system = CFG.system;
      cfg.system_base = CFG.system_base;
      localStorage.setItem('gopang_cfg', JSON.stringify(cfg));
    } catch {}
    console.log('[Search] K-Search SP로 전환 완료');
  } catch (e) {
    console.warn('[Search] K-Search SP 전환 실패 (무시):', e.message);
  }
}

/**
 * _triggerKSearchHandoff — AC→K-Search 전환 직후, 이용자 발화 원문을
 * 내부 신호에 실어 K-Search STEP1(의도 파싱)이 곧바로 시작하도록 한다
 * (2026-07-08 신설). K-Search SP는 "요약·재구성이 아니라 원문 그대로"를
 * 요구하므로(RULE-02 STEP1) query를 가공하지 않고 그대로 전달한다.
 */
async function _triggerKSearchHandoff(sendFn = callAI, query = '') {
  try {
    const handoff = `[INTERNAL: AGENT-COMMON→K-Search 인계 — 사용자에게 보이지 ` +
      `않는 내부 신호입니다. 재인사하지 말고 STEP1부터 시작하세요. ` +
      `이용자 발화 원문: "${query}"]`;
    await sendFn(handoff);
  } catch (e) {
    console.warn('[Search] K-Search 핸드오프 트리거 실패(무시):', e.message);
  }
}

/**
 * _handleKSearchQuery — K-Search가 출력한 [SEARCH]{...}[/SEARCH] JSON을
 * 실제 POST /search(worker.js handleSearch)로 조회하고, 결과를 내부
 * 메시지로 재주입해 K-Search STEP4(후보 평가·확정)를 이어가게 한다
 * (2026-07-08 신설 — SP-18_ksearch.txt [구현 격차] 항목(1)(2) 해소).
 * market 레포의 [SEARCH]{"keyword":...}[/SEARCH] ↔ 재주입 패턴과 동일한
 * 층위의 배선을 gopang에 이식한 것.
 *
 * @returns {boolean} true면 이 턴에서 SEARCH 태그를 감지해 처리했음
 *   (호출부가 후속 일반 처리를 생략해야 함)
 */
async function _handleKSearchQuery(fullReply, sendFn = callAI) {
  const m = fullReply.match(/\[SEARCH\]\s*(\{[\s\S]*?\})\s*\[\/SEARCH\]/);
  if (!m) return false;

  let params;
  try {
    params = JSON.parse(m[1]);
  } catch (e) {
    console.warn('[Search] [SEARCH] JSON 파싱 실패 — K-Search에 재질의:', e.message);
    await sendFn(`[INTERNAL: 방금 낸 [SEARCH] 태그의 JSON 형식이 올바르지 않아 ` +
      `조회하지 못했습니다. 형식을 정확히 다시 출력해 주세요.]`);
    return true;
  }

  try {
    const res = await fetch(`${PROXY}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error('search API ' + res.status);
    const data = await res.json();
    // search_entities RPC 반환 형식 그대로(각 항목 guid/handle/name/
    // entity_type/address/search_tags/rank 등) K-Search STEP4에 넘긴다 —
    // call-ai.js가 대신 판단하지 않는다(판단은 K-Search의 몫).
    const resultsJson = JSON.stringify(data).slice(0, 4000); // 토큰 보호용 상한
    await sendFn(`[INTERNAL: 방금 낸 [SEARCH] 조회 결과입니다. ` +
      `STEP4(후보 평가·확정)를 이어서 진행하세요. 결과에 없는 정보는 ` +
      `지어내지 마세요.\n결과: ${resultsJson}]`);
  } catch (e) {
    console.warn('[Search] /search 호출 실패:', e.message);
    await sendFn(`[INTERNAL: 방금 낸 [SEARCH] 조회가 서버 오류로 실패했습니다 ` +
      `(${e.message}). 이용자에게 검색을 지금은 완료할 수 없다고 솔직히 ` +
      `안내하고 [KSEARCH_RESULT: status=insufficient]로 마무리하세요.]`);
  }
  return true;
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
 * _buildFirstContactContext — 최초 인사("이름을 지어주세요")와 프로필 작성
 * 필요성 설명을 SP(시스템 프롬프트) 본문이 아니라, 꼭 필요한 1~2턴에만
 * 사용자 메시지 앞에 붙는 1회성 컨텍스트로 주입합니다(v1.6).
 *
 * 왜 SP에 안 박아두는가: SP는 캐시되는 고정 prefix라도 매 호출마다 다시
 * 전송·과금됩니다. "첫 인사 대본"은 평생 단 한 번만 쓰이는데 SP 본문에
 * 넣으면 모든 사용자의 모든 대화에 영구히 죽은 무게로 따라다닙니다.
 * 대신 여기서는 hondi_first_greeted/hondi_name_pending 플래그가 true인
 * 정확히 그 1~2번의 호출에만 블록을 만들어 끼워 넣고, 끝나면 완전히
 * 사라집니다 — AGENT-COMMON 본문은 첫 대화든 천 번째 대화든 완전히 동일.
 *
 * AGENT-COMMON §0-1(최초 접촉 처리)이 이 블록을 발견하면 그대로 따르고
 * [FIRST_GREETED]/[NAME_CAPTURED]를 출력 — 이후 call-ai.js의
 * _handleProfileTags()가 기존과 동일하게 처리합니다(PA SP 시절과 태그
 * 체계 100% 동일, 출력 주체만 PA→AGENT-COMMON으로 바뀜).
 *
 * @returns {string} 끼워 넣을 컨텍스트 블록(없으면 빈 문자열)
 */
/**
 * _buildFirstContactContext v2.0
 *
 * 첫 인사(FIRST_CONTACT): 이름 묻기 없이 고정 환영 문구 + 앱 기본 사용법 안내.
 *   → [FIRST_GREETED] 태그로 완료 기록.
 *
 * 튜토리얼 단계(TUTORIAL_STEP): hondi_tutorial_step 값에 따라 AGENT-COMMON에
 *   현재 단계를 알려 해당 안내를 진행하도록 한다.
 *   → AI가 [TUTORIAL_ADVANCE:N] 태그를 출력하면 call-ai.js가 step을 N으로 저장.
 *   → hondi_tutorial_done='1' 이면 더 이상 주입하지 않는다.
 *
 * 이름짓기(NAME_CAPTURE_PENDING)는 v2.0에서 제거됨 — AI 비서 이름은 AI 패널
 * 상단 이름 영역을 터치해 언제든 UI에서 직접 편집한다.
 */
export function _buildFirstContactContext() {
  let firstGreeted = false, tutStep = 0, tutDone = false;
  try {
    firstGreeted = localStorage.getItem('hondi_first_greeted') === '1';
    tutStep  = parseInt(localStorage.getItem('hondi_tutorial_step') || '0', 10);
    tutDone  = localStorage.getItem('hondi_tutorial_done') === '1';
  } catch {}

  // ── 최초 인사 (평생 1회) ──────────────────────────────────────
  if (!firstGreeted) {
    let nickname = '';
    try {
      const reg = JSON.parse(
        localStorage.getItem('gopang_user_v4') ||
        sessionStorage.getItem('gopang_user_v4') || '{}'
      );
      nickname = reg.nickname || '';
    } catch {}
    // 사용자 지정 환영 문구 — 한 글자도 바꾸지 말 것
    return (
      `[FIRST_CONTACT: 아래 문구를 토씨 하나 바꾸지 말고 그대로 출력하십시오.` +
      ` **혼디** 는 마크다운 굵은 글씨(**혼디**)로 표시합니다.` +
      ` 이번 턴은 아래 문구만 출력하고 반드시 거기서 멈추십시오 — 다른 내용 일절 금지.\n` +
      `---\n` +
      `저는 **${nickname}**님과 평생을 함께할 그림자 비서 **혼디**입니다.` +
      ` 저는 오직 ${nickname}님만을 위해 일하며, ${nickname}님의 일상과 업무를 돕고,` +
      ` 기록하며, 지시하신 각종 업무를 수행할 것입니다.\n\n` +
      `먼저, 혼디 앱의 사용법을 간단히 설명드리겠습니다.` +
      ` 좌측 하단의 마이크를 터치한 뒤 제 이름을 부르시거나,` +
      ` 오른쪽 하단의 "AI" 버튼을 터치하면 제가 나타날 거예요.` +
      ` 제게 무엇이든 지시하시면 됩니다.\n\n` +
      `이해하셨으면 다음 항목을 말씀드릴게요. 준비되셨나요?\n` +
      `---\n응답 끝에 반드시 [FIRST_GREETED]를 출력하십시오.]\n\n`
    );
  }

  // ── 튜토리얼 단계 주입 (완료 전까지) ────────────────────────
  if (!tutDone) {
    return (
      `[TUTORIAL_STEP:${tutStep} — 아래 단계별 안내를 진행하십시오(§0-1 참조).` +
      ` 각 단계 완료 시 응답 끝에 [TUTORIAL_ADVANCE:${tutStep + 1}]를 출력하십시오.]\n\n`
    );
  }

  return '';
}

/**
 * _buildEnhancedUserContent — 동적 컨텍스트를 사용자 메시지 앞에 병합
 *
 * DeepSeek Auto Prompt Caching 최적화의 핵심:
 *   • system 메시지는 완전히 정적 → 캐시 prefix 100% 보존
 *   • GUID·위치·PDV 요약은 ctxMsg(별도 메시지)가 아닌 현재 user 메시지 앞에 주입
 *   → 캐시 prefix(system)가 매 호출 동일 → DeepSeek 캐시 적중률 95%+
 *
 * v1.6 — "PA 온보딩 중" 분기를 제거했습니다. 메인 채팅/AI 패널은 더 이상
 * PA SP를 직접 로드하지 않고 항상 AGENT-COMMON을 씁니다(PA SP는 settings.js
 * 의 프로필 작성 패널 전용 — _buildProfileContext()는 거기서 직접 부릅니다).
 * 대신 _buildFirstContactContext()로 "최초 인사/이름짓기" 1회성 컨텍스트를
 * 매 턴 검사해서, 필요한 딱 그 1~2턴에만 끼워 넣습니다.
 *
 * @param {string|Array} userContent — 현재 사용자 메시지 (텍스트 또는 multipart)
 * @returns {string|Array} 컨텍스트가 병합된 사용자 메시지
 */
async function _buildEnhancedUserContent(userContent) {
  const parts = [];

  // GUID + 위치 + PDV 요약 (RAG 스타일, 압축)
  if (USER_GUID) parts.push(`GUID:${USER_GUID.slice(-8)}`);

  // 2026-07-05 신설 — 사용자 본인의 닉네임/handle. 라우팅 확정 시
  // "{사용자}님, {대상}을 호출하겠습니다" 같은 확인 문구에 필요.
  // 아래 '비서이름'과 반드시 구분할 것 — 이건 이용자 자신을 가리키는
  // 값이고, '비서이름'은 이용자가 지어준 그림자 AI(자기 자신)의 이름이다.
  const userLabel = _USER?.nickname || _USER?.handle || '';
  if (userLabel) parts.push(`사용자:${userLabel}`);

  // v1.3 — 이용자가 지어준 AI 비서 이름을 매 턴 함께 전달(새로고침으로 history가
  // 끊겨도 AGENT-COMMON이 계속 같은 이름을 쓸 수 있도록)
  // 2026-07-05: 키를 '이름'→'비서이름'으로 명확화(위 '사용자' 필드와 혼동 방지 —
  // 과거엔 이 값 하나만 있어서 AGENT-COMMON이 자기소개용인지 호칭용인지
  // 헷갈릴 여지가 있었음).
  const assistantName = localStorage.getItem('hondi_assistant_name') || '';
  if (assistantName) parts.push(`비서이름:${assistantName}`);

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

  // v1.6 — 최초 인사/이름짓기 1회성 블록(있을 때만, 평생 1~2턴)
  const firstContact = _buildFirstContactContext();

  // HONDI-FAQ(2026-07-01 신설) — 혼디 생태계 지식(PDV·GDC·OpenHash 등)을
  // AGENT-COMMON에 전부 넣는 대신, 사용자 발화 키워드가 매칭될 때만 해당
  // 주제의 상세 설명을 이번 턴의 user 메시지에만 끼워 넣는다(system
  // prefix는 그대로라 DeepSeek 캐시 적중률에 영향 없음). industry-router.js
  // 와 동일한 "키워드 매칭 → 필요한 것만 로드" 패턴 — 자세한 설계 근거는
  // hondi-faq-router.js 상단 주석 참조.
  const plainText = typeof userContent === 'string'
    ? userContent
    : (Array.isArray(userContent) ? (userContent.find(c => c.type === 'text')?.text || '') : '');
  const faqBlock = await buildHondiFaqContext(plainText);

  if (!parts.length && !firstContact && !faqBlock) return userContent;

  const ctxBlock = firstContact + faqBlock + (parts.length ? `[ctx]\n${parts.join('\n')}\n\n` : '');

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
// ══════════════════════════════════════════════════════════
// 자동 Pro 승격 판단 (v1, 2026-07-01)
// ══════════════════════════════════════════════════════════
// 사용자는 더 이상 Flash/Pro를 직접 고르지 않는다. 이번 턴의 질문이
// "복잡하다"고 판단되면 그 턴 한 번만 자동으로 hondi-pro를 쓰고,
// 나머지는 전부 hondi-flash를 쓴다 — 세션 전체를 Pro로 고정하는 것보다
// 무료 한도를 훨씬 아낄 수 있다.
//
// K-Law·K-Tax 같은 전문 분야 계산/추론은 이미 router.js가 별도 SP로
// 라우팅하므로, 여기서 잡아야 하는 "복잡함"은 그 라우팅 이전에
// AGENT-COMMON 자신이 직접 처리해야 하는 것들이다: 여러 조건이 얽힌
// 계획·일정, 코드 작성/디버깅, 여러 항목 비교, 명시적으로 "차근차근/
// 단계별로" 를 요구하는 요청 등.
//
// 판단을 위해 LLM을 한 번 더 부르면 지연·비용이 배가되므로, 여기서는
// 휴리스틱(키워드+구조적 신호) 점수제만 쓴다. 애매하면 Flash 쪽으로
// 기운다(비용 보수적) — 임계값은 실사용 로그를 보면서 조정할 것.
const _COMPLEXITY_PATTERNS = [
  /코드|버그|디버그|에러|함수|변수|스크립트|알고리즘/,      // 코드/디버깅
  /계산|환산|이자율|퍼센트|%|비율|합계|평균/,                // 수치 연산
  /비교해|장단점|어느\s*게|뭐가\s*더|중\s*(뭐|어떤)/,        // 비교/선택
  /만약|~라면|그리고\s*나서|단계별로|차근차근|순서대로/,      // 조건부·다단계
  /일정.*예산|예산.*이내|계획.*세워|동선/,                   // 복수 제약 계획
];
const COMPLEXITY_PRO_THRESHOLD = 3; // 이 점수 이상이면 이번 턴만 Pro

function _estimateQueryComplexity(userText, messages) {
  if (typeof userText !== 'string' || !userText.trim()) return 0;
  const text = userText.trim();
  let score = 0;

  // 1) 길이 — 길수록 여러 조건·맥락이 얽혀 있을 가능성이 높다
  if (text.length > 400) score += 2;
  else if (text.length > 180) score += 1;

  // 2) 한 메시지에 여러 요청이 겹쳐 있는지(물음표 반복, 목록형 나열)
  const qMarks = (text.match(/\?/g) || []).length;
  if (qMarks >= 2) score += 1;
  if (/\n\s*[-*\d]/.test(text)) score += 1;

  // 3) 키워드 신호 — 패턴당 1점
  for (const re of _COMPLEXITY_PATTERNS) {
    if (re.test(text)) score += 1;
  }

  // 4) 같은 주제로 대화가 이미 길게 이어지는 중이면(복잡한 작업 진행 중일 가능성)
  if (Array.isArray(messages) && messages.length >= 10) score += 1;

  return score;
}

// _buildCallCandidates() 및 웹앱 AI 패널(webapp.html)이 공용으로 쓴다.
// 반환값은 실제 벤더 모델명이 아니라 "hondi-flash"/"hondi-pro" 논리
// 이름 — worker.js가 실제 백엔드로 매핑한다.
export function _resolveHondiTier(userText, messages) {
  const score = _estimateQueryComplexity(userText, messages);
  if (score >= COMPLEXITY_PRO_THRESHOLD) {
    console.log(`[Hondi Tier] 복잡도 점수 ${score} → hondi-pro 자동 승격`);
    return 'hondi-pro';
  }
  return 'hondi-flash';
}

function _buildCallCandidates(userText, messages) {
  const candidates = [];

  // 1) 사용자가 등록한 provider 키들 (ai-setup-mobile.html에서 등록)
  //    저장 순서와 무관하게 PRIORITY_ORDER(OR→Claude→Gemini→DeepSeek→ChatGPT→Grok)로
  //    항상 재정렬 — 키가 등록된 provider만 그 순서대로 호출된다.
  if (Array.isArray(CFG.providers)) {
    const priorityOrder = getPriorityOrder();
    const sorted = [...CFG.providers].sort((a, b) => {
      const ia = priorityOrder.indexOf(a?.provider);
      const ib = priorityOrder.indexOf(b?.provider);
      return (ia === -1 ? 999 : ia) - (ib === -1 ? 999 : ib);
    });

    for (const p of sorted) {
      if (!p?.apiKey || !p?.model) continue;
      const info = PROVIDER_INFO[p.provider];
      if (!info) continue;

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

  // 3) 최종 안전망 — 혼디 제공 DeepSeek 기본 키 (v3.2, 2026-07-01)
  // 사용자 키 등록 여부와 무관하게 항상 마지막 후보로 추가된다. 서버가
  // 자신의 키로 호출하므로 클라이언트는 apiKey가 필요 없다 — "1,000원 무료
  // 제공" 정책의 실제 구현체. model은 실제 벤더 모델명이 아니라 "hondi-flash"/
  // "hondi-pro" 논리 티어 이름이며, worker.js가 실제 백엔드(공식 DeepSeek API
  // 또는 나중에 붙을 혼디 자체 추론 서버)로 매핑한다.
  // v3.2: 사용자가 직접 고르던 Flash/Pro 수동 선택을 제거하고, 이번 턴
  // 질문의 복잡도를 보고 _resolveHondiTier()가 자동으로 고른다.
  candidates.push({
    provider: 'deepseek-default',
    baseUrl:  CFG.endpoint.replace(/\/+$/, ''),
    model:    _resolveHondiTier(userText, messages),
    apiKey:   null,
    isProxy:  true,
  });

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
  const _lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const _lastUserText = typeof _lastUserMsg?.content === 'string' ? _lastUserMsg.content : '';
  const candidates = _buildCallCandidates(_lastUserText, messages);

  let res = null, lastErr = null, idle = null;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    // BUG-FIX(2026-07-01): 이 함수는 stopGeneration()과 무관한 별도 호출
    // 경로(핸드오프·전문가 세션 등)라 사용자 수동 중지 신호가 없다 — 순수
    // 유휴 타임아웃만 건다(45초 무진행 시 다음 후보로 페일오버).
    idle = _makeIdleAbort(_LLM_IDLE_TIMEOUT_MS, null);
    try {
      const reqBody = { model: c.model, messages, max_tokens, temperature, stream: true };
      if (!PROVIDER_INFO[c.provider]?.noStreamOptions) {
        reqBody.stream_options = { include_usage: true };
      }
      // 'legacy'(사용자가 직접 운영하는 커스텀 엔드포인트)는 알려진 벤더가
      // 아니므로 중계 허용목록에 없다 — 이 경로만 예외적으로 직접 호출한다.
      // 'deepseek-default'는 혼디 제공 무료 기본 키(hondi-flash/hondi-pro) —
      // apiKey 없이 /deepseek(서버가 자체 키·티어별 모델 매핑 처리)로 직행한다.
      const attempt = c.provider === 'legacy'
        ? await fetch(`${c.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.apiKey}` },
            body: JSON.stringify(reqBody),
            signal: idle.signal,
          })
        : c.provider === 'deepseek-default'
        ? await fetch(`${c.baseUrl}/deepseek`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...reqBody, guid: _USER?.ipv6 || USER_GUID || null }),
            signal: idle.signal,
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
            signal: idle.signal,
          });
      idle.reset(); // 연결 응답 수신 — 스트리밍 구간 타이머로 리셋
      if (attempt.ok) { res = attempt; break; }
      idle.cancel();
      const errBody = await attempt.text().catch(() => '');
      lastErr = new Error(`API ${attempt.status}: ${errBody.slice(0, 300) || '응답없음'}`);
      console.warn(`[_callLLM] ${c.provider}(${c.model}) 실패(${attempt.status}) — 다음 후보로 전환`);
      continue;
    } catch (fetchErr) {
      idle.cancel();
      lastErr = (fetchErr.name === 'AbortError') ? new Error('응답 시간 초과(45초)') : fetchErr;
      continue;
    }
  }
  if (!res) throw (lastErr || new Error('모든 LLM 호출에 실패했습니다.'));

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let fullReply = '', buf = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      idle.reset(); // 청크(또는 종료)를 받을 때마다 유휴 타이머 리셋
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
  } catch (streamErr) {
    // 스트리밍 도중 유휴 타임아웃(45초 무응답)으로 중단된 경우 — 사용자가
    // 읽기 힘든 "AbortError"보다 원인이 분명한 메시지로 바꿔 던진다.
    throw (streamErr.name === 'AbortError') ? new Error('응답 시간 초과(45초, 스트리밍 중단)') : streamErr;
  } finally {
    idle.cancel();
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
export function _parseAgentTags(fullReply, bubble, userText, _preTab) {
  // [GWP: serviceId] — 하위 시스템 새 탭 오픈 (SP-00 v10.0, 기존 로직 그대로 이전)
  try {
    // BUG-FIX(2026-07-02): AGENT-COMMON 프롬프트는 "[GWP: klaw]"처럼 콜론
    // 뒤에 공백을 넣는 형식으로 일관되게 지시하는데(289/368/886~889행),
    // 이 정규식은 공백을 허용하지 않아 실제 모델 출력과 100% 어긋났다.
    // 그 결과 (1) 서비스가 전혀 열리지 않고 (2) 매칭 실패 시엔 태그
    // 제거(strip)도 안 일어나 원문 그대로("[GWP: klaw]") 채팅창에
    // 노출됐다 — 사용자가 실제로 겪은 증상과 정확히 일치. 콜론 뒤 공백을
    // 선택적으로 허용하도록 \s*를 추가한다.
    const gwpMatch = fullReply.match(/\[GWP:\s*([\w-]+)\]/);
    if (gwpMatch) {
      const svcId  = gwpMatch[1];
      const svcDef = (typeof getService === 'function') ? getService(svcId) : null;
      if (svcDef) {
        console.info('[GWP] LLM 판단 → 새 탭:', svcId);
        if (bubble) _updateStreamBubble(bubble, fullReply.replace(/\[GWP:\s*[\w-]+\]\s*/, ''));
        _gwpLaunch(svcDef, userText, _preTab, _buildRoutingFacts());
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
  // (같은 탭 오버레이 — 그림자 AI가 대화 맥락 안에서 후보를 잠깐 보여줄 때)
  //
  // [SEARCH: query={검색어}, type=user, mode=tab] — 2026-07-07 신설
  // 이용자가 "검색 창을 열어줘"처럼 검색 자체를 목적으로 명시적으로
  // 요청한 경우, 상세 필터가 포함된 전용 새 탭(pages/search-tab.html)을
  // 연다. mode=tab이 없으면 기존과 동일하게 같은 탭 오버레이로 처리한다.
  try {
    const searchMatch = fullReply.match(
      /\[SEARCH:\s*query=([^,\]]+),\s*type=user(?:,\s*mode=(tab))?\s*\]/
    );
    if (searchMatch) {
      const q    = searchMatch[1].trim();
      const mode = searchMatch[2];
      console.info('[Tags] SEARCH →', q, mode === 'tab' ? '(새 탭)' : '(같은 탭)');
      if (mode === 'tab') {
        const url = '/pages/search-tab.html' + (q ? '?q=' + encodeURIComponent(q) : '');
        if (_preTab && !_preTab.closed) _preTab.location.href = url;
        else window.open(url, '_blank');
      } else {
        openSearch(q);
      }
    }
  } catch (e) {
    console.warn('[Tags] SEARCH 처리 오류 (무시):', e.message);
  }

  // [OPEN_SETTINGS_TAB] — 2026-07-07 신설. 설정 페이지를 새 탭에서 연다.
  // webapp.html?panel=settings 딥링크로 여는 이유는 gopang-app.js 상단
  // 주석 참조(설정 패널이 webapp.html 정적 마크업에 강하게 결합돼 있어
  // 그 마크업 자체를 재사용하는 쪽이 안전함).
  try {
    if (/\[OPEN_SETTINGS_TAB\]/.test(fullReply)) {
      console.info('[Tags] OPEN_SETTINGS_TAB');
      const url = '/webapp.html?panel=settings';
      if (_preTab && !_preTab.closed) _preTab.location.href = url;
      else window.open(url, '_blank');
    }
  } catch (e) {
    console.warn('[Tags] OPEN_SETTINGS_TAB 처리 오류 (무시):', e.message);
  }

  // [OPEN_K_SERVICES_TAB] — 2026-07-07 신설. K 서비스(GWP_REGISTRY) 전체
  // 목록을 새 탭(pages/k-services.html)에 표시한다.
  try {
    if (/\[OPEN_K_SERVICES_TAB\]/.test(fullReply)) {
      console.info('[Tags] OPEN_K_SERVICES_TAB');
      const url = '/pages/k-services.html';
      if (_preTab && !_preTab.closed) _preTab.location.href = url;
      else window.open(url, '_blank');
    }
  } catch (e) {
    console.warn('[Tags] OPEN_K_SERVICES_TAB 처리 오류 (무시):', e.message);
  }

  // [OPEN_MANUAL_TAB] — 2026-07-08 신설. 사용자 매뉴얼을 새 탭에서 연다.
  // 기존엔 위쪽 가장자리 스와이프(edge-handle-top → openUserManual())로만
  // 열렸고, AGENT-COMMON §0-C/§0-D는 "매뉴얼 보여줘"가 §9 태그로 새 탭을
  // 연다고 서술했지만 실제 태그가 없던 상태였다(사고실험 300건 중 G섹션
  // 갭으로 발견) — 이 태그로 그 갭을 메운다. OPEN_SETTINGS_TAB과 동일하게
  // 기존 정적 페이지(user-manual.html)를 그대로 새 탭에 띄운다.
  try {
    if (/\[OPEN_MANUAL_TAB\]/.test(fullReply)) {
      console.info('[Tags] OPEN_MANUAL_TAB');
      const url = '/user-manual.html';
      if (_preTab && !_preTab.closed) _preTab.location.href = url;
      else window.open(url, '_blank');
    }
  } catch (e) {
    console.warn('[Tags] OPEN_MANUAL_TAB 처리 오류 (무시):', e.message);
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

  // ── SP 결정 (캐시 최적화 v1.1, v1.6 — PA 자동 로드 분기 제거) ──────
  // 원칙: system 메시지는 세션 내 절대 변경하지 않는다 (DeepSeek 캐시 prefix 보존).
  //   • AGENT-COMMON: system_base에 최초 1회 로드 후 고정 — 메인 채팅/AI 패널은
  //     이제 항상 이것만 쓴다. PA SP는 더 이상 여기서 자동으로 끼어들지 않는다.
  //   • PA SP는 settings.js의 프로필 작성 패널(openProfileComposer)에서만,
  //     그 패널 전용의 독립된 history로 호출된다 — 메인 채팅 history와 무관.
  //   • 동적 데이터(GUID·위치·PDV·최초 인사): system이 아닌 user 메시지 앞에 병합
  //     (_buildEnhancedUserContent/_buildFirstContactContext 참조)
  //   • 그림자 컨텍스트(_buildShadowContext): 제거 — user 메시지 병합 방식으로 대체

  // ── 전문가 AI(페르소나) 세션 처리 ────────────────────────
  // 명시적 종료 발화("끝났어" 등) 감지 시 endExpertSession()이 즉시 실행되어
  // CFG.system을 그림자 AI(AGENT-COMMON)로 복원한다 — 이 경우 아래 SP 결정
  // 로직을 정상적으로 통과시켜 그림자 AI가 이번 발화에 바로 응답하게 한다.
  await maybeHandleExpertTurn(userText);

  if (isExpertActive()) {
    // 전문가 세션이 이번 턴에도 유지됨 — AGENT-COMMON 결정 로직을 건너뛰고
    // 페르소나 System Prompt를 그대로 유지한다(history는 공유 — 맥락 보존,
    // PA→AGENT-COMMON 전환과 달리 여기서는 history를 비우지 않는다).
    applyExpertSystemIfActive();
  } else {

  // AGENT-COMMON 최초 1회 로드 (이후 캐시) — manifest["AGENT-COMMON"] 키로 버전 결정
  if (!CFG.system_base) {
    CFG.system_base = await _loadAgentCommonSP();
  }
  if (!CFG.system) CFG.system = CFG.system_base || '';

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
  const enhancedUserContent = await _buildEnhancedUserContent(userContent);

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
  // 사용자가 등록한 BYOK provider들 순서대로 시도한 뒤, 마지막엔 항상
  // 혼디 제공 DeepSeek 기본 키(hondi-flash/hondi-pro)로 폴백한다 —
  // 그래서 candidates는 절대 0개가 되지 않는다. 티어는 이번 턴 원본
  // userText(가공 전)의 복잡도를 보고 자동으로 정해진다.
  const candidates = _buildCallCandidates(typeof userText === 'string' ? userText : '', messages);
  const activeModel = CFG.model;
  console.log(`[AI] 호출 후보 ${candidates.length}개 준비 — 1번부터 순차 시도`);

  // ── 스트리밍 호출 (페일오버 포함) ───────────────────────
  try {
    let res = null, usedCandidate = null, lastErr = null, idle = null;

    for (let i = 0; i < candidates.length; i++) {
      const c = candidates[i];
      console.log(`[AI] 시도 ${i + 1}/${candidates.length} → ${c.baseUrl}/chat/completions | 모델: ${c.model} | ${c.isProxy ? '프록시(보안)' : 'provider: ' + c.provider}`);
      // BUG-FIX(2026-07-01): 기존엔 _currentAbort?.signal(사용자 수동 "정지"
      // 버튼)만 연결돼 있고 자동 타임아웃이 전혀 없어, 서버가 무응답으로
      // 멈추면 사용자가 직접 정지 버튼을 누르기 전까지 영원히 대기했다.
      // _currentAbort와 idle 타임아웃을 함께 연결하되, idle.wasManualStop()으로
      // "사용자가 정지 버튼을 눌렀는지"와 "그냥 45초 무응답이었는지"를 구분해
      // 후자는 기존처럼 다음 후보로 페일오버되게 한다.
      idle = _makeIdleAbort(_LLM_IDLE_TIMEOUT_MS, _currentAbort?.signal);
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
        // 막힌다(서버 간 호출만 허용하는 게 일반적). 서버(/llm/relay)를
        // 한 번 거쳐서 보낸다(여전히 사용자 본인 키·본인이 고른 모델 그대로).
        // 'legacy'(사용자가 직접 운영하는 커스텀 엔드포인트)는 알려진 벤더가
        // 아니므로 중계 허용목록에 없다 — 이 경로만 예외적으로 직접 호출한다.
        // 'deepseek-default'는 혼디 제공 무료 기본 키(hondi-flash/hondi-pro) —
        // apiKey 없이 /deepseek(서버가 자체 키·티어별 모델 매핑 처리)로 직행한다.
        const attempt = c.provider === 'legacy'
          ? await fetch(`${c.baseUrl}/chat/completions`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${c.apiKey}` },
              body: JSON.stringify(reqBody),
              signal: idle.signal,
            })
          : c.provider === 'deepseek-default'
          ? await fetch(`${c.baseUrl}/deepseek`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ ...reqBody, guid: _USER?.ipv6 || USER_GUID || null }),
              signal: idle.signal,
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
              signal: idle.signal,
            });

        idle.reset(); // 연결 응답 수신 — 스트리밍 구간 타이머로 리셋
        if (attempt.ok) { res = attempt; usedCandidate = c; break; }

        // 실패(429/402/404/400/5xx 등 모든 상황) → 다음 후보로 항상 페일오버
        // (단종된 모델일 때도, 한도 초과도, 일시 장애도 어떻든 다음 LLM을 시도한다)
        idle.cancel();
        const errBody = await attempt.text().catch(() => '');
        lastErr = new Error(`API ${attempt.status}: ${errBody.slice(0, 300) || '응답없음'}`);
        console.warn(`[AI] ${c.provider}(${c.model}) 실패(${attempt.status}) — 다음 LLM으로 전환:`, errBody.slice(0, 150));
        continue;
      } catch (fetchErr) {
        if (fetchErr.name === 'AbortError' && idle.wasManualStop()) {
          idle.cancel();
          throw fetchErr; // 진짜 사용자 수동 중지 — 페일오버 없이 즉시 중단
        }
        idle.cancel();
        // idle 타임아웃(45초 무응답)이거나 기타 네트워크 오류 — 다음 후보가
        // 있으면 계속 시도(기존 정책과 동일하게 취급)
        lastErr = (fetchErr.name === 'AbortError') ? new Error('응답 시간 초과(45초)') : fetchErr;
        if (i < candidates.length - 1) continue;
        throw lastErr;
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

    try {
      while (true) {
        const { done, value } = await reader.read();
        idle.reset(); // 청크(또는 종료)를 받을 때마다 유휴 타이머 리셋
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
    } catch (streamErr) {
      // BUG-FIX(2026-07-01): 스트리밍 도중(연결은 됐지만 그 이후 청크가
      // 끊긴 경우) 발생한 idle 타임아웃도 AbortError로 뜬다. 이걸 그대로
      // 두면 바로 아래 바깥쪽 catch(err)의 "err.name==='AbortError' →
      // 사용자가 정지 버튼을 눌렀다"는 분기를 타서, 실제로는 응답 시간
      // 초과인데도 아무 안내 없이 조용히 종료돼 버린다. 진짜 수동 중지만
      // AbortError로 그대로 올려보내고, idle 타임아웃은 이름이 다른 에러로
      // 바꿔 아래에서 정상적으로 "⚠️ API 오류: 응답 시간 초과" 안내가
      // 뜨도록 한다.
      if (streamErr.name === 'AbortError' && !idle.wasManualStop()) {
        throw new Error('응답 시간 초과(45초, 스트리밍 중단)');
      }
      throw streamErr;
    } finally {
      idle.cancel();
    }

    if (!fullReply) fullReply = '(응답 없음)';
    console.log(`[AI] 응답 완료 — ${fullReply.length}자`);
    if (CFG._modelOverride) { CFG.model = CFG._modelOverride; CFG._modelOverride = null; }
    history.push({ role: 'assistant', content: fullReply });
    if (bubble) bubble.classList.remove('streaming');


    // ── PROFILE 태그 처리 (SUBMIT / SKIP / 단계 업데이트 / 최초 인사·이름짓기 /
    //    CALL_PROFILE_ASSISTANT / PROFILE_INTERRUPT_HANDOFF) ──
    // v2.0(2026-07-08) — CALL_PROFILE_ASSISTANT는 AGENT-COMMON 쪽에서,
    // PROFILE_INTERRUPT_HANDOFF는 profile-assistant 쪽에서 나온다. 나머지는
    // 이전과 동일하게 profile-assistant SP에서만 나온다. 어느 SP가 활성
    // 상태든 이 함수 하나가 공통 처리한다.
    // SUBMIT/SKIP/CALL_PROFILE_ASSISTANT/PROFILE_INTERRUPT_HANDOFF 감지 시
    // history 초기화 + SP 전환 후 true 반환 → 후속 처리 생략.
    const _profileHandled = await _handleProfileTags(fullReply, bubble, callAI, userText);
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
      handleExpertTag(fullReply, userText, _preTab).catch(e =>
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
    const _isQuotaMsg = err.message.includes('402') || err.message.includes('Insufficient Balance') ||
      err.message.includes('FREE_QUOTA_EXCEEDED');
    if (_isQuotaMsg) {
      // BUG FIX(2026-07-01): 이전엔 사용자 키 미등록 시 대화창을 벗어나
      // ai-setup-mobile.html로 강제 이동시켰다 — 가입 직후 강제 LLM 설정
      // 이동을 없앤 것과 정면으로 모순되는 잔재였다. deepseek-default(혼디
      // 제공 무료 기본 키)가 항상 마지막 안전망으로 있으므로, 여기 도달했다는
      // 건 "무료 한도까지 다 썼다"는 뜻이다. 페이지 이동 없이 대화창 안에서
      // 안내하고, 설정으로 가는 버튼만 제공한다.
      userMsg =
        '🔑 무료로 제공되는 1,000원어치 AI 사용량을 모두 사용했어요.<br>' +
        '설정에서 본인의 AI 키를 등록하시면 제한 없이 계속 쓰실 수 있어요.<br>' +
        '<button onclick="window.openAISettings && window.openAISettings()" ' +
        'style="margin-top:8px;padding:8px 14px;border:none;border-radius:8px;' +
        'background:#1A73E8;color:#fff;font-weight:600;cursor:pointer">AI 설정하러 가기</button>';
    }
    if (existingBubble) {
      existingBubble.classList.remove('streaming');
      existingBubble.innerHTML = userMsg.replace(/\n/g, '<br>');
    } else {
      appendBubble('ai', userMsg, true);
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
