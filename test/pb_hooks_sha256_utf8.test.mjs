/**
 * test/pb_hooks_sha256_utf8.test.mjs
 *
 * 2026-07-18 신설. pb_hooks/main.pb.js에 5곳 복붙돼 있는 sha256hex()가
 * charCodeAt()이 256 이상(한글 등 비ASCII)이면 조용히 빈 문자열을
 * 반환하던 버그의 회귀 테스트.
 *
 * 실제 재현 경로: /api/tx 핸들러가 expectedTxHash = sha256hex(
 * _sigVerify.sortedStringify(tx))로 서버측 tx_hash를 재계산하는데, tx.items
 * 안에 한글 상품명(item.name, src/gopang/gwp/sign.js에서 실제로 쓰는 필드)이
 * 있으면 이 재계산이 항상 ''가 되어 클라이언트가 보낸 진짜 tx_hash와 절대
 * 일치하지 않는다 — 한글 상품명이 있는 모든 K-Market 구매가 TX_HASH_MISMATCH로
 * 거부될 뻔했다. GDC P2P 이체(handleGdcTransfer)의 item_name 기본값
 * "GDC 이체" 하나만으로도 재현된다.
 *
 * 이 테스트는 pb_hooks/main.pb.js에서 sha256hex 함수 본문을 그 자리에서
 * 직접 추출해 실행한다 — 별도로 유지·관리하는 사본이 아니라 실제 배포되는
 * 코드 그 자체를 검증하므로, 원본이 다시 바뀌어도 이 테스트가 자동으로
 * 최신 상태를 본다(추출 실패 시 즉시 실패해 드리프트를 알린다).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import vm from 'node:vm';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PB_HOOKS_PATH = join(__dirname, '..', 'pb_hooks', 'main.pb.js');

function nodeSha256Hex(str) {
  return createHash('sha256').update(str, 'utf8').digest('hex');
}

// pb_hooks/main.pb.js 안의 모든 `function sha256hex(str) { ... }` 정의를
// 순서대로 추출한다(중괄호 깊이를 직접 세어 함수 끝을 찾음 — 정규식만으로는
// 중첩 중괄호를 정확히 못 짚는다).
function extractAllSha256HexFns(source) {
  const fns = [];
  const marker = 'function sha256hex(str) {';
  let searchFrom = 0;
  while (true) {
    const start = source.indexOf(marker, searchFrom);
    if (start === -1) break;
    let depth = 0, i = start, bodyStart = -1;
    for (; i < source.length; i++) {
      if (source[i] === '{') {
        if (depth === 0) bodyStart = i;
        depth++;
      } else if (source[i] === '}') {
        depth--;
        if (depth === 0) { i++; break; }
      }
    }
    fns.push(source.slice(start, i));
    searchFrom = i;
  }
  return fns;
}

const source = readFileSync(PB_HOOKS_PATH, 'utf8');
const fnSources = extractAllSha256HexFns(source);

describe('pb_hooks/main.pb.js — sha256hex() UTF-8 인코딩 (2026-07-18 버그 수정 회귀)', () => {
  it('sha256hex 정의가 정확히 5곳 존재한다(복붙 카피 수 변경 감지)', () => {
    assert.equal(fnSources.length, 5, 'sha256hex 정의 개수가 5개가 아님 — 파일이 바뀌었으면 이 테스트도 같이 검토할 것');
  });

  const cases = [
    ['ASCII', 'hello world'],
    ['한글', 'GDC 이체'],
    ['실제 tx 형태(item_name 포함)', '{"item_name":"GDC 이체","amount":100}'],
    ['이모지(서로게이트쌍)', '🎉축하합니다🎊'],
    ['한중일 혼합', '你好こんにちは안녕하세요'],
    ['빈 문자열', ''],
  ];

  fnSources.forEach((fnSrc, idx) => {
    describe(`복사본 #${idx + 1}`, () => {
      const context = {};
      vm.createContext(context);
      vm.runInContext(`${fnSrc}\nthis.sha256hex = sha256hex;`, context);

      for (const [label, input] of cases) {
        it(`${label} — Node crypto(UTF-8 SHA-256)와 일치`, () => {
          const mine = context.sha256hex(input);
          const expected = nodeSha256Hex(input);
          assert.equal(mine, expected,
            `sha256hex(${JSON.stringify(input)}) = ${JSON.stringify(mine)}, 기대값 ${expected}` +
            (mine === '' ? ' — 빈 문자열 반환은 UTF-8 미지원 회귀 버그의 전형적 증상' : ''));
        });
      }
    });
  });
});
