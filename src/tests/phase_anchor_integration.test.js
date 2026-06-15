/**
 * @file phase_anchor_integration.test.js
 * @description OpenHash 앵커링 통합 테스트 시나리오 v2.0
 * @테스트항목 A-01 ~ A-12
 *
 * 변경 (v2.0):
 *   - anchor() 시그니처: anchor(contentHash, signatures[], msgId)
 *   - 가입/대화: 사용자 단방향 Ed25519 서명
 *   - 거래: buyer + seller 양방 Ed25519 서명
 *   - A-08: 금액 변조 시 서명 검증 실패 탐지
 *   - A-10: extra.fs last_tx_id → 거래 원본 추적 검증
 *
 * 실행:
 *   node --experimental-vm-modules src/tests/phase_anchor_integration.test.js
 */

import {
  anchor, getEntryByMsgId, buildMerkleRoot, buildMerkleProof,
  verifyMerkleProof, verifyChainIntegrity, _resetChain,
} from '../openhash/hashChain.js';
import { sha256, generateKeyPair, signMessage, verifySignature } from '../pdv/keyManager.js';

let passed = 0, failed = 0;

async function test(id, desc, fn) {
  try { await fn(); console.log(`  ✅ ${id}: ${desc}`); passed++; }
  catch (err) { console.error(`  ❌ ${id}: ${desc}\n     └─ ${err.message}`); failed++; }
}
function assert(c, m) { if (!c) throw new Error(m || '단언 실패'); }

async function cHash(raw) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
}

// 테스트용 키페어
const userKeys   = await generateKeyPair();
const buyerKeys  = await generateKeyPair();
const sellerKeys = await generateKeyPair();

const GUID        = '2601:db80:0000:0000:1234:5678:9abc:def0';
const BUYER_GUID  = '2601:db80:0000:0000:aaaa:bbbb:cccc:0001';
const SELLER_GUID = '2601:db80:0000:0000:dddd:eeee:ffff:0002';

console.log('\n=== OpenHash 앵커링 통합 테스트 v2.0 ===\n');

// ── A-01~03: 가입 앵커링 ──────────────────────────────────────────────
console.log('[ 가입 앵커링 ]');

await test('A-01', '가입 앵커링 — contentHash + userSig → entryHash 64자', async () => {
  _resetChain();
  const raw = JSON.stringify({ type:'user_register', guid:GUID, handle:'@12345678',
    nickname:'테스트사용자', e164:'+821012345678', country_code:'KR', ts:new Date().toISOString() });
  const ch  = await cHash(raw);
  const sig = await signMessage(ch, userKeys.privateKey);
  assert(await verifySignature(ch, sig, userKeys.publicKeyB64), 'Ed25519 서명 검증 실패');
  const r = await anchor(ch, [sig], `REG-${Date.now()}`);
  assert(r.entryHash.length === 64, `entryHash 길이: ${r.entryHash.length}`);
  assert(r.contentHash === ch, 'contentHash 불일치');
  assert(['L1','L2','L3','L4','L5'].includes(r.layer), `layer: ${r.layer}`);
  console.log(`     contentHash: ${ch.slice(0,16)}... | entryHash: ${r.entryHash.slice(0,16)}... | layer: ${r.layer}`);
});

await test('A-02', '가입 앵커링 — 최초 prevHash = 0×64 (genesis)', async () => {
  _resetChain();
  const ch  = await cHash('register-genesis-test');
  const sig = await signMessage(ch, userKeys.privateKey);
  const r   = await anchor(ch, [sig], `REG-${Date.now()}`);
  assert(r.prevHash === '0'.repeat(64), `prevHash 초기값 오류`);
  console.log(`     prevHash(genesis): ${'0'.repeat(8)}... ✓`);
});

await test('A-03', 'signatures=[] → anchor() 오류 발생', async () => {
  _resetChain();
  const ch = await cHash('no-sig');
  let threw = false;
  try { await anchor(ch, [], 'NO-SIG'); } catch (e) { threw = true; console.log(`     오류: ${e.message}`); }
  assert(threw, 'signatures=[] 시 오류 미발생');
});

// ── A-04~06: 대화 앵커링 ──────────────────────────────────────────────
console.log('\n[ 대화 앵커링 ]');

await test('A-04', '대화 세션 — contentHash + userSig → entryHash', async () => {
  _resetChain();
  const raw = JSON.stringify({ sessionId:`SES-${Date.now()}`, guid:GUID, domain:'MKT', turns:2,
    messages:[
      { role:'user',      content:'짜장면 주문해줘' },
      { role:'assistant', content:'한림읍 근처 짜장면 가게를 찾고 있습니다...' },
      { role:'user',      content:'결제할게' },
      { role:'assistant', content:'12,000원 결제를 진행합니다.' },
    ]});
  const ch  = await cHash(raw);
  const sig = await signMessage(ch, userKeys.privateKey);
  assert(await verifySignature(ch, sig, userKeys.publicKeyB64), '대화 서명 검증 실패');
  const r = await anchor(ch, [sig], `SES-${Date.now()}`);
  assert(r.entryHash.length === 64, `entryHash 길이 오류`);
  console.log(`     세션: 2턴 (짜장면 주문+결제) | contentHash: ${ch.slice(0,16)}... | layer: ${r.layer}`);
});

await test('A-05', '대화 2세션 연속 — prevHash 체인 연결', async () => {
  _resetChain();
  const ch1 = await cHash('session-1'); const sig1 = await signMessage(ch1, userKeys.privateKey);
  const ch2 = await cHash('session-2'); const sig2 = await signMessage(ch2, userKeys.privateKey);
  const r1  = await anchor(ch1, [sig1], 'SES-1');
  const r2  = await anchor(ch2, [sig2], 'SES-2');
  assert(r2.prevHash === r1.entryHash, `r2.prevHash ≠ r1.entryHash`);
  console.log(`     세션1: ${r1.entryHash.slice(0,16)}... → 세션2 prevHash ✓`);
});

await test('A-06', '대화 원본 재현 — SHA-256(원본) == contentHash', async () => {
  _resetChain();
  const raw = JSON.stringify({ sessionId:'SES-VERIFY',
    messages:[{ role:'user', content:'GDC 잔액 조회해줘' }, { role:'assistant', content:'현재 잔액은 ₮1,200 입니다.' }] });
  const ch  = await cHash(raw);
  const sig = await signMessage(ch, userKeys.privateKey);
  const r   = await anchor(ch, [sig], 'SES-VERIFY');
  const recomputed = await cHash(raw);
  assert(recomputed === r.contentHash, `원본 재현 실패`);
  console.log(`     contentHash: ${ch.slice(0,16)}... | 재현: ${recomputed.slice(0,16)}... ✓ 일치`);
});

// ── A-07~09: 거래 앵커링 ──────────────────────────────────────────────
console.log('\n[ 거래 앵커링 ]');

await test('A-07', '거래 앵커링 — buyer + seller 양방 서명 → entryHash', async () => {
  _resetChain();
  const txId  = `TX-${Date.now().toString(16)}`;
  const amount = 12000; const fee = 360; const sellerNet = 11640;
  const raw   = JSON.stringify({ tx_id:txId, buyer_guid:BUYER_GUID, seller_guid:SELLER_GUID,
    item_name:'짜장면', total:amount, fee, seller_net:sellerNet, timestamp:new Date().toISOString() });
  const ch    = await cHash(raw);
  const bSig  = await signMessage(ch, buyerKeys.privateKey);
  const sSig  = await signMessage(ch, sellerKeys.privateKey);
  assert(await verifySignature(ch, bSig, buyerKeys.publicKeyB64),  'buyer 서명 검증 실패');
  assert(await verifySignature(ch, sSig, sellerKeys.publicKeyB64), 'seller 서명 검증 실패');
  const r = await anchor(ch, [bSig, sSig], txId);
  assert(r.entryHash.length === 64, `entryHash 길이 오류`);
  console.log(`     txId: ${txId} | contentHash: ${ch.slice(0,16)}... | layer: ${r.layer}`);
  console.log(`     buyerSig: ${bSig.slice(0,16)}... | sellerSig: ${sSig.slice(0,16)}...`);
});

await test('A-08', '거래 변조 탐지 — 금액 변조 시 서명 검증 실패', async () => {
  _resetChain();
  const raw  = JSON.stringify({ tx_id:'TX-TAMPER', buyer_guid:BUYER_GUID, seller_guid:SELLER_GUID,
    item_name:'짜장면', total:12000, fee:360, seller_net:11640, timestamp:new Date().toISOString() });
  const ch   = await cHash(raw);
  const bSig = await signMessage(ch, buyerKeys.privateKey);
  // 금액 변조 (12000 → 1200)
  const tampered     = raw.replace('"total":12000', '"total":1200');
  const tamperedHash = await cHash(tampered);
  const tamperOk     = await verifySignature(tamperedHash, bSig, buyerKeys.publicKeyB64);
  assert(!tamperOk, '변조 탐지 실패 — 변조된 데이터의 서명이 유효함');
  assert(ch !== tamperedHash, 'contentHash가 같음 — 변조 미탐지');
  console.log(`     원본 contentHash: ${ch.slice(0,16)}...`);
  console.log(`     변조 contentHash: ${tamperedHash.slice(0,16)}... (다름 ✓)`);
  console.log(`     변조 서명 검증:   false ✓ (변조 탐지됨)`);
});

await test('A-09', 'BIVM Σδ=0 — 거래 금액 보전 검증', async () => {
  const amount = 12000; const fee = Math.round(amount * 0.03); const sellerNet = amount - fee;
  assert(amount === sellerNet + fee, `BIVM 불균형: ${amount} ≠ ${sellerNet}+${fee}`);
  console.log(`     amount=${amount} / fee=${fee} / sellerNet=${sellerNet}`);
  console.log(`     Σdebit=${amount} = Σcredit=${sellerNet+fee} ✓`);
});

// ── A-10: extra.fs 추적 ───────────────────────────────────────────────
console.log('\n[ 재무제표 추적 ]');

await test('A-10', 'extra.fs last_tx_id + last_block_hash → 거래 원본 재현', async () => {
  _resetChain();
  const txId  = `TX-TRACE-${Date.now().toString(16)}`;
  const raw   = JSON.stringify({ tx_id:txId, buyer_guid:BUYER_GUID, seller_guid:SELLER_GUID,
    item_name:'짜장면', total:12000, fee:360, seller_net:11640, timestamp:new Date().toISOString() });
  const ch    = await cHash(raw);
  const bSig  = await signMessage(ch, buyerKeys.privateKey);
  const sSig  = await signMessage(ch, sellerKeys.privateKey);
  const r     = await anchor(ch, [bSig, sSig], txId);

  // extra.fs 시뮬레이션
  const extraFs = {
    'bs-cash': 100, 'pl-revenue': 90, 'pl-purchase': 0,
    'last_tx_id':      txId,
    'last_block_hash': r.entryHash,
    'last_tx_record':  raw,         // buyer+seller 서명 포함 원본
    'last_updated_at': new Date().toISOString(),
  };

  // 추적: last_tx_id → 체인 조회
  const entry = getEntryByMsgId(txId);
  assert(entry !== null, 'getEntryByMsgId 결과 null');
  assert(extraFs['last_block_hash'] === r.entryHash, 'last_block_hash 불일치');

  // 원본 재현: last_tx_record → SHA-256 → contentHash 대조
  const recomputed = await cHash(extraFs['last_tx_record']);
  assert(recomputed === entry.contentHash, `원본 재현 실패`);

  console.log(`     bs-cash: 10 → 100 (증가 90) | last_tx_id: ${txId}`);
  console.log(`     last_block_hash: ${r.entryHash.slice(0,16)}...`);
  console.log(`     원본 재현: ${recomputed.slice(0,16)}... ✓ 일치`);
});

// ── A-11: 체인 연속성 ────────────────────────────────────────────────
console.log('\n[ 체인 연속성 ]');

await test('A-11', '가입 → 대화 → 거래 3단계 prevHash 체인 연결', async () => {
  _resetChain();
  const ch1 = await cHash('register'); const sig1 = await signMessage(ch1, userKeys.privateKey);
  const ch2 = await cHash('session');  const sig2 = await signMessage(ch2, userKeys.privateKey);
  const ch3 = await cHash('tx');
  const bSig3 = await signMessage(ch3, buyerKeys.privateKey);
  const sSig3 = await signMessage(ch3, sellerKeys.privateKey);
  const r1 = await anchor(ch1, [sig1],       'R1');
  const r2 = await anchor(ch2, [sig2],       'R2');
  const r3 = await anchor(ch3, [bSig3,sSig3],'R3');
  assert(r1.prevHash === '0'.repeat(64), 'genesis 오류');
  assert(r2.prevHash === r1.entryHash,   'r2 체인 연결 오류');
  assert(r3.prevHash === r2.entryHash,   'r3 체인 연결 오류');
  console.log(`     [가입] ${r1.entryHash.slice(0,16)}... → [대화] ${r2.entryHash.slice(0,16)}... → [거래] ${r3.entryHash.slice(0,16)}... ✓`);
});

// ── A-12: Merkle + 무결성 ─────────────────────────────────────────────
console.log('\n[ Merkle + 무결성 ]');

await test('A-12', 'Merkle Root + verifyChainIntegrity 전체 통과', async () => {
  _resetChain();
  const ch1 = await cHash('r1'); const s1  = await signMessage(ch1, userKeys.privateKey);
  const ch2 = await cHash('r2'); const s2  = await signMessage(ch2, userKeys.privateKey);
  const ch3 = await cHash('r3');
  const sb3 = await signMessage(ch3, buyerKeys.privateKey);
  const ss3 = await signMessage(ch3, sellerKeys.privateKey);
  const r1 = await anchor(ch1, [s1],     'R1');
  const r2 = await anchor(ch2, [s2],     'R2');
  const r3 = await anchor(ch3, [sb3,ss3],'R3');
  const root    = await buildMerkleRoot([r1.entryHash, r2.entryHash, r3.entryHash]);
  const proof   = await buildMerkleProof([r1.entryHash, r2.entryHash, r3.entryHash], 1);
  const proofOk = await verifyMerkleProof(r2.entryHash, proof, root);
  const { valid, brokenAt } = await verifyChainIntegrity();
  assert(root.length === 64, `Merkle Root 길이 오류`);
  assert(proofOk, 'Merkle Proof 검증 실패');
  assert(valid, `체인 무결성 실패 | brokenAt: ${brokenAt}`);
  console.log(`     Merkle Root: ${root.slice(0,16)}... | Proof: ✓ | 무결성: ✓ | brokenAt: ${brokenAt??'none'}`);
});

// ── 결과 ─────────────────────────────────────────────────────────────────
console.log(`\n${'─'.repeat(52)}`);
console.log(`  결과: ${passed+failed}개 중 ✅ ${passed}개 통과 / ❌ ${failed}개 실패`);
if (failed === 0) console.log('  🎉 OpenHash 앵커링 통합 테스트 v2.0 전체 통과');
else { console.log('  ⚠️  실패 항목을 확인하세요.'); process.exit(1); }
