// candidate-prefilter.test.mjs (2026-08-08 신설)
// 실행: node --test src/tests/ai-secretary/candidate-prefilter.test.mjs
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

import { narrowCandidates, buildCandidateList, FALLBACK_DOMAINS } from '../../gopang/ai/candidate-prefilter.js';
import { EXPERT_REGISTRY } from '../../gopang/ai/expert-registry.js';

// gwp-registry.js는 ES 모듈이 아니라 window 전역에 붙는 브라우저 스크립트라
// import가 안 된다 — vm으로 실행해서 GWP_REGISTRY 배열을 뽑아낸다.
function loadGwpRegistry() {
  const src = fs.readFileSync(new URL('../../../gwp-registry.js', import.meta.url), 'utf8');
  const sandbox = { window: {}, fetch: async () => ({ ok: false }), console };
  vm.createContext(sandbox);
  vm.runInContext(src, sandbox);
  return sandbox.window.GWP_REGISTRY;
}

const GWP_REGISTRY = loadGwpRegistry();
const candidates = buildCandidateList(GWP_REGISTRY, EXPERT_REGISTRY);

describe('buildCandidateList', () => {
  test('GWP는 active만, EXPERT는 리프 제외(루트만) 포함한다', () => {
    const gwpCount = candidates.filter(c => c.kind === 'gwp').length;
    const expertCount = candidates.filter(c => c.kind === 'expert').length;
    assert.ok(gwpCount > 10, `GWP 후보가 너무 적음: ${gwpCount}`);
    assert.ok(expertCount > 30, `EXPERT 루트 후보가 너무 적음: ${expertCount}`);
    // professor-math 같은 리프는 없어야 한다
    assert.equal(candidates.find(c => c.id === 'professor-math'), undefined);
    // professor 루트는 있어야 한다
    assert.ok(candidates.find(c => c.id === 'professor'));
  });
});

describe('narrowCandidates — 도메인 밖 발화', () => {
  test('"근처에 맛있는 중국음식점이 있어?" — 진짜 관련 있는 도메인 매칭이 없다(부분일치 오탐 1건은 별개로 확인)', () => {
    const { candidates: result } = narrowCandidates('근처에 맛있는 중국음식점이 있어?', candidates, { topN: 8 });
    const realHits = result.filter(r => r.score > 0);
    // ★ 정직하게 기록(2026-08-08 실사로 발견) — kcommerce의 trigger
    // '음식'이 '중국음식점'의 부분문자열로 걸려 오탐 1건이 뜬다. 이건
    // 이 발화가 실제로 K-Market 관련이라서가 아니라, 순수 부분일치
    // 스코어링의 근본 한계다 — AC-PRO-CORE 자신이 이미 문서화한
        // "강도"(범죄) vs "운동 강도"(세기) 동음이의어 충돌과 같은 클래스의
    // 문제가 이 모듈에도 그대로 있다는 뜻이다. topN=8 중 1건 정도의
    // 저점수 오탐은 이 단계(0단계: 넓게 후보만 추리기)에서는 치명적이지
    // 않다 — 다음 단계(flash 판단)가 걸러낼 여지가 있다. 다만 실제
    // 매칭이 '음식'(2점, 최저점) 하나뿐이고, 이 발화의 진짜 의도(맛집
    // 추천)를 다루는 GWP/EXPERT가 §CATALOG에 아예 없다는 사실 자체는
    // 여전히 유효하다 — 그래서 나머지 92개 후보는 전부 0점이어야 한다.
    assert.equal(realHits.length, 1, `예상과 다른 매칭 수: ${JSON.stringify(realHits)}`);
    assert.equal(realHits[0].id, 'kcommerce');
    assert.deepEqual(realHits[0].matched, ['음식']);
  });
});

describe('narrowCandidates — 명확한 도메인(법률)', () => {
  test('"최근 헌법재판소 결정 중 모모 사건을 분석해줘" — klaw가 최상위(재판 substring)', () => {
    const { candidates: result } = narrowCandidates('최근 헌법재판소 결정 중 모모 사건을 분석해줘', candidates, { topN: 8 });
    assert.ok(result.length > 0, '후보가 비어있음');
    assert.equal(result[0].id, 'klaw', `1위가 klaw가 아님: ${JSON.stringify(result[0])}`);
  });
});

describe('narrowCandidates — 정직한 한계: 패러프레이즈', () => {
  test('trigger 리터럴이 전혀 없는 professor 패러프레이즈는 폴백에만 의존한다(알려진 한계)', () => {
    const utterance = '고전문학이 너무 어려워서 저 한 사람만 놓고 계속 봐주실 전문가가 있으면 좋겠어요';
    const { candidates: result, fallbackApplied } = narrowCandidates(utterance, candidates, { topN: 8 });
    const realHits = result.filter(r => r.score > 0);
    // 정직하게 기록: 진짜 trigger 매칭은 없다(이게 이 모듈의 알려진 한계)
    assert.equal(realHits.length, 0, `예상외로 실제 매칭이 있었음(모듈 문서 갱신 필요): ${JSON.stringify(realHits)}`);
    // 그래도 FALLBACK_DOMAINS 덕에 kedu/professor/teacher는 최소한 후보에는 있어야 한다
    assert.ok(fallbackApplied, 'fallbackApplied가 true여야 함');
    const ids = result.map(r => r.id);
    for (const fid of FALLBACK_DOMAINS) {
      assert.ok(ids.includes(fid), `폴백 후보에 ${fid}가 없음`);
    }
  });

  test('trigger가 명확한 professor 발화("과외 선생님 필요해요")는 실제 매칭으로 kedu·professor 둘 다 상위에 뜬다', () => {
    const utterance = '과외 선생님이 필요해요';
    const { candidates: result } = narrowCandidates(utterance, candidates, { topN: 8 });
    const ids = result.filter(r => r.score > 0).map(r => r.id);
    assert.ok(ids.includes('kedu'), 'kedu가 실매칭 후보에 없음(둘 다 과외 trigger 보유)');
    assert.ok(ids.includes('professor'), 'professor가 실매칭 후보에 없음');
  });
});

describe('narrowCandidates — topN·minScore 동작', () => {
  test('minScore 미만은 제외되고, topN을 넘지 않는다', () => {
    const { candidates: result } = narrowCandidates('법률 소송 계약서 판결 형사 민사', candidates, { topN: 3, minScore: 1 });
    assert.ok(result.length <= 3);
    for (const r of result) assert.ok(r.score >= 1 || FALLBACK_DOMAINS.includes(r.id));
  });
});
