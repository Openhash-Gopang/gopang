/**
 * routes/l1-resolve.js — 선행종속 B절: 주소 → l1_node 자동산출
 * KYC(1번)를 포함해 판매자 등록 흐름 전체가 이 엔드포인트에 의존한다.
 */

import { resolveL1ByAdminKey } from '../lib/l1-registry.js';
import { jsonResponse } from '../lib/http.js';

export async function handleResolveL1(request, env) {
  const { address } = await request.json();
  if (!address) return jsonResponse({ ok: false, reason: 'MISSING_ADDRESS' }, 400);

  const kakaoRes = await fetch(
    `https://dapi.kakao.com/v2/local/search/address.json?query=${encodeURIComponent(address)}`,
    { headers: { Authorization: `KakaoAK ${env.KAKAO_REST_KEY}` } }
  );
  if (!kakaoRes.ok) return jsonResponse({ ok: false, reason: 'GEOCODE_API_ERROR' }, 502);
  const kakaoData = await kakaoRes.json();
  const doc = kakaoData?.documents?.[0];
  if (!doc) return jsonResponse({ ok: false, reason: 'ADDRESS_NOT_FOUND' }, 404);

  const region = doc.address || doc.road_address;
  if (!region) return jsonResponse({ ok: false, reason: 'ADDRESS_NOT_FOUND' }, 404);
  const key = `${region.region_1depth_name}|${region.region_2depth_name}|${region.region_3depth_name}`;

  const matched = await resolveL1ByAdminKey(env, key);
  if (matched) {
    return jsonResponse({
      ok: true, l1_node: matched.l1Node,
      lat: Number(doc.y), lng: Number(doc.x),
    });
  }

  return handleL1Fallback(env, key, doc);
}

async function handleL1Fallback(env, adminKey, doc) {
  await env.PENDING_REGION_KV.put(
    `pending:${adminKey}:${Date.now()}`,
    JSON.stringify({ adminKey, lat: doc.y, lng: doc.x, requested_at: new Date().toISOString() })
  );
  return jsonResponse({
    ok: true, l1_node: 'PENDING',
    message: '해당 지역은 서비스 준비 중입니다. 등록은 접수되며, 서비스 개시 시 자동 활성화됩니다.',
  });
}
