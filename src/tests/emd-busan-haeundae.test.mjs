// emd-busan-haeundae.test.mjs — 2026-08-05 신설
//
// 해운대구 18개 행정동 EMD 인스턴스(emd-master-data-busan.json) 첫 실사
// 데이터가 실제로 라우팅되는지 검증한다. metro-districts-phase1.test.mjs와
// 동일하게 mock이 아니라 디스크의 실제 repo 파일을 읽는다 — 데이터 정확성
// 자체(파일 내용)와 라우팅 배선(EMD_PATHS.busan 등록 + directCode 하드코딩
// 제거) 둘 다 이 테스트 하나로 함께 검증된다.
//
// 실행: node --test src/tests/emd-busan-haeundae.test.mjs

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

// ── 데이터 자체 검증 (전체 레코드, 중복·필수필드 확인) ──────────────
test('emd-master-data-busan.json — 43개 행정동(해운대 18+강서 9+금정 16), 중복 없음, 필수 필드 채워짐', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  assert.equal(recs.length, 43, `43개여야 하는데 ${recs.length}개`);
  const names = new Set(recs.map(r => r.읍면동명));
  assert.equal(names.size, 43, '읍면동명 중복 존재');
  for (const r of recs) {
    assert.equal(r.도코드, 'busan');
    assert.ok(['해운대구', '강서구', '금정구'].includes(r.상위기관명), `${r.읍면동명} 상위기관명 이상함: ${r.상위기관명}`);
    assert.equal(r.상위기관구분, '자치구');
    assert.equal(r.관할구역구분, '법정동');
    assert.ok(Array.isArray(r.관할구역목록) && r.관할구역목록.length > 0, `${r.읍면동명} 관할구역목록 비어있음`);
    assert.ok(/^부산광역시 /.test(r.청사주소), `${r.읍면동명} 청사주소 이상함: ${r.청사주소}`);
    assert.ok(/^051-\d{3}-\d{4}/.test(r.대표전화), `${r.읍면동명} 전화번호 형식 이상함: ${r.대표전화}`);
  }
});

// ── 반송1동만 관할 법정동이 2개(반송동+석대동)인 특수 사례 확인 ──────
test('반송1동 — 석대동 흡수 흔적으로 관할 법정동 2개(반송동·석대동)', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  const bansong1 = recs.find(r => r.읍면동명 === '반송1동');
  assert.ok(bansong1, '반송1동 레코드 없음');
  assert.deepEqual(new Set(bansong1.관할구역목록), new Set(['반송동', '석대동']));
});

// ── directCode 'emd:' tier — 하드코딩 제거 후 실제로 부산 도로 확정되는지 ──
test('directCode emd:우1동 — 부산으로 확정되어 라우팅됨(jeju 하드코딩 없음 확인)', async () => {
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:우1동');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-우1동(directCode)')), `trace: ${r.trace.join(' | ')}`);
  assert.ok(r.systemPrompt.includes('해운대구'), '상위기관명(해운대구)이 렌더링 안 됨');
  assert.ok(r.systemPrompt.includes('해운대로 612'), '청사주소가 렌더링 안 됨');
});

// ── 자연어 흐름 — 행정동 이름 직접 언급 ──
test('자연어 "우1동 등본 발급" — SP-EMD-우1동까지 라우팅', async () => {
  const r = await assembleGovSystemPrompt('우1동 사는데 등본 어떻게 떼나요');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-우1동')), `trace: ${r.trace.join(' | ')}`);
});

// ── 자연어 흐름 — 법정동 이름(석대동)만 언급해도 상위 행정동(반송1동)으로 매칭 ──
test('자연어 "석대동 인감증명" — 법정동 이름만으로 반송1동 매칭', async () => {
  const r = await assembleGovSystemPrompt('석대동 사는데 인감증명 발급하려고요');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-반송1동')), `trace: ${r.trace.join(' | ')}`);
});

// ── PDV 힌트만으로도 매칭(발화 자체엔 지역명 없음) ──
test('PDV 힌트만("부산 해운대구 좌1동") — 발화에 지역명 없어도 좌1동 매칭', async () => {
  const r = await assembleGovSystemPrompt('인감증명 발급받고 싶어요', '부산 해운대구 좌1동');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-좌1동')), `trace: ${r.trace.join(' | ')}`);
});
