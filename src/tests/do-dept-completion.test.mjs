// 도청 실국 완비 회귀 테스트 (2026-07-24) — 시청 계층과 동일 원칙을
// 도청에 확장: 실사 없이도 기본 라벨로 즉시 작동, 실사된 도는 실명 유지.
// 실행: node --test src/tests/do-dept-completion.test.mjs
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
  { name: '경기도 — 이미 있던 실사 데이터(기획조정실)가 라우팅 테이블 신설로 되살아남',
    text: '경기도 기획조정실 예산담당관 문의', expectTrace: ['SP-DO-PLAN'],
    expectBodyIncludes: ['기획조정실'] },
  { name: '경기도 — 미확인 도메인(sports)은 기본 라벨로 즉시 응답',
    text: '경기도 체육진흥과 프로그램 문의', expectTrace: ['SP-DO-SPORTS'],
    expectBodyIncludes: ['체육담당부서'] },
  { name: '강원도 — L2 자체가 없던 도, 기본 라벨로 즉시 완비',
    text: '강원도 재난안전실 문의드립니다', expectTrace: ['SP-DO-SAFETY'],
    expectBodyIncludes: ['안전관리담당부서'] },
  { name: '전남광주통합 — L2 자체가 없던 도, 기본 라벨로 즉시 완비',
    text: '전남광주통합특별시 농업정책 문의', expectTrace: ['SP-DO-AGRI'],
    expectBodyIncludes: ['농정담당부서'] },
  { name: '충북 — 기존 14/16에서 빠졌던 health 도메인 보강',
    text: '충청북도 질병예방 관련 문의', expectTrace: ['SP-DO-HEALTH'],
    expectBodyIncludes: ['보건정책담당부서'] },
  { name: '제주 — 의도적 도메인 통합(health 미분리)은 손대지 않음, 기존 동작 유지',
    text: '제주도 감염병 예방 문의', expectNotInTrace: ['SP-DO-HEALTH'] },
];

for (const c of CASES) {
  test(c.name, async () => {
    const r = await assembleGovSystemPrompt(c.text);
    for (const t of c.expectTrace || []) {
      assert.ok(r.trace.includes(t), `trace에 ${t} 없음 — 실제: ${r.trace.join(' > ')}`);
    }
    for (const t of c.expectNotInTrace || []) {
      assert.ok(!r.trace.includes(t), `trace에 ${t}가 있으면 안 됨 — 실제: ${r.trace.join(' > ')}`);
    }
    for (const s of c.expectBodyIncludes || []) {
      assert.ok(r.systemPrompt.includes(s), `본문에 "${s}" 없음`);
    }
  });
}
