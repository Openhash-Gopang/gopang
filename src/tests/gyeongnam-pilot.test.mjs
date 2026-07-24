// 경남 파일럿(진주·창원+5개 일반구·산청군) 회귀 테스트 — 2026-07-24 신설.
// gov-router.test.mjs/100-scenario와 달리 mock 대신 실제 repo의
// city-master-data.json / city-dept-master-data.json / SP-CITYDEPT-*-TEMPLATE
// 파일을 디스크에서 그대로 읽는다 — 이 테스트의 목적 자체가 "라우팅
// 메커니즘"이 아니라 "실제 데이터가 정확히 채워졌는가"이기 때문이다
// (메커니즘 자체는 gov-router.test.mjs의 r10/r11이 이미 검증함).
// 실행: node --test src/tests/gyeongnam-pilot.test.mjs
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
  { name: '진주시 일반시 — 자치행정 라우팅', text: '진주시 지방세 문의드립니다',
    expectTrace: ['SP-CITY-JINJU', 'SP-CITYDEPT-jinju-jachi'] },
  { name: '창원시 특례시 — 건축허가 라우팅', text: '창원시 건축허가 신청하고 싶어요',
    expectTrace: ['SP-CITY-CHANGWON', 'SP-CITYDEPT-changwon-housing'],
    expectBodyIncludes: ['이 부서가 직접 처분청이다'] }, // 특례시는 자체 처분청
  { name: '의창구 일반구 — 처분권 없음 + 모시 귀속', text: '의창구 기초생활수급 신청하고 싶어요',
    expectTrace: ['SP-CITYDEPT-uichang-welfare'],
    expectBodyIncludes: ['모시(母市) 시장', 'SP-CITY-CHANGWON'] },
  { name: '진해구 일반구 — 건축허가도 동일 원칙', text: '진해구 건축허가 신청하고 싶어요',
    expectTrace: ['SP-CITYDEPT-jinhae-housing'], expectBodyIncludes: ['모시(母市) 시장'] },
  { name: '산청군 — 보건소 라우팅', text: '산청군 보건소 예방접종 문의',
    expectTrace: ['SP-CITY-SANCHEONG', 'SP-CITYDEPT-sancheong-health'] },
  { name: '마산합포구 — "마산시" 잔재 명칭이 아니라 정식 구명으로만 매칭',
    text: '마산합포구 지방세 문의', expectTrace: ['SP-CITYDEPT-masanhappo-jachi'] },
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
