#!/usr/bin/env node
/**
 * live-policy-body-collision-audit.mjs
 *
 * ── 배경 ──
 * gov-router.js -0.8) 단계는 `policyBodyGuess && !_guessNatAgencyDomainFromText(text)`
 * 조건으로 정책기관(policy-bodies) 매칭을 게이트한다 — 발화에 지사형
 * 집행기관 키워드(_NAT_AGENCY_DOMAIN_KEYWORDS)가 하나라도 같이 걸리면
 * 정책기관 매칭에 성공했어도 통째로 스킵된다("지사가 우선" 설계,
 * 2026-08-03 커밋 코멘트 참고).
 *
 * 그 커밋은 7개(NTS·KCS·POLICE·MMA·KCG·PPS·PROSECUTION)의 충돌을 찾아
 * 안전한 우회 키워드를 추가했는데, _POLICY_BODY_DOMAIN_KEYWORDS와
 * _NAT_AGENCY_DOMAIN_KEYWORDS 70×34 전수 대조 결과 동일 패턴이 있는
 * 11개(CIO/CONSTCOURT/COTI/JPRI/KMA/MOEL/MOJ/MPVA/NCA/OKA/SUPREMECOURT)가
 * 추가로 발견됐다 — 이 11개는 우회 키워드가 이미 등록돼 있어 완전
 * 차단은 아니지만(2026-08-17 확인), 그 사실이 지금까지 어디에도
 * 문서화·테스트되지 않았다.
 *
 * ── 이 harness가 하는 일 ──
 * 11개 기관 각각에 대해 "충돌 표현"(등록 키워드 중 지사 사전과 겹치는
 * 것)과 "안전 표현"(안 겹치는 것) 두 발화를 실제로 실행해, 가설대로
 * 충돌 표현은 SP-POLICY-LAZY(code)에 못 미치고, 안전 표현은 도달하는지
 * 확인한다.
 *
 * 실행: node tests/live_smoketest/live-policy-body-collision-audit.mjs
 */

global.window = {};
const mod = await import('../../src/gopang/gov/gov-router.js');

// [기관코드, 라벨, [충돌표현, 충돌근거키워드], [안전표현, 안전키워드]]
const CASES = [
  ['CIO', '고위공직자범죄수사처',
    ['고위공직자범죄수사처에 대해 문의하고 싶습니다', '고위공직자범죄수사처(agency:수사)'],
    ['고위공직자 비리 제보를 하고 싶습니다', '고위공직자 비리 제보']],
  ['CONSTCOURT', '헌법재판소사무처',
    ['헌법재판소에 문의하고 싶은 게 있습니다', '헌법재판소(agency:재판)'],
    ['헌법소원을 제기하고 싶은데 어떻게 해야 하나요', '헌법소원']],
  ['COTI', '법원공무원교육원',
    ['법원공무원교육원에 대해 문의하고 싶습니다', '법원공무원교육원(agency:법원)'],
    ['사법행정직 연수과정 문의 드립니다', '사법행정직 연수과정 문의']],
  ['JPRI', '사법정책연구원',
    ['재판제도 연구용역을 의뢰하고 싶습니다', '재판제도 연구용역(agency:재판)'],
    ['사법정책연구원에 문의하고 싶은 게 있습니다', '사법정책연구원']],
  ['KMA', '기상청',
    ['기상청에 문의하고 싶은 게 있습니다', '기상청(agency:기상청)'],
    ['장기예보 정확도 관련 문의 드립니다', '장기예보 정확도 관련 문의']],
  ['MOEL', '고용노동부',
    ['임금체불 진정을 넣고 싶습니다', '임금체불 진정(agency:임금체불)'],
    ['근로기준법 위반 신고를 하고 싶습니다', '근로기준법 위반 신고']],
  ['MOJ', '법무부',
    ['출입국 체류기간 연장에 대해 문의하고 싶습니다', '출입국 체류기간(agency:출입국)'],
    ['체류기간 연장 신청은 어떻게 하나요', '체류기간 연장']],
  ['MPVA', '국가보훈부',
    ['국가보훈부에 문의하고 싶은 게 있습니다', '국가보훈부(agency:보훈)'],
    ['제대군인 지원정책 개선 건의를 하고 싶습니다', '제대군인 지원정책 개선 건의']],
  ['NCA', '법원행정처',
    ['법원행정처에 문의하고 싶은 게 있습니다', '법원행정처(agency:법원)'],
    ['사법행정 예산 편성 문의 드립니다', '사법행정 예산 편성 문의']],
  ['OKA', '재외동포청',
    ['재외동포체류자격 등록을 하고 싶습니다', '재외동포체류자격 등록(agency:체류자격)'],
    ['재외동포청에 문의하고 싶은 게 있습니다', '재외동포청']],
  ['SUPREMECOURT', '대법원',
    ['대법원에 문의하고 싶은 게 있습니다', '대법원(agency:법원)'],
    ['사법제도 개선 의견 제출하고 싶습니다', '사법제도 개선 의견 제출']],
];

let pass = 0, fail = 0;
const rows = [];

for (const [code, label, [collideText, collideKw], [safeText, safeKw]] of CASES) {
  for (const [kind, text, kw] of [['충돌표현(실패 예상)', collideText, collideKw], ['안전표현(성공 예상)', safeText, safeKw]]) {
    let result;
    try {
      result = await mod.assembleGovSystemPrompt(text, null, null, null);
    } catch (e) {
      console.log(`[${code}] ${kind} ERROR: ${e.message}`);
      fail++;
      continue;
    }
    const traceStr = JSON.stringify(result.trace);
    const reached = traceStr.includes(`SP-POLICY-LAZY(${code}`);
    const expected = kind.startsWith('안전');
    const ok = reached === expected;
    console.log(`[${code}] ${kind} | 입력: "${text}" | 도달: ${reached} | trace: ${traceStr} | ${ok ? 'PASS' : 'FAIL'}`);
    rows.push({ 기관코드: code, 기관명: label, 유형: kind, 발화: text, 근거키워드: kw, 도달여부: reached, 판정: ok ? 'PASS' : 'FAIL' });
    ok ? pass++ : fail++;
  }
}

console.log(`\n${'='.repeat(60)}`);
console.log(`결과: PASS ${pass} / FAIL ${fail} (총 ${CASES.length * 2}건, 기관 ${CASES.length}개 × 2)`);
console.log(`기대: 충돌표현은 전부 도달 실패(FAIL이 아니라 가설 확인), 안전표현은 전부 도달 성공`);

import { writeFileSync } from 'node:fs';
writeFileSync('../../results/policy_body_collision_audit.json', JSON.stringify(rows, null, 2));
console.log('결과 저장: results/policy_body_collision_audit.json');

process.exit(fail > 0 ? 1 : 0);
