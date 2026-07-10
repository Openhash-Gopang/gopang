// ═══════════════════════════════════════════════════════════
// src/worker/ai-chat-handler.js — 업체/기관 프로필의 "AI 점원" 핸들러
// ═══════════════════════════════════════════════════════════
// 2026-07-09 신설 — 짜장면 주문 사고실험(음식배달 시나리오)에서 발견한
// 갭 메우기 1단계. src/profile2.0/ai_assistant.js가 원안이었으나
// (1) requireAuth가 "worker.js 인라인 시 src/auth/auth.js 사용"이라는
//     자기 자신의 주석과 달리 실제로는 항상 null을 반환하는 스텁이었고
// (2) Supabase URL을 env.SUPABASE_PROJECT_ID로 조립하는데 worker.js는
//     이 환경변수를 어디서도 안 씀(SUPABASE_URL 상수를 씀)
// (3) 프로필 조회가 Supabase user_profiles였는데 실제 라이브 프로필은
//     L1 PocketBase profiles 컬렉션(extra JSON 필드 확인됨, 2026-07-09)
// 이 세 가지 때문에 그대로 못 썼다. 이 파일은 그 세 가지만 worker.js의
// 실제 라이브 패턴(Ed25519/TOFU, SUPABASE_URL 상수 재사용, L1 프로필
// 조회)에 맞춰 고친 버전이다. ai_sessions/messages/user_llm_keys는
// docs/supabase_to_l1_migration_plan.md가 "가장 마지막으로 미룰 것"을
// 명시한 테이블이라 Supabase에 그대로 둔다(의도적 — 마이그레이션
// 우선순위를 앞지르지 않음).
//
// worker.js가 이 파일을 import한다 — Cloudflare Workers는 wrangler.json
// (main: worker.js, export default 형태 = ES modules 포맷)이라 로컬
// import가 지원된다. 지금까지 worker.js가 7600줄 넘는 단일 파일이었던
// 건 "못 쪼개서"가 아니라 "안 쪼개서"였다 — 이 파일이 그 증명이다.
//
// ★ 2026-07-09 2단계 추가 — buildSystemPrompt에 주문 접수 규칙과
// [ORDER_DRAFT: ...] 태그 형식을 추가했다(extractOrderDraft로 파싱).
// 여전히 안 한 것: 주문 큐/주방 용량 판단(규칙 5에서 명시적으로 "이
// SP의 몫이 아니다"라고 선언 — 원래 사고실험의 5·6번, 훨씬 큰 별도
// 작업으로 분리해뒀다), 배송업체 매칭(7·8번), createEscrow 실결제
// 연결(3단계 예정).

const LLM_TIMEOUT_MS = 15000;

const ESCALATION_KEYWORDS = [
  '사람 연결', '사람이랑', '직원', '상담원', '연결해줘', '사람과',
  '人工', '转人工', '真人', '客服',
  'human', 'person', 'agent', 'staff', 'real person', 'talk to someone',
  '人間', 'スタッフ', '担当者',
  'người thật', 'nhân viên',
  'คนจริง', 'พนักงาน',
];

const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_THRESHOLD = 3;

function detectEscalationKeyword(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function countRecentFails(messages) {
  const now = Date.now();
  const cutoff = now - FAIL_WINDOW_MS;
  return messages.filter(m => m.type === 'fail' && m.ts > cutoff).length;
}

// 원본(ai_assistant.js)과 동일 — 아직 안 바꾼 부분(2단계에서 주문접수
// 규칙 추가 예정).
// ★ 2026-07-09 3단계 — profile.extra.menu 대신 seller_products(L1,
// K-Market이 이미 쓰는 실제 카탈로그)를 메뉴 소스로 바꿨다. 이유:
// handleBizOrder(/biz/order, 실제 GDC 결제 처리)는 seller_products를
// 권위 있는 가격 소스로 재조회해서 클라이언트 주장 금액과 대조한다
// (2026-07-07 신설된 가격조작 방지 로직). profile.extra.menu는 그
// 검증 경로와 완전히 무관한 별도 데이터라, 거기 있는 가격으로
// ORDER_DRAFT를 내봤자 /biz/order가 참조할 상품 자체가 없어 결제가
// 안 됐다 — 이번에 두 데이터를 하나로 합쳤다(K-Market 카탈로그가
// 곧 이 AI 점원의 메뉴가 됨). 식당이 새로 K-Market 셀러 등록을 해야
// 하는 게 이 통합의 실질적 비용이다.
function buildSystemPrompt(profile, distanceM, sellerProducts = []) {
  const hours = profile?.extra?.business_hours || '정보 없음';
  const name = profile?.name || '업체';
  const address = profile?.address || '';

  const publicItems = sellerProducts.filter(p => p.is_public !== false && typeof p.price === 'number');
  const menuText = publicItems.length > 0
    ? publicItems.map(p => `- [${p.product_id ?? p.id}] ${p.name}: ₮${p.price.toLocaleString()} ${p.desc || ''}`).join('\n')
    : '(메뉴 정보 없음 — 이 상점은 아직 K-Market 상품을 등록하지 않았습니다)';

  const locationText = distanceM !== null
    ? `현재 방문자와의 거리: 약 ${distanceM}m (도보 약 ${Math.round(distanceM / 67)}분)`
    : '';

  return `당신은 "${name}"의 AI 비서입니다.
주소: ${address}
영업시간: ${hours}
${locationText}

[메뉴 목록 — 대괄호 안은 상품 ID]
${menuText}

[필수 규칙]
1. 메뉴, 영업시간, 위치 외 정보는 "죄송합니다, 해당 정보는 제공하기 어렵습니다"라고 답하세요.
2. 위 [메뉴 목록]에 있는 항목의 주문은 직접 접수할 수 있습니다. 가격 흥정이나 환불 요청은 여전히 사람 연결을 안내하세요.
3. 주문을 접수할 때는(모든 항목이 메뉴에 있고 수량이 명확할 때만) 손님에게 보여줄 확인 문장(가격 언급해도 좋음) 뒤에 아래 형식의 태그를 정확히 한 번만 덧붙이세요 — product_id는 반드시 위 [메뉴 목록]의 대괄호 안 ID를 정확히 그대로 쓰세요. 가격·합계는 이 태그에 넣지 마세요(결제 시점에 시스템이 실제 상품 가격으로 다시 계산합니다 — 당신이 계산한 숫자는 쓰이지 않습니다):
   [ORDER_DRAFT: items=[{"product_id":"상품ID","qty":수량}]]
4. 메뉴에 없는 항목을 주문하려 하면 ORDER_DRAFT를 내지 말고 "죄송합니다, 그 메뉴는 없습니다"라고 답한 뒤 대안을 물어보세요. 수량이 불명확하면(예: "몇 개 드릴까요") 먼저 되묻고, 확답을 받기 전에는 ORDER_DRAFT를 내지 마세요.
5. 이 SP는 "지금 조리 가능한지·주문을 받을 여력이 있는지"는 판단하지 않습니다 — 그건 이 응답을 받는 쪽(주문 큐/용량 시스템)의 몫입니다. ORDER_DRAFT는 어디까지나 초안이며 최종 확정이 아닙니다.
6. 답변은 간결하게 2~3문장 이내로 유지하세요.
7. 항상 친절하고 정중한 어조를 유지하세요.`;
}

// ★ 2026-07-09 신설(2단계, 3단계에서 형식 단순화) — 응답 텍스트에서
// [ORDER_DRAFT: ...] 태그를 파싱해 정형 데이터로 분리한다. 사람이
// 읽는 텍스트와 기계가 바로 쓸 수 있는 구조화 데이터를 병행 반환하는
// 건 이 저장소 전반의 확립된 패턴이다(PROCEDURE_MAP_DRAFT 등과 동일
// 원칙) — 호출한 쪽(손님의 AI)이 정규식으로 다시 파싱할 필요가 없게
// 한다. 태그 자체는 텍스트에서 제거하지 않는다.
//
// ★ 3단계에서 total/currency를 태그에서 뺐다 — LLM이 계산한 합계를
// 그대로 믿는 건 handleBizOrder가 2026-07-07에 고친 바로 그 취약점
// (가격을 클라이언트 주장대로 신뢰)을 다른 자리에서 재현하는 것이다.
// 가격의 유일한 권위 소스는 seller_products(L1)이고, 그건 handleAiChat
// 안에서 이미 fetch해둔 sellerProducts로 서버가 직접 계산한다
// (_priceOrderItems).
const _ORDER_DRAFT_RE = /\[ORDER_DRAFT:\s*items=(\[[\s\S]*?\])\]/;

function extractOrderDraft(text) {
  const m = typeof text === 'string' ? text.match(_ORDER_DRAFT_RE) : null;
  if (!m) return null;
  let items;
  try {
    items = JSON.parse(m[1]);
  } catch {
    return null; // 형식이 깨졌으면 조용히 무시 — 사람 텍스트 응답은 그대로 살려둔다
  }
  if (!Array.isArray(items) || !items.length) return null;
  // product_id/qty가 없는 항목이 섞여 있으면 이 초안 전체를 신뢰하지
  // 않는다 — 부분적으로만 유효한 주문을 그대로 넘기면 나중에 조용히
  // 항목이 누락된 채 결제될 위험이 있다.
  const valid = items.every(it => it && typeof it.product_id === 'string' && it.product_id &&
    typeof it.qty === 'number' && it.qty > 0);
  if (!valid) return null;
  return { items };
}

// ★ 2026-07-09 3단계 신설 — ORDER_DRAFT의 product_id들을 handleAiChat이
// 이미 fetch해둔 sellerProducts(L1, 권위 있는 소스)로 대조해 실제 가격을
// 매긴다. LLM이 계산한 숫자는 여기서 전혀 쓰지 않는다 — handleBizOrder의
// 2026-07-07 가격조작 방지 로직과 동일한 원칙을 여기서도 적용한 것이다.
// 메뉴에 없는 product_id가 섞여 있으면(LLM 환각 또는 카탈로그가 그 사이
// 바뀐 경우) 그 항목만 unresolved에 담고 계속 진행한다 — 전체를 버리면
// 정상 항목까지 못 쓰게 되니, "이 항목은 실패했다"는 걸 정직하게 알리는
// 쪽이 낫다.
function priceOrderItems(items, sellerProducts) {
  const byId = new Map(sellerProducts.map(p => [String(p.product_id ?? p.id), p]));
  const priced = [];
  const unresolved = [];
  let total = 0;

  for (const it of items) {
    const rec = byId.get(String(it.product_id));
    if (!rec || typeof rec.price !== 'number' || rec.is_public === false) {
      unresolved.push(it.product_id);
      continue;
    }
    const lineTotal = rec.price * it.qty;
    priced.push({ product_id: it.product_id, name: rec.name, unit_price: rec.price, qty: it.qty, line_total: lineTotal });
    total += lineTotal;
  }

  return { items: priced, unresolved, total, currency: 'GDC' };
}

async function callLLM({ provider, apiKey, model, systemPrompt, userMessage }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    let url, headers, body;

    if (provider === 'deepseek') {
      url = 'https://api.deepseek.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      body = JSON.stringify({
        model: model || 'deepseek-chat',
        max_tokens: 512,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });
    } else if (provider === 'anthropic') {
      url = 'https://api.anthropic.com/v1/messages';
      headers = {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      };
      body = JSON.stringify({
        model: model || 'claude-sonnet-4-6',
        max_tokens: 512,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });
    } else if (provider === 'openai') {
      url = 'https://api.openai.com/v1/chat/completions';
      headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` };
      body = JSON.stringify({
        model: model || 'gpt-4o-mini',
        max_tokens: 512,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });
    } else {
      throw new Error(`UNSUPPORTED_PROVIDER: ${provider}`);
    }

    const res = await fetch(url, { method: 'POST', headers, body, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`LLM_HTTP_${res.status}`);
    const data = await res.json();

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

async function translate(text, fromLang, toLang, apiKey) {
  if (!text || fromLang === toLang) return text;
  try {
    const res = await fetch('https://api.deepseek.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: 'deepseek-chat',
        max_tokens: 256,
        messages: [{
          role: 'user',
          content: `Translate from ${fromLang} to ${toLang}. Return only the translation, no explanation.\n\n${text}`,
        }],
      }),
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content?.trim() || text;
  } catch { return text; }
}

async function aesEncrypt(plaintext, rawKey) {
  const keyBuf = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rawKey.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyBuf, encoded);
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(cipher), 12);
  return btoa(String.fromCharCode(...combined));
}

async function aesDecrypt(b64, rawKey) {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const cipher = combined.slice(12);
  const keyBuf = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rawKey.padEnd(32, '0').slice(0, 32)),
    { name: 'AES-GCM' }, false, ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyBuf, cipher);
  return new TextDecoder().decode(plain);
}

/**
 * POST /ai-chat — 다른 프로필(사람 또는 업체)의 AI 비서에게 메시지 전달.
 * 원본 대비 변경점: JWT(requireAuth) → Ed25519+TOFU(worker.js 실제 라이브
 * 패턴), Supabase user_profiles → L1 profiles(_l1FindProfileByGuid).
 *
 * @param deps - worker.js가 주입하는 실제 함수들(순환 의존 없이 이 파일이
 *   worker.js 내부 헬퍼를 직접 import하지 않고 인자로 받는 방식 — 이러면
 *   이 파일을 다른 프로젝트에서도 재사용하거나 단위테스트할 때 worker.js
 *   전체를 끌어올 필요가 없다).
 */
async function handleAiChat(request, env, corsHeaders, deps) {
  const { _err, _verifyEd25519, _l1FindProfileByGuid, _l1ListSellerProducts, sbFetch } = deps;

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { guid, pubkey, signature, session_id, message, caller_lang = 'ko', target_guid, distance_m = null } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey) return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!session_id || !message || !target_guid) {
    return _err(400, 'MISSING_FIELD', 'session_id, message, target_guid 필수', corsHeaders);
  }

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  let callerRecord;
  try {
    callerRecord = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!callerRecord) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);
  if (callerRecord.pubkey_ed25519 && callerRecord.pubkey_ed25519 !== pubkey) {
    return _err(401, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
  }

  try {
    let sessions = await sbFetch(env, `/ai_sessions?id=eq.${session_id}&select=*`);
    let session = sessions?.[0];

    if (!session) {
      await sbFetch(env, '/ai_sessions', 'POST', {
        id: session_id, caller_guid: guid, caller_lang,
        target_guid, mode: 'ai', messages: [], is_active: true,
        created_at: new Date().toISOString(),
      });
      session = { mode: 'ai', messages: [] };
    }

    const sessionMessages = Array.isArray(session.messages) ? session.messages : [];
    const failCount = countRecentFails(sessionMessages);
    const hasKeyword = detectEscalationKeyword(message);

    if (session.mode === 'escalated' || failCount >= FAIL_THRESHOLD || hasKeyword) {
      await sbFetch(env, `/ai_sessions?id=eq.${session_id}`, 'PATCH',
        { mode: 'escalated', escalated_at: new Date().toISOString() });

      return new Response(JSON.stringify({
        ok: true, mode: 'escalated',
        message: '사람 상담원에게 연결합니다. 잠시만 기다려주세요.',
        reason: hasKeyword ? 'keyword' : failCount >= FAIL_THRESHOLD ? 'fail_count' : 'already_escalated',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const llmRows = await sbFetch(env, `/user_llm_keys?guid=eq.${encodeURIComponent(target_guid)}&select=*`);
    const llmKey = llmRows?.[0];

    if (!llmKey || !llmKey.ai_active) {
      await sbFetch(env, '/messages', 'POST', {
        session_id,
        sender_guid: guid,
        receiver_guid: target_guid,
        content_original: message,
        content_translated: await translate(message, caller_lang, 'ko', env.DEEPSEEK_API_KEY),
        lang_from: caller_lang,
        lang_to: 'ko',
        content_type: 'text',
        created_at: new Date().toISOString(),
      });
      await sbFetch(env, `/ai_sessions?id=eq.${session_id}`, 'PATCH', { mode: 'human' });

      return new Response(JSON.stringify({
        ok: true, mode: 'human',
        message: '업체에 메시지를 전달했습니다. 곧 답변이 도착합니다.',
      }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const msgKo = caller_lang === 'ko' ? message : await translate(message, caller_lang, 'ko', env.DEEPSEEK_API_KEY);

    let targetProfile, sellerProducts;
    try {
      [targetProfile, sellerProducts] = await Promise.all([
        _l1FindProfileByGuid(env, target_guid),
        _l1ListSellerProducts(env, target_guid),
      ]);
    } catch (e) {
      return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패(대상 프로필/카탈로그): ' + e.message, corsHeaders);
    }
    if (!targetProfile) return _err(404, 'TARGET_NOT_FOUND', '대상 프로필이 L1에 없습니다', corsHeaders);

    const systemPrompt = buildSystemPrompt(targetProfile, distance_m, sellerProducts);

    let apiKey;
    try {
      apiKey = await aesDecrypt(llmKey.api_key_enc, env.AES_ENCRYPTION_KEY);
    } catch {
      return _err(500, 'DECRYPT_ERROR', 'LLM API 키 복호화 실패', corsHeaders);
    }

    let responseKo;
    try {
      responseKo = await callLLM({ provider: llmKey.provider, apiKey, model: llmKey.model, systemPrompt, userMessage: msgKo });
    } catch (e) {
      const updated = [...sessionMessages, { type: 'fail', ts: Date.now(), reason: e.message }];
      await sbFetch(env, `/ai_sessions?id=eq.${session_id}`, 'PATCH',
        { messages: updated, updated_at: new Date().toISOString() });
      return _err(502, 'LLM_ERROR', `AI 응답 실패: ${e.message}`, corsHeaders);
    }

    const responseLang = caller_lang === 'ko' ? responseKo : await translate(responseKo, 'ko', caller_lang, env.DEEPSEEK_API_KEY);

    // ★ 2단계 — 번역 전(responseKo)에서 추출한다. translate()가 LLM을
    // 한 번 더 거치는 과정이라 [ORDER_DRAFT: ...] 안의 JSON 구조가
    // 번역 중 깨질 위험이 있다 — 구조화 데이터는 항상 신뢰 가능한
    // 원본(한국어, 시스템 프롬프트가 이 형식을 지시한 언어)에서만 뽑는다.
    // ★ 3단계 — 추출한 product_id/qty를 이미 fetch해둔 sellerProducts로
    // 서버가 직접 가격을 매긴다(priceOrderItems) — LLM이 낸 숫자는 아예
    // 안 쓴다. 이 order는 그대로 /biz/order 요청의 tx.items로 넘길 수
    // 있는 형태다(product_id 기준 재조회는 handleBizOrder가 자기 쪽에서
    // 또 한 번 하므로 이중 방어가 된다 — 여기서 가격을 매겼다고 해서
    // handleBizOrder의 검증이 생략되는 건 아니다).
    const draft = extractOrderDraft(responseKo);
    const order = draft ? priceOrderItems(draft.items, sellerProducts) : null;

    const updatedMessages = [
      ...sessionMessages,
      { type: 'user', ts: Date.now(), lang: caller_lang, content: message },
      { type: 'assistant', ts: Date.now(), lang: caller_lang, content: responseLang },
    ];
    await sbFetch(env, `/ai_sessions?id=eq.${session_id}`, 'PATCH',
      { messages: updatedMessages, updated_at: new Date().toISOString() });

    return new Response(JSON.stringify({ ok: true, mode: 'ai', response: responseLang, lang: caller_lang, order }), {
      status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return _err(500, 'AI_CHAT_ERROR', e.message, corsHeaders);
  }
}

/**
 * POST /escalate — 수동 에스컬레이션. 원본 대비 동일 변경(JWT→Ed25519/TOFU).
 */
async function handleEscalate(request, env, corsHeaders, deps) {
  const { _err, _verifyEd25519, _l1FindProfileByGuid, sbFetch } = deps;

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const { guid, pubkey, signature, session_id } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey) return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!session_id) return _err(400, 'MISSING_FIELD', 'session_id 필수', corsHeaders);

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  let callerRecord;
  try {
    callerRecord = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!callerRecord) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);
  if (callerRecord.pubkey_ed25519 && callerRecord.pubkey_ed25519 !== pubkey) {
    return _err(401, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
  }

  await sbFetch(env, `/ai_sessions?id=eq.${session_id}`, 'PATCH',
    { mode: 'escalated', escalated_at: new Date().toISOString() });

  return new Response(JSON.stringify({ ok: true, mode: 'escalated', session_id }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

export {
  handleAiChat, handleEscalate,
  buildSystemPrompt, callLLM, translate,
  detectEscalationKeyword, countRecentFails, extractOrderDraft, priceOrderItems,
  aesEncrypt, aesDecrypt,
  ESCALATION_KEYWORDS, FAIL_THRESHOLD, FAIL_WINDOW_MS,
};
