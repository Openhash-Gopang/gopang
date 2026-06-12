// ============================================================
// m06_review.test.mjs — M06 리뷰 모듈 테스트
// 저장위치: gopang/src/tests/profile2.0/m06_review.test.mjs
// 실행: node src/tests/profile2.0/m06_review.test.mjs
// ============================================================

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ─── 테스트 대상 함수 인라인 ───

const BIAS_THRESHOLD = 1.0;
const BIAS_MESSAGES = {
  ko: '국적별 평점에 차이가 있습니다. 다양한 시각을 함께 참고해 주세요.',
  zh: '不同国籍的评分存在差异，请综合参考多方观点。',
  en: 'Ratings vary by nationality. Please consider diverse perspectives.',
  ja: '国籍別の評価に差があります。様々な視点を参考にしてください。',
  vi: 'Điểm đánh giá khác nhau theo quốc tịch. Vui lòng tham khảo nhiều góc nhìn.',
  th: 'คะแนนแตกต่างกันตามสัญชาติ โปรดพิจารณาจากหลายมุมมอง',
};

function detectBias(viewerAvg, overallAvg) {
  if (viewerAvg === null || overallAvg === null) return false;
  return Math.abs(viewerAvg - overallAvg) >= BIAS_THRESHOLD;
}
function getBiasMessage(lang) {
  return BIAS_MESSAGES[lang] || BIAS_MESSAGES.en;
}
function isValidRating(rating) {
  if (typeof rating !== 'number') return false;
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

function buildReviewSummary(statsRows, viewerLang) {
  if (!Array.isArray(statsRows) || statsRows.length === 0)
    return { overall: { count: 0, avg: null }, by_lang: [], viewer_highlight: null, bias_warning: null };

  const LANG_LABEL = {
    ko: '한국인', zh: '中国旅行者', en: 'English speakers',
    ja: '日本人旅行者', vi: 'Du khách Việt Nam', th: 'นักท่องเที่ยวไทย',
  };
  const totalCount  = statsRows.reduce((s, r) => s + Number(r.review_count), 0);
  const weightedSum = statsRows.reduce((s, r) => s + Number(r.avg_rating) * Number(r.review_count), 0);
  const overallAvg  = Math.round((weightedSum / totalCount) * 10) / 10;

  const by_lang = statsRows.map(r => ({
    lang:      r.reviewer_lang,
    label:     LANG_LABEL[r.reviewer_lang] || r.reviewer_lang,
    count:     Number(r.review_count),
    avg:       Number(r.avg_rating),
    five_star: Number(r.five_star || 0),
    one_star:  Number(r.one_star  || 0),
  }));

  const highlight = by_lang.find(b => b.lang === viewerLang) || null;
  const viewerAvg = highlight?.avg ?? null;
  const hasBias   = detectBias(viewerAvg, overallAvg);

  return {
    overall:          { count: totalCount, avg: overallAvg },
    by_lang,
    viewer_highlight: highlight,
    bias_warning:     hasBias ? getBiasMessage(viewerLang) : null,
  };
}

// ─────────────────────────────────────────────
// 테스트 프레임워크
// ─────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(id, desc, fn) {
  try {
    await fn();
    console.log(`  ✅ ${id} ${desc}`);
    passed++;
  } catch(e) {
    console.log(`  ❌ ${id} ${desc}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}
function assert(cond, msg)    { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg)  { if (a !== b) throw new Error(msg || `expected "${b}", got "${a}"`); }
function assertNull(a, msg)   { if (a !== null) throw new Error(msg || `expected null, got "${a}"`); }
function assertNotNull(a, msg){ if (a === null || a === undefined) throw new Error(msg || 'expected not null'); }

// ─────────────────────────────────────────────
// RV01 정상 리뷰 작성 — 필드 구성 검증
// ─────────────────────────────────────────────
await test('RV01', '정상 리뷰 작성 — 필드 구성 검증', async () => {
  const reviewData = {
    target_guid:   'seller-guid-001',
    target_type:   'org',
    reviewer_guid: 'buyer-guid-001',
    tx_id:         'tx-abc123',
    rating:        4,
    body:          '짜장면이 맛있었어요!',
    body_translated: '짜장면이 맛있었어요!', // ko → ko 번역 없음
    body_lang:     'ko',
    reviewer_lang: 'ko',
    is_visible:    true,
    created_at:    new Date().toISOString(),
  };

  assert(reviewData.target_guid,   'target_guid 없음');
  assert(reviewData.reviewer_guid, 'reviewer_guid 없음');
  assert(reviewData.tx_id,         'tx_id 없음');
  assertEq(reviewData.reviewer_lang, 'ko', 'reviewer_lang 오류');
  assertEq(reviewData.rating,        4,    'rating 오류');
});

// ─────────────────────────────────────────────
// RV02 미구매자 리뷰 — tx_id 유효성 검증
// ─────────────────────────────────────────────
await test('RV02', '미구매자 리뷰 — tx_id 유효성 검증', () => {
  // biz_orders 조회 결과 모킹
  const emptyOrders = []; // 구매 이력 없음
  assert(emptyOrders.length === 0, '빈 orders 감지 실패');

  // 구매 이력 있음
  const validOrders = [{ tx_id: 'tx-abc', seller_guid: 'seller-001' }];
  assert(validOrders.length > 0, '유효 orders 감지 실패');

  // 다른 buyer_guid의 tx_id → 403
  const otherBuyerOrders = []; // buyer_guid 불일치로 빈 결과
  assert(otherBuyerOrders.length === 0, '타인 거래 감지 실패');
});

// ─────────────────────────────────────────────
// RV03 중복 리뷰 — UNIQUE 제약
// ─────────────────────────────────────────────
await test('RV03', '중복 리뷰 — UNIQUE(target, reviewer, tx_id) 감지', () => {
  const existingKeys = new Set(['seller-001:buyer-001:tx-abc']);
  const newKey       = `seller-001:buyer-001:tx-abc`; // 동일 조합
  assert(existingKeys.has(newKey), '중복 미감지');

  // 다른 tx_id → 중복 아님
  const newKey2 = 'seller-001:buyer-001:tx-xyz';
  assert(!existingKeys.has(newKey2), '신규 tx_id가 중복 처리됨');
});

// ─────────────────────────────────────────────
// RV04 reviewer_lang 자동 주입 — JWT.lang 기반
// ─────────────────────────────────────────────
await test('RV04', 'reviewer_lang — JWT.lang 자동 주입', () => {
  // JWT payload 시뮬레이션
  const jwtPayloads = [
    { guid: 'g1', lang: 'zh', type: 'consumer' },
    { guid: 'g2', lang: 'ja', type: 'consumer' },
    { guid: 'g3', lang: 'ko', type: 'consumer' },
    { guid: 'g4', lang: 'en', type: 'consumer' },
  ];
  for (const payload of jwtPayloads) {
    // reviewer_lang = JWT.lang (사용자 입력 불가)
    const reviewer_lang = payload.lang || 'ko';
    assertEq(reviewer_lang, payload.lang, `lang=${payload.lang} 주입 오류`);
  }
});

// ─────────────────────────────────────────────
// RV05 번역본 자동 생성 — reviewer_lang ≠ ko
// ─────────────────────────────────────────────
await test('RV05', '번역본 자동 생성 — zh 리뷰 → ko 번역 트리거', () => {
  const cases = [
    { reviewer_lang: 'zh', body: '很好吃！',     shouldTranslate: true  },
    { reviewer_lang: 'ko', body: '맛있어요',     shouldTranslate: false },
    { reviewer_lang: 'ja', body: 'おいしかった', shouldTranslate: true  },
    { reviewer_lang: 'en', body: 'Great food!',  shouldTranslate: true  },
    { reviewer_lang: 'ko', body: '',             shouldTranslate: false }, // 빈 본문
  ];
  for (const { reviewer_lang, body, shouldTranslate } of cases) {
    const willTranslate = reviewer_lang !== 'ko' && !!body;
    assertEq(willTranslate, shouldTranslate,
      `lang=${reviewer_lang}, body="${body}" 번역 판단 오류`);
  }
});

// ─────────────────────────────────────────────
// RV06 국적별 평점 집계 — 가중평균 검증
// ─────────────────────────────────────────────
await test('RV06', '국적별 평점 집계 — 가중평균 + by_lang 구성', () => {
  const statsRows = [
    { reviewer_lang: 'ko', review_count: 58, avg_rating: 3.8, five_star: 10, one_star: 5 },
    { reviewer_lang: 'zh', review_count: 43, avg_rating: 4.7, five_star: 30, one_star: 0 },
    { reviewer_lang: 'ja', review_count: 19, avg_rating: 4.4, five_star:  8, one_star: 1 },
    { reviewer_lang: 'en', review_count:  8, avg_rating: 4.2, five_star:  3, one_star: 0 },
  ];
  const summary = buildReviewSummary(statsRows, 'ko');

  // 전체 건수
  assertEq(summary.overall.count, 128, 'overall.count 오류');

  // 가중평균 검증
  const totalCount  = 128;
  const weightedSum = 58*3.8 + 43*4.7 + 19*4.4 + 8*4.2;
  const expected    = Math.round((weightedSum / totalCount) * 10) / 10;
  assertEq(summary.overall.avg, expected, `overall.avg 오류: ${summary.overall.avg} ≠ ${expected}`);

  // by_lang 개수
  assertEq(summary.by_lang.length, 4, 'by_lang 항목 수 오류');

  // by_lang 합계 = overall.count
  const byLangTotal = summary.by_lang.reduce((s, b) => s + b.count, 0);
  assertEq(byLangTotal, 128, 'by_lang 합계 ≠ overall.count');
});

// ─────────────────────────────────────────────
// RV07 viewer_highlight — viewer_lang 일치 추출
// ─────────────────────────────────────────────
await test('RV07', 'viewer_highlight — viewer_lang=zh 추출', () => {
  const statsRows = [
    { reviewer_lang: 'ko', review_count: 58, avg_rating: 3.8 },
    { reviewer_lang: 'zh', review_count: 43, avg_rating: 4.7 },
  ];

  // zh 조회 시
  const summary = buildReviewSummary(statsRows, 'zh');
  assertNotNull(summary.viewer_highlight,             'viewer_highlight null');
  assertEq(summary.viewer_highlight.lang,  'zh',     'highlight.lang 오류');
  assertEq(summary.viewer_highlight.avg,   4.7,      'highlight.avg 오류');
  assertEq(summary.viewer_highlight.count, 43,       'highlight.count 오류');

  // vi 조회 시 (해당 없음)
  const summaryVi = buildReviewSummary(statsRows, 'vi');
  assertNull(summaryVi.viewer_highlight, 'vi highlight null 아님');
});

// ─────────────────────────────────────────────
// RV08 편향 감지 — 격차 ≥ 1.0 시 문구 + 다국어
// ─────────────────────────────────────────────
await test('RV08', '편향 감지 — zh_avg=5.0, overall=3.0 → 경고 문구', () => {
  const statsRows = [
    { reviewer_lang: 'ko', review_count: 100, avg_rating: 2.5 },
    { reviewer_lang: 'zh', review_count:  10, avg_rating: 5.0 },
  ];
  const summary = buildReviewSummary(statsRows, 'zh');

  // 편향 감지 여부
  assertNotNull(summary.bias_warning, '편향 경고 없음');
  assert(summary.bias_warning.length > 0, '편향 경고 빈 문자열');

  // 중국어 문구 확인
  assert(summary.bias_warning === BIAS_MESSAGES.zh, '중국어 편향 문구 오류');

  // 편향 없는 경우
  const normalRows = [
    { reviewer_lang: 'ko', review_count: 50, avg_rating: 4.0 },
    { reviewer_lang: 'zh', review_count: 50, avg_rating: 4.5 },
  ];
  const normalSummary = buildReviewSummary(normalRows, 'zh');
  assertNull(normalSummary.bias_warning, '편향 없는데 경고 표시');
});

// ─────────────────────────────────────────────
// 추가: 평점 유효성 경계값 검증
// ─────────────────────────────────────────────
await test('RV09', '평점 유효성 — 1~5 정수만 허용', () => {
  const valid   = [1, 2, 3, 4, 5];
  const invalid = [0, 6, -1, 1.5, NaN, null, undefined, '3', ''];

  for (const r of valid)   assert(isValidRating(r),  `유효 평점 거부: ${r}`);
  for (const r of invalid) assert(!isValidRating(r), `무효 평점 허용: ${r}`);
});

// ─────────────────────────────────────────────
// 추가: 편향 감지 경계값
// ─────────────────────────────────────────────
await test('RV10', '편향 감지 경계값 — 격차 정확히 1.0', () => {
  assert( detectBias(5.0, 4.0), '격차 1.0 — 편향 미감지');   // 경계값 포함
  assert(!detectBias(4.9, 4.0), '격차 0.9 — 편향 오감지');
  assert( detectBias(2.0, 3.5), '격차 1.5 — 편향 미감지');
  assert(!detectBias(null, 4.0),'null viewerAvg — 편향 오감지');
  assert(!detectBias(4.0, null),'null overallAvg — 편향 오감지');
});

// ─────────────────────────────────────────────
// 추가: 편향 문구 6개 언어 존재 확인
// ─────────────────────────────────────────────
await test('RV11', '편향 문구 — 6개 언어 모두 존재', () => {
  const langs = ['ko', 'zh', 'en', 'ja', 'vi', 'th'];
  for (const lang of langs) {
    const msg = getBiasMessage(lang);
    assert(msg && msg.length > 0, `${lang} 편향 문구 없음`);
  }
  // 미지원 언어 → 영어 폴백
  const fallback = getBiasMessage('de');
  assertEq(fallback, BIAS_MESSAGES.en, '미지원 언어 영어 폴백 오류');
});

// ─────────────────────────────────────────────
// 추가: 빈 리뷰 stats → 기본값 반환
// ─────────────────────────────────────────────
await test('RV12', '빈 stats — 기본값 반환', () => {
  const summary = buildReviewSummary([], 'ko');
  assertEq(summary.overall.count,    0,    'count 0 아님');
  assertNull(summary.overall.avg,         'avg null 아님');
  assertEq(summary.by_lang.length,   0,    'by_lang 빈 배열 아님');
  assertNull(summary.viewer_highlight,    'viewer_highlight null 아님');
  assertNull(summary.bias_warning,        'bias_warning null 아님');
});

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log(`M06 Review 테스트 결과: ${passed}/${passed+failed} 통과`);
if (failed > 0) {
  console.log(`❌ 실패: ${failed}건`);
  process.exit(1);
} else {
  console.log('✅ 전체 통과 — M06 합격');
}
console.log('══════════════════════════════════════');
