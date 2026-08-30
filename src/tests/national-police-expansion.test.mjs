// 국가기관 지사 선별 확대(police, 2026-07-24) 회귀 테스트.
// 실행: node --test src/tests/national-police-expansion.test.mjs
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
  { name: '부산 경찰청 — 정적 인스턴스로 정밀 라우팅',
    text: '부산 경찰청에 고소장 접수하려고요', expectTrace: ['SP-NAT-POLICE'],
    expectBodyIncludes: ['부산경찰청'] },
  { name: '강원 경찰청 — L2 신규 도에서도 police는 동일하게 작동',
    text: '강원 경찰청 수사 문의', expectTrace: ['SP-NAT-POLICE'],
    expectBodyIncludes: ['강원경찰청'] },
  // ★ 2026-08-30 — 2026-08-08 _makeGenericNationalEntries 안전조치 이후,
  // 정적 데이터 없는 도는 SP-NATIONAL-LAZY(실시간 검색) 대신 정직한
  // "[정보 없음]" 폴백으로 의도적으로 우회한다(national-agency-100-
  // scenarios.test.mjs 수정과 동일 배경 — 실시간 검색이 틀린 지사를
  // 확신에 차서 말하는 사고를 막기 위함, 주피터님 확인). 아래 두 케이스는
  // "LAZY 또는 정직한 정보없음 안내" 둘 다 정상 통과로 인정한다.
  { name: '경기(분리 관할이라 이번 배치 제외) — police는 여전히 안전한 폴백으로',
    text: '경기도 경찰청에 고소장 접수하려고요',
    expectSafeFallback: true, domainCode: 'SP-NAT-POLICE' },
  { name: '부산 세무서(police 외 다른 국가기관) — 여전히 안전한 폴백으로',
    text: '부산 세무서 종합소득세 신고 언제까지예요',
    expectSafeFallback: true, domainCode: 'SP-NAT-TAX' },
];

for (const c of CASES) {
  test(c.name, async () => {
    const r = await assembleGovSystemPrompt(c.text);
    for (const t of c.expectTrace || []) {
      assert.ok(r.trace.includes(t), `trace에 ${t} 없음 — 실제: ${r.trace.join(' > ')}`);
    }
    if (c.expectSafeFallback) {
      const hitLazy = r.trace.some(t => t.includes('SP-NATIONAL-LAZY'));
      const hitHonestFallback = r.trace.includes(c.domainCode) && r.systemPrompt.includes('[정보 없음]');
      assert.ok(hitLazy || hitHonestFallback,
        `LAZY도 정직한 정보없음 안내도 안 잡힘 — 실제: ${r.trace.join(' > ')}`);
    }
    for (const s of c.expectBodyIncludes || []) {
      assert.ok(r.systemPrompt.includes(s), `본문에 "${s}" 없음`);
    }
  });
}
