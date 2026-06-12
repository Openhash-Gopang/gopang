// ============================================================
// review.js — M06 리뷰 모듈 (Cloudflare Worker 핸들러)
// 저장위치: gopang/src/profile2.0/review.js
// 의존: src/auth/auth.js (requireAuth)
// ============================================================

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const BIAS_THRESHOLD = 1.0;    // 편향 감지 기준 평점 격차
const MIN_RATING     = 1;
const MAX_RATING     = 5;

// 편향 안내 문구 (6개 언어)
const BIAS_MESSAGES = {
  ko: '국적별 평점에 차이가 있습니다. 다양한 시각을 함께 참고해 주세요.',
  zh: '不同国籍的评分存在差异，请综合参考多方观点。',
  en: 'Ratings vary by nationality. Please consider diverse perspectives.',
  ja: '国籍別の評価に差があります。様々な視点を参考にしてください。',
  vi: 'Điểm đánh giá khác nhau theo quốc tịch. Vui lòng tham khảo nhiều góc nhìn.',
  th: 'คะแนนแตกต่างกันตามสัญชาติ โปรดพิจารณาจากหลายมุมมอง',
};

// ─────────────────────────────────────────────
// 편향 감지
// ─────────────────────────────────────────────
function detectBias(viewerAvg, overallAvg) {
  if (viewerAvg === null || overallAvg === null) return false;
  return Math.abs(viewerAvg - overallAvg) >= BIAS_THRESHOLD;
}

function getBiasMessage(lang) {
  return BIAS_MESSAGES[lang] || BIAS_MESSAGES.en;
}

// ─────────────────────────────────────────────
// 평점 유효성 검증
// ─────────────────────────────────────────────
function isValidRating(rating) {
  if (typeof rating !== 'number') return false;   // 문자열·null·undefined 차단
  return Number.isInteger(rating) && rating >= 1 && rating <= 5;
}

// ─────────────────────────────────────────────
// review_summary 조합 (M04와 공유 로직)
// ─────────────────────────────────────────────
function buildReviewSummary(statsRows, viewerLang) {
  if (!Array.isArray(statsRows) || statsRows.length === 0) {
    return {
      overall:          { count: 0, avg: null },
      by_lang:          [],
      viewer_highlight: null,
      bias_warning:     null,
    };
  }

  const LANG_LABEL = {
    ko: '한국인', zh: '中国旅行者', en: 'English speakers',
    ja: '日本人旅行者', vi: 'Du khách Việt Nam', th: 'นักท่องเที่ยวไทย',
  };

  const totalCount = statsRows.reduce((s, r) => s + Number(r.review_count), 0);
  const weightedSum = statsRows.reduce(
    (s, r) => s + Number(r.avg_rating) * Number(r.review_count), 0
  );
  const overallAvg = Math.round((weightedSum / totalCount) * 10) / 10;

  const by_lang = statsRows.map(r => ({
    lang:      r.reviewer_lang,
    label:     LANG_LABEL[r.reviewer_lang] || r.reviewer_lang,
    count:     Number(r.review_count),
    avg:       Number(r.avg_rating),
    five_star: Number(r.five_star || 0),
    one_star:  Number(r.one_star  || 0),
  }));

  const highlight  = by_lang.find(b => b.lang === viewerLang) || null;
  const viewerAvg  = highlight?.avg ?? null;
  const hasBias    = detectBias(viewerAvg, overallAvg);

  return {
    overall:          { count: totalCount, avg: overallAvg },
    by_lang,
    viewer_highlight: highlight,
    bias_warning:     hasBias ? getBiasMessage(viewerLang) : null,
  };
}

// ─────────────────────────────────────────────
// Supabase 공통
// ─────────────────────────────────────────────
function sbH(key) {
  return {
    apikey:         key,
    Authorization:  `Bearer ${key}`,
    'Content-Type': 'application/json',
  };
}
async function sbGet(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: sbH(key) });
  if (!res.ok) throw new Error(`SUPABASE_GET_ERROR: ${res.status}`);
  return res.json();
}
async function sbInsert(url, key, table, data, prefer = 'return=representation') {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...sbH(key), Prefer: prefer },
    body:    JSON.stringify(data),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SUPABASE_INSERT_ERROR: ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

// ─────────────────────────────────────────────
// DeepSeek 번역 (M05와 동일 패턴)
// ─────────────────────────────────────────────
async function translate(text, fromLang, toLang, apiKey) {
  if (!text || fromLang === toLang) return text;
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model:      'deepseek-chat',
        max_tokens: 512,
        messages: [{
          role:    'user',
          content: `Translate from ${fromLang} to ${toLang}. Return only the translation.\n\n${text}`,
        }],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  } catch { return text; }
}

// ─────────────────────────────────────────────
// POST /review — 리뷰 작성
// ─────────────────────────────────────────────
async function handleReview(request, env, corsHeaders) {
  if (!env.GOPANG_MASTER_KEY)
    return _err(500, 'SERVER_CONFIG_ERROR', 'GOPANG_MASTER_KEY 미등록', corsHeaders);

  // JWT 검증 (M01) — reviewer_lang 추출
  const authResult = await requireAuth(request, env.GOPANG_MASTER_KEY);
  if (authResult instanceof Response) return authResult;
  const reviewer = authResult; // { guid, name, lang, type }

  let body;
  try { body = await request.json(); }
  catch { return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders); }

  const { target_guid, tx_id, rating, body: reviewBody = '' } = body;

  // 필수 필드 검증
  if (!target_guid || !tx_id || rating === undefined)
    return _err(400, 'MISSING_FIELD', 'target_guid, tx_id, rating 필수', corsHeaders);

  // 평점 유효성 (1~5 정수)
  if (!isValidRating(rating))
    return _err(400, 'INVALID_RATING', '평점은 1~5 정수', corsHeaders);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // RV02: tx_id 유효성 검증 — biz_orders에서 구매 확인
    const orders = await sbGet(SUPA, env.SUPABASE_KEY,
      `biz_orders?tx_id=eq.${encodeURIComponent(tx_id)}&buyer_guid=eq.${encodeURIComponent(reviewer.guid)}&select=tx_id,seller_guid`
    );
    if (!Array.isArray(orders) || orders.length === 0)
      return _err(403, 'NO_VALID_PURCHASE', '해당 거래 내역이 없습니다.', corsHeaders);

    const sellerGuid  = orders[0].seller_guid;
    const finalTarget = target_guid || sellerGuid;

    // 업체 타입 조회 (target_type 결정)
    const profiles = await sbGet(SUPA, env.SUPABASE_KEY,
      `user_profiles?guid=eq.${encodeURIComponent(finalTarget)}&select=entity_type`
    );
    const entityType = profiles?.[0]?.entity_type || 'org';
    const targetType = ['org', 'institution'].includes(entityType) ? entityType : 'org';

    // RV04: reviewer_lang — JWT.lang에서 자동 주입 (사용자 조작 불가)
    const reviewer_lang = reviewer.lang || 'ko';

    // RV05: 번역본 자동 생성 (한국어로)
    const body_translated = reviewer_lang !== 'ko' && reviewBody
      ? await translate(reviewBody, reviewer_lang, 'ko', env.DEEPSEEK_API_KEY)
      : reviewBody;

    const now = new Date().toISOString();

    // RV03: UNIQUE(target_guid, reviewer_guid, tx_id) — 중복 시 409
    try {
      const result = await sbInsert(SUPA, env.SUPABASE_KEY, 'profile_reviews', {
        target_guid:      finalTarget,
        target_type:      targetType,
        reviewer_guid:    reviewer.guid,
        tx_id,
        rating:           Number(rating),
        body:             reviewBody,
        body_translated,
        body_lang:        reviewer_lang,
        reviewer_lang,
        is_visible:       true,
        created_at:       now,
      }, 'return=representation');

      const reviewId = Array.isArray(result) ? result[0]?.id : result?.id;

      return new Response(JSON.stringify({
        ok:        true,
        review_id: reviewId,
        reviewer_lang,
        translated: reviewer_lang !== 'ko',
      }), {
        status:  201,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (e) {
      // UNIQUE 위반 (23505)
      if (e.message.includes('23505') || e.message.includes('unique'))
        return _err(409, 'ALREADY_REVIEWED', '이미 이 거래에 대한 리뷰를 작성했습니다.', corsHeaders);
      throw e;
    }

  } catch (e) {
    return _err(500, 'REVIEW_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// GET /review/list?target_guid=&lang=&limit=&offset=
// 리뷰 목록 조회 (국적 필터 지원)
// ─────────────────────────────────────────────
async function handleReviewList(request, env, corsHeaders) {
  const url         = new URL(request.url);
  const target_guid = url.searchParams.get('target_guid');
  const lang        = url.searchParams.get('lang');       // 국적 필터 (선택)
  const limit       = Math.min(Number(url.searchParams.get('limit')  || 20), 50);
  const offset      = Number(url.searchParams.get('offset') || 0);
  const viewer_lang = url.searchParams.get('viewer_lang') || 'ko';

  if (!target_guid)
    return _err(400, 'MISSING_FIELD', 'target_guid 필수', corsHeaders);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // 리뷰 목록
    let reviewPath = `profile_reviews?target_guid=eq.${encodeURIComponent(target_guid)}&is_visible=eq.true&order=created_at.desc&limit=${limit}&offset=${offset}`;
    if (lang) reviewPath += `&reviewer_lang=eq.${lang}`;

    const reviews = await sbGet(SUPA, env.SUPABASE_KEY, reviewPath);

    // 국적별 평점 통계
    const stats = await sbGet(SUPA, env.SUPABASE_KEY,
      `profile_review_stats?target_guid=eq.${encodeURIComponent(target_guid)}`
    );
    const summary = buildReviewSummary(stats, viewer_lang);

    return new Response(JSON.stringify({
      ok: true,
      reviews:        Array.isArray(reviews) ? reviews : [],
      review_summary: summary,
      filter_lang:    lang || null,
      pagination:     { limit, offset },
    }), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return _err(500, 'REVIEW_LIST_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// 공통 유틸
// ─────────────────────────────────────────────
function _err(status, code, message, corsHeaders) {
  return new Response(JSON.stringify({ error: code, message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// requireAuth stub (worker.js 인라인 시 src/auth/auth.js 사용)
async function requireAuth(request, masterKey) { return null; }

// ─────────────────────────────────────────────
// worker.js 라우터 스니펫
// ─────────────────────────────────────────────
/*
  // ── Profile 2.0 M06 Review ───────────────────────────────
  if (pathname === '/review' && request.method === 'POST')
    return handleReview(request, env, corsHeaders);
  if (pathname === '/review/list' && request.method === 'GET')
    return handleReviewList(request, env, corsHeaders);
*/

export {
  handleReview,
  handleReviewList,
  buildReviewSummary,
  detectBias,
  getBiasMessage,
  isValidRating,
  BIAS_THRESHOLD,
  BIAS_MESSAGES,
};
