/**
 * src/gopang/ui/chat-input-core.js — chat-input.js의 DOM-비의존 순수 로직
 *
 * 왜 분리했는가: chat-input.js는 SpeechRecognition/DOM에 의존해 브라우저
 * 밖(node 테스트 러너)에서 실행할 수 없다. 이 파일은 실제 버그(마이크
 * 텍스트 중복)와 직결된 "발화 누적" 로직, 그리고 자동전송 폭주 방지
 * 로직만 순수 함수/클래스로 뽑아 node에서 검증 가능하게 한다.
 *
 * 설계 원칙(2026-07-23, 버그 조사 결론 반영):
 *   webapp.html의 #ai-panel-mic-btn 구현(continuous:false + interimResults:
 *   false, 한 발화 = 정확히 하나의 확정 결과, onend마다 재시작)이 실전
 *   검증된 유일하게 안전한 패턴이다 — Chrome의 continuous:true 모드에서
 *   e.resultIndex가 안정적으로 증가하지 않아 이미 확정된 구간이 재평가/
 *   재누적되는 결함(chat-shell.js의 옛 wireMic()이 여기 걸려 있었다)을
 *   구조적으로 피한다. 이 파일은 그 패턴만 표준으로 채택한다 —
 *   continuous:true 기반 로직은 절대 다시 들이지 않는다.
 */

// ── 발화 누적 — "한 발화(세션) = transcript 하나"를 baseText에 이어붙인다.
// webapp.html 3460행의 로직을 그대로 옮김(왕복 검증된 원본을 그대로 승격).
export function appendUtterance(baseText, transcript) {
  if (!transcript) return baseText;
  return baseText && !/\s$/.test(baseText) ? baseText + ' ' + transcript : baseText + transcript;
}

// ── 분당 자동전송 상한 — 오인식/하울링으로 인한 무한 자동전송 폭주 방지.
// webapp.html의 _autoSendAllowed()를 순수 클래스로 승격(테스트 가능하게
// Date.now 대신 now를 인자로 받는 형태로 변경 — 시간 의존성 제거).
export class AutoSendLimiter {
  constructor(maxPerWindow = 6, windowMs = 60_000) {
    this.maxPerWindow = maxPerWindow;
    this.windowMs = windowMs;
    this._timestamps = [];
  }
  // now를 명시적으로 받는다(테스트에서 가짜 시간 주입 용도). 생략 시 실제 시각.
  allowed(now = Date.now()) {
    this._timestamps = this._timestamps.filter(t => now - t < this.windowMs);
    return this._timestamps.length < this.maxPerWindow;
  }
  record(now = Date.now()) {
    this._timestamps.push(now);
  }
  reset() {
    this._timestamps = [];
  }
}

// ── 에러 연속 카운트에 따른 지수 백오프 지연 계산 — 항상 웨이크워드 쪽
// (webapp.html 4415-4419행)에서만 쓰이던 걸 일반화. AI마이크 재시작에도
// 재사용 가능하도록 순수 함수로 뽑음.
export function backoffDelayMs(consecutiveErrors, {
  baseMs = 150, maxMs = 30_000, thresholdBeforeBackoff = 3,
} = {}) {
  if (consecutiveErrors <= thresholdBeforeBackoff) return baseMs;
  return Math.min(baseMs * Math.pow(2, consecutiveErrors - thresholdBeforeBackoff), maxMs);
}

// ── 테마 프리셋 — 상단바/전송버튼/사용자 말풍선 색을 결정하는 3토큰.
// 값 자체는 여기 한 곳에서만 관리해 나중에 톤 조정 시 한 파일만 고치면
// 되게 한다(디자인 결정: 2026-07-23, 주피터 지시).
export const THEME_HONDI_BLUE = Object.freeze({
  primary:      '#1A73E8',
  primaryDark:  '#1557B0',
  primaryBg:    '#EEF4FF',
});
// LINE 공식 브랜드 그린(#06C755, 2020년 개편 이후 현재 값) — webapp.html을
// 제외한 모든 대화창(GWP 기관 안내, 전문가 페르소나, 프로필 작성 등)의
// 공용 기본 테마. "파랑=내 AI 비서, 초록=바깥 대화창"으로 사용자가 상단바/
// 말풍선 색만 보고 즉시 구분할 수 있게 하는 것이 목적이다.
export const THEME_LINE_GREEN = Object.freeze({
  primary:      '#06C755',
  primaryDark:  '#04A344',
  primaryBg:    '#E9FBF0',
});
