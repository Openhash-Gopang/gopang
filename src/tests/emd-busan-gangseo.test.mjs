// emd-busan-gangseo.test.mjs — 2026-08-05 신설
//
// 강서구 9개 행정동 EMD 인스턴스(emd-master-data-busan.json에 추가)가
// 실제로 라우팅되는지 검증한다. emd-busan-haeundae.test.mjs와 동일하게
// mock이 아니라 디스크의 실제 repo 파일을 읽는다.
//
// 실행: node --test src/tests/emd-busan-gangseo.test.mjs

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

// ── 강서구 9개 행정동만 추려서 개별 검증 ──
test('강서구 9개 행정동 레코드 존재, 상위기관명 일관성', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록.filter(r => r.상위기관명 === '강서구');
  assert.equal(recs.length, 9, `강서구는 9개여야 하는데 ${recs.length}개`);
  const names = new Set(recs.map(r => r.읍면동명));
  assert.deepEqual(names, new Set([
    '대저1동', '대저2동', '강동동', '명지1동', '명지2동', '가락동', '녹산동', '신호동', '가덕도동',
  ]));
});

// ── 명지1동·명지2동이 법정동 명지동을 공유하는 특수 사례 ──
test('명지1동·명지2동 — 법정동 명지동을 공유', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  const m1 = recs.find(r => r.읍면동명 === '명지1동');
  const m2 = recs.find(r => r.읍면동명 === '명지2동');
  assert.deepEqual(m1.관할구역목록, ['명지동']);
  assert.deepEqual(m2.관할구역목록, ['명지동']);
});

// ── 녹산동 — 옛 2개 면(대야면·녹산면) 통합으로 관할 법정동이 8개인 특수 사례 ──
test('녹산동 — 관할 법정동 8개(옛 대야면·녹산면 통합)', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  const noksan = recs.find(r => r.읍면동명 === '녹산동');
  assert.equal(noksan.관할구역목록.length, 8);
  assert.ok(noksan.관할구역목록.includes('지사동'));
});

// ── directCode 'emd:' tier — 강서구로 확정되는지 ──
test('directCode emd:대저1동 — 강서구로 확정되어 라우팅됨', async () => {
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:대저1동');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-대저1동(directCode)')), `trace: ${r.trace.join(' | ')}`);
  assert.ok(r.systemPrompt.includes('강서구'), '상위기관명(강서구)이 렌더링 안 됨');
});

// ── 자연어 흐름 — 행정동 이름 직접 언급 ──
test('자연어 "가락동 등본 발급" — SP-EMD-가락동까지 라우팅', async () => {
  const r = await assembleGovSystemPrompt('가락동 사는데 등본 어떻게 떼나요');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-가락동')), `trace: ${r.trace.join(' | ')}`);
});

// ── 자연어 흐름 — 법정동 이름(지사동)만 언급해도 상위 행정동(녹산동)으로 매칭 ──
test('자연어 "지사동 인감증명" — 법정동 이름만으로 녹산동 매칭', async () => {
  const r = await assembleGovSystemPrompt('지사동 사는데 인감증명 발급하려고요');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-녹산동')), `trace: ${r.trace.join(' | ')}`);
});

// ── 부산 해운대구·강서구 두 도시 EMD가 섞이지 않는지(도 하드코딩 제거 리팩터 핵심 검증) ──
// ★ 주의: SP-EMD-TEMPLATE_v1.3.md 자체의 변경 이력 주석에 "해운대구"라는
// 단어가 들어있어(v1.3이 해운대구 파일럿 중 개정됐다는 역사적 기록),
// systemPrompt 전체에서 그 단어의 유무만으로는 오염 여부를 판별할 수
// 없다 — 대신 렌더링된 §1 정체성 변수(상위기관명)가 실제로 무엇으로
// 치환됐는지, 그리고 상대편 구의 청사주소가 새어들어오지 않았는지로
// 검증한다.
test('해운대구 우1동과 강서구 대저1동이 서로 섞이지 않고 각자 정확히 라우팅됨', async () => {
  const r1 = await assembleGovSystemPrompt('', null, null, null, 'emd:우1동');
  const r2 = await assembleGovSystemPrompt('', null, null, null, 'emd:대저1동');
  assert.ok(r1.systemPrompt.includes('해운대로 612'), '해운대구 우1동 청사주소 누락');
  assert.ok(!r1.systemPrompt.includes('대저로221번길'), '강서구 대저1동 청사주소가 해운대구 우1동 응답에 섞여듦');
  assert.ok(r2.systemPrompt.includes('대저로221번길 19'), '강서구 대저1동 청사주소 누락');
  assert.ok(!r2.systemPrompt.includes('해운대로 612'), '해운대구 우1동 청사주소가 강서구 대저1동 응답에 섞여듦');
});
