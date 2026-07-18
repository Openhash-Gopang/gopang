import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

describe('GET /biz/fee-rate — 단일 정본 수수료율 조회', () => {
  let handleFeeRate;
  before(async () => {
    ({ handleFeeRate } = await import('../worker.js?fee=' + Date.now()));
  });

  test('현재 플랫폼 수수료율(3%)을 반환한다', async () => {
    const res = await handleFeeRate(new Request('https://x/biz/fee-rate'), {}, {});
    const data = await res.json();
    assert.equal(res.status, 200);
    assert.equal(data.ok, true);
    assert.equal(data.rate, 0.03);
  });
});
