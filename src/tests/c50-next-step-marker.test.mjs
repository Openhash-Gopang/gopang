// c50-next-step-marker.test.mjs
// 실행: node --experimental-test-module-mocks --test src/tests/c50-next-step-marker.test.mjs
//
// SP_common_guardrails C50(관제탑 원칙, 2026-08-06 신설)이 요구하는
// [NEXT_STEP: ...] 태그 감지 로직(expert-session.js의
// _missingNextStepMarker())을 단위 검증한다.
//
// [한계] 이 테스트는 순수 함수(정규식 판정) 하나만 검증한다.
// call-ai.js의 _enforceNextStepMarker()(감지 결과를 실제로 재시도
// 카운터·sendFn 재호출로 이어붙이는 부분)와, 그게 실제 브라우저
// 스트리밍 UI에서 어떻게 동작하는지는 라이브 환경에서 별도 확인이
// 필요하다 — 여기서 검증하지 못한다(2026-08-06 신설 당시 커밋 메시지
// 참고).

import { test, describe, mock } from 'node:test';
import assert from 'node:assert/strict';

// ── 최소 DOM/전역 스텁 — sp-tag-dispatch.test.mjs와 동일 ──
globalThis.window = globalThis;
globalThis.location = { search: '' };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.document = {
  addEventListener: () => {}, getElementById: () => null,
  createElement: () => ({}), querySelector: () => null,
};
globalThis.addEventListener = () => {};
globalThis.removeEventListener = () => {};
globalThis.fetch = async () => { throw new Error('테스트 환경: 네트워크 차단'); };

let _launched = null;
mock.module(new URL('../gopang/gwp/engine.js', import.meta.url), {
  namedExports: {
    _gwpLaunch: (svc) => { _launched = svc; },
  },
});

const { _missingNextStepMarker } = await import(
  new URL('../gopang/ai/expert-session.js', import.meta.url)
);

describe('C50 — [NEXT_STEP:] 태그 감지 (_missingNextStepMarker)', () => {
  test('태그가 있으면 충족(false = 안 빠짐)', () => {
    const reply =
      '경정청구액은 대략 42만원입니다.\n\n' +
      '[위험 고지] 인간 세무사 확인 없이 이대로 신고하면...\n\n' +
      '[NEXT_STEP: 2024년 원천징수영수증 금액을 알려주시면 정확히 계산해드릴게요]';
    assert.equal(_missingNextStepMarker(reply), false);
  });

  test('태그가 없고 결론(위험고지)도 있으면 — 빠짐(true)', () => {
    const reply =
      '일반적으로 경정청구는 세액을 다시 계산해 제출하는 절차입니다.\n\n' +
      '[위험 고지] 인간 세무사 확인 없이 진행하면 위험할 수 있습니다.';
    assert.equal(_missingNextStepMarker(reply), true);
  });

  test('태그가 없고 인간전문가연결만 있어도 — 빠짐(true)', () => {
    const reply = '관련 세무사사무소를 찾아드릴까요? -> [CONNECT_HUMAN_EXPERT: 세무사사무소]';
    assert.equal(_missingNextStepMarker(reply), true);
  });

  test('정당한 되묻기(결론 이전)만 있으면 — 예외, 안 빠짐(false)', () => {
    const reply = '언제부터 그 증상이 있으셨는지 말씀해 주시겠어요?';
    assert.equal(_missingNextStepMarker(reply), false);
  });

  test('되묻기처럼 보이지만 위험고지도 같이 나오면 — 결론으로 간주, 빠짐(true)', () => {
    // 물음표로 끝나지만 이미 STEP D까지 나온 응답 — 예외 대상이 아니어야 함
    const reply =
      '[위험 고지] 확인 없이 진행하면 위험합니다. 계속 진행할까요?';
    assert.equal(_missingNextStepMarker(reply), true);
  });

  test('빈 응답/비문자열 — 방어적으로 false(보정 시도 안 함)', () => {
    assert.equal(_missingNextStepMarker(''), false);
    assert.equal(_missingNextStepMarker(null), false);
    assert.equal(_missingNextStepMarker(undefined), false);
  });

  test('일반 설명형 응답(백과사전식, 결론도 되묻기도 아님) — 빠짐(true)', () => {
    const reply =
      '경정청구란 이미 신고한 세액이 정당한 세액보다 많은 경우, ' +
      '법정신고기한이 지난 후 5년 이내에 감액을 청구하는 제도입니다.';
    assert.equal(_missingNextStepMarker(reply), true);
  });
});
