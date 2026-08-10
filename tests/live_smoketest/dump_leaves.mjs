// tests/live_smoketest/dump_leaves.mjs (2026-08-08 신설, 2026-08-09/10 개정)
//
// subject_gate_live_smoketest.py가 서브프로세스로 호출한다. 인자로 받은
// root_id(professor/physician/lawyer 등)들의 실제 후보 목록을 JSON으로
// stdout에 출력한다 — 시나리오 파일이나 하네스에 리프 목록을 하드코딩해두면
// expert-registry-*.js가 갱신될 때마다 따로 손봐야 하는 drift가 생기므로,
// 항상 소스 오브 트루스(레지스트리)를 직접 읽는다. subject-gate.js가 실제로
// 만드는 후보 메뉴와 완전히 동일한 소스를 쓴다.
//
// 2026-08-09 개정 — LEAF_SYNONYMS 보강(_leafMenuLine)이 빠져 있던 걸 발견,
// production 함수를 그대로 가져다 쓰도록 수정(재구현 아님).
//
// 2026-08-10 개정 — subject-gate.js가 완전공백 과목 억지매칭 문제를
// "확신이 없으면 null" 프롬프트 지시(2026-08-09판, 실사 재검증에서 효과
// 없음을 확인)에서 "해당 없음"을 후보 목록의 정식 항목으로 넣는 구조로
// 바꿨다(_buildGateCandidates). 이 스크립트도 getLeafDescendants() 결과를
// 그대로 안 쓰고 _buildGateCandidates를 거쳐서, production이 실제로 보는
// "리프 + 해당없음" 전체 후보 목록을 그대로 재현한다 — 이전에 LEAF_SYNONYMS
// 보강을 빠뜨렸던 것과 같은 종류의 하네스/프로덕션 불일치를 이번엔 처음부터
// 피한다.
//
// Usage: node dump_leaves.mjs professor physician lawyer

// subject-gate.js가 정적 import하는 core/config.js 체인이 브라우저 전역을
// 참조하므로 최소 셔밍(expert-session.js 렌더 스크립트와 동일 패턴).
globalThis.window = globalThis;
globalThis.location = globalThis.location || { origin: 'https://hondi.net' };
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

import { getLeafDescendants } from '../../src/gopang/ai/expert-registry.js';
import { _leafMenuLine, _buildGateCandidates, LEAF_SYNONYMS } from '../../src/gopang/ai/subject-gate.js';

const roots = process.argv.slice(2);
const out = {};
for (const root of roots) {
  const leaves = getLeafDescendants(root);
  // refineToLeaf()는 leaves.length<=1이면 게이트 자체를 안 돈다 — 그 경우
  // 후보 목록 구성이 무의미하므로 여기서도 원래 리프만 그대로 낸다.
  const candidates = leaves.length <= 1 ? leaves : _buildGateCandidates(root, leaves);
  out[root] = candidates.map((leaf) => ({
    ...leaf,
    menuLine: _leafMenuLine(leaf),
    hasSynonyms: Boolean(LEAF_SYNONYMS[leaf.id]),
    isNoneOfTheAbove: leaf.id === root && leaves.length > 1,
  }));
}
process.stdout.write(JSON.stringify(out));
