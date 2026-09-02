// kplan-kwatch-kjob-dispatch.test.mjs
// 실행: node --experimental-test-module-mocks --test src/tests/kplan-kwatch-kjob-dispatch.test.mjs
//
// 2026-09-02 신설 — K-Plan/K-Watch/K-Job을 AC 오케스트레이션(type:'switch')에
// 편입하면서(gwp-registry.js + call-ai.js SWITCH_SP_LOADERS), K-Bank/K-Telecom/
// K-Estate가 쓰던 동일 메커니즘(_handleOrchestrationTags의 [CALL_*: query=...]
// 태그 매칭 → SWITCH_SP_LOADERS 조회 → _forwardSwitchSP)이 지금까지 이 저장소
// 어디에도 직접 테스트되지 않고 있었다는 걸 사고실험 중 발견했다(src/tests/
// sp-tag-dispatch.test.mjs는 [GWP:] 레거시 태그 경로와 switch형의 자동복구
// 가드만 다루고, 정상 [CALL_*:] 경로 자체는 다루지 않음). 이 파일이 그
// 공백을 K-Plan/K-Watch/K-Job 세 서비스에 한해 메운다.
//
// [한계] LLM이 실제로 [CALL_KPLAN:]/[CALL_KWATCH:]/[CALL_KJOB:] 태그를
// "내는지"(자연어 이해 품질)는 이 하네스 범위 밖이다 — sp-tag-dispatch.test.mjs
// 와 동일한 한계.

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

// ── manifest-loader._loadSpByKey를 목으로 교체 — 실제 sp-catalog.json
//    fetch 없이 "어느 manifestKey로 호출됐는지"와 반환 텍스트를 통제한다.
//    _loadKPlanSP/_loadKWatchSP/_loadKJobSP(call-ai.js)가 내부에서
//    이 함수를 호출하므로, 이 목 하나로 세 로더를 전부 검증할 수 있다. ──
const _spLoadCalls = [];
mock.module(new URL('../gopang/ai/manifest-loader.js', import.meta.url), {
  namedExports: {
    _loadSpByKey: async (manifestKey, label) => {
      _spLoadCalls.push(manifestKey);
      return `[MOCK SP TEXT for ${manifestKey}]`;
    },
    _loadSpRawByKey: async (manifestKey) => `[MOCK RAW SP TEXT for ${manifestKey}]`,
  },
});

// ── ui/bubble.js appendBubble를 목으로 교체 — _announceStageTransition이
//    실제로 어떤 한글 라벨을 사용자에게 보여주는지(_friendlyStageLabel,
//    비export 함수라 이 부수효과로만 관찰 가능) 검증한다. bubble.js의
//    다른 export(showTyping 등)도 call-ai.js가 top-level import하므로
//    함께 스텁해야 모듈 로드가 깨지지 않는다. ──
const _bubbleCalls = [];
mock.module(new URL('../gopang/ui/bubble.js', import.meta.url), {
  namedExports: {
    appendBubble: (role, html) => { _bubbleCalls.push({ role, html }); },
    showTyping: () => {}, hideTyping: () => {},
    _createStreamBubble: () => ({}), _updateStreamBubble: () => {}, setBubbleTarget: () => {},
  },
});
function resetBubble() { _bubbleCalls.length = 0; }

await import(new URL('../../gwp-registry.js', import.meta.url));
const { _handleOrchestrationTags } = await import(new URL('../gopang/ai/call-ai.js', import.meta.url));
const { CFG } = await import(new URL('../gopang/core/config.js', import.meta.url));
const { getService } = globalThis;

function resetCalls() { _spLoadCalls.length = 0; CFG.system = null; CFG.system_base = null; }

// sendFn 목 — _watchdogSendFn이 감싸서 호출하는 대상. 실제 후속 턴 발화는
// 검증 범위 밖이므로, 호출됐다는 사실과 인자만 기록한다.
const _sendCalls = [];
async function mockSendFn(text, imageFile, preTabArg, modelTierArg) {
  _sendCalls.push({ text, imageFile, preTabArg, modelTierArg });
}
function resetSend() { _sendCalls.length = 0; }

// ═══════════════════════════════════════════════════════════
describe('KPKWKJ — gwp-registry.js 등록 확인 (사고실험 0단계 — 코드가 있어야 실행도 있다)', () => {
  test('R-01: kplan/kwatch/kjob 셋 다 type=switch로 등록, url 프로퍼티 없음', () => {
    for (const id of ['kplan', 'kwatch', 'kjob']) {
      const svc = getService(id);
      assert.ok(svc, `${id}: gwp-registry.js에 등록 안 됨`);
      assert.equal(svc.type, 'switch', `${id}: type이 switch가 아님`);
      assert.equal(svc.status, 'active', `${id}: status가 active가 아님`);
      assert.equal(
        Object.prototype.hasOwnProperty.call(svc, 'url'), false,
        `${id}: type=switch인데 url 프로퍼티가 존재함(SD-15류 위생 위반)`
      );
      assert.ok(Array.isArray(svc.triggers) && svc.triggers.length > 0, `${id}: triggers 비어있음`);
    }
  });

  test('R-02: sp_key가 sp-catalog.json 등록명과 정확히 일치(k-plan/k-watch/k-job)', () => {
    assert.equal(getService('kplan').sp_key, 'k-plan');
    assert.equal(getService('kwatch').sp_key, 'k-watch');
    assert.equal(getService('kjob').sp_key, 'k-job');
  });
});

describe('KPKWKJ — [CALL_*: query=...] 정상 디스패치 (_handleOrchestrationTags)', { concurrency: 1 }, () => {
  test('D-01: [CALL_KPLAN: query=...] → k-plan 로더 호출 + CFG.system 전환', async () => {
    resetCalls(); resetSend();
    const handled = await _handleOrchestrationTags(
      '[CALL_KPLAN: query=이직하고 싶다]', null, mockSendFn, '이직하고 싶다');
    assert.equal(handled, true, 'switchMatch가 처리됨을 반환해야 함');
    assert.deepEqual(_spLoadCalls, ['k-plan'], 'k-plan 로더가 정확히 한 번 호출돼야 함');
    assert.equal(CFG.system, '[MOCK SP TEXT for k-plan]', 'CFG.system이 K-Plan SP 텍스트로 전환돼야 함');
    assert.equal(_sendCalls.length, 1, '위임 후 INTERNAL 후속 발화가 정확히 한 번 나가야 함');
    assert.match(_sendCalls[0].text, /이직하고 싶다/, '원 발화가 INTERNAL 메시지에 그대로 전달돼야 함');
  });

  test('D-02: [CALL_KWATCH: query=...] → k-watch 로더 호출 + CFG.system 전환', async () => {
    resetCalls(); resetSend();
    const handled = await _handleOrchestrationTags(
      '[CALL_KWATCH: query=도로에 쓰레기가 무단투기됐어요]', null, mockSendFn, '도로에 쓰레기가 무단투기됐어요');
    assert.equal(handled, true);
    assert.deepEqual(_spLoadCalls, ['k-watch']);
    assert.equal(CFG.system, '[MOCK SP TEXT for k-watch]');
    assert.equal(_sendCalls.length, 1);
  });

  test('D-03: [CALL_KJOB: query=...] → k-job 로더 호출 + CFG.system 전환', async () => {
    resetCalls(); resetSend();
    const handled = await _handleOrchestrationTags(
      '[CALL_KJOB: query=이력서 써줘]', null, mockSendFn, '이력서 써줘');
    assert.equal(handled, true);
    assert.deepEqual(_spLoadCalls, ['k-job']);
    assert.equal(CFG.system, '[MOCK SP TEXT for k-job]');
    assert.equal(_sendCalls.length, 1);
  });

  test('D-04: 콜론 뒤 공백 없어도 매칭 (SD-02류 회귀 방지 — 이 세 태그에도 동일 정규식 적용됨을 확인)', async () => {
    // 주의: _loadKJobSP는 K-Telecom/K-Estate 로더와 동일하게 모듈 스코프
    // 캐시(_kJobSpCache)를 쓴다 — D-03에서 이미 한 번 로드됐으므로 여기서는
    // _loadSpByKey가 재호출되지 않고 캐시를 반환한다(의도된 동작, 회귀 아님).
    // 그래서 이 테스트는 _spLoadCalls가 아니라 CFG.system 결과로만 검증한다.
    resetCalls(); resetSend();
    const handled = await _handleOrchestrationTags(
      '[CALL_KJOB:query=면접 준비 도와줘]', null, mockSendFn, '면접 준비 도와줘');
    assert.equal(handled, true, '콜론 뒤 공백 없는 형식도 매칭돼야 함');
    assert.equal(CFG.system, '[MOCK SP TEXT for k-job]', 'CFG.system이 (캐시된) K-Job SP 텍스트로 전환돼야 함');
  });

  test('D-05: 기존 K-Telecom/K-Estate 경로가 이번 정규식 확장으로 깨지지 않았는지(회귀 방지)', async () => {
    resetCalls(); resetSend();
    const handled = await _handleOrchestrationTags(
      '[CALL_KTELECOM: query=유심 요금제 알려줘]', null, mockSendFn, '유심 요금제 알려줘');
    assert.equal(handled, true);
    assert.deepEqual(_spLoadCalls, ['SP-23_ktelecom'], 'K-Telecom 로더는 기존 sp_key(SP-23_ktelecom)를 그대로 써야 함 — kplan/kwatch/kjob과 이름 체계가 다름');
  });

  test('D-06: 알 수 없는 CALL_ 태그 → 매칭 안 됨, 예외 없음', async () => {
    resetCalls(); resetSend();
    const handled = await _handleOrchestrationTags(
      '[CALL_KUNKNOWN: query=아무거나]', null, mockSendFn, '아무거나');
    assert.equal(handled, false, '알 수 없는 서비스는 switchMatch 블록을 그냥 통과하고 함수 끝까지 가서 false를 반환해야 함(예외 없이)');
    assert.deepEqual(_spLoadCalls, []);
    assert.equal(_sendCalls.length, 0);
  });

  test('D-07: 전환 알림 말풍선에 영문 라벨이 아니라 한글 라벨이 노출됨(_STAGE_LABELS 등록 확인)', async () => {
    resetCalls(); resetSend(); resetBubble();
    await _handleOrchestrationTags('[CALL_KJOB: query=이력서 써줘]', {}, mockSendFn, '이력서 써줘');
    assert.equal(_bubbleCalls.length, 1, '전환 알림 말풍선이 정확히 한 번 붙어야 함');
    assert.match(_bubbleCalls[0].html, /구직 상담/, 'K-Job 전환 알림에 한글 라벨(구직 상담)이 있어야 함 — 없으면 "K-Job 단계로 이동 중…"처럼 영문이 그대로 노출됨');
    assert.doesNotMatch(_bubbleCalls[0].html, /K-Job 단계로/, '영문 원문 라벨이 그대로 노출되면 안 됨');
  });
});
