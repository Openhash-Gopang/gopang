// send_message_risk_command.test.mjs — 2026-07-18 신설
//
// 검증 대상: src/gopang/ui/send-message.js
//   (1) showRiskAnalysis() 로컬 명령 라우팅 신설(HANDOFF_2026-07-18 §2-(1) 후속 과제) —
//       이전에는 함수 정의만 있고 어디서도 호출되지 않는 고아 함수였다.
//   (2) _lastPipelineResult 공유 상태 버그 수정 — core/state.js가 이미
//       _lastPipelineResult/setLastPipelineResult를 export하고 있었는데,
//       이 파일이 동일한 이름의 로컬 변수로 shadow하고 있어서 다른 모듈이
//       state.js를 통해 마지막 분석 결과를 볼 방법이 없었다.
//
// 방식: 격리통합(Isolated Integration) — 브라우저 전역(window/document/
// navigator/location 등)을 최소 스텁으로 구성해 실제 프로덕션 모듈을
// Node에서 그대로 import해 실행한다(마스터 테스트플랜 §2.1 환경 구분,
// pdv-history-client.js에 적용했던 것과 동일 방식).

import { test, describe, before, mock } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEND_MESSAGE_PATH = path.resolve(__dirname, '../../../src/gopang/ui/send-message.js');
const STATE_PATH        = path.resolve(__dirname, '../../../src/gopang/core/state.js');

// ── 브라우저 전역 최소 스텁 ────────────────────────────────
// message-list에 appendBubble이 실제로 추가하는 row/bubble을 추적할 수
// 있도록 fake DOM을 만든다.
function makeFakeEl(overrides = {}) {
  return {
    style: {},
    className: '',
    classList: { add(){}, remove(){} },
    children: [],
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {},
    get textContent() { return this._text ?? ''; },
    set textContent(v) { this._text = v; },
    get innerHTML() { return this._html ?? ''; },
    set innerHTML(v) { this._html = v; },
    ...overrides,
  };
}

let msgInput, sendBtn, messageList;

function resetDom() {
  msgInput = makeFakeEl({ value: '', blur(){}, focus(){} });
  sendBtn  = makeFakeEl({ disabled: false });
  messageList = makeFakeEl({ scrollTop: 0, scrollHeight: 0 });

  global.document = {
    getElementById(id) {
      if (id === 'msg-input') return msgInput;
      if (id === 'send-btn') return sendBtn;
      if (id === 'message-list') return messageList;
      return null;
    },
    addEventListener() {},
    createElement() { return makeFakeEl(); },
    querySelectorAll() { return []; },
  };
}

before(() => {
  global.window = globalThis;
  resetDom();
  global.addEventListener = () => {};
  global.removeEventListener = () => {};
  global.dispatchEvent = () => {};
  Object.defineProperty(global, 'navigator', {
    value: { geolocation: { getCurrentPosition(){} }, serviceWorker: undefined },
    configurable: true,
  });
  Object.defineProperty(global, 'location', {
    value: { hostname: 'localhost', origin: 'http://localhost', href: 'http://localhost/' },
    configurable: true,
  });
  global.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
  global.fetch = async () => ({ ok: true, json: async () => ({}) });
  global.CustomEvent = class CustomEvent {};
  global.WebSocket = class WebSocket {};
  // sendMessage()가 참조하지만 이 파일에 정의/import돼 있지 않은 전역 함수들
  // (실제 프로덕션에서는 다른 스크립트가 window에 붙여둠 — 여기선 no-op으로 스텁)
  global._initLocation = () => {};
  global.removeAttach  = () => {};
});

describe('send-message.js — 위험 분석 로컬 명령 라우팅', () => {
  test('_isRiskAnalysisCommand: 트리거 문구 매칭', async () => {
    const mod = await import(SEND_MESSAGE_PATH);
    assert.equal(typeof mod._isRiskAnalysisCommand, 'function',
      '_isRiskAnalysisCommand가 테스트를 위해 export돼 있어야 함');
    const positives = ['분석 결과 보여줘', '분석결과 보여줘', '위험 분석 보여줘',
      '위험분석 보여줘', '위험도 확인', '방금 분석 결과 어때?'];
    const negatives = ['안녕하세요', '짜장면 하나 주문할게요', '분석해줘', '결과 보여줘'];
    for (const t of positives) {
      assert.equal(mod._isRiskAnalysisCommand(t), true, `"${t}"는 매칭돼야 함`);
    }
    for (const t of negatives) {
      assert.equal(mod._isRiskAnalysisCommand(t), false, `"${t}"는 매칭되면 안 됨`);
    }
  });

  test('결과 없을 때 로컬 명령 전송 시 안내 문구만 표시(AI/P2P 미호출)', async () => {
    resetDom();
    const mod = await import(SEND_MESSAGE_PATH + '?t=1'); // 캐시 우회 불필요(모듈 싱글턴 재사용) — 상태 초기화는 아래 setLastPipelineResult(null)로 처리
    const state = await import(STATE_PATH);
    state.setLastPipelineResult(null);

    msgInput.value = '분석 결과 보여줘';
    await mod.sendMessage();

    assert.equal(messageList.children.length >= 1, true, '버블이 최소 1개 추가돼야 함');
    const lastRow = messageList.children[messageList.children.length - 1];
    const bubble  = lastRow.children[lastRow.children.length - 1];
    assert.equal(bubble.textContent, '분석된 메시지가 없습니다.');
  });

  test('공유 상태(state.js)에 결과가 있으면 showRiskAnalysis가 그 값을 반영', async () => {
    resetDom();
    const mod   = await import(SEND_MESSAGE_PATH);
    const state = await import(STATE_PATH);

    state.setLastPipelineResult({
      riskResult: { level: 'S1', legalFlags: ['스토킹'] },
    });

    msgInput.value = '위험도 확인';
    await mod.sendMessage();

    const lastRow = messageList.children[messageList.children.length - 1];
    const bubble  = lastRow.children[lastRow.children.length - 1];
    assert.match(bubble.innerHTML, /주의/, 'S1 레벨 chip(⚠️ 주의)이 렌더링돼야 함');
    assert.match(bubble.innerHTML, /스토킹/, 'legalFlags가 함께 표시돼야 함');

    state.setLastPipelineResult(null); // 다음 테스트 오염 방지
  });

  test('일반 대화문(트리거 아님)은 로컬 명령으로 처리되지 않음', async () => {
    const mod = await import(SEND_MESSAGE_PATH);
    assert.equal(mod._isRiskAnalysisCommand('오늘 날씨 어때?'), false);
    assert.equal(mod._isRiskAnalysisCommand('분석'), false);
  });
});
