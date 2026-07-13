/**
 * ksco-lookup.js — 한국표준직업분류(KSCO) 코드→명칭 조회/검증 모듈
 *
 * AC-AUTHOR_v1_0.md §3 근거. data/ksco_2024_v8.json(코드 1,999개, 통계청
 * 고시 제2024-328호)을 단일 소스로 삼는다 — KSIC(worker.js KSIC_LABELS,
 * 업종/사업자용)와는 완전히 별개이며 절대 혼용하지 않는다.
 *
 * 목적: personal-assistant SP(LLM)가 대화 중 추정한 job_ksco.code/label을
 * "정말 그 코드가 그 명칭이 맞는지" 코드 레벨에서 한 번 더 검증한다 —
 * 프롬프트 지침(U2: 지어내지 않기)만으로는 환각을 완전히 막을 수 없으므로,
 * 서버 저장 직전(welcome.js handleProfileSubmit)에 이 모듈로 대조해
 * 불일치하면 사실(label)을 정정하거나, 존재하지 않는 코드면 통째로
 * 제거한다 — U2의 "지어낸 값 저장 금지"를 코드로 강제하는 방어선.
 */

let _cache = null;
let _loadingPromise = null;

async function _load() {
  if (_cache) return _cache;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = fetch('/data/ksco_2024_v8.json')
    .then((res) => {
      if (!res.ok) throw new Error(`ksco_2024_v8.json 로드 실패: HTTP ${res.status}`);
      return res.json();
    })
    .then((data) => {
      _cache = data;
      return _cache;
    })
    .catch((e) => {
      console.warn('[ksco-lookup] 로드 실패, 검증 없이 통과시킴:', e.message);
      _loadingPromise = null;
      return null;
    });
  return _loadingPromise;
}

/** code(1~5자리 KSCO 코드) → {label, level, parent} | null */
export async function resolveByCode(code) {
  if (!code) return null;
  const data = await _load();
  if (!data) return null; // 로드 실패 시 검증 자체를 건너뜀(가입 흐름을 막지 않음)
  return data.codes[String(code)] || null;
}

/**
 * job_ksco 객체를 실제 KSCO 데이터로 검증·정정한다.
 * - code가 존재하지 않는 코드면 code/label 모두 버리고 raw_input만 남김.
 * - code는 존재하나 label이 실제 명칭과 다르면(LLM이 살짝 다르게 지어낸
 *   경우) 실제 명칭으로 조용히 정정한다 — 사용자에게 재확인을 요구하지
 *   않는다(U0 — 진행을 막지 않되, 저장되는 값은 항상 사실이어야 한다).
 * - code가 아예 없으면(넘겨받지 못함) 그대로 둔다(§0-1[A]의 raw_input만
 *   있는 상태를 허용).
 */
export async function validateJobKsco(jobKsco) {
  if (!jobKsco || typeof jobKsco !== 'object') return jobKsco;
  if (!jobKsco.code) return jobKsco; // code 없음 = 애초에 검증 대상 아님

  const entry = await resolveByCode(jobKsco.code);
  if (!entry) {
    // 존재하지 않는 코드 — LLM이 지어낸 코드일 가능성. 원문은 raw_input으로
    // 보존하되 code/label은 폐기해 잘못된 확정값이 저장되지 않게 한다.
    return {
      ...jobKsco,
      code: null,
      label: null,
      level: null,
      raw_input: jobKsco.label || jobKsco.raw_input || null,
      source: 'unconfirmed',
    };
  }
  return {
    ...jobKsco,
    label: entry.label, // 항상 사실 소스로 덮어씀 — LLM이 쓴 label 문자열은 신뢰하지 않음
    level: entry.level,
  };
}

/**
 * 자유 텍스트 검색(부분 문자열 매칭) — 향후 프로필 설정 화면에 수동
 * 선택/자동완성 UI를 붙일 때 쓸 수 있도록 미리 노출해 둔다(v1.0 시점엔
 * 호출부 없음 — personal-assistant SP가 전부 대화로 처리하므로, 이건
 * 대화 추정이 실패했을 때의 수동 보정 경로용 유틸리티).
 * @param {string} query
 * @param {number} limit
 * @returns {Promise<Array<{code:string,label:string,level:number}>>}
 */
export async function search(query, limit = 20) {
  const data = await _load();
  if (!data || !query || !query.trim()) return [];
  const q = query.trim();
  const results = [];
  for (const [code, entry] of Object.entries(data.codes)) {
    if (entry.label.includes(q)) {
      results.push({ code, label: entry.label, level: entry.level });
      if (results.length >= limit) break;
    }
  }
  // 세세분류(level 5)를 우선 노출 — 실제 선택 가능한 최종 직업명일 확률이 높음
  results.sort((a, b) => b.level - a.level);
  return results;
}
