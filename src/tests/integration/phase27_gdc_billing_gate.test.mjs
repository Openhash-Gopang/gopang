/**
 * phase27_gdc_billing_gate.test.mjs
 *
 * 2026-07-28 신설. 오늘 세션에서 활성화한 GDC STEP-0 잔액 게이트
 * (_gdcFreeQuotaGate)와 hondi-chat/K-Law/기업(Business)/정부기관(Gov)
 * 4개 진입점 전체에 대한 연동, 그리고 함께 수정한 L1 잔액조회 재시도·
 * 환율 정합성 감시·가입보너스 멱등분기 자동 재시도를 검증한다.
 *
 * 이 커밋 전까지 이 로직은 저장소에 자동 테스트가 전혀 없었다 — 별도
 * 세션에서 임시 스크립트로 11개 시나리오를 직접 실행 검증했으나 저장소에
 * 남기지 않아 재현 불가능했다. 이 파일이 그 공백을 메운다.
 * (docs/HONDI_FIELD_TEST_SMOKE_PLAN_v1_0.md §2.2 참고)
 *
 * phase25_security_regression.test.mjs와 동일한 워커통합(Worker
 * Integration) 방식 — worker.js를 직접 import해서 실제 라우팅
 * (/deepseek, /klaw/relay, /business/relay, /gov/relay,
 * /gwp/register-key)을 그대로 태우고, fetch만 mock한다. 라이브 인프라
 * 불필요, 이 샌드박스에서 완전히 실행 가능.
 *
 * 가장 중요하게 검증하는 것: **잔액 부족 시 DeepSeek(실비 발생 지점)가
 * 아예 호출되지 않는지**(비용 발생 순서) — 게이트가 있어도 순서가
 * 잘못되면(예: 먼저 호출하고 나중에 거부) 실비는 이미 나간 뒤라 게이트가
 * 무의미해진다.
 */

import { describe, it, before, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// ══════════════════════════════════════════════════════════════════
// KV mock — AI_SETUP_SEALS_KV. worker.js가 실제로 쓰는 get/put/delete만
// 구현(expirationTtl은 테스트에서 무시해도 무방 — 만료 검증은 범위 밖).
// ══════════════════════════════════════════════════════════════════
function makeKvMock() {
  const store = new Map();
  return {
    async get(key) { return store.has(key) ? store.get(key) : null; },
    async put(key, value) { store.set(key, String(value)); },
    async delete(key) { store.delete(key); },
    _store: store,
  };
}

// ══════════════════════════════════════════════════════════════════
// L1 mock — /api/balance, /api/ai-charge, /api/mint, /api/admins/*,
// gdc_keys 컬렉션, ai_usage_log 컬렉션, DeepSeek 벤더 API까지 전부 이
// 한 라우터가 처리한다. 시나리오별로 balances/behavior를 조작해 잔액
// 충분/부족/L1다운/블립을 재현한다.
// ══════════════════════════════════════════════════════════════════
let balances;       // guid -> GDC 잔액
let exchangeRate;   // L1이 응답하는 환율(불일치 테스트용으로 조작 가능)
let balanceFailMode; // null | 'always' | 'once'(첫 시도만 실패, 재시도는 성공)
let balanceCallCount;
let deepseekCalled;
let aiChargeCalls;
let mintCalls;
let gdcKeysDb;
let usageLogCalls;

function resetGdcState() {
  balances = {};
  exchangeRate = 1;
  balanceFailMode = null;
  balanceCallCount = 0;
  deepseekCalled = 0;
  aiChargeCalls = [];
  mintCalls = [];
  gdcKeysDb = [];
  usageLogCalls = [];
}

function installMockFetch() {
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = new URL(String(url));
    const method = init.method || 'GET';

    // ── DeepSeek 벤더 API — 실비 발생 지점. 호출 여부 자체가 이 테스트의 핵심 관찰값.
    if (u.hostname === 'api.deepseek.com') {
      deepseekCalled++;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '테스트 응답입니다.' } }],
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      }), { status: 200 });
    }

    // ── L1 관리자 인증
    if (u.pathname === '/api/admins/auth-with-password') {
      return new Response(JSON.stringify({ token: 'mock-admin-token' }), { status: 200 });
    }

    // ── GDC 잔액 조회 — _l1GetBalanceKRW가 부르는 지점
    if (u.pathname === '/api/balance') {
      balanceCallCount++;
      if (balanceFailMode === 'always') throw new Error('ECONNREFUSED(mock: L1 다운)');
      if (balanceFailMode === 'once' && balanceCallCount === 1) throw new Error('일시적 블립(mock)');
      const guid = u.searchParams.get('guid');
      return new Response(JSON.stringify({
        ok: true, guid, balance: balances[guid] ?? 0, exchange_rate: exchangeRate,
      }), { status: 200 });
    }

    // ── GDC 실사용 차감 — _chargeGdcForAiUsage가 부르는 지점
    if (u.pathname === '/api/ai-charge') {
      const body = JSON.parse(init.body);
      aiChargeCalls.push(body);
      const guid = body.guid;
      const before = balances[guid] ?? 0;
      if (before < body.krw_amount) {
        return new Response(JSON.stringify({ ok: false, error: 'INSUFFICIENT_BALANCE' }), { status: 402 });
      }
      balances[guid] = before - body.krw_amount;
      return new Response(JSON.stringify({
        ok: true, charged_gdc: body.krw_amount, balance_after: balances[guid],
      }), { status: 200 });
    }

    // ── 가입 보너스 — /api/mint
    if (u.pathname === '/api/mint') {
      const body = JSON.parse(init.body);
      mintCalls.push(body);
      balances[body.guid] = (balances[body.guid] ?? 0) + body.krw_amount;
      return new Response(JSON.stringify({ ok: true, amount: body.krw_amount, content_hash: 'mockhash' }), { status: 200 });
    }

    // ── gdc_keys 컬렉션(핸들: /gwp/register-key)
    const gdcKeysMatch = u.pathname.match(/^\/api\/collections\/gdc_keys\/records\/?$/);
    if (gdcKeysMatch && method === 'GET') {
      const filter = decodeURIComponent(u.searchParams.get('filter') || '');
      const m = filter.match(/^guid='(.*)'$/);
      const items = m ? gdcKeysDb.filter(r => r.guid === m[1]) : [];
      return new Response(JSON.stringify({ items }), { status: 200 });
    }
    if (gdcKeysMatch && method === 'POST') {
      const body = JSON.parse(init.body);
      gdcKeysDb.push(body);
      return new Response(JSON.stringify({ id: 'mock_key_' + gdcKeysDb.length, ...body }), { status: 200 });
    }

    // ── AI 사용 로그(감사용, 과금과 무관) — 실패해도 응답 흐름에 영향 없음(코드가 그렇게 설계됨)
    if (u.pathname === '/api/collections/ai_usage_log/records' && method === 'POST') {
      usageLogCalls.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ id: 'mock_log' }), { status: 200 });
    }

    // UNIVERSAL-INTEGRITY 등 프롬프트 레지스트리 로드는 실패해도 빈 문자열로
    // 계속 진행하도록 이미 설계돼 있다(코드 자체 방어) — 여기선 그냥 거부해
    // "로드 실패, 계속 진행" 경로까지 함께 태운다(운영과 동일 조건).
    throw new Error('mock: 의도적으로 처리 안 함(설계상 graceful fallback 유도): ' + u.pathname);
  };
  return () => { globalThis.fetch = realFetch; };
}

// ══════════════════════════════════════════════════════════════════
// Ed25519 헬퍼 — phase25와 동일 패턴(가입보너스 테스트의 /gwp/register-key용)
// ══════════════════════════════════════════════════════════════════
function toB64u(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
async function genKeyPair() {
  const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
  const rawPub = await crypto.subtle.exportKey('raw', kp.publicKey);
  return { privateKey: kp.privateKey, pubkeyB64u: toB64u(rawPub) };
}
async function sign(privateKey, message) {
  const sig = await crypto.subtle.sign('Ed25519', privateKey, new TextEncoder().encode(message));
  return toB64u(sig);
}

// ══════════════════════════════════════════════════════════════════
let worker;
let kvMock;
let ENV;

before(async () => {
  installMockFetch();
  worker = (await import('../../../worker.js')).default;
});

beforeEach(() => {
  resetGdcState();
  kvMock = makeKvMock();
  ENV = {
    DEEPSEEK_API_KEY: 'test-key',
    AI_SETUP_SEALS_KV: kvMock,
    L1_ADMIN_EMAIL: 'admin@test', L1_ADMIN_PASSWORD: 'pw',
  };
});

function req(pathname, body) {
  return new Request(`https://hondi-proxy.example${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Origin': 'https://public.hondi.net' },
    body: JSON.stringify(body),
  });
}
async function call(pathname, body) {
  const res = await worker.fetch(req(pathname, body), ENV, { waitUntil: (p) => p.catch(() => {}) });
  // 정산은 ctx.waitUntil로 넘어가는 비동기 작업이라, 응답을 받은 뒤에도
  // /api/ai-charge 호출이 잠깐 늦게 도착할 수 있다 — 짧게 기다린다.
  await new Promise(r => setTimeout(r, 20));
  const json = await res.json().catch(() => null);
  return { status: res.status, json };
}

// ══════════════════════════════════════════════════════════════════
// GATE — hondi-chat(/deepseek) 진입점
// ══════════════════════════════════════════════════════════════════
describe('GDC-GATE: hondi-chat(/deepseek) STEP-0 게이트', () => {
  it('GATE-01: 잔액 충분(50GDC) → 200 정상 + DeepSeek 호출됨 + ai-charge로 실제 차감', async () => {
    balances['guid-충분'] = 50;
    const { status, json } = await call('/deepseek', {
      guid: 'guid-충분', model: 'hondi-flash', messages: [{ role: 'user', content: '안녕' }], stream: false,
    });
    assert.equal(status, 200);
    assert.ok(json.choices, 'DeepSeek 응답이 그대로 전달돼야 함');
    assert.equal(deepseekCalled, 1, 'DeepSeek가 정확히 1회 호출돼야 함');
    assert.equal(aiChargeCalls.length, 1, '실사용량만큼 ai-charge가 호출돼야 함');
    assert.equal(aiChargeCalls[0].guid, 'guid-충분');
    assert.ok(aiChargeCalls[0].krw_amount > 0, '청구액이 0보다 커야 함');
  });

  it('GATE-02: 잔액 부족(1GDC) → 402 GDC_INSUFFICIENT_BALANCE + DeepSeek 호출 안 됨(비용 발생 순서 검증)', async () => {
    balances['guid-부족'] = 1;
    const { status, json } = await call('/deepseek', {
      guid: 'guid-부족', model: 'hondi-flash', messages: [{ role: 'user', content: '안녕' }], stream: false,
    });
    assert.equal(status, 402);
    assert.equal(json.error, 'GDC_INSUFFICIENT_BALANCE');
    assert.equal(deepseekCalled, 0, '차단됐다면 DeepSeek 실비가 전혀 발생하면 안 됨 — 이게 게이트의 존재 이유');
    assert.equal(aiChargeCalls.length, 0);
  });

  it('GATE-03: L1 완전 다운(재시도까지 실패) → 502 안전 차단 + DeepSeek 호출 안 됨', async () => {
    balances['guid-L1다운'] = 50; // 잔액은 충분하지만 조회 자체가 안 되는 상황
    balanceFailMode = 'always';
    const { status, json } = await call('/deepseek', {
      guid: 'guid-L1다운', model: 'hondi-flash', messages: [{ role: 'user', content: '안녕' }], stream: false,
    });
    assert.equal(status, 502);
    assert.equal(json.error, 'GDC_BALANCE_CHECK_FAILED');
    assert.equal(deepseekCalled, 0, '잔액을 확인할 수 없으면 안전하게 차단 — 무제한 무료로 새면 안 됨');
    assert.equal(balanceCallCount, 2, '250ms 재시도 1회가 실제로 일어나야 함(총 2회 시도)');
  });

  it('GATE-04: L1 첫 시도만 블립, 재시도로 복구 → 200 정상(오탐으로 정상 사용자를 막지 않음)', async () => {
    balances['guid-블립'] = 50;
    balanceFailMode = 'once';
    const { status } = await call('/deepseek', {
      guid: 'guid-블립', model: 'hondi-flash', messages: [{ role: 'user', content: '안녕' }], stream: false,
    });
    assert.equal(status, 200);
    assert.equal(deepseekCalled, 1);
    assert.equal(balanceCallCount, 2, '첫 시도 실패 + 재시도 성공으로 총 2회');
  });
});

// ══════════════════════════════════════════════════════════════════
// INTEG — K-Law / 기업(Business) / 정부기관(Gov) 3개 진입점에도
// 동일 게이트+정산이 연동됐는지(주피터 결정: "전부 GDC 연동")
// ══════════════════════════════════════════════════════════════════
describe('GDC-INTEG: K-Law·기업·정부기관 릴레이 GDC 연동', () => {
  it('K-Law: 잔액 부족 → 402 + DeepSeek 호출 안 됨', async () => {
    balances['guid-klaw-부족'] = 0;
    const { status, json } = await call('/klaw/relay', {
      guid: 'guid-klaw-부족', tier: 'klaw-flash',
      messages: [{ role: 'user', content: '계약서 검토해줘' }], stream: false,
    });
    assert.equal(status, 402);
    assert.equal(json.error, 'GDC_INSUFFICIENT_BALANCE');
    assert.equal(deepseekCalled, 0, 'K-Law도 hondi-chat과 동일하게 실비 전에 차단돼야 함');
  });

  it('K-Law: 잔액 충분 → 200 + ai-charge에 serviceId=klaw로 청구', async () => {
    balances['guid-klaw-충분'] = 50;
    const { status } = await call('/klaw/relay', {
      guid: 'guid-klaw-충분', tier: 'klaw-flash',
      messages: [{ role: 'user', content: '계약서 검토해줘' }], stream: false,
    });
    assert.equal(status, 200);
    assert.equal(deepseekCalled, 1);
    assert.equal(aiChargeCalls.length, 1);
    assert.equal(aiChargeCalls[0].service_id, 'klaw');
  });

  it('기업(Business): 잔액 부족 → 402 + DeepSeek 호출 안 됨', async () => {
    balances['guid-biz-부족'] = 0;
    const { status } = await call('/business/relay', {
      guid: 'guid-biz-부족', business_id: 'biz-001', agencyPrompt: '[SP]',
      messages: [{ role: 'user', content: '문의' }], stream: false,
    });
    assert.equal(status, 402);
    assert.equal(deepseekCalled, 0);
  });

  it('기업(Business): 잔액 충분 → 200 + ai-charge가 guid(개인 지갑) 기준으로 청구됨(bizKey 아님)', async () => {
    balances['guid-biz-충분'] = 50;
    const { status } = await call('/business/relay', {
      guid: 'guid-biz-충분', business_id: 'biz-001', agencyPrompt: '[SP]',
      messages: [{ role: 'user', content: '문의' }], stream: false,
    });
    assert.equal(status, 200);
    assert.equal(aiChargeCalls.length, 1);
    assert.equal(aiChargeCalls[0].guid, 'guid-biz-충분', 'bizKey가 아니라 실제 guid로 차감돼야 함');
    assert.equal(aiChargeCalls[0].service_id, 'biz:biz-001');
  });

  it('정부기관(Gov): 잔액 부족 → 402 + DeepSeek 호출 안 됨', async () => {
    balances['guid-gov-부족'] = 0;
    const { status } = await call('/gov/relay', {
      guid: 'guid-gov-부족', agency: 'health', agencyPrompt: '[SP]',
      messages: [{ role: 'user', content: '문의' }], stream: false,
    });
    assert.equal(status, 402);
    assert.equal(deepseekCalled, 0, '정부기관도 예외 없이 동일 게이트 적용');
  });

  it('정부기관(Gov): 잔액 충분 → 200 + ai-charge에 serviceId=gov:health로 청구', async () => {
    balances['guid-gov-충분'] = 50;
    const { status } = await call('/gov/relay', {
      guid: 'guid-gov-충분', agency: 'health', agencyPrompt: '[SP]',
      messages: [{ role: 'user', content: '문의' }], stream: false,
    });
    assert.equal(status, 200);
    assert.equal(aiChargeCalls.length, 1);
    assert.equal(aiChargeCalls[0].service_id, 'gov:health');
  });
});

// ══════════════════════════════════════════════════════════════════
// RATE — 환율 상수 정합성 감시(worker.js 로컬 상수 vs L1 실제 응답)
// ══════════════════════════════════════════════════════════════════
describe('GDC-RATE: 환율 불일치 경보', () => {
  it('L1이 다른 환율(100)을 응답하면 GDC_EXCHANGE_RATE_MISMATCH 경보가 찍힌다', async () => {
    balances['guid-환율'] = 50;
    exchangeRate = 100; // worker.js 로컬 상수(1)와 의도적으로 다르게
    const originalError = console.error;
    const logs = [];
    console.error = (...args) => logs.push(args.join(' '));
    try {
      await call('/deepseek', {
        guid: 'guid-환율', model: 'hondi-flash', messages: [{ role: 'user', content: '안녕' }], stream: false,
      });
    } finally {
      console.error = originalError;
    }
    assert.ok(logs.some(l => l.includes('GDC_EXCHANGE_RATE_MISMATCH')),
      '환율 불일치 시 경보가 반드시 찍혀야 함(4곳 중복 선언 재확인 트리거)');
  });
});

// ══════════════════════════════════════════════════════════════════
// BONUS — 가입 보너스 멱등분기 자동 재시도(2026-07-28 결함 수정)
// ══════════════════════════════════════════════════════════════════
describe('GDC-BONUS: 가입 보너스 자동 재시도', () => {
  it('BONUS-01: 신규 가입 → mint 1회 호출, 잔액에 100원 반영', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    const guid = 'guid-신규가입';
    const ts = Date.now();
    const signature = await sign(privateKey, `register-key:${guid}:${ts}`);
    const { status } = await call('/gwp/register-key', { guid, public_key: pubkeyB64u, signature, ts });
    assert.equal(status, 200);
    assert.equal(mintCalls.length, 1, '신규 가입이면 mint가 정확히 1회 호출돼야 함');
    assert.equal(balances[guid], 100, '가입 보너스 100원이 잔액에 반영돼야 함');
  });

  it('BONUS-02: 최초 mint 실패 후 재등록(멱등 분기) → 자동 재시도로 이번엔 성공(결함 수정 확인)', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    const guid = 'guid-mint실패후재시도';

    // 1차: mint를 일시적으로 실패시켜 "최초 등록은 됐는데 보너스는 못 받은" 상태를 재현
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, init) => {
      const u = new URL(String(url));
      if (u.pathname === '/api/mint') throw new Error('mock: 일시적 mint 실패');
      return realFetch(url, init);
    };
    const ts1 = Date.now();
    const sig1 = await sign(privateKey, `register-key:${guid}:${ts1}`);
    const first = await call('/gwp/register-key', { guid, public_key: pubkeyB64u, signature: sig1, ts: ts1 });
    globalThis.fetch = realFetch;

    assert.equal(first.status, 200, 'mint 실패해도 등록 자체는 막지 않아야 함(기존 설계)');
    assert.equal(balances[guid] ?? 0, 0, '이번엔 보너스가 지급되지 않았어야 함(mint 실패)');
    assert.equal(gdcKeysDb.filter(r => r.guid === guid).length, 1, 'gdc_keys 레코드는 이미 생성돼 있음');

    // 2차: 같은 키로 재등록(멱등 분기) — 수정 전에는 이 분기가 _grantSignupBonus를
    // 아예 호출하지 않아 영원히 보너스를 못 받았다(사고실험으로 발견한 결함).
    const ts2 = Date.now() + 1;
    const sig2 = await sign(privateKey, `register-key:${guid}:${ts2}`);
    const second = await call('/gwp/register-key', { guid, public_key: pubkeyB64u, signature: sig2, ts: ts2 });

    assert.equal(second.status, 200);
    assert.equal(mintCalls.length, 1, '2차(재등록) 시도에서 mint가 성공적으로 호출돼야 함');
    assert.equal(balances[guid], 100, '재등록을 통해 결국 가입 보너스가 지급돼야 함 — 이게 이번 수정의 핵심');
  });

  it('BONUS-03: 이미 보너스 지급된 계정이 재등록해도 mint를 또 호출하지 않는다(멱등 — 불필요한 L1 호출 방지)', async () => {
    const { privateKey, pubkeyB64u } = await genKeyPair();
    const guid = 'guid-이미지급';
    const ts1 = Date.now();
    const sig1 = await sign(privateKey, `register-key:${guid}:${ts1}`);
    await call('/gwp/register-key', { guid, public_key: pubkeyB64u, signature: sig1, ts: ts1 });
    assert.equal(mintCalls.length, 1);

    const ts2 = Date.now() + 1;
    const sig2 = await sign(privateKey, `register-key:${guid}:${ts2}`);
    await call('/gwp/register-key', { guid, public_key: pubkeyB64u, signature: sig2, ts: ts2 });

    assert.equal(mintCalls.length, 1, 'KV 플래그로 멱등 처리 — 이미 지급된 계정은 mint를 다시 부르면 안 됨');
    assert.equal(balances[guid], 100, '중복 지급되지 않아야 함(여전히 100원)');
  });
});
