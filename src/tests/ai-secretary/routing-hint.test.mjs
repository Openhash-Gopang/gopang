// routing-hint.test.mjs (2026-08-08 신설)
// 실행: node --experimental-test-module-mocks --test src/tests/ai-secretary/routing-hint.test.mjs
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;

const { mock: cfgMock } = mock.module('../../gopang/core/config.js', {
  namedExports: { CFG: { endpoint: 'https://fake.endpoint' } },
});

const { EXPERT_REGISTRY } = await import('../../gopang/ai/expert-registry.js');

function loadGwpRegistry() {
  const src = fs.readFileSync(new URL('../../../gwp-registry.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, fetch: async () => ({ ok: false }), console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.GWP_REGISTRY;
}
const GWP_REGISTRY = loadGwpRegistry();

describe('buildRoutingHintPart — 0단계 강신호(1단계 LLM 호출 없이 처리)', () => {
  test('"헌법재판소 결정 분석해줘" — klaw가 강신호("재판")라 fetch 없이 힌트를 만든다', async () => {
    mock.method(globalThis, 'fetch', () => { throw new Error('강신호 케이스에서는 fetch가 호출되면 안 됨'); });
    const { buildRoutingHintPart } = await import('../../gopang/ai/routing-hint.js?t=' + Date.now());
    const hint = await buildRoutingHintPart('최근 헌법재판소 결정 중 모모 사건을 분석해줘', GWP_REGISTRY, EXPERT_REGISTRY);
    assert.ok(hint.startsWith('라우팅후보:'), `힌트 형식 이상: ${hint}`);
    assert.ok(hint.includes('klaw'), `klaw가 힌트에 없음: ${hint}`);
    mock.restoreAll();
  });
});

describe('buildRoutingHintPart — 0단계 약신호 → 1단계 보완', () => {
  test('패러프레이즈("고전문학...전문가가 있으면 좋겠어요") — 1단계가 education 도메인으로 답하면 kedu/professor/teacher가 힌트에 실린다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": ["education"]}' } }] }),
    }));
    const { buildRoutingHintPart } = await import('../../gopang/ai/routing-hint.js?t=' + Date.now());
    const hint = await buildRoutingHintPart(
      '고전문학이 너무 어려워서 저 한 사람만 놓고 계속 봐주실 전문가가 있으면 좋겠어요',
      GWP_REGISTRY, EXPERT_REGISTRY
    );
    assert.ok(hint.startsWith('라우팅후보:'), `힌트 형식 이상: ${hint}`);
    assert.ok(hint.includes('kedu'), `kedu 없음: ${hint}`);
    assert.ok(hint.includes('professor'), `professor 없음: ${hint}`);
    mock.restoreAll();
  });

  test('도메인 전체 멤버가 상한을 넘어도(health=21개) 잘리지 않는다(2026-08-08 사고 재발 방지)', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": ["health"]}' } }] }),
    }));
    const { buildRoutingHintPart } = await import('../../gopang/ai/routing-hint.js?t=' + Date.now());
    const hint = await buildRoutingHintPart('몸이 좀 안 좋아서 진료를 받아보고 싶은 것 같은 느낌이에요', GWP_REGISTRY, EXPERT_REGISTRY);
    const ids = hint.replace('라우팅후보:', '').split(',');
    assert.ok(ids.length >= 20, `health 도메인 21개 중 너무 많이 잘림: ${ids.length}개만 남음`);
    assert.ok(ids.includes('physician'), `physician 없음: ${hint}`);
    mock.restoreAll();
  });

  test('도메인 밖 발화("근처 중국음식점") — 1단계가 빈 배열로 답하면 힌트가 비어 오탐(kcommerce)도 같이 걸러진다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": []}' } }] }),
    }));
    const { buildRoutingHintPart } = await import('../../gopang/ai/routing-hint.js?t=' + Date.now());
    const hint = await buildRoutingHintPart('근처에 맛있는 중국음식점이 있어?', GWP_REGISTRY, EXPERT_REGISTRY);
    assert.equal(hint, '', `빈 문자열이어야 함(0단계 kcommerce 오탐도 억제): ${hint}`);
    mock.restoreAll();
  });

  test('1단계마저 실패(네트워크 오류)해도 예외 없이 빈 문자열로 안전 폴백한다', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
    const { buildRoutingHintPart } = await import('../../gopang/ai/routing-hint.js?t=' + Date.now());
    const hint = await buildRoutingHintPart('애매한 아무 발화입니다', GWP_REGISTRY, EXPERT_REGISTRY);
    assert.equal(hint, '');
    mock.restoreAll();
  });
});

describe('buildRoutingHintPart — 빈 입력', () => {
  test('빈 발화는 즉시 빈 문자열(fetch 호출 없음)', async () => {
    mock.method(globalThis, 'fetch', () => { throw new Error('빈 발화에서는 fetch가 호출되면 안 됨'); });
    const { buildRoutingHintPart } = await import('../../gopang/ai/routing-hint.js?t=' + Date.now());
    const hint = await buildRoutingHintPart('', GWP_REGISTRY, EXPERT_REGISTRY);
    assert.equal(hint, '');
    mock.restoreAll();
  });
});
