/**
 * ai/expert-session.js — 전문가 AI(26개 페르소나) 세션 관리
 *
 * 전문 분야(기관) AI(K-Law 등)는 새 탭으로 열리지만, 전문가 AI(변호사·간호사 등)는
 * 별도 서비스가 없는 순수 System Prompt이므로 "같은 스레드 안에서 System Prompt만
 * 교체"하는 방식으로 호출한다. PA→AGENT-COMMON 전환과 동일한 패턴을 재사용한다.
 *
 * 종료 시점 정의(예외 없이 그림자 AI에게 보고하기 위해 둘 다 적용):
 *   1) 명시적 종료 발화 — "끝났어", "그만", "돌아가줘" 등 감지 시 즉시 종료
 *   2) 무응답 타임아웃 — EXPERT_TIMEOUT_MS(기본 10분) 동안 추가 발화가 없으면 자동 종료
 *   (장차 페르소나 SP가 자체적으로 [EXPERT_DONE] 태그를 출력하도록 개정되면,
 *    handleExpertTag()의 done 분기에서 동일하게 처리되도록 이미 분기를 마련해 두었다.)
 *
 * 종료되면: history에서 세션 시작 이후 구간만 잘라 6하원칙 요약 → PDV 기록
 *          → CFG.system을 그림자 AI(AGENT-COMMON)로 복원 → 안내 버블 출력.
 */
import { CFG } from '../core/config.js';
import { history, _USER } from '../core/state.js';
import { appendBubble } from '../ui/bubble.js';
import { _recordPDV } from '../pdv/record.js';
import { summarizeTranscript6W } from './report-utils.js';
import { EXPERT_REGISTRY, COMMON_GUARDRAILS_URL, COMMON_MEDICAL_SAFETY_URL }
  from './expert-registry.js';

const EXPERT_TIMEOUT_MS = 10 * 60 * 1000; // 10분 무응답 → 자동 종료
const TERMINATION_RE = /끝났|그만|종료|돌아가|그림자\s*AI(로|에게)?\s*(돌아|연결)/;

// ── 세션 상태 (단일 사용자 탭 기준 — 전역 1개) ───────────────
let _expert = {
  active:     false,
  personaId:  null,
  def:        null,
  startIdx:   0,       // 세션 시작 시점의 history.length (요약 시 슬라이스 기준)
  timer:      null,    // 무응답 타임아웃 setTimeout 핸들
};

// 합성된 System Prompt 캐시 (같은 페르소나 재호출 시 재요청 방지)
const _promptCache = new Map();

export function isExpertActive() {
  return _expert.active;
}

export function currentExpertLabel() {
  return _expert.def ? `${_expert.def.icon} ${_expert.def.label}` : null;
}

// ── 합성 System Prompt 로드 (공통 가드레일 + (의료시) 안전모듈 + 페르소나) ──
async function _composeExpertPrompt(def) {
  if (_promptCache.has(def.file)) return _promptCache.get(def.file);

  const parts = [];
  try {
    const commonRes = await fetch(COMMON_GUARDRAILS_URL);
    if (commonRes.ok) parts.push(await commonRes.text());
  } catch (e) { console.warn('[Expert] 공통 가드레일 로드 실패:', e.message); }

  if (def.needsMedicalSafety) {
    try {
      const medRes = await fetch(COMMON_MEDICAL_SAFETY_URL);
      if (medRes.ok) parts.push(await medRes.text());
    } catch (e) { console.warn('[Expert] 의료 안전모듈 로드 실패:', e.message); }
  }

  try {
    const personaRes = await fetch(def.file);
    parts.push(personaRes.ok ? await personaRes.text() :
      `[${def.label} 페르소나 SP 로드 실패 — 일반 전문가 모드로 응답]`);
  } catch (e) {
    console.warn('[Expert] 페르소나 SP 로드 실패:', e.message);
    parts.push(`[${def.label} 페르소나 SP 로드 실패 — 일반 전문가 모드로 응답]`);
  }

  const composed = parts.join('\n\n---\n\n');
  _promptCache.set(def.file, composed);
  return composed;
}

// ── 타임아웃 타이머 재설정 ───────────────────────────────────
function _resetTimeoutTimer() {
  if (_expert.timer) clearTimeout(_expert.timer);
  _expert.timer = setTimeout(() => {
    console.info('[Expert] 무응답 타임아웃 — 자동 종료:', _expert.personaId);
    endExpertSession('timeout').catch(e => console.warn('[Expert] 타임아웃 종료 실패:', e.message));
  }, EXPERT_TIMEOUT_MS);
}

function _clearTimeoutTimer() {
  if (_expert.timer) { clearTimeout(_expert.timer); _expert.timer = null; }
}

// ── [EXPERT:personaId] 태그 감지 → 세션 시작 ─────────────────
// call-ai.js의 GWP 태그 파서 옆에서 같이 호출한다.
export async function handleExpertTag(fullReply) {
  // BUG-FIX(2026-07-02): AGENT-COMMON 프롬프트가 "[EXPERT: SP-LAW-01]"처럼
  // 콜론 뒤 공백을 넣는 형식으로 지시하는데(316/368/893~896행), 이 정규식은
  // 공백을 허용하지 않아 실제 출력과 어긋나 있었다 — GWP와 동일한 원인,
  // 동일한 수정(\s* 추가).
  //
  // ※ 별개 미구현 사항: 프롬프트 896행은 "[EXPERT: @handle]"로 특정 인물을
  // handle로 직접 지목하는 사용법도 예시로 들고 있으나, EXPERT_REGISTRY는
  // lawyer/nurse 같은 정적 직업군 키만 갖고 있고 @handle 조회 로직 자체가
  // 없다 — 이건 정규식 문제가 아니라 아직 만들어지지 않은 기능이다.
  const m = fullReply?.match(/\[EXPERT:\s*([\w-]+)\]/);
  if (!m) return false;
  const personaId = m[1];
  const def = EXPERT_REGISTRY[personaId];
  if (!def) {
    console.warn('[Expert] 알 수 없는 전문가 ID:', personaId);
    return false;
  }
  await startExpertSession(personaId, def);
  return true;
}

// ── CFG.system과 history[0]을 함께 갱신 ──────────────────────
// ⚠️ call-ai.js는 history가 비어있지 않으면 history[0](캐시된 system)을
// 그대로 보내고 CFG.system은 쳐다보지 않는다(캐시 최적화 설계 — 위
// _callAIInner 주석 참조). 그래서 CFG.system만 바꾸면 실제 전송되는
// 프롬프트는 안 바뀌는 버그가 있었다. 페르소나 전환 시점은 어차피
// 캐시 프리픽스가 바뀌는 지점이므로(다른 SP로 진짜 전환하는 것이니
// 캐시 재사용을 기대할 수 없다), history[0]도 같이 덮어써서 실제로도
// 전환되게 한다.
function _applySystemEverywhere(text) {
  CFG.system = text;
  if (history.length > 0 && history[0]?.role === 'system') {
    history[0] = { role: 'system', content: text };
  }
}

// ── 전문가 AI 세션 시작 ───────────────────────────────────────
export async function startExpertSession(personaId, def) {
  if (_expert.active && _expert.personaId === personaId) return; // 이미 같은 페르소나 진행 중

  const prompt = await _composeExpertPrompt(def);
  _applySystemEverywhere(prompt);  // 같은 스레드 — history 대화 자체는 유지(맥락 보존), system만 교체

  _expert = {
    active: true, personaId, def,
    startIdx: history.length,     // 이 지점 이후만 "전문가 세션" 구간으로 취급
    timer: null,
  };
  _resetTimeoutTimer();

  appendBubble('ai',
    `${def.icon} <b>${def.label} AI</b>와 연결되었습니다. 상담이 끝나면 "끝났어"라고 말씀해주세요.`,
    true
  );
  console.info('[Expert] 세션 시작:', personaId);
}

// ── 사용자 발화 시 매 턴 호출 — 명시적 종료 발화 감지 + 타임아웃 리셋 ──
// call-ai.js _callAIInner() 최상단에서 호출한다.
// @returns {boolean} 이번 발화로 세션이 종료되었는지(true면 이어서 그림자 AI가 응답)
export async function maybeHandleExpertTurn(userText) {
  if (!_expert.active) return false;

  _resetTimeoutTimer(); // 살아있는 발화이므로 타임아웃 연장

  if (userText && TERMINATION_RE.test(userText)) {
    await endExpertSession('user_phrase');
    return true;
  }
  return false; // 세션 유지 — 호출부에서 CFG.system을 페르소나 프롬프트로 유지해야 함
}

// 활성 세션의 System Prompt를 보장 적용(매 턴 — system 캐시에 덮어쓰기 방지)
export function applyExpertSystemIfActive() {
  if (!_expert.active) return false;
  // _composeExpertPrompt가 캐시돼 있으므로 동기적으로 즉시 적용 가능
  if (_promptCache.has(_expert.def.file)) {
    _applySystemEverywhere(_promptCache.get(_expert.def.file));
    return true;
  }
  return false;
}

// ── 전문가 AI 세션 종료 — 6하원칙 요약 → PDV 기록 → 그림자 AI 복원 ──
export async function endExpertSession(reason = 'unknown') {
  if (!_expert.active) return;
  _clearTimeoutTimer();

  const def       = _expert.def;
  const personaId = _expert.personaId;
  const turns     = history.slice(_expert.startIdx);

  _expert = { active: false, personaId: null, def: null, startIdx: 0, timer: null };

  // ── 세션 구간 대화를 "[역할] 발화" 로그로 변환 ──────────────
  const transcript = turns
    .map(t => `[${t.role === 'user' ? '사용자' : def.label}] ${
      typeof t.content === 'string' ? t.content : JSON.stringify(t.content)
    }`)
    .join('\n');

  const report6w = transcript.trim() ? await summarizeTranscript6W(transcript) : null;
  const summaryText = report6w?.what || report6w?.result ||
    (transcript.trim()
      ? `${def.label} AI와의 상담이 종료됨(요약 실패 — 원문 ${turns.length}턴 보존)`
      : `${def.label} AI와의 상담이 대화 없이 종료됨`);

  await _recordPDV({
    type:      'agent_report',
    serviceId: personaId,
    service:   def.label,
    summary:   summaryText,
    who:       report6w?.who   || _USER?.nickname || _USER?.ipv6 || null,
    when:      report6w?.when  || new Date().toISOString(),
    where:     report6w?.where || '혼디',
    what:      report6w?.what  || summaryText,
    how:       report6w?.how   || `expert_session_${reason}`,
    why:       report6w?.why   || '',
    ts:        new Date().toISOString(),
  }).catch(e => console.warn('[Expert] PDV 기록 실패:', e.message));

  // ── 그림자 AI(AGENT-COMMON)로 복원 ───────────────────────
  _applySystemEverywhere(CFG.system_base || CFG.system);

  const reasonLabel = reason === 'timeout' ? '(응답이 없어 자동 종료됨)' : '';
  appendBubble('ai',
    `✅ <b>${def.icon} ${def.label} AI</b> 상담이 끝났습니다${reasonLabel}. 그림자 AI로 돌아왔습니다.<br>` +
    `<span style="font-size:12px;color:var(--label-3)">요약: ${summaryText}</span>`,
    true
  );
  console.info('[Expert] 세션 종료(' + reason + '):', personaId, '| 요약:', summaryText);
}
