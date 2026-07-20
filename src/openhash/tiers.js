/**
 * @file tiers.js
 * @description 물리적 계층(L1~L5) 정의 — 단일 소스 (Single Source of Truth)
 * @version 1.0.0
 * @author (담당자명 기입)
 *
 * 근거: OpenHash SCI 논문 §3.1.2(LCAT), 표1(대한민국 실제 행정구역 계층
 *   L1 7,000 / L2 226 / L3 17 / L4 13 / L5 19 — 여기서는 국내 파일럿
 *   단계이므로 L4=1(대한민국 전체), L5=글로벌로 단순화)
 *
 * [통합 배경, 2026-07] 지금까지 계층 정의가 두 갈래로 나뉘어 있었다:
 *   - src/openhash/plsm.js의 computeLCAT()/LCAT_MAP: 지역 문자열 기반
 *     3단계 근사 (A=제주내부, B=국내, C=국제) — worker.js의 지역 코드
 *     집합(jeju/kr 등)에 의존.
 *   - services/gopang-worker의 l1-registry.js: 읍/면/동 단위 PocketBase
 *     노드(admin_region_keys: "시도|시군구|읍면동") — 논문의 실제 물리
 *     계층 정의와 정확히 일치.
 * 이 파일은 후자를 정본으로 삼아 전자를 대체한다. plsm.js의 LCAT_MAP은
 * 이 파일 도입 후 은퇴 대상이다(§5-4 별도 단계 — l1-registry.js에 실제
 * 노드가 충분히 등록된 뒤 전환 권장. 지금 바로 전환하면 노드 미등록
 * 상태에서 전부 L2로만 판정되어 PLSM 분포가 왜곡된다).
 */

/**
 * guid → "시도|시군구|읍면동" 형식의 행정구역 키를 조회한다.
 * l1-registry.js가 아직 병합 전이므로, 이 함수는 해당 모듈이 실제
 * 배치된 경로로 import를 교체해 사용한다(§4 gopang-worker 병합 참조).
 *
 * @param {Object} env - Cloudflare Worker env (KV 바인딩 등)
 * @param {string} guid
 * @returns {Promise<string|null>} 예: "제주특별자치도|제주시|한림읍"
 */
export async function resolveL1RegionKey(env, guid) {
  // TODO(병합 시 교체): services/gopang-worker/src/lib/l1-registry.js의
  // resolveAdminRegionKeyByGuid(env, guid) 같은 조회 함수를 연결한다.
  // 현재는 인터페이스만 고정해두고, 실제 프로필 조회 로직은 gopang-worker
  // 병합 단계(§5-5)에서 채운다.
  throw new Error(
    '[tiers] resolveL1RegionKey()는 아직 실제 조회 로직이 연결되지 않았습니다. ' +
    'gopang-worker 병합(§5-5) 이후 l1-registry.js와 연결해야 합니다.'
  )
}

/**
 * 두 guid의 실제 L1 노드(읍면동)를 비교해, 두 당사자가 공유하는
 * 최소 공통 계층(LCAT, Lowest Common Ancestor Tier)을 반환한다.
 *
 * @param {Object} env
 * @param {string} guidA
 * @param {string} guidB
 * @returns {Promise<'L1'|'L2'|'L3'|'L4'>}
 */
export async function computeLCAT(env, guidA, guidB) {
  let regionA, regionB;
  try {
    [regionA, regionB] = await Promise.all([
      resolveL1RegionKey(env, guidA),
      resolveL1RegionKey(env, guidB),
    ]);
  } catch (e) {
    // 조회 실패(미등록 guid 포함) → 보수적 기본값
    console.warn('[tiers] computeLCAT 조회 실패, 보수적 기본값(L2) 사용:', e.message);
    return 'L2';
  }

  if (!regionA || !regionB) return 'L2'; // 정보 없음 → 보수적 기본값(기존 로직 계승)

  const [doA, siA, dongA] = regionA.split('|');
  const [doB, siB, dongB] = regionB.split('|');

  if (doA === doB && siA === siB && dongA === dongB) return 'L1'; // 같은 읍면동
  if (doA === doB && siA === siB)                    return 'L2'; // 같은 시군구
  if (doA === doB)                                    return 'L3'; // 같은 광역시도
  return 'L4'; // 국내 타 광역 간 (해외 거래 L5 판정은 별도 확장 필요)
}
