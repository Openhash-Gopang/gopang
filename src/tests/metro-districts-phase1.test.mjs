// 부산 16개 자치구·군 + 서울 25개 자치구 — 1단계 확대 회귀 테스트
// (2026-07-24, 계획서 v1.1 §5). gyeongnam-pilot.test.mjs와 동일하게 실제
// repo 파일을 디스크에서 읽는다(mock 아님 — 실제 데이터 정확성 검증 목적).
// 실행: node --test src/tests/metro-districts-phase1.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = globalThis;

const ROOT = path.resolve(import.meta.dirname, '..', '..', 'prompts');
const SRC_ROOT = path.resolve(import.meta.dirname, '..', '..', 'src');

function readLocal(u) {
  const govTreeIdx = u.indexOf('prompts/gov-tree/');
  const promptsIdx = u.indexOf('prompts/');
  const srcIdx = u.indexOf('src/gopang/gov/');
  let p;
  if (govTreeIdx !== -1) p = path.join(ROOT, 'gov-tree', u.slice(govTreeIdx + 'prompts/gov-tree/'.length));
  else if (promptsIdx !== -1) p = path.join(ROOT, u.slice(promptsIdx + 'prompts/'.length));
  else if (srcIdx !== -1) p = path.join(SRC_ROOT, 'gopang/gov', u.slice(srcIdx + 'src/gopang/gov/'.length));
  else return null;
  p = p.split('?')[0];
  try { return fs.readFileSync(p, 'utf-8'); } catch { return null; }
}

globalThis.fetch = async (url) => {
  const content = readLocal(String(url));
  if (content === null) return { ok: true, text: async () => '{}', json: async () => ({}) };
  return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
};

const { assembleGovSystemPrompt } = await import('../gopang/gov/gov-router.js');

const CASES = [
  { name: '해운대구 — 실사 반영된 실명(도시건설국) 노출 확인',
    text: '해운대구 건축허가 신청하고 싶어요',
    expectTrace: ['SP-CITY-BUSAN_HAEUNDAE', 'SP-CITYDEPT-busan_haeundae-housing'],
    expectBodyIncludes: ['도시건설국'] },
  { name: '해운대구 — 문화관광경제국(겸임 도메인) 확인',
    text: '해운대구 소상공인 지원 상담하고 싶어요',
    expectTrace: ['SP-CITYDEPT-busan_haeundae-econ'],
    expectBodyIncludes: ['문화관광경제국'] },
  { name: '강남구 — 국이름 미기재 시 기본 라벨 확인',
    text: '강남구 지방세 문의드립니다',
    expectTrace: ['SP-CITYDEPT-seoul_gangnam-jachi'],
    expectBodyIncludes: ['자치행정담당부서'] },
  { name: '기장군 — 군 유형도 자체 처분청 확인',
    text: '기장군 재난안전 문의드립니다',
    expectTrace: ['SP-CITYDEPT-busan_gijang-safety'],
    expectBodyIncludes: ['이 부서가 직접 처분청이다'] },
  { name: '부산 중구 vs 서울 중구 — 동명 자치구 충돌 없이 각자 도로 분기',
    text: '부산 중구 지방세 문의', expectTrace: ['SP-CITYDEPT-busan_jung-jachi'] },
  { name: '서울 중구(도 이름 없이 지역만) — 정상 매칭',
    text: '서울 중구 지방세 문의', expectTrace: ['SP-CITYDEPT-seoul_jung-jachi'] },
  { name: '기획예산(신설 plan 도메인) — 해운대구 비전전략국 확인',
    text: '해운대구 기획예산 관련 문의', expectTrace: ['SP-CITYDEPT-busan_haeundae-plan'],
    expectBodyIncludes: ['비전전략국'] },
];

for (const c of CASES) {
  test(c.name, async () => {
    const r = await assembleGovSystemPrompt(c.text);
    for (const t of c.expectTrace || []) {
      assert.ok(r.trace.includes(t), `trace에 ${t} 없음 — 실제: ${r.trace.join(' > ')}`);
    }
    for (const s of c.expectBodyIncludes || []) {
      assert.ok(r.systemPrompt.includes(s), `본문에 "${s}" 없음`);
    }
  });
}

// ── 2026-08-05 신설: (시코드,국코드) 중복 레코드 방지 회귀 테스트 ──
// _fetchCityDeptText()는 records.find(r => r.시코드===... && r.국코드===...)로
// city-dept-master-data.json을 조회한다. Array.find()는 첫 매치만 반환하므로,
// 같은 (시코드,국코드) 쌍의 레코드가 두 개 이상 있으면 파일 앞쪽(대개 실사 전
// 범용 스텁)이 뒤쪽(실사 반영본)을 조용히 가린다 — 해운대구 jachi/econ/
// welfare/housing 4건이 실제로 이 버그에 걸려 있었다(도시건설국이 안전도시국에
// 가려짐 등). 실사 데이터를 추가할 때는 반드시 스텁을 그 자리에서 갱신하고,
// 새 레코드를 파일 끝에 append하지 말 것.
test('city-dept-master-data.json — (시코드,국코드) 중복 레코드 없음', () => {
  const raw = readLocal('prompts/gov-tree/04-city/templates/city-dept-master-data.json');
  const recs = JSON.parse(raw).국목록;
  const seen = new Map();
  const dups = [];
  for (const r of recs) {
    const key = `${r.시코드}|${r.국코드}`;
    if (seen.has(key)) dups.push(key);
    seen.set(key, true);
  }
  assert.deepEqual(dups, [], `중복 (시코드,국코드) 레코드 발견: ${dups.join(', ')}`);
});

// ── 2026-08-05 신설: directCode tier='province' 신규 진입점 ──
// org_profiles(K-Compose 레지스트리) 재조정 중 발견 — do-dept/do-agency/
// org/city/city-dept/emd는 전부 도(道) 하드코딩 제거된 directCode 진입점이
// 있었는데, 그 상위 계층인 도청 자체(province)만 빠져 있었다. gov_tree_ref로
// 도청급 기관(예: "경기도")을 연결하려면 이 tier가 필요해서 신설.
test('directCode tier=province — 도코드로 도청 SP(SP-DO-000) 라우팅', async () => {
  const r = await assembleGovSystemPrompt('아무 발화나', null, null, null, 'province:gyeonggi');
  assert.ok(r.trace.some(t => t.includes('SP-DO-000') && t.includes('gyeonggi')),
    `trace에 SP-DO-000(gyeonggi) 없음 — 실제: ${r.trace.join(' > ')}`);
});

test('directCode tier=province — 제주도 코드도 동일하게 동작(회귀 확인)', async () => {
  const r = await assembleGovSystemPrompt('아무 발화나', null, null, null, 'province:jeju');
  assert.ok(r.trace.some(t => t.includes('SP-DO-000') && t.includes('jeju')),
    `trace에 SP-DO-000(jeju) 없음 — 실제: ${r.trace.join(' > ')}`);
});

test('directCode tier=province — 실사 안 된 도코드는 크래시 없이 안전 폴백', async () => {
  const r = await assembleGovSystemPrompt('아무 발화나', null, null, null, 'province:nonexistent_province_code');
  assert.ok(!r.trace.some(t => t.includes('SP-DO-000') && t.includes('nonexistent')),
    `없는 도코드인데 SP-DO-000으로 확정돼버림 — 실제: ${r.trace.join(' > ')}`);
});
