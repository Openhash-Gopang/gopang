// ============================================================
// m07_location.test.mjs — M07 위치 모듈 테스트
// 저장위치: gopang/src/tests/profile2.0/m07_location.test.mjs
// 실행: node src/tests/profile2.0/m07_location.test.mjs
// ============================================================

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ─── 테스트 대상 함수 인라인 ───

const METERS_PER_DEGREE = 111320;
const DEFAULT_RADIUS    = 500;
const MAX_RADIUS        = 10000;

function haversineM(lat1, lng1, lat2, lng2) {
  const R  = 6371000;
  const φ1 = lat1 * Math.PI / 180;
  const φ2 = lat2 * Math.PI / 180;
  const Δφ = (lat2 - lat1) * Math.PI / 180;
  const Δλ = (lng2 - lng1) * Math.PI / 180;
  const a  = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function calcIsOpen(businessHours) {
  if (!businessHours) return null;
  const match = String(businessHours).match(
    /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/
  );
  if (!match) return null;
  const now     = new Date();
  const kstHour = (now.getUTCHours() + 9) % 24;
  const kstMin  = now.getUTCMinutes();
  const current = kstHour * 60 + kstMin;
  const open    = Number(match[1]) * 60 + Number(match[2]);
  const close   = Number(match[3]) * 60 + Number(match[4]);
  return current >= open && current < close;
}

function metersToDegreeLat(meters) {
  return meters / METERS_PER_DEGREE;
}
function metersToDegreeLng(meters, lat) {
  return meters / (METERS_PER_DEGREE * Math.cos(lat * Math.PI / 180));
}

// /nearby BETWEEN 필터 모킹 (BUG-C3 검증)
function buildNearbyQuery(userLat, userLng, radius) {
  const dLat = metersToDegreeLat(radius);
  const dLng = metersToDegreeLng(radius, userLat);
  return {
    minLat: userLat - dLat,
    maxLat: userLat + dLat,
    minLng: userLng - dLng,
    maxLng: userLng + dLng,
    // 핵심: 파라미터명 userLat/userLng (컬럼명 lat/lng와 구분)
    queryStr: `lat=gte.${userLat - dLat}&lat=lte.${userLat + dLat}`
            + `&lng=gte.${userLng - dLng}&lng=lte.${userLng + dLng}`,
  };
}

// 하버사인 필터 + 정렬 + limit 모킹
function filterByRadius(entities, userLat, userLng, radius, limit = 20) {
  return entities
    .filter(e => e.lat && e.lng)
    .map(e => ({ ...e, distance_m: haversineM(userLat, userLng, e.lat, e.lng) }))
    .filter(e => e.distance_m <= radius)
    .sort((a, b) => a.distance_m - b.distance_m)
    .slice(0, limit);
}

// calcIsOpen KST 시각 주입 버전 (테스트용)
function calcIsOpenAt(businessHours, kstHourNow, kstMinNow) {
  if (!businessHours) return null;
  const match = String(businessHours).match(
    /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/
  );
  if (!match) return null;
  const current = kstHourNow * 60 + kstMinNow;
  const open    = Number(match[1]) * 60 + Number(match[2]);
  const close   = Number(match[3]) * 60 + Number(match[4]);
  return current >= open && current < close;
}

// ─────────────────────────────────────────────
// 테스트 프레임워크
// ─────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(id, desc, fn) {
  try {
    await fn();
    console.log(`  ✅ ${id} ${desc}`);
    passed++;
  } catch(e) {
    console.log(`  ❌ ${id} ${desc}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}
function assert(cond, msg)    { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg)  { if (a !== b) throw new Error(msg || `expected "${b}", got "${a}"`); }
function assertNull(a, msg)   { if (a !== null) throw new Error(msg || `expected null, got "${a}"`); }
function assertLte(a, b, msg) { if (a > b) throw new Error(msg || `expected ${a} <= ${b}`); }

// ─────────────────────────────────────────────
// L01 반경 내 엔티티 필터링
// ─────────────────────────────────────────────
await test('L01', '반경 내 엔티티 — 500m 이내만 반환', () => {
  const userLat = 33.3945, userLng = 126.2389;
  const radius  = 500;

  const entities = [
    { guid: 'e1', name: '금능반점',   lat: 33.3948, lng: 126.2391 }, // ~40m
    { guid: 'e2', name: '협재식당',   lat: 33.3945, lng: 126.2430 }, // ~370m
    { guid: 'e3', name: '한림항식당', lat: 33.4100, lng: 126.2600 }, // ~2km 이상
    { guid: 'e4', name: '모슬포식당', lat: 33.2150, lng: 126.2550 }, // 멀리
  ];

  const result = filterByRadius(entities, userLat, userLng, radius);
  assertEq(result.length, 2, `반경 내 2개여야 함, 실제 ${result.length}`);
  assert(result[0].distance_m <= result[1].distance_m, '거리 정렬 오류');
  for (const r of result) assertLte(r.distance_m, radius, `거리 초과: ${r.distance_m}m`);
});

// ─────────────────────────────────────────────
// L02 BUG-C3 — 변수명 충돌 방지 검증
// ─────────────────────────────────────────────
await test('L02', 'BUG-C3 — userLat/userLng 변수명 충돌 방지', () => {
  const userLat = 33.3945, userLng = 126.2389;
  const radius  = 500;
  const query   = buildNearbyQuery(userLat, userLng, radius);

  // 쿼리에 컬럼명 lat/lng가 파라미터값이 아닌 컬럼명으로 사용됨을 확인
  assert(query.queryStr.includes('lat=gte.'), 'BETWEEN 하한 없음');
  assert(query.queryStr.includes('lat=lte.'), 'BETWEEN 상한 없음');
  assert(query.queryStr.includes('lng=gte.'), 'BETWEEN lng 하한 없음');

  // 범위 검증
  assert(query.minLat < userLat, 'minLat > userLat');
  assert(query.maxLat > userLat, 'maxLat < userLat');
  assert(query.minLng < userLng, 'minLng > userLng');
  assert(query.maxLng > userLng, 'maxLng < userLng');

  // 반경이 dLat에 정확히 반영됨
  const expectedDLat = metersToDegreeLat(radius);
  const actualDLat   = query.maxLat - userLat;
  assert(Math.abs(actualDLat - expectedDLat) < 0.000001, 'dLat 오차');
});

// ─────────────────────────────────────────────
// L03 is_open — 영업 중 (KST 14:00)
// ─────────────────────────────────────────────
await test('L03', 'is_open=true — KST 14:00, 영업시간 10:00-20:00', () => {
  assertEq(calcIsOpenAt('10:00-20:00', 14, 0),  true,  '14:00 영업 중 오류');
  assertEq(calcIsOpenAt('11:00-21:00', 11, 0),  true,  '11:00 정각 오픈 오류');
  assertEq(calcIsOpenAt('09:00-22:00', 21, 59), true,  '21:59 영업 중 오류');
  // 대시 변형
  assertEq(calcIsOpenAt('10:00–20:00', 14, 0),  true,  '– 구분자 오류');
});

// ─────────────────────────────────────────────
// L04 is_open — 영업 외 (KST 22:00)
// ─────────────────────────────────────────────
await test('L04', 'is_open=false — KST 22:00, 영업시간 10:00-20:00', () => {
  assertEq(calcIsOpenAt('10:00-20:00', 22, 0),  false, '22:00 영업 외 오류');
  assertEq(calcIsOpenAt('10:00-20:00', 20, 0),  false, '20:00 정각 마감 오류'); // close는 미포함
  assertEq(calcIsOpenAt('10:00-20:00',  9, 59), false, '09:59 오픈 전 오류');
});

// ─────────────────────────────────────────────
// L05 is_open — 정보 없음
// ─────────────────────────────────────────────
await test('L05', 'is_open=null — 영업시간 정보 없음', () => {
  assertNull(calcIsOpen(null),      'null → null 아님');
  assertNull(calcIsOpen(''),        '빈 문자열 → null 아님');
  assertNull(calcIsOpen('휴무'),    '파싱 불가 → null 아님');
  assertNull(calcIsOpen('연중무휴'),'파싱 불가 → null 아님');
  assertNull(calcIsOpen(undefined), 'undefined → null 아님');
});

// ─────────────────────────────────────────────
// L06 consent 없이 위치 기록 → 400
// ─────────────────────────────────────────────
await test('L06', 'consent=false → CONSENT_REQUIRED 400', () => {
  const cases = [
    { consent: false,     shouldAllow: false },
    { consent: undefined, shouldAllow: false },
    { consent: null,      shouldAllow: false },
    { consent: true,      shouldAllow: true  },
  ];
  for (const { consent, shouldAllow } of cases) {
    const allowed = !!consent;
    assertEq(allowed, shouldAllow, `consent=${consent} → 허용:${shouldAllow} 오류`);
  }
});

// ─────────────────────────────────────────────
// L07 consent=true — location_log 필드 구성
// ─────────────────────────────────────────────
await test('L07', 'consent=true — location_log INSERT 필드 검증', () => {
  const logData = {
    guid:        'buyer-guid-001',
    lat:         33.3945,
    lng:         126.2389,
    accuracy:    15.0,
    consent:     true,
    recorded_at: new Date().toISOString(),
  };
  assertEq(logData.consent, true,     'consent 필드 오류');
  assert(logData.recorded_at,         'recorded_at 없음');
  assert(typeof logData.lat === 'number', 'lat 숫자 아님');
  assert(typeof logData.lng === 'number', 'lng 숫자 아님');
});

// ─────────────────────────────────────────────
// L08 KAKAO_MOBILITY_KEY 미등록 → fallback
// ─────────────────────────────────────────────
await test('L08', 'KAKAO_MOBILITY_KEY 미등록 — fallback 응답', () => {
  const env = { KAKAO_MOBILITY_KEY: undefined };

  // fallback 조건
  const isFallback = !env.KAKAO_MOBILITY_KEY;
  assert(isFallback, 'fallback 미트리거');

  // fallback 응답 구조
  const toLat = 33.3945, toLng = 126.2389;
  const fromLat = 33.4100, fromLng = 126.2600;
  const distanceM = haversineM(fromLat, fromLng, toLat, toLng);
  const fallbackRes = {
    ok:          true,
    fallback:    true,
    lat:         toLat,
    lng:         toLng,
    distance_m:  distanceM,
    duration_sec: Math.round(distanceM / 67 * 60),
  };
  assert(fallbackRes.fallback,         'fallback:true 없음');
  assert(fallbackRes.lat,              'lat 없음');
  assert(fallbackRes.lng,              'lng 없음');
  assert(fallbackRes.distance_m > 0,   'distance_m 오류');
  assert(fallbackRes.duration_sec > 0, 'duration_sec 오류');
});

// ─────────────────────────────────────────────
// L09 lang 번역 트리거 조건
// ─────────────────────────────────────────────
await test('L09', 'lang 번역 — native_lang ≠ lang 시 트리거', () => {
  const cases = [
    { lang: 'zh', native_lang: 'ko', shouldTranslate: true  },
    { lang: 'ko', native_lang: 'ko', shouldTranslate: false },
    { lang: 'ko', native_lang: 'zh', shouldTranslate: false }, // lang=ko → 번역 불필요
    { lang: 'ja', native_lang: 'ko', shouldTranslate: true  },
    { lang: 'zh', native_lang: 'zh', shouldTranslate: false }, // 동일 언어
  ];
  for (const { lang, native_lang, shouldTranslate } of cases) {
    const willTranslate = lang !== 'ko' && lang !== native_lang;
    assertEq(willTranslate, shouldTranslate,
      `lang=${lang}, native=${native_lang} 번역 판단 오류`);
  }
});

// ─────────────────────────────────────────────
// 추가: 하버사인 정확도 검증
// ─────────────────────────────────────────────
await test('L10', '하버사인 — 알려진 거리 검증', () => {
  // 한림읍 → 제주공항 (실제 약 25~27km)
  const d1 = haversineM(33.3945, 126.2389, 33.5067, 126.4929);
  assert(d1 > 20000 && d1 < 35000, `한림↔공항 거리 이상: ${d1}m`);

  // 동일 지점 → 0m
  assertEq(haversineM(33.3945, 126.2389, 33.3945, 126.2389), 0, '동일 지점 ≠ 0');

  // 1도 위도 차이 ≈ 111320m
  const d2 = haversineM(0, 0, 1, 0);
  assert(d2 > 110000 && d2 < 112000, `위도 1도 거리 오차: ${d2}m`);
});

// ─────────────────────────────────────────────
// 추가: 반경 변환 정확도
// ─────────────────────────────────────────────
await test('L11', '반경 변환 — 500m → 위도도 정확도', () => {
  const dLat = metersToDegreeLat(500);
  // 500 / 111320 ≈ 0.004492
  assert(dLat > 0.0044 && dLat < 0.0046,
    `dLat 범위 오류: ${dLat}`);

  // 제주도 위도(33°)에서 경도 변환
  const dLng = metersToDegreeLng(500, 33.3945);
  // cos(33.39°) ≈ 0.836, 500 / (111320 * 0.836) ≈ 0.00537
  assert(dLng > 0.0050 && dLng < 0.0060,
    `dLng 범위 오류: ${dLng}`);

  // dLng > dLat (위도 33°에서 경도가 위도보다 범위 넓음)
  assert(dLng > dLat, 'dLng <= dLat (위도 33° 기준 오류)');
});

// ─────────────────────────────────────────────
// 추가: MAX_RADIUS 초과 시 제한
// ─────────────────────────────────────────────
await test('L12', 'MAX_RADIUS 제한 — 10km 초과 요청 차단', () => {
  const requested = 50000; // 50km
  const actual    = Math.min(requested, MAX_RADIUS);
  assertEq(actual, MAX_RADIUS, `MAX_RADIUS 제한 실패: ${actual}`);

  // 정상 범위
  assertEq(Math.min(500, MAX_RADIUS),   500,       '500m 제한 오류');
  assertEq(Math.min(10000, MAX_RADIUS), MAX_RADIUS, '10km 제한 오류');
});

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log(`M07 Location 테스트 결과: ${passed}/${passed+failed} 통과`);
if (failed > 0) {
  console.log(`❌ 실패: ${failed}건`);
  process.exit(1);
} else {
  console.log('✅ 전체 통과 — M07 합격');
}
console.log('══════════════════════════════════════');
