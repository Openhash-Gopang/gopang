// tests/live_smoketest/dump_leaves.mjs (2026-08-08 신설, 2026-08-09 개정)
//
// subject_gate_live_smoketest.py가 서브프로세스로 호출한다. 인자로 받은
// root_id(professor/physician/lawyer 등)들의 실제 리프 후보 목록을
// getLeafDescendants()로 뽑아 JSON으로 stdout에 출력한다 — 시나리오
// 파일이나 하네스에 리프 목록을 하드코딩해두면 expert-registry-*.js가
// 갱신될 때마다 따로 손봐야 하는 drift가 생기므로, 항상 소스 오브
// 트루스(레지스트리)를 직접 읽는다. subject-gate.js가 실제로 만드는
// 후보 메뉴와 완전히 동일한 소스를 쓴다.
//
// 2026-08-09 개정 — 초중고 교과-대학 전공 매칭 검증 세션에서, 이 스크립트가
// id/label만 내보내고 subject-gate.js._leafMenuLine()의 LEAF_SYNONYMS
// 보강(예: professor-math에 "구구단"·"산수" 등 초등 어휘 동의어를 괄호로
// 덧붙이는 부분)을 빠뜨리고 있었음을 발견 — 하네스가 파이썬 쪽에서
// "- id: label"만 재조립해 production보다 빈약한 메뉴로 채점하고 있었다.
// subject-gate.js가 이제 _leafMenuLine을 export하므로, 여기서도 그걸
// 그대로 가져다 써서 production과 완전히 동일한 메뉴 텍스트를 만든다
// (재구현 아님 — 이전 세션의 CONTROL-TOWER-PRINCIPLE 렌더 수정과 동일한
// 원칙: 프로덕션 함수를 직접 호출해 "포팅 로직이 어긋날 위험" 자체를 없앤다).
//
// Usage: node dump_leaves.mjs professor physician lawyer

// subject-gate.js가 정적 import하는 core/config.js 체인이 브라우저 전역을
// 참조하므로 최소 셔밍(expert-session.js 렌더 스크립트와 동일 패턴).
globalThis.window = globalThis;
globalThis.location = globalThis.location || { origin: 'https://hondi.net' };
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

import { getLeafDescendants } from '../../src/gopang/ai/expert-registry.js';
import { _leafMenuLine, LEAF_SYNONYMS } from '../../src/gopang/ai/subject-gate.js';

const roots = process.argv.slice(2);
const out = {};
for (const root of roots) {
  out[root] = getLeafDescendants(root).map((leaf) => ({
    ...leaf,
    menuLine: _leafMenuLine(leaf),
    hasSynonyms: Boolean(LEAF_SYNONYMS[leaf.id]),
  }));
}
process.stdout.write(JSON.stringify(out));
