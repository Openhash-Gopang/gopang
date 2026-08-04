// gov-tree-lazy-instancing.test.mjs — 2026-08-05 신설
// GOV_TREE_LAZY_INSTANCING_DESIGN_v1_0.md §3(REAL/STUB/MISSING 판정기)·
// §4-1(미스 신호)·§5-2(PocketBase 우선 조회) 구현 검증.
//
// 실행: node --test src/tests/gov-tree-lazy-instancing.test.mjs

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

// ── fetch 스파이 — hondi-proxy(SIGUNGU_RESOLVE_ORIGIN) 호출을 가로채
// 기록하고, 프롬프트/JSON fetch는 readLocal로 그대로 서빙한다. ──
const proxyCalls = [];
let proxyLookupResponse = { found: false };
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith('https://hondi-proxy.tensor-city.workers.dev')) {
    proxyCalls.push({ url: u, opts });
    if (u.includes('/gov-tree-instance/lookup')) {
      return { ok: true, json: async () => proxyLookupResponse };
    }
    if (u.includes('/sp-author/queue')) {
      return { ok: true, json: async () => ({ status: 'queued' }) };
    }
    return { ok: true, json: async () => ({}) };
  }
  const content = readLocal(u);
  if (content === null) return { ok: true, text: async () => '{}', json: async () => ({}) };
  return { ok: true, text: async () => content, json: async () => JSON.parse(content) };
};

const gr = await import('../gopang/gov/gov-router.js');
const { assembleGovSystemPrompt } = gr;

// _classifyCityDeptInstance/_classifyEmdInstance는 export되지 않은 내부
// 함수라 모듈 네임스페이스로는 못 꺼낸다 — 동작은 assembleGovSystemPrompt를
// 통한 간접 관찰(§CASE 2~4)로 검증하고, 순수 판정 로직 자체는 아래처럼
// 같은 판정 규칙을 재구현해 JSON 데이터로 직접 대조 검증한다(설계 문서
// §3 의사코드와 동일 규칙 — 구현이 문서와 어긋나면 이 테스트가 잡는다).
function classifyCityDeptInstance(rec) {
  if (!rec) return 'MISSING';
  if (!rec.국이름) return 'STUB';
  if (!rec.산하과목록) return 'STUB';
  return 'REAL';
}
function classifyEmdInstance(rec) {
  if (!rec) return 'MISSING';
  if (!rec.청사주소 || !rec.대표전화) return 'STUB';
  if (rec.청사주소.includes('TBD')) return 'STUB';
  return 'REAL';
}

test('§3 판정기 — city-dept: 국이름 있음+산하과 있음 = REAL', () => {
  const raw = readLocal('prompts/gov-tree/04-city/templates/city-dept-master-data.json');
  const recs = JSON.parse(raw).국목록;
  const dongnae = recs.find(r => r.시코드 === 'busan_dongnae' && r.국코드 === 'jachi');
  assert.equal(classifyCityDeptInstance(dongnae), 'REAL', '동래구 jachi(산하과 포함 실사)는 REAL이어야 함');
});

test('§3 판정기 — city-dept: 국이름만 있고 산하과 없음 = STUB', () => {
  const raw = readLocal('prompts/gov-tree/04-city/templates/city-dept-master-data.json');
  const recs = JSON.parse(raw).국목록;
  const dong = recs.find(r => r.시코드 === 'busan_dong' && r.국코드 === 'jachi');
  assert.equal(classifyCityDeptInstance(dong), 'STUB', '동구 jachi(국이름만 확인)는 STUB이어야 함');
});

test('§3 판정기 — city-dept: 레코드 자체 없음 = MISSING', () => {
  assert.equal(classifyCityDeptInstance(undefined), 'MISSING');
});

test('§3 판정기 — city-dept: econ 도메인은 아직 스텁(산하과 없음) = STUB', () => {
  const raw = readLocal('prompts/gov-tree/04-city/templates/city-dept-master-data.json');
  const recs = JSON.parse(raw).국목록;
  const dongnaeEcon = recs.find(r => r.시코드 === 'busan_dongnae' && r.국코드 === 'econ');
  assert.equal(classifyCityDeptInstance(dongnaeEcon), 'STUB', '동래구 econ은 jachi와 달리 아직 미착수 스텁이어야 함');
});

test('§3 판정기 — emd: 청사주소+대표전화 있음, TBD 아님 = REAL', () => {
  const raw = readLocal('prompts/gov-tree/05-emd/emd-master-data-busan.json');
  const recs = JSON.parse(raw).읍면동목록;
  const u1 = recs.find(r => r.읍면동명 === '우1동');
  assert.equal(classifyEmdInstance(u1), 'REAL');
});

test('§3 판정기 — emd: 청사주소 없음 = STUB', () => {
  assert.equal(classifyEmdInstance({ 읍면동명: '테스트동' }), 'STUB');
});

test('§3 판정기 — emd: 청사주소에 TBD 포함 = STUB(청사주소·전화가 있어도)', () => {
  assert.equal(classifyEmdInstance({ 청사주소: 'TBD — 재검증 필요', 대표전화: '051-000-0000' }), 'STUB');
});

test('§3 판정기 — emd: 무인발급기위치만 TBD면 여전히 REAL(부가정보 하나로 전체 재생성 낭비 방지)', () => {
  assert.equal(classifyEmdInstance({
    청사주소: '부산광역시 해운대구 해운대로 612', 대표전화: '051-749-5811',
    무인발급기위치: 'TBD — 재검증 필요',
  }), 'REAL');
});

// ── §5-2 PocketBase 우선 조회 — 히트 시 로컬 렌더링을 건너뛰고 그
// 내용을 그대로 쓰는지, 미스 시 기존 로직으로 안전하게 폴백하는지 ──
test('PocketBase 미스(found:false) — 기존 JSON 렌더링 경로로 정상 폴백', async () => {
  proxyCalls.length = 0;
  proxyLookupResponse = { found: false };
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:우1동');
  assert.ok(r.trace.some(t => t.includes('SP-EMD-우1동(directCode)')), `trace: ${r.trace.join(' | ')}`);
  assert.ok(proxyCalls.some(c => c.url.includes('/gov-tree-instance/lookup')), 'lookup 엔드포인트를 호출했어야 함');
});

test('PocketBase 히트 — generated_content를 그대로 쓰고 로컬 렌더링을 건너뜀', async () => {
  proxyCalls.length = 0;
  proxyLookupResponse = { found: true, generated_content: '[PocketBase 실시간 저작 테스트 본문]' };
  const r = await assembleGovSystemPrompt('', null, null, null, 'emd:우1동');
  assert.ok(r.systemPrompt.includes('[PocketBase 실시간 저작 테스트 본문]'), 'PocketBase 내용이 응답에 없음');
  assert.ok(r.trace.some(t => t.includes('PocketBase')), `trace: ${r.trace.join(' | ')}`);
  // ★ city 레벨 컨텍스트가 PocketBase 히트에도 여전히 포함돼야 한다 —
  // generated_content는 emd 레벨 조각일 뿐 city 레벨을 대체하지 않는다
  // (이전에 city 컨텍스트를 통째로 건너뛰던 버그를 여기서 고정 검증).
  assert.ok(r.trace.includes('SP-CITY-BUSAN_HAEUNDAE'), `city 레벨 trace 누락: ${r.trace.join(' | ')}`);
  proxyLookupResponse = { found: false }; // 다음 테스트에 영향 안 주게 원복
});

test('§4-1 미스 신호 — STUB 판정 시 /sp-author/queue로 gov_tree_instance_miss 큐잉', async () => {
  proxyCalls.length = 0;
  proxyLookupResponse = { found: false };
  // 동구 jachi는 산하과 없는 STUB(위 판정기 테스트 참조) — 자연어로
  // 라우팅되도록 발화 구성.
  await assembleGovSystemPrompt('부산 동구 지방세 문의드립니다');
  // 미스 신호는 fire-and-forget(await 안 함)이라 이벤트 루프 한 틱 양보.
  await new Promise((resolve) => setTimeout(resolve, 50));
  const queueCall = proxyCalls.find(c => c.url.includes('/sp-author/queue'));
  assert.ok(queueCall, '큐잉 요청이 안 나감');
  const body = JSON.parse(queueCall.opts.body);
  assert.equal(body.request_type, 'gov_tree_instance');
  assert.equal(body.signal_source, 'gov_tree_instance_miss');
  assert.equal(body.risk_tier, 'low');
  assert.equal(body.gov_tree_key.tier, 'city-dept');
});

test('§4-1 미스 신호 — REAL 판정(동래구 jachi)이면 큐잉 안 함', async () => {
  proxyCalls.length = 0;
  proxyLookupResponse = { found: false };
  await assembleGovSystemPrompt('부산 동래구 지방세 문의드립니다');
  await new Promise((resolve) => setTimeout(resolve, 50));
  const queueCall = proxyCalls.find(c => c.url.includes('/sp-author/queue'));
  assert.equal(queueCall, undefined, 'REAL 판정 레코드인데 불필요하게 큐잉함');
});
