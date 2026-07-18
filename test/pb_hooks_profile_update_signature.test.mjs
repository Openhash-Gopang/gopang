/**
 * test/pb_hooks_profile_update_signature.test.mjs
 *
 * 2026-07-19 신설. pb_hooks/main.pb.js에 새로 추가된
 * onRecordBeforeUpdateRequest("profiles") 훅(프로필 수정 시 Ed25519 서명 +
 * TOFU pubkey 고정 검증)을 검증한다.
 *
 * 배경: profiles 컬렉션의 PocketBase updateRule("guid = @request.data.guid")
 * 이 사실상 무의미하고(guid는 공개 정보), onRecordBeforeUpdateRequest 훅
 * 자체가 아예 없어서 L1 REST API(state.js에 하드코딩된 L1_URL)를 직접
 * PATCH하면 worker.js handleProfilePost()의 서명 검증을 완전히 우회할 수
 * 있었다(2026-07-19 실사로 발견). 이 훅이 그 공백을 메운다.
 *
 * pb_hooks/main.pb.js 안의 실제 코드(_sigVerify IIFE + 신규 훅)를 그
 * 자리에서 직접 추출해 실행한다 — 별도 유지·관리 사본이 아니라 실제
 * 배포 코드 자체를 검증한다(pb_hooks_tx_signature.test.mjs와 동일 방식).
 * PocketBase 전용 전역($apis, $app, onRecordBeforeUpdateRequest,
 * BadRequestError)은 최소 스텁으로 대체한다.
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

function extractBraceBlock(source, startIdx) {
  // startIdx는 여는 '{' 위치. 중괄호 깊이로 대응하는 '}' 위치를 찾는다.
  let depth = 1, i = startIdx + 1;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') depth--;
  }
  return i; // 닫는 '}' 다음 인덱스
}

let capturedHandler = null;
let capturedCollection = null;

class FakeBadRequestError extends Error {
  constructor(msg) { super(msg); this.name = 'BadRequestError'; }
}

function makeFakeRecord(fields) {
  return { getString: (k) => (fields[k] ?? ''), getId: () => fields.id || 'rec1' };
}

before(() => {
  const source = readFileSync(PB_HOOKS_PATH, 'utf8');

  // 1) _sigVerify IIFE 추출 (pb_hooks_tx_signature.test.mjs와 동일 로직)
  const sigStartMarker = 'var _sigVerify = (function() {';
  const sigStart = source.indexOf(sigStartMarker);
  assert.ok(sigStart !== -1, '_sigVerify IIFE 시작을 못 찾음');
  const sigBraceStart = source.indexOf('{', source.indexOf('(function() {', sigStart));
  const sigBraceEnd = extractBraceBlock(source, sigBraceStart);
  const sigCloseParenIdx = source.indexOf('();', sigBraceEnd) + 3;
  const iifeSrc = source.slice(sigStart, sigCloseParenIdx);

  // 2) 신규 onRecordBeforeUpdateRequest("profiles") 훅 추출
  const hookStartMarker = 'onRecordBeforeUpdateRequest((e) => {';
  const hookStart = source.indexOf(hookStartMarker);
  assert.ok(hookStart !== -1, '신규 profiles 수정 훅을 못 찾음 — 파일 구조가 바뀌었을 수 있음');
  const hookBraceStart = source.indexOf('{', source.indexOf('(e) => {', hookStart));
  const hookBraceEnd = extractBraceBlock(source, hookBraceStart);
  // extractBraceBlock은 마지막 '}' 바로 다음 위치(= ', "profiles");'의 콤마
  // 위치)를 반환한다 — 그 뒤는 ', "profiles");'만 이어붙이면 된다.
  const tailMarker = ', "profiles");';
  assert.equal(source.slice(hookBraceEnd, hookBraceEnd + tailMarker.length), tailMarker,
    '훅 종료부 형식이 예상과 다름 — 파일 구조가 바뀌었을 수 있음');
  const hookCloseIdx = hookBraceEnd + tailMarker.length;
  const hookSrc = source.slice(hookStart, hookCloseIdx);

  const context = {
    BadRequestError: FakeBadRequestError,
    onRecordBeforeUpdateRequest: (fn, collName) => { capturedHandler = fn; capturedCollection = collName; },
    $apis: null, // 아래에서 테스트별로 주입
    $app: null,
  };
  vm.createContext(context);
  vm.runInContext(`${iifeSrc}\n${hookSrc}`, context);

  assert.ok(capturedHandler, '훅 핸들러 캡처 실패');
  assert.equal(capturedCollection, 'profiles');

  // 이후 개별 테스트에서 $apis/$app을 주입할 수 있도록 컨텍스트 보관
  before._context = context;
});

function runHook({ collectionName = 'profiles', reqData, original }) {
  const ctx = before._context;
  ctx.$apis = { requestInfo: () => ({ data: reqData }) };
  ctx.$app = { dao: () => ({ findRecordById: () => makeFakeRecord(original) }) };
  const e = {
    collection: { name: collectionName },
    record: makeFakeRecord(original),
    httpContext: {},
  };
  return capturedHandler(e);
}

describe('pb_hooks/main.pb.js — profiles 수정 서명 검증 훅', () => {
  let publicKey, privateKey, pubB64u;

  before(() => {
    ({ publicKey, privateKey } = generateKeyPairSync('ed25519'));
    const pubRaw = publicKey.export({ type: 'spki', format: 'der' }).slice(-32);
    pubB64u = b64u(pubRaw);
  });

  function sign(msg) {
    return b64u(nodeSign(null, Buffer.from(msg, 'ascii'), privateKey));
  }

  it('다른 컬렉션이면 즉시 통과(no-op)한다', () => {
    assert.doesNotThrow(() => runHook({
      collectionName: 'ins_claims',
      reqData: {},
      original: { guid: 'g1' },
    }));
  });

  it('guid/pubkey/signature 중 하나라도 없으면 거부한다', () => {
    assert.throws(() => runHook({
      reqData: { guid: 'g1', pubkey: pubB64u }, // signature 누락
      original: { guid: 'g1', pubkey_ed25519: pubB64u },
    }), /guid, pubkey, signature/);
  });

  it('정상 서명 + 최초 등록 pubkey와 일치 시 통과한다', () => {
    const ts = String(Date.now());
    const sigMsg = `g1:${pubB64u}:${ts}`;
    assert.doesNotThrow(() => runHook({
      reqData: { guid: 'g1', pubkey: pubB64u, signature: sign(sigMsg), ts },
      original: { guid: 'g1', pubkey_ed25519: pubB64u },
    }));
  });

  it('등록된 pubkey와 다른 키로 서명하면 PUBKEY_MISMATCH로 거부한다', () => {
    const other = generateKeyPairSync('ed25519');
    const otherPubB64u = b64u(other.publicKey.export({ type: 'spki', format: 'der' }).slice(-32));
    const ts = String(Date.now());
    const sigMsg = `g1:${otherPubB64u}:${ts}`;
    const sig = b64u(nodeSign(null, Buffer.from(sigMsg, 'ascii'), other.privateKey));

    assert.throws(() => runHook({
      reqData: { guid: 'g1', pubkey: otherPubB64u, signature: sig, ts },
      original: { guid: 'g1', pubkey_ed25519: pubB64u }, // 원래 등록된 키는 다름
    }), /PUBKEY_MISMATCH/);
  });

  it('서명은 유효하지만 다른 메시지에 대한 것이면(변조) 거부한다', () => {
    const ts = String(Date.now());
    const wrongMsg = `g1:${pubB64u}:9999999999999`; // ts 다름 — 서명 대상 불일치
    assert.throws(() => runHook({
      reqData: { guid: 'g1', pubkey: pubB64u, signature: sign(wrongMsg), ts },
      original: { guid: 'g1', pubkey_ed25519: pubB64u },
    }), /INVALID_SIGNATURE/);
  });

  it('요청 바디 guid가 대상 레코드 guid와 다르면 거부한다', () => {
    const ts = String(Date.now());
    const sigMsg = `g-attacker:${pubB64u}:${ts}`;
    assert.throws(() => runHook({
      reqData: { guid: 'g-attacker', pubkey: pubB64u, signature: sign(sigMsg), ts },
      original: { guid: 'g-victim', pubkey_ed25519: pubB64u },
    }), /guid가 대상 레코드와 일치하지 않습니다/);
  });

  it('등록된 pubkey_ed25519가 비어있으면(엣지케이스) TOFU 비교 없이 서명만 검증한다', () => {
    const ts = String(Date.now());
    const sigMsg = `g1:${pubB64u}:${ts}`;
    assert.doesNotThrow(() => runHook({
      reqData: { guid: 'g1', pubkey: pubB64u, signature: sign(sigMsg), ts },
      original: { guid: 'g1', pubkey_ed25519: '' },
    }));
  });
});
