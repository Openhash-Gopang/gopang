/**
 * phase14_order_queue_handler.test.mjs
 *
 * 짜장면 주문 사고실험 5·6단계 — src/worker/order-queue-handler.js 검증.
 * "지금 조리 가능한지·주문을 받을 여력이 있는지" + "조리시간 파악"을
 * LLM 없이 순수 서버 로직으로 처리한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleOrderQueue, estimatePrepMinutes, DEFAULT_CAPACITY, DEFAULT_BASE_PREP_MINUTES, DEFAULT_PER_ORDER_EXTRA_MINUTES } from '../../worker/order-queue-handler.js';

function makeDeps(overrides = {}) {
  return {
    _err: (status, code, message) => new Response(JSON.stringify({ error: code, message }), {
      status, headers: { 'Content-Type': 'application/json' },
    }),
    _verifyEd25519: async () => true,
    _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'PUBKEY', name: '테스트 상점' }),
    _l1CountActiveOrders: async () => 0,
    _l1CreateOrderQueueEntry: async (env, record) => ({ id: 'Q1', ...record }),
    ...overrides,
  };
}

function req(body) {
  return new Request('https://hondi-proxy.example/biz/order-queue', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const VALID_ORDER = { items: [{ product_id: 'P1', name: '짜장면', unit_price: 7000, qty: 2, line_total: 14000 }], unresolved: [], total: 14000, currency: 'GDC' };
const BASE_BODY = { guid: 'CALLER', pubkey: 'PUBKEY', signature: 'SIG', target_guid: 'TARGET', session_id: 's1', order: VALID_ORDER };

describe('N-32: handleOrderQueue — 필수 필드 및 order 유효성 검증', () => {
  it('guid/pubkey/signature/target_guid 중 하나라도 없으면 400', async () => {
    for (const field of ['guid', 'pubkey', 'signature', 'target_guid']) {
      const body = { ...BASE_BODY };
      delete body[field];
      const res = await handleOrderQueue(req(body), {}, {}, makeDeps());
      assert.equal(res.status, 400, `${field} 누락인데 400이 아님`);
    }
  });

  it('order.items가 없거나 비어있으면 400', async () => {
    const res = await handleOrderQueue(req({ ...BASE_BODY, order: { items: [] } }), {}, {}, makeDeps());
    assert.equal(res.status, 400);
  });

  it('order.unresolved에 항목이 있으면(가격 못 매긴 상품 존재) 400 — 이런 주문을 큐에 넣으면 안 됨', async () => {
    const body = { ...BASE_BODY, order: { ...VALID_ORDER, unresolved: ['GHOST'] } };
    const res = await handleOrderQueue(req(body), {}, {}, makeDeps());
    assert.equal(res.status, 400);
    const data = await res.json();
    assert.equal(data.error, 'UNRESOLVED_ITEMS');
  });
});

describe('N-33: handleOrderQueue — 서명/신원 검증(1·2단계와 동일 Ed25519+TOFU)', () => {
  it('서명 검증 실패 시 401', async () => {
    const res = await handleOrderQueue(req(BASE_BODY), {}, {}, makeDeps({ _verifyEd25519: async () => false }));
    assert.equal(res.status, 401);
  });

  it('대상 프로필이 L1에 없으면 404', async () => {
    const deps = makeDeps({
      _l1FindProfileByGuid: async (env, guid) => guid === 'CALLER' ? { guid, pubkey_ed25519: 'PUBKEY' } : null,
    });
    const res = await handleOrderQueue(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 404);
    const data = await res.json();
    assert.equal(data.error, 'TARGET_NOT_FOUND');
  });
});

describe('N-34: handleOrderQueue — 용량 판단(핵심)', () => {
  it('현재 활성 주문 < 용량이면 접수(accepted:true), 대기순번/예상시간 포함', async () => {
    const deps = makeDeps({ _l1CountActiveOrders: async () => 2 });
    const res = await handleOrderQueue(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.accepted, true);
    assert.equal(data.position_in_queue, 3); // 활성 2건 다음 순번
    assert.equal(data.queue_id, 'Q1');
    assert.ok(typeof data.estimated_prep_minutes === 'number');
  });

  it('현재 활성 주문 == 기본 용량(5)이면 거부(CAPACITY_FULL), 큐에 생성 안 함', async () => {
    let created = false;
    const deps = makeDeps({
      _l1CountActiveOrders: async () => DEFAULT_CAPACITY,
      _l1CreateOrderQueueEntry: async () => { created = true; return { id: 'SHOULD_NOT_HAPPEN' }; },
    });
    const res = await handleOrderQueue(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 200); // 거부도 정상 응답(에러 아님) — 클라이언트가 "죄송합니다" 메시지 그대로 보여줄 수 있게
    const data = await res.json();
    assert.equal(data.accepted, false);
    assert.equal(data.reason, 'CAPACITY_FULL');
    assert.equal(created, false, '용량 초과인데 큐에 레코드가 생성되면 안 됨');
  });

  it('업체가 extra.max_concurrent_orders로 용량을 재정의할 수 있음', async () => {
    const deps = makeDeps({
      _l1FindProfileByGuid: async (env, guid) => guid === 'TARGET'
        ? { guid, pubkey_ed25519: 'PUBKEY', extra: { max_concurrent_orders: 1 } }
        : { guid, pubkey_ed25519: 'PUBKEY' },
      _l1CountActiveOrders: async () => 1, // 이미 1건 — 재정의된 용량 1에 도달
    });
    const res = await handleOrderQueue(req(BASE_BODY), {}, {}, deps);
    const data = await res.json();
    assert.equal(data.accepted, false, '용량을 1로 낮췄으면 1건만 있어도 거부돼야 함');
  });
});

describe('N-35: estimatePrepMinutes — 조리시간 추정(단순 선형 모델)', () => {
  it('기본값: base(15) + 활성건수*per_order(5)', () => {
    assert.equal(estimatePrepMinutes(0, {}), DEFAULT_BASE_PREP_MINUTES);
    assert.equal(estimatePrepMinutes(3, {}), DEFAULT_BASE_PREP_MINUTES + 3 * DEFAULT_PER_ORDER_EXTRA_MINUTES);
  });

  it('업체가 extra로 재정의 가능', () => {
    const profile = { extra: { base_prep_minutes: 20, per_order_extra_minutes: 10 } };
    assert.equal(estimatePrepMinutes(2, profile), 20 + 2 * 10);
  });
});

describe('N-36: handleOrderQueue — 접수 시 큐 레코드에 정확한 데이터가 담김', () => {
  it('seller_guid/buyer_guid/items/total/currency/status가 정확히 전달됨', async () => {
    let capturedRecord = null;
    const deps = makeDeps({
      _l1CreateOrderQueueEntry: async (env, record) => { capturedRecord = record; return { id: 'Q1', ...record }; },
    });
    await handleOrderQueue(req(BASE_BODY), {}, {}, deps);
    assert.equal(capturedRecord.seller_guid, 'TARGET');
    assert.equal(capturedRecord.buyer_guid, 'CALLER');
    assert.equal(capturedRecord.session_id, 's1');
    assert.deepEqual(capturedRecord.items, VALID_ORDER.items);
    assert.equal(capturedRecord.total, 14000);
    assert.equal(capturedRecord.currency, 'GDC');
    assert.equal(capturedRecord.status, 'accepted');
  });
});
