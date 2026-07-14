// ============================================================
// location.js — M07 위치 모듈 (Cloudflare Worker 핸들러)
// 저장위치: gopang/src/profile2.0/location.js
// 의존: src/auth/auth.js (requireAuth)
// ============================================================

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const METERS_PER_DEGREE = 111320;   // 위도 1도 ≈ 111.32km
const DEFAULT_RADIUS    = 500;      // 기본 반경 500m
const MAX_RADIUS        = 10000;    // 최대 반경 10km
const MAX_RESULTS       = 50;       // /nearby 최대 반환 수

// ─────────────────────────────────────────────
// 하버사인 거리 계산 (미터)
// ─────────────────────────────────────────────
function haversineM(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

// ─────────────────────────────────────────────
// KST 영업시간 파싱 → is_open
// 형식: "HH:MM-HH:MM" 또는 "HH:MM–HH:MM"
// ─────────────────────────────────────────────
function calcIsOpen(businessHours) {
  if (!businessHours) return null;
  const match = String(businessHours).match(
    /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/
  );
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
// 위도도 → 반경 변환 (BUG-C3 수정)
// 파라미터명: userLat/userLng (컬럼명 lat/lng와 구분)
// ─────────────────────────────────────────────
function metersToDegreeLat(meters) {
  return meters / METERS_PER_DEGREE;
}
function metersToDegreeLng(meters, lat) {
  // 경도는 위도에 따라 달라짐
  return meters / (METERS_PER_DEGREE * Math.cos(lat * Math.PI / 180));
}

// ─────────────────────────────────────────────
// Supabase 공통
// ─────────────────────────────────────────────
function sbH(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
async function sbGet(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: sbH(key) });
  if (!res.ok) throw new Error(`SUPABASE_ERROR: ${res.status}`);
  return res.json();
}
async function sbInsert(url, key, table, data) {
  const res = await fetch(`${url}/rest/v1/${table}`, {
    method:  'POST',
    headers: { ...sbH(key), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body:    JSON.stringify(data),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SUPABASE_INSERT_ERROR: ${res.status} ${text}`);
  }
}

// ─────────────────────────────────────────────
// DeepSeek 번역
// ─────────────────────────────────────────────
async function translate(text, fromLang, toLang, apiKey) {
  if (!text || fromLang === toLang || !apiKey) return text;
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model:      'deepseek-v4-flash', // 2026-07-24 레거시 별칭(deepseek-chat) 폐기 대응
        max_tokens: 128,
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
// GET /nearby
// ─────────────────────────────────────────────
async function handleNearby(request, env, corsHeaders) {
  const url = new URL(request.url);

  // BUG-C3: 파라미터명 userLat/userLng — 컬럼명 lat/lng와 명확히 구분
  const userLat  = parseFloat(url.searchParams.get('lat'));
  const userLng  = parseFloat(url.searchParams.get('lng'));
  const radius   = Math.min(
    Number(url.searchParams.get('radius') || DEFAULT_RADIUS),
    MAX_RADIUS
  );
  const type     = url.searchParams.get('type') || null;   // org|institution|null(전체)
  const lang     = url.searchParams.get('lang') || 'ko';
  const limit    = Math.min(Number(url.searchParams.get('limit') || 20), MAX_RESULTS);

  if (isNaN(userLat) || isNaN(userLng))
    return _err(400, 'MISSING_FIELD', 'lat, lng 필수 (숫자)', corsHeaders);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // 위도·경도 범위 계산 (BETWEEN 쿼리용)
    const dLat = metersToDegreeLat(radius);
    const dLng = metersToDegreeLng(radius, userLat);
    const minLat = userLat - dLat;
    const maxLat = userLat + dLat;
    const minLng = userLng - dLng;
    const maxLng = userLng + dLng;

    // Supabase 쿼리 — userLat/userLng 변수명으로 컬럼 lat/lng와 구분
    let path = `user_profiles?is_public=eq.true`
      + `&lat=gte.${minLat}&lat=lte.${maxLat}`
      + `&lng=gte.${minLng}&lng=lte.${maxLng}`
      + `&select=guid,handle,name,entity_type,address,native_lang,lat,lng,extra`
      + `&limit=${limit * 2}`;  // 하버사인 필터 후 limit 적용을 위해 여유분

    if (type) path += `&entity_type=eq.${type}`;

    const rows = await sbGet(SUPA, env.SUPABASE_KEY, path);
    if (!Array.isArray(rows)) return _err(500, 'SUPABASE_ERROR', '응답 오류', corsHeaders);

    // 하버사인 정밀 필터 + 거리 계산
    const withDist = rows
      .filter(r => r.lat && r.lng)
      .map(r => ({
        ...r,
        distance_m: haversineM(userLat, userLng, r.lat, r.lng),
      }))
      .filter(r => r.distance_m <= radius)
      .sort((a, b) => a.distance_m - b.distance_m)
      .slice(0, limit);

    // is_open 판단 + 다국어 번역
    const results = await Promise.all(withDist.map(async r => {
      const businessHours = r.extra?.business_hours || r.extra?.public_hours || null;
      const is_open       = calcIsOpen(businessHours);

      // L09: lang 번역 (native_lang ≠ lang 시)
      let displayName    = r.name;
      let displayAddress = r.address || '';
      if (lang !== 'ko' && lang !== r.native_lang && env.DEEPSEEK_API_KEY) {
        [displayName, displayAddress] = await Promise.all([
          translate(r.name,    r.native_lang || 'ko', lang, env.DEEPSEEK_API_KEY),
          translate(r.address, r.native_lang || 'ko', lang, env.DEEPSEEK_API_KEY),
        ]);
      }

      return {
        guid:          r.guid,
        handle:        r.handle,
        name:          displayName,
        name_original: r.name,
        entity_type:   r.entity_type,
        address:       displayAddress,
        distance_m:    r.distance_m,
        lat:           r.lat,
        lng:           r.lng,
        is_open,
        business_hours: businessHours,
        ai_active:     r.extra?.ai_active || false,
        ksic_code:     r.extra?.ksic_code || null,
      };
    }));

    return new Response(JSON.stringify({ ok: true, count: results.length, results }), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return _err(500, 'NEARBY_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// POST /location — 위치 기록 (consent 필수)
// ─────────────────────────────────────────────
async function handleLocation(request, env, corsHeaders) {
  if (!env.GOPANG_MASTER_KEY)
    return _err(500, 'SERVER_CONFIG_ERROR', 'GOPANG_MASTER_KEY 미등록', corsHeaders);

  // JWT 필수 (익명 기록 금지)
  const authResult = await requireAuth(request, env.GOPANG_MASTER_KEY);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  let body;
  try { body = await request.json(); }
  catch { return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders); }

  const { lat, lng, accuracy, consent } = body;

  // L06: consent 미동의 → 400
  if (!consent)
    return _err(400, 'CONSENT_REQUIRED',
      '위치 기록을 위해 동의(consent:true)가 필요합니다.', corsHeaders);

  if (lat === undefined || lng === undefined)
    return _err(400, 'MISSING_FIELD', 'lat, lng 필수', corsHeaders);

  if (isNaN(Number(lat)) || isNaN(Number(lng)))
    return _err(400, 'INVALID_COORDS', '좌표가 유효하지 않습니다.', corsHeaders);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // L07: location_log INSERT (consent=true 저장)
    await sbInsert(SUPA, env.SUPABASE_KEY, 'location_log', {
      guid:        user.guid,
      lat:         Number(lat),
      lng:         Number(lng),
      accuracy:    accuracy ? Number(accuracy) : null,
      consent:     true,          // 항상 true (거부 시 위에서 400 반환)
      recorded_at: new Date().toISOString(),
    });

    return new Response(JSON.stringify({ ok: true }), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return _err(500, 'LOCATION_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// GET /directions
// ─────────────────────────────────────────────
async function handleDirections(request, env, corsHeaders) {
  const url       = new URL(request.url);
  const fromLat   = parseFloat(url.searchParams.get('from_lat'));
  const fromLng   = parseFloat(url.searchParams.get('from_lng'));
  const toHandle  = url.searchParams.get('to_handle');
  const mode      = url.searchParams.get('mode') || 'WALK';

  if (isNaN(fromLat) || isNaN(fromLng) || !toHandle)
    return _err(400, 'MISSING_FIELD', 'from_lat, from_lng, to_handle 필수', corsHeaders);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // 목적지 좌표 조회
    const profiles = await sbGet(SUPA, env.SUPABASE_KEY,
      `user_profiles?handle=eq.${encodeURIComponent(toHandle)}&select=lat,lng,name`
    );
    if (!Array.isArray(profiles) || profiles.length === 0)
      return _err(404, 'NOT_FOUND', `업체를 찾을 수 없습니다: ${toHandle}`, corsHeaders);

    const { lat: toLat, lng: toLng, name } = profiles[0];
    if (!toLat || !toLng)
      return _err(404, 'NO_LOCATION', '업체 위치 정보가 없습니다.', corsHeaders);

    // L08: KAKAO_MOBILITY_KEY 미등록 → fallback
    if (!env.KAKAO_MOBILITY_KEY) {
      const distanceM = haversineM(fromLat, fromLng, toLat, toLng);
      return new Response(JSON.stringify({
        ok:       true,
        fallback: true,
        lat:      toLat,
        lng:      toLng,
        name,
        distance_m:   distanceM,
        duration_sec: Math.round(distanceM / 67 * 60), // 도보 약 4km/h
        note: 'KAKAO_MOBILITY_KEY 미등록 — 클라이언트에서 딥링크 직접 생성',
      }), {
        status:  200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Kakao Mobility Directions API
    const kakaoRes = await fetch(
      `https://apis-navi.kakaomobility.com/v1/directions`
        + `?origin=${fromLng},${fromLat}`
        + `&destination=${toLng},${toLat}`
        + `&priority=${mode}`,
      { headers: { Authorization: `KakaoAK ${env.KAKAO_MOBILITY_KEY}` } }
    );
    if (!kakaoRes.ok) throw new Error(`KAKAO_MOBILITY_ERROR: ${kakaoRes.status}`);
    const kakaoData = await kakaoRes.json();

    const route = kakaoData.routes?.[0];
    if (!route) throw new Error('KAKAO_NO_ROUTE');

    const { distance, duration } = route.summary;
    const steps = route.sections?.[0]?.roads?.map(r => ({
      name:       r.name,
      distance_m: r.distance,
    })) || [];

    return new Response(JSON.stringify({
      ok:          true,
      fallback:    false,
      distance_m:  distance,
      duration_sec: duration,
      steps,
    }), {
      status:  200,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (e) {
    return _err(500, 'DIRECTIONS_ERROR', e.message, corsHeaders);
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
  // ── Profile 2.0 M07 Location ─────────────────────────────
  if (pathname === '/nearby')
    return handleNearby(request, env, corsHeaders);
  if (pathname === '/location' && request.method === 'POST')
    return handleLocation(request, env, corsHeaders);
  if (pathname === '/directions')
    return handleDirections(request, env, corsHeaders);
*/

export {
  handleNearby, handleLocation, handleDirections,
  haversineM, calcIsOpen,
  metersToDegreeLat, metersToDegreeLng,
  METERS_PER_DEGREE, DEFAULT_RADIUS, MAX_RADIUS,
};
