// emd-busan-geumjeong.test.mjs — 2026-08-05 신설
//
// 금정구 16개 행정동 EMD 인스턴스가 실제로 라우팅되는지 검증한다.
// emd-busan-haeundae.test.mjs / emd-busan-gangseo.test.mjs와 동일 패턴.
//
// 실행: node --test src/tests/emd-busan-geumjeong.test.mjs

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

test('금정구 16개 행정동 레코드 존재', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록.filter(r => r.상위기관명 === '금정구');
  assert.equal(recs.length, 16, `금정구는 16개여야 하는데 ${recs.length}개`);
  const names = new Set(recs.map(r => r.읍면동명));
  assert.deepEqual(names, new Set([
    '서1동', '서2동', '서3동', '금사회동동', '부곡1동', '부곡2동', '부곡3동', '부곡4동',
    '장전1동', '장전2동', '선두구동', '청룡노포동', '남산동', '구서1동', '구서2동', '금성동',
  ]));
});

// ── 서1~3동, 구서1~2동이 각각 법정동 하나(서동/구서동)를 공유하는 사례 ──
test('서1동·서2동·서3동 — 법정동 서동을 공유', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  for (const n of ['서1동', '서2동', '서3동']) {
    const r = recs.find(x => x.읍면동명 === n);
    assert.deepEqual(r.관할구역목록, ['서동'], `${n} 관할구역 이상함`);
  }
});

// ── 부곡3동 — 부곡동+오륜동 전부(2개 법정동)를 관할하는 특수 사례 ──
test('부곡3동 — 부곡동과 오륜동 전부를 관할', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  const bugok3 = recs.find(r => r.읍면동명 === '부곡3동');
  assert.deepEqual(new Set(bugok3.관할구역목록), new Set(['부곡동', '오륜동']));
});

// ── 선두구동/청룡노포동 — 각각 2개 법정동 통합 관할 ──
test('선두구동·청룡노포동 — 각각 2개 법정동 통합 관할', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  const seondugu = recs.find(r => r.읍면동명 === '선두구동');
  const cheongryongnopo = recs.find(r => r.읍면동명 === '청룡노포동');
  assert.deepEqual(new Set(seondugu.관할구역목록), new Set(['선동', '두구동']));
  assert.deepEqual(new Set(cheongryongnopo.관할구역목록), new Set(['청룡동', '노포동']));
});

// ── directCode 'emd:' tier — 금정구로 확정되는지 ──
test('directCode emd:장전1동 — 금정구로 확정되어 라우팅됨', async () => {
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:장전1동');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-장전1동(directCode)')), `trace: ${r.trace.join(' | ')}`);
  assert.ok(r.systemPrompt.includes('금정구'), '상위기관명(금정구)이 렌더링 안 됨');
});

// ── 자연어 흐름 — 법정동 이름(노포동)만 언급해도 상위 행정동(청룡노포동)으로 매칭 ──
test('자연어 "노포동 인감증명" — 법정동 이름만으로 청룡노포동 매칭', async () => {
  const r = await assembleGovSystemPrompt('노포동 사는데 인감증명 발급하려고요');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-청룡노포동')), `trace: ${r.trace.join(' | ')}`);
});

// ── 세 구(해운대·강서·금정) 데이터가 서로 섞이지 않는지 ──
test('해운대구·강서구·금정구 EMD가 서로 섞이지 않고 각자 정확히 라우팅됨', async () => {
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:금성동');
  assert.ok(r.systemPrompt.includes('산성로 452'), '금성동 청사주소 누락');
  assert.ok(!r.systemPrompt.includes('해운대로 612') && !r.systemPrompt.includes('대저로221번길'),
    '다른 구의 청사주소가 섞여듦');
});
