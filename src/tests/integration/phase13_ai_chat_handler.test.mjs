/**
 * phase13_ai_chat_handler.test.mjs
 *
 * 짜장면 주문 사고실험 1단계 — src/worker/ai-chat-handler.js 검증.
 * 이 파일은 브라우저 의존성이 없는 순수 Worker 모듈이라(fetch/crypto만
 * 필요, Node 18+ 전역 제공) phase11/12처럼 정규식 추출 없이 실제 ESM
 * import로 바로 테스트한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleAiChat, handleEscalate,
  buildSystemPrompt, detectEscalationKeyword, countRecentFails, extractOrderDraft, priceOrderItems,
  aesEncrypt, aesDecrypt,
  FAIL_THRESHOLD,
} from '../../worker/ai-chat-handler.js';

const L1_BASE = 'https://l1.example.test';

function makeDeps(overrides = {}) {
  return {
    _err: (status, code, message) => new Response(JSON.stringify({ error: code, message }), {
      status, headers: { 'Content-Type': 'application/json' },
    }),
    _verifyEd25519: async () => true,
    _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'PUBKEY', name: '테스트 상점', address: '제주시 어딘가' }),
    _l1ListSellerProducts: async () => [],
    // BUG-FIX(2026-07-17): ai-chat-handler.js는 2026-07-15부로 세션/LLM키
    // 조회를 Supabase(sbFetch)에서 L1 PocketBase(_l1AdminToken + 원문
    // fetch)로 이관했는데, 이 목은 옛 sbFetch 방식 그대로 남아있어
    // handleAiChat/handleEscalate가 실제로 호출하는 _l1AdminToken이 아예
    // undefined였다 — 모든 테스트가 "_l1AdminToken is not a function"
    // 또는 그로 인한 500으로 실패했다(실사로 재현·확인). sbFetch는 이제
    // 실제 코드 어디에서도 안 쓰이므로 제거하고 L1 계열로 교체한다.
    _l1AdminToken: async () => 'FAKE_L1_ADMIN_TOKEN',
    L1_DEFAULT: L1_BASE,
    ...overrides,
  };
}

// ── L1 PocketBase REST 호출 목 — ai_sessions/user_llm_keys/ai_messages ──
// handleAiChat/handleEscalate가 실제로 호출하는 엔드포인트 형태 그대로
// 흉내낸다(_l1FindSession/_l1CreateSession/_l1PatchSession 참조).
// deepseek 등 다른 fetch 대상은 realFetch로 통과시켜, 각 테스트가 필요할
// 때 자기 것과 조합해서 쓸 수 있게 한다.
function installMockL1Fetch({ session = null, llmKey = null, onDeepseek = null } = {}) {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, opts = {}) => {
    const u = String(url);
    if (onDeepseek && u.includes('api.deepseek.com')) {
      return onDeepseek(url, opts);
    }
    if (u.includes('/api/collections/ai_sessions/records') && (!opts.method || opts.method === 'GET')) {
      return { ok: true, json: async () => ({ items: session ? [session] : [] }) };
    }
    if (u.includes('/api/collections/ai_sessions/records') && opts.method === 'POST') {
      return { ok: true, json: async () => ({ id: 'new-sess-id' }) };
    }
    if (u.includes('/api/collections/ai_sessions/records/') && opts.method === 'PATCH') {
      return { ok: true, json: async () => ({}) };
    }
    if (u.includes('/api/collections/user_llm_keys/records')) {
      return { ok: true, json: async () => ({ items: llmKey ? [llmKey] : [] }) };
    }
    if (u.includes('/api/collections/ai_messages/records')) {
      return { ok: true, json: async () => ({}) };
    }
    return realFetch(url, opts);
  };
  return () => { globalThis.fetch = realFetch; };
}

function req(body) {
  return new Request('https://hondi-proxy.example/biz/ai-chat', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG',
  session_id: 's1', message: '안녕하세요', target_guid: 'TARGET',
};

describe('N-21: handleAiChat — 필수 필드 검증', () => {
  it('guid/pubkey/signature/session_id/message/target_guid 중 하나라도 없으면 400', async () => {
    for (const field of ['guid', 'pubkey', 'signature', 'session_id', 'message', 'target_guid']) {
      const body = { ...BASE_BODY };
      delete body[field];
      const res = await handleAiChat(req(body), {}, {}, makeDeps());
      assert.equal(res.status, 400, `${field} 누락인데 400이 아님`);
    }
  });
});

describe('N-22: handleAiChat — 서명/신원 검증(Ed25519 + TOFU)', () => {
  it('서명 검증 실패 시 401', async () => {
    const deps = makeDeps({ _verifyEd25519: async () => false });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'INVALID_SIGNATURE');
  });

  it('L1에 가입 기록 없으면 404(원본 handleAiSetupPost와 동일 원칙)', async () => {
    const deps = makeDeps({ _l1FindProfileByGuid: async () => null });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'PROFILE_NOT_FOUND');
  });

  it('L1에 등록된 공개키와 요청의 pubkey가 다르면 401(TOFU 위반)', async () => {
    const deps = makeDeps({
      _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'DIFFERENT_KEY' }),
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 401);
    const data = await res.json();
    assert.equal(data.error, 'PUBKEY_MISMATCH');
  });
});

describe('N-23: handleAiChat — 에스컬레이션 조건', () => {
  it('메시지에 "사람 연결" 등 키워드가 있으면 즉시 escalated', async () => {
    const uninstall = installMockL1Fetch();
    try {
      const body = { ...BASE_BODY, message: '사람 연결해줘' };
      const res = await handleAiChat(req(body), {}, {}, makeDeps());
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.mode, 'escalated');
      assert.equal(data.reason, 'keyword');
    } finally { uninstall(); }
  });

  it('최근 10분 내 실패 3회 이상이면 escalated', async () => {
    const now = Date.now();
    const uninstall = installMockL1Fetch({
      session: { id: 'sess-1', mode: 'ai', messages: [
        { type: 'fail', ts: now - 1000 },
        { type: 'fail', ts: now - 2000 },
        { type: 'fail', ts: now - 3000 },
      ] },
    });
    try {
      const deps = makeDeps();
      const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
      const data = await res.json();
      assert.equal(data.mode, 'escalated');
      assert.equal(data.reason, 'fail_count');
    } finally { uninstall(); }
  });

  it('세션이 이미 escalated 모드면 계속 escalated 유지', async () => {
    const uninstall = installMockL1Fetch({ session: { id: 'sess-1', mode: 'escalated', messages: [] } });
    try {
      const deps = makeDeps();
      const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
      const data = await res.json();
      assert.equal(data.mode, 'escalated');
      assert.equal(data.reason, 'already_escalated');
    } finally { uninstall(); }
  });
});

describe('N-24: handleAiChat — ai_active=false면 사람에게 전달(mode:human)', () => {
  it('대상의 LLM 키가 없거나 ai_active=false면 human 모드로 응답', async () => {
    const uninstall = installMockL1Fetch({
      session: { id: 'sess-1', mode: 'ai', messages: [] },
      llmKey: { ai_active: false },
    });
    try {
      const deps = makeDeps();
      const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.mode, 'human');
    } finally { uninstall(); }
  });
});

describe('N-25: handleAiChat — 정상 AI 응답 경로(전체 파이프라인)', () => {
  it('대상의 seller_products 카탈로그가 실제로 system 프롬프트에 반영되어 LLM에 전달됨', async () => {
    // BUG-FIX(2026-07-17): 이전 키('test-encryption-key-32bytes-long!!', 34자)는
    // hex 문자열이 아니어서 _hexToBytesLocal이 17바이트(유효하지 않은 AES 키
    // 길이)를 만들어 매번 "Invalid key length"로 실패했다. AES-256-GCM은
    // 정확히 32바이트(64 hex 문자)가 필요하다.
    const rawKey = '0a708778b68053a7da6e56436c0f55b3b27dc273fef763ba17533a7a89e8204c'.slice(0, 64);
    const apiKeyEnc = await aesEncrypt('sk-test-api-key', rawKey);

    let capturedLlmBody = null;
    const uninstall = installMockL1Fetch({
      session: { id: 'sess-1', mode: 'ai', messages: [] },
      llmKey: { ai_active: true, provider: 'deepseek', model: 'deepseek-chat', api_key_enc: apiKeyEnc },
      onDeepseek: async (url, opts) => {
        capturedLlmBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '네, 짜장면 2그릇 주문 접수했습니다.' } }] }) };
      },
    });

    try {
      const deps = makeDeps({
        _l1FindProfileByGuid: async (env, guid) => {
          if (guid === 'TARGET') {
            return { guid, pubkey_ed25519: 'PUBKEY', name: '동네 중국집', address: '제주시 어딘가', extra: { business_hours: '11:00~21:00' } };
          }
          return { guid, pubkey_ed25519: 'PUBKEY' };
        },
        _l1ListSellerProducts: async (env, guid) => guid === 'TARGET'
          ? [{ product_id: 'P1', name: '짜장면', price: 7000, is_public: true }]
          : [],
      });
      const body = { ...BASE_BODY, message: '짜장면 두 그릇 주문할게요' };
      const res = await handleAiChat(req(body), { AES_ENCRYPTION_KEY: rawKey }, {}, deps);
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.mode, 'ai');
      assert.match(data.response, /짜장면/);

      assert.ok(capturedLlmBody, 'LLM이 실제로 호출됐어야 함');
      const systemMsg = capturedLlmBody.messages.find(m => m.role === 'system').content;
      assert.match(systemMsg, /동네 중국집/);
      assert.match(systemMsg, /11:00~21:00/);
      assert.match(systemMsg, /짜장면/);
      assert.match(systemMsg, /P1/, '상품 ID가 프롬프트에 노출돼야 LLM이 ORDER_DRAFT에 정확히 쓸 수 있음');
    } finally {
      uninstall();
    }
  });

  it('비공개(is_public:false) 상품은 메뉴에서 제외됨', () => {
    const prompt = buildSystemPrompt({ name: '가게', extra: {} }, null, [
      { product_id: 'P1', name: '보이는거', price: 1000, is_public: true },
      { product_id: 'P2', name: '숨긴거', price: 2000, is_public: false },
    ]);
    assert.match(prompt, /보이는거/);
    assert.ok(!prompt.includes('숨긴거'), '비공개 상품이 노출되면 안 됨(handleBizOrder의 ITEM_NOT_PUBLIC 규칙과 일관성)');
  });
});

describe('N-26: handleEscalate — 필수 필드 및 서명 검증', () => {
  it('session_id 없으면 400', async () => {
    const body = { guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG' };
    const res = await handleEscalate(req(body), {}, {}, makeDeps());
    assert.equal(res.status, 400);
  });

  it('정상 요청이면 escalated 응답', async () => {
    const uninstall = installMockL1Fetch({ session: { id: 'sess-1', mode: 'ai', messages: [] } });
    try {
      const body = { guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG', session_id: 's1' };
      const res = await handleEscalate(req(body), {}, {}, makeDeps());
      assert.equal(res.status, 200);
      const data = await res.json();
      assert.equal(data.mode, 'escalated');
    } finally { uninstall(); }
  });
});

describe('N-27: 순수 함수 — buildSystemPrompt/detectEscalationKeyword/countRecentFails', () => {
  it('buildSystemPrompt — 2단계: 메뉴 항목 주문은 직접 접수 가능, 가격흥정/환불만 사람 연결', () => {
    const prompt = buildSystemPrompt({ name: '가게', extra: {} }, null, []);
    assert.match(prompt, /메뉴 목록.*있는 항목의 주문은 직접 접수할 수 있습니다/s);
    assert.match(prompt, /가격 흥정이나 환불 요청은 여전히 사람 연결을 안내/);
    assert.match(prompt, /ORDER_DRAFT/);
    assert.match(prompt, /이 SP는 "지금 조리 가능한지·주문을 받을 여력이 있는지"는 판단하지 않습니다/,
      '주문 큐/용량 판단까지 이 SP가 하는 것처럼 프롬프트가 과잉 약속하면 안 됨 — 5·6번은 별도 작업');
  });

  it('buildSystemPrompt — 3단계: 가격·합계는 LLM이 태그에 넣지 말라고 명시(가격조작 방지)', () => {
    const prompt = buildSystemPrompt({ name: '가게', extra: {} }, null, []);
    assert.match(prompt, /가격·합계는 이 태그에 넣지 마세요/);
    assert.match(prompt, /product_id/);
  });

  it('detectEscalationKeyword — 다국어 키워드 인식', () => {
    assert.equal(detectEscalationKeyword('직원 좀 바꿔주세요'), true);
    assert.equal(detectEscalationKeyword('talk to someone please'), true);
    assert.equal(detectEscalationKeyword('그냥 메뉴만 볼게요'), false);
  });

  it('countRecentFails — 10분 지난 실패는 카운트 안 함', () => {
    const now = Date.now();
    const messages = [
      { type: 'fail', ts: now - 1000 },
      { type: 'fail', ts: now - 11 * 60 * 1000 }, // 11분 전 — 제외돼야 함
    ];
    assert.equal(countRecentFails(messages), 1);
  });

  it(`FAIL_THRESHOLD는 ${3}(원본과 동일 유지)`, () => {
    assert.equal(FAIL_THRESHOLD, 3);
  });
});

describe('N-29: extractOrderDraft — [ORDER_DRAFT: ...] 태그 파싱(3단계: product_id+qty만)', () => {
  it('정상 형식을 정확히 파싱', () => {
    const text = '짜장면 2그릇 주문 접수했습니다(₮14,000). [ORDER_DRAFT: items=[{"product_id":"P1","qty":2}]]';
    const order = extractOrderDraft(text);
    assert.deepEqual(order, { items: [{ product_id: 'P1', qty: 2 }] });
  });

  it('여러 항목도 파싱', () => {
    const text = '[ORDER_DRAFT: items=[{"product_id":"P1","qty":1},{"product_id":"P2","qty":1}]]';
    const order = extractOrderDraft(text);
    assert.equal(order.items.length, 2);
  });

  it('태그가 없으면 null(일반 응답·안내성 답변)', () => {
    assert.equal(extractOrderDraft('영업시간은 11시부터 21시까지입니다.'), null);
  });

  it('items JSON이 깨져 있으면 null로 조용히 무시(사람 텍스트 응답은 안 깨뜨림)', () => {
    assert.equal(extractOrderDraft('[ORDER_DRAFT: items=[{broken json]'), null);
  });

  it('items가 빈 배열이면 null(빈 주문은 주문이 아님)', () => {
    assert.equal(extractOrderDraft('[ORDER_DRAFT: items=[]]'), null);
  });

  it('product_id가 문자열이 아니거나 qty가 없으면 전체를 신뢰하지 않음(부분 유효 주문 방지)', () => {
    assert.equal(extractOrderDraft('[ORDER_DRAFT: items=[{"product_id":"P1","qty":1},{"name":"이상한형식"}]]'), null);
  });

  it('LLM이 옛 형식(unit_price/total 포함)을 실수로 내도 파싱은 되되 가격 필드는 무시됨(product_id/qty만 취함)', () => {
    const order = extractOrderDraft('[ORDER_DRAFT: items=[{"product_id":"P1","qty":2,"unit_price":99999}]]');
    assert.deepEqual(order.items[0], { product_id: 'P1', qty: 2, unit_price: 99999 });
    // unit_price가 파싱 결과엔 남아있어도 priceOrderItems가 이걸 절대 안 씀(N-31에서 검증)
  });
});

describe('N-30: handleAiChat — 주문 접수 전체 파이프라인(3단계: 서버측 권위 가격산정)', () => {
  it('LLM이 가격을 안 내도(product_id만) 서버가 seller_products로 정확한 총액을 계산', async () => {
    const rawKey = '0a708778b68053a7da6e56436c0f55b3b27dc273fef763ba17533a7a89e8204c'.slice(0, 64);
    const apiKeyEnc = await aesEncrypt('sk-test-api-key', rawKey);

    const uninstall = installMockL1Fetch({
      session: { id: 'sess-1', mode: 'ai', messages: [] },
      llmKey: { ai_active: true, provider: 'deepseek', model: 'deepseek-chat', api_key_enc: apiKeyEnc },
      onDeepseek: async (url, opts) => {
        const body = JSON.parse(opts.body);
        const isTranslateCall = body.messages.some(m => typeof m.content === 'string' && m.content.startsWith('Translate from'));
        if (isTranslateCall) {
          return { ok: true, json: async () => ({ choices: [{ message: { content: 'ORDER CONFIRMED (translation garbled the tag)' } }] }) };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: '짜장면 2그릇 주문 접수했습니다. [ORDER_DRAFT: items=[{"product_id":"P1","qty":2}]]' } }] }) };
      },
    });

    try {
      const deps = makeDeps({
        _l1FindProfileByGuid: async (env, guid) => ({
          guid, pubkey_ed25519: 'PUBKEY', name: '동네 중국집', address: '제주시 어딘가', extra: { business_hours: '11:00~21:00' },
        }),
        _l1ListSellerProducts: async () => [{ product_id: 'P1', name: '짜장면', price: 7000, is_public: true }],
      });
      const body = { ...BASE_BODY, message: '2 jjajangmyeon please', caller_lang: 'en' };
      // BUG-FIX(2026-07-17): env에 DEEPSEEK_API_KEY가 없으면 translate()가
      // deepseekChat()의 DEEPSEEK_API_KEY_MISSING을 조용히 삼키고
      // fallbackText(번역 안 된 원문)를 반환한다 — 그래서 응답이 "garbled"
      // 문구로 안 바뀌고 원본 한국어 그대로 나왔었다(목 자체엔 도달도 못 함).
      const res = await handleAiChat(req(body), { AES_ENCRYPTION_KEY: rawKey, DEEPSEEK_API_KEY: 'test-dsk-key' }, {}, deps);
      const data = await res.json();

      assert.ok(data.order, 'order 필드가 채워져야 함');
      assert.deepEqual(data.order, {
        items: [{ product_id: 'P1', name: '짜장면', unit_price: 7000, qty: 2, line_total: 14000 }],
        unresolved: [], total: 14000, currency: 'GDC',
      });
      assert.match(data.response, /garbled/, '번역된 화면 텍스트가 망가져도 order 필드 정확도엔 영향 없어야 함');
    } finally {
      uninstall();
    }
  });

  it('메뉴에 없는 항목이면 order는 null(LLM이 ORDER_DRAFT를 안 냄)', async () => {
    const rawKey = '0a708778b68053a7da6e56436c0f55b3b27dc273fef763ba17533a7a89e8204c'.slice(0, 64);
    const apiKeyEnc = await aesEncrypt('sk-test-api-key', rawKey);
    const uninstall = installMockL1Fetch({
      session: { id: 'sess-1', mode: 'ai', messages: [] },
      llmKey: { ai_active: true, provider: 'deepseek', model: 'deepseek-chat', api_key_enc: apiKeyEnc },
      onDeepseek: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '죄송합니다, 그 메뉴는 없습니다. 짜장면은 어떠세요?' } }] }) }),
    });
    try {
      const deps = makeDeps({
        _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'PUBKEY', name: '동네 중국집' }),
        _l1ListSellerProducts: async () => [{ product_id: 'P1', name: '짜장면', price: 7000, is_public: true }],
      });
      const body = { ...BASE_BODY, message: '초밥 두 개 주세요' };
      const res = await handleAiChat(req(body), { AES_ENCRYPTION_KEY: rawKey }, {}, deps);
      const data = await res.json();
      assert.equal(data.order, null);
    } finally {
      uninstall();
    }
  });
});
describe('N-31: priceOrderItems — LLM 숫자를 절대 신뢰하지 않고 서버가 직접 계산', () => {
  const catalog = [
    { product_id: 'P1', name: '짜장면', price: 7000, is_public: true },
    { product_id: 'P2', name: '탕수육', price: 15000, is_public: true },
    { product_id: 'P3', name: '비공개메뉴', price: 99999, is_public: false },
  ];

  it('LLM이 unit_price를 조작해서 냈어도 서버 계산 결과에 전혀 반영되지 않음', () => {
    const result = priceOrderItems([{ product_id: 'P1', qty: 2, unit_price: 1 }], catalog);
    assert.equal(result.items[0].unit_price, 7000, '카탈로그 가격만 써야 함 — LLM이 준 1은 무시');
    assert.equal(result.total, 14000);
  });

  it('여러 항목 합산이 정확함', () => {
    const result = priceOrderItems([{ product_id: 'P1', qty: 1 }, { product_id: 'P2', qty: 2 }], catalog);
    assert.equal(result.total, 7000 + 15000 * 2);
  });

  it('카탈로그에 없는 product_id는 unresolved에 담기고 total 계산에서 제외', () => {
    const result = priceOrderItems([{ product_id: 'P1', qty: 1 }, { product_id: 'GHOST', qty: 1 }], catalog);
    assert.deepEqual(result.unresolved, ['GHOST']);
    assert.equal(result.total, 7000, '유효 항목만 합산 — 없는 상품 때문에 전체를 버리지 않음');
  });

  it('비공개(is_public:false) 상품은 unresolved 처리(handleBizOrder의 ITEM_NOT_PUBLIC과 동일 원칙)', () => {
    const result = priceOrderItems([{ product_id: 'P3', qty: 1 }], catalog);
    assert.deepEqual(result.unresolved, ['P3']);
    assert.equal(result.total, 0);
  });
});

describe('N-28: aesEncrypt/aesDecrypt — 왕복 검증', () => {
  it('암호화 후 복호화하면 원문과 일치', async () => {
    // BUG-FIX(2026-07-17): 이전 키('my-test-key-1234567890123456789', 31자,
    // hex 아님)는 _hexToBytesLocal이 15바이트(유효하지 않은 AES 키 길이)로
    // 잘못 변환해 매번 "Invalid key length"로 실패했다.
    const key = '0a708778b68053a7da6e56436c0f55b3b27dc273fef763ba17533a7a89e8204c'.slice(0, 64);
    const plain = 'sk-super-secret-api-key';
    const enc = await aesEncrypt(plain, key);
    const dec = await aesDecrypt(enc, key);
    assert.equal(dec, plain);
  });
});
