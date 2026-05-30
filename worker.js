// ═══════════════════════════════════════════════════════════
// gopang-proxy — v4.0
// AI API 프록시 + SSO 인증 통합
// GPT-4o mini Vision + DeepSeek V3 + SameSite=None 쿠키 SSO
// 환경변수: OpenAI, DEEPSEEK_API_KEY, KAKAO_REST_KEY
// ═══════════════════════════════════════════════════════════

const ALLOWED_ORIGINS = [
  'https://gopang.net',
  'https://www.gopang.net',
  'https://klaw.gopang.net',
  'https://market.gopang.net',
  'https://tax.gopang.net',
  'https://gdc.gopang.net',
  'https://health.gopang.net',
  'https://school.gopang.net',
  'https://public.gopang.net',
  'https://security.gopang.net',
  'https://democracy.gopang.net',
  'https://fiil.kr',
  'https://openhash.kr',
  'https://nounweb.github.io',
  'http://localhost',
  'http://127.0.0.1',
];

const OPENAI_URL   = 'https://api.openai.com/v1/chat/completions';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const KAKAO_BASE   = 'https://dapi.kakao.com/v2/local/geo/coord2address.json';
const OPENAI_MODEL = 'gpt-4o-mini';

// ── CORS origin 결정 ────────────────────────────────────────
function getCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return origin;
  if (origin === '') return '';
  return null;   // 차단
}

// ── CORS 헤더 빌더 ──────────────────────────────────────────
function buildCorsHeaders(corsOrigin, extra = {}) {
  return {
    'Content-Type':                     'application/json',
    'Access-Control-Allow-Origin':      corsOrigin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type',
    ...extra,
  };
}

// ═══════════════════════════════════════════════════════════
// 단일 export default (중복 제거)
// ═══════════════════════════════════════════════════════════
export default {
  async fetch(request, env) {
    const corsOrigin = getCorsOrigin(request);

    // ── CORS preflight ───────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':      corsOrigin ?? 'null',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods':     'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers':     'Content-Type',
          'Access-Control-Max-Age':           '86400',
        },
      });
    }

    // ── 도메인 검증 ──────────────────────────────────────
    if (corsOrigin === null) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', origin: request.headers.get('Origin') }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const corsHeaders = buildCorsHeaders(corsOrigin);
    const url         = new URL(request.url);
    const pathname    = url.pathname;

    // ── 라우팅 ───────────────────────────────────────────

    // SSO 인증 라우트
    if (pathname === '/auth/issue')   return handleIssue(request, env, corsHeaders);
    if (pathname === '/auth/verify')  return handleVerify(request, env, corsHeaders);
    if (pathname === '/auth/refresh') return handleRefresh(request, env, corsHeaders);

    // 카카오 역지오코딩
    if (pathname.startsWith('/geocode')) {
      return handleGeocode(url, env, corsHeaders);
    }

    // POST 전용 (이하)
    if (request.method !== 'POST') {
      return new Response(
        JSON.stringify({ error: 'Method Not Allowed' }),
        { status: 405, headers: corsHeaders }
      );
    }

    const bodyText = await request.text();

    // DeepSeek 직접 호출
    if (pathname.startsWith('/deepseek')) {
      return callDeepSeek(bodyText, env, corsHeaders);
    }

    // Gemini 형식 → GPT-4o mini 변환 호출
    if (pathname.startsWith('/gemini/')) {
      return callOpenAIFromGeminiBody(bodyText, env, corsHeaders);
    }

    return new Response(
      JSON.stringify({ error: 'Not Found', path: pathname }),
      { status: 404, headers: corsHeaders }
    );
  },
};

// ═══════════════════════════════════════════════════════════
// SSO 핸들러
// ═══════════════════════════════════════════════════════════

// ── 쿠키 문자열 생성 ────────────────────────────────────────
function buildCookie(token) {
  return [
    `gopang_token=${token}`,
    'Path=/',
    'Domain=.gopang.net',   // 모든 서브도메인 공유
    'Max-Age=3600',
    'SameSite=None',        // iframe 서드파티 전송 허용
    'Secure',               // HTTPS 전용
    'HttpOnly',             // JS 접근 차단 (XSS 방어)
  ].join('; ');
}

// ── 쿠키 파서 ────────────────────────────────────────────────
function parseCookie(header, name) {
  const match = header.match(
    new RegExp(`(?:^|;)\\s*${name}=([^;]+)`)
  );
  return match ? decodeURIComponent(match[1]) : null;
}

// ── 토큰 생성 ────────────────────────────────────────────────
function buildToken(ipv6, level, svc) {
  const now     = Math.floor(Date.now() / 1000);
  const payload = { ipv6, level, svc, iat: now, exp: now + 3600 };
  return btoa(JSON.stringify(payload))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── 토큰 파싱 + 만료 검증 ───────────────────────────────────
function parseToken(token) {
  try {
    const padded  = token.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '=='.slice((padded.length % 4) || 4)));
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

// ── /auth/issue ─────────────────────────────────────────────
async function handleIssue(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.ipv6) {
    return new Response(
      JSON.stringify({ error: 'ipv6 필수' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const { ipv6, level = 'L0', svc = '*' } = body;

  // Phase 1: 구조 확인만
  // Phase 2: env.GOPANG_MASTER_KEY 로 HMAC 재검증 예정
  const token  = buildToken(ipv6, level, svc);
  const cookie = buildCookie(token);

  return new Response(
    JSON.stringify({ ok: true, ipv6, level }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Set-Cookie': cookie },
    }
  );
}

// ── /auth/verify ────────────────────────────────────────────
async function handleVerify(request, env, corsHeaders) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const raw          = parseCookie(cookieHeader, 'gopang_token');

  if (!raw) {
    return new Response(
      JSON.stringify({ valid: false, reason: 'no_token' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const payload = parseToken(raw);
  if (!payload) {
    return new Response(
      JSON.stringify({ valid: false, reason: 'expired_or_invalid' }),
      { status: 401, headers: corsHeaders }
    );
  }

  return new Response(
    JSON.stringify({ valid: true, ipv6: payload.ipv6,
                     level: payload.level, svc: payload.svc,
                     exp: payload.exp }),
    { status: 200, headers: corsHeaders }
  );
}

// ── /auth/refresh ───────────────────────────────────────────
async function handleRefresh(request, env, corsHeaders) {
  const cookieHeader = request.headers.get('Cookie') || '';
  const raw          = parseCookie(cookieHeader, 'gopang_token');

  if (!raw) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'no_token' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const payload = parseToken(raw);
  if (!payload) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'expired_or_invalid' }),
      { status: 401, headers: corsHeaders }
    );
  }

  // 만료 30분 이내일 때만 갱신 (그 이전엔 갱신 불필요)
  const remaining = payload.exp - Math.floor(Date.now() / 1000);
  if (remaining > 1800) {
    return new Response(
      JSON.stringify({ ok: false, reason: 'not_yet', remaining }),
      { status: 200, headers: corsHeaders }
    );
  }

  const newToken = buildToken(payload.ipv6, payload.level, payload.svc);
  const cookie   = buildCookie(newToken);

  return new Response(
    JSON.stringify({ ok: true }),
    {
      status: 200,
      headers: { ...corsHeaders, 'Set-Cookie': cookie },
    }
  );
}

// ═══════════════════════════════════════════════════════════
// 기존 핸들러 (변경 없음)
// ═══════════════════════════════════════════════════════════

// ── /geocode ────────────────────────────────────────────────
async function handleGeocode(url, env, corsHeaders) {
  const lat = url.searchParams.get('lat');
  const lng = url.searchParams.get('lng');
  if (!lat || !lng) {
    return new Response(
      JSON.stringify({ error: 'lat, lng required' }),
      { status: 400, headers: corsHeaders }
    );
  }
  try {
    const res  = await fetch(
      `${KAKAO_BASE}?x=${lng}&y=${lat}&input_coord=WGS84`,
      { headers: { 'Authorization': `KakaoAK ${env.KAKAO_REST_KEY}` } }
    );
    const data = await res.json();
    return new Response(JSON.stringify(data), { headers: corsHeaders });
  } catch(e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }
}

// ── Gemini 형식 → GPT-4o mini ───────────────────────────────
async function callOpenAIFromGeminiBody(bodyText, env, corsHeaders) {
  const apiKey = env.OpenAI;
  if (!apiKey) {
    return new Response(
      JSON.stringify({ error: { message: 'OpenAI key not configured.' } }),
      { status: 500, headers: corsHeaders }
    );
  }

  let geminiBody;
  try { geminiBody = JSON.parse(bodyText); }
  catch {
    return new Response(
      JSON.stringify({ error: 'Invalid JSON body' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const systemPrompt = geminiBody.system_instruction?.parts?.[0]?.text || '';
  const parts        = geminiBody.contents?.[0]?.parts || [];
  const textPart     = parts.find(p => p.text)?.text || '';
  const imagePart    = parts.find(p => p.inline_data);
  const maxTokens    = geminiBody.generationConfig?.maxOutputTokens || 1500;

  const messages = [];
  if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });

  if (imagePart?.inline_data) {
    messages.push({ role: 'user', content: [
      { type: 'image_url', image_url: {
        url: `data:${imagePart.inline_data.mime_type};base64,${imagePart.inline_data.data}`
      }},
      { type: 'text', text: textPart || '이미지를 분석하여 JSON으로만 출력하라.' },
    ]});
  } else {
    messages.push({ role: 'user', content: textPart });
  }

  try {
    console.log(`[OpenAI] ${OPENAI_MODEL} 호출...`);
    const res  = await fetch(OPENAI_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:       OPENAI_MODEL,
        messages,
        max_tokens:  maxTokens,
        temperature: geminiBody.generationConfig?.temperature ?? 0.1,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error?.message || `HTTP ${res.status}`);

    const text = data.choices?.[0]?.message?.content || '{}';
    console.log('[OpenAI] 성공');

    return new Response(JSON.stringify({
      candidates: [{
        content: { parts: [{ text }], role: 'model' },
        finishReason: 'STOP',
      }],
      _provider: 'openai',
      _model:    OPENAI_MODEL,
    }), { headers: corsHeaders });

  } catch(e) {
    console.error('[OpenAI] 실패:', e.message, '→ DeepSeek fallback');
    const fbBody = JSON.stringify({
      model:       'deepseek-chat',
      messages,
      max_tokens:  maxTokens,
      temperature: 0.1,
      stream:      false,
    });
    return callDeepSeek(fbBody, env, corsHeaders, e.message);
  }
}

// ── /deepseek ────────────────────────────────────────────────
async function callDeepSeek(bodyText, env, corsHeaders, fallbackFrom = null) {
  try {
    const res  = await fetch(DEEPSEEK_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: bodyText,
    });
    const data = await res.json();

    if (!res.ok) {
      return new Response(
        JSON.stringify({ error: data.error?.message || `HTTP ${res.status}` }),
        { status: res.status, headers: corsHeaders }
      );
    }

    if (fallbackFrom) {
      const text = data.choices?.[0]?.message?.content || '{}';
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text }], role: 'model' },
          finishReason: 'STOP',
        }],
        _provider:     'deepseek-fallback',
        _fallback_from: fallbackFrom,
      }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify(data), { headers: corsHeaders });

  } catch(e) {
    return new Response(
      JSON.stringify({ error: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }
}
