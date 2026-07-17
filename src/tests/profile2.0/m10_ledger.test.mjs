/**
 * M10 Ledger 모듈 테스트
 * node m10_ledger.test.mjs
 */

import {
  validateLedgerEntry,
  buildMarketPurchaseRows,
  verifyBIVM,
  reconstructBalances,
  detectBalanceAnomalies,
  computeSettledFs,
  marketPurchaseRPC,
} from '../../profile2.0/ledger.js';

let pass = 0, fail = 0;
function assert(id, cond, detail = '') {
  if (cond) { console.log(`  ✅ ${id}`); pass++; }
  else       { console.error(`  ❌ ${id}${detail ? ' — ' + detail : ''}`); fail++; }
}

console.log('\n[validateLedgerEntry]');
assert('VAL-1', validateLedgerEntry({ amount: 1000, source: 'market', direction: 'debit' }) === null);
assert('VAL-2', validateLedgerEntry({ amount: 0,    source: 'market', direction: 'debit' })?.error === 'INVALID_AMOUNT');
assert('VAL-3', validateLedgerEntry({ amount: -1,   source: 'market', direction: 'debit' })?.error === 'INVALID_AMOUNT');
assert('VAL-4', validateLedgerEntry({ amount: 1000, source: 'kmarket', direction: 'debit' })?.error === 'CHECK_VIOLATION',
  'kmarket → CHECK_VIOLATION');

console.log('\n[buildMarketPurchaseRows]');
{
  const rows = buildMarketPurchaseRows({
    buyerGuid: 'buyer', sellerGuid: 'seller', platformGuid: 'platform',
    amount: 10000, blockHash: 'bh-001', txId: 'tx-001',
  });
  assert('LD01-rows', rows.length === 3, `rows=${rows.length}`);
  assert('LD01-buyer',    rows[0].direction === 'debit'  && rows[0].amount === 10000);
  assert('LD01-seller',   rows[1].direction === 'credit' && rows[1].amount === 9700,  `got ${rows[1].amount}`);
  assert('LD01-platform', rows[2].direction === 'credit' && rows[2].amount === 300,   `got ${rows[2].amount}`);
  assert('LD01-source',   rows.every(r => r.source === 'market'));

  // BIVM Σδ=0
  const bivm = verifyBIVM(rows);
  assert('LD04-BIVM', bivm.balanced, `debit=${bivm.totalDebit} credit=${bivm.totalCredit}`);
}

// amount=0 예외
{
  let threw = false;
  try { buildMarketPurchaseRows({ buyerGuid: 'b', sellerGuid: 's', platformGuid: 'p', amount: 0, blockHash: 'x', txId: 'x' }); }
  catch { threw = true; }
  assert('LD07-amount0', threw);
}

console.log('\n[reconstructBalances]');
{
  const rows = buildMarketPurchaseRows({
    buyerGuid: 'buyer', sellerGuid: 'seller', platformGuid: 'platform',
    amount: 6000, blockHash: 'bh-002', txId: 'tx-002',
  });

  // LD02 — pl-purchase 양수 누적 (3회 구매)
  const all3 = [
    ...buildMarketPurchaseRows({ buyerGuid: 'buyer', sellerGuid: 'seller', platformGuid: 'platform', amount: 1000, blockHash: 'bh-1', txId: 'tx-1' }),
    ...buildMarketPurchaseRows({ buyerGuid: 'buyer', sellerGuid: 'seller', platformGuid: 'platform', amount: 2000, blockHash: 'bh-2', txId: 'tx-2' }),
    ...buildMarketPurchaseRows({ buyerGuid: 'buyer', sellerGuid: 'seller', platformGuid: 'platform', amount: 3000, blockHash: 'bh-3', txId: 'tx-3' }),
  ];
  const bal = reconstructBalances(all3, 'buyer');
  assert('LD02-plPurchase',   bal.plPurchase === 6000, `plPurchase=${bal.plPurchase}`);
  assert('LD02-allPositive',  bal.plPurchase > 0);

  // LD03 — bs-cash = Σcredit - Σdebit
  const sellerBal = reconstructBalances(all3, 'seller');
  const expected  = (1000 * 0.97 + 2000 * 0.97 + 3000 * 0.97);
  assert('LD03-bsCash', Math.abs(sellerBal.bsCash - expected) < 1, `bsCash=${sellerBal.bsCash} expected=${expected}`);
}

console.log('\n[detectBalanceAnomalies]');
{
  // LD05 — 불일치 탐지
  const rows = buildMarketPurchaseRows({
    buyerGuid: 'buyer', sellerGuid: 'seller', platformGuid: 'platform',
    amount: 5000, blockHash: 'bh', txId: 'tx',
  });
  const correctFs = computeSettledFs(rows, 'buyer');
  const wrongFs   = { 'bs-cash': 9999, 'pl-purchase': 0, 'pl-revenue': 0 };

  const profiles = [
    { guid: 'buyer',  extra: { fs: wrongFs } },     // 불일치
    { guid: 'seller', extra: { fs: computeSettledFs(rows, 'seller') } },  // 일치
  ];
  const anomalies = detectBalanceAnomalies(rows, profiles);
  assert('LD05-mismatch',  anomalies.length === 1 && anomalies[0].guid === 'buyer',
    `anomalies=${JSON.stringify(anomalies)}`);
  assert('LD05-normal',    anomalies.every(a => a.guid !== 'seller'));
}

console.log('\n[computeSettledFs]');
{
  // LD08 — extra.fs = reconstruct 결과 일치
  const rows = buildMarketPurchaseRows({
    buyerGuid: 'u1', sellerGuid: 'u2', platformGuid: 'u3',
    amount: 3000, blockHash: 'bh', txId: 'tx',
  });
  const fs   = computeSettledFs(rows, 'u1');
  const bal  = reconstructBalances(rows, 'u1');
  assert('LD08', fs['bs-cash'] === bal.bsCash && fs['pl-purchase'] === bal.plPurchase,
    `fs=${JSON.stringify(fs)}`);
}

console.log('\n[marketPurchaseRPC — 네트워크 모의]');
{
  // LD06 — source='kmarket' → CHECK_VIOLATION
  global.fetch = async () => ({
    ok: false,
    status: 400,
    text: async () => '23514',
  });

  let err = null;
  try {
    await marketPurchaseRPC(
      { SUPABASE_URL: 'https://mock', SUPABASE_SERVICE_KEY: 'key' },
      { buyerGuid: 'b', sellerGuid: 's', platformGuid: 'p', amount: 1000, blockHash: 'bh', txId: 'tx' }
    );
  } catch (e) { err = e; }
  assert('LD06-checkViolation', err?.message.includes('CHECK_VIOLATION'), `err=${err?.message}`);
}

{
  // 정상 RPC 응답
  global.fetch = async () => ({
    ok: true,
    json: async () => ({ inserted: 3 }),
  });
  const result = await marketPurchaseRPC(
    { SUPABASE_URL: 'https://mock', SUPABASE_SERVICE_KEY: 'key' },
    { buyerGuid: 'b', sellerGuid: 's', platformGuid: 'p', amount: 5000, blockHash: 'bh', txId: 'tx' }
  );
  assert('LD01-rpc', result?.inserted === 3);
}

console.log(`\n결과: ${pass} 통과 / ${fail} 실패`);
if (fail > 0) process.exit(1);
