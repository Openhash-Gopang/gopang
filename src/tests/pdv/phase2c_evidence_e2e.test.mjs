// phase2c_evidence_e2e.test.mjs
// 실행: node --experimental-test-module-mocks --test src/tests/pdv/phase2c_evidence_e2e.test.mjs
//
// phase2c_evidence.test.js(E-01~E-07)는 generateEvidencePackage()의 부품들
// (anchor/verifySignature 등)만 조각조각 검증하고, 실제 generateEvidencePackage()
// 함수 자체는 한 번도 호출하지 않았다(vault.js가 브라우저 IndexedDB에
// 의존해 Node에서 직접 실행이 어려웠기 때문으로 보임). 그 결과
// generateEvidencePackage()가 anchor()의 옛 API(content, sig, msgId)를 그대로
// 호출하는 실제 프로덕션 버그(§2026-07-17 발견·수정)가 이 테스트들로는
// 전혀 잡히지 않았다 — "부품은 맞는데 조립은 틀림"의 전형적 사례.
// 이 파일은 vault.js를 mock.module로 대체해 generateEvidencePackage()를
// 실제로 끝까지 실행·검증한다(재구현이 아니라 실제 함수 호출).

import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

const fakeStore = new Map();

mock.module(new URL('../../pdv/vault.js', import.meta.url), {
  namedExports: {
    getMessage: async (msgId) => fakeStore.get(msgId) ?? null,
    updateOpenHashRef: async (msgId, ref) => {
      const rec = fakeStore.get(msgId);
      if (rec) rec.openHashRef = ref;
    },
  },
});

const { generateKeyPair, signMessage } = await import('../../pdv/keyManager.js');
const { generateEvidencePackage, verifyEvidencePackage, generateCourtSummary } =
  await import('../../pdv/evidencePackage.js');
const { _resetChain } = await import('../../openhash/hashChain.js');

test('E-08: generateEvidencePackage() 실제 종단 실행 — 미앵커링 메시지(anchor() 새 API 경로)', async () => {
  _resetChain();
  const { privateKey, publicKeyB64 } = await generateKeyPair();
  const content = '스토킹 협박 메시지 증거(E2E)';
  const signature = await signMessage(content, privateKey);

  fakeStore.set('e08-msg', {
    msgId: 'e08-msg', content, senderId: 'victim1', senderPubKeyB64: publicKeyB64,
    signature, timestamp: new Date().toISOString(), riskLevel: 'S3',
    legalFlags: ['CR-1'], aiWarningLog: [],
  });

  // BUG-FIX(2026-07-17) 회귀 방지 핵심 지점 — 이 호출이 예전에는
  // "[HashChain] contentHash는 SHA-256 hex(64자)여야 합니다." 로 매번
  // 실패했다(record.content를 해시 없이 그대로 anchor()에 넘겼기 때문).
  const pkg = await generateEvidencePackage('e08-msg');

  assert.ok(pkg.openHashProof?.msgHash, 'openHashProof.msgHash 없음(undefined) — chainEntry 필드명 드리프트 회귀');
  assert.equal(pkg.openHashProof.msgHash.length, 64);
  assert.equal(pkg.openHashProof.entryHash.length, 64);

  const result = await verifyEvidencePackage(pkg);
  assert.equal(result.signatureValid, true);
  assert.equal(result.openHashValid, true, `OpenHash 검증 실패: ${result.errors.join(', ')}`);
  assert.equal(result.contentIntact, true);
  assert.equal(result.overall, true);
  assert.deepEqual(result.errors, []);

  const summary = generateCourtSummary(pkg);
  assert.equal(summary.entryHash, pkg.openHashProof.entryHash);
});

test('E-09: generateEvidencePackage() 실제 종단 실행 — 이미 앵커링된 메시지(chainEntry 존재 경로)', async () => {
  _resetChain();
  const { generateKeyPair: gkp, signMessage: sm } = await import('../../pdv/keyManager.js');
  const { anchor, getEntryByMsgId } = await import('../../openhash/hashChain.js');
  const { sha256 } = await import('../../pdv/keyManager.js');

  const { privateKey, publicKeyB64 } = await gkp();
  const content = '이미 앵커링된 메시지(E2E)';
  const signature = await sm(content, privateKey);
  const contentHash = await sha256(content);

  // 먼저 앵커링해서 chainEntry가 이미 존재하는 상태를 만든다
  await anchor(contentHash, [signature], 'e09-msg');
  assert.ok(getEntryByMsgId('e09-msg'), '픽스처 전제 붕괴: 사전 앵커링이 안 됨');

  fakeStore.set('e09-msg', {
    msgId: 'e09-msg', content, senderId: 'victim2', senderPubKeyB64: publicKeyB64,
    signature, timestamp: new Date().toISOString(), riskLevel: 'S2',
    legalFlags: [], aiWarningLog: [],
  });

  const pkg = await generateEvidencePackage('e09-msg');
  // BUG-FIX 회귀 지점 — chainEntry.msgHash(존재하지 않던 필드) 대신
  // chainEntry.contentHash를 읽어야 이 값이 undefined가 아니다.
  assert.ok(pkg.openHashProof?.msgHash, 'chainEntry 경로에서도 msgHash가 undefined — 필드명 드리프트 회귀');
  assert.equal(pkg.openHashProof.msgHash, contentHash);

  const result = await verifyEvidencePackage(pkg);
  assert.equal(result.overall, true, `검증 실패: ${result.errors.join(', ')}`);
});
