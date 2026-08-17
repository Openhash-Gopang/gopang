// law-api-client.js
// ═══════════════════════════════════════════════════
// 법제처 국가법령정보 공동활용(open.law.go.kr) 행정규칙(훈령·예규·고시·
// 지침) API 클라이언트. REGULATION-INGESTION-PIPELINE-DESIGN_v1_0.md
// §2(수집) 단계의 실제 구현.
//
// ★★★ 2026-08-16 라이브 검증 완료 ★★★
// 주피터가 실제 OC 계정(openhash)으로 목록조회를 실행해 실제 응답을
// 확보, 아래 필드명·구조를 대조 검증했다. 확인된 사실:
// - 루트 요소는 <AdmRulSearch>, 각 항목은 <admrul id="N">로 감싸짐
//   (파서는 정규식 청크 분리 방식이라 루트/래퍼 요소명과 무관하게 동작)
// - 13개 필드명(행정규칙일련번호~생성일자) 전부 정확히 일치
// - query=경찰청 검색은 결과 대부분의 소관부처명이 실제로 "경찰청"으로
//   나와, searchAdminRulesByInstitutionNameFallback()의 전제(query
//   검색이 기관명과 합리적으로 연관된 결과를 준다)가 맞는 것으로 확인
// - 행정규칙명 필드는 CDATA로 감싸져 있어(개행 포함) 별도 파싱 필요
//   했음 — 아래 parseAdminRuleListXmlRegexFallback에서 수정 완료
//
// ★ 아직 미확인 ★
// - org(소관부처 코드) 파라미터명 — query 방식이 이미 잘 작동해
//   우선순위가 낮아짐, 필요시 추가 확인
// - 본문조회(lawService.do) 응답 — 목록조회만 검증됨, 본문 HTML 구조는
//   아직 실제로 못 봄
// - JSON 응답 지원 여부 — XML만 확인
// ═══════════════════════════════════════════════════

const LAW_API_BASE = 'https://www.law.go.kr/DRF';

/**
 * @param {string} ocId - law.go.kr에서 발급받은 사용자 ID(이메일 아이디 부분).
 *   개발/테스트 단계에서는 공개 테스트 계정 'test'가 동작하는 것으로
 *   검색 스니펫에서 확인됨(단, 실사용 배포 시 반드시 정식 가입 후 개별
 *   OC 발급 — 'test' 계정은 요청량 제한이 있을 가능성이 높음, 미확인).
 */
export function createLawApiClient(ocId = 'test') {
  /**
   * 행정규칙 목록 조회.
   * @param {object} opts
   * @param {string} [opts.query] - 검색어(기관명 또는 규정명 키워드).
   *   확인된 예시: query=경찰청 형식으로 소관부처명이 결과에 섞여
   *   나오는 걸 봤을 때, 이 파라미터가 전문검색(규정명+본문 일부)일
   *   가능성이 있다 — 정확한 소관부처 필터가 아닐 수 있음(미확인).
   * @param {string} [opts.org] - 소관부처 코드(추정 파라미터명, 공식
   *   가이드 문서를 직접 열람하지 못해 미확인 — 실패 시 query만으로
   *   조회 후 클라이언트 사이드 필터링 폴백을 쓸 것, 아래 참고).
   * @param {number} [opts.page] - 페이지 번호(1부터).
   * @param {number} [opts.display] - 페이지당 건수.
   * @returns {Promise<object[]>} 파싱된 행정규칙 목록(필드명은 §응답
   *   필드 매핑 참고).
   */
  async function searchAdminRules({ query, org, page = 1, display = 100 } = {}) {
    const params = new URLSearchParams({
      OC: ocId,
      target: 'admrul',
      type: 'XML', // JSON 미검증 — XML만 확인된 값
      page: String(page),
      display: String(display),
    });
    if (query) params.set('query', query);
    if (org) params.set('org', org); // ★ 파라미터명 미확인, 검증 필요

    const url = `${LAW_API_BASE}/lawSearch.do?${params.toString()}`;
    const res = await fetch(url + '&_cachebust=' + Date.now());
    if (!res.ok) throw new Error(`law.go.kr 목록조회 실패: HTTP ${res.status}`);
    const xmlText = await res.text();
    return parseAdminRuleListXml(xmlText);
  }

  /**
   * 행정규칙 본문 조회.
   * @param {string} adminRuleId - **반드시 "행정규칙일련번호"를 넘길 것**
   *   (예: 2100000266560, 긴 번호). "행정규칙ID"(예: 29940, 짧은 번호)를
   *   넘기면 안 된다 — 2026-08-16 실측(GitHub Actions 라이브 실행)에서
   *   확인: 상세링크 필드("/DRF/lawService.do?...&ID=...")가 실제로는
   *   행정규칙일련번호를 쓰는데, 호출부가 실수로 행정규칙ID를 먼저
   *   골라 넘겨 15건 연속으로 빈 HTML 껍데기(1842자 고정, 실제 조문
   *   내용 없음)만 돌아오는 버그가 있었다. 호출부에서
   *   `reg.행정규칙일련번호 || reg.행정규칙ID` 순서를 반드시 지킬 것
   *   (반대로 하면 이 버그가 재발한다).
   * @returns {Promise<string>} XML 본문(2026-08-17부로 type=XML 사용 —
   *   type=HTML은 JS 렌더링 뷰어 셸만 반환해 사용 불가로 확인됨).
   *   태그 안에 실제 조문 텍스트가 들어있을 것으로 기대 — 정규식
   *   필터(passesRegexFilter)는 태그 유무와 무관하게 원문 텍스트
   *   패턴을 찾으므로 별도 XML 파싱 없이도 동작해야 하나, 다음
   *   실측에서 실제로 원문이 담겼는지 재확인 필요.
   */
  async function fetchAdminRuleText(adminRuleId) {
    const params = new URLSearchParams({
      OC: ocId,
      target: 'admrul',
      ID: adminRuleId,
      // ★ 2026-08-16 세 번째 수정 ★ type=HTML은 mobileYn 유무와 무관하게
      // jQuery AJAX 로더 뷰어 셸("$(document).ready(function(){...")만
      // 반환함을 로컬 실측(2026-08-17)으로 재확인 — 이건 브라우저에서
      // JS가 실행돼야 실제 내용을 채우는 미리보기 페이지지, 원문 API
      // 응답이 아니다. 목록조회(searchAdminRules)가 type=XML로 완벽하게
      // 구조화된 실제 데이터를 준 전례를 따라, 본문조회도 XML로 전환.
      type: 'XML',
    });
    const url = `${LAW_API_BASE}/lawService.do?${params.toString()}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`law.go.kr 본문조회 실패: HTTP ${res.status} (ID=${adminRuleId})`);
    return res.text();
  }

  /**
   * org 파라미터가 실제로 안 먹히는 경우를 위한 폴백 — query로 넓게
   * 검색한 뒤, 응답의 "소관부처명" 필드가 원하는 기관명과 일치하는
   * 항목만 클라이언트 사이드에서 걸러낸다. 정확도는 떨어지지만(다른
   * 기관 결과가 섞여올 수 있음) org 파라미터명이 확인되기 전까지
   * 안전한 대체 경로다.
   */
  async function searchAdminRulesByInstitutionNameFallback(기관명, opts = {}) {
    const all = await searchAdminRules({ query: 기관명, ...opts });
    return all.filter(r => r.소관부처명 === 기관명);
  }

  return { searchAdminRules, fetchAdminRuleText, searchAdminRulesByInstitutionNameFallback };
}

/**
 * XML 응답 파싱. 검색 스니펫에서 확인된 필드(태그가 닫히지 않은 형태로
 * 노출된 스니펫이라 정확한 XML 스키마는 추정 — 실제로는 <행정규칙일련번호>
 * 123</행정규칙일련번호> 형태의 정상 XML일 것으로 가정하고 표준 파서를
 * 쓴다. 브라우저/Worker 환경엔 DOMParser가 없을 수 있으니 정규식 기반
 * 경량 파서를 대체로 준비해둔다(아래 parseAdminRuleListXmlRegexFallback).
 */
function parseAdminRuleListXml(xmlText) {
  try {
    // Cloudflare Workers에는 DOMParser가 없다 — 정규식 파서를 기본으로 쓴다.
    return parseAdminRuleListXmlRegexFallback(xmlText);
  } catch (e) {
    console.warn('[law-api-client] XML 파싱 실패, 원문 그대로 반환:', e?.message);
    return [{ _raw: xmlText, _parseError: e?.message }];
  }
}

// 확인된 필드명(검색 스니펫 근거):
// 행정규칙일련번호, 행정규칙명, 행정규칙종류(훈령/예규/고시/규정/지침 등),
// 발령일자, 발령번호, 소관부처명, 현행연혁구분(현행/연혁),
// 제개정구분코드, 제개정구분명(제정/일부개정/전부개정 등),
// 행정규칙ID, 행정규칙상세링크, 시행일자, 생성일자
const ADMIN_RULE_FIELDS = [
  '행정규칙일련번호', '행정규칙명', '행정규칙종류', '발령일자', '발령번호',
  '소관부처명', '현행연혁구분', '제개정구분코드', '제개정구분명',
  '행정규칙ID', '행정규칙상세링크', '시행일자', '생성일자',
];

function parseAdminRuleListXmlRegexFallback(xmlText) {
  // ★ 2026-08-16 수정 ★ 실제 law.go.kr 응답(root: <AdmRulSearch>, 각
  // 항목: <admrul id="N">...)으로 검증한 결과, 필드명은 전부 정확했으나
  // 행정규칙명 필드가 CDATA로 감싸져 있어(개행·공백 포함:
  // "<행정규칙명>\n<![CDATA[ 규칙명 ]]>\n</행정규칙명>") 기존 단순
  // "<태그>([^<]*)</태그>" 정규식이 놓쳤다(CDATA 시작 태그의 "<"에서
  // 캡처가 끊김). 필드마다 CDATA 유무가 다를 수 있으므로, CDATA 있으면
  // 그 안쪽을, 없으면 기존 방식을 쓰는 두 갈래 매칭으로 수정.
  const chunks = xmlText.split(/(?=<행정규칙일련번호>)/).filter(c => c.includes('<행정규칙일련번호>'));
  return chunks.map(chunk => {
    const item = {};
    for (const field of ADMIN_RULE_FIELDS) {
      const cdataMatch = chunk.match(new RegExp(`<${field}>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${field}>`));
      if (cdataMatch) {
        item[field] = cdataMatch[1].trim();
        continue;
      }
      const plainMatch = chunk.match(new RegExp(`<${field}>([^<]*)</${field}>`));
      item[field] = plainMatch ? plainMatch[1].trim() : null;
    }
    return item;
  });
}

export { parseAdminRuleListXmlRegexFallback, ADMIN_RULE_FIELDS };
