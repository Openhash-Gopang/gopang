/**
 * chat-input.js의 DOM 마운트 동작 스모크 테스트.
 * 실행 전 1회: npm install --no-save jsdom
 * (저장소에 아직 package.json이 없어 devDependency로 고정하지 않음 —
 *  검증 도구일 뿐 배포 대상이 아니므로 node_modules는 커밋하지 않는다.)
 */
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><body><div id="slot"></div></body></html>');
global.window = dom.window;
global.document = dom.window.document;
global.CustomEvent = dom.window.CustomEvent;
Object.defineProperty(global, 'navigator', { value: dom.window.navigator, configurable: true });
// jsdom엔 SpeechRecognition이 없다 — 의도적으로 그대로 둬서
// "브라우저 미지원 시 마이크 버튼 자동 숨김" 경로를 검증한다.

const { mountChatInput, THEME_LINE_GREEN, THEME_HONDI_BLUE } =
  await import('../../gopang/ui/chat-input.js');

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; } else { fail++; console.error('❌', label); }
}

const container = document.getElementById('slot');
const sentCalls = [];
const ci = mountChatInput(container, {
  theme: THEME_LINE_GREEN,
  placeholder: '테스트 placeholder',
  onSend: (text, files) => { sentCalls.push({ text, files }); },
});

// ── 마크업 주입 ──────────────────────────────────────────
ok(container.querySelector('.ci-input') !== null, 'M-01: 입력창(.ci-input) 주입됨');
ok(container.querySelector('.ci-send-btn') !== null, 'M-02: 전송버튼 주입됨');
ok(container.querySelector('.ci-input').getAttribute('placeholder') === '테스트 placeholder',
   'M-03: placeholder config 반영');

// ── 테마 변수 ────────────────────────────────────────────
ok(container.style.getPropertyValue('--brand-primary') === THEME_LINE_GREEN.primary,
   'M-04: --brand-primary가 LINE 그린으로 설정됨');
ok(container.style.getPropertyValue('--brand-primary') !== THEME_HONDI_BLUE.primary,
   'M-05: hondi-blue 값과는 다름(테마 분리 확인)');

// ── 마이크 미지원 브라우저 — 버튼 자동 숨김 ──────────────
ok(container.querySelector('.ci-mic-btn').style.display === 'none',
   'M-06: SpeechRecognition 미지원 시 마이크 버튼 자동 숨김');
ok(ci.isMicSupported() === false, 'M-07: isMicSupported() === false');

// ── 전송 버튼 활성/비활성 ────────────────────────────────
const input = container.querySelector('.ci-input');
const sendBtn = container.querySelector('.ci-send-btn');
ok(sendBtn.disabled === true, 'M-08: 초기 상태 — 빈 입력이면 전송버튼 비활성');
input.value = '안녕하세요';
input.dispatchEvent(new dom.window.Event('input'));
ok(sendBtn.disabled === false, 'M-09: 텍스트 입력 시 전송버튼 활성');
input.value = '';
input.dispatchEvent(new dom.window.Event('input'));
ok(sendBtn.disabled === true, 'M-10: 다시 비우면 전송버튼 비활성');

// ── setGenerating — 생성 중엔 비어있어도 활성(중단 버튼 역할) ──
ci.setGenerating(true);
ok(sendBtn.disabled === false, 'M-11: setGenerating(true) — 빈 입력이어도 전송버튼 활성(중단용)');
ok(sendBtn.classList.contains('generating'), 'M-12: generating 클래스 적용');
ci.setGenerating(false);
ok(sendBtn.disabled === true, 'M-13: setGenerating(false) 복귀 후 다시 비활성(빈 입력)');

// ── onSend 콜백 호출 확인 ────────────────────────────────
ci.setText('테스트 메시지');
sendBtn.click();
await new Promise(r => setTimeout(r, 0));
ok(sentCalls.length === 1 && sentCalls[0].text === '테스트 메시지',
   'M-14: 전송 버튼 클릭 시 onSend(text, files) 정확히 1회 호출');
ok(ci.getText() === '', 'M-15: 전송 후 입력창 비워짐');

// ── destroy — 정리 ───────────────────────────────────────
ci.destroy();
ok(container.innerHTML === '', 'M-16: destroy() 후 컨테이너 비워짐');

// ── readonlyUntilFocus 옵션 ──────────────────────────────
const container2 = document.createElement('div');
document.body.appendChild(container2);
const ci2 = mountChatInput(container2, {
  theme: THEME_LINE_GREEN,
  readonlyUntilFocus: true,
  onSend: () => {},
});
const input2 = container2.querySelector('.ci-input');
ok(input2.hasAttribute('readonly'), 'M-17: readonlyUntilFocus:true — 초기 상태 readonly');
input2.dispatchEvent(new dom.window.Event('focus'));
ok(!input2.hasAttribute('readonly'), 'M-18: focus 시 readonly 해제');
ci2.destroy();

console.log(`\n결과: ${pass} 통과 / ${fail} 실패 / 총 ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
