/**
 * phase15_delivery_handler.test.mjs
 *
 * 짜장면 주문 사고실험 7·8단계 — src/worker/delivery-handler.js 검증.
 * "배송업체 검색" + "배송 요청, ETA 산정"을 LLM 없이 처리한다.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { handleDeliveryRequest, estimateEtaMinutes, DEFAULT_PICKUP_BUFFER_MINUTES, DEFAULT_AVG_SPEED_KMH } from '../../worker/delivery-handler.js';

function makeDeps(overrides = {}) {
  return {
    _err: (status, code, message) => new Response(JSON.stringify({ error: code, message }), {
      status, headers: { 'Content-Type': 'application/json' },
    }),
    _verifyEd25519: async () => true,
    _l1FindProfileByGuid: async (env, guid) => ({ guid, pubkey_ed25519: 'PUBKEY', name: '테스트' }),
    _searchEntitiesRaw: async () => [{ guid: 'COURIER1', name: '번개배송', distance_km: 2.0 }],
    _l1CreateDeliveryRequest: async (env, record) => ({ id: 'D1', ...record }),
    ...overrides,
  };
}

function req(body) {
  return new Request('https://hondi-proxy.example/biz/delivery-request', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

const BASE_BODY = {
  guid: 'SELLER_ACTING_AS_CALLER', pubkey: 'PUBKEY', signature: 'SIG',
  target_guid: 'SELLER', queue_id: 'Q1',
  pickup_lat: 33.499, pickup_lng: 126.531,
  dropoff_lat: 33.510, dropoff_lng: 126.520,
};

describe('N-37: handleDeliveryRequest — 필수 필드 검증', () => {
  it('guid/pubkey/signature/target_guid/좌표 4종 중 하나라도 없으면 400', async () => {
    for (const field of ['guid', 'pubkey', 'signature', 'target_guid', 'pickup_lat', 'pickup_lng', 'dropoff_lat', 'dropoff_lng']) {
      const body = { ...BASE_BODY };
      delete body[field];
      const res = await handleDeliveryRequest(req(body), {}, {}, makeDeps());
      assert.equal(res.status, 400, `${field} 누락인데 400이 아님`);
    }
  });
});

describe('N-38: handleDeliveryRequest — 서명/신원 검증(1·2·5단계와 동일 Ed25519+TOFU)', () => {
  it('서명 검증 실패 시 401', async () => {
    const res = await handleDeliveryRequest(req(BASE_BODY), {}, {}, makeDeps({ _verifyEd25519: async () => false }));
    assert.equal(res.status, 401);
  });

  it('가입 기록 없으면 404', async () => {
    const res = await handleDeliveryRequest(req(BASE_BODY), {}, {}, makeDeps({ _l1FindProfileByGuid: async () => null }));
    assert.equal(res.status, 404);
  });
});

describe('N-39: handleDeliveryRequest — 배송업체 검색 및 매칭(핵심)', () => {
  it('후보가 있으면 가장 가까운(첫 번째, RPC가 이미 거리순 정렬) 곳에 요청 생성', async () => {
    let capturedSearchParams = null;
    const deps = makeDeps({
      _searchEntitiesRaw: async (env, params) => {
        capturedSearchParams = params;
        return [
          { guid: 'NEAR', name: '가까운배송', distance_km: 1.5 },
          { guid: 'FAR', name: '먼배송', distance_km: 8.0 },
        ];
      },
    });
    const res = await handleDeliveryRequest(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(data.accepted, true);
    assert.equal(data.courier.guid, 'NEAR');
    assert.equal(data.courier.distance_km, 1.5);
    assert.ok(typeof data.eta_minutes === 'number');

    assert.equal(capturedSearchParams.occupation, '배송', '기본 occupation 필터는 "배송"이어야 함');
    assert.equal(capturedSearchParams.lat, BASE_BODY.pickup_lat, '픽업지(식당) 좌표 기준으로 검색해야 함');
    assert.equal(capturedSearchParams.exclude_guid, BASE_BODY.guid);
  });

  it('후보가 하나도 없으면 accepted:false, NO_COURIER_FOUND — 실제 등록된 배송업체가 없는 현실을 정직하게 반영', async () => {
    const deps = makeDeps({ _searchEntitiesRaw: async () => [] });
    const res = await handleDeliveryRequest(req(BASE_BODY), {}, {}, deps);
    assert.equal(res.status, 200); // 에러가 아니라 정상 응답(호출자가 "못 찾음" 메시지 그대로 보여줄 수 있게)
    const data = await res.json();
    assert.equal(data.accepted, false);
    assert.equal(data.reason, 'NO_COURIER_FOUND');
  });

  it('검색 결과에 판매자(target_guid) 자신이 섞여 있어도 배송 후보에서 제외됨', async () => {
    const deps = makeDeps({
      _searchEntitiesRaw: async () => [
        { guid: 'SELLER', name: '식당 자기 자신(버그면 이게 뽑힘)', distance_km: 0 },
        { guid: 'REAL_COURIER', name: '진짜 배송업체', distance_km: 3.0 },
      ],
    });
    const res = await handleDeliveryRequest(req(BASE_BODY), {}, {}, deps);
    const data = await res.json();
    assert.equal(data.courier.guid, 'REAL_COURIER', '판매자 자신이 배송업체로 선택되면 안 됨');
  });

  it('courier_occupation을 요청에서 지정하면 그대로 검색에 반영됨', async () => {
    let capturedParams = null;
    const deps = makeDeps({
      _searchEntitiesRaw: async (env, params) => { capturedParams = params; return [{ guid: 'C1', name: '퀵', distance_km: 1 }]; },
    });
    await handleDeliveryRequest(req({ ...BASE_BODY, courier_occupation: '퀵서비스' }), {}, {}, deps);
    assert.equal(capturedParams.occupation, '퀵서비스');
  });
});

describe('N-40: estimateEtaMinutes — 거리 기반 단순 선형 추정', () => {
  it('기본값: buffer(5분) + 거리/평균속도(20km/h)', () => {
    // 2km / 20km/h * 60 = 6분 → 올림 → 6, + buffer 5 = 11
    assert.equal(estimateEtaMinutes(2), DEFAULT_PICKUP_BUFFER_MINUTES + Math.ceil((2 / DEFAULT_AVG_SPEED_KMH) * 60));
  });

  it('거리가 null/NaN이면 null 반환(RPC가 좌표 없어 거리 계산 못한 경우)', () => {
    assert.equal(estimateEtaMinutes(null), null);
    assert.equal(estimateEtaMinutes(NaN), null);
    assert.equal(estimateEtaMinutes(undefined), null);
  });

  it('옵션으로 buffer/평균속도 재정의 가능', () => {
    const result = estimateEtaMinutes(10, { pickupBufferMinutes: 10, avgSpeedKmh: 30 });
    assert.equal(result, 10 + Math.ceil((10 / 30) * 60));
  });

  it('거리 0이면 buffer만 반환(픽업 시간은 항상 있음)', () => {
    assert.equal(estimateEtaMinutes(0), DEFAULT_PICKUP_BUFFER_MINUTES);
  });
});

describe('N-41: handleDeliveryRequest — 요청 레코드에 정확한 데이터가 담김', () => {
  it('seller_guid/buyer_guid/queue_id/courier_guid/좌표/status가 정확히 전달됨', async () => {
    let capturedRecord = null;
    const deps = makeDeps({
      _l1CreateDeliveryRequest: async (env, record) => { capturedRecord = record; return { id: 'D1', ...record }; },
    });
    await handleDeliveryRequest(req(BASE_BODY), {}, {}, deps);
    assert.equal(capturedRecord.seller_guid, 'SELLER');
    assert.equal(capturedRecord.buyer_guid, BASE_BODY.guid);
    assert.equal(capturedRecord.queue_id, 'Q1');
    assert.equal(capturedRecord.courier_guid, 'COURIER1');
    assert.equal(capturedRecord.pickup_lat, BASE_BODY.pickup_lat);
    assert.equal(capturedRecord.dropoff_lat, BASE_BODY.dropoff_lat);
    assert.equal(capturedRecord.status, 'requested');
  });
});
