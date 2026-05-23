// ══════════════════════════════════════════════════════════════
// 고팡 DeepSeek API 프록시 — Cloudflare Worker v1.1
// URL: https://gopang-proxy.tensor-city.workers.dev/
//
// 보안 구조:
//   클라이언트(gopang.net) → 이 Worker → DeepSeek API
//   API 키는 Cloudflare Dashboard > Workers > Settings > Variables에 저장
//   DEEPSEEK_API_KEY = sk-xxxx...
//
// v1.0: 초판 (기본 프록시)
// v1.1: 환경변수 API 키, OPTIONS CORS 처리, 에러 핸들링 강화
// ══════════════════════════════════════════════════════════════

export default {
  async fetch(request, env) {

    // ── CORS Preflight (OPTIONS) ─────────────────────────────
    // 브라우저가 POST 전에 OPTIONS를 먼저 보냄 — 반드시 허용해야 함
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // ── POST만 허용 ──────────────────────────────────────────
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', {
        status: 405,
        headers: corsHeaders(),
      });
    }

    // ── API 키 — Cloudflare 환경변수에서 로드 ───────────────
    // Dashboard → Workers & Pages → gopang-proxy → Settings → Variables
    // 변수명: DEEPSEEK_API_KEY
    const apiKey = env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      return new Response(JSON.stringify({
        error: { message: 'API key not configured in Worker environment.' }
      }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // ── 요청 본문 전달 ───────────────────────────────────────
    let body;
    try {
      body = await request.text();
    } catch {
      return new Response('Bad Request', { status: 400, headers: corsHeaders() });
    }

    // ── DeepSeek API 호출 ────────────────────────────────────
    // 클라이언트가 보낸 Authorization은 무시하고
    // 항상 Cloudflare 환경변수의 키를 사용 (보안)
    let dsResp;
    try {
      dsResp = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method:  'POST',
        headers: {
          'Content-Type':  'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body,
      });
    } catch (e) {
      return new Response(JSON.stringify({
        error: { message: `DeepSeek API 연결 실패: ${e.message}` }
      }), {
        status: 502,
        headers: { 'Content-Type': 'application/json', ...corsHeaders() },
      });
    }

    // ── 응답 그대로 클라이언트에 전달 (스트리밍 포함) ────────
    return new Response(dsResp.body, {
      status:  dsResp.status,
      headers: {
        'Content-Type':  dsResp.headers.get('Content-Type') || 'application/json',
        ...corsHeaders(),
      },
    });
  },
};

// ── CORS 헤더 ────────────────────────────────────────────────
// gopang.net에서만 허용하려면 'https://gopang.net'으로 변경
function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age':       '86400',
  };
}
