// govtree-tbd-literal-fallback.test.mjs — 2026-08-05 신설
//
// 배경: HANDOFF_2026-08-05_orchestration-orgprofiles-govtree.md §1-3/§4-1.
// gov-router.js의 여러 렌더 함수가 `rec.field || 'TBD — 재검증 필요'` 식
// 폴백을 썼는데, "값이 없음"이 아니라 리터럴 문자열 "TBD"(falsy 아님)가
// 마스터데이터에 저장된 레코드가 있어 폴백이 발동하지 않고 정제 안 된
// "TBD" 세 글자가 그대로 노출되는 버그가 있었다. 실측 두 건:
//   - 05-emd/templates/team-master-data.json: 콜센터번호 184건 중 179건
//   - 05-emd/emd-master-data.json: 무인발급기위치 42건 전부
// _fallbackIfTbd() 헬퍼로 falsy·리터럴 "TBD" 둘 다 폴백 대상으로 통일한
// 수정이 실제 문제 레코드(애월읍 총무팀)로 정상 동작하는지 검증한다.
//
// 실행: node --test src/tests/govtree-tbd-literal-fallback.test.mjs

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

// ── 사전 확인: 실제 데이터에 이 버그를 유발하는 리터럴 "TBD" 레코드가
// 여전히 존재하는지(회귀 테스트가 실제로 그 케이스를 때리고 있는지 확인) ──
test('사전확인 — 애월읍 총무팀 콜센터번호가 실제로 리터럴 TBD', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/templates/team-master-data.json');
  const rec = JSON.parse(raw).팀목록.find(
    r => r.읍면동이름 === '애월읍' && r.팀이름 === '총무팀'
  );
  assert.ok(rec, '애월읍 총무팀 레코드를 찾지 못함 — 데이터가 바뀌었을 수 있음');
  assert.equal(rec.콜센터번호, 'TBD', '전제 데이터가 바뀌어 이 테스트가 더 이상 버그 케이스를 검증하지 못함');
});

test('team directCode — 애월읍 총무팀 콜센터번호가 리터럴 "TBD"로 노출되지 않음', async () => {
  const r = await assembleGovSystemPrompt('', null, null, null, 'team:애월읍-총무팀');
  assert.ok(r.trace.some(t => t.includes('directCode')), `trace: ${r.trace.join(' | ')}`);
  assert.ok(r.systemPrompt.includes('TBD — 재검증 필요'), '폴백 문구가 렌더링되지 않음');
  // "TBD" 리터럴이 단독 토큰으로(즉 "TBD — 재검증 필요" 문구 바깥에서)
  // 노출되지 않는지 확인 — 폴백 문구 자체는 "TBD"로 시작하므로, 그 문구를
  // 먼저 제거한 나머지에 "TBD"가 남아있으면 버그가 재현된 것이다.
  const withoutFallbackPhrase = r.systemPrompt.replaceAll('TBD — 재검증 필요', '');
  assert.ok(!withoutFallbackPhrase.includes('TBD'), 'TBD가 정제 안 된 채로 노출됨(리터럴 폴백 버그 재현)');
});

test('emd directCode — 무인발급기위치가 리터럴 "TBD"로 노출되지 않음(전 EMD 공통 버그)', async () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data.json');
  const anyEmd = JSON.parse(raw).읍면동목록[0];
  assert.equal(anyEmd.무인발급기위치, 'TBD', '전제 데이터가 바뀌어 이 테스트가 더 이상 버그 케이스를 검증하지 못함');

  const r = await assembleGovSystemPrompt('', null, null, null, `emd:${anyEmd.읍면동명}`);
  assert.ok(r.trace.some(t => t.includes('directCode')), `trace: ${r.trace.join(' | ')}`);
  const withoutFallbackPhrase = r.systemPrompt.replaceAll('TBD — 재검증 필요', '');
  assert.ok(!withoutFallbackPhrase.includes('TBD'), 'TBD가 정제 안 된 채로 노출됨(리터럴 폴백 버그 재현)');
});
