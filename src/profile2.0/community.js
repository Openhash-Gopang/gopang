/**
 * M09 — Community 모듈
 * GET  /community
 * POST /community
 * GET  /community/:id
 * POST /community/:id/reply
 * POST /community/:id/resolve
 *
 * 의존: M01(JWT), M10(GDC 지급), M13(Security 스코어링)
 */

// v1.0 오픈 카테고리
const V1_CATEGORIES = ['help', 'emergency', 'lost_found'];
const ALL_CATEGORIES = [...V1_CATEGORIES, 'info', 'general', 'companion'];

const HAVERSINE_R = 6371000; // 지구 반지름(m)

function haversineM(lat1, lng1, lat2, lng2) {
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * HAVERSINE_R * Math.asin(Math.sqrt(a));
}

// ── JWT 검증 (M01 위임 — 테스트용 심 제공) ────────────────────────
export async function verifyJWT(authHeader, masterKey) {
  if (!authHeader?.startsWith('Bearer ')) return null;
  const token = authHeader.slice(7);
  try {
    const [headerB64, payloadB64, sigB64] = token.split('.');
    if (!headerB64 || !payloadB64 || !sigB64) return null;

    const b64decode = s => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(masterKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify']
    );
    const data = new TextEncoder().encode(`${headerB64}.${payloadB64}`);
    const sig  = b64decode(sigB64);
    const ok   = await crypto.subtle.verify('HMAC', key, sig, data);
    if (!ok) return null;

    const payload = JSON.parse(b64decode(payloadB64).toString('utf8'));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── K-Security 스코어링 (M13 위임 — 최소 구현) ────────────────────
export function scoreContent(text) {
  const spamPatterns  = /(.)\1{5,}|http[s]?:\/\//gi;
  const hatePatterns  = /쓰레기|죽어|멍청|바보새끼/gi;  // 예시 패턴
  let score = 0;
  if (spamPatterns.test(text))  score = Math.max(score, 0.65);
  if (hatePatterns.test(text))  score = Math.max(score, 0.85);
  return score;
}

// ── 번역 헬퍼 (M17 Translate Helper 위임) ─────────────────────────
async function translate(env, text, fromLang, toLang) {
  if (!text || fromLang === toLang) return text;

  const resp = await fetch(`${env.WORKER_BASE_URL}/interpret`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, from_lang: fromLang, to_lang: toLang }),
  });
  if (!resp.ok) return text;  // 번역 실패 시 원문 반환
  const { translated } = await resp.json();
  return translated ?? text;
}

// ── Supabase 헬퍼 ─────────────────────────────────────────────────
function sbHeaders(env, service = false) {
  const key = service ? env.SUPABASE_SERVICE_KEY : env.SUPABASE_KEY;
  return {
    'Content-Type': 'application/json',
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Prefer': 'return=representation',
  };
}

async function sbGet(env, path) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    headers: sbHeaders(env),
  });
  return r.ok ? r.json() : null;
}

async function sbPost(env, table, data, service = false) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: sbHeaders(env, service),
    body: JSON.stringify(data),
  });
  if (!r.ok) {
    const msg = await r.text();
    throw new Error(`Supabase POST ${table}: ${r.status} ${msg}`);
  }
  return r.json();
}

async function sbPatch(env, table, filter, data, service = false) {
  const r = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    method: 'PATCH',
    headers: sbHeaders(env, service),
    body: JSON.stringify(data),
  });
  return r.ok;
}

// ── Supabase Realtime 브로드캐스트 ────────────────────────────────
async function broadcast(env, channel, payload) {
  try {
    await fetch(`${env.SUPABASE_URL}/realtime/v1/api/broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({
        messages: [{ topic: channel, event: 'broadcast', payload }],
      }),
    });
  } catch {
    // Realtime 실패는 비치명적 — 로그만
    console.error(`[M09] Realtime broadcast failed: ${channel}`);
  }
}

// ── GET /community ─────────────────────────────────────────────────
export async function handleListPosts(request, env) {
  const p        = new URL(request.url).searchParams;
  const lang     = p.get('lang')     ?? 'all';
  const category = p.get('category') ?? '';
  const limit    = Math.min(parseInt(p.get('limit') ?? '20', 10), 100);
  const offset   = parseInt(p.get('offset') ?? '0', 10);
  const nearLat  = parseFloat(p.get('near_lat') ?? 'NaN');
  const nearLng  = parseFloat(p.get('near_lng') ?? 'NaN');

  // 카테고리 유효성 (빈 문자열은 전체 조회)
  if (category && !ALL_CATEGORIES.includes(category)) {
    return jsonResp({ error: 'INVALID_CATEGORY' }, 400);
  }

  // v1.0: help/emergency/lost_found 외 카테고리는 미공개
  let allowedCats = V1_CATEGORIES;
  if (category && !V1_CATEGORIES.includes(category)) {
    return jsonResp({ posts: [], notice: '해당 카테고리는 아직 오픈되지 않았습니다.' }, 200);
  }
  if (category) allowedCats = [category];

  let query = `community_posts?is_visible=eq.true&select=*&order=created_at.desc&limit=${limit}&offset=${offset}`;
  if (lang !== 'all') query += `&lang=eq.${encodeURIComponent(lang)}`;
  if (allowedCats.length === 1) query += `&category=eq.${encodeURIComponent(allowedCats[0])}`;
  else {
    const cats = allowedCats.map(c => `"${c}"`).join(',');
    query += `&category=in.(${cats})`;
  }

  const posts = await sbGet(env, query) ?? [];

  // 근접 정렬
  let result = posts;
  if (!isNaN(nearLat) && !isNaN(nearLng)) {
    result = posts
      .map(post => ({
        ...post,
        distance_m: (post.lat != null && post.lng != null)
          ? Math.round(haversineM(nearLat, nearLng, post.lat, post.lng))
          : null,
      }))
      .sort((a, b) => {
        if (a.distance_m == null) return 1;
        if (b.distance_m == null) return -1;
        return a.distance_m - b.distance_m;
      });
  }

  return jsonResp({ posts: result, count: result.length });
}

// ── POST /community ────────────────────────────────────────────────
export async function handleCreatePost(request, env) {
  // 인증 필수
  const payload = await verifyJWT(request.headers.get('Authorization'), env.GOPANG_MASTER_KEY);
  if (!payload) return jsonResp({ error: 'UNAUTHORIZED' }, 401);

  const body = await request.json();
  const { category, title, body: postBody, lat, lng } = body;
  const lang = payload.lang ?? body.lang ?? 'ko';

  if (!category || !title || !postBody) {
    return jsonResp({ error: 'MISSING_FIELDS', message: 'category, title, body 필수' }, 400);
  }
  if (!V1_CATEGORIES.includes(category)) {
    return jsonResp({ error: 'CATEGORY_NOT_OPEN', message: '해당 카테고리는 아직 오픈되지 않았습니다.' }, 400);
  }

  // K-Security 스코어링 (M13)
  const anomalyScore = scoreContent(`${title} ${postBody}`);
  const isVisible    = anomalyScore < 0.6;

  // 번역 (원문 언어 → 한국어)
  const bodyTranslated = await translate(env, postBody, lang, 'ko');

  // INSERT
  const row = {
    author_guid:      payload.guid,
    lang,
    category,
    title,
    body:             postBody,
    body_translated:  bodyTranslated,
    lat:              lat ?? null,
    lng:              lng ?? null,
    is_visible:       isVisible,
    is_resolved:      false,
    reply_count:      0,
  };

  const inserted = await sbPost(env, 'community_posts', row);
  const postId   = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;

  // K-Security 이벤트 기록
  if (!isVisible) {
    await sbPost(env, 'security_event', {
      source:        'community_post',
      ref_id:        postId,
      anomaly_score: anomalyScore,
      severity:      anomalyScore >= 0.8 ? 'S3' : 'S2',
    }, true).catch(() => {});
  }

  // 긴급 Realtime 브로드캐스트
  if (category === 'emergency' && isVisible) {
    await broadcast(env, `community:${lang}:emergency`, {
      post_id: postId,
      title,
      lat: lat ?? null,
      lng: lng ?? null,
    });
  }

  return jsonResp({ ok: true, post_id: postId, is_visible: isVisible }, 201);
}

// ── GET /community/:id ─────────────────────────────────────────────
export async function handleGetPost(request, env, postId) {
  const post = await sbGet(env,
    `community_posts?id=eq.${postId}&is_visible=eq.true&select=*`);
  if (!post || post.length === 0) return jsonResp({ error: 'NOT_FOUND' }, 404);

  const replies = await sbGet(env,
    `community_replies?post_id=eq.${postId}&select=*&order=created_at.asc`) ?? [];

  return jsonResp({ post: post[0], replies });
}

// ── POST /community/:id/reply ──────────────────────────────────────
export async function handleCreateReply(request, env, postId) {
  const payload = await verifyJWT(request.headers.get('Authorization'), env.GOPANG_MASTER_KEY);
  if (!payload) return jsonResp({ error: 'UNAUTHORIZED' }, 401);

  const { body: replyBody, is_helpful = false } = await request.json();
  if (!replyBody) return jsonResp({ error: 'MISSING_FIELDS', message: 'body 필수' }, 400);

  // 게시물 원본 언어 조회
  const posts = await sbGet(env, `community_posts?id=eq.${postId}&select=lang,author_guid`);
  if (!posts || posts.length === 0) return jsonResp({ error: 'POST_NOT_FOUND' }, 404);
  const postLang    = posts[0].lang;
  const postAuthor  = posts[0].author_guid;
  const authorLang  = payload.lang ?? 'ko';

  // 번역: 댓글 작성자 언어 → 게시물 언어
  const bodyTranslated = await translate(env, replyBody, authorLang, postLang);

  const row = {
    post_id:         postId,
    author_guid:     payload.guid,
    author_lang:     authorLang,
    body:            replyBody,
    body_translated: bodyTranslated,
    is_helpful,
  };

  const inserted = await sbPost(env, 'community_replies', row);
  const replyId  = Array.isArray(inserted) ? inserted[0]?.id : inserted?.id;

  // reply_count 증가
  await sbPatch(env, 'community_posts',
    `id=eq.${postId}`,
    { reply_count: `reply_count + 1` },   // Supabase increment 패턴은 RPC로 처리
    false
  );

  // 게시물 작성자에게 Realtime 알림
  await broadcast(env, `community:reply:${postAuthor}`, {
    post_id: postId,
    reply_id: replyId,
    author_lang: authorLang,
  });

  return jsonResp({ ok: true, reply_id: replyId }, 201);
}

// ── POST /community/:id/resolve ────────────────────────────────────
export async function handleResolve(request, env, postId) {
  const payload = await verifyJWT(request.headers.get('Authorization'), env.GOPANG_MASTER_KEY);
  if (!payload) return jsonResp({ error: 'UNAUTHORIZED' }, 401);

  // 게시물 작성자 확인
  const posts = await sbGet(env, `community_posts?id=eq.${postId}&select=author_guid,is_resolved`);
  if (!posts || posts.length === 0) return jsonResp({ error: 'POST_NOT_FOUND' }, 404);

  if (posts[0].author_guid !== payload.guid) {
    return jsonResp({ error: 'FORBIDDEN', message: '작성자만 해결 완료 처리할 수 있습니다.' }, 403);
  }
  if (posts[0].is_resolved) {
    return jsonResp({ error: 'ALREADY_RESOLVED' }, 409);
  }

  await sbPatch(env, 'community_posts', `id=eq.${postId}`, { is_resolved: true });

  // 마지막 is_helpful=true 댓글 작성자 조회
  const helpfulReplies = await sbGet(env,
    `community_replies?post_id=eq.${postId}&is_helpful=eq.true&select=author_guid&order=created_at.desc&limit=1`);

  if (helpfulReplies && helpfulReplies.length > 0) {
    const volunteerGuid = helpfulReplies[0].author_guid;
    // M10 위임: GDC ₮500 credit (source='manual')
    await sbPost(env, 'fs_ledger', {
      guid:       volunteerGuid,
      entry_type: 'bs-cash',
      direction:  'credit',
      amount:     500,
      source:     'manual',
      memo:       `커뮤니티 봉사 답변 인센티브 post:${postId}`,
    }, true).catch(() => {});
  }

  return jsonResp({ ok: true, is_resolved: true });
}

// ── 라우터 ─────────────────────────────────────────────────────────
export async function handleCommunity(request, env) {
  const url      = new URL(request.url);
  const segments = url.pathname.split('/').filter(Boolean);
  // segments[0] = 'community'

  if (segments.length === 1) {
    // /community
    if (request.method === 'GET')  return handleListPosts(request, env);
    if (request.method === 'POST') return handleCreatePost(request, env);
  }

  if (segments.length === 2) {
    // /community/:id
    const id = segments[1];
    if (request.method === 'GET') return handleGetPost(request, env, id);
  }

  if (segments.length === 3) {
    const id     = segments[1];
    const action = segments[2];
    if (request.method === 'POST' && action === 'reply')   return handleCreateReply(request, env, id);
    if (request.method === 'POST' && action === 'resolve') return handleResolve(request, env, id);
  }

  return jsonResp({ error: 'NOT_FOUND' }, 404);
}

// ── 공통 ──────────────────────────────────────────────────────────
function jsonResp(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
