// 3단계 — 나머지 12개 도 시/군/구 183개 전수 등록 회귀 테스트
// (2026-07-24, 계획서 v1.1 §5). 실제 repo 데이터를 디스크에서 읽는다.
// 실행: node --test src/tests/nationwide-phase3.test.mjs
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
  { name: '수원시(경기도, 특례시, L2 미착수 신규 도) — 자치행정 라우팅',
    text: '수원시 지방세 문의드립니다',
    expectTrace: ['SP-CITY-GYEONGGI_SUWON', 'SP-CITYDEPT-gyeonggi_suwon-jachi'] },
  { name: '춘천시(강원, L2 미착수 신규 도) — 보건소 라우팅',
    text: '춘천시 보건소 예방접종 문의', expectTrace: ['SP-CITY-GANGWON_CHUNCHEON', 'SP-CITYDEPT-gangwon_chuncheon-health'] },
  { name: '대구 중구(L2 미착수 신규 도, 부산/인천 중구와 동명이인) — 정상 매칭',
    text: '대구 중구 지방세 문의', expectTrace: ['SP-CITYDEPT-daegu_jung-jachi'] },
  { name: '광산구(전남광주통합, L2 미착수 신규 도, 구 광주광역시) — 복지 라우팅',
    text: '광산구 기초생활수급 신청하고 싶어요', expectTrace: ['SP-CITYDEPT-jeonnam_gwangju_gwangsan-welfare'] },
  { name: '포항시(경북, 기존 L2 있던 도) — 건축허가 라우팅',
    text: '포항시 건축허가 신청하고 싶어요', expectTrace: ['SP-CITYDEPT-gyeongbuk_pohang-housing'] },
  { name: '거제시(경남 3단계 잔여 15곳 중 하나, 2단계 파일럿과 충돌 없이 병합 확인)',
    text: '거제시 지방세 문의', expectTrace: ['SP-CITYDEPT-gyeongnam_geoje-jachi'] },
  { name: '세종 — 단층제라 시청 계층 자체가 없음(도청 레벨에서 멈춤, 에러 아님)',
    text: '세종시 지방세 문의드립니다',
    expectNotInTrace: ['SP-CITY-SEJONG'] },
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
  });
}
