// conversational-style-guard.test.mjs
// 실행: node --experimental-test-module-mocks --test src/tests/conversational-style-guard.test.mjs
//
// [대화 스타일 — 절대 원칙](SP-22 K-Execute·SP-21 K-Deliver, 2026-08-06 신설)이
// 요구하는 "문서형 응답 금지"를 코드 층에서 감지하는 순수 함수
// _violatesConversationalStyle()을 단위 검증한다. 실제 재작성 요청
// (_enforceConversationalStyle, history/sendFn 재호출을 동반)은 여기서
// 검증하지 못한다 — CFG.system 상태와 실제 LLM 재호출까지 필요해
// 라이브 환경에서 별도 확인이 필요하다(sp-tag-dispatch.test.mjs와
// 동일한 한계).
//
// ★ 2026-08-06 재작성 — 이 파일은 최초 커밋(83cfe965) 이후 call-ai.js가
// #233(EXPERT 세션 죽은 코드 제거)와 충돌해 재구성되는 과정에서 실수로
// 누락됐다(코드 함수 자체는 살아있었지만 테스트 파일만 유실). "작성한
// 파일이 전부 저장소에 반영됐는지 확인하라"는 지시로 재검사하다가 발견,
// 원본과 동일한 내용으로 복원한다.

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

mock.module(new URL('../gopang/gwp/engine.js', import.meta.url), {
  namedExports: {
    _gwpLaunch: () => {},
  },
});

const { _violatesConversationalStyle } = await import(
  new URL('../gopang/ai/call-ai.js', import.meta.url)
);

describe('[대화 스타일] 문서형 응답 감지 (_violatesConversationalStyle)', () => {
  test('정상 — 단일 동작 지시(전입신고 좋은 예)는 위반 아님', () => {
    const reply = '정부24 사이트에 로그인해 주세요. 처음이시면 회원가입부터 하셔야 해요.';
    assert.equal(_violatesConversationalStyle(reply), false);
  });

  test('정상 — 짧은 완료 확인 멘트는 위반 아님', () => {
    const reply = '증인 두 분의 서명을 받아주세요. 완료되면 알려주세요.';
    assert.equal(_violatesConversationalStyle(reply), false);
  });

  test('위반 — 마크다운 제목(###)이 있으면 위반', () => {
    const reply = '### 필요 서류\n임대차계약서와 신분증을 준비해 주세요.';
    assert.equal(_violatesConversationalStyle(reply), true);
  });

  test('위반 — 번호 매김 목록 3개 이상이면 위반', () => {
    const reply = '1. 정부24 접속\n2. 로그인\n3. 검색창에 전입신고 입력';
    assert.equal(_violatesConversationalStyle(reply), true);
  });

  test('위반 — 불릿 목록 3개 이상이면 위반', () => {
    const reply = '- 임대차계약서\n- 신분증\n- 도장';
    assert.equal(_violatesConversationalStyle(reply), true);
  });

  test('위반 — 과도하게 긴 응답(300자 초과)은 위반', () => {
    const reply = '가'.repeat(301);
    assert.equal(_violatesConversationalStyle(reply), true);
  });

  test('정상 — 짧은 2항목 불릿은 오탐 없음(3개 미만은 대상 아님)', () => {
    const reply = '- 임대차계약서\n- 신분증';
    assert.equal(_violatesConversationalStyle(reply), false);
  });

  test('정상 — 문장 중 숫자 하나(목록 아님)는 오탐 없음', () => {
    const reply = '처리기간은 3일 정도 걸려요. 완료되면 문자로 알려드릴게요.';
    assert.equal(_violatesConversationalStyle(reply), false);
  });

  test('빈 응답/비문자열 — 방어적으로 false', () => {
    assert.equal(_violatesConversationalStyle(''), false);
    assert.equal(_violatesConversationalStyle(null), false);
    assert.equal(_violatesConversationalStyle(undefined), false);
  });
});
