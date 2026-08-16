import { enqueueForReview, applyReviewDecision, getApprovedItemsForDeployment, detectDrift } from '../review-gate-and-drift.js';
const queue = enqueueForReview([{ item: 'X', legal_basis: 'Y', status: 'pending_review' }], { 기관코드: 'POLICE', source_regulation_id: 'r1', source_regulation_name: 'reg' });
try { applyReviewDecision(queue[0], 'approve', {}); console.log('FAIL: reviewer 없이 통과됨'); }
catch (e) { console.log('OK: reviewer 없으면 예외 —', e.message); }
const approved = applyReviewDecision(queue[0], 'approve', { reviewer: '김OO' });
console.log('배포대상 개수:', getApprovedItemsForDeployment([approved]).length, '(1 기대)');
const drifted = detectDrift(
  [{ item: 'X', legal_basis: '경찰수사규칙 제10조', legal_basis_last_verified: '2026-01-01' }],
  [{ 행정규칙명: '경찰수사규칙', 발령일자: '20260701' }]
);
console.log('드리프트 감지 개수:', drifted.length, '(1 기대)');
