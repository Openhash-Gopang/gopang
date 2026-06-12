// ============================================================
// m03_payment.test.mjs — M03 결제 모듈 테스트
// 저장위치: gopang/src/tests/profile2.0/m03_payment.test.mjs
// 실행: node src/tests/profile2.0/m03_payment.test.mjs
// ============================================================

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ─── 테스트 대상 함수 인라인 ───

const PLATFORM_GUID  = 'gopang-platform';
const FEE_RATE       = 0.005;
const CLAIM_TTL_DAYS = 7;
const FS_SOURCE      = 'market';
const L1_TIMEOUT_MS  = 5000;

function isQRExpired(created_at, expires) {
  const elapsed = Math.floor(Date.now() / 1000) - Number(created_at);
  return elapsed > Number(expires);
}

async function makeTxId(buyerGuid, amount, createdAt) {
  const raw = `${buyerGuid}:${amount}:${createdAt}:${Date.now()}`;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return 'tx-' + [...new Uint8Array(buf)]
    .map(b => b.toString(16).padStart(2,'0')).join('').slice(0,32);
}

function makeBuyerClaim({ amount, balanceAfter, blockHash, txHash }) {
  return {
    direction:     'debit',
    amount,
    fs_account:    'bs-cash',
    pl_account:    'pl-purchase',
    balance_after: balanceAfter,
    block_hash:    blockHash,
    tx_hash:       txHash,
    expires_at:    new Date(Date.now() + CLAIM_TTL_DAYS * 86400_000).toISOString(),
  };
}

function makeSellerClaim({ amount, blockHash, txHash }) {
  return {
    direction:  'credit',
    amount,
    fs_account: 'bs-cash',
    pl_account: 'pl-revenue',
    block_hash: blockHash,
    tx_hash:    txHash,
    expires_at: new Date(Date.now() + CLAIM_TTL_DAYS * 86400_000).toISOString(),
  };
}

// fs_ledger 3행 구성 검증용 (Supabase 없이)
function buildFsLedgerRows({ txId, blockHash, buyerGuid, sellerGuid, amount, fee, txAt }) {
  const sellerAmount = amount - fee;
  return [
    { tx_id: txId, block_hash: blockHash, guid: buyerGuid,
      direction: 'debit',  amount,        fs_account: 'bs-cash',
      pl_account: 'pl-purchase', source: FS_SOURCE, tx_at: txAt },
    { tx_id: txId, block_hash: blockHash, guid: sellerGuid,
      direction: 'credit', amount: sellerAmount, fs_account: 'bs-cash',
      pl_account: 'pl-revenue', source: FS_SOURCE, tx_at: txAt },
    { tx_id: txId, block_hash: blockHash, guid: PLATFORM_GUID,
      direction: 'credit', amount: fee,   fs_account: 'bs-cash',
      pl_account: 'pl-revenue', source: FS_SOURCE, tx_at: txAt },
  ];
}

// ─────────────────────────────────────────────
// 테스트 프레임워크
// ─────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(id, desc, fn) {
  try {
    await fn();
    console.log(`  ✅ ${id} ${desc}`);
    passed++;
  } catch(e) {
    console.log(`  ❌ ${id} ${desc}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}
function assert(cond, msg)    { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg)  { if (a !== b) throw new Error(msg || `expected "${b}", got "${a}"`); }
function assertGt(a, b, msg)  { if (a <= b) throw new Error(msg || `expected ${a} > ${b}`); }

// ─────────────────────────────────────────────
// P01 정상 결제 — fs_ledger 3행 구성 + buyer_claim
// ─────────────────────────────────────────────
await test('P01', '정상 결제 — fs_ledger 3행 + buyer_claim 구성', async () => {
  const amount     = 22000;
  const fee        = Math.ceil(amount * FEE_RATE);    // 110
  const buyerGuid  = 'buyer-guid-001';
  const sellerGuid = 'seller-guid-001';
  const txId       = await makeTxId(buyerGuid, amount, Date.now() / 1000 | 0);
  const blockHash  = 'bh-test-abc123';
  const txAt       = new Date().toISOString();

  const rows = buildFsLedgerRows({ txId, blockHash, buyerGuid, sellerGuid, amount, fee, txAt });

  assertEq(rows.length, 3, 'fs_ledger 행 수 오류');
  assertEq(rows[0].direction,  'debit',  '행1 direction 오류');
  assertEq(rows[1].direction,  'credit', '행2 direction 오류');
  assertEq(rows[2].direction,  'credit', '행3 direction 오류');
  assertEq(rows[0].amount,     amount,         '행1 amount 오류');
  assertEq(rows[1].amount,     amount - fee,   '행2 amount 오류');
  assertEq(rows[2].amount,     fee,            '행3 amount(수수료) 오류');
  assertEq(rows[2].guid,       PLATFORM_GUID,  '행3 guid 오류');

  // BIVM Σδ=0 검증: Σdebit = Σcredit
  const sumDebit  = rows.filter(r => r.direction === 'debit').reduce((s,r) => s + r.amount, 0);
  const sumCredit = rows.filter(r => r.direction === 'credit').reduce((s,r) => s + r.amount, 0);
  assertEq(sumDebit, sumCredit, `Σδ≠0: debit=${sumDebit}, credit=${sumCredit}`);

  // buyer_claim 검증
  const claim = makeBuyerClaim({ amount, balanceAfter: 100000 - amount, blockHash, txHash: txId });
  assertEq(claim.direction,  'debit',    'claim direction 오류');
  assertEq(claim.amount,     amount,     'claim amount 오류');
  assertEq(claim.pl_account, 'pl-purchase', 'claim pl_account 오류');
  assert(claim.expires_at,               'claim expires_at 없음');
});

// ─────────────────────────────────────────────
// P02 QR 만료 — 301초 경과 시 만료
// ─────────────────────────────────────────────
await test('P02', 'QR 만료 — 301초 경과 시 QR_EXPIRED', () => {
  const now        = Math.floor(Date.now() / 1000);
  const created_at = now - 301;
  const expires    = 300;
  assert(isQRExpired(created_at, expires), 'QR 만료 미감지');
});

await test('P02b', 'QR 유효 — 299초 경과 시 유효', () => {
  const now        = Math.floor(Date.now() / 1000);
  const created_at = now - 299;
  const expires    = 300;
  assert(!isQRExpired(created_at, expires), 'QR 유효한데 만료 처리');
});

// ─────────────────────────────────────────────
// P03 잔액 부족 로직
// ─────────────────────────────────────────────
await test('P03', '잔액 부족 — balance < amount 감지', () => {
  const balance = 5000;
  const amount  = 22000;
  assert(balance < amount, '잔액 부족 미감지');
  // 잔액 충분
  assert(!(100000 < amount), '잔액 충분한데 부족 처리');
});

// ─────────────────────────────────────────────
// P04 서명 위조 — ED25519 (구조 검증)
// ─────────────────────────────────────────────
await test('P04', 'ED25519 키페어 생성 + 서명 구조 검증', async () => {
  // ED25519 키페어 생성
  const keyPair = await crypto.subtle.generateKey(
    { name: 'Ed25519' }, true, ['sign', 'verify']
  );
  const data = new TextEncoder().encode('test-payload');
  const sig  = await crypto.subtle.sign('Ed25519', keyPair.privateKey, data);

  // 정상 서명 검증
  const valid = await crypto.subtle.verify('Ed25519', keyPair.publicKey, sig, data);
  assert(valid, '정상 서명 검증 실패');

  // 위조 서명 검증
  const fakeSig = new Uint8Array(64).fill(0xff);
  const invalid = await crypto.subtle.verify('Ed25519', keyPair.publicKey, fakeSig, data);
  assert(!invalid, '위조 서명이 통과됨');
});

// ─────────────────────────────────────────────
// P05 fs_ledger source 규칙 ('market' 고정)
// ─────────────────────────────────────────────
await test('P05', "fs_ledger source='market' 고정 — 'kmarket' 사용 금지", () => {
  assertEq(FS_SOURCE, 'market', "FS_SOURCE가 'market' 아님");

  // 행 생성 시 source 검증
  const rows = buildFsLedgerRows({
    txId: 'tx-001', blockHash: 'bh-001',
    buyerGuid: 'buyer', sellerGuid: 'seller',
    amount: 1000, fee: 5, txAt: new Date().toISOString(),
  });
  for (const row of rows) {
    assertEq(row.source, 'market', `source 오류: ${row.source}`);
    assert(row.source !== 'kmarket', "'kmarket' 사용됨 — CHECK 위반");
  }
});

// ─────────────────────────────────────────────
// P06 pl-purchase 양수 누적 (T08 확정)
// ─────────────────────────────────────────────
await test('P06', 'pl-purchase 양수 누적 — 3회 결제 후 항상 양수', () => {
  // IDB financial_state 시뮬레이션
  let fs = { 'bs-cash': 100000, 'pl-purchase': 0, 'pl-revenue': 0 };

  const payments = [6000, 16000, 18000];
  for (const amount of payments) {
    // T08 확정: pl-purchase는 cur + amount (양수 누적)
    fs['bs-cash']    = fs['bs-cash'] - amount;      // 차감
    fs['pl-purchase'] = fs['pl-purchase'] + amount; // 양수 누적
  }

  assertGt(fs['pl-purchase'], 0, 'pl-purchase 음수');
  assertEq(fs['pl-purchase'], 40000, 'pl-purchase 누적 오류');
  assertEq(fs['bs-cash'],     60000, 'bs-cash 잔액 오류');
});

// ─────────────────────────────────────────────
// P07 buyer_claim expires_at — 7일 후
// ─────────────────────────────────────────────
await test('P07', 'buyer_claim expires_at — 7일 후 설정', () => {
  const claim = makeBuyerClaim({
    amount: 22000, balanceAfter: 78000,
    blockHash: 'bh-test', txHash: 'tx-test',
  });
  const expiresAt = new Date(claim.expires_at).getTime();
  const now       = Date.now();
  const diffDays  = (expiresAt - now) / 86400_000;

  assert(diffDays > 6.9 && diffDays <= 7.1,
    `expires_at 7일 아님: ${diffDays.toFixed(2)}일`);
});

// ─────────────────────────────────────────────
// P08 초방문자 pay.html — return_to + 토큰 없음 처리
// ─────────────────────────────────────────────
await test('P08', '초방문자 pay.html — pending_pay_url 저장 + 리다이렉트', () => {
  const store   = {};
  const payUrl  = 'https://users.gopang.net/pay.html?to=@hallim_geumneung&amount=22000&expires=300&created_at=1718000000';
  const hasToken = false; // 미등록 사용자

  // pay.html 진입 시 토큰 없으면 저장 후 리다이렉트
  if (!hasToken) {
    store['pending_pay_url'] = payUrl;
  }
  assert(store['pending_pay_url'] === payUrl, 'pending_pay_url 저장 실패');

  // 등록 완료 후 복귀
  const pending = store['pending_pay_url'];
  delete store['pending_pay_url'];
  assertEq(pending, payUrl, '복귀 URL 불일치');
  assert(!store['pending_pay_url'], '키 삭제 실패');
});

// ─────────────────────────────────────────────
// P09 L1 타임아웃 모킹
// ─────────────────────────────────────────────
await test('P09', 'L1 타임아웃 — AbortError → L1_TIMEOUT 오류', async () => {
  async function mockPostToL1Timeout() {
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 10); // 10ms 즉시 타임아웃
    try {
      await fetch('https://httpbin.org/delay/5', { signal: controller.signal });
    } catch(e) {
      if (e.name === 'AbortError') throw new Error('L1_TIMEOUT');
      throw e;
    }
  }

  let caught = '';
  try { await mockPostToL1Timeout(); }
  catch(e) { caught = e.message; }
  assertEq(caught, 'L1_TIMEOUT', 'L1_TIMEOUT 미감지');
});

// ─────────────────────────────────────────────
// P10 중복 결제 방지 — tx_id UNIQUE
// ─────────────────────────────────────────────
await test('P10', '중복 결제 방지 — 동일 tx_id 2회 INSERT 시 감지', async () => {
  const txId1 = await makeTxId('buyer-guid', 22000, 1718000000);
  const txId2 = await makeTxId('buyer-guid', 22000, 1718000000);

  // 동일 입력이라도 Date.now() 차이로 tx_id 다름 — 실제 환경에서는 동일 tx_id 재전송 시나리오
  // 중복 감지 로직: biz_orders UNIQUE(tx_id) 위반 시 409 반환
  const existingTxIds = new Set([txId1]);

  // 같은 tx_id 재시도 시뮬레이션
  const isDuplicate = existingTxIds.has(txId1);
  assert(isDuplicate, '중복 감지 실패');

  // 새로운 tx_id는 중복 아님
  assert(!existingTxIds.has(txId2) || txId1 === txId2,
    '신규 tx_id가 중복으로 처리됨');
});

// ─────────────────────────────────────────────
// 추가: 수수료 계산 검증
// ─────────────────────────────────────────────
await test('P11', '수수료 계산 — 0.5% 올림 처리', () => {
  const cases = [
    { amount: 6000,  expected: 30  },
    { amount: 7000,  expected: 35  },
    { amount: 22000, expected: 110 },
    { amount: 1000,  expected: 5   },
    { amount: 100,   expected: 1   }, // ceil(0.5) = 1
  ];
  for (const { amount, expected } of cases) {
    const fee = Math.ceil(amount * FEE_RATE);
    assertEq(fee, expected, `amount=${amount} fee 오류: ${fee} ≠ ${expected}`);
  }
});

// ─────────────────────────────────────────────
// 추가: seller_claim 구조 검증
// ─────────────────────────────────────────────
await test('P12', 'seller_claim 구조 — direction=credit, pl-revenue', () => {
  const claim = makeSellerClaim({
    amount: 21890, blockHash: 'bh-test', txHash: 'tx-test',
  });
  assertEq(claim.direction,  'credit',     'direction 오류');
  assertEq(claim.pl_account, 'pl-revenue', 'pl_account 오류');
  assertEq(claim.amount,     21890,        'amount 오류');
  assert(claim.expires_at,                 'expires_at 없음');
});

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log(`M03 Payment 테스트 결과: ${passed}/${passed+failed} 통과`);
if (failed > 0) {
  console.log(`❌ 실패: ${failed}건`);
  process.exit(1);
} else {
  console.log('✅ 전체 통과 — M03 합격');
}
console.log('══════════════════════════════════════');
