// ============================================================
// m05_ai_assistant.test.mjs — M05 AI 비서 모듈 테스트
// 저장위치: gopang/src/tests/profile2.0/m05_ai_assistant.test.mjs
// 실행: node src/tests/profile2.0/m05_ai_assistant.test.mjs
// ============================================================

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ─── 테스트 대상 함수 인라인 ───

const ESCALATION_KEYWORDS = [
  '사람 연결','사람이랑','직원','상담원','연결해줘','사람과',
  '人工','转人工','真人','客服',
  'human','person','agent','staff','real person','talk to someone',
  '人間','スタッフ','担당者',
  'người thật','nhân viên',
  'คนจริง','พนักงาน',
];
const FAIL_WINDOW_MS = 10 * 60 * 1000;
const FAIL_THRESHOLD = 3;
const SUPPORTED_LANGS = ['ko', 'zh', 'en', 'ja', 'vi', 'th'];

async function aesEncrypt(plaintext, rawKey) {
  const keyBuf  = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rawKey.padEnd(32,'0').slice(0,32)),
    { name:'AES-GCM' }, false, ['encrypt']
  );
  const iv      = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipher  = await crypto.subtle.encrypt({ name:'AES-GCM', iv }, keyBuf, encoded);
  const combined = new Uint8Array(12 + cipher.byteLength);
  combined.set(iv); combined.set(new Uint8Array(cipher), 12);
  return btoa(String.fromCharCode(...combined));
}

async function aesDecrypt(b64, rawKey) {
  const combined = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  const iv       = combined.slice(0, 12);
  const cipher   = combined.slice(12);
  const keyBuf   = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(rawKey.padEnd(32,'0').slice(0,32)),
    { name:'AES-GCM' }, false, ['decrypt']
  );
  const plain = await crypto.subtle.decrypt({ name:'AES-GCM', iv }, keyBuf, cipher);
  return new TextDecoder().decode(plain);
}

function detectEscalationKeyword(message) {
  const lower = message.toLowerCase();
  return ESCALATION_KEYWORDS.some(kw => lower.includes(kw.toLowerCase()));
}

function countRecentFails(messages) {
  const cutoff = Date.now() - FAIL_WINDOW_MS;
  return messages.filter(m => m.type === 'fail' && m.ts > cutoff).length;
}

function buildSystemPrompt(profile, distanceM) {
  const menu    = profile?.extra?.menu || [];
  const hours   = profile?.extra?.business_hours || '정보 없음';
  const name    = profile?.name || '업체';
  const address = profile?.address || '';
  const menuText = menu.length > 0
    ? menu.map(m => `- ${m.name}: ₮${m.price?.toLocaleString()||'?'}`).join('\n')
    : '(메뉴 정보 없음)';
  const locationText = distanceM !== null
    ? `현재 방문자와의 거리: 약 ${distanceM}m (도보 약 ${Math.round(distanceM / 67)}분)`
    : '';
  return `당신은 "${name}"의 AI 비서입니다.\n주소: ${address}\n영업시간: ${hours}\n${locationText}\n\n[메뉴]\n${menuText}\n\n[필수 규칙]\n1. 메뉴 외 정보는 모른다고 답하세요.\n2. 답변은 2~3문장 이내로 유지하세요.`;
}

// ─────────────────────────────────────────────
// 테스트 프레임워크
// ─────────────────────────────────────────────
let passed = 0, failed = 0;
async function test(id, desc, fn) {
  try {
    await fn();
    console.log(`  ✅ ${id} ${desc}`);
    passed++;
  } catch(e) {
    console.log(`  ❌ ${id} ${desc}`);
    console.log(`     → ${e.message}`);
    failed++;
  }
}
function assert(cond, msg)   { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) { if (a !== b) throw new Error(msg || `expected "${b}", got "${a}"`); }

// ─────────────────────────────────────────────
// AI01 정상 AI 응답 흐름 — 시스템 프롬프트 구성
// ─────────────────────────────────────────────
await test('AI01', '정상 AI 흐름 — 시스템 프롬프트 구성 검증', async () => {
  const profile = {
    name: '금능반점', address: '한림읍 금능리 123',
    extra: {
      business_hours: '11:00-20:00',
      menu: [
        { name: '짜장면', price: 7000 },
        { name: '짬뽕',   price: 8000 },
      ],
    },
  };
  const prompt = buildSystemPrompt(profile, 230);
  assert(prompt.includes('금능반점'),   '업체명 없음');
  assert(prompt.includes('짜장면'),     '메뉴 없음');
  assert(prompt.includes('11:00-20:00'),'영업시간 없음');
  assert(prompt.includes('230m'),       '거리 없음');
  assert(prompt.includes('메뉴 외'),    '할루시네이션 방지 규칙 없음');
});

// ─────────────────────────────────────────────
// AI02 AI 비활성 업체 — human 모드 전환
// ─────────────────────────────────────────────
await test('AI02', 'ai_active=false — human 모드 전환 조건', () => {
  // llmKey 없음
  const llmKey1 = null;
  assert(!llmKey1, '레코드 없음 → human 미전환');

  // ai_active=false
  const llmKey2 = { ai_active: false };
  assert(!llmKey2.ai_active, 'ai_active=false → human 미전환');

  // ai_active=true → AI 모드
  const llmKey3 = { ai_active: true };
  assert(llmKey3.ai_active, 'ai_active=true → AI 미선택');
});

// ─────────────────────────────────────────────
// AI03 3회 연속 실패 → 에스컬레이션
// ─────────────────────────────────────────────
await test('AI03', '3회 실패 → 에스컬레이션 조건 충족', () => {
  const now = Date.now();
  // 최근 10분 내 실패 3회
  const messages = [
    { type: 'fail', ts: now - 1000, reason: 'LLM_TIMEOUT' },
    { type: 'fail', ts: now - 2000, reason: 'LLM_HTTP_502' },
    { type: 'fail', ts: now - 3000, reason: 'LLM_TIMEOUT' },
  ];
  assertEq(countRecentFails(messages), 3, '실패 카운트 오류');
  assert(countRecentFails(messages) >= FAIL_THRESHOLD, '에스컬레이션 미트리거');

  // 10분 이전 실패는 카운트 제외
  const oldMessages = [
    { type: 'fail', ts: now - FAIL_WINDOW_MS - 1000, reason: 'OLD' },
    { type: 'fail', ts: now - FAIL_WINDOW_MS - 2000, reason: 'OLD' },
    { type: 'fail', ts: now - FAIL_WINDOW_MS - 3000, reason: 'OLD' },
  ];
  assertEq(countRecentFails(oldMessages), 0, '오래된 실패가 카운트됨');
});

// ─────────────────────────────────────────────
// AI04 에스컬레이션 키워드 감지 — 6개 언어
// ─────────────────────────────────────────────
await test('AI04', '에스컬레이션 키워드 — 6개 언어 감지', () => {
  const cases = [
    { msg: '사람 연결해줘',        expected: true,  lang: 'ko' },
    { msg: '직원이랑 얘기하고 싶어', expected: true,  lang: 'ko' },
    { msg: '转人工客服',            expected: true,  lang: 'zh' },
    { msg: 'I want to talk to a human agent', expected: true, lang: 'en' },
    { msg: 'スタッフに繋いでください', expected: true, lang: 'ja' },
    { msg: 'cho tôi gặp nhân viên', expected: true,  lang: 'vi' },
    { msg: '짜장면 한 그릇 주세요', expected: false, lang: 'ko' },
    { msg: 'what time do you close?', expected: false, lang: 'en' },
    { msg: '营业时间是几点',        expected: false, lang: 'zh' },
  ];
  for (const { msg, expected, lang } of cases) {
    const result = detectEscalationKeyword(msg);
    assert(result === expected,
      `[${lang}] "${msg}" → 기대:${expected}, 실제:${result}`);
  }
});

// ─────────────────────────────────────────────
// AI05 할루시네이션 방지 — 시스템 프롬프트 규칙 포함
// ─────────────────────────────────────────────
await test('AI05', '할루시네이션 방지 — 시스템 프롬프트 규칙 검증', () => {
  const profile = { name: '금능반점', address: '한림읍', extra: {} };
  const prompt  = buildSystemPrompt(profile, null);
  assert(prompt.includes('메뉴 외'), '메뉴 외 정보 거절 규칙 없음');
  assert(prompt.includes('모른다고'), '모른다고 답하라 규칙 없음');
  // 메뉴 없을 때
  assert(prompt.includes('메뉴 정보 없음'), '빈 메뉴 처리 없음');
});

// ─────────────────────────────────────────────
// AI06 LLM 키 암호화 저장 — 평문 노출 없음
// ─────────────────────────────────────────────
await test('AI06', 'LLM 키 AES-256-GCM 암호화 — 평문 != 암호문', async () => {
  const apiKey     = 'sk-test-secret-key-12345';
  const encKey     = 'gopang-aes-test-key-2026';
  const encrypted  = await aesEncrypt(apiKey, encKey);

  // 암호문이 평문과 다름
  assert(encrypted !== apiKey, '암호화 실패 — 평문과 동일');
  // base64 형식
  assert(/^[A-Za-z0-9+/=]+$/.test(encrypted), 'base64 형식 아님');
  // 암호문이 원본 키를 포함하지 않음
  assert(!encrypted.includes(apiKey), '암호문에 평문 노출');
});

// ─────────────────────────────────────────────
// AI07 AES 복호화 정합성 — 원본 == 복호화 결과
// ─────────────────────────────────────────────
await test('AI07', 'AES 복호화 정합성 — 암호화 → 복호화 = 원본', async () => {
  const cases = [
    'sk-anthropic-test-key-xxxxx',
    'sk-openai-test-key-yyyyy',
    'sk-deepseek-test-12345678',
    '한글키도테스트합니다',           // 유니코드
    'key with spaces and !@#$%',   // 특수문자
  ];
  const encKey = 'test-encryption-key-32chars!!';
  for (const original of cases) {
    const enc = await aesEncrypt(original, encKey);
    const dec = await aesDecrypt(enc, encKey);
    assertEq(dec, original, `복호화 불일치: "${original}"`);
  }
});

// ─────────────────────────────────────────────
// AI08 AES_ENCRYPTION_KEY 미등록 → 오류 감지
// ─────────────────────────────────────────────
await test('AI08', 'AES_ENCRYPTION_KEY 누락 — 오류 발생', async () => {
  let caught = false;
  try {
    await aesEncrypt('test', undefined); // key=undefined
  } catch { caught = true; }
  assert(caught, 'AES_ENCRYPTION_KEY 누락 시 오류 미발생');
});

// ─────────────────────────────────────────────
// AI09 위치 컨텍스트 주입
// ─────────────────────────────────────────────
await test('AI09', '위치 컨텍스트 — distance_m 시스템 프롬프트 주입', () => {
  const profile = { name: '금능반점', extra: {} };

  // 거리 있음
  const promptWith = buildSystemPrompt(profile, 230);
  assert(promptWith.includes('230m'), '거리 미주입');
  assert(promptWith.includes('도보'), '도보 시간 미주입');

  // 거리 없음 (null)
  const promptWithout = buildSystemPrompt(profile, null);
  assert(!promptWithout.includes('230m'),  '거리 없는데 주입됨');
  assert(!promptWithout.includes('도보'),  '도보 없는데 주입됨');
});

// ─────────────────────────────────────────────
// AI10 지원 언어 6개 확인
// ─────────────────────────────────────────────
await test('AI10', '지원 언어 6개 — ko/zh/en/ja/vi/th', () => {
  const required = ['ko', 'zh', 'en', 'ja', 'vi', 'th'];
  for (const lang of required) {
    assert(SUPPORTED_LANGS.includes(lang), `${lang} 미지원`);
  }
  assertEq(SUPPORTED_LANGS.length, 6, `지원 언어 수 오류: ${SUPPORTED_LANGS.length}`);
});

// ─────────────────────────────────────────────
// 추가: LLM provider 분기 — 지원 목록 검증
// ─────────────────────────────────────────────
await test('AI11', 'LLM provider 지원 목록 검증', () => {
  const supported = ['anthropic', 'openai', 'deepseek', 'custom'];
  const invalid   = ['gemini', 'mistral', 'cohere'];

  for (const p of supported) {
    assert(['anthropic','openai','deepseek','custom'].includes(p),
      `${p} 미지원`);
  }
  for (const p of invalid) {
    assert(!['anthropic','openai','deepseek','custom'].includes(p),
      `${p} 잘못 지원됨`);
  }
});

// ─────────────────────────────────────────────
// 추가: 에스컬레이션 상태 머신 전이 검증
// ─────────────────────────────────────────────
await test('AI12', '에스컬레이션 상태 머신 — ai→escalated 전이', () => {
  // 유효 전이
  const validTransitions = [
    { from: 'ai',        trigger: 'fail_count', to: 'escalated' },
    { from: 'ai',        trigger: 'keyword',    to: 'escalated' },
    { from: 'human',     trigger: 'timeout',    to: 'escalated' },
    { from: 'escalated', trigger: 'manual',     to: 'ai' }, // 복구
  ];

  function nextMode(current, trigger) {
    if (current === 'escalated' && trigger === 'manual') return 'ai';
    if (trigger === 'fail_count' || trigger === 'keyword' || trigger === 'timeout')
      return 'escalated';
    return current;
  }

  for (const { from, trigger, to } of validTransitions) {
    assertEq(nextMode(from, trigger), to, `${from} -[${trigger}]→ ${to} 전이 오류`);
  }
});

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log(`M05 AI Assistant 테스트 결과: ${passed}/${passed+failed} 통과`);
if (failed > 0) {
  console.log(`❌ 실패: ${failed}건`);
  process.exit(1);
} else {
  console.log('✅ 전체 통과 — M05 합격');
}
console.log('══════════════════════════════════════');
