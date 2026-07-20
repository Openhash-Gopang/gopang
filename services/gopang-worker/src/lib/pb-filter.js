/**
 * PocketBase filter 파라미터 안전 빌더
 *
 * P12 이력: PocketBase 0.22.14 JS 런타임에서 "1=1" bare 필터와 IPv6 등이
 * 섞인 미이스케이프 필터 문자열이 패닉을 일으킨 적이 있다.
 * 핵심 원칙:
 *   1) 조건이 없으면 filter 파라미터 자체를 생략한다 (bare "1=1" 금지)
 *   2) 값은 반드시 작은따옴표로 감싸고 이스케이프한다 (콜론 포함 IPv6도 안전)
 */

function escapePbValue(v) {
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  return `'${String(v).replace(/'/g, "\\'")}'`;
}

/**
 * @param {Array<[field, op, value]>} conditions
 * @returns {string|null} filter 문자열. 조건 없으면 null (파라미터 생략용)
 */
export function buildFilter(conditions) {
  if (!conditions || !conditions.length) return null;
  return conditions
    .map(([field, op, val]) => `${field}${op}${escapePbValue(val)}`)
    .join(' && ');
}

/** conditions + 필터를 실제 URLSearchParams에 반영 (filter 없으면 파라미터 자체를 안 넣음) */
export function applyFilterToParams(qs, conditions) {
  const filter = buildFilter(conditions);
  if (filter) qs.set('filter', filter);
  return qs;
}
