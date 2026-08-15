/**
 * gov-fee-lookup.js — gov-router.js 매칭 결과 → gov_fee_schedule 요금 조회 "배선"
 *
 * 2026-08-15 신설. gov-router.js(_assembleGovSystemPromptRaw)가 이번 발화를
 * 어느 기관/부서로 매칭했는지는 이미 trace 배열로 알 수 있다(resolveProvinceCode,
 * resolveAgencyDisplayName, resolveHandlerCodeFromTrace 등 기존 export 재사용).
 * 이 파일은 그 결과를 받아 PocketBase의 gov_fee_schedule 컬렉션에서 요금을
 * 찾고, GDC 청구액(혼디 서비스 수수료)을 계산해 반환하는 "능력"만 추가한다.
 *
 * ★ gov-router.js의 라우팅 로직 자체는 건드리지 않는다 — resolveAgencyDisplayName
 * 등 기존 함수들의 주석에 이미 명시된 이 파일의 설계 원칙을 그대로 따른다.
 *
 * ★ 알려진 이슈(2026-08-15) — tools/gov-fee-seed/scripts/seed_gov_fee_schedule.mjs가
 * 초기 시드 시 region_code를 'cheonan'으로 넣었는데, gov-router.js의 실제
 * 시코드 체계는 도코드 접두어가 붙은 'chungnam_cheonan'이다(CHUNGNAM_GU 테이블,
 * _makeMetroCityTable 참조). 이 파일은 두 형태를 모두 조회해보는 정규화로
 * 우회하지만, 근본 수정은 seed 스크립트의 --region 기본값을 'chungnam_cheonan'
 * 으로 바꾸고 재시드하는 것이다(별도 후속 작업).
 *
 * 의존성: pocketbase(JS SDK), 같은 폴더의 gov_fee_calc.mjs 로직을 그대로
 * 재사용하기 위해 tools/gov-fee-seed/scripts/gov_fee_calc.mjs를 임포트한다.
 * (도구 스크립트를 프로덕션 경로가 import하는 형태가 어색하면, 이 계산
 * 함수들을 src/gopang/gov/gov-fee-calc.mjs로 옮기고 양쪽에서 재사용하는
 * 정리를 후속 PR로 진행할 것 — 지금은 로직 중복을 피하는 게 더 중요해서
 * 우선 그대로 import한다.)
 */

import { resolveProvinceCode, resolveAgencyDisplayName } from './gov-router.js';
import { calcGovReference, calcHondiServiceFee } from '../../../tools/gov-fee-seed/scripts/gov_fee_calc.mjs';

// ── 시코드 정규화 ──────────────────────────────────────────────────
// trace에서 SP-CITY-{시코드} 형태를 뽑아 소문자로 되돌린다.
// (gov-router.js가 만드는 형식과 정확히 반대 연산 — SP-CITY-${시코드.toUpperCase()})
export function extractCityCodeFromTrace(trace) {
  const t = Array.isArray(trace) ? trace : [];
  for (const entry of t) {
    const m = /^SP-CITY-(.+)$/.exec(entry);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

// 초기 시드 데이터의 region_code 표기 불일치를 흡수하기 위한 후보 목록.
// (근본 수정 전까지 임시 — 위 파일 상단 "알려진 이슈" 참조)
function _regionCodeCandidates(cityCode) {
  if (!cityCode) return [];
  const candidates = new Set([cityCode]);
  const short = cityCode.includes('_') ? cityCode.split('_').slice(1).join('_') : null;
  if (short) candidates.add(short);
  return [...candidates];
}

// ── 서비스명 매칭 (v1: 키워드 스코어링) ───────────────────────────────
// TODO(후속 작업): hondi-entity-registry에 이미 구축된 Cloudflare Workers AI
// bge-m3 + Vectorize 시맨틱 검색을 재사용하면 자연어 요청("등본 떼줘")에서
// 훨씬 정확히 매칭된다. 지금은 그 인프라를 이 계산 경로까지 연결하지 않은
// 상태라, 우선 순수 키워드 겹침 점수로 v1을 구현한다 — matchServiceName()
// 함수 시그니처만 그대로 유지하면 나중에 벡터 검색으로 갈아끼워도 호출부는
// 안 바뀐다.
function _tokenize(text) {
  return String(text || '')
    .replace(/[()·・,./]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function matchServiceName(userText, records) {
  const queryTokens = new Set(_tokenize(userText));
  if (queryTokens.size === 0) return null;

  let best = null;
  let bestScore = 0;
  for (const record of records) {
    const nameTokens = _tokenize(record.service_name);
    let overlap = 0;
    for (const t of nameTokens) {
      if (queryTokens.has(t)) overlap++;
      else {
        // 부분 문자열 겹침도 약하게 인정 (형태소 분석기가 없는 v1 한계 보완)
        for (const q of queryTokens) {
          if (q.length >= 2 && (t.includes(q) || q.includes(t))) {
            overlap += 0.5;
            break;
          }
        }
      }
    }
    const score = overlap / Math.max(nameTokens.length, 1);
    if (score > bestScore) {
      bestScore = score;
      best = record;
    }
  }
  // 너무 약한 매칭은 버린다 — 잘못된 서비스에 잘못된 요금을 매칭하는 것보다
  // "못 찾음"이 훨씬 안전하다 (과금 오류는 신뢰 손상이 크다).
  return bestScore >= 0.34 ? best : null;
}

// ── PocketBase 조회 ─────────────────────────────────────────────────
async function _fetchCandidates(pb, { regionCodes, includeNational = true }) {
  const filters = [];
  if (regionCodes.length) {
    filters.push(regionCodes.map((c) => `region_code = "${c}"`).join(' || '));
  }
  if (includeNational) {
    filters.push('scope = "national"');
  }
  if (!filters.length) return [];
  const filter = filters.map((f) => `(${f})`).join(' || ');
  return pb.collection('gov_fee_schedule').getFullList({ filter, batch: 500 });
}

/**
 * 메인 진입점. gov-router.js가 이미 계산해둔 trace를 넘겨받아 요금을 찾는다.
 *
 * @param {object} pb - PocketBase 클라이언트 인스턴스 (인증 완료된 상태)
 * @param {string} userText - 사용자 발화 원문 (서비스명 매칭용)
 * @param {string[]} trace - assembleGovSystemPrompt()가 반환한 trace 배열
 * @param {object} [calcInputs] - formula_type 레코드 계산에 필요한 입력값
 *   (예: { amount, isEfile, parties, count } — 인지세/인지대/송달료용)
 * @returns {Promise<{
 *   status: 'OK'|'NEEDS_APPROVAL'|'NOT_FOUND',
 *   record: object|null,
 *   govReferenceFee: number|null,
 *   hondiServiceFee: number|null,
 *   isBaselineFallback: boolean,
 *   message: string,
 * }>}
 */
export async function resolveGovFee(pb, userText, trace, calcInputs = {}) {
  const cityCode = extractCityCodeFromTrace(trace);
  const regionCandidates = _regionCodeCandidates(cityCode);

  // 1) 사용자 관할 지역의 REAL 레코드 우선
  let candidates = await _fetchCandidates(pb, { regionCodes: regionCandidates, includeNational: true });
  let isBaselineFallback = false;

  let match = matchServiceName(userText, candidates.filter((r) => r.status === 'REAL'));

  // 2) 지역 매칭이 없으면 BASELINE(천안시)으로 폴백 — 반드시 승인 필요로 표시
  if (!match) {
    const baseline = await _fetchCandidates(pb, {
      regionCodes: ['chungnam_cheonan', 'cheonan'],
      includeNational: false,
    });
    match = matchServiceName(userText, baseline.filter((r) => r.status === 'REAL'));
    if (match) isBaselineFallback = true;
  }

  if (!match) {
    return {
      status: 'NOT_FOUND',
      record: null,
      govReferenceFee: null,
      hondiServiceFee: null,
      isBaselineFallback: false,
      message: '해당 서비스의 요금 정보를 찾지 못했습니다. 담당자 확인이 필요합니다.',
    };
  }

  if (match.status === 'NEEDS_REVIEW' || match.status === 'MISSING') {
    return {
      status: 'NEEDS_APPROVAL',
      record: match,
      govReferenceFee: null,
      hondiServiceFee: null,
      isBaselineFallback,
      message: '이 서비스는 요금이 조례·별표 참조로만 되어 있어 자동 계산할 수 없습니다. 담당자 확인 후 진행해 주세요.',
    };
  }

  const govReferenceFee = calcGovReference(match, calcInputs);
  const hondiServiceFee = calcHondiServiceFee(match, calcInputs);

  if (isBaselineFallback) {
    return {
      status: 'NEEDS_APPROVAL',
      record: match,
      govReferenceFee,
      hondiServiceFee,
      isBaselineFallback: true,
      message: `이 지역의 정확한 금액은 확인되지 않아 ${match.source} 기준 추정치(${hondiServiceFee ?? '확인 필요'}원)를 사용합니다. 진행 전 사용자 승인이 필요합니다.`,
    };
  }

  return {
    status: 'OK',
    record: match,
    govReferenceFee,
    hondiServiceFee,
    isBaselineFallback: false,
    message: `${match.service_name} — 혼디 서비스 수수료 ${hondiServiceFee}원 (참고: 정부 납부 기준액 ${govReferenceFee}원, 실제 정부 납부는 사용자 직접 처리)`,
  };
}
