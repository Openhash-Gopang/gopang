// review-gate-and-drift.js
// ═══════════════════════════════════════════════════
// REGULATION-INGESTION-PIPELINE-DESIGN_v1_0.md §5(인간검수) + §6(배포·
// 드리프트 감지) 구현. CASE-COMPLIANCE-LOG-SCHEMA C4("체크리스트 항목
// 신설·개정은 인간 전결")를 실제로 강제하는 계층 — 이 파일을 거치지
// 않고 division SP §ANNEX를 직접 수정하는 코드 경로를 만들지 않는다.
//
// ★ 정직하게 밝힘 ★ 이 파일은 저장소(PocketBase 등 실제 DB) 연동 없이
// 순수 함수로 작성됐다 — 이 프로젝트가 이미 PocketBase(L1 노드)를 쓰고
// 있으므로, 실제 배포 시 이 함수들이 반환하는 객체를 그대로 PocketBase
// 컬렉션(예: regulation_review_queue)에 저장하는 얇은 래퍼만 추가하면
// 된다. 컬렉션 스키마 설계·마이그레이션은 이 파일의 범위 밖.
// ═══════════════════════════════════════════════════

/**
 * 3단계(추출) 결과를 검수 큐 항목으로 변환.
 * @param {object[]} extractedItems - extractChecklistItems() 결과
 * @param {object} meta - { 기관코드, division_code, source_regulation_id, source_regulation_name }
 * @returns {object[]} 검수 큐에 넣을 레코드(모두 status: pending_review)
 */
function enqueueForReview(extractedItems, meta) {
  return extractedItems.map((item, idx) => ({
    review_id: `${meta.source_regulation_id}-${idx}`,
    ...meta,
    ...item,
    status: 'pending_review', // pending_review | approved | rejected | needs_revision
    reviewer: null,
    reviewed_at: null,
    review_notes: null,
  }));
}

/**
 * 검수자(팀장급)의 승인/반려/수정 처리. 승인된 것만 실제 §ANNEX 반영
 * 대상이 된다 — 이 함수를 거치지 않은 항목은 절대 active로 전환되지
 * 않는다(코드 레벨 강제).
 * @param {object} reviewItem - enqueueForReview()가 만든 레코드 1건
 * @param {'approve'|'reject'|'revise'} decision
 * @param {object} opts - { reviewer(필수, 인간 성명·직위), notes, revisedFields }
 */
function applyReviewDecision(reviewItem, decision, opts) {
  if (!opts?.reviewer) {
    throw new Error('검수자(reviewer) 없이는 어떤 결정도 적용할 수 없다 — C4 위반');
  }
  const base = {
    ...reviewItem,
    reviewer: opts.reviewer,
    reviewed_at: new Date().toISOString(),
    review_notes: opts.notes || null,
  };
  if (decision === 'approve') {
    return { ...base, status: 'approved', ready_for_annex: true };
  }
  if (decision === 'reject') {
    return { ...base, status: 'rejected', ready_for_annex: false };
  }
  if (decision === 'revise') {
    if (!opts.revisedFields) throw new Error('revise 결정에는 revisedFields가 필요하다');
    return { ...base, ...opts.revisedFields, status: 'needs_revision', ready_for_annex: false };
  }
  throw new Error(`알 수 없는 결정: ${decision}`);
}

/**
 * approved 상태인 항목만 실제 §ANNEX 갱신 대상으로 필터링.
 * (실제 division SP 파일 수정은 이 프로젝트의 기존 패턴 — append_*.py
 * 스크립트 방식 — 을 그대로 재사용할 수 있다. 이 함수는 "무엇을 넣을지"
 * 목록만 만든다.)
 */
function getApprovedItemsForDeployment(reviewItems) {
  return reviewItems.filter(it => it.status === 'approved' && it.ready_for_annex);
}

// ── §6 드리프트 감지 ──────────────────────────────────────────────

/**
 * 이미 §ANNEX에 반영된 항목의 legal_basis_last_verified와 law.go.kr의
 * 최신 개정일(발령일자)을 비교해, 재검토가 필요한 항목을 찾는다.
 * @param {object[]} deployedAnnexItems - { legal_basis, legal_basis_last_verified(YYYY-MM-DD) }
 * @param {object[]} latestRegulations - law-api-client 목록조회 결과
 *   (발령일자 필드 포함, YYYYMMDD 형식)
 * @returns {object[]} 재검토 필요 항목(원본 + 최신 발령일자 + days_stale)
 */
function detectDrift(deployedAnnexItems, latestRegulations) {
  const drifted = [];
  for (const item of deployedAnnexItems) {
    // legal_basis 텍스트(예: "형사소송법 제244조의3")에서 규정명 추출
    // — 정확한 매칭은 규정명 문자열 포함 여부로 근사(완벽하지 않음,
    // 실배포 시 정식 규정 ID 매핑 테이블로 교체 권장)
    const matched = latestRegulations.find(r =>
      item.legal_basis && r.행정규칙명 && item.legal_basis.includes(r.행정규칙명)
    );
    if (!matched) continue; // 대응 규정 못 찾음 — 법률(형사소송법 등)일 가능성, 별도 처리 필요
    const latestDate = parseYyyymmdd(matched.발령일자);
    const verifiedDate = new Date(item.legal_basis_last_verified);
    if (latestDate && verifiedDate && latestDate > verifiedDate) {
      const daysStale = Math.floor((latestDate - verifiedDate) / (1000 * 60 * 60 * 24));
      drifted.push({ ...item, latest_amendment_date: matched.발령일자, days_stale: daysStale, needs_reverification: true });
    }
  }
  return drifted;
}

function parseYyyymmdd(s) {
  if (!s || s.length !== 8) return null;
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  return new Date(`${y}-${m}-${d}`);
}

export {
  enqueueForReview,
  applyReviewDecision,
  getApprovedItemsForDeployment,
  detectDrift,
};
