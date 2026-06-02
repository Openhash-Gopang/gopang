// ═══════════════════════════════════════════════════════════
// gopang-proxy — v4.1
// AI API 프록시 + SSO 인증 통합
// GPT-4o mini Vision + DeepSeek V3 + SameSite=None 쿠키 SSO
// 환경변수: OpenAI, DEEPSEEK_API_KEY, KAKAO_REST_KEY
// v4.1 변경: police.gopang.net CORS 추가, /chat/completions 라우트 추가
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
  'https://police.gopang.net',   // ← v4.1 추가
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
    if (pathname === '/auth/issue')               return handleIssue(request, env, corsHeaders);
    if (pathname === '/auth/verify')              return handleVerify(request, env, corsHeaders);
    if (pathname === '/auth/refresh')             return handleRefresh(request, env, corsHeaders);

    // WebAuthn 지문 라우트
    if (pathname === '/auth/webauthn/challenge')  return handleWAChallenge(request, env, corsHeaders);
    if (pathname === '/auth/webauthn/register')   return handleWARegister(request, env, corsHeaders);
    if (pathname === '/auth/webauthn/verify')     return handleWAVerify(request, env, corsHeaders);

    // PDV 보고서 수신
    if (pathname === '/pdv/report')              return handlePdvReport(request, env, corsHeaders);

    // 하위 서비스 등록·확인
    if (pathname === '/svc/register')            return handleSvcRegister(request, env, corsHeaders);
    if (pathname === '/svc/verify')              return handleSvcVerify(request, env, corsHeaders);

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

    // ── v4.1: OpenAI 호환 표준 라우트 → DeepSeek 프록시 ──
    // webapp.html 등이 /chat/completions (OpenAI 표준 주소)로 호출할 때 처리
    if (pathname === '/chat/completions') {
      return callDeepSeek(bodyText, env, corsHeaders);
    }

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
// WebAuthn 핸들러
// ═══════════════════════════════════════════════════════════

const SUPABASE_URL = 'https://ebbecjfrwaswbdybbgiu.supabase.co';
const WA_RP_ID    = 'gopang.net';
const WA_RP_NAME  = '고팡 (Gopang)';

// ── Supabase 헬퍼 ───────────────────────────────────────────
async function sbFetch(env, path, method = 'GET', body = null) {
  const key = env.SUPABASE_KEY ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';
  const headers = {
    'apikey':        key,
    'Authorization': 'Bearer ' + key,
    'Content-Type':  'application/json',
    'Prefer':        'resolution=merge-duplicates',
  };
  const res  = await fetch(SUPABASE_URL + path, {
    method, headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  return res.ok ? res.json().catch(() => ({})) : null;
}

// ── /auth/webauthn/challenge ────────────────────────────────
async function handleWAChallenge(request, env, corsHeaders) {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const chalB64   = btoa(String.fromCharCode(...challenge))
    .replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');

  const exp     = Math.floor(Date.now() / 1000) + 300;
  const payload = { challenge: chalB64, exp };

  const sigData = `${chalB64}.${exp}`;
  const key     = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.GOPANG_MASTER_KEY || 'gopang-webauthn-secret-v1'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(sigData));
  const sigHex = Array.from(new Uint8Array(sig))
    .map(b => b.toString(16).padStart(2,'0')).join('');

  return new Response(
    JSON.stringify({ challenge: chalB64, exp, sig: sigHex }),
    { status: 200, headers: corsHeaders }
  );
}

// ── 챌린지 서명 검증 ────────────────────────────────────────
async function _verifyChallengeToken(env, chalB64, exp, sig) {
  if (exp < Math.floor(Date.now() / 1000)) return false;
  const sigData = `${chalB64}.${exp}`;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.GOPANG_MASTER_KEY || 'gopang-webauthn-secret-v1'),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
  );
  const sigBytes = Uint8Array.from(sig.match(/.{2}/g).map(h => parseInt(h, 16)));
  return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(sigData));
}

// ── /auth/webauthn/register ─────────────────────────────────
async function handleWARegister(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const body = await request.json().catch(() => null);
  if (!body?.ipv6 || !body?.credentialId || !body?.publicKey) {
    return new Response(
      JSON.stringify({ error: 'ipv6, credentialId, publicKey 필수' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const chalOk = await _verifyChallengeToken(
    env, body.challenge, body.challengeExp, body.challengeSig
  );
  if (!chalOk) {
    return new Response(
      JSON.stringify({ error: '챌린지 만료 또는 위조' }),
      { status: 401, headers: corsHeaders }
    );
  }

  const result = await sbFetch(env, '/rest/v1/webauthn_credentials', 'POST', {
    ipv6:          body.ipv6,
    credential_id: body.credentialId,
    public_key:    body.publicKey,
    counter:       0,
    device_type:   body.deviceType || 'platform',
    aaguid:        body.aaguid || null,
  });

  if (!result) {
    return new Response(
      JSON.stringify({ error: 'Supabase 저장 실패' }),
      { status: 502, headers: corsHeaders }
    );
  }

  return new Response(
    JSON.stringify({ ok: true, ipv6: body.ipv6 }),
    { status: 200, headers: corsHeaders }
  );
}

// ── /auth/webauthn/verify ───────────────────────────────────
async function handleWAVerify(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }
  const body = await request.json().catch(() => null);
  if (!body?.ipv6 || !body?.credentialId) {
    return new Response(
      JSON.stringify({ error: 'ipv6, credentialId 필수' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const rows = await sbFetch(
    env,
    `/rest/v1/webauthn_credentials?ipv6=eq.${encodeURIComponent(body.ipv6)}&credential_id=eq.${encodeURIComponent(body.credentialId)}&select=public_key,counter`,
    'GET'
  );

  if (!rows?.length) {
    return new Response(
      JSON.stringify({ valid: false, reason: 'credential_not_found' }),
      { status: 404, headers: corsHeaders }
    );
  }

  const cred = rows[0];

  if (body.counter !== undefined && body.counter <= cred.counter) {
    return new Response(
      JSON.stringify({ valid: false, reason: 'counter_replay' }),
      { status: 401, headers: corsHeaders }
    );
  }

  if (body.counter !== undefined) {
    await sbFetch(
      env,
      `/rest/v1/webauthn_credentials?credential_id=eq.${encodeURIComponent(body.credentialId)}`,
      'PATCH',
      { counter: body.counter, last_used_at: new Date().toISOString() }
    );
  }

  const token  = buildToken(body.ipv6, 'L2', '*');
  const cookie = buildCookie(token);

  return new Response(
    JSON.stringify({ valid: true, ipv6: body.ipv6, level: 'L2' }),
    { status: 200, headers: { ...corsHeaders, 'Set-Cookie': cookie } }
  );
}

// ═══════════════════════════════════════════════════════════
// 하위 서비스 등록 화이트리스트
// ═══════════════════════════════════════════════════════════

const REGISTERED_SERVICES = {
  // Level 3 — 공식 파트너 (전체 기능)
  'klaw':      { level: 3, domain: 'klaw.gopang.net',      minAuth: 'L0', pdv: true  },
  'market':    { level: 3, domain: 'market.gopang.net',    minAuth: 'L0', pdv: true  },
  'school':    { level: 3, domain: 'school.gopang.net',    minAuth: 'L0', pdv: true  },
  'security':  { level: 3, domain: 'security.gopang.net',  minAuth: 'L1', pdv: true  },
  'health':    { level: 3, domain: 'health.gopang.net',    minAuth: 'L1', pdv: true  },
  'tax':       { level: 3, domain: 'tax.gopang.net',       minAuth: 'L0', pdv: true  },
  'gdc':       { level: 3, domain: 'gdc.gopang.net',       minAuth: 'L1', pdv: true  },
  'public':    { level: 3, domain: 'public.gopang.net',    minAuth: 'L0', pdv: true  },
  'democracy': { level: 3, domain: 'democracy.gopang.net', minAuth: 'L1', pdv: true  },
  '911':       { level: 3, domain: '911.gopang.net',       minAuth: 'L0', pdv: true  },
  'police':    { level: 3, domain: 'police.gopang.net',    minAuth: 'L1', pdv: true  },
  'insurance': { level: 3, domain: 'insurance.gopang.net', minAuth: 'L1', pdv: true  },
  // Level 2 — 외부 도메인 파트너
  'fiil':      { level: 2, domain: 'fiil.kr',              minAuth: 'L0', pdv: true  },
  'klaw-ext':  { level: 2, domain: 'klaw.openhash.kr',     minAuth: 'L0', pdv: false },
};

function _getSvcRegistration(origin, svcId) {
  const svc = REGISTERED_SERVICES[svcId];
  if (svc && origin.includes(svc.domain)) return { ...svc, svcId };
  if (/^https:\/\/[a-z0-9-]+\.gopang\.net$/.test(origin)) {
    return { level: 1, domain: origin, minAuth: 'L0', pdv: false, svcId };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// /pdv/report — PDV 보고서 수신·기록
// ═══════════════════════════════════════════════════════════

async function handlePdvReport(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const origin = request.headers.get('Origin') || '';
  const report  = await request.json().catch(() => null);

  if (!report?.report) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SCHEMA_ERROR', detail: 'report.report 필드 필수' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const r      = report.report;
  const svcId  = r.svc || request.headers.get('X-Gopang-Svc') || 'unknown';
  const ipv6   = r.who?.ipv6;

  const reg = _getSvcRegistration(origin, svcId);
  if (!reg) {
    return new Response(
      JSON.stringify({ ok: false, error: 'SERVICE_NOT_REGISTERED',
        detail: `${svcId} (${origin}) 은 등록된 서비스가 아닙니다.` }),
      { status: 403, headers: corsHeaders }
    );
  }
  if (reg.level < 2 && !reg.pdv) {
    return new Response(
      JSON.stringify({ ok: false, error: 'PDV_NOT_ALLOWED',
        detail: 'Level 1 서비스는 PDV 보고서 전송 권한이 없습니다.' }),
      { status: 403, headers: corsHeaders }
    );
  }

  if (!ipv6) {
    return new Response(
      JSON.stringify({ ok: false, error: 'USER_NOT_FOUND', detail: 'who.ipv6 필수' }),
      { status: 404, headers: corsHeaders }
    );
  }

  const reportId = r.id || `RPT-${svcId}-${Date.now()}-auto`;

  const summary6w = {
    who:   `${r.who?.role || 'user'} (${ipv6.slice(0,20)}...)`,
    when:  `${(r.when?.period_start||'').slice(0,10)} ~ ${(r.when?.period_end||'').slice(0,10)}`,
    where: r.where?.svc_url || `https://${svcId}.gopang.net`,
    what:  r.what?.summary  || '(요약 없음)',
    how:   r.how?.method    || '자동 집계',
    why:   r.why?.goal      || '(목표 미지정)',
  };

  const pdvId  = `PDV-${ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;
  const _pdvKey = env.SUPABASE_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImViYmVjamZyd2Fzd2JkeWJiZ2l1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk1NjE5ODQsImV4cCI6MjA5NTEzNzk4NH0.H2ahQKtWdSke04Pdi3hDY86pdTx7UUKPUpQMlS_zciA';
  const _pdvFetch = await fetch(SUPABASE_URL + '/rest/v1/pdv_log', {
    method: 'POST',
    headers: {
      'apikey': _pdvKey, 'Authorization': 'Bearer ' + _pdvKey,
      'Content-Type': 'application/json', 'Prefer': 'return=minimal',
    },
    body: JSON.stringify({
      id:         pdvId,
      guid:       ipv6,
      source:     svcId,
      type:       r.type          || 'report',
      report_id:  reportId,
      summary:    r.what?.summary || '',
      summary_6w: JSON.stringify(summary6w),
      risk_level: r.analysis?.risk_level || 'low',
      period:     r.when ?? r.period ?? null,
      raw_hash:   r.content_hash  || null,
      created_at: new Date().toISOString(),
    }),
  });
  const pdvRes = _pdvFetch.ok ? {} : null;

  if (!pdvRes) {
    return new Response(
      JSON.stringify({ ok: false, error: 'PDV_LOCKED', retry: true, retry_after: 60 }),
      { status: 503, headers: corsHeaders }
    );
  }

  const recipients = (r.who?.recipients || []).filter(x => x !== 'gopang-pdv');
  return new Response(
    JSON.stringify({
      ok:                   true,
      report_id:            reportId,
      pdv_entry:            pdvId,
      recorded_at:          new Date().toISOString(),
      recipients_notified:  recipients,
      svc_level:            reg.level,
      message:              `PDV 기록 완료. ${svcId} (Level ${reg.level})`,
    }),
    { status: 200, headers: corsHeaders }
  );
}

// ═══════════════════════════════════════════════════════════
// /svc/register — 하위 서비스 등록 신청
// ═══════════════════════════════════════════════════════════

async function handleSvcRegister(request, env, corsHeaders) {
  if (request.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405 });
  }

  const body = await request.json().catch(() => null);
  if (!body?.svc_id || !body?.domain || !body?.operator_ipv6) {
    return new Response(
      JSON.stringify({ ok: false, error: 'svc_id, domain, operator_ipv6 필수' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const { svc_id, domain, description, min_auth, operator_ipv6 } = body;
  const isGopangSub = /^[a-z0-9-]+\.gopang\.net$/.test(domain);
  const auto_level  = isGopangSub ? 1 : 0;

  const saved = await sbFetch(env, '/rest/v1/svc_registry', 'POST', {
    svc_id,
    domain,
    description:    description || '',
    operator_ipv6:  operator_ipv6,
    min_auth:       min_auth || 'L0',
    trust_level:    auto_level,
    status:         isGopangSub ? 'auto_approved' : 'pending',
    registered_at:  new Date().toISOString(),
  });

  return new Response(
    JSON.stringify({
      ok:          true,
      svc_id,
      domain,
      trust_level: auto_level,
      status:      isGopangSub ? 'auto_approved' : 'pending_review',
      message:     isGopangSub
        ? `*.gopang.net 서브도메인으로 자동 승인됐습니다. (Level 1)`
        : `등록 신청이 접수됐습니다. AI City Inc. 검토 후 승인됩니다.`,
    }),
    { status: 200, headers: corsHeaders }
  );
}

// ═══════════════════════════════════════════════════════════
// /svc/verify — 서비스 등록 상태 확인
// ═══════════════════════════════════════════════════════════

async function handleSvcVerify(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const svcId  = url.searchParams.get('svc_id');
  const origin = request.headers.get('Origin') || '';

  if (!svcId) {
    return new Response(
      JSON.stringify({ ok: false, error: 'svc_id 파라미터 필수' }),
      { status: 400, headers: corsHeaders }
    );
  }

  const reg = _getSvcRegistration(origin, svcId);
  if (!reg) {
    return new Response(
      JSON.stringify({
        ok:          false,
        registered:  false,
        svc_id:      svcId,
        message:     '등록되지 않은 서비스입니다.',
      }),
      { status: 200, headers: corsHeaders }
    );
  }

  return new Response(
    JSON.stringify({
      ok:          true,
      registered:  true,
      svc_id:      svcId,
      trust_level: reg.level,
      pdv_allowed: reg.pdv,
      min_auth:    reg.minAuth,
      message:     `등록된 서비스 (Level ${reg.level})`,
    }),
    { status: 200, headers: corsHeaders }
  );
}

// ═══════════════════════════════════════════════════════════
// /geocode — 카카오 역지오코딩
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// Gemini 형식 → GPT-4o mini
// ═══════════════════════════════════════════════════════════

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

// ═══════════════════════════════════════════════════════════
// /deepseek + /chat/completions 공통 핸들러
// ═══════════════════════════════════════════════════════════

async function callDeepSeek(bodyText, env, corsHeaders, fallbackFrom = null) {
  try {
    // 요청 본문에서 stream 여부 확인
    let isStream = false;
    try { isStream = !!JSON.parse(bodyText)?.stream; } catch {}

    const res = await fetch(DEEPSEEK_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}`,
      },
      body: bodyText,
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg;
      try { errMsg = JSON.parse(errText)?.error?.message; } catch {}
      return new Response(
        JSON.stringify({ error: errMsg || `HTTP ${res.status}` }),
        { status: res.status, headers: corsHeaders }
      );
    }

    // ── 스트리밍 응답: 그대로 패스스루 ──────────────────────
    if (isStream) {
      return new Response(res.body, {
        status: 200,
        headers: {
          ...corsHeaders,
          'Content-Type':      'text/event-stream',
          'Cache-Control':     'no-cache',
          'X-Accel-Buffering': 'no',
        },
      });
    }

    // ── 일반 응답: JSON 파싱 ─────────────────────────────────
    const data = await res.json();

    if (fallbackFrom) {
      const text = data.choices?.[0]?.message?.content || '{}';
      return new Response(JSON.stringify({
        candidates: [{
          content: { parts: [{ text }], role: 'model' },
          finishReason: 'STOP',
        }],
        _provider:      'deepseek-fallback',
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
