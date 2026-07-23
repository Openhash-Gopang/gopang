import { appendUtterance, AutoSendLimiter, backoffDelayMs, THEME_HONDI_BLUE, THEME_LINE_GREEN }
  from '../../gopang/ui/chat-input-core.js';

let pass = 0, fail = 0;
function ok(cond, label) {
  if (cond) { pass++; }
  else { fail++; console.error('❌', label); }
}

// ── appendUtterance: 이번 버그(이미지 3의 중복 텍스트)의 재발 방지가
// 핵심 목적 — continuous:false 세션 재시작 패턴에서 매 세션의 transcript를
// baseText에 "정확히 한 번씩만" 이어붙이는지 확인한다. ──────────────────
ok(appendUtterance('', '제주시청 기초생활과') === '제주시청 기초생활과',
   'A-01: 빈 baseText + 첫 발화');
ok(appendUtterance('제주시청 기초생활과', '기초 수급 자격이 되는지') ===
   '제주시청 기초생활과 기초 수급 자격이 되는지',
   'A-02: 두 번째 발화가 공백 하나로 이어붙는다(중복 없음)');
ok(appendUtterance('이미 공백으로 끝남 ', '확인하고') === '이미 공백으로 끝남 확인하고',
   'A-03: baseText가 이미 공백으로 끝나면 공백을 또 넣지 않는다');
ok(appendUtterance('base', '') === 'base',
   'A-04: 빈 transcript는 그대로 무시(추가 안 함)');
// 회귀 방지: 같은 세션 결과를 실수로 두 번 넘겨도(예: onresult가 중복
// 호출되는 브라우저 결함이 재발해도) 이 함수 자체는 "한 번 넘긴 값 = 한 번
// 누적"만 보장한다 — 호출부(chat-input.js)가 세션당 정확히 한 번만
// 호출하는 게 전제라는 걸 문서화하는 테스트.
{
  let base = '';
  base = appendUtterance(base, '기초 수급 자격이 되는지');
  base = appendUtterance(base, '확인하고');
  ok(base === '기초 수급 자격이 되는지 확인하고',
     'A-05: 세션 2회(정상 흐름) — 반복 없이 정확히 이어붙음');
}

// ── AutoSendLimiter: 분당 상한 ───────────────────────────────────────
{
  const lim = new AutoSendLimiter(3, 60_000);
  let now = 1_000_000;
  let allowedCount = 0;
  for (let i = 0; i < 6; i++) {
    if (lim.allowed(now)) { lim.record(now); allowedCount++; }
    now += 1000; // 1초 간격으로 6회 시도
  }
  ok(allowedCount === 3, `B-01: 상한(3)을 넘는 시도는 막힘 (실제 허용 ${allowedCount}회)`);
}
{
  const lim = new AutoSendLimiter(2, 1000); // 1초 윈도우
  let now = 0;
  ok(lim.allowed(now), 'B-02a: 첫 시도 허용'); lim.record(now);
  ok(lim.allowed(now), 'B-02b: 두 번째 시도 허용'); lim.record(now);
  ok(!lim.allowed(now), 'B-02c: 세 번째(윈도우 내) 시도 차단');
  ok(lim.allowed(now + 1500), 'B-02d: 윈도우(1초)가 지나면 다시 허용');
}
{
  const lim = new AutoSendLimiter(1, 1000);
  lim.record(0);
  ok(!lim.allowed(500), 'B-03a: reset 전엔 차단');
  lim.reset();
  ok(lim.allowed(500), 'B-03b: reset 후엔 즉시 허용');
}

// ── backoffDelayMs: 지수 백오프 ───────────────────────────────────────
ok(backoffDelayMs(0) === 150, 'C-01: 임계값 이하는 baseMs 그대로');
ok(backoffDelayMs(3) === 150, 'C-02: 임계값(기본 3)까지는 baseMs 그대로');
ok(backoffDelayMs(4) === 300, 'C-03: 임계값 +1 → baseMs*2');
ok(backoffDelayMs(5) === 600, 'C-04: 임계값 +2 → baseMs*4');
ok(backoffDelayMs(20) === 30_000, 'C-05: 상한(maxMs) 초과 안 함');
ok(backoffDelayMs(4, { baseMs: 100, thresholdBeforeBackoff: 1 }) === 800,
   'C-06: 커스텀 baseMs/threshold 반영 (100 * 2^(4-1) = 800)');

// ── 테마 프리셋 — 값 자체가 실수로 바뀌지 않았는지(디자인 결정 고정값) ──
ok(THEME_HONDI_BLUE.primary === '#1A73E8', 'D-01: hondi-blue는 webapp.html 기존 --green 값과 동일');
ok(THEME_LINE_GREEN.primary === '#06C755', 'D-02: line-green은 LINE 공식 브랜드 그린(2020년 개편 이후) 값과 동일');
ok(THEME_HONDI_BLUE.primary !== THEME_LINE_GREEN.primary,
   'D-03: 두 테마는 서로 다른 색이어야 한다(구분이 이번 작업의 목적)');

console.log(`\n결과: ${pass} 통과 / ${fail} 실패 / 총 ${pass + fail}`);
process.exit(fail > 0 ? 1 : 0);
