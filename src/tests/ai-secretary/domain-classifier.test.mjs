// domain-classifier.test.mjs (2026-08-08 신설)
// 실행: node --experimental-test-module-mocks --test src/tests/ai-secretary/domain-classifier.test.mjs
import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

globalThis.window = globalThis;

const { mock: cfgMock } = mock.module('../../gopang/core/config.js', {
  namedExports: { CFG: { endpoint: 'https://fake.endpoint' } },
});

const { UNIFIED_DOMAINS, getClassifiableDomains, validateTaxonomyCoverage } =
  await import('../../gopang/ai/domain-taxonomy.js');
const { EXPERT_REGISTRY } = await import('../../gopang/ai/expert-registry.js');

function loadGwpRegistry() {
  const src = fs.readFileSync(new URL('../../../gwp-registry.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, fetch: async () => ({ ok: false }), console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.GWP_REGISTRY;
}

describe('domain-taxonomy 커버리지 (실제 레지스트리 데이터로 재검증)', () => {
  test('실제 GWP+EXPERT category 코드가 taxonomy에 빠짐·중복 없이 매핑된다', () => {
    const GWP_REGISTRY = loadGwpRegistry();
    const gwpCats = [...new Set(GWP_REGISTRY.map(e => e.category))];
    const expertCats = [...new Set(
      Object.values(EXPERT_REGISTRY).filter(def => !def.parentKey).map(def => def.category)
    )];
    const result = validateTaxonomyCoverage(gwpCats, expertCats);
    assert.ok(result.ok, `커버리지 실패: ${JSON.stringify(result)}`);
  });

  test('getClassifiableDomains()는 emergency·onboarding을 제외한다', () => {
    const ids = getClassifiableDomains().map(d => d.id);
    assert.ok(!ids.includes('emergency'));
    assert.ok(!ids.includes('onboarding'));
    assert.ok(ids.includes('education'));
    assert.ok(ids.includes('health'));
  });

  test('UNIFIED_DOMAINS 전체 id는 유일하다', () => {
    const ids = UNIFIED_DOMAINS.map(d => d.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('classifyDomain — 정상 분류', () => {
  test('education 도메인으로 정확히 분류되면 그 id를 반환한다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": ["education"]}' } }] }),
    }));
    const { classifyDomain } = await import('../../gopang/ai/domain-classifier.js?t=' + Date.now());
    const result = await classifyDomain('고전문학이 너무 어려워서 저 한 사람만 놓고 계속 봐주실 전문가가 있으면 좋겠어요');
    assert.deepEqual(result, ['education']);
    mock.restoreAll();
  });

  test('두 도메인에 걸치는 발화는 최대 2개까지 반환한다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": ["legal_security", "finance_realestate"]}' } }] }),
    }));
    const { classifyDomain } = await import('../../gopang/ai/domain-classifier.js?t=' + Date.now());
    const result = await classifyDomain('변호사한테 세무 상담도 같이 받고 싶어요');
    assert.deepEqual(result, ['legal_security', 'finance_realestate']);
    mock.restoreAll();
  });

  test('도메인 밖 발화(빈 배열 응답)는 빈 배열을 그대로 반환한다 — null과 구분됨', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": []}' } }] }),
    }));
    const { classifyDomain } = await import('../../gopang/ai/domain-classifier.js?t=' + Date.now());
    const result = await classifyDomain('근처에 맛있는 중국음식점이 있어?');
    assert.deepEqual(result, []);
    assert.notEqual(result, null);
    mock.restoreAll();
  });
});

describe('classifyDomain — 화이트리스트·폴백', () => {
  test('taxonomy에 없는 도메인 id를 지어내면 걸러낸다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": ["education", "made-up-domain"]}' } }] }),
    }));
    const { classifyDomain } = await import('../../gopang/ai/domain-classifier.js?t=' + Date.now());
    const result = await classifyDomain('아무 발화');
    assert.deepEqual(result, ['education']);
    mock.restoreAll();
  });

  test('emergency·onboarding처럼 분류 후보에 없는 id를 내면 걸러낸다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": ["emergency"]}' } }] }),
    }));
    const { classifyDomain } = await import('../../gopang/ai/domain-classifier.js?t=' + Date.now());
    const result = await classifyDomain('아무 발화');
    assert.deepEqual(result, []);
    mock.restoreAll();
  });

  test('네트워크 실패 시 null을 반환한다(빈 배열과 구분 — "판단 불가"의 의미)', async () => {
    mock.method(globalThis, 'fetch', async () => { throw new Error('network down'); });
    const { classifyDomain } = await import('../../gopang/ai/domain-classifier.js?t=' + Date.now());
    const result = await classifyDomain('아무 발화');
    assert.equal(result, null);
    mock.restoreAll();
  });

  test('{"domains": null} 같은 이상 응답도 null로 처리한다', async () => {
    mock.method(globalThis, 'fetch', async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"domains": null}' } }] }),
    }));
    const { classifyDomain } = await import('../../gopang/ai/domain-classifier.js?t=' + Date.now());
    const result = await classifyDomain('아무 발화');
    assert.equal(result, null);
    mock.restoreAll();
  });
});
