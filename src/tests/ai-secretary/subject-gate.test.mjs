// subject-gate.test.mjs (2026-08-08 신설)
// 실행: node --experimental-test-module-mocks --test src/tests/ai-secretary/subject-gate.test.mjs
//
// 검증 대상:
// ① getLeafDescendants — professor/physician/lawyer처럼 다단(3단)
//    트리를 가진 상위 personaId 아래의 실제 리프만 재귀 수집하는가
//    (중계열 자신은 안 섞이는가).
// ② 리프가 하나뿐이거나 없는 personaId는 게이트를 타지 않고 원래
//    personaId를 그대로 반환하는가.
// ③ 게이트 LLM 응답이 후보 화이트리스트에 있는 id를 고르면 그 id로
//    정밀화되는가.
// ④ 게이트 LLM이 후보에 없는 id를 지어내거나 null을 반환하면 원래
//    personaId로 안전하게 폴백하는가.
// ⑤ 네트워크 실패 시에도 예외를 던지지 않고 원래 personaId로 폴백하는가.

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;

const CFG_MODULE = { CFG: { endpoint: 'https://fake.endpoint' } };

const { mock: registryMock } = mock.module('../../gopang/core/config.js', {
  namedExports: CFG_MODULE,
});

const { getLeafDescendants } = await import('../../gopang/ai/expert-registry.js');

describe('getLeafDescendants — 다단 트리 리프만 재귀 수집', () => {
  test('professor 아래에는 중계열/소계열 섞이지 않고 소계열(리프)만 나온다', () => {
    const leaves = getLeafDescendants('professor');
    assert.ok(leaves.length > 50, `리프가 최소 50개 이상이어야 함 (실제: ${leaves.length})`);
    // 중계열(교수(...중계열)) 라벨은 리프 목록에 없어야 한다
    const midTierLeak = leaves.find(l => l.label.includes('중계열'));
    assert.equal(midTierLeak, undefined, '중계열 노드가 리프로 잘못 섞임');
  });

  test('자식이 없는 리프 personaId는 자기 자신만 담긴 배열을 반환한다', () => {
    const leaves = getLeafDescendants('professor-semiconductor');
    assert.equal(leaves.length, 1);
    assert.equal(leaves[0].id, 'professor-semiconductor');
  });

  test('존재하지 않는 personaId는 빈 배열을 반환한다', () => {
    const leaves = getLeafDescendants('no-such-persona-xyz');
    assert.deepEqual(leaves, []);
  });
});

describe('refineToLeaf — 2단계 과목 게이트', () => {
  test('리프 personaId는 fetch 없이 그대로 반환된다', async () => {
    mock.method(globalThis, 'fetch', () => {
      throw new Error('리프 personaId에서는 fetch가 호출되면 안 됨');
    });
    const { refineToLeaf } = await import('../../gopang/ai/subject-gate.js?t=' + Date.now());
    const result = await refineToLeaf('professor-semiconductor', '반도체 공정 질문 있어요');
    assert.equal(result, 'professor-semiconductor');
    mock.restoreAll();
  });

  test('게이트가 화이트리스트 안의 id를 고르면 그 id로 정밀화된다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"id": "professor-semiconductor"}' } }] }),
    }));
    const { refineToLeaf } = await import('../../gopang/ai/subject-gate.js?t=' + Date.now());
    const result = await refineToLeaf('professor-materials-series', '반도체공학 지도 받고 싶어요');
    assert.equal(result, 'professor-semiconductor');
    mock.restoreAll();
  });

  test('게이트가 후보에 없는 id를 지어내면 원래 personaId로 폴백한다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"id": "professor-made-up-nonexistent"}' } }] }),
    }));
    const { refineToLeaf } = await import('../../gopang/ai/subject-gate.js?t=' + Date.now());
    const result = await refineToLeaf('professor-materials-series', '애매한 질문');
    assert.equal(result, 'professor-materials-series');
    mock.restoreAll();
  });

  test('게이트가 {"id": null}을 반환하면 원래 personaId로 폴백한다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"id": null}' } }] }),
    }));
    const { refineToLeaf } = await import('../../gopang/ai/subject-gate.js?t=' + Date.now());
    const result = await refineToLeaf('professor-materials-series', '애매한 질문');
    assert.equal(result, 'professor-materials-series');
    mock.restoreAll();
  });

  test('네트워크 실패 시 예외 없이 원래 personaId로 폴백한다', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
    const { refineToLeaf } = await import('../../gopang/ai/subject-gate.js?t=' + Date.now());
    const result = await refineToLeaf('professor', '아무 질문');
    assert.equal(result, 'professor');
    mock.restoreAll();
  });

  test('초등 수준 동의어(산수)로 물어도 게이트 메뉴에 실려 professor-math로 정밀화된다', async () => {
    let capturedSystemPrompt = null;
    mock.method(globalThis, 'fetch', async (url, opts) => {
      capturedSystemPrompt = JSON.parse(opts.body).messages[0].content;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"id": "professor-math"}' } }] }),
      };
    });
    const { refineToLeaf } = await import('../../gopang/ai/subject-gate.js?t=' + Date.now());
    const result = await refineToLeaf('professor', '초등학생인데 구구단 산수 좀 가르쳐 주세요');
    assert.equal(result, 'professor-math');
    assert.ok(capturedSystemPrompt.includes('구구단'), '게이트 메뉴에 초등 동의어(구구단)가 포함돼야 함');
    mock.restoreAll();
  });
});
