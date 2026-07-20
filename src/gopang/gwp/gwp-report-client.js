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
 *
 * 사용법 (전문가 페르소나 세션, expert-session.js — 2026-07-20 신설):
 *   import { recordOwnerPDV } from 'https://hondi.net/src/gopang/gwp/gwp-report-client.js';
 *   await recordOwnerPDV({
 *     ownerAgency: EXPERT_REGISTRY[personaKey].ownerAgency,
 *     recordType: 'consultation', guid: userGuid,
 *     personaKey, personaVersion, what: summaryLine, how: outcomeType,
 *   });
 * 자세한 스키마·가드레일은 prompts/SP_PDV_v1_2.md §7 참조.
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
  how = 'completed', // 2026-07-20 신설 — §7 owner_pdv 기록용. 대부분 K-서비스는
                      // escalation 개념이 없으므로 기본값 'completed'. 필요한
                      // 서비스만 명시적으로 전달(값 종류는 §7.4 참조).
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

  // (c) §7 기관측 PDV — 2026-07-20 신설. 여기 한 곳에서만 호출하면, 이미
  // reportGwpSessionEnd()를 쓰고 있는 K-서비스 15개+ 전원이 개별 수정 없이
  // 자동으로 owner_pdv에 consultation 레코드를 남긴다("모든 K-서비스가
  // 자신의 PDV에 기록하는 메커니즘"을 한 곳으로 일반화 — 각 서비스 webapp.html을
  // 일일이 고치는 대신 이미 다들 호출하는 공용 함수 안에 심는다).
  // persona_key는 항상 null — 이건 "K-서비스 자신"과의 직접 상담이고, 전문가
  // 페르소나 경유(expert-chat.html)는 recordOwnerPDV()를 별도로 직접 호출한다
  // (그쪽은 ownerAgency가 agencyId 자기 자신이 아니라 소유 K-서비스이므로 구분 필요).
  // guid가 없는 완전 익명 세션(resolvedGuid==='anonymous')은 §7.2 해싱 대상이
  // 아니므로 기록을 생략한다 — 억지로 "anonymous" 문자열을 해싱하면 그
  // K-서비스의 모든 익명 세션이 같은 who_hash로 뭉쳐 의미 없는 데이터가 된다.
  if (guid) {
    try {
      await recordOwnerPDV({
        ownerAgency: agencyId,
        recordType: 'consultation',
        guid,
        personaKey: null,
        personaVersion: null,
        what: whatText,
        how,
        when: startedAt,
        where: location.href,
        proxyBase,
      });
    } catch (e) {
      console.warn('[owner-pdv] 자동 기록 실패(무시):', e.message);
    }
  }

  return { reported: true, sessionId: sid };
}

/**
 * recordOwnerPDV — §7(기관측 PDV, SP_PDV v1.2) 기록 함수 (2026-07-20 신설)
 *
 * reportGwpSessionEnd()의 (a) "서브시스템 자기 PDV"와 목적이 다르다: 그쪽은
 * K-서비스가 실명 GUID + 원문 전체를 자기 운영용으로 남기는 기존 메커니즘이고,
 * 이 함수는 소유 K-서비스(ownerAgency)가 만족도/성과 분석·SP 개정 근거로 쓰는
 * 가명화·요약 전용 거버넌스 레코드를 남긴다. 둘은 별개이며 서로 대체하지 않는다.
 *
 * 호출 주체는 두 종류다:
 *   - 전문가 페르소나 세션 (expert-session.js): recordType='consultation',
 *     personaKey/personaVersion 필수, guid 필수(해싱 대상).
 *   - K-서비스 자신의 고유 산출물 (예: K-Law 가상 판결문): recordType='own_output',
 *     personaKey/personaVersion 없음, guid는 특정 상대가 없으면 생략 가능.
 *
 * 중요 — guid는 여기서 평문 그대로 프록시로 전송된다. §7.2의 who_hash =
 * SHA256(userGuid + ownerAgency_salt) 계산은 반드시 프록시(Worker, salt는
 * 서버 비밀)에서 수행해야 한다. 클라이언트에서 해시하면 salt가 번들에
 * 노출되어 GUID(uuidv5(phone_number), 결정론적)를 전화번호 전수조사로
 * 역산할 수 있게 되므로 "역추적 불가" 원칙이 무력화된다 — 프록시 구현은
 * 이 저장소 범위 밖(별도 인프라 레포)이며, 반드시 해시 후에만
 * `<ownerAgency>_pdv`에 저장해야 한다(원문 guid를 그대로 영속화 금지).
 *
 * @param {Object} opts
 * @param {string} opts.ownerAgency        - 소유 K-서비스 id (예: 'klaw'). expert-registry.js의 ownerAgency와 동일
 * @param {'consultation'|'own_output'} [opts.recordType='consultation']
 * @param {string} [opts.guid]             - 사용자 GUID (consultation이면 필수, 프록시에서 해싱됨)
 * @param {string} [opts.personaKey]       - consultation일 때만 (예: 'lawyer')
 * @param {string} [opts.personaVersion]   - 세션 시점 SP 버전 (예: 'v4.1')
 * @param {string} opts.what               - 무엇을 처리했는지 1문장 요약
 * @param {'completed'|'escalated_success'|'escalated_ai_limit'|'early_exit'} opts.how
 * @param {string} [opts.why]              - 목적 태그
 * @param {string} [opts.when]             - 없으면 now
 * @param {string} [opts.where]            - 없으면 location.href
 * @param {string} [opts.proxyBase]
 * @returns {Promise<{recorded: boolean, recordId: string}>}
 */
export async function recordOwnerPDV({
  ownerAgency,
  recordType = 'consultation',
  guid,
  personaKey = null,
  personaVersion = null,
  what,
  how,
  why = null,
  when,
  where,
  detail = null, // 2026-07-20 신설 — own_output 전용 구조화 데이터(K-서비스마다
                  // 스키마가 다름). 예: K-Law 판결문 { case_no, klaw_version,
                  // score_total, grade }. consultation이면 항상 무시(null)된다.
  proxyBase = DEFAULT_PROXY,
} = {}) {
  if (!ownerAgency) throw new Error('[gwp-report-client] recordOwnerPDV: ownerAgency 필수');
  if (recordType === 'consultation' && !guid) {
    throw new Error('[gwp-report-client] recordOwnerPDV: consultation 레코드는 guid 필수(해싱은 프록시가 수행)');
  }
  if (!what || !how) {
    throw new Error('[gwp-report-client] recordOwnerPDV: what/how 필수');
  }

  const now = new Date().toISOString();
  const record = {
    record_id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2),
    record_type: recordType,
    owner_agency: ownerAgency,
    persona_key: recordType === 'consultation' ? personaKey : null,
    persona_version: recordType === 'consultation' ? personaVersion : null,
    guid_for_hashing: guid || null, // 프록시가 해싱 후 폐기 — owner_pdv에는 who_hash만 저장
    when: when || now,
    where: where || (typeof location !== 'undefined' ? location.href : null),
    what,
    how,
    why,
    detail: recordType === 'own_output' ? (detail || null) : null,
    source_ref: null, // 원문 미저장 원칙(SP_PDV §1/§7.3)
    confidence: 1,
  };

  try {
    const res = await fetch(proxyBase + '/owner-pdv/report', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ record }),
    });
    return { recorded: res.ok, recordId: record.record_id };
  } catch (e) {
    console.warn('[owner-pdv] 기록 실패(무시):', e.message);
    return { recorded: false, recordId: record.record_id };
  }
}
