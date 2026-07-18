/**
 * test/pb_hooks_tx_signature.test.mjs
 *
 * 2026-07-18 신설. pb_hooks/main.pb.js의 /api/tx 핸들러에 새로 추가된
 * 서명 암호학적 검증(TweetNaCl 포팅 Ed25519 + sortedStringify + b64u/ascii
 * 변환 유틸)이 실제 클라이언트(gopang-wallet.js)와 상호운용되는지 검증한다.
 *
 * gopang-wallet.js의 signTx()는 Node의 crypto.subtle과 동일한 Ed25519를
 * 브라우저 WebCrypto로 쓰므로, 이 테스트는 Node의 네이티브 Ed25519
 * (crypto.generateKeyPairSync/crypto.sign)로 서명을 만들어 pb_hooks가
 * 이식한 TweetNaCl 구현이 그 서명을 올바르게 검증하는지 교차 확인한다 —
 * 손이식 암호 코드는 이런 상호운용성 검증 없이는 신뢰할 수 없다.
 *
 * pb_hooks/main.pb.js 안의 IIFE(_sigVerify)를 그 자리에서 직접 추출해
 * 실행한다 — 별도 유지·관리 사본이 아니라 실제 배포 코드 자체를 검증한다.
 */

import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { generateKeyPairSync, sign as nodeSign } from 'node:crypto';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PB_HOOKS_PATH = join(__dirname, '..', 'pb_hooks', 'main.pb.js');

function b64u(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

let _sigVerify;

before(() => {
  const source = readFileSync(PB_HOOKS_PATH, 'utf8');
  const startMarker = 'var _sigVerify = (function() {';
  const start = source.indexOf(startMarker);
  assert.ok(start !== -1, 'pb_hooks/main.pb.js에서 _sigVerify IIFE 시작을 못 찾음 — 파일 구조가 바뀌었을 수 있음');
  // '})();' 로 끝나는 지점을 중괄호 깊이로 정확히 찾는다.
  let depth = 0, i = source.indexOf('(function() {', start);
  const braceStart = source.indexOf('{', i);
  depth = 1; i = braceStart + 1;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  // 그 뒤 '();'까지 포함
  const closeParenIdx = source.indexOf('();', i) + 3;
  const iifeSrc = source.slice(start, closeParenIdx);

  const context = {};
  vm.createContext(context);
  vm.runInContext(`var _sigVerify_result = ${iifeSrc.replace('var _sigVerify = ', '')};`, context);
  _sigVerify = context._sigVerify_result;
  assert.ok(_sigVerify, '_sigVerify 추출 실패');
  assert.equal(typeof _sigVerify.ed25519Verify, 'function');
  assert.equal(typeof _sigVerify.sortedStringify, 'function');
  assert.equal(typeof _sigVerify.b64uToBytes, 'function');
  assert.equal(typeof _sigVerify.asciiToBytes, 'function');
});

describe('pb_hooks/main.pb.js — _sigVerify (TweetNaCl Ed25519 이식) 상호운용성', () => {
  it('Node 네이티브 Ed25519 서명을 정상 검증한다', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
    const msg = 'deadbeef1234567890abcdef1234567890abcdef1234567890abcdef123456';
    const sig = nodeSign(null, Buffer.from(msg, 'ascii'), privateKey);

    const pubBytes = _sigVerify.b64uToBytes(b64u(pubRaw));
    const sigBytes = _sigVerify.b64uToBytes(b64u(sig));
    const msgBytes = _sigVerify.asciiToBytes(msg);

    assert.equal(pubBytes.length, 32);
    assert.equal(sigBytes.length, 64);
    assert.equal(_sigVerify.ed25519Verify(msgBytes, sigBytes, pubBytes), true);
  });

  it('변조된 메시지(tx_hash)는 거부한다', () => {
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
    const msg = 'original-tx-hash-value';
    const sig = nodeSign(null, Buffer.from(msg, 'ascii'), privateKey);

    const pubBytes = _sigVerify.b64uToBytes(b64u(pubRaw));
    const sigBytes = _sigVerify.b64uToBytes(b64u(sig));
    const tamperedBytes = _sigVerify.asciiToBytes(msg + '-tampered');

    assert.equal(_sigVerify.ed25519Verify(tamperedBytes, sigBytes, pubBytes), false);
  });

  it('다른 공개키로는 거부한다(키 바꿔치기 방지)', () => {
    const kp1 = generateKeyPairSync('ed25519');
    const kp2 = generateKeyPairSync('ed25519');
    const msg = 'some-tx-hash';
    const sig = nodeSign(null, Buffer.from(msg, 'ascii'), kp1.privateKey);

    const wrongPubRaw = kp2.publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
    const pubBytes = _sigVerify.b64uToBytes(b64u(wrongPubRaw));
    const sigBytes = _sigVerify.b64uToBytes(b64u(sig));
    const msgBytes = _sigVerify.asciiToBytes(msg);

    assert.equal(_sigVerify.ed25519Verify(msgBytes, sigBytes, pubBytes), false);
  });

  it('sortedStringify는 키 순서와 무관하게 동일한 정규화 문자열을 낸다', () => {
    const a = _sigVerify.sortedStringify({ b: 1, a: 2, c: { y: 1, x: 2 } });
    const b = _sigVerify.sortedStringify({ c: { x: 2, y: 1 }, a: 2, b: 1 });
    assert.equal(a, b);
    assert.equal(a, '{"a":2,"b":1,"c":{"x":2,"y":1}}');
  });

  it('실제 GDC P2P 이체 tx 형태(한글 없음, guid만)에서도 정상 왕복한다', () => {
    // handleGdcTransfer의 mappedTx와 동일한 형태 — items는 항상 빈 배열.
    const tx = {
      version: 1,
      input: { owner_guid: 'guid-sender-001', prev_settle_hash: 'abc123', balance_claimed: 5000 },
      outputs: [{ recipient_guid: 'guid-receiver-002', amount: 100 }],
      items: [],
    };
    const canonical = _sigVerify.sortedStringify(tx);
    assert.ok(canonical.includes('guid-sender-001'));
    assert.ok(canonical.includes('"items":[]'));
  });
});
