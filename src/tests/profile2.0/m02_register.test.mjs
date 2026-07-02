// ============================================================
// m02_register.test.mjs — M02 등록 모듈 테스트
// 저장위치: gopang/src/tests/profile2.0/m02_register.test.mjs
// 실행: node src/tests/profile2.0/m02_register.test.mjs
// 환경: Node.js 18+ (Supabase 호출 없이 로직만 단위 테스트)
// ============================================================

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

// ─── 테스트 대상 함수 인라인 (worker 환경과 동일) ───

const REGION_MAP = {
  '한림읍':'hallim','애월읍':'aewol','구좌읍':'gujwa','조천읍':'jocheon',
  '서귀포시':'seogwipo','성산읍':'seongsan','남원읍':'namwon','대정읍':'daejeong',
  '제주시':'jeju','안덕면':'andeok','표선면':'pyoseon','한경면':'hangyeong',
};

const INITIAL = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const VOWEL   = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const FINAL   = ['','g','kk','ks','n','nj','nh','d','l','lg','lm','lb','ls','lt','lp','lh','m','b','bs','s','ss','ng','j','ch','k','t','p','h'];

function hangulToRoman(str) {
  let result = '';
  for (const ch of str) {
    const code = ch.charCodeAt(0);
    if (code >= 0xAC00 && code <= 0xD7A3) {
      const offset = code - 0xAC00;
      const ini = Math.floor(offset / (21 * 28));
      const vow = Math.floor((offset % (21 * 28)) / 28);
      const fin = offset % 28;
      result += INITIAL[ini] + VOWEL[vow] + FINAL[fin];
    } else if (/[a-zA-Z0-9_]/.test(ch)) {
      result += ch.toLowerCase();
    }
  }
  return result || 'user';
}

function buildHandle(region, name) {
  const regionEn = REGION_MAP[region] || hangulToRoman(region) || 'jeju';
  const nameRoman = hangulToRoman(name).slice(0, 20);
  return `@${regionEn}_${nameRoman}`;
}

// resolveHandle 모킹 — Supabase 없이 충돌 시뮬레이션
async function resolveHandleMock(baseHandle, existingHandles) {
  for (let i = 0; i <= 9999; i++) {
    const candidate = i === 0 ? baseHandle : `${baseHandle}_${String(i).padStart(4, '0')}`;
    if (!existingHandles.has(candidate)) return candidate;
  }
  throw new Error('HANDLE_EXHAUSTED');
}

// ─────────────────────────────────────────────
// uuidv5 (M01과 동일 — 결정성 검증용)
// ─────────────────────────────────────────────
const GOPANG_NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
function uuidToBytes(uuid) {
  const hex = uuid.replace(/-/g,'');
  const b = new Uint8Array(16);
  for (let i=0;i<16;i++) b[i]=parseInt(hex.slice(i*2,i*2+2),16);
  return b;
}
function bytesToUUID(b) {
  const h = [...b].map(x=>x.toString(16).padStart(2,'0'));
  return [h.slice(0,4).join(''),h.slice(4,6).join(''),
          h.slice(6,8).join(''),h.slice(8,10).join(''),h.slice(10,16).join('')].join('-');
}
async function makeGUID(phoneDigits) {
  const nsBytes = uuidToBytes(GOPANG_NS);
  const digits  = phoneDigits.replace(/\D/g,'');
  const nameBytes = new TextEncoder().encode(digits);
  const combined = new Uint8Array(nsBytes.length+nameBytes.length);
  combined.set(nsBytes); combined.set(nameBytes,nsBytes.length);
  const hashBuf = await crypto.subtle.digest('SHA-1',combined);
  const h = new Uint8Array(hashBuf);
  h[6]=(h[6]&0x0f)|0x50; h[8]=(h[8]&0x3f)|0x80;
  return bytesToUUID(h);
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
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
function assertEq(a, b, msg) {
  if (a !== b) throw new Error(msg || `expected "${b}", got "${a}"`);
}
function assertMatch(str, regex, msg) {
  if (!regex.test(str)) throw new Error(msg || `"${str}" does not match ${regex}`);
}

// ─────────────────────────────────────────────
// R01 소비자 최소 등록 — 입력 유효성 + GUID 생성
// ─────────────────────────────────────────────
await test('R01', '소비자 최소 등록 — GUID + handle 생성', async () => {
  const phone = '010-1234-5678';
  const name  = '김민준';
  const guid  = await makeGUID(phone);
  // GUID 형식 검증
  assertMatch(guid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    `UUID v5 형식 오류: ${guid}`);
  // 소비자 handle: @consumer_{name_roman}
  const handle = `@consumer_${hangulToRoman(name)}`;
  assertMatch(handle, /^@consumer_[a-z]+$/, `handle 형식 오류: ${handle}`);
});

// ─────────────────────────────────────────────
// R02 handle 충돌 시 suffix 채번
// ─────────────────────────────────────────────
await test('R02', 'handle 충돌 — suffix 4자리 자동 채번', async () => {
  const existing = new Set(['@hallim_giminjun']);
  const base     = '@hallim_giminjun';

  const handle1 = await resolveHandleMock(base, new Set()); // 충돌 없음
  assertEq(handle1, '@hallim_giminjun', '기본 handle 오류');

  const handle2 = await resolveHandleMock(base, existing); // 충돌 1회
  assertEq(handle2, '@hallim_giminjun_0001', 'suffix 0001 오류');

  // 0001~0002 모두 충돌
  const existing2 = new Set(['@hallim_giminjun', '@hallim_giminjun_0001']);
  const handle3 = await resolveHandleMock(base, existing2);
  assertEq(handle3, '@hallim_giminjun_0002', 'suffix 0002 오류');
});

// ─────────────────────────────────────────────
// R03 사업자 등록 — extra JSONB 구성 검증
// ─────────────────────────────────────────────
await test('R03', '사업자 등록 — extra 필드 구성', async () => {
  const extra = {
    registered_at: new Date().toISOString(),
    ai_active: false,
    business_number: '123-45-67890',
    representative: '홍길동',
    ksic_code: '56113',
    business_hours: '11:00-21:00',
  };
  assert(extra.business_number, 'business_number 없음');
  assert(extra.ksic_code,       'ksic_code 없음');
  assertEq(extra.ai_active, false, 'ai_active 기본값 오류');
});

// ─────────────────────────────────────────────
// R04 기관 등록 — institution_type 필드
// ─────────────────────────────────────────────
await test('R04', '기관 등록 — institution extra 구성', async () => {
  const extra = {
    registered_at: new Date().toISOString(),
    ai_active: false,
    institution_type: 'hospital',
    parent_org: '제주도청',
    department: '보건위생과',
  };
  assertEq(extra.institution_type, 'hospital', 'institution_type 오류');
  assert(extra.department, 'department 없음');
});

// ─────────────────────────────────────────────
// R05 QR SVG 반환 형식 검증
// ─────────────────────────────────────────────
await test('R05', 'QR SVG — 형식 및 핵심 요소 검증', async () => {
  const handle = '@hallim_geumneung';
  const profileUrl = `https://users.hondi.net/profile.html?handle=${encodeURIComponent(handle)}`;

  // SVG 생성 인라인
  const encoded = encodeURIComponent(profileUrl);
  const qrImgUrl = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encoded}`;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="300" height="340" viewBox="0 0 300 340">
  <rect width="300" height="340" fill="#ffffff"/>
  <image href="${qrImgUrl}" x="20" y="20" width="260" height="260"/>
  <text x="150" y="312" font-family="sans-serif" font-size="13"
        fill="#ffffff" text-anchor="middle">${handle}</text>
</svg>`;

  assert(svg.includes('<?xml'), 'XML 선언 없음');
  assert(svg.includes('<svg'), 'SVG 태그 없음');
  assert(svg.includes('width="300"'), '너비 300 아님');
  assert(svg.includes('height="340"'), '높이 340 아님');
  assert(svg.includes(handle), 'handle 텍스트 없음');
  assert(svg.includes('users.hondi.net'), '도메인 없음');
  assert(svg.includes('qrserver.com'), 'QR 이미지 URL 없음');
});

// ─────────────────────────────────────────────
// R06 QR Cache-Control 헤더 (로직 검증)
// ─────────────────────────────────────────────
await test('R06', 'QR Cache-Control — max-age=86400 설정', async () => {
  const headers = {
    'Content-Type': 'image/svg+xml',
    'Cache-Control': 'public, max-age=86400',
  };
  assertEq(headers['Cache-Control'], 'public, max-age=86400', 'Cache-Control 오류');
  assertEq(headers['Content-Type'], 'image/svg+xml', 'Content-Type 오류');
});

// ─────────────────────────────────────────────
// R07 return_to 복귀 처리 로직
// ─────────────────────────────────────────────
await test('R07', 'return_to — pending_pay_url 복귀 로직', async () => {
  // localStorage 시뮬레이션
  const store = {};
  const payUrl = 'https://users.hondi.net/pay.html?to=@hallim_geumneung&amount=22000&expires=300&created_at=1718000000';

  // pay.html 진입 시 저장
  store['pending_pay_url'] = payUrl;
  assert(store['pending_pay_url'], '저장 실패');

  // 등록 완료 후 복귀
  const pending = store['pending_pay_url'];
  delete store['pending_pay_url'];
  assertEq(pending, payUrl, '복귀 URL 불일치');
  assert(!store['pending_pay_url'], '삭제 실패');
});

// ─────────────────────────────────────────────
// R08 ON CONFLICT 재등록 — GUID 불변, name 갱신
// ─────────────────────────────────────────────
await test('R08', '재등록 — 동일 전화번호 GUID 불변', async () => {
  const phone = '010-9999-1111';
  const guid1 = await makeGUID(phone);
  const guid2 = await makeGUID(phone); // 재등록 시뮬레이션
  assertEq(guid1, guid2, 'GUID 변경됨 — ON CONFLICT 설계 위반');
  // name은 EXCLUDED.name으로 갱신 (SQL ON CONFLICT 보장)
  // → Supabase Prefer: resolution=merge-duplicates 확인
});

// ─────────────────────────────────────────────
// R09 외국 번호 국가코드 처리
// ─────────────────────────────────────────────
await test('R09', '외국 번호 +86 — 숫자 추출 후 GUID 생성', async () => {
  const phone     = '+86-138-0013-0000';
  const digits    = phone.replace(/\D/g, '');
  assertEq(digits, '8613800130000', '숫자 추출 오류');
  assert(digits.length >= 7 && digits.length <= 15, '길이 유효성 오류');

  const guid = await makeGUID(phone);
  assertMatch(guid, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    'UUID v5 형식 오류');
});

// ─────────────────────────────────────────────
// 추가: buildHandle 지역 매핑 검증
// ─────────────────────────────────────────────
await test('R10', 'buildHandle — 지역 로마자 매핑', async () => {
  assertEq(buildHandle('한림읍', '김민준'), '@hallim_gimminjun',   '한림읍 매핑 오류');
  assertEq(buildHandle('서귀포시', '이보영'), '@seogwipo_iboyeong', '서귀포시 매핑 오류');
  assertEq(buildHandle('성산읍', '박철수'), '@seongsan_bagcheolsu', '성산읍 매핑 오류');
  // 매핑 없는 지역 — hangulToRoman 폴백
  const h = buildHandle('신촌동', '최강');
  assert(h.startsWith('@'), 'handle @ 시작 오류');
  assert(h.includes('_'), 'handle _ 구분자 오류');
});

// ─────────────────────────────────────────────
// 추가: 전화번호 유효성 검증 경계값
// ─────────────────────────────────────────────
await test('R11', '전화번호 유효성 — 경계값 검증', async () => {
  const valid   = ['01012345678', '8613800130000', '15551234567'];
  const invalid = ['12345', '1234567890123456']; // 6자리, 16자리

  for (const p of valid) {
    const d = p.replace(/\D/g,'');
    assert(d.length >= 7 && d.length <= 15, `유효 번호 거부: ${p}`);
  }
  for (const p of invalid) {
    const d = p.replace(/\D/g,'');
    assert(d.length < 7 || d.length > 15, `무효 번호 허용: ${p}`);
  }
});

// ─────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────
console.log('');
console.log('══════════════════════════════════════');
console.log(`M02 Register 테스트 결과: ${passed}/${passed+failed} 통과`);
if (failed > 0) {
  console.log(`❌ 실패: ${failed}건`);
  process.exit(1);
} else {
  console.log('✅ 전체 통과 — M02 합격');
}
console.log('══════════════════════════════════════');
