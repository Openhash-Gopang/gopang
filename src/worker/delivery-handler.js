// ═══════════════════════════════════════════════════════════
// src/worker/delivery-handler.js — 배송업체 검색·요청 (7·8단계)
// ═══════════════════════════════════════════════════════════
// 2026-07-09 신설 — 짜장면 주문 사고실험 7·8번("배송업체 검색", "배송
// 요청, 배송업체 AI 비서가 도착 예정 시각 전송")을 메운다.
//
// ★ 검색은 새로 안 만들고 이미 라이브인 search_entities RPC(handleSearch/
// /search가 쓰는 것과 동일)를 그대로 재사용한다 — worker.js의
// _searchEntitiesRaw()가 RPC 호출부만 최소로 분리해둔 걸 여기서 쓴다.
// distance_km은 RPC가 이미 계산해서 주므로 별도 haversine 계산이
// 필요 없다.
//
// ★ 정직하게 밝혀둘 한계 — occupation 필터로 "배송"/"퀵서비스" 같은
// 문자열을 쓰는데, 실제로 그 문자열로 자신을 등록한 배송업체가 있어야만
// 매칭된다(시나리오 1번의 "실제 등록된 식당이 없으면 안 된다"와 정확히
// 같은 종류의 전제). 이 파일은 인프라만 만들고, 실제 배송업체가 등록해야
// 작동한다.
//
// ★ ETA는 distance_km 기반 단순 선형 추정(픽업 대기 + 거리/평균속도)이다
// — 실시간 교통정보 없음, order-queue-handler.js의 조리시간 추정과
// 동일한 "완전히 안 하는 것보다 단순하지만 있는 게 낫다" 원칙.

const DEFAULT_PICKUP_BUFFER_MINUTES = 5;
const DEFAULT_AVG_SPEED_KMH = 20; // 도심 배달 오토바이 평균 근사치

function estimateEtaMinutes(distanceKm, opts = {}) {
  if (distanceKm == null || !Number.isFinite(distanceKm)) return null;
  const buffer = opts.pickupBufferMinutes ?? DEFAULT_PICKUP_BUFFER_MINUTES;
  const speed = opts.avgSpeedKmh ?? DEFAULT_AVG_SPEED_KMH;
  return buffer + Math.ceil((distanceKm / speed) * 60);
}

/**
 * POST /biz/delivery-request — 픽업지(식당) 근처 배송업체를 검색해
 * 가장 가까운 곳에 배송을 요청한다. LLM을 쓰지 않는다(order-queue-
 * handler.js와 동일 원칙 — 순수 검색+산술).
 */
async function handleDeliveryRequest(request, env, corsHeaders, deps) {
  const { _err, _verifyEd25519, _l1FindProfileByGuid, _searchEntitiesRaw, _l1CreateDeliveryRequest } = deps;

  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const {
    guid, pubkey, signature, target_guid: seller_guid, queue_id = null,
    pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
    courier_occupation = '배송',
  } = body;

  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey) return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!seller_guid) return _err(400, 'MISSING_FIELD', 'target_guid(seller_guid) 필수', corsHeaders);
  if (pickup_lat == null || pickup_lng == null) return _err(400, 'MISSING_FIELD', 'pickup_lat/pickup_lng 필수', corsHeaders);
  if (dropoff_lat == null || dropoff_lng == null) return _err(400, 'MISSING_FIELD', 'dropoff_lat/dropoff_lng 필수', corsHeaders);

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

  // 픽업지(식당) 인근, occupation이 배송인 엔티티를 거리순으로 검색.
  // 요청자(guid) 자기 자신과 판매자 자신은 배송 후보에서 제외.
  let candidates;
  try {
    candidates = await _searchEntitiesRaw(env, {
      occupation: courier_occupation,
      lat: pickup_lat, lng: pickup_lng,
      limit: 5,
      exclude_guid: guid,
    });
  } catch (e) {
    return _err(502, 'SEARCH_FAILED', '배송업체 검색 실패: ' + e.message, corsHeaders);
  }
  candidates = candidates.filter(c => c.guid !== seller_guid);

  if (!candidates.length) {
    return new Response(JSON.stringify({
      ok: true, accepted: false, reason: 'NO_COURIER_FOUND',
      message: '죄송합니다, 현재 인근에 등록된 배송업체를 찾지 못했습니다.',
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }

  const chosen = candidates[0]; // 이미 distance_km 기준 정렬됨(search_entities RPC의 p_sort='distance')
  const eta_minutes = estimateEtaMinutes(chosen.distance_km);

  let record;
  try {
    record = await _l1CreateDeliveryRequest(env, {
      seller_guid, buyer_guid: guid, queue_id, courier_guid: chosen.guid,
      pickup_lat, pickup_lng, dropoff_lat, dropoff_lng,
      status: 'requested', eta_minutes,
      requested_at: new Date().toISOString(),
    });
  } catch (e) {
    return _err(502, 'DELIVERY_REQUEST_FAILED', e.message, corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true, accepted: true, delivery_request_id: record.id,
    courier: { guid: chosen.guid, name: chosen.name, distance_km: chosen.distance_km },
    eta_minutes,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export { handleDeliveryRequest, estimateEtaMinutes, DEFAULT_PICKUP_BUFFER_MINUTES, DEFAULT_AVG_SPEED_KMH };
