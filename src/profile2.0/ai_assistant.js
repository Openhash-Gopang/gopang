// ============================================================
// ai_assistant.js — M05 AI 비서 모듈 (Cloudflare Worker 핸들러)
// 저장위치: gopang/src/profile2.0/ai_assistant.js
// 의존: src/auth/auth.js (requireAuth, verifyJWT)
// ============================================================

// ─────────────────────────────────────────────
// 상수
// ─────────────────────────────────────────────
const ESCALATION_KEYWORDS = [
  // 한국어
  '사람 연결', '사람이랑', '직원', '상담원', '연결해줘', '사람과',
  // 중국어
  '人工', '转人工', '真人', '客服',
  // 영어
  'human', 'person', 'agent', 'staff', 'real person', 'talk to someone',
  // 일본어
  '人間', 'スタッフ', '担当者',
  // 베트남어
  'người thật', 'nhân viên',
  // 태국어
  'คนจริง', 'พนักงาน',
];

const FAIL_WINDOW_MS   = 10 * 60 * 1000; // 10분
const FAIL_THRESHOLD   = 3;              // 실패 3회 → 에스컬레이션
const LLM_TIMEOUT_MS   = 15000;          // LLM 응답 15초 타임아웃

// 지원 언어 목록
const SUPPORTED_LANGS = ['ko', 'zh', 'en', 'ja', 'vi', 'th'];

// ─────────────────────────────────────────────
// AES-256-GCM 암호화 / 복호화
// ─────────────────────────────────────────────
async function aesEncrypt(plaintext, rawKey) {
  const keyBuf  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rawKey.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv      = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher  = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyBuf, encoded);
  // iv(12) + ciphertext → base64
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), 12);
  return btoa(String.fromCharCode(...combined));
}

async function aesDecrypt(b64, rawKey) {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv       = combined.slice(0, 12);
  const cipher   = combined.slice(12);
  const keyBuf   = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rawKey.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyBuf, cipher);
  return new TextDecoder().decode(plain);
}

// ─────────────────────────────────────────────
// 에스컬레이션 키워드 감지
// ─────────────────────────────────────────────
function detectEscalationKeyword(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

// ─────────────────────────────────────────────
// 최근 실패 카운트 (ai_sessions.messages JSONB)
// ─────────────────────────────────────────────
function countRecentFails(messages) {
  const now    = Date.now();
  const cutoff = now - FAIL_WINDOW_MS;
  return messages.filter(m => m.type === 'fail' && m.ts > cutoff).length;
}

// ─────────────────────────────────────────────
// 시스템 프롬프트 구성 (할루시네이션 방지)
// ─────────────────────────────────────────────
function buildSystemPrompt(profile, distanceM) {
  const menu    = profile?.extra?.menu || [];
  const hours   = profile?.extra?.business_hours || '정보 없음';
  const name    = profile?.name || '업체';
  const address = profile?.address || '';

  const menuText = menu.length > 0
    ? menu.map(m => `- ${m.name}: ₮${m.price?.toLocaleString() || '?'} ${m.description || ''}`).join('\n')
    : '(메뉴 정보 없음)';

  const locationText = distanceM !== null
    ? `현재 방문자와의 거리: 약 ${distanceM}m (도보 약 ${Math.round(distanceM / 67)}분)`
    : '';

  return `당신은 "${name}"의 AI 비서입니다.
주소: ${address}
영업시간: ${hours}
${locationText}

[메뉴 목록]
${menuText}

[필수 규칙]
1. 메뉴, 영업시간, 위치 외 정보는 "죄송합니다, 해당 정보는 제공하기 어렵습니다"라고 답하세요.
2. 가격 흥정, 환불, 예약 외 업무는 사람 연결을 안내하세요.
3. 답변은 간결하게 2~3문장 이내로 유지하세요.
4. 항상 친절하고 정중한 어조를 유지하세요.`;
}

// ─────────────────────────────────────────────
// LLM 호출 (provider별 분기)
// ─────────────────────────────────────────────
async function callLLM({ provider, apiKey, model, systemPrompt, userMessage }) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    let url, headers, body;

    if (provider === 'deepseek') {
      url     = 'https://api.deepseek.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      body    = JSON.stringify({
        model:      model || 'deepseek-v4-flash', // 2026-07-24 레거시 별칭(deepseek-chat) 폐기 대응
        max_tokens: 512,
        messages:   [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
      });
    } else if (provider === 'anthropic') {
      url     = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type':      'application/json',
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model:      model || 'claude-sonnet-4-6',
        max_tokens: 512,
        system:     systemPrompt,
        messages:   [{ role: 'user', content: userMessage }],
      });
    } else if (provider === 'openai') {
      url     = 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      body    = JSON.stringify({
        model:      model || 'gpt-4o-mini',
        max_tokens: 512,
        messages:   [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userMessage },
        ],
      });
    } else {
      throw new Error(`UNSUPPORTED_PROVIDER: ${provider}`);
    }

    const res  = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`LLM_HTTP_${res.status}`);
    const data = await res.json();

    // 응답 추출 (provider별 구조 다름)
    if (provider === 'anthropic') {
      return data.content?.[0]?.text || '';
    }
    return data.choices?.[0]?.message?.content || '';

  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('LLM_TIMEOUT');
    throw e;
  }
}

// ─────────────────────────────────────────────
// DeepSeek 번역
// ─────────────────────────────────────────────
async function translate(text, fromLang, toLang, apiKey) {
  if (!text || fromLang === toLang) return text;
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body:    JSON.stringify({
        model:      'deepseek-v4-flash', // 2026-07-24 레거시 별칭(deepseek-chat) 폐기 대응
        max_tokens: 256,
        messages: [{
          role:    'user',
          content: `Translate from ${fromLang} to ${toLang}. Return only the translation, no explanation.\n\n${text}`,
        }],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  } catch { return text; }
}

// ─────────────────────────────────────────────
// Supabase 공통
// ─────────────────────────────────────────────
function sbH(key) {
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
}
async function sbGet(url, key, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: sbH(key) });
  return res.json();
}
async function sbPatch(url, key, path, data) {
  await fetch(`${url}/rest/v1/${path}`, {
    method: 'PATCH', headers: { ...sbH(key), Prefer: 'return=minimal' },
    body: JSON.stringify(data),
  });
}
async function sbInsert(url, key, table, data) {
  await fetch(`${url}/rest/v1/${table}`, {
    method: 'POST',
    headers: { ...sbH(key), Prefer: 'resolution=ignore-duplicates,return=minimal' },
    body: JSON.stringify(data),
  });
}

// ─────────────────────────────────────────────
// POST /ai-chat
// ─────────────────────────────────────────────
async function handleAiChat(request, env, corsHeaders) {
  if (!env.GOPANG_MASTER_KEY)
    return _err(500, 'SERVER_CONFIG_ERROR', 'GOPANG_MASTER_KEY 미등록', corsHeaders);

  // JWT 검증 (M01)
  const authResult = await requireAuth(request, env.GOPANG_MASTER_KEY);
  if (authResult instanceof Response) return authResult;
  const caller = authResult;

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { session_id, message, caller_lang = 'ko', target_guid, distance_m = null } = body;
  if (!session_id || !message || !target_guid)
    return _err(400, 'MISSING_FIELD', 'session_id, message, target_guid 필수', corsHeaders);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;

  try {
    // ai_sessions 조회 (없으면 생성)
    let sessions = await sbGet(SUPA, env.SUPABASE_KEY,
      `ai_sessions?id=eq.${session_id}&select=*`);
    let session  = sessions?.[0];

    if (!session) {
      // 신규 세션 생성
      await sbInsert(SUPA, env.SUPABASE_KEY, 'ai_sessions', {
        id: session_id, caller_guid: caller.guid, caller_lang,
        target_guid, mode: 'ai', messages: [], is_active: true,
        created_at: new Date().toISOString(),
      });
      session = { mode: 'ai', messages: [] };
    }

    const sessionMessages = Array.isArray(session.messages) ? session.messages : [];

    // ── 에스컬레이션 조건 확인 ──────────────────
    // AI03: 최근 10분 내 실패 ≥ 3
    const failCount = countRecentFails(sessionMessages);
    // AI04: 에스컬레이션 키워드 감지
    const hasKeyword = detectEscalationKeyword(message);

    if (session.mode === 'escalated' || failCount >= FAIL_THRESHOLD || hasKeyword) {
      // 에스컬레이션 처리
      await sbPatch(SUPA, env.SUPABASE_KEY,
        `ai_sessions?id=eq.${session_id}`,
        { mode: 'escalated', escalated_at: new Date().toISOString() });

      // Supabase Realtime 브로드캐스트 (업체 기기 알림)
      // → Realtime channel: ai_sessions table UPDATE로 자동 트리거 (REPLICA IDENTITY FULL)

      return new Response(JSON.stringify({
        ok: true, mode: 'escalated',
        message: '사람 상담원에게 연결합니다. 잠시만 기다려주세요.',
        reason:  hasKeyword ? 'keyword' : failCount >= FAIL_THRESHOLD ? 'fail_count' : 'already_escalated',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── user_llm_keys 조회 ──────────────────────
    const llmRows = await sbGet(SUPA, env.SUPABASE_KEY,
      `user_llm_keys?guid=eq.${encodeURIComponent(target_guid)}&select=*`);
    const llmKey  = llmRows?.[0];

    // AI02: ai_active=false → human 모드
    if (!llmKey || !llmKey.ai_active) {
      // messages 테이블에 INSERT (사람 전달용)
      await sbInsert(SUPA, env.SUPABASE_KEY, 'messages', {
        session_id,
        sender_guid:        caller.guid,
        receiver_guid:      target_guid,
        content_original:   message,
        content_translated: await translate(message, caller_lang, 'ko', env.DEEPSEEK_API_KEY),
        lang_from:          caller_lang,
        lang_to:            'ko',
        content_type:       'text',
        created_at:         new Date().toISOString(),
      });
      await sbPatch(SUPA, env.SUPABASE_KEY,
        `ai_sessions?id=eq.${session_id}`, { mode: 'human' });

      return new Response(JSON.stringify({
        ok: true, mode: 'human',
        message: '업체에 메시지를 전달했습니다. 곧 답변이 도착합니다.',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    // ── AI 응답 생성 ────────────────────────────
    // 1. 메시지 → 한국어 번역
    const msgKo = caller_lang === 'ko'
      ? message
      : await translate(message, caller_lang, 'ko', env.DEEPSEEK_API_KEY);

    // 2. 업체 프로필 조회 (시스템 프롬프트용)
    const profiles = await sbGet(SUPA, env.SUPABASE_KEY,
      `user_profiles?guid=eq.${encodeURIComponent(target_guid)}&select=name,address,extra`);
    const profile  = profiles?.[0] || {};

    // 3. 시스템 프롬프트 구성 (할루시네이션 방지 — AI05)
    const systemPrompt = buildSystemPrompt(profile, distance_m);

    // 4. LLM API 키 복호화
    let apiKey;
    try {
      apiKey = await aesDecrypt(llmKey.api_key_enc, env.AES_ENCRYPTION_KEY);
    } catch {
      return _err(500, 'DECRYPT_ERROR', 'LLM API 키 복호화 실패', corsHeaders);
    }

    // 5. LLM 호출
    let responseKo;
    try {
      responseKo = await callLLM({
        provider:     llmKey.provider,
        apiKey,
        model:        llmKey.model,
        systemPrompt,
        userMessage:  msgKo,
      });
    } catch (e) {
      // 실패 이벤트 기록 (AI03 카운터)
      const updated = [
        ...sessionMessages,
        { type: 'fail', ts: Date.now(), reason: e.message },
      ];
      await sbPatch(SUPA, env.SUPABASE_KEY,
        `ai_sessions?id=eq.${session_id}`,
        { messages: updated, updated_at: new Date().toISOString() });

      return _err(502, 'LLM_ERROR', `AI 응답 실패: ${e.message}`, corsHeaders);
    }

    // 6. 응답 → caller_lang 번역
    const responseLang = caller_lang === 'ko'
      ? responseKo
      : await translate(responseKo, 'ko', caller_lang, env.DEEPSEEK_API_KEY);

    // 7. ai_sessions.messages 갱신
    const updatedMessages = [
      ...sessionMessages,
      { type: 'user',      ts: Date.now(), lang: caller_lang, content: message },
      { type: 'assistant', ts: Date.now(), lang: caller_lang, content: responseLang },
    ];
    await sbPatch(SUPA, env.SUPABASE_KEY,
      `ai_sessions?id=eq.${session_id}`,
      { messages: updatedMessages, updated_at: new Date().toISOString() });

    return new Response(JSON.stringify({
      ok:       true,
      mode:     'ai',
      response: responseLang,
      lang:     caller_lang,
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

  } catch (e) {
    return _err(500, 'AI_CHAT_ERROR', e.message, corsHeaders);
  }
}

// ─────────────────────────────────────────────
// POST /ai-setup — LLM 키 AES-256-GCM 암호화 저장
// ─────────────────────────────────────────────
async function handleAiSetup(request, env, corsHeaders) {
  // AI08: AES_ENCRYPTION_KEY 필수
  if (!env.AES_ENCRYPTION_KEY)
    return _err(500, 'SERVER_CONFIG_ERROR', 'AES_ENCRYPTION_KEY 미등록', corsHeaders);
  if (!env.GOPANG_MASTER_KEY)
    return _err(500, 'SERVER_CONFIG_ERROR', 'GOPANG_MASTER_KEY 미등록', corsHeaders);

  const authResult = await requireAuth(request, env.GOPANG_MASTER_KEY);
  if (authResult instanceof Response) return authResult;
  const user = authResult;

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { provider, api_key, model, custom_prompt, ai_active = true, native_lang = 'ko' } = body;

  if (!provider || !api_key)
    return _err(400, 'MISSING_FIELD', 'provider, api_key 필수', corsHeaders);
  if (!['anthropic', 'openai', 'deepseek', 'custom'].includes(provider))
    return _err(400, 'INVALID_PROVIDER', 'provider: anthropic|openai|deepseek|custom', corsHeaders);

  // AI06: api_key AES-256-GCM 암호화 (평문 저장 금지)
  const api_key_enc = await aesEncrypt(api_key, env.AES_ENCRYPTION_KEY);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;
  const now  = new Date().toISOString();

  await fetch(`${SUPA}/rest/v1/user_llm_keys`, {
    method:  'POST',
    headers: { ...sbH(env.SUPABASE_KEY), Prefer: 'resolution=merge-duplicates,return=minimal' },
    body:    JSON.stringify({
      guid: user.guid, provider, api_key_enc,
      model: model || null, custom_prompt: custom_prompt || null,
      ai_active, native_lang, created_at: now, updated_at: now,
    }),
  });

  return new Response(JSON.stringify({ ok: true, provider, ai_active }), {
    status:  200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────
// POST /escalate — 수동 에스컬레이션
// ─────────────────────────────────────────────
async function handleEscalate(request, env, corsHeaders) {
  if (!env.GOPANG_MASTER_KEY)
    return _err(500, 'SERVER_CONFIG_ERROR', 'GOPANG_MASTER_KEY 미등록', corsHeaders);

  const authResult = await requireAuth(request, env.GOPANG_MASTER_KEY);
  if (authResult instanceof Response) return authResult;

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { session_id } = body;
  if (!session_id) return _err(400, 'MISSING_FIELD', 'session_id 필수', corsHeaders);

  const SUPA = `https://${env.SUPABASE_PROJECT_ID}.supabase.co`;
  await sbPatch(SUPA, env.SUPABASE_KEY,
    `ai_sessions?id=eq.${session_id}`,
    { mode: 'escalated', escalated_at: new Date().toISOString() });

  return new Response(JSON.stringify({ ok: true, mode: 'escalated', session_id }), {
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

// requireAuth stub (worker.js 인라인 시 src/auth/auth.js 사용)
async function requireAuth(request, masterKey) { return null; }

// ─────────────────────────────────────────────
// worker.js 라우터 스니펫
// ─────────────────────────────────────────────
/*
  // ── Profile 2.0 M05 AI Assistant ─────────────────────────
  if (pathname === '/ai-chat' && request.method === 'POST')
    return handleAiChat(request, env, corsHeaders);
  if (pathname === '/ai-setup' && request.method === 'POST')
    return handleAiSetup(request, env, corsHeaders);
  if (pathname === '/escalate' && request.method === 'POST')
    return handleEscalate(request, env, corsHeaders);
*/

export {
  handleAiChat, handleAiSetup, handleEscalate,
  aesEncrypt, aesDecrypt,
  detectEscalationKeyword, countRecentFails,
  buildSystemPrompt, callLLM, translate,
  ESCALATION_KEYWORDS, FAIL_THRESHOLD, FAIL_WINDOW_MS,
  SUPPORTED_LANGS,
};
