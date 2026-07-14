/**
 * audit-log-schema.js
 * ---------------------------------------------------------------------------
 * 92번(개인정보 오남용 감사 — 공무원의 조회 로그 점검) 대응 모듈.
 *
 * 트랙3(기관 내부 SaaS)에 속하지만, 레이어 A(pdv-consent.js)가 발생시키는
 * 모든 동의 요청/승인/거절 이벤트가 이 로그의 원천 데이터이므로
 * Phase 0에서 pdv-consent.js와 동시에 정의한다.
 *
 * 최종 저장소는 온나라시스템 연동(Phase 4)이지만, 이 파일은 그와 무관하게
 * 지금 바로 로그 스키마와 조회 함수 인터페이스를 고정하는 역할을 한다.
 * ---------------------------------------------------------------------------
 */

/**
 * @typedef {Object} PDVAuditLogEntry
 * @property {string} log_id
 * @property {string} event          - 'PDV_CONSENT_REQUESTED' | 'PDV_CONSENT_APPROVED' | 'PDV_CONSENT_DENIED' | 'PDV_DATA_ACCESSED'
 * @property {string} citizen_id
 * @property {string} scope          - pdv-consent.js의 PDV_SCOPES 값
 * @property {string} purpose        - pdv-consent.js의 PURPOSE_TAGS 값
 * @property {string} requested_by   - 담당공무원 GPKI 직무 인증 ID
 * @property {string} requested_from_sp - 요청 주체 SP ID
 * @property {string} token_id       - PDVConsentToken.token_id (승인/거절/접근 이벤트에만 존재)
 * @property {string} timestamp      - ISO8601
 * @property {number} batch_size     - 동일 요청에서 조회된 시민 수. 반드시 1이어야 정상.
 *                                      2 이상이면 §1 원칙 위반(기관 AC가 아닌 개인 조회 경로로
 *                                      다수인 데이터에 접근) 가능성 → 자동 경보 대상.
 */

const ANOMALY_RULES = Object.freeze({
  BATCH_SIZE_EXCEEDED: {
    description: '트랙1/2 개인 조회 경로에서 batch_size > 1 발생 — 기관 AC 경로가 아닌 곳에서 다수인 조회 시도',
    condition: (entry) => entry.batch_size > 1,
    severity: 'CRITICAL',
  },
  PURPOSE_SCOPE_MISMATCH: {
    description: 'purpose 태그와 scope 조합이 §3 매핑표에 정의되지 않은 조합',
    condition: (entry, validCombinations) =>
      !validCombinations.has(`${entry.scope}:${entry.purpose}`),
    severity: 'WARNING',
  },
  AFTER_HOURS_ACCESS: {
    description: '통상 근무시간(09:00-18:00 KST) 외 조회 — 즉시 위반은 아니나 감사관 확인 대상',
    condition: (entry) => {
      const hour = new Date(entry.timestamp).getUTCHours() + 9; // KST
      const kstHour = hour % 24;
      return kstHour < 9 || kstHour >= 18;
    },
    severity: 'INFO',
  },
});

/**
 * 감사 로그 기록. pdv-consent.js의 writeAuditLog()가 최종적으로 이 함수를 호출하도록
 * Phase 4에서 연결한다 (지금은 온나라시스템 연동이 없으므로 로컬/스텁 저장소 사용).
 * @param {PDVAuditLogEntry} entry
 */
async function recordAuditLog(entry) {
  const violations = checkAnomalies(entry);
  if (violations.some((v) => v.severity === 'CRITICAL')) {
    // CRITICAL 위반은 로그 기록과 별개로 즉시 감사관 알림이 필요하다.
    // 알림 채널 연동은 Phase 4(온나라시스템 연동)에서 확정.
    await notifyAuditor(entry, violations);
  }
  return persist(entry, violations);
}

/**
 * @param {PDVAuditLogEntry} entry
 * @returns {Array<{rule: string, severity: string, description: string}>}
 */
function checkAnomalies(entry, validCombinations = new Set()) {
  const results = [];
  for (const [ruleName, rule] of Object.entries(ANOMALY_RULES)) {
    if (rule.condition(entry, validCombinations)) {
      results.push({ rule: ruleName, severity: rule.severity, description: rule.description });
    }
  }
  return results;
}

/** 감사관에게 CRITICAL 위반 알림 — Phase 4에서 실제 채널 연동 */
async function notifyAuditor(entry, violations) {
  throw new Error('NOT_IMPLEMENTED: 감사관 알림 채널 연동 필요 — Phase 4');
}

/** 로그 영속화 — Phase 4에서 온나라시스템 연동으로 교체 */
async function persist(entry, violations) {
  throw new Error('NOT_IMPLEMENTED: 온나라시스템 감사 로그 저장소 연동 필요 — Phase 4');
}

/**
 * 감사관용 조회 API 인터페이스 (구현은 Phase 4).
 * "누가, 언제, 무슨 목적으로, 몇 명분을 뽑았는지" 확인.
 * @param {Object} filter
 * @param {string} [filter.officialId]
 * @param {string} [filter.dateFrom]
 * @param {string} [filter.dateTo]
 * @param {string} [filter.severity]
 */
async function queryAuditLog(filter) {
  throw new Error('NOT_IMPLEMENTED: Phase 4');
}

module.exports = {
  ANOMALY_RULES,
  recordAuditLog,
  checkAnomalies,
  queryAuditLog,
};
