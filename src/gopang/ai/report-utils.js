/**
 * ai/report-utils.js — 전문 AI 위임 종료/개시 시 6하원칙 요약 생성 공용 헬퍼
 *
 * "전문 AI가 그림자 AI에게 보고" 원칙(예외 없음)을 지키기 위해, 전문 AI가
 * 스스로 구조화된 보고서를 주지 않을 때도 대화 로그가 있으면 LLM에게 강제로
 * 6하원칙 요약을 요청한다. 과거 router.js의 runRouter()(2026-07-05 제거,
 * 죽은 코드였음)와 동일한 방식으로
 * CFG.endpoint를 직접 호출한다(채팅 버블·스트리밍 없는 내부 유틸리티 호출).
 *
 * 사용처:
 *   - gwp/engine.js  — 새 탭 서비스가 GWP_DONE 없이 닫혔을 때의 폴백 요약
 *   - expert-session.js — 같은 스레드 전문가 AI(페르소나) 위임 종료 시 요약(보고 방향)
 *                          + 위임 개시 시 인계 맥락 요약(핸드오프 방향, 2026-07-19 신설)
 */
import { CFG } from '../core/config.js';

const SUMMARY_SYS_PROMPT =
  '다음은 사용자가 전문 AI(전문 분야 기관 AI 또는 전문가 페르소나 AI)와 나눈 대화 로그다. ' +
  '6하원칙(누가·언제·어디서·무엇을·어떻게·왜)으로 각 항목 50자 이내로 요약하여 ' +
  'JSON만 출력하라(설명 텍스트 금지). ' +
  '형식: {"who":"...","when":"...","where":"...","what":"...","how":"...","why":"...","result":"..."}';

// ── 핸드오프(인계) 방향 — 2026-07-19 신설 ─────────────────────────
// 배경: [EXPERT: personaId] 태그 발동 시 지금까지는 이 태그를 유발한
// "이번 발화" 원문 한 줄만 새 탭(페르소나)에 전달되고, 그 앞서 AC와
// 여러 턴에 걸쳐 이미 확인된 맥락(당사자 정보·경위·이미 진행된 절차 등)은
// 전달되지 않아 사용자가 페르소나에게 같은 내용을 반복 진술해야 했다
// (UX 저하 — 주피터 지시). SP_common_guardrails C37(결정 회피 방지 장치)이
// "(a)원하는 결과 (b)당사자 특정 (c)경위 (d)이미 진행된 절차가 이미 주어졌으면
// 재차 캐묻지 않는다"는 원칙을 이미 갖고 있으므로, 그 앞의 맥락 전달 통로만
// 뚫어주면 SP 본문 수정 없이 각 페르소나가 자동으로 반복 질문을 건너뛴다.
const HANDOFF_SYS_PROMPT =
  '다음은 사용자가 AI 비서(그림자 AI)와 나눈 대화 로그이며, 이제 전문가 AI 페르소나에게 ' +
  '이 사용자를 인계하려 한다. 전문가 AI가 같은 내용을 다시 캐묻지 않도록, 이미 확인된 ' +
  '사실만 최대 4개 항목으로 80자 이내씩 요약하라(추측 금지 — 로그에 없는 내용은 채우지 ' +
  '않는다. 결론·판단은 포함하지 않는다 — 판단은 전문가 AI의 몫이다). ' +
  'JSON만 출력(설명 텍스트 금지). ' +
  '형식: {"party":"당사자/입장 정보 또는 빈 문자열","situation":"경위·현재 상황",' +
  '"already_done":"이미 진행된 절차(있으면)","goal":"사용자가 원하는 결과"}';

/**
 * AC(그림자 AI) 대화 로그를 "전문가 페르소나 인계용" 요약으로 압축한다.
 * 실패 시 null을 반환하며, 호출부는 이번 발화 원문만으로 폴백해야 한다
 * (기존 [EXPERT:] 핸드오프 동작과 100% 하위호환 — 이 함수가 실패해도
 * 핸드오프 자체가 막히지 않는다).
 * @param {string} transcriptText - "[역할] 발화" 형태로 줄바꿈된 AC 대화 로그
 *   (핸드오프를 유발한 "이번 발화" 자신은 포함하지 않는다 — 그건 ctx로 별도 전달)
 * @returns {Promise<{party:string, situation:string, already_done:string, goal:string}|null>}
 */
export async function summarizeHandoffContext6W(transcriptText) {
  if (!transcriptText || !transcriptText.trim()) return null;
  try {
    const res = await fetch(CFG.endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'deepseek-v4-flash',
        max_tokens:  200,
        temperature: 0.0,
        stream:      false,
        messages: [
          { role: 'system', content: HANDOFF_SYS_PROMPT },
          { role: 'user',   content: transcriptText.slice(0, 4000) },
        ],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.warn('[ReportUtils] 핸드오프 요약 실패(무시 — 이번 발화 원문만으로 폴백):', e.message);
    return null;
  }
}

/**
 * 대화 로그(transcript) 텍스트를 6하원칙 JSON으로 요약한다.
 * @param {string} transcriptText - "[역할] 발화" 형태로 줄바꿈된 대화 로그
 * @returns {Promise<object|null>} 요약 결과 또는 실패 시 null
 */
export async function summarizeTranscript6W(transcriptText) {
  if (!transcriptText || !transcriptText.trim()) return null;
  try {
    const res = await fetch(CFG.endpoint + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:       'deepseek-v4-flash',
        max_tokens:  240,
        temperature: 0.0,
        stream:      false,
        messages: [
          { role: 'system', content: SUMMARY_SYS_PROMPT },
          { role: 'user',   content: transcriptText.slice(0, 4000) },
        ],
      }),
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const raw  = data.choices?.[0]?.message?.content || '{}';
    return JSON.parse(raw.replace(/```json|```/g, '').trim());
  } catch (e) {
    console.warn('[ReportUtils] 6하원칙 요약 실패(무시 — 폴백 최소기록 사용):', e.message);
    return null;
  }
}
