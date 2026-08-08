// tests/live_smoketest/dump_leaves.mjs (2026-08-08 신설)
//
// subject_gate_live_smoketest.py가 서브프로세스로 호출한다. 인자로 받은
// root_id(professor/physician/lawyer 등)들의 실제 리프 후보 목록을
// getLeafDescendants()로 뽑아 JSON으로 stdout에 출력한다 — 시나리오
// 파일이나 하네스에 리프 목록을 하드코딩해두면 expert-registry-*.js가
// 갱신될 때마다 따로 손봐야 하는 drift가 생기므로, 항상 소스 오브
// 트루스(레지스트리)를 직접 읽는다. subject-gate.js가 실제로 만드는
// 후보 메뉴와 완전히 동일한 소스를 쓴다.
//
// Usage: node dump_leaves.mjs professor physician lawyer
import { getLeafDescendants } from '../../src/gopang/ai/expert-registry.js';

const roots = process.argv.slice(2);
const out = {};
for (const root of roots) {
  out[root] = getLeafDescendants(root);
}
process.stdout.write(JSON.stringify(out));
