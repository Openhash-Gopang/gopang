// ============================================================
// profile.js — M04 프로필 모듈 (Cloudflare Worker 핸들러)
// 저장위치: gopang/src/profile2.0/profile.js
// 의존: src/auth/auth.js (verifyJWT — 선택적)
// 기존 worker.js의 handleBizProfile()을 이 파일로 대체·확장
// ============================================================
// 2026-07-14: DeepSeek 직접 fetch를 공용 클라이언트로 교체.
import { deepseekChatText } from '../gopang/core/deepseek-client.js';

// ─────────────────────────────────────────────
// 하버사인 거리 계산 (미터 단위)
// ─────────────────────────────────────────────
function haversineM(lat1, lng1, lat2, lng2) {
  const R  = 6371000; // 지구 반지름 (m)
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// ─────────────────────────────────────────────
// KST 영업시간 파싱 → is_open 판단
// 형식: "HH:MM-HH:MM" 또는 "HH:MM–HH:MM"
// ─────────────────────────────────────────────
function calcIsOpen(businessHours) {
  if (!businessHours) return null;
  const match = String(businessHours).match(/(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const now     = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMin  = now.getUTCMinutes();
  const current = kstHour * 60 + kstMin;
  const open    = Number(match[1]) * 60 + Number(match[2]);
  const close   = Number(match[3]) * 60 + Number(match[4]);
  return current >= open && current < close;
}

// ─────────────────────────────────────────────
// Supabase fetch 공통
// ─────────────────────────────────────────────
function sbHeaders(key) {
  return { apikey: key, Authorization: `Bearer ${key}` };
}
async function sbGet(supabaseUrl, key, path) {
  const res = await fetch(`${supabaseUrl}/rest/v1/${path}`, {
    headers: sbHeaders(key),
  });
  if (!res.ok) throw new Error(`SUPABASE_ERROR: ${res.status}`);
  return res.json();
}

// ─────────────────────────────────────────────
// ai_active 판정 (M04 §6.4)
// ─────────────────────────────────────────────
async function resolveAiActive(supabaseUrl, key, guid) {
  try {
    const rows = await sbGet(supabaseUrl, key,
      `user_llm_keys?guid=eq.${encodeURIComponent(guid)}&select=ai_active`);
    if (!Array.isArray(rows) || rows.length === 0) return false;
    return rows[0].ai_active === true;
  } catch { return false; }
}

// ─────────────────────────────────────────────
// review_summary 조합 (M06 데이터 조회)
// ─────────────────────────────────────────────
async function buildReviewSummary(supabaseUrl, key, targetGuid, viewerLang) {
  try {
    const stats = await sbGet(supabaseUrl, key,
      `profile_review_stats?target_guid=eq.${encodeURIComponent(targetGuid)}`);

    if (!Array.isArray(stats) || stats.length === 0) {
      return { overall: { count: 0, avg: null }, by_lang: [], viewer_highlight: null };
    }

    // 전체 집계
    const totalCount = stats.reduce((s, r) => s + Number(r.review_count), 0);
    const totalAvg   = stats.reduce((s, r) => s + Number(r.avg_rating) * Number(r.review_count), 0) / totalCount;

    // 언어별 배열
    const LANG_LABEL = {
      ko: '한국인', zh: '中国旅行者', en: 'English speakers',
      ja: '日本人旅行者', vi: 'Du khách Việt Nam', th: 'นักท่องเที่ยวไทย',
    };
    const by_lang = stats.map(r => ({
      lang:  r.reviewer_lang,
      label: LANG_LABEL[r.reviewer_lang] || r.reviewer_lang,
      count: Number(r.review_count),
      avg:   Number(r.avg_rating),
    }));

    // viewer_highlight
    const highlight = by_lang.find(b => b.lang === viewerLang) || null;

    return {
      overall:          { count: totalCount, avg: Math.round(totalAvg * 10) / 10 },
      by_lang,
      viewer_highlight: highlight,
    };
  } catch {
    return { overall: { count: 0, avg: null }, by_lang: [], viewer_highlight: null };
  }
}

// ─────────────────────────────────────────────
// DeepSeek 번역 (Worker /interpret 내부 구현)
// ─────────────────────────────────────────────
async function translate(text, fromLang, toLang, env) {
  if (!text || fromLang === toLang) return text;
  return deepseekChatText({
    env,
    messages: [{
      role:    'user',
      content: `Translate the following text from ${fromLang} to ${toLang}. Return only the translated text, no explanation.\n\n${text}`,
    }],
    max_tokens: 256,
    fallbackText: text, // 번역 실패 시 원문 반환
  });
}

// ─────────────────────────────────────────────
// GET /biz/profile/:handle
// ─────────────────────────────────────────────
async function handleBizProfile(request, env, corsHeaders) {
  const url        = new URL(request.url);
  const handle     = decodeURIComponent(url.pathname.replace('/biz/profile/', ''));
  const viewerLang = url.searchParams.get('viewer_lang') || url.searchParams.get('lang') || 'ko';
  const viewerLat  = parseFloat(url.searchParams.get('lat'))  || null;
  const viewerLng  = parseFloat(url.searchParams.get('lng'))  || null;

  if (!handle || !handle.startsWith('@')) {
    return _err(400, 'INVALID_HANDLE', 'handle은 @로 시작해야 합니다.', corsHeaders);
  }

  // 선택적 JWT — 인증 없어도 조회 가능 (read-only)
  let viewerGuid = null;
  const authHeader = request.headers.get('Authorization') || '';
  if (authHeader.startsWith('Bearer ') && env.GOPANG_MASTER_KEY) {
    try {
      const payload = await verifyJWT(authHeader.slice(7), env.GOPANG_MASTER_KEY);
      if (payload) viewerGuid = payload.guid;
    } catch { /* 무시 */ }
  }

  const SUPA_URL = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // 프로필 조회
    const profiles = await sbGet(SUPA_URL, env.SUPABASE_KEY,
      `user_profiles?handle=eq.${encodeURIComponent(handle)}&select=*`);

    if (!Array.isArray(profiles) || profiles.length === 0) {
      return _err(404, 'NOT_FOUND', `프로필을 찾을 수 없습니다: ${handle}`, corsHeaders);
    }

    const profile = profiles[0];

    // PR05: is_public=false → 404 (비공개)
    if (!profile.is_public) {
      return _err(404, 'NOT_FOUND', '비공개 프로필입니다.', corsHeaders);
    }

    // ai_active 판정 (M04 §6.4)
    const ai_active = await resolveAiActive(SUPA_URL, env.SUPABASE_KEY, profile.guid);

    // review_summary (M06 데이터)
    const review_summary = await buildReviewSummary(
      SUPA_URL, env.SUPABASE_KEY, profile.guid, viewerLang
    );

    // 거리 계산 (viewer 위치 제공 시)
    let distance_m = null;
    if (viewerLat && viewerLng && profile.lat && profile.lng) {
      distance_m = haversineM(viewerLat, viewerLng, profile.lat, profile.lng);
    }

    // 영업시간 is_open 판단
    const businessHours = profile.extra?.business_hours || profile.extra?.public_hours || null;
    const is_open       = calcIsOpen(businessHours);

    // 다국어 번역 (native_lang ≠ viewerLang 시)
    let displayName    = profile.name;
    let displayAddress = profile.address || '';
    if (viewerLang !== 'ko' && viewerLang !== profile.native_lang && env.DEEPSEEK_API_KEY) {
      [displayName, displayAddress] = await Promise.all([
        translate(profile.name,    profile.native_lang || 'ko', viewerLang, env),
        translate(profile.address, profile.native_lang || 'ko', viewerLang, env),
      ]);
    }

    const responseBody = {
      guid:         profile.guid,
      handle:       profile.handle,
      name:         displayName,
      name_original: profile.name,
      entity_type:  profile.entity_type,
      address:      displayAddress,
      address_original: profile.address,
      native_lang:  profile.native_lang,
      is_public:    profile.is_public,
      lat:          profile.lat,
      lng:          profile.lng,
      extra:        profile.extra || {},
      ai_active,
      is_open,
      business_hours: businessHours,
      review_summary,
      distance_m,
      viewer_lang:  viewerLang,
    };

    return new Response(JSON.stringify(responseBody), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return _err(500, 'PROFILE_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// GET /interpret?text=...&from=ko&to=zh
// ─────────────────────────────────────────────
async function handleInterpret(request, env, corsHeaders) {
  const url      = new URL(request.url);
  const text     = url.searchParams.get('text')     || '';
  const fromLang = url.searchParams.get('from')     || 'ko';
  const toLang   = url.searchParams.get('to')       || 'en';

  if (!text) return _err(400, 'MISSING_FIELD', 'text 파라미터 필수', corsHeaders);
  if (!env.DEEPSEEK_API_KEY) return _err(500, 'CONFIG_ERROR', 'DEEPSEEK_API_KEY 미등록', corsHeaders);

  const translated = await translate(text, fromLang, toLang, env);
  return new Response(JSON.stringify({ original: text, translated, from: fromLang, to: toLang }), {
    status:  200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
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

// verifyJWT 참조 (worker.js 인라인 시 src/auth/auth.js에서 가져옴)
// 단독 실행 시 아래 stub 사용
async function verifyJWT(token, key) {
  // 실제 구현은 src/auth/auth.js 참조
  return null;
}

// ─────────────────────────────────────────────
// worker.js 라우터 스니펫
// ─────────────────────────────────────────────
/*
  // ── Profile 2.0 M04 Profile (기존 handleBizProfile 대체) ──
  if (pathname.startsWith('/biz/profile/'))
    return handleBizProfile(request, env, corsHeaders);
  if (pathname === '/interpret')
    return handleInterpret(request, env, corsHeaders);
*/

export {
  handleBizProfile,
  handleInterpret,
  haversineM,
  calcIsOpen,
  buildReviewSummary,
  resolveAiActive,
  translate,
};
