/**
 * ai/report-utils.js — 전문 AI 위임 종료 시 6하원칙 요약 생성 공용 헬퍼
 *
 * "전문 AI가 그림자 AI에게 보고" 원칙(예외 없음)을 지키기 위해, 전문 AI가
 * 스스로 구조화된 보고서를 주지 않을 때도 대화 로그가 있으면 LLM에게 강제로
 * 6하원칙 요약을 요청한다. router.js의 runRouter()와 동일한 방식으로
 * CFG.endpoint를 직접 호출한다(채팅 버블·스트리밍 없는 내부 유틸리티 호출).
 *
 * 사용처:
 *   - gwp/engine.js  — 새 탭 서비스가 GWP_DONE 없이 닫혔을 때의 폴백 요약
 *   - expert-session.js — 같은 스레드 전문가 AI(페르소나) 위임 종료 시 요약
 */
import { CFG } from '../core/config.js';

const SUMMARY_SYS_PROMPT =
  '다음은 사용자가 전문 AI(전문 분야 기관 AI 또는 전문가 페르소나 AI)와 나눈 대화 로그다. ' +
  '6하원칙(누가·언제·어디서·무엇을·어떻게·왜)으로 각 항목 50자 이내로 요약하여 ' +
  'JSON만 출력하라(설명 텍스트 금지). ' +
  '형식: {"who":"...","when":"...","where":"...","what":"...","how":"...","why":"...","result":"..."}';

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
