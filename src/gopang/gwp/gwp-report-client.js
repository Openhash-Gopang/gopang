/**
 * src/gopang/gwp/gwp-report-client.js — GWP 세션 종료 보고 공통 모듈
 *
 * 배경(2026-07-09): K-서비스 15개 중 9개(market/police/public/health/tax/
 * traffic/logistics/democracy/insurance/911)가 완전히 동일한 41줄짜리
 * _reportSessionEnd() 함수를 각자 저장소에 복사해서 갖고 있었다(md5 대조로
 * 100% 일치 확인). klaw/school/stock/gdc/security 5곳과 jeju는 아예 없어서
 * 보고 없이 탭이 닫히면 AI 비서가 결과를 전혀 모르는 상태였다.
 *
 * "각자 복사" 구조에서는 로직을 한 곳만 고치면 나머지는 안 고쳐지는 사고가
 * 반복된다(SP_lawyer 버전 고정, call-ai.js manifest 로더 중복과 동일 패턴).
 * 이 파일은 그 복사본들을 단일 소스로 통합한다 — auth/subsystem-auth.js가
 * 이미 쓰고 있는 크로스오리진 <script type="module" src="https://hondi.net/..."> 관행을
 * 그대로 따른다.
 *
 * 사용법 (각 K-서비스 webapp.html):
 *   <script type="module">
 *     import { reportGwpSessionEnd } from 'https://hondi.net/src/gopang/gwp/gwp-report-client.js';
 *     window._reportSessionEnd = (resultText, summaryLine) => reportGwpSessionEnd({
 *       agencyId: AGENCY_ID, guid: _govGuid(), messages: conversationState.messages,
 *       resultText, summaryLine, gwpMode: GWP_MODE, gwpOrigin: GWP_ORIGIN,
 *       sessionId: _sessionId, sessionStartedAt: _sessionStartedAt,
 *     });
 *   </script>
 * 기존 로컬 _reportSessionEnd() 정의는 삭제하고 호출부(대화 종료 지점)는
 * 그대로 둔다 — 함수 시그니처(resultText, summaryLine)를 그대로 유지했다.
 */

const DEFAULT_PROXY = 'https://hondi-proxy.tensor-city.workers.dev';

/**
 * @param {Object} opts
 * @param {string} opts.agencyId       - 서비스 식별자 (예: 'klaw', 'kschool')
 * @param {string} opts.guid           - 사용자 GUID (없으면 'anonymous')
 * @param {Array<{role:string, content:string}>} opts.messages - 대화 로그
 * @param {string} opts.resultText     - 마지막 AI 응답(요약에 포함됨)
 * @param {string} [opts.summaryLine]  - 6하원칙 what 필드로 쓸 한 줄 요약
 * @param {boolean} opts.gwpMode       - GWP 경유 여부(?gwp=1). false면 즉시 반환
 * @param {string} [opts.gwpOrigin]    - postMessage 대상 origin(없으면 '*')
 * @param {string} [opts.sessionId]    - 없으면 자동 생성
 * @param {string} [opts.sessionStartedAt] - 없으면 now
 * @param {string} [opts.proxyBase]    - PDV 리포트 프록시 base URL
 * @param {Array<{docType:string, fileName:string, mime:string, size:number,
 *   acquiredAt:string}>} [opts.attachedDocs] - HUMAN-AUTHORITY-GATE-SCHEMA
 *   G19(보조 경로, GWP_DOC_REQUEST)로 확보한 서류의 메타데이터만(원본
 *   base64는 포함하지 않음 — 이미 요청 탭 자신의 대화에 실려 kgov
 *   GOV_TASK_SUBMIT_REQUEST로 처리됐으므로 여기서는 G18(STAFF_REVIEW_GATE)
 *   산출물 번들에 "무엇을 확보했는지"만 남긴다). 같은 탭 첨부(§기본
 *   경로)로 확보한 서류는 이미 GOV_TASK_SUBMIT_REQUEST 쪽에 기록되므로
 *   여기 다시 넣지 않는다 — 중복 기록 방지.
 * @returns {Promise<{reported: boolean, sessionId: string}>}
 */
export async function reportGwpSessionEnd({
  agencyId,
  guid,
  messages = [],
  resultText = '',
  summaryLine = '',
  gwpMode,
  gwpOrigin = '',
  sessionId,
  sessionStartedAt,
  proxyBase = DEFAULT_PROXY,
  attachedDocs = [],
} = {}) {
  if (!gwpMode) return { reported: false, sessionId: null };
  if (!agencyId) throw new Error('[gwp-report-client] agencyId 필수');

  const now = new Date().toISOString();
  const sid = sessionId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
  const startedAt = sessionStartedAt || now;
  const resolvedGuid = guid || 'anonymous';

  const transcript = messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .map(m => `[${m.role === 'user' ? '사용자' : 'AI'}] ${m.content}`)
    .concat(resultText ? [`[AI] ${resultText}`] : [])
    .join('\n\n');

  const whenObj = { period_start: startedAt, period_end: now };
  const whatText = summaryLine || `${agencyId} 상담 완료`;

  // (a) 서브시스템 자기 PDV — 대화 원문 시간순 저장
  try {
    await fetch(proxyBase + '/pdv/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        report: {
          svc: agencyId, type: 'conversation_transcript', session_id: sid,
          who: { ipv6: resolvedGuid, role: 'user' },
          when: whenObj,
          where: { svc_url: location.href },
          what: { summary: transcript },
          how: { method: 'gov_relay_conversation' },
          why: { goal: whatText },
        },
      }),
    });
  } catch (e) {
    console.warn('[PDV] 자기 기록 실패(무시):', e.message);
  }

  // (b) 나만의 AI 비서에게 6하원칙 보고 — engine.js가 사용자 PDV에 기록
  if (window.opener) {
    try {
      window.opener.postMessage(
        {
          type: 'GWP_DONE',
          summary: whatText,
          session_id: sid,
          reporter_svc: agencyId,
          pdvData: { who: resolvedGuid, when: whenObj, where: location.href, what: whatText, how: 'gwp', why: whatText },
          attachedDocs: Array.isArray(attachedDocs) && attachedDocs.length ? attachedDocs : undefined,
        },
        gwpOrigin || '*'
      );
    } catch (e) {
      console.warn('[GWP_DONE] 보고 실패(무시):', e.message);
    }
  }

  return { reported: true, sessionId: sid };
}
