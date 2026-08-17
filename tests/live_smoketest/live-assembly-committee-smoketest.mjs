#!/usr/bin/env node
/**
 * live-assembly-committee-smoketest.mjs
 *
 * national-division-router.js 최초 신설(2026-08-16) 시 "국회 상임위원회는
 * 이번 배선 1차 범위에서 제외"로 남겨뒀던 갭을 2026-08-17에 채웠다 —
 * 이 파일은 그 배선(guessAssemblyCommitteeFromText/resolveAssemblyCommitteeLazy,
 * gov-router.js -0.85 단계)이 18개 상임위원회 전부에서 실제로 동작하는지
 * 검증한다.
 *
 * 실행: node tests/live_smoketest/live-assembly-committee-smoketest.mjs
 */

global.window = {};
const mod = await import('../../src/gopang/gov/gov-router.js');

const raw = await (await fetch(
  'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/gov-tree/09-national/policy-bodies/divisions/assembly-committee-master-data.json'
)).json();

let pass = 0, fail = 0;
for (const c of raw.위원회목록) {
  const text = `${c.위원회명}에 문의하고 싶습니다`;
  const result = await mod.assembleGovSystemPrompt(text, null, null, null);
  const traceStr = JSON.stringify(result.trace);
  const ok = traceStr.includes(`SP-ASSEMBLYCOMMITTEE-LAZY(${c.위원회코드}`);
  console.log(`[${c.위원회코드}] ${c.위원회명} | ${ok ? 'PASS' : 'FAIL'} | trace: ${traceStr}`);
  ok ? pass++ : fail++;
}

console.log(`\n${'='.repeat(50)}`);
console.log(`결과: PASS ${pass} / FAIL ${fail} (총 ${raw.위원회목록.length}개 위원회)`);
process.exit(fail > 0 ? 1 : 0);
