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
import { summarizeTranscript6W, summarizeHandoffContext6W } from './report-utils.js';
import { EXPERT_REGISTRY, UNIVERSAL_INTEGRITY_KEY, COMMON_GUARDRAILS_KEY, COMMON_MEDICAL_SAFETY_KEY,
         getExpertGwpDef, resolveExpertId }
  from './expert-registry.js';
import { _loadSpByKey, _loadSpRawByKey } from './manifest-loader.js';
import { _gwpLaunch } from '../gwp/engine.js';
import { _buildRoutingFacts } from '../services/location.js';

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

// ── 합성 System Prompt 로드 (2026-07-19 재구성) ──────────────────────
// 조립 순서: UNIVERSAL-INTEGRITY → UNIVERSAL-common → PROFESSIONAL-common
//   → 공통 가드레일(C1~C43) → (의료시) 의료 안전모듈 → 페르소나 SP
//
// 배경 ① (2026-07-19 실사로 발견): UNIVERSAL-common(U0 의도특정·U1 권한의
// 한계·U7 업무처리파이프라인 — "안내로 끝내지 않는다"는 원칙의 실제 본문)과
// PROFESSIONAL-common(전문가 사칭 금지·최종판단은 감독전문가 전속 등 정체성
// 계층)이 이 조립 함수 어디에도 없어, 60개 EXPERT 페르소나 전원이 그 원칙
// 없이 구동되고 있었다 — SP 문서 자신은 이 상속을 전제로 쓰여 있었으나
// (예: PROFESSIONAL-common_v1_0.md 헤더) 실제로 로드된 적이 없었다.
//
// 배경 ② (동시 발견): 기존 코드는 _loadSpByKey()를 이 함수 안에서 여러 번
// 호출했는데, _loadSpByKey()가 매번 UNIVERSAL-INTEGRITY·TASK-DELEGATION-GUIDE를
// 자동으로 다시 앞에 붙이는 바람에 최종 합성 프롬프트에 그 두 문서가 최대
// 4번까지 중복 삽입되고 있었다(실사로 확인 — UNIVERSAL-INTEGRITY 시작 문구
// 3회 반복). 공유 상위 계층은 이 함수에서 정확히 한 번만 조립하고, 나머지는
// _loadSpRawByKey()(자동 결합 없음)로 원문만 받아온다.
//
// 2026-07-09: fetch(하드코딩 URL) 직접 호출 -> _loadSpByKey(manifest 키)로
// 전환. sp-catalog.json은 CI가 매 push마다 최신 버전으로 자동 갱신하므로,
// 이제 새 SP 버전을 만들면 이 파일을 손대지 않아도 자동으로 반영된다
// (SP_lawyer가 v3.2에 몇 주간 고정돼 있던 문제의 재발 방지).
// 2026-07-09: export 추가 — call-ai.js의 K-Compose→EXPERT(scope=
// orchestration_subtask) nested 호출(§0-H)이 이 합성 로직을 그대로
// 재사용한다. 페르소나 SP 파일 하나만 달랑 로드하면 UNIVERSAL-INTEGRITY·
// 공통 가드레일(C1~C43)·의료 안전모듈이 빠진 반쪽 프롬프트가 되므로,
// 오케스트레이션 하위 호출이라고 해서 이 합성 과정을 생략하면 안 된다
// — 로직을 중복 구현하지 않고 여기 하나만 있게 유지한다.
export async function _composeExpertPrompt(def) {
  if (_promptCache.has(def.key)) return _promptCache.get(def.key);

  const parts = [];

  // 공유 상위 계층 — 정확히 한 번만 조립(중복 버그 수정, 2026-07-19).
  // UNIVERSAL-INTEGRITY 자기 자신을 로드할 땐 _loadSpByKey()도 자동 결합을
  // 하지 않으므로(self-concat 방지 분기) 그대로 써도 무방하다.
  try {
    parts.push(await _loadSpByKey(UNIVERSAL_INTEGRITY_KEY, 'UNIVERSAL-INTEGRITY'));
  } catch (e) { console.warn('[Expert] UNIVERSAL-INTEGRITY 로드 실패:', e.message); }

  try {
    parts.push(await _loadSpRawByKey('UNIVERSAL-common', 'UNIVERSAL-common'));
  } catch (e) { console.warn('[Expert] UNIVERSAL-common 로드 실패:', e.message); }

  try {
    parts.push(await _loadSpRawByKey('PROFESSIONAL-common', 'PROFESSIONAL-common'));
  } catch (e) { console.warn('[Expert] PROFESSIONAL-common 로드 실패:', e.message); }

  try {
    parts.push(await _loadSpRawByKey(COMMON_GUARDRAILS_KEY, '공통 가드레일'));
  } catch (e) { console.warn('[Expert] 공통 가드레일 로드 실패:', e.message); }

  if (def.needsMedicalSafety) {
    try {
      parts.push(await _loadSpRawByKey(COMMON_MEDICAL_SAFETY_KEY, '의료 안전모듈'));
    } catch (e) { console.warn('[Expert] 의료 안전모듈 로드 실패:', e.message); }
  }

  try {
    parts.push(await _loadSpRawByKey(def.key, def.label));
  } catch (e) {
    console.warn('[Expert] 페르소나 SP 로드 실패:', e.message);
    parts.push(`[${def.label} 페르소나 SP 로드 실패 — 일반 전문가 모드로 응답]`);
  }

  const composed = parts.join('\n\n---\n\n');
  _promptCache.set(def.key, composed);
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

// ── 태그 해석 실패 공용 리포터 (구조적 취약점 보완 #2, 2026-07-14 신설) ──
// EXPERT([EXPERT: personaId])·GWP([GWP: serviceId]) 두 라우팅 태그 모두
// "모델이 태그는 냈지만 registry에 없는 id"인 경우, 기존에는 콘솔 경고만
// 남기고 사용자에게는 아무 신호 없이 그대로 증발했다(사고실험으로 확인된
// 구조적 취약점). 이제 (1) 사용자에게 실패를 알리고 일반 답변으로 계속
// 도와줄 수 있음을 안내하며, (2) 서버 SP-Author 큐(/sp-author/queue)에
// "unresolved_tag_signal"로 기록해 미등록 수요를 정량적으로 추적한다.
// institution 필드에 raw id를 그대로 넣어두면 서버의 기존 중복병합 로직
// (institution+task 기준, handleSPAuthorQueue 참조)이 동일 id의 반복
// 실패를 자동으로 병합해줘서 큐가 노이즈로 넘치지 않는다.
export function _reportUnresolvedTag(kind, rawId, userText) {
  try {
    appendBubble(
      'ai',
      `요청하신 항목("${rawId}")에 맞는 ${kind === 'expert' ? '전문가' : '서비스'}를 아직 찾지 못했어요. ` +
      `우선 제가 아는 선에서 바로 도와드릴게요.`
    );
  } catch (e) {
    console.warn('[TagTelemetry] 안내 버블 표시 실패(무시):', e.message);
  }
  try {
    const base = (CFG.endpoint || '').replace(/\/+$/, '');
    fetch(`${base}/sp-author/queue`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        request_type: 'unresolved_tag_signal',
        signal_source: kind === 'expert' ? 'expert_tag_resolution' : 'gwp_tag_resolution',
        institution: rawId,
        task: `[${kind}] 태그 미해결 — 사용자 발화 기반 수요 신호`,
        source_conversation: userText || '',
        priority: 'low',
      }),
    }).catch(e => console.warn('[TagTelemetry] 큐 등록 실패(무시, 사용자 흐름엔 영향 없음):', e.message));
  } catch (e) {
    console.warn('[TagTelemetry] 큐 등록 시도 실패(무시):', e.message);
  }
}

// ── [EXPERT:personaId] 태그 감지 → 새 탭에서 전문가 페르소나 시작 ──
// call-ai.js의 GWP 태그 파서 옆에서 같이 호출한다.
//
// BUG-FIX(2026-07-03): 기존에는 같은 스레드 안에서 System Prompt만 교체하는
// startExpertSession()을 호출했다(아래에 정의는 남겨뒀지만 이 경로에서는
// 더 이상 호출하지 않는다 — 참고용/향후 필요시 재사용 대비). 이제 GWP
// 기관 서비스와 동일하게 새 탭으로 연다: pages/expert-chat.html이 persona
// 쿼리 파라미터로 SP를 갈아끼워 서빙하고, _gwpLaunch()가 ctx(사용자 발화
// 원문)를 그대로 전달한다 — GWP와 완전히 동일한 핸드오프 규약을 쓴다.
export async function handleExpertTag(fullReply, userText, _preTab) {
  // BUG-FIX(2026-07-02): AGENT-COMMON 프롬프트가 "[EXPERT: SP-LAW-01]"처럼
  // 콜론 뒤 공백을 넣는 형식으로 지시하는데(316/368/893~896행), 이 정규식은
  // 공백을 허용하지 않아 실제 출력과 어긋나 있었다 — GWP와 동일한 원인,
  // 동일한 수정(\s* 추가).
  const m = fullReply?.match(/\[EXPERT:\s*([@\w-]+)\]/);
  if (!m) return false;
  const raw = m[1];

  // @handle 직접 지목은 아직 미구현(별도 기능) — 조용히 무시하고 진행하지 않는다.
  if (raw.startsWith('@')) {
    console.warn('[Expert] @handle 직접 연결은 아직 미구현:', raw);
    return false;
  }

  const personaId = resolveExpertId(raw);
  if (!personaId) {
    console.warn('[Expert] 알 수 없는 전문가 ID:', raw);
    // 2026-07-14 신설(구조적 취약점 보완 #2) — 이전에는 여기서 그냥 return
    // false로 끝나 사용자에게 아무 신호도 없이 태그가 증발했다(핵심
    // 대화가 이미 스트리밍된 뒤라 사용자는 원인을 알 길이 없었음). 이제
    // (1) 사용자에게 실패 사실을 알리고, (2) 실제 미등록 수요로 서버에
    // 기록한다 — 모델이 명시적으로 [SP_DRAFT_REQUEST]를 낸 경우만 큐에
    // 잡히던 기존 방식의 사각지대(태그 자체가 잘못 나온 경우)를 메운다.
    _reportUnresolvedTag('expert', raw, userText);
    return false;
  }
  const gwpDef = getExpertGwpDef(personaId);
  if (!gwpDef) {
    console.warn('[Expert] personaId는 해석됐으나 GWP 정의 없음:', personaId);
    _reportUnresolvedTag('expert', raw, userText);
    return false;
  }

  console.info('[Expert] LLM 판단 → 새 탭:', personaId);

  // ── 2026-07-19 신설: AC와의 이전 대화 맥락을 페르소나에 함께 인계 ──
  // 배경: 지금까지는 이 태그를 유발한 "이번 발화"(userText) 한 줄만 전달돼,
  // AC와 여러 턴에 걸쳐 이미 확인된 맥락(당사자·경위·이미 진행된 절차 등)이
  // 새 탭에서 소실되고 사용자가 같은 내용을 반복 진술해야 했다(UX 저하 —
  // 주피터 지시). 이번 발화 자신을 제외한 이전 대화만 슬라이스해 6하원칙류
  // 요약을 생성하고, "이번 발화 원문은 그대로 유지"라는 기존 규약은
  // 건드리지 않은 채 그 앞에 요약 블록만 덧붙인다.
  //
  // 실패 시(네트워크 오류 등) priorSummary는 null이 되고, 기존과 동일하게
  // userText만 전달된다 — 100% 하위호환.
  let finalCtx = userText;
  try {
    // AC 대화 로그 중 "이번 발화" 이전 구간만 사용(중복 방지). 이번 발화는
    // 아직 history에 push되지 않은 시점일 수도, 이미 push된 시점일 수도
    // 있으므로 양쪽 다 방어적으로 걸러낸다.
    const priorTurns = history.filter(t =>
      !(t.role === 'user' &&
        (typeof t.content === 'string' ? t.content : '') === userText)
    );
    if (priorTurns.length > 0) {
      const priorTranscript = priorTurns
        .filter(t => t.role === 'user' || t.role === 'assistant')
        .map(t => `[${t.role === 'user' ? '사용자' : 'AI비서'}] ${
          typeof t.content === 'string' ? t.content : JSON.stringify(t.content)
        }`)
        .join('\n');
      const handoff = priorTranscript.trim()
        ? await summarizeHandoffContext6W(priorTranscript)
        : null;
      if (handoff && (handoff.party || handoff.situation || handoff.already_done || handoff.goal)) {
        const lines = [
          '[AI 비서와의 이전 대화에서 이미 확인된 내용 — 다시 캐묻지 않아도 됩니다]',
          handoff.party        ? `- 당사자/입장: ${handoff.party}`       : null,
          handoff.situation    ? `- 경위·현재 상황: ${handoff.situation}` : null,
          handoff.already_done ? `- 이미 진행된 절차: ${handoff.already_done}` : null,
          handoff.goal         ? `- 원하는 결과: ${handoff.goal}`         : null,
        ].filter(Boolean).join('\n');
        finalCtx = `${lines}\n\n[이번 발화]\n${userText}`;
      }
    }
  } catch (e) {
    console.warn('[Expert] 핸드오프 맥락 요약 실패(무시 — 이번 발화만 전달):', e.message);
  }

  _gwpLaunch(gwpDef, finalCtx, _preTab, _buildRoutingFacts());
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
  if (_promptCache.has(_expert.def.key)) {
    _applySystemEverywhere(_promptCache.get(_expert.def.key));
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
