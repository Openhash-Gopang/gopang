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

function makeDeps(overrides = {}) {
  return {
    _err: (status, code, message) => new Response(JSON.stringify({ error: code, message }), {
      status, headers: { 'Content-Type': 'application/json' },
    }),
    _verifyEd25519: async () => true,
    _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'PUBKEY', name: '테스트 상점', address: '제주시 어딘가' }),
    _l1ListSellerProducts: async () => [],
    sbFetch: async () => ({}),
    ...overrides,
  };
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
    const body = { ...BASE_BODY, message: '사람 연결해줘' };
    const res = await handleAiChat(req(body), {}, {}, makeDeps());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
    assert.equal(data.reason, 'keyword');
  });

  it('최근 10분 내 실패 3회 이상이면 escalated', async () => {
    const now = Date.now();
    const deps = makeDeps({
      sbFetch: async (env, path) => {
        if (path.includes('/ai_sessions?')) {
          return [{ mode: 'ai', messages: [
            { type: 'fail', ts: now - 1000 },
            { type: 'fail', ts: now - 2000 },
            { type: 'fail', ts: now - 3000 },
          ] }];
        }
        return {};
      },
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
    assert.equal(data.reason, 'fail_count');
  });

  it('세션이 이미 escalated 모드면 계속 escalated 유지', async () => {
    const deps = makeDeps({
      sbFetch: async (env, path) => path.includes('/ai_sessions?') ? [{ mode: 'escalated', messages: [] }] : {},
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
    assert.equal(data.reason, 'already_escalated');
  });
});

describe('N-24: handleAiChat — ai_active=false면 사람에게 전달(mode:human)', () => {
  it('대상의 LLM 키가 없거나 ai_active=false면 human 모드로 응답', async () => {
    const deps = makeDeps({
      sbFetch: async (env, path) => {
        if (path.includes('/ai_sessions?')) return [{ mode: 'ai', messages: [] }];
        if (path.includes('/user_llm_keys')) return [{ ai_active: false }];
        return {};
      },
    });
    const res = await handleAiChat(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'human');
  });
});

describe('N-25: handleAiChat — 정상 AI 응답 경로(전체 파이프라인)', () => {
  it('대상의 seller_products 카탈로그가 실제로 system 프롬프트에 반영되어 LLM에 전달됨', async () => {
    const rawKey = 'test-encryption-key-32bytes-long!!';
    const apiKeyEnc = await aesEncrypt('sk-test-api-key', rawKey);

    let capturedLlmBody = null;
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('api.deepseek.com')) {
        capturedLlmBody = JSON.parse(opts.body);
        return { ok: true, json: async () => ({ choices: [{ message: { content: '네, 짜장면 2그릇 주문 접수했습니다.' } }] }) };
      }
      return realFetch(url, opts);
    };

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
        sbFetch: async (env, path) => {
          if (path.includes('/ai_sessions?')) return [{ mode: 'ai', messages: [] }];
          if (path.includes('/user_llm_keys')) return [{ ai_active: true, provider: 'deepseek', model: 'deepseek-chat', api_key_enc: apiKeyEnc }];
          return {};
        },
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
      globalThis.fetch = realFetch;
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
    const body = { guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG', session_id: 's1' };
    const res = await handleEscalate(req(body), {}, {}, makeDeps());
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.mode, 'escalated');
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
    const rawKey = 'test-encryption-key-32bytes-long!!';
    const apiKeyEnc = await aesEncrypt('sk-test-api-key', rawKey);

    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('api.deepseek.com')) {
        const body = JSON.parse(opts.body);
        const isTranslateCall = body.messages.some(m => typeof m.content === 'string' && m.content.startsWith('Translate from'));
        if (isTranslateCall) {
          // 번역 호출은 태그를 일부러 뭉개서 반환 — "번역 후가 아니라 번역
          // 전(responseKo)에서 뽑는다"는 설계를 실제로 검증하기 위함.
          return { ok: true, json: async () => ({ choices: [{ message: { content: 'ORDER CONFIRMED (translation garbled the tag)' } }] }) };
        }
        return { ok: true, json: async () => ({ choices: [{ message: { content: '짜장면 2그릇 주문 접수했습니다. [ORDER_DRAFT: items=[{"product_id":"P1","qty":2}]]' } }] }) };
      }
      return realFetch(url, opts);
    };

    try {
      const deps = makeDeps({
        _l1FindProfileByGuid: async (env, guid) => ({
          guid, pubkey_ed25519: 'PUBKEY', name: '동네 중국집', address: '제주시 어딘가', extra: { business_hours: '11:00~21:00' },
        }),
        _l1ListSellerProducts: async () => [{ product_id: 'P1', name: '짜장면', price: 7000, is_public: true }],
        sbFetch: async (env, path) => {
          if (path.includes('/ai_sessions?')) return [{ mode: 'ai', messages: [] }];
          if (path.includes('/user_llm_keys')) return [{ ai_active: true, provider: 'deepseek', model: 'deepseek-chat', api_key_enc: apiKeyEnc }];
          return {};
        },
      });
      const body = { ...BASE_BODY, message: '2 jjajangmyeon please', caller_lang: 'en' };
      const res = await handleAiChat(req(body), { AES_ENCRYPTION_KEY: rawKey }, {}, deps);
      const data = await res.json();

      assert.ok(data.order, 'order 필드가 채워져야 함');
      assert.deepEqual(data.order, {
        items: [{ product_id: 'P1', name: '짜장면', unit_price: 7000, qty: 2, line_total: 14000 }],
        unresolved: [], total: 14000, currency: 'GDC',
      });
      assert.match(data.response, /garbled/, '번역된 화면 텍스트가 망가져도 order 필드 정확도엔 영향 없어야 함');
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('메뉴에 없는 항목이면 order는 null(LLM이 ORDER_DRAFT를 안 냄)', async () => {
    const rawKey = 'test-encryption-key-32bytes-long!!';
    const apiKeyEnc = await aesEncrypt('sk-test-api-key', rawKey);
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, opts) => {
      if (String(url).includes('api.deepseek.com')) {
        return { ok: true, json: async () => ({ choices: [{ message: { content: '죄송합니다, 그 메뉴는 없습니다. 짜장면은 어떠세요?' } }] }) };
      }
      return realFetch(url, opts);
    };
    try {
      const deps = makeDeps({
        _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'PUBKEY', name: '동네 중국집' }),
        _l1ListSellerProducts: async () => [{ product_id: 'P1', name: '짜장면', price: 7000, is_public: true }],
        sbFetch: async (env, path) => {
          if (path.includes('/ai_sessions?')) return [{ mode: 'ai', messages: [] }];
          if (path.includes('/user_llm_keys')) return [{ ai_active: true, provider: 'deepseek', model: 'deepseek-chat', api_key_enc: apiKeyEnc }];
          return {};
        },
      });
      const body = { ...BASE_BODY, message: '초밥 두 개 주세요' };
      const res = await handleAiChat(req(body), { AES_ENCRYPTION_KEY: rawKey }, {}, deps);
      const data = await res.json();
      assert.equal(data.order, null);
    } finally {
      globalThis.fetch = realFetch;
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
    const key = 'my-test-key-1234567890123456789';
    const plain = 'sk-super-secret-api-key';
    const enc = await aesEncrypt(plain, key);
    const dec = await aesDecrypt(enc, key);
    assert.equal(dec, plain);
  });
});
