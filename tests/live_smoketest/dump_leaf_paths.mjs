// tests/live_smoketest/dump_leaf_paths.mjs (2026-08-10 신설)
//
// 2026-08-10 subject-gate.js flat→계층형 리팩터 이후, 기존
// subject_gate_live_smoketest.py는 root_id 하나에 대해 "전체 리프
// 후보를 한 방에 보여주고 정답 리프를 맞히는지"만 채점했다 — 이건
// 옛 flat 게이트를 테스트하는 방식이라 지금 production(refineToLeaf가
// 여러 단계를 나눠서 도는 방식)과 더 이상 일치하지 않는다.
//
// 이 스크립트는 각 리프에 대해 "실제로 refineToLeaf가 몇 번의 게이트
// 호출을 거치고, 각 호출에서 정답으로 어떤 id를 골라야 그 리프에
// 도달하는지"를 EXPERT_REGISTRY.parentKey 체인을 그대로 따라가며
// 계산한다(재구현 아님 — refineToLeaf의 분기 조건(직계 자식 수 0/1/2+)을
// 그대로 재현하되, 실제로 쓰는 데이터는 EXPERT_REGISTRY와
// getConsultableChildren 그 자체). 출력은 subject_gate_hierarchical_
// live_smoketest.py가 시나리오별로 그대로 참조한다.
//
// Usage: node dump_leaf_paths.mjs professor

globalThis.window = globalThis;
globalThis.location = globalThis.location || { origin: 'https://hondi.net' };
globalThis.addEventListener = globalThis.addEventListener || (() => {});
globalThis.removeEventListener = globalThis.removeEventListener || (() => {});

import { EXPERT_REGISTRY, getConsultableChildren, getLeafDescendants } from '../../src/gopang/ai/expert-registry.js';

const roots = process.argv.slice(2);
const out = {};

for (const root of roots) {
  const leaves = getLeafDescendants(root);
  for (const leaf of leaves) {
    // leafId부터 parentKey를 따라 올라가 root까지의 체인을 구한 뒤 뒤집는다.
    const upChain = [leaf.id];
    let cur = leaf.id;
    while (EXPERT_REGISTRY[cur] && EXPERT_REGISTRY[cur].parentKey) {
      cur = EXPERT_REGISTRY[cur].parentKey;
      upChain.push(cur);
      if (cur === root) break;
    }
    const downChain = upChain.reverse(); // [root, ..., leaf.id]

    // refineToLeaf와 동일한 규칙: 직계 자식이 2개 이상인 노드에서만
    // 실제 게이트 호출(=이 스텝)이 발생한다. 1개면 호출 없이 통과.
    const steps = [];
    for (let i = 0; i < downChain.length - 1; i++) {
      const nodeId = downChain[i];
      const nextId = downChain[i + 1];
      const children = getConsultableChildren(nodeId);
      if (children.length > 1) {
        steps.push({ gateNodeId: nodeId, correctChoiceId: nextId });
      }
    }
    out[leaf.id] = steps;
  }
}

process.stdout.write(JSON.stringify(out));
