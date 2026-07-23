// ═══════════════════════════════════════════════════════════
// hondi-proxy — v4.9
// v4.8: /biz/profile, /biz/order, /biz/review, /biz/product
// v4.9: STEP 08 /biz/order L1 위임 (Worker 검증 제거)
//       STEP 09 handlePdvReport 동기 앵커링
//       STEP 10 VALID_PDV_SCOPES 11개 확장
//       STEP 11 reporter_svc 중복 PDV 방지
// v4.10 (2026-07-09): /biz/ai-chat, /biz/escalate 신설 — src/worker/
//       ai-chat-handler.js를 import(worker.js가 처음으로 로컬 모듈을
//       import한 사례 — wrangler.json이 export default 형태라 ES
//       modules 포맷이 이미 지원되고 있었음, 그동안 안 쓰였을 뿐).
// ═══════════════════════════════════════════════════════════

import { handleAiChat, handleEscalate } from './src/worker/ai-chat-handler.js';
import { handleOrderQueue } from './src/worker/order-queue-handler.js';
import { handleDeliveryRequest } from './src/worker/delivery-handler.js';
import { handleDeptTaskCreate, handleDeptTaskUpdate, createDeptTaskCore, DEPT_TASK_TAXONOMY, _authoritativeCheck, _verifyAccessCert } from './src/worker/dept-task-handler.js';
// 2026-07-14: 레거시 별칭 안전망 — HONDI_TIER_MODELS에 없는 model이
// 클라이언트에서 그대로 들어와도(레거시 호출 등) 여기서 한 번 더 정규화한다.
import { resolveDeepseekModel } from './src/gopang/core/deepseek-client.js';
// 2026-07-18 신설 — GDC 상거래 완성 계획서 Phase 4. src/profile2.0/ledger.js(M10)
// 는 이 저장소 어디서도 호출되지 않던 죽은 코드였다(2026-07-18 실사로 발견) —
// 순수 계산 함수만 재사용한다(marketPurchaseRPC/Supabase 관련 함수는 legacy라
// 가져오지 않는다. 정본은 이미 L1이므로 되살리지 않는다). 지금은
// reconstructBalances만 실제로 쓰지만, verifyBIVM/detectBalanceAnomalies도
// 향후 일괄 대사(batch reconciliation) 배치 작업에 바로 재사용 가능하다.
import { reconstructBalances } from './src/profile2.0/ledger.js';

const ALLOWED_ORIGINS = [
  'https://hondi.net',
  'https://www.hondi.net',
  // ── 전환 기간 병행 허용 (gopang.net → hondi.net 301 리다이렉트 완료 후 제거) ──
  'https://gopang.net',
  'https://www.gopang.net',
  'https://klaw.hondi.net',
  'https://market.hondi.net',
  'https://tax.hondi.net',
  'https://gdc.hondi.net',
  'https://health.hondi.net',
  'https://school.hondi.net',
  'https://public.hondi.net',
  'https://security.hondi.net',
  'https://democracy.hondi.net',
  'https://police.hondi.net',
  'https://insurance.hondi.net',
  'https://911.hondi.net',
  'https://stock.hondi.net',
  'https://traffic.hondi.net',
  'https://logistics.hondi.net',

  'https://users.hondi.net',
  'https://l1-hanlim.hondi.net',
  'https://jeju.hondi.net',
  'https://fiil.kr',
  'https://openhash.kr',
  'https://nounweb.github.io',
  'http://localhost',
  'http://127.0.0.1',
];


// ══════════════════════════════════════════════════════════════
// 2026-07-07 신설(제주 L1~L3 필드 테스트) — 43개 L1(읍면동) 노드맵
// jeju-l1-l3-field-test-plan-2026-07-07.md §2.4 참고: 노드마다 서브도메인/
// 인증서를 새로 만들지 않고, l1-hanlim.hondi.net 하나를 nginx 경로 기반
// 라우팅(/n/{folder} → 127.0.0.1:{port})으로 확장해 전부 처리한다.
const L1_BASE_HOST = 'https://l1-hanlim.hondi.net';
// 2026-07-08 신설: 서귀포시 관할 17개 읍면동(L1) 전용 물리 호스트.
// hanlim(AMD Micro, 1GB) 메모리 한계로 별도 서버로 이전(jeju-l1-l3
// 필드테스트 후속 조치). L2(l2-seogwipo)는 여전히 hanlim에 있음.
const SEOGWIPO_L1_BASE_HOST = 'https://seogwipo-l1-nodes.hondi.net';

const L1_NODE_MAP = {
  'KR-JEJU-JEJU-HANLIM':  L1_BASE_HOST, // 기존 그대로 — 이미 8091 직결
  'KR-JEJU-JEJU-SI':      L1_BASE_HOST + '/n/l2-jeju',
  'KR-JEJU-SGP-SI':       L1_BASE_HOST + '/n/l2-seogwipo',
  'KR-JEJU':              L1_BASE_HOST + '/n/l3-jejudo',
  'KR':                   'https://openhash-l4-kr.hondi.net', // 이번 계획 범위 밖(§10), 기존 값 유지
  'GLOBAL':               'https://openhash-l5-global.hondi.net', // 이번 계획 범위 밖(§10), 기존 값 유지
  // ── 43개 L1(읍면동) — provision-l1-nodes.py 생성분과 반드시 일치할 것 ──
  'KR-JEJU-JEJU-AEWOL': L1_BASE_HOST + '/n/l1-aewol',
  'KR-JEJU-JEJU-ARA': L1_BASE_HOST + '/n/l1-ara',
  'KR-JEJU-JEJU-BONGGAE': L1_BASE_HOST + '/n/l1-bonggae',
  'KR-JEJU-JEJU-CHUJA': L1_BASE_HOST + '/n/l1-chuja',
  'KR-JEJU-JEJU-DODU': L1_BASE_HOST + '/n/l1-dodu',
  'KR-JEJU-JEJU-GEONIP': L1_BASE_HOST + '/n/l1-geonip',
  'KR-JEJU-JEJU-GUJWA': L1_BASE_HOST + '/n/l1-gujwa',
  'KR-JEJU-JEJU-HANGYEONG': L1_BASE_HOST + '/n/l1-hangyeong',
  'KR-JEJU-JEJU-HWABUK': L1_BASE_HOST + '/n/l1-hwabuk',
  'KR-JEJU-JEJU-IDO1': L1_BASE_HOST + '/n/l1-ido1',
  'KR-JEJU-JEJU-IDO2': L1_BASE_HOST + '/n/l1-ido2',
  'KR-JEJU-JEJU-IHO': L1_BASE_HOST + '/n/l1-iho',
  'KR-JEJU-JEJU-ILDO1': L1_BASE_HOST + '/n/l1-ildo1',
  'KR-JEJU-JEJU-ILDO2': L1_BASE_HOST + '/n/l1-ildo2',
  'KR-JEJU-JEJU-JOCHEON': L1_BASE_HOST + '/n/l1-jocheon',
  'KR-JEJU-JEJU-NOHYEONG': L1_BASE_HOST + '/n/l1-nohyeong',
  'KR-JEJU-JEJU-OEDO': L1_BASE_HOST + '/n/l1-oedo',
  'KR-JEJU-JEJU-ORA': L1_BASE_HOST + '/n/l1-ora',
  'KR-JEJU-JEJU-SAMDO1': L1_BASE_HOST + '/n/l1-samdo1',
  'KR-JEJU-JEJU-SAMDO2': L1_BASE_HOST + '/n/l1-samdo2',
  'KR-JEJU-JEJU-SAMYANG': L1_BASE_HOST + '/n/l1-samyang',
  'KR-JEJU-JEJU-UDO': L1_BASE_HOST + '/n/l1-udo',
  'KR-JEJU-JEJU-YEONDONG': L1_BASE_HOST + '/n/l1-yeondong',
  'KR-JEJU-JEJU-YONGDAM1': L1_BASE_HOST + '/n/l1-yongdam1',
  'KR-JEJU-JEJU-YONGDAM2': L1_BASE_HOST + '/n/l1-yongdam2',
  'KR-JEJU-SGP-ANDEOK': SEOGWIPO_L1_BASE_HOST + '/n/l1-andeok',
  'KR-JEJU-SGP-CHEONJI': SEOGWIPO_L1_BASE_HOST + '/n/l1-cheonji',
  'KR-JEJU-SGP-DAECHEON': SEOGWIPO_L1_BASE_HOST + '/n/l1-daecheon',
  'KR-JEJU-SGP-DAEJEONG': SEOGWIPO_L1_BASE_HOST + '/n/l1-daejeong',
  'KR-JEJU-SGP-DAERYUN': SEOGWIPO_L1_BASE_HOST + '/n/l1-daeryun',
  'KR-JEJU-SGP-DONGHONG': SEOGWIPO_L1_BASE_HOST + '/n/l1-donghong',
  'KR-JEJU-SGP-HYODON': SEOGWIPO_L1_BASE_HOST + '/n/l1-hyodon',
  'KR-JEJU-SGP-JEONGBANG': SEOGWIPO_L1_BASE_HOST + '/n/l1-jeongbang',
  'KR-JEJU-SGP-JUNGANG-SGP': SEOGWIPO_L1_BASE_HOST + '/n/l1-jungang-sgp',
  'KR-JEJU-SGP-JUNGMUN': SEOGWIPO_L1_BASE_HOST + '/n/l1-jungmun',
  'KR-JEJU-SGP-NAMWON': SEOGWIPO_L1_BASE_HOST + '/n/l1-namwon',
  'KR-JEJU-SGP-PYOSEON': SEOGWIPO_L1_BASE_HOST + '/n/l1-pyoseon',
  'KR-JEJU-SGP-SEOHONG': SEOGWIPO_L1_BASE_HOST + '/n/l1-seohong',
  'KR-JEJU-SGP-SEONGSAN': SEOGWIPO_L1_BASE_HOST + '/n/l1-seongsan',
  'KR-JEJU-SGP-SONGSAN': SEOGWIPO_L1_BASE_HOST + '/n/l1-songsan',
  'KR-JEJU-SGP-YEONGCHEON': SEOGWIPO_L1_BASE_HOST + '/n/l1-yeongcheon',
  'KR-JEJU-SGP-YERAE': SEOGWIPO_L1_BASE_HOST + '/n/l1-yerae',
};
const L1_DEFAULT = 'https://l1-hanlim.hondi.net';
// L3(제주도 전체) — guid_home_l1 레지스트리(§4)의 단일 소스
const L3_BASE = L1_NODE_MAP['KR-JEJU'];

// 2026-07-07 신설: 시뮬레이션 중 /api/bridge-in이 무인증이라 대응하는
// bridge_out 없이도 임의 크레딧이 가능했던 걸 발견 — L1의 4개 브릿지
// 엔드포인트에 공유 비밀키를 추가했다. main.pb.js의 하드코딩값(개발 단계,
// MINT_SECRET과 동일 관례)과 반드시 일치해야 한다. 운영 전환 시
// env.BRIDGE_SECRET(wrangler secret)으로 교체할 것 — 지금은 개발 단계라
// 기본값 폴백을 둔다.
function _bridgeSecret(env) {
  return env.BRIDGE_SECRET || 'hondi-dev-bridge-2026';
}

// (2026-07-14: /api/ai-charge 인증용. MINT_SECRET/BRIDGE_SECRET과 동일
//  관례 — 운영 전환 시 env.AI_CHARGE_SECRET(wrangler secret)으로 교체할
//  것. main.pb.js의 AI_CHARGE_SECRET과 반드시 일치해야 한다.)
function _aiChargeSecret(env) {
  return env.AI_CHARGE_SECRET || 'hondi-dev-ai-charge-2026';
}

// (2026-07-14: L1 /api/mint 호출용. main.pb.js의 MINT_SECRET과 반드시
//  일치해야 한다 — 지금까지는 개발자가 curl로 직접 호출했지만, 충전
//  파이프라인 연결로 Worker(handleChargeConfirm)가 서버 대 서버로
//  처음 호출하게 됐다.)
function _mintSecret(env) {
  return env.MINT_SECRET || 'hondi-dev-mint-2026';
}

// (2026-07-14: GDC 충전 — "고정계좌 + 입금자명 매칭" 방식. PG·카드 배제
//  확정(사고실험 세션 2026-07-14 "혼디의 GDC 환전 및 판매 체계 설계"
//  참고) — 은행 API 없이 지금 코드만으로 구현 가능한 옵션을 택했다.
//  ⚠️ 아래 계좌번호는 플레이스홀더다 — 실제 배포 전 반드시
//  env.CHARGE_BANK_ACCOUNT_INFO(wrangler secret)로 실제 회사 계좌
//  정보로 교체할 것. 지금 값 그대로 배포하면 사용자가 존재하지 않는
//  계좌로 입금을 시도하게 된다.)
function _chargeBankAccountInfo(env) {
  return env.CHARGE_BANK_ACCOUNT_INFO || '(관리자 설정 필요) 은행명 미설정 / 계좌번호 미설정 / 예금주 미설정';
}

// (2026-07-14: 관리자 전용 액션 — /biz/charge-list, /biz/charge-confirm
//  인증. handlePushBroadcast의 DEPLOY_PUSH_SECRET과 동일 관례.)
function _adminActionSecret(env) {
  return env.ADMIN_ACTION_SECRET || 'hondi-dev-admin-2026';
}

// 입금자명(보내는 분 표시)에 사용자가 직접 포함시킬 짧은 매칭 코드.
// 은행 앱마다 "보내는 분 표시" 커스텀 입력 길이 제한이 다르므로
// (짧게는 10자 안팎) HD+6자리 숫자로 짧게 유지한다 — 완벽한 자동 대사가
// 아니라 관리자가 은행 명세서와 눈으로 대조할 때 쓰는 1차 단서일
// 뿐이므로, 충돌(같은 코드가 드물게 겹침) 가능성은 감수한다(낮은
// 트래픽 + 최종 확인은 관리자가 금액까지 함께 대조하므로 실질 위험 낮음).
function _generateChargeMatchCode() {
  const n = Math.floor(100000 + Math.random() * 900000); // 6자리
  return `HD${n}`;
}

const OPENAI_URL     = 'https://api.openai.com/v1/chat/completions';

// ── 전화번호 OTP (2026-07-15 신설, 솔라피 연동) ──────────────────
// env.SOLAPI_API_KEY / SOLAPI_API_SECRET / SOLAPI_SENDER_NUMBER /
// PHONE_VERIFY_SECRET = wrangler secret put 로 등록.
const SOLAPI_SEND_URL = 'https://api.solapi.com/messages/v4/send';
const OTP_TTL_SECONDS = 300;              // 5분
const OTP_MAX_ATTEMPTS = 5;
const OTP_RESEND_COOLDOWN_SECONDS = 60;   // 같은 번호 재발송 최소 간격
const PHONE_VERIFY_TOKEN_TTL_MS = 10 * 60 * 1000; // 검증 토큰 유효 10분

function _generateOtpCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

// ── 전화번호 정규화 (2026-07-21 신설) ────────────────────────────
// 클라이언트/curl 테스트마다 표기가 제각각이라(대시 포함, 국가번호
// 유무, 0 유무) 지금까지 딱 "+8201...부터 10~12자리"만 통과시키는
// 정규식 하나로 전부 거부해왔다. 실제로 통용되는 다음 표기를 전부
// 같은 번호로 인식해 내부 표준(+820...) 하나로 합친다:
//   "010-9662-7170"   (국내 표기, 대시/공백 포함)
//   "01096627170"     (국내 표기, 대시 없음)
//   "821096627170"    (국가번호만, 0 생략 — 통상적 E.164 관례)
//   "8201096627170"   (국가번호 + 0 유지 — 이 프로젝트 내부 표준)
//   "+8201096627170"  (위와 동일, + 유무는 무관)
// 반환값은 항상 "+820"로 시작하는 내부 표준 형식이거나, 형식이 끝내
// 안 맞으면 null (호출부에서 INVALID_PHONE 처리).
function _normalizePhoneE164(raw) {
  if (!raw) return null;
  let digits = String(raw).replace(/[^\d]/g, ''); // 대시·공백·+ 전부 제거
  if (!digits) return null;

  if (digits.startsWith('0')) {
    // 010-9662-7170 / 01096627170 → 82 붙이고 0은 그대로 유지
    digits = '82' + digits;
  } else if (digits.startsWith('82') && !digits.startsWith('820')) {
    // 821096627170 (0 생략된 통상 E.164) → 0을 다시 끼워넣는다
    digits = '820' + digits.slice(2);
  }
  // 이미 8201096627170 형식이면 위 두 분기 다 안 타고 그대로 통과

  const e164 = '+' + digits;
  return /^\+820\d{8,10}$/.test(e164) ? e164 : null;
}

async function _hmacSha256Hex(secret, message) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// 솔라피 HMAC-SHA256 인증 스킴으로 SMS 1건 발송.
async function _sendSolapiSms(env, toE164, text) {
  if (!env.SOLAPI_API_KEY || !env.SOLAPI_API_SECRET || !env.SOLAPI_SENDER_NUMBER) {
    throw new Error('SOLAPI 인증 정보가 설정되지 않았습니다(SOLAPI_API_KEY/SECRET/SENDER_NUMBER)');
  }
  const date = new Date().toISOString();
  const salt = crypto.randomUUID();
  const signature = await _hmacSha256Hex(env.SOLAPI_API_SECRET, date + salt);
  const to = toE164.replace(/^\+82/, ''); // '+820XXXXXXXXX' → '0XXXXXXXXX'(국내 포맷)

  const res = await fetch(SOLAPI_SEND_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `HMAC-SHA256 apiKey=${env.SOLAPI_API_KEY}, date=${date}, salt=${salt}, signature=${signature}`,
    },
    body: JSON.stringify({ message: { to, from: env.SOLAPI_SENDER_NUMBER, text } }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.errorMessage || data?.message || `SOLAPI HTTP ${res.status}`);
  return data;
}

// POST /biz/phone-otp-request { e164 } — SMS로 6자리 코드 발송.
async function handlePhoneOtpRequest(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const e164 = _normalizePhoneE164(body.e164);
  if (!e164) {
    return _err(400, 'INVALID_PHONE', '올바른 국내 전화번호 형식이 아닙니다', corsHeaders);
  }
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', 'OTP 저장소가 설정되지 않았습니다', corsHeaders);

  const cooldownKey = `otp_cd:${e164}`;
  if (await env.QR_SESSIONS_KV.get(cooldownKey)) {
    return _err(429, 'OTP_COOLDOWN', `잠시 후(${OTP_RESEND_COOLDOWN_SECONDS}초) 다시 시도해 주세요`, corsHeaders);
  }

  const code = _generateOtpCode();
  const otpKey = `otp:${e164}`;
  await env.QR_SESSIONS_KV.put(otpKey, JSON.stringify({ code, attempts: 0 }), { expirationTtl: OTP_TTL_SECONDS });
  await env.QR_SESSIONS_KV.put(cooldownKey, '1', { expirationTtl: OTP_RESEND_COOLDOWN_SECONDS });

  try {
    // ── WebOTP API 연동 (2026-07-21 신설) ────────────────────────────
    // 문자 본문 맨 끝에 "@도메인 #코드" 형식의 태그를 붙이면, 안드로이드
    // Chrome이 SMS 도착을 감지해 브라우저가 자동으로 입력창에 코드를
    // 채워준다(navigator.credentials.get({otp:...}) — 클라이언트 쪽은
    // src/gopang/core/auth.js에서 처리). 이러면 사용자가 문자 앱으로
    // 아예 나갈 필요가 없어져서, 이탈로 인한 문제(예: prompt() 강제
    // 종료 사고, 2026-07-21 실사로 발견)가 원천적으로 없어진다. 태그는
    // 반드시 메시지 맨 끝 줄이어야 하고, 그 뒤에 다른 텍스트가 있으면
    // 안 된다(WebOTP 표준 요구사항).
    await _sendSolapiSms(env, e164,
      `[혼디] 인증번호는 ${code}입니다. ${Math.floor(OTP_TTL_SECONDS / 60)}분 이내에 입력해 주세요.\n\n@hondi.net #${code}`);
  } catch (e) {
    console.warn('[PhoneOTP] SOLAPI 발송 실패:', e.message);
    return _err(502, 'SMS_SEND_FAILED', '인증번호 발송에 실패했습니다: ' + e.message, corsHeaders);
  }

  return new Response(JSON.stringify({ ok: true, expires_in: OTP_TTL_SECONDS }), { status: 200, headers: corsHeaders });
}

// POST /biz/phone-otp-verify { e164, code, guid? } — 성공 시 서명된 검증
// 토큰 발급. 이 토큰은 두 곳에서 재검증된다: (1) pb_hooks/main.pb.js의
// onRecordBeforeCreateRequest(신규 profiles 생성 시, e164만 있으면 됨),
// (2) worker.js의 handleProfileClaim(미청구 프로필 claim 시, guid 바인딩
// 필수 — 2026-07-18 신설). 두 소비처의 요구가 달라 guid는 선택 필드다.
async function handlePhoneOtpVerify(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { e164, code, guid } = body;
  if (!e164 || !code) return _err(400, 'MISSING_FIELD', 'e164, code 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', 'OTP 저장소가 설정되지 않았습니다', corsHeaders);
  if (!env.PHONE_VERIFY_SECRET) return _err(500, 'SECRET_NOT_SET', 'PHONE_VERIFY_SECRET이 설정되지 않았습니다', corsHeaders);

  const otpKey = `otp:${e164}`;
  const raw = await env.QR_SESSIONS_KV.get(otpKey);
  if (!raw) return _err(400, 'OTP_EXPIRED', '인증번호가 만료됐거나 요청 이력이 없습니다', corsHeaders);

  const record = JSON.parse(raw);
  if (record.attempts >= OTP_MAX_ATTEMPTS) {
    await env.QR_SESSIONS_KV.delete(otpKey);
    return _err(429, 'OTP_TOO_MANY_ATTEMPTS', '시도 횟수를 초과했습니다. 다시 요청해 주세요', corsHeaders);
  }

  if (String(code).trim() !== record.code) {
    record.attempts += 1;
    await env.QR_SESSIONS_KV.put(otpKey, JSON.stringify(record), { expirationTtl: OTP_TTL_SECONDS });
    return _err(400, 'OTP_MISMATCH', `인증번호가 일치하지 않습니다(남은 시도 ${OTP_MAX_ATTEMPTS - record.attempts}회)`, corsHeaders);
  }

  await env.QR_SESSIONS_KV.delete(otpKey);

  const exp = Date.now() + PHONE_VERIFY_TOKEN_TTL_MS;
  // 2026-07-18: guid가 있으면(claim 흐름) 서명 대상에 포함해 토큰을 그
  // 프로필에 바인딩한다 — 동일 전화번호로 등록된 다른 unclaimed 프로필에
  // 재사용되는 것을 막기 위함(guid 없는 2-필드 토큰은 handleProfileClaim이
  // 거부한다). e164에는 콜론이 없고(형식 검증됨) exp는 항상 마지막
  // 필드이므로 guid 자체에 콜론이 섞여 있어도 파싱 시 안전하다.
  const payload = guid ? `${e164}:${guid}:${exp}` : `${e164}:${exp}`;
  const signature = await _hmacSha256Hex(env.PHONE_VERIFY_SECRET, payload);
  // 2026-07-15: btoa() 제거 — L1 PocketBase v0.22.14 JSVM에 base64
  // 디코더가 없음을 실제 바이너리로 검증. payload는 이미 안전한
  // 문자(전화번호 숫자/+, 콜론, 타임스탬프 숫자, guid)만 포함해 인코딩이
  // 애초에 불필요했다.
  const token = payload + '.' + signature;

  return new Response(JSON.stringify({
    ok: true, phone_verify_token: token, expires_at: new Date(exp).toISOString(),
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 기기 간 지갑 이전(device-link) — 2026-07-20 신설
//
// 목표: PC가 폰과 "완전히 같은 개인키"를 갖게 한다(은행 온라인뱅킹과
// 동일한 사용성). QR 스캔 로그인은 이미 폐기됐고(주피터 지시, 가입 시점
// SMS 인증만이 유일한 본인 인증 경로), 그렇다고 매 로그인마다 SMS를
// 또 보내면 비용이 로그인 빈도만큼 계속 나간다. 그래서 이 흐름은 SMS를
// 전혀 쓰지 않는다 — 이미 로그인된 폰에 무료 웹푸시로 알리고, 폰 화면에
// 뜨는 짧은 코드를 PC에 입력받아 페어링을 증명한 뒤, 개인키 자체는
// gopang-wallet.js의 기존 X25519 봉투 암호화(sealForRecipient/openSealed
// — 이미 있는 함수, 새로 안 만듦)로 암호화해 전달한다. 서버는 암호화된
// 덩어리만 중계할 뿐 평문 개인키를 한 번도 보지 않는다.
//
// 세션 상태 전이: pending(코드 발급) → approved(PC가 코드 맞춤,
// 폰이 봉투를 보내도 되는 시점) → delivered(폰이 봉투 전송 완료,
// PC가 poll로 가져가면 즉시 삭제).
//
// 저장소는 phone-otp와 동일한 env.QR_SESSIONS_KV를 그대로 쓴다(짧은
// TTL의 임시 레코드라는 성격이 완전히 동일 — 별도 KV 바인딩 불필요).
// ═══════════════════════════════════════════════════════════
const DEVICE_LINK_TTL_SECONDS = 90;      // 코드 유효기간 — SMS(5분)보다 훨씬 짧게(사용자 지시)
const DEVICE_LINK_MAX_ATTEMPTS = 5;

// ── 2026-07-20 신설: 웹푸시 실패 시 SMS 폴백(1안 웹푸시·2안 SMS) ──
// 사고실험(주피터 지시)에서 발견한 위험 6가지를 반영:
// ① TTL 불일치로 SMS 도착 전 세션 만료 → SMS 요청 시 세션 TTL을
//    OTP와 동일한 5분으로 연장.
// ② 타인 번호로 SMS를 반복 유발하는 DoS/괴롭힘 벡터 → 전화번호별
//    시간당 발송 횟수 제한(기존 OTP와 별도 카운터, 동일 원리).
// ④ "문자로 받기"가 새 세션을 만들면 웹푸시 코드와 SMS 코드가
//    달라져 혼란 → 기존 sessionId·code 그대로, SMS만 재발송.
// ⑤ 버튼 연타로 인한 과다 발송 → 세션당 재발송 횟수 제한(최대 2회).
// (③·⑥은 서버가 아니라 PC 쪽 UI 설계로 대응 — device-link.html 참고)
const DEVICE_LINK_SMS_TTL_SECONDS = 300;       // OTP와 동일 — SMS 지연 감안
const DEVICE_LINK_SMS_MAX_RESEND = 2;          // 세션당 SMS 재발송 최대 횟수
const DEVICE_LINK_SMS_RATE_LIMIT_PER_HOUR = 3; // 전화번호당 시간당 최대 발송
const DEVICE_LINK_SMS_RATE_WINDOW_SECONDS = 3600;

function _generateDeviceLinkCode() {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(100000 + (buf[0] % 900000));
}

// ★ 사고실험 ①에서 발견한 버그의 근본 수정: verify/deliver가 레코드를
// 재기록할 때마다 무조건 90초 TTL로 되돌리면, SMS로 5분 연장한 게
// 다음 단계에서 조용히 원상복구돼 버린다. 재기록 시엔 항상 이 함수로
// "SMS를 이미 썼는지"를 보고 TTL을 정한다.
function _deviceLinkTtl(record) {
  return (record.smsResendCount || 0) > 0 ? DEVICE_LINK_SMS_TTL_SECONDS : DEVICE_LINK_TTL_SECONDS;
}

// L1 profiles 컬렉션에서 e164(전화번호)로 레코드 조회 — device-link 전용
// 신설. _l1FindProfileByGuid/_l1FindProfileByHandle과 동일 패턴.
async function _l1FindProfileByE164(env, e164) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`e164='${e164}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

// POST /auth/device-link/init { e164, pcPubKeyB64u?, pcLabel?, purpose?, sigMsg? }
// PC가 호출 — 그 번호로 등록된 계정(guid)에 웹푸시로 페어링/서명 요청을 보낸다.
//
// purpose (2026-07-23 신설, 기본값 'key_transfer' — 이전 호출부와 완전
// 하위호환):
//   - 'key_transfer': 기존과 동일. PC가 이 세션을 통해 개인키 자체를
//     X25519 봉투로 전달받는다(전용 PC — 다음부터 폰 없이 로그인).
//     pcPubKeyB64u 필수.
//   - 'sign_request' : PC가 개인키를 받지 않고, 특정 payload(sigMsg)에
//     대한 서명 '결과'만 1회성으로 요청한다(공용 PC — 세션에 아무것도
//     남기지 않음). sigMsg 필수, pcPubKeyB64u는 불필요.
async function handleDeviceLinkInit(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { pcPubKeyB64u, pcLabel, sigMsg } = body;
  const purpose = body.purpose === 'sign_request' ? 'sign_request' : 'key_transfer'; // 미지정/그외 값은 안전하게 기존 동작으로
  const e164 = _normalizePhoneE164(body.e164);
  if (!e164) {
    return _err(400, 'INVALID_PHONE', '올바른 국내 전화번호 형식이 아닙니다', corsHeaders);
  }

  if (purpose === 'key_transfer') {
    if (!pcPubKeyB64u) return _err(400, 'MISSING_FIELD', 'pcPubKeyB64u 필수', corsHeaders);
    // ★ 2026-07-20 신설 — 실사로 발견: 이 값이 32바이트(X25519 raw 공개키
    // 크기)가 아닌 채로 저장되면, 폰이 나중에 sealForRecipient()에서
    // "X25519 key data must be 256 bits"라는 암호화 단계 에러로만 마주치게
    // 되어 원인을 찾기 매우 어려웠다(USB 디버깅 여러 번 시도 끝에 겨우
    // 발견). 여기서 미리 길이를 검증해 애초에 나쁜 값이 세션에 저장조차
    // 안 되게 막는다 — 문제가 있으면 PC가 요청하는 순간 바로 명확한
    // 에러를 받는다.
    try {
      if (_b64uToBytes(pcPubKeyB64u).length !== 32) {
        return _err(400, 'INVALID_PC_PUBKEY',
          `pcPubKeyB64u는 32바이트(X25519 공개키)여야 합니다 — 받은 길이: ${_b64uToBytes(pcPubKeyB64u).length}바이트`,
          corsHeaders);
      }
    } catch (e) {
      return _err(400, 'INVALID_PC_PUBKEY', 'pcPubKeyB64u가 올바른 Base64URL 형식이 아닙니다: ' + e.message, corsHeaders);
    }
  } else {
    // sign_request
    if (!sigMsg || typeof sigMsg !== 'string') {
      return _err(400, 'MISSING_FIELD', 'sigMsg(서명 대상 문자열) 필수', corsHeaders);
    }
    // 서명 요청은 페이로드가 임의 길이일 수 있어 과도한 크기를 미리 막는다
    // (푸시 payload·KV 값 크기 제한 보호 — 실제 서명 대상은 보통 해시라
    // 이 한도면 충분하고 넘으면 호출부 실수로 본다).
    if (sigMsg.length > 4096) {
      return _err(400, 'SIGMSG_TOO_LARGE', 'sigMsg가 너무 깁니다(4096자 초과)', corsHeaders);
    }
  }
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  let profile;
  try {
    profile = await _l1FindProfileByE164(env, e164);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!profile) return _err(404, 'PHONE_NOT_REGISTERED', '이 번호로 등록된 계정이 없습니다', corsHeaders);

  const sessionId = crypto.randomUUID();
  const code = _generateDeviceLinkCode();
  const record = {
    guid: profile.guid, e164, purpose,
    pcPubKeyB64u: purpose === 'key_transfer' ? pcPubKeyB64u : null,
    sigMsg: purpose === 'sign_request' ? sigMsg : null,
    pcLabel: pcLabel || '알 수 없는 기기',
    code, attempts: 0, state: 'pending', smsResendCount: 0,
  };
  await env.QR_SESSIONS_KV.put(`devlink:${sessionId}`, JSON.stringify(record), { expirationTtl: DEVICE_LINK_TTL_SECONDS });

  // 웹푸시로 폰을 깨운다(SMS 아님 — 비용 없음). 코드 자체는 푸시 payload에
  // 담지 않는다 — 알림을 열어 앱(자기 guid)으로 조회해야만 코드가 보이게
  // 해서, 푸시를 가로챈 제3자가 코드까지 얻는 걸 한 단계 더 막는다.
  //
  // ★ 사고실험 ③에서 발견: push_subscription이 있어도 구독이 만료됐거나
  // (410 Gone) 알림 권한이 나중에 꺼졌으면 발송이 조용히 실패할 수 있다.
  // 이걸 PC가 알 방법이 없으면 사용자는 영원히 기다리게 된다 — 그래서
  // "성공했다"고 확신할 수 있을 때만 pushSent:true를 내려주고, PC는
  // 이 값과 무관하게 "문자로 받기" 링크를 항상 노출하되(§3 원칙),
  // pushSent:false면 그 즉시 강조해서 보여준다.
  let pushSent = false;
  try {
    if (env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY && env.VAPID_SUBJECT) {
      const fresh = await _l1FindProfileByGuid(env, profile.guid).catch(() => null);
      if (fresh?.push_subscription) {
        const sub = JSON.parse(fresh.push_subscription);
        const payload = JSON.stringify({
          title: purpose === 'sign_request' ? '서명 요청' : '새 기기에서 로그인 요청',
          body:  purpose === 'sign_request'
            ? `${record.pcLabel}에서 서명을 요청했습니다. 확인하려면 누르세요.`
            : `${record.pcLabel}에서 로그인을 시도했습니다. 확인하려면 누르세요.`,
          sound: fresh.push_sound || 'ping',
          url:   `/auth/device-link-approve.html?sessionId=${encodeURIComponent(sessionId)}`,
          tag:   `gopang-device-link-${sessionId}`,
        });
        await _sendWebPush(env, sub, payload);
        pushSent = true;
      }
    }
  } catch (e) {
    console.warn('[DeviceLink] 푸시 발송 실패(치명적 아님 — SMS 폴백으로 계속 진행 가능):', e.message);
  }

  return new Response(JSON.stringify({
    ok: true, sessionId, expires_in: DEVICE_LINK_TTL_SECONDS, pushSent,
  }), { status: 200, headers: corsHeaders });
}

// POST /auth/device-link/resend-sms { sessionId }
// PC가 호출 — 같은 세션·같은 코드를 SMS로도 보낸다(새 세션 생성 안 함,
// 사고실험 ④). 다음을 전부 확인한 뒤에만 발송한다:
//  1) 세션 존재·pending 상태(이미 approved/delivered면 의미 없음)
//  2) 세션당 재발송 횟수(사고실험 ⑤ — 버튼 연타 방지)
//  3) 전화번호당 시간당 발송 횟수(사고실험 ② — DoS/괴롭힘 방지)
// 성공 시 세션 TTL을 OTP와 동일한 5분으로 연장한다(사고실험 ① —
// SMS는 웹푸시보다 늦게 올 수 있어, 90초 TTL로는 도착 전에 만료될
// 위험이 있었다).
async function handleDeviceLinkResendSms(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { sessionId } = body;
  if (!sessionId) return _err(400, 'MISSING_FIELD', 'sessionId 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  const key = `devlink:${sessionId}`;
  const raw = await env.QR_SESSIONS_KV.get(key);
  if (!raw) return _err(404, 'SESSION_EXPIRED', '세션이 만료됐거나 존재하지 않습니다', corsHeaders);
  const record = JSON.parse(raw);

  if (record.state !== 'pending') {
    return _err(409, 'ALREADY_PROGRESSED', '이미 진행된 세션입니다', corsHeaders);
  }
  if ((record.smsResendCount || 0) >= DEVICE_LINK_SMS_MAX_RESEND) {
    return _err(429, 'TOO_MANY_RESENDS', '문자 재발송 횟수를 초과했습니다. 처음부터 다시 시도해 주세요', corsHeaders);
  }

  // 전화번호당 시간당 발송 제한 — 타인 번호로 반복 요청해 문자 폭탄을
  // 유발하는 걸 막는다(웹푸시와 달리 SMS는 회사에 실제 비용이 나간다).
  const rlKey = `devlink_sms_rl:${record.e164}`;
  const rlRaw = await env.QR_SESSIONS_KV.get(rlKey);
  const rlCount = rlRaw ? parseInt(rlRaw, 10) || 0 : 0;
  if (rlCount >= DEVICE_LINK_SMS_RATE_LIMIT_PER_HOUR) {
    return _err(429, 'PHONE_RATE_LIMITED', '이 번호로 문자를 너무 많이 요청했습니다. 잠시 후 다시 시도해 주세요', corsHeaders);
  }

  const approveUrl = `https://hondi.net/auth/device-link-approve.html?sessionId=${encodeURIComponent(sessionId)}`;
  try {
    await _sendSolapiSms(env, record.e164,
      `[혼디] PC 로그인 확인: ${approveUrl} (${Math.floor(DEVICE_LINK_SMS_TTL_SECONDS / 60)}분 이내)`);
  } catch (e) {
    console.warn('[DeviceLink] SMS 발송 실패:', e.message);
    return _err(502, 'SMS_SEND_FAILED', '문자 발송에 실패했습니다: ' + e.message, corsHeaders);
  }

  record.smsResendCount = (record.smsResendCount || 0) + 1;
  await env.QR_SESSIONS_KV.put(key, JSON.stringify(record), { expirationTtl: DEVICE_LINK_SMS_TTL_SECONDS });
  await env.QR_SESSIONS_KV.put(rlKey, String(rlCount + 1), { expirationTtl: DEVICE_LINK_SMS_RATE_WINDOW_SECONDS });

  return new Response(JSON.stringify({ ok: true, expires_in: DEVICE_LINK_SMS_TTL_SECONDS }), { status: 200, headers: corsHeaders });
}

// GET /auth/device-link/session?sessionId=...&guid=...
// 폰이 호출 — 자신의 guid가 이 세션의 소유자와 일치할 때만 코드를 보여준다.
async function handleDeviceLinkSession(request, env, corsHeaders) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  const guid = url.searchParams.get('guid');
  if (!sessionId || !guid) return _err(400, 'MISSING_FIELD', 'sessionId, guid 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  const raw = await env.QR_SESSIONS_KV.get(`devlink:${sessionId}`);
  if (!raw) return _err(404, 'SESSION_EXPIRED', '세션이 만료됐거나 존재하지 않습니다', corsHeaders);
  const record = JSON.parse(raw);
  if (record.guid !== guid) return _err(403, 'GUID_MISMATCH', '이 세션의 소유자가 아닙니다', corsHeaders);

  return new Response(JSON.stringify({
    ok: true, state: record.state, code: record.code, pcLabel: record.pcLabel,
    pcPubKeyB64u: record.pcPubKeyB64u,
    purpose: record.purpose || 'key_transfer', // 2026-07-23 신설 — 이전 세션 레코드엔 없을 수 있어 기본값 보정
    sigMsg: record.sigMsg || null,
  }), { status: 200, headers: corsHeaders });
}

// POST /auth/device-link/verify { sessionId, code }
// PC가 호출 — 폰 화면의 코드를 맞게 입력했는지 확인.
async function handleDeviceLinkVerify(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { sessionId, code } = body;
  if (!sessionId || !code) return _err(400, 'MISSING_FIELD', 'sessionId, code 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  const key = `devlink:${sessionId}`;
  const raw = await env.QR_SESSIONS_KV.get(key);
  if (!raw) return _err(404, 'SESSION_EXPIRED', '세션이 만료됐거나 존재하지 않습니다', corsHeaders);
  const record = JSON.parse(raw);

  if (record.attempts >= DEVICE_LINK_MAX_ATTEMPTS) {
    await env.QR_SESSIONS_KV.delete(key);
    return _err(429, 'TOO_MANY_ATTEMPTS', '시도 횟수를 초과했습니다. 처음부터 다시 시도해 주세요', corsHeaders);
  }
  if (String(code).trim() !== record.code) {
    record.attempts += 1;
    await env.QR_SESSIONS_KV.put(key, JSON.stringify(record), { expirationTtl: _deviceLinkTtl(record) });
    return _err(400, 'CODE_MISMATCH', `코드가 일치하지 않습니다(남은 시도 ${DEVICE_LINK_MAX_ATTEMPTS - record.attempts}회)`, corsHeaders);
  }

  record.state = 'approved';
  await env.QR_SESSIONS_KV.put(key, JSON.stringify(record), { expirationTtl: _deviceLinkTtl(record) });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

// POST /auth/device-link/deliver { sessionId, guid, sealed? } (key_transfer)
//  또는  { sessionId, guid, signature, publicKeyB64u } (sign_request)
// 폰이 호출 — code가 이미 approved된 세션에만, 자기 guid가 그 세션
// 소유자와 일치할 때만 결과(key_transfer=봉투/sign_request=서명)를 넘긴다.
async function handleDeviceLinkDeliver(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { sessionId, guid, sealed, signature, publicKeyB64u } = body;
  if (!sessionId || !guid) return _err(400, 'MISSING_FIELD', 'sessionId, guid 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  const key = `devlink:${sessionId}`;
  const raw = await env.QR_SESSIONS_KV.get(key);
  if (!raw) return _err(404, 'SESSION_EXPIRED', '세션이 만료됐거나 존재하지 않습니다', corsHeaders);
  const record = JSON.parse(raw);
  if (record.guid !== guid) return _err(403, 'GUID_MISMATCH', '이 세션의 소유자가 아닙니다', corsHeaders);
  if (record.state !== 'approved') return _err(409, 'NOT_APPROVED', 'PC가 아직 코드를 확인하지 않았습니다', corsHeaders);

  const purpose = record.purpose || 'key_transfer';
  if (purpose === 'sign_request') {
    if (!signature || !publicKeyB64u) {
      return _err(400, 'MISSING_FIELD', 'signature, publicKeyB64u 필수(sign_request)', corsHeaders);
    }
    record.signature = signature;
    record.publicKeyB64u = publicKeyB64u;
  } else {
    if (!sealed) return _err(400, 'MISSING_FIELD', 'sealed 필수(key_transfer)', corsHeaders);
    record.sealed = sealed;
  }

  record.state = 'delivered';
  // PC가 가져갈 시간만 짧게 더 준다 — 폰이 봉투를 보낸 뒤에도 무기한
  // 남아있으면 안 되므로(암호화된 봉투라도 최소한으로만 존재).
  // ★ 2026-07-22 버그 수정 — 실사로 확인된 근본 원인: Cloudflare Workers
  // KV는 expirationTtl 60초 미만을 아예 거부한다("Invalid expiration_ttl
  // of 30. Expiration TTL must be at least 60."). 30초로 넣는 순간 KV
  // PUT 자체가 400으로 예외를 던졌고, 그 처리되지 않은 예외가 deliver
  // 핸들러 전체를 깨뜨려 클라이언트에서는 "Failed to fetch"(네트워크
  // 레벨 실패처럼 보이는 응답 없는 실패)로 나타났다 — 재시도를 아무리
  // 해도 매번 100% 확정적으로 실패할 수밖에 없었던 이유. 60초(KV 최소값)
  // 로 수정.
  await env.QR_SESSIONS_KV.put(key, JSON.stringify(record), { expirationTtl: 60 });
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

// GET /auth/device-link/poll?sessionId=...
// PC가 호출 — 봉투가 도착했는지 짧은 간격으로 확인. 가져가면 즉시 삭제
// (재사용 방지 — 한 세션당 봉투는 한 번만 소비된다).
async function handleDeviceLinkPoll(request, env, corsHeaders) {
  const url = new URL(request.url);
  const sessionId = url.searchParams.get('sessionId');
  if (!sessionId) return _err(400, 'MISSING_FIELD', 'sessionId 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  const key = `devlink:${sessionId}`;
  const raw = await env.QR_SESSIONS_KV.get(key);
  if (!raw) return new Response(JSON.stringify({ ok: true, state: 'expired' }), { status: 200, headers: corsHeaders });
  const record = JSON.parse(raw);

  if (record.state === 'delivered') {
    await env.QR_SESSIONS_KV.delete(key);
    const purpose = record.purpose || 'key_transfer';
    const payload = { ok: true, state: 'delivered', purpose };
    if (purpose === 'sign_request') {
      payload.signature = record.signature;
      payload.publicKeyB64u = record.publicKeyB64u;
      // 공용 PC 세션은 로컬에 계정 정보를 전혀 안 남기므로, 이 세션이
      // "누구"의 서명인지 알 방법이 이것뿐이다 — 개인키가 아니라 guid만
      // (이미 공개적으로 조회 가능한 식별자) 돌려준다.
      payload.guid = record.guid;
    } else {
      payload.sealed = record.sealed;
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, state: record.state }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// PDV 원문 릴레이 (PC → 폰) — 2026-07-23 신설, 5단계
//
// device-link와 방향이 반대다: 거기선 폰이 보내고 PC가 받는데, 여기선
// PC가 보내고 폰이 받는다. PC는 이미 콘텐츠를 갖고 있고 즉시 보낼 수
// 있으므로 pending→approved 같은 승인 단계가 필요 없다 — PC가 폰의
// X25519 공개키(GET /wallet/x25519, 이미 공개된 정보)로 그 자리에서
// 암호화해 바로 push하면 끝이다. 서버는 암호화된 덩어리만 중계하고
// 내용을 볼 수 없다(device-link와 동일 원칙).
//
// B안(주피터 지시) — 폰이 오프라인이면 유실을 감수한다: 큐를 무기한
// 쌓아두지 않고 짧은 TTL(10분)만 준다. "PDV 원문은 서버에 오래 남지
// 않는다"는 원칙과, 무한정 쌓이는 걸 막는 것 둘 다를 위해서다.
//
// pull 인증 수준: 이 엔드포인트는 guid만으로 조회를 허용한다(폰이 진짜
// 서명해서 증명하지 않음) — 하지만 저장된 내용 자체가 이미 그 폰의
// X25519 개인키로만 열 수 있게 암호화돼 있으므로, guid를 안다고 해서
// 내용을 읽을 수 있는 건 아니다(기밀성은 암호화가 보장, 접근제어는
// 아님). 얻을 수 있는 최대 정보는 "그 guid 앞으로 대기 중인 항목이
// 있다/크기가 얼마다" 정도의 메타데이터뿐이다.
const PDV_RELAY_TTL_SECONDS  = 600;   // 10분 — B안: 폰이 그 안에 안 오면 유실
const PDV_RELAY_MAX_ITEMS    = 20;    // KV 값 크기 보호 — 무한 적체 방지

// POST /pdv/relay/push { guid, sealed }
// PC가 호출 — 이미 GopangWallet.sealForRecipient(폰의 x25519_pubkey, ...)로
// 암호화한 원문 1건을 그 guid의 대기열에 추가한다.
async function handlePdvRelayPush(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, sealed } = body;
  if (!guid || !sealed) return _err(400, 'MISSING_FIELD', 'guid, sealed 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  const key = `pdvrelay:${guid}`;
  let queue = [];
  try {
    const raw = await env.QR_SESSIONS_KV.get(key);
    if (raw) queue = JSON.parse(raw);
    if (!Array.isArray(queue)) queue = [];
  } catch (e) { queue = []; }

  queue.push({ sealed, ts: Date.now() });
  if (queue.length > PDV_RELAY_MAX_ITEMS) {
    // 오래된 것부터 버린다 — 한도를 넘기면 어차피 폰이 한동안 안 켜진
    // 상태라는 뜻이라, 최신 것 위주로 남기는 게 더 유용하다.
    queue = queue.slice(queue.length - PDV_RELAY_MAX_ITEMS);
  }
  await env.QR_SESSIONS_KV.put(key, JSON.stringify(queue), { expirationTtl: PDV_RELAY_TTL_SECONDS });

  // 웹푸시로 폰에 알린다 — 실패해도(구독 없음 등) push 자체는 이미
  // 큐에 들어갔으니 계속 진행한다(device-link와 달리 이건 폰이 오면
  // 언제든 가져갈 수 있는 큐라, 지금 당장 못 깨워도 치명적이지 않다).
  try {
    if (env.VAPID_PRIVATE_KEY && env.VAPID_PUBLIC_KEY && env.VAPID_SUBJECT) {
      const profile = await _l1FindProfileByGuid(env, guid).catch(() => null);
      if (profile?.push_subscription) {
        const sub = JSON.parse(profile.push_subscription);
        await _sendWebPush(env, sub, JSON.stringify({
          title: '공용 PC에서 보낸 내용',
          body:  '공용 PC 세션에서 남긴 내용이 있습니다. 열어서 확인하세요.',
          sound: profile.push_sound || 'ping',
          url:   '/webapp.html',
          tag:   `gopang-pdv-relay-${guid}`,
        }));
      }
    }
  } catch (e) {
    console.warn('[PdvRelay] 푸시 발송 실패(치명적 아님):', e.message);
  }

  return new Response(JSON.stringify({ ok: true, queued: queue.length, expires_in: PDV_RELAY_TTL_SECONDS }),
    { status: 200, headers: corsHeaders });
}

// GET /pdv/relay/pull?guid=...
// 폰이 호출 — 대기 중인 항목을 전부 가져가고 큐를 비운다(1회 소비).
async function handlePdvRelayPull(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);

  const key = `pdvrelay:${guid}`;
  const raw = await env.QR_SESSIONS_KV.get(key);
  if (!raw) return new Response(JSON.stringify({ ok: true, items: [] }), { status: 200, headers: corsHeaders });

  await env.QR_SESSIONS_KV.delete(key); // 1회 소비 — 재사용 방지
  let queue = [];
  try { queue = JSON.parse(raw); if (!Array.isArray(queue)) queue = []; } catch (e) { queue = []; }

  return new Response(JSON.stringify({ ok: true, items: queue.map(q => q.sealed) }),
    { status: 200, headers: corsHeaders });
}

const DEEPSEEK_URL   = 'https://api.deepseek.com/v1/chat/completions';
// OpenRouter — Worker 내부 AI 호출 (내부 Agent, 피드백 분류 등)
// 클라이언트가 OR 키로 직접 OR에 접속하는 것과 별개.
// env.OPENROUTER_API_KEY = wrangler secret put OPENROUTER_API_KEY 로 등록.
const OR_URL         = 'https://openrouter.ai/api/v1/chat/completions';
const OR_MODEL_FAST  = 'deepseek/deepseek-v4-flash:free'; // 내부용 경량 모델 (v4-flash)
const OR_MODEL_THINK = 'deepseek/deepseek-r1:free';           // 추론 필요 시
const KAKAO_BASE     = 'https://dapi.kakao.com/v2/local/geo/coord2address.json';
const OPENAI_MODEL   = 'gpt-4o-mini';
const DEEPSEEK_MODEL = 'deepseek-v4-flash'; // ★ 2026-07-16 정정 — 기존 값 'deepseek/deepseek-r1:free'는
// OpenRouter 네임스페이스 형식(deepseek/...:free)이었는데 이 상수는 DEEPSEEK_URL(api.deepseek.com
// 직접 API)에도 쓰인다 — 그쪽엔 그 네임스페이스가 안 먹는다(순정 모델ID만 받음). 게다가 r1은
// 레거시 별칭 폐기(2026-07-24, 7일 앞)와 무관하게 이미 잘못된 모델을 가리키고 있었다.
// HONDI_TIER_MODELS(아래)·src/profile2.0/ai_setup_worker.js는 이미 'deepseek-v4-flash'로
// 맞춰져 있었는데 이 상수만 예전 값으로 남아 있던 걸 발견해 통일한다(주피터님 지시:
// "LLM은 디폴트로 deepseek v4 flash로 상정").
// ══════════════════════════════════════════════════════════
// 혼디 제공 무료 기본 키(deepseek-default) — Flash/Pro 티어 + 비용 산정
// ══════════════════════════════════════════════════════════
//
// [자체 서버 전환 설계 — 2026-07-01]
// 현재는 두 티어 모두 api.deepseek.com(공식 API)을 그대로 호출하며,
// "혼디 Flash"="deepseek-chat"(비사고), "혼디 Pro"="deepseek-reasoner"(사고)
// 라는 모델 파라미터 차이만으로 구분한다. 나중에 혼디 자체 GPU 추론 서버
// (한국어 파인튜닝 패치 모델)가 준비되면, 아래 두 시크릿만 등록하면 자동
// 전환된다 — 클라이언트 코드는 전혀 안 건드려도 됨:
//   wrangler secret put HONDI_SELFHOST_URL       (예: https://infer.hondi.net/v1/chat/completions)
//   wrangler secret put HONDI_SELFHOST_API_KEY
// 두 시크릿이 모두 설정되면 자체 서버로, 아니면 지금처럼 공식 API로 나간다.
// 자체 서버의 실제 모델 파라미터명이 deepseek-chat/-reasoner와 다르다면
// HONDI_TIER_MODELS의 backendModel만 바꾸면 된다.
function _selfHostReady(env) { return !!(env.HONDI_SELFHOST_URL && env.HONDI_SELFHOST_API_KEY); }

// 클라이언트는 실제 벤더 모델명 대신 "hondi-flash" / "hondi-pro" 논리 이름만
// 보낸다 — 어느 백엔드(공식 API vs 자체 서버)를 쓰든 클라이언트는 안 바뀐다.
const HONDI_TIER_MODELS = {
  'hondi-flash': {
    backendModel: 'deepseek-v4-flash',  // 2026-07-24 레거시 별칭(deepseek-chat) 폐기 대응 — 정식 ID로 교정
    price: { cacheHit: 0.0028, cacheMiss: 0.14, output: 0.28 }, // $/1M tokens
  },
  'hondi-pro': {
    // 레거시 별칭 'deepseek-reasoner'는 실제로 V4 Flash의 사고 모드였고 V4 Pro가 아니었다.
    // 가격표는 V4 Pro 기준이므로, 과금-원가 정합을 위해 실제로도 V4 Pro를 호출하도록 교정.
    // (2026-07-14 — deepseek-v4-flash+thinking으로 바꾸려면 price도 flash 단가로 같이 낮춰야 함)
    backendModel: 'deepseek-v4-pro',
    price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 },
  },
};
const USD_TO_KRW = 1500; // 실시간 조회 없이 보수적 고정값
// (2026-07-14: 정책 재확정 — "가입자당 100원 무료 한도" 도입.
//  주의: "사용자"가 아니라 "가입자" 기준이다. 이 코드베이스는 익명 모드가
//  없다(auth.js 상단 주석 "익명 모드 없음" 참조) — guid는 전화번호 인증을
//  마친 가입 완료 시점에만 발급되므로(_e164ToIPv6), guid가 존재한다는 것
//  자체가 곧 가입자라는 뜻이다. 즉 별도로 profiles 컬렉션을 조회해
//  "진짜 가입자인지" 매 요청마다 검증할 필요는 없다(그렇게 하면 매
//  채팅 요청마다 L1 왕복이 추가되어 불필요하게 느려진다) — 다만 이는
//  "guid는 가입 완료 시에만 발급된다"는 현재 auth.js의 불변식에 의존하는
//  가정이므로, 이 불변식이 깨지면(예: 훗날 프리뷰/게스트 모드가 다시
//  생기면) 이 가정도 함께 재검토해야 한다.
const FREE_QUOTA_KRW_LIMIT = 100;

// (2026-07-17: 개발 기간 동안 위 100원 무료 한도의 "집행"만 잠정 해제한다.
//  한도값(FREE_QUOTA_KRW_LIMIT) 자체나 spend 추적(_recordAiUsage 등)은
//  그대로 유지 — 이 플래그는 아래 STEP 0 게이트(7100번대, "guid 존재 +
//  spent >= 한도" 분기)에서 차단 여부만 결정한다. 즉 개발 기간에도 사용량은
//  정상적으로 KV(hondi:free_spend:{guid})에 누적되므로, 상용 출시 시점에
//  이 플래그를 true로 되돌리기만 하면 이미 쌓인 누적치 기준으로 즉시
//  집행이 재개된다 — 별도 마이그레이션이나 리셋 불필요.
//  TODO(상용 출시 전 필수): true로 변경할 것.)
const FREE_QUOTA_ENFORCEMENT_ENABLED = false;

function _deepseekUsageToKRW(usage, tierKey) {
  if (!usage) return 0;
  const price = HONDI_TIER_MODELS[tierKey]?.price || HONDI_TIER_MODELS['hondi-flash'].price;
  // DeepSeek 응답의 usage 필드명: prompt_cache_hit_tokens / prompt_cache_miss_tokens
  // (없으면 prompt_tokens 전체를 캐시 미스로 간주 — 보수적 상한 추정)
  const hit  = usage.prompt_cache_hit_tokens ?? 0;
  const miss = usage.prompt_cache_miss_tokens ?? (usage.prompt_tokens ?? 0) - hit;
  const out  = usage.completion_tokens ?? 0;
  const usd =
    (hit  / 1e6) * price.cacheHit +
    (Math.max(miss, 0) / 1e6) * price.cacheMiss +
    (out  / 1e6) * price.output;
  return usd * USD_TO_KRW;
}

// ═══════════════════════════════════════════════════════════
// 통합 과금 배수 — gopang 기본 챗, K-Law, 향후 K-Tax·K-Public 등 모든
// 서브시스템이 공유하는 단일 마진 정책 (2026-07-03).
//
// 청구액 = 실제 DeepSeek API 비용 × BILLING_MULTIPLIER.
// "대화 길이"(컨텍스트 토큰)와 "연산량"(추론 토큰 등)은 이미 DeepSeek 자체
// usage에 반영되어 있으므로 이것으로 충분하다 — 별도로 벽시계 경과시간을
// 더해서 청구하면, 네트워크 지연·Worker 콜드스타트처럼 사용자 책임이 아닌
// 우리 쪽 인프라 요인까지 사용자에게 전가하게 된다. "초당 X원" 식의 요금은
// 이 방식과 수학적으로 동일하다(청구액 ÷ 경과초 = 그 호출의 초당 요율)—
// 다만 모델·티어별로 실제 비용이 다르므로, 매 호출 실비를 그대로 쓰는 편이
// 고정 초당 요율을 추정하는 것보다 정확하다.
//
// 기본 배수 2 = 청구액의 50%는 API 비용 충당, 50%는 개발자 보상.
// 배수 조정은 재배포 없이 가능하도록 env var를 최우선으로 읽는다:
//   wrangler secret put BILLING_MULTIPLIER   (예: "2.5")
// ═══════════════════════════════════════════════════════════
const BILLING_MULTIPLIER_DEFAULT = 2;
function _billingMultiplier(env) {
  const v = parseFloat(env?.BILLING_MULTIPLIER);
  return Number.isFinite(v) && v > 0 ? v : BILLING_MULTIPLIER_DEFAULT;
}
// usage: DeepSeek 응답의 usage 필드 그대로. priceTier: 'hondi-flash' | 'hondi-pro' 가격표 키.
// 반환: apiCostKRW(실비) / billedKRW(실제 청구·예산 차감액) / multiplier(적용된 배수)
function computeBilledKRW(env, usage, priceTier) {
  const apiCostKRW = _deepseekUsageToKRW(usage, priceTier);
  const multiplier = _billingMultiplier(env);
  return { apiCostKRW, billedKRW: apiCostKRW * multiplier, multiplier };
}

// 스트리밍 응답 본문에서 마지막 usage 청크를 파싱(스트림은 tee()로 복제해
// 클라이언트에게는 그대로 전달하면서 이 쪽에서만 소비한다 — 지연 없음).
async function _parseUsageFromStream(stream) {
  try {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = '', usage = null;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') continue;
        try { const chunk = JSON.parse(payload); if (chunk.usage) usage = chunk.usage; } catch {}
      }
    }
    return usage;
  } catch { return null; }
}

// (2026-07-14: "가입자당 100원 무료 한도" 재도입. guid별 누적 지출(원)과
//  "첫 지출 시각"을 함께 기록한다 — 100원을 다 쓰면 아래 _billingNotWiredYet
//  스텁으로 넘어간다(실제 GDC 유료 차감이 아직 안 연결되어 있으므로, 100원
//  초과분은 "무료로 새는 것"도 "청구되는 것"도 아니라 "막히는 것"이 맞다 —
//  실제 GDC 차감 엔드포인트가 생기면 이 분기를 그쪽으로 연결할 것).
async function _recordFreeSpend(env, guid, usageKRW) {
  if (!guid || !usageKRW) return;
  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return;
  try {
    const spendKey = `hondi:free_spend:${guid}`;
    const sinceKey = `hondi:free_spend_since:${guid}`;
    const prev = parseFloat(await kv.get(spendKey) || '0');
    await kv.put(spendKey, String(prev + usageKRW)); // TTL 없음 — 평생 누적
    if (prev === 0) {
      const existing = await kv.get(sinceKey);
      if (!existing) await kv.put(sinceKey, new Date().toISOString());
    }
  } catch (e) { console.warn('[FreeQuota] 기록 실패:', e.message); }
}

// (2026-07-14: /api/ai-charge와 동일 환율. 원본은 L1(main.pb.js)에
//  있고 여기는 KRW↔GDC 환산을 위한 로컬 사본이다 — 두 값이 어긋나면
//  게이트(사전 확인)와 실제 차감(L1)의 판정이 서로 달라질 수 있으므로,
//  이 값을 바꿀 땐 반드시 main.pb.js의 EXCHANGE_RATE_KRW_PER_GDC도
//  함께 바꿀 것. gwp-registry.js에 가격 갱신 배치를 넣을 때(SP-GDC-
//  BILLING-v1.0 TODO 4-3) 이 상수도 그 배치가 갱신하도록 편입 검토.)
const EXCHANGE_RATE_KRW_PER_GDC = 1000;

// 무료 한도 소진 후, 이번 요청을 통과시켜도 되는지 사전 확인하기 위해
// L1의 실제 GDC 잔액을 조회한다(SP-GDC-BILLING-v2_0 STEP 0 게이트웨이
// 1단계 — v1.0의 "reserve_μT 홀드"까지는 아니지만, 원가 자체가 매우
// 작아서(일반 대화 1턴 약 1~3원) 정밀 홀드 없이 "잔액이 최소 예약금
// 이상인가"만 확인해도 실질적으로 안전하다는 게 v2.0에서 확정된 단순화
// 트레이드오프다. 요청 크기가 커지는 티어(예: max_tokens가 큰 K-Law)가
// 이 무료 한도 게이트를 타게 되면 이 단순화를 재검토해야 한다).
async function _l1GetBalanceKRW(guid) {
  try {
    const res = await fetch(`${L1_DEFAULT}/api/balance?guid=${encodeURIComponent(guid)}`);
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return null;
    return Number(data.balance || 0) * EXCHANGE_RATE_KRW_PER_GDC;
  } catch (e) {
    console.warn('[AiCharge] 잔액 조회 실패:', e.message);
    return null;
  }
}

// 요청 하나가 처리된 뒤, 실사용량(billedKRW)만큼 GDC 잔액에서 실제로
// 차감한다(SP-GDC-BILLING-v2_0 STEP 3, L1 /api/ai-charge 호출).
// /api/mint와 동일하게 서버 공유 비밀(secret)로만 인증한다 — 매 턴마다
// 사용자 서명을 요구하는 건 UX상 불가능하고, 이 시점엔 이미 요청 주체가
// (전화번호 인증 기반 세션으로) 확정돼 있으므로 이중 서명은 불필요한
// 마찰이다. 실패해도(L1 연결 문제 등) 이미 끝난 채팅 응답을 되돌릴 수는
// 없으므로 응답 자체는 막지 않는다 — 크게 로그를 남겨 STEP 6 월간
// 정산 대사에서 추적해야 할 항목으로 남긴다. 다음 요청부터는 STEP-0
// 게이트가 잔액을 다시 확인하므로, 이 차감이 실패해 잔액이 실제보다
// 높게 남아있어도 무제한으로 새지는 않는다(다음 정산 대사에서 걸러짐).
async function _chargeGdcForAiUsage(env, {
  guid, krwAmount, serviceId, model, hitTokens, missTokens, outTokens, costKRW, memo,
}) {
  if (!guid || !(krwAmount > 0)) return null;
  const txHash = 'aicharge-' + (crypto.randomUUID?.() || (Date.now() + '-' + Math.random().toString(36).slice(2)));
  try {
    const res = await fetch(`${L1_DEFAULT}/api/ai-charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, tx_hash: txHash, krw_amount: krwAmount,
        service_id: serviceId || 'hondi-chat', model: model || '',
        hit_tokens:  Math.round(hitTokens  || 0),
        miss_tokens: Math.round(missTokens || 0),
        out_tokens:  Math.round(outTokens  || 0),
        cost_krw:    Math.round((costKRW || 0) * 100) / 100,
        secret: _aiChargeSecret(env), memo: memo || '',
      }),
    });
    const data = await res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
    if (!data.ok) {
      console.warn(JSON.stringify({
        tag: 'AI_CHARGE_FAILED', guid, krwAmount, error: data.error, detail: data.detail,
        ts: new Date().toISOString(),
      }));
      return data;
    }
    console.log(JSON.stringify({
      tag: 'AI_CHARGE_OK', guid, krwAmount, chargedGdc: data.charged_gdc, balanceAfter: data.balance_after,
      ts: new Date().toISOString(),
    }));
    return data;
  } catch (e) {
    console.warn('[AiCharge] L1 호출 실패:', e.message);
    return { ok: false, error: 'L1_UNREACHABLE', detail: e.message };
  }
}

// _recordAiUsage의 onAfterRecord에서 호출하는 정산 분기점. 한 요청의
// billedKRW가 "남은 무료 한도"보다 많을 수 있으므로(예: 남은 무료 한도
// 3원인데 이번 요청이 5원), 무료/유료 경계를 정확히 나눠 처리한다 —
// 무료로 나가는 부분은 지금까지처럼 _recordFreeSpend(TTL 없는 평생
// 누적)로, 그 초과분만 GDC 잔액에서 차감한다. 이렇게 해야 "가입자당
// 평생 100원 무료"라는 약속이 요청 경계와 무관하게 정확히 지켜진다.
async function _settleAiUsage(env, guid, bill, meta = {}) {
  if (!guid || !bill) return;
  const kv = env.AI_SETUP_SEALS_KV;
  let spentBefore = 0;
  if (kv) {
    try { spentBefore = parseFloat(await kv.get(`hondi:free_spend:${guid}`) || '0'); } catch (e) { /* 조회 실패는 0원 소진으로 보수적 간주 */ }
  }
  const remainingFree = Math.max(FREE_QUOTA_KRW_LIMIT - spentBefore, 0);
  const freePortion   = Math.min(bill.billedKRW, remainingFree);
  const paidPortion   = bill.billedKRW - freePortion;

  if (freePortion > 0) await _recordFreeSpend(env, guid, freePortion);
  if (paidPortion > 0) {
    await _chargeGdcForAiUsage(env, {
      guid, krwAmount: paidPortion,
      serviceId: meta.serviceId, model: meta.model,
      hitTokens: meta.hitTokens, missTokens: meta.missTokens, outTokens: meta.outTokens,
      costKRW: bill.apiCostKRW, memo: meta.memo,
    });
  }
}

// GET /free-quota-status?guid=... — 지금까지 쓴 무료 한도 금액 + 사용
// 속도 기반 "이대로 쓰면 한 달에 대략 얼마" 추정치.
async function handleFreeQuotaStatus(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return _err(500, 'KV_UNAVAILABLE', 'KV 바인딩 없음', corsHeaders);

  const spent = parseFloat(await kv.get(`hondi:free_spend:${guid}`) || '0');
  const since = await kv.get(`hondi:free_spend_since:${guid}`);

  let daysElapsed = 0, dailyAvgKrw = 0, estimatedMonthlyKrw = 0;
  if (since) {
    daysElapsed = Math.max((Date.now() - new Date(since).getTime()) / 86400000, 1 / 24);
    dailyAvgKrw = spent / daysElapsed;
    estimatedMonthlyKrw = dailyAvgKrw * 30;
  }

  return new Response(JSON.stringify({
    ok: true,
    guid,
    spent_krw: Math.round(spent),
    limit_krw: FREE_QUOTA_KRW_LIMIT,
    remaining_krw: Math.max(Math.round(FREE_QUOTA_KRW_LIMIT - spent), 0),
    since,
    days_elapsed: Math.round(daysElapsed * 10) / 10,
    estimated_monthly_krw: Math.round(estimatedMonthlyKrw),
    projected_days_to_limit: dailyAvgKrw > 0 ? Math.round(((FREE_QUOTA_KRW_LIMIT - spent) / dailyAvgKrw) * 10) / 10 : null,
  }), { status: 200, headers: corsHeaders });
}

// GET /usage-log?guid=...&days=30 — /usage.html의 "모델별·기간별 상세
// 내역" 테이블용. ai_usage_log(L1)에서 최근 N일 레코드를 가져와
// 모델별로 집계한다(PocketBase REST에는 GROUP BY가 없어 Worker에서 집계).
async function handleUsageLog(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const days = Math.min(Math.max(parseInt(url.searchParams.get('days') || '30', 10) || 30, 1), 90);

  let items;
  try {
    items = await _l1QueryUsageLog(env, guid, days);
  } catch (e) {
    return _err(502, 'L1_ERROR', 'ai_usage_log 조회 실패: ' + e.message, corsHeaders);
  }

  // ── 모델별 집계 ──
  const byModel = {};
  let totalCostKRW = 0, totalBilledKRW = 0, totalRequests = 0, totalTokens = 0;
  for (const it of items) {
    const key = it.model || '(unknown)';
    if (!byModel[key]) {
      byModel[key] = { model: key, requests: 0, hit_tokens: 0, miss_tokens: 0, out_tokens: 0, cost_krw: 0, billed_krw: 0 };
    }
    const m = byModel[key];
    m.requests += 1;
    m.hit_tokens  += Number(it.hit_tokens)  || 0;
    m.miss_tokens += Number(it.miss_tokens) || 0;
    m.out_tokens  += Number(it.out_tokens)  || 0;
    m.cost_krw    += Number(it.cost_krw)    || 0;
    m.billed_krw  += Number(it.billed_krw)  || 0;

    totalCostKRW   += Number(it.cost_krw)   || 0;
    totalBilledKRW += Number(it.billed_krw) || 0;
    totalRequests  += 1;
    totalTokens    += (Number(it.hit_tokens) || 0) + (Number(it.miss_tokens) || 0) + (Number(it.out_tokens) || 0);
  }

  return new Response(JSON.stringify({
    ok: true,
    guid,
    days,
    total_cost_krw: Math.round(totalCostKRW * 100) / 100,
    total_billed_krw: Math.round(totalBilledKRW * 100) / 100,
    total_requests: totalRequests,
    total_tokens: totalTokens,
    by_model: Object.values(byModel).map(m => ({
      ...m,
      cost_krw: Math.round(m.cost_krw * 100) / 100,
      billed_krw: Math.round(m.billed_krw * 100) / 100,
    })).sort((a, b) => b.billed_krw - a.billed_krw),
  }), { status: 200, headers: corsHeaders });
}


// 100원 무료 한도를 다 쓴 뒤(=유료 구간)를 위해 준비해 둔 스텁.
// 현재는 콜사이트가 없다 — STEP 0 게이트(FREE_QUOTA_EXCEEDED 체크)가
// 100원 초과 요청을 이미 429로 막기 때문에, 유료 과금 로직 자체가
// 실행될 일이 아직 없다. 실제 GDC 유료 차감(L1 차감 엔드포인트, 가칭
// POST /api/debit)이 구현되면: (1) STEP 0 게이트의 429 응답을
// "GDC 잔액 확인 후 통과/차단"으로 교체하고, (2) 아래 함수 안에 실제
// 차감 호출을 채운 뒤, (3) 무료 한도 소진 이후 경로의 과금 기록 지점에서
// 이 함수를 호출하도록 연결할 것. SP-GDC-BILLING STEP 0/3 참조.
function _billingNotWiredYet(env, guid, billedKRW) {
  console.error(JSON.stringify({
    tag: 'BILLING_NOT_WIRED', guid, billedKRW,
    message: '실제 GDC 잔액 차감이 아직 연결되지 않음 — SP-GDC-BILLING STEP 0/3 구현 필요',
    ts: new Date().toISOString(),
  }));
}


// ── GitHub (Prompt Editor PR 워크플로) ──────────────────────
const GITHUB_OWNER          = 'Openhash-Gopang';
const GITHUB_REPO_NAME      = 'gopang';
const GITHUB_API            = 'https://api.github.com';
const GITHUB_DEFAULT_BRANCH = 'main';

// ── OpenHash L1~L5 저장소 매핑 (repository_dispatch 앵커링용) ─
// buildout_plan_v2 Phase 1: 클라이언트가 GitHub 토큰 직접 보유 금지
// → worker.js가 OPENHASH_TOKEN으로 dispatch를 중계
//
// 저장소 오너: Openhash-Gopang (push 권한 보유)
// nounweb은 GitHub Pages 호스팅 fork — node.json repo 필드 오기재
// 로컬 경로: Downloads\openhash\L1-ido1 ~ L5-global
const LAYER_REPOS = {
  L1: 'Openhash-Gopang/openhash-L1-ido1',
  L2: 'Openhash-Gopang/openhash-L2-jeju-city',
  L3: 'Openhash-Gopang/openhash-L3-jeju',
  L4: 'Openhash-Gopang/openhash-L4-kr',
  L5: 'Openhash-Gopang/openhash-L5-global',
};

// 2026-06-22: industry_fields.schema_id 화이트리스트 — ksic_schema_tier_classification_v1.md Tier1.
// profile_pdv_schema_plan_v1.md Phase 6에서 Tier2/3가 추가될 때마다 이 목록도 같이 늘린다.
// 클라이언트(또는 모델 출력)가 "{ksic}" 같은 미치환 리터럴이나 미정의 코드를 보내는 걸 막는 최소 방어선.
const VALID_INDUSTRY_SCHEMA_IDS = new Set([
  // 2026-06-30: sp-catalog.json의 AGENT-SUPPLIER-* 77개 키 전체와 동기화.
  // 기존엔 15개만 등록돼 있어 제조업·광업·건설·금융·의료 등 60개 이상
  // 업종의 가입이 INVALID_SCHEMA_ID로 막혀 있었음(2026-06-30 발견·수정).
  '01','02','03','05','06','07','08','10','11','12','13','14','15','16',
  '17','18','19','20','21','22','23','24','25','26','27','28','29','30',
  '31','32','33','34','35','36','37','38','39','41','42','45','46','47',
  '49','50','51','52','55','56','58','59','60','61','62','63','64','65',
  '66','68','70','71','72','73','74','75','76','84','85','86','87','90',
  '91','94','95','96','97','98','99',
]);

// 2026-07-13 신설 — Tier 3(규제산업, 사람 검토 전까지 보류) 코드.
// docs/ksic_schema_tier_classification_v1.md Tier 3 표와 정확히 동기화.
// 87(사회복지서비스)은 문서 자체가 "Tier 2→3 상향 검토 권고"로 남겨뒀으나,
// 안전한 쪽(포함)으로 처리한다 — 문서가 확정하지 못한 채 남겨둔 항목을
// 서버가 임의로 관대하게 해석하지 않는다.
const TIER3_REGULATED_SCHEMA_IDS = new Set([
  '12', // 담배 제조업 — 담배사업법
  '19', // 코크스·석유정제 — 위험물·환경 규제
  '21', // 의약품 제조업 — 약사법
  '27', // 의료·정밀·광학기기 — 의료기기법
  '64', // 은행·금융업 — 은행법 등
  '65', // 보험업 — 보험업법
  '66', // 금융·보험 관련 서비스업 — 자본시장법 등
  '71', // 전문서비스업 — 변호사법 등 자격기반 서비스 포함 가능성
  '85', // 교육서비스업 — 학원의 설립·운영에 관한 법률 등
  '86', // 보건업 — 의료법
  '87', // 사회복지서비스 — 아동복지법·노인복지법 등(상향 검토 권고분)
]);

// 2026-07-05: KSIC 코드 → 한글 업종명 단일 소스.
// AGENT-SUPPLIER-{code}_*.txt 파일 첫 줄("[공급자형 AI Agent · X00 · 업종명]")에서
// 자동 추출 — VALID_INDUSTRY_SCHEMA_IDS와 정확히 동일한 77개 코드를 커버한다.
// register-profile.html의 업종 선택 UI와 occupation 자동 파생(아래 handleProfilePost)이
// 이 하나의 맵만 참조하도록 통일 — tags(자유태그)/occupation(검색컬럼)/
// industry_fields.schema_id(KSIC, B2B 페르소나용)로 3중 분리돼 있던 업종 분류를
// industry_fields.schema_id를 단일 진실 소스로 하나로 합친다.
const KSIC_LABELS = {
  '01': '농업',
  '02': '임업',
  '03': '어업',
  '05': '석탄, 원유 및 천연가스 광업',
  '06': '금속 광업',
  '07': '비금속광물 광업; 연료용 제외',
  '08': '광업 지원 서비스업',
  '10': '식료품 제조업',
  '11': '음료 제조업',
  '12': '담배 제조업',
  '13': '섬유제품 제조업; 의복 제외',
  '14': '의복 제조업',
  '15': '가죽, 가방 및 신발 제조업',
  '16': '목재 및 나무제품 제조업; 가구 제외',
  '17': '펄프, 종이 및 종이제품 제조업',
  '18': '인쇄 및 기록매체 복제업',
  '19': '코크스, 연탄 및 석유정제품 제조업',
  '20': '화학물질 및 화학제품 제조업; 의약품 제외',
  '21': '의료용 물질 및 의약품 제조업',
  '22': '고무 및 플라스틱제품 제조업',
  '23': '비금속 광물제품 제조업',
  '24': '1차 금속 제조업',
  '25': '금속가공제품 제조업; 기계 및 가구 제외',
  '26': '전자부품, 컴퓨터, 영상, 음향 및 통신장비 제조업',
  '27': '의료, 정밀, 광학기기 및 시계 제조업',
  '28': '전기장비 제조업',
  '29': '기타 기계 및 장비 제조업',
  '30': '자동차 및 트레일러 제조업',
  '31': '기타 운송장비 제조업',
  '32': '가구 제조업',
  '33': '그 외 기타 제품 제조업',
  '34': '산업용 기계 및 장비 수리업',
  '35': '전기, 가스, 증기 및 공기조절 공급업',
  '36': '수도업',
  '37': '하수, 폐수 및 분뇨 처리업',
  '38': '폐기물 수집, 운반, 처리 및 원료 재생업',
  '39': '환경 정화 및 복원업',
  '41': '종합건설업',
  '42': '전문직별 공사업',
  '45': '자동차 판매업 및 부품 소매업',
  '46': '도매 및 상품중개업',
  '47': '소매업(자동차 제외)',
  '49': '육상운송 및 파이프라인 운송업',
  '50': '수상운송업',
  '51': '항공운송업',
  '52': '창고 및 운송관련 서비스업',
  '55': '숙박업',
  '56': '음식점 및 주점업',
  '58': '출판업',
  '59': '영화, 비디오물, 방송프로그램 제작 및 배급업',
  '60': '방송업',
  '61': '우편 및 통신업',
  '62': '컴퓨터 프로그래밍, 시스템 통합 및 관리업',
  '63': '정보서비스업',
  '64': '금융업(은행 및 저축기관 등)',
  '65': '보험업',
  '66': '금융 및 보험관련 서비스업',
  '68': '부동산업',
  '70': '연구개발업',
  '71': '전문서비스업(법무·회계·세무·디자인 등)',
  '72': '건축기술, 엔지니어링 및 관련 기술서비스업',
  '73': '기타 전문, 과학 및 기술 서비스업',
  '74': '사업시설 관리 및 조경 서비스업',
  '75': '사업지원 서비스업',
  '76': '임대업(부동산 제외)',
  '84': '공공행정, 국방 및 사회보장 행정',
  '85': '교육 서비스업',
  '86': '보건업',
  '87': '사회복지 서비스업',
  '90': '창작, 예술 및 여가관련 서비스업',
  '91': '스포츠 및 오락관련 서비스업',
  '94': '협회 및 단체',
  '95': '개인 및 가정용품 수리업',
  '96': '기타 개인 서비스업',
  '97': '가구 내 고용활동',
  '98': '자가소비를 위한 가구의 재화 생산활동',
  '99': '국제 및 외국기관',
};

// 2026-07-05: 카테고리 키워드 → KSIC 코드 결정적 매핑. LLM이 업종을
// '추측'하게 하지 않는다 — 판매자가 등록한 상품 카테고리(seller_products.category,
// 아래 handleCatalogSync 참조)에서 이 표로 다수결 매핑해 occupation을
// 자동으로 채운다. 매칭 실패 시 occupation은 null로 남고, 판매자가 카테고리를
// 더 구체적으로 쓰면 다음 동기화 때 자동으로 채워진다(사용자가 업종을 직접
// 고르게 하지 않는다 — market 시스템이 상품 등록으로부터 판단한다).
const KSIC_KEYWORD_MAP = {
  '농산물': '01',
  '농업': '01',
  '감귤': '01',
  '채소': '01',
  '과일': '01',
  '수산물': '03',
  '해산물': '03',
  '어업': '03',
  '생선': '03',
  // 2026-07-05 정정: 합성 테스트(catalog_sync_test.js)로 발견됨 —
  // "정육/축산물/육류"를 10(식료품 제조업, 공장 가공)으로 잘못 매핑해
  // 흑돼지 농장 직판 같은 흔한 K-Market 케이스가 제조업으로 오분류됐음.
  // K-Market은 소비자 대상 마켓이므로 이 세 키워드는 47(소매업)이 기본값에
  // 더 맞다 — 실제 식품 "가공"을 명시한 경우만 10으로 남긴다.
  '정육': '47', '축산물': '47', '육류': '47',
  '가공식품': '10',
  '음료': '11',
  '도매': '46',
  '소매': '47',
  '잡화': '47',
  '편의점': '47',
  '마트': '47',
  '숙박': '55',
  '펜션': '55',
  '호텔': '55',
  '게스트하우스': '55',
  '음식점': '56',
  '식당': '56',
  '중식': '56',
  '한식': '56',
  '일식': '56',
  '양식': '56',
  '카페': '56',
  '커피': '56',
  '주점': '56',
  '배달음식': '56',
  '베이커리': '56',
  '디저트': '56',
  '렌터카': '49',
  '택시': '49',
  '퀵서비스': '49',
  '택배': '49',
  '유람선': '50',
  '페리': '50',
  '항공': '51',
  'it': '62',
  '프로그래밍': '62',
  '앱개발': '62',
  '웹개발': '62',
  '정보서비스': '63',
  '렌탈': '76',
  '대여': '76',
  '스쿠터대여': '76',
  '캠핑용품대여': '76',
  '공연': '90',
  '체험': '90',
  '예술': '90',
  '다이빙': '91',
  '골프': '91',
  '레저': '91',
  '액티비티': '91',
  '스포츠': '91',
  '미용': '96',
  '네일': '96',
  '세탁': '96',
  '이발': '96',
  '수리': '95',
};

function _deriveOccupationFromCategories(categories) {
  const votes = {};
  for (const raw of categories || []) {
    const cat = String(raw || '').trim();
    if (!cat) continue;
    for (const [kw, code] of Object.entries(KSIC_KEYWORD_MAP)) {
      if (cat.includes(kw) || kw.includes(cat)) {
        votes[code] = (votes[code] || 0) + 1;
        break;
      }
    }
  }
  const entries = Object.entries(votes);
  if (!entries.length) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const bestCode = entries[0][0];
  return { schema_id: bestCode, occupation: KSIC_LABELS[bestCode] || null };
}


// 2026-07-01: INDIVIDUAL_ENTITY_TYPES/INSTITUTION_ENTITY_TYPES는
// "개인은 별도 행 없이 병합, 기관은 별도 그림자 행"으로 나누던
// 구설계의 분기 상수였다 — 모든 entity_type이 _mergeAgentSP 하나로
// 통합되며 더 이상 분기가 필요 없어져 제거함.

// ═══════════════════════════════════════════════════════════════
// ★ PDV SCOPE 명명 원칙 (2026-07-04, 여러 차례 정정 끝에 확정) ★
//
// scope 이름에는 지역·행정구역명을 접두어로 넣지 않는다.
//
// 판단 기준: "이 종류의 부서/기관을 다른 지역(다른 국가기관 지사,
// 다른 도, 다른 시·군·구 등 — 행정 계층 무관)도 일반적으로
// 가지고 있는가?" 그렇다면(거의 항상 그렇다) k 접두어의 전국
// 단위 scope로 등록한다. 지금 어느 지역이 실제로 이 scope를
// 구현·보고하는지는 SCOPE_SOURCE_MAP의 reporter_svc 배열에만
// 담는다 — scope 이름 자체는 절대 건드리지 않는다.
//   예) kagri: ['jeju']  →  나중에 경상남도가 자체 구현하면
//       kagri: ['jeju', 'gyeongnam']으로 배열만 늘린다.
//
// "지금 하나의 지역만 구현했다"는 사실은 scope를 지역화해야 할
// 근거가 되지 않는다 — 국가기관 지사든, 광역자치단체(도) 부서든,
// 기초자치단체(시) 부서든 전부 동일하게 적용한다(제주시·서귀포시
// 같은 시 단위 부서도 다른 시가 유사 조직을 가질 것으로 상정 —
// 예외로 두지 않는다). 정말로 그 지역에만 존재하는 극히 이례적인
// 제도가 나오면 그때 예외를 개별 검토한다.
// ═══════════════════════════════════════════════════════════════

// STEP 10: VALID_PDV_SCOPES 확장
// 2026-07-04b: kpolice·kpublic 신규 등록 — GOV_AGENCIES 9개 중 이 둘만
// VALID_PDV_SCOPES에 없었다. K-Public_common의 P11 예시엔 "K-Tax는 ktax"
// 식으로 몇몇만 명시돼 있어서, LLM이 police/public에 대해서는 근거 없이
// 'police'나 'kpolice'를 추측했을 가능성이 높다 — 어느 쪽이든 이 목록에
// 없었으므로 SCOPE_INVALID로 항상 실패했을 것이다. 911도 명명 패턴상
// LLM이 'k911'로 추측하기 쉬운데 실제 등록값은 k119이므로 같은 위험군 —
// 이건 handleGovRelay의 서버측 치환(GOV_AGENCY_PDV_SCOPE)으로 근본 해결한다.
//
// 2026-07-04c~e(제주 전국 확장 설계, 여러 차례 정정 끝에 확정): jeju
// 저장소 실사 결과, jeju가 다루는 39개 부서/기관(국가기관 26개 + 세무서·
// 경찰서 + 도 자체 부서 13개) 중 기존 scope와 겹치는 건 ktax·kpolice
// 뿐이었다. 처음엔 "국가기관 26개는 전국 scope, 도 자체 부서 13개는
// jeju_ 지역 scope"로 나눴었으나, 도 자체 부서도 대부분 다른 도(경상남도,
// 충청북도 등)가 유사한 조직(농정국·관광국·복지국 등)을 갖고 있다는
// 지적을 받고 재정정했다 — 국가기관이든 도 조직이든, "여러 시도가 같은
// 종류의 부서/기관을 가질 것"이라는 전제가 성립하면 scope는 지역 접두어
// 없이 국가 단위(k 접두어)로 등록하고, 지금 jeju가 유일한 구현체라는
// 사실은 SCOPE_SOURCE_MAP의 reporter_svc 배열에만 반영한다. 결과적으로
// jeju 관련 신규 scope 39개 전부 지역 접두어가 없다 — 나중에 다른 도가
// 자기 지역판 서비스를 만들면 해당 scope의 source 배열에 이름만 추가하면
// 된다(예: kagri: ['jeju'] → ['jeju', 'gyeongnam']).
const VALID_PDV_SCOPES = [
  'ktraffic', 'khealth', 'pdv_general', 'kmarket', 'k119',
  'klaw', 'ktax', 'kinsurance', 'kgdc', 'kdemocracy', 'klogistics',
  'kschool', 'kstock', // 2026-07-04: PDV_HISTORY_REQUEST 파일럿 확장 — 이전엔 미등록
  'kpolice', 'kpublic', // 2026-07-04b: GOV_AGENCIES 9개 중 누락됐던 나머지 2개
  // 2026-07-04e: jeju발 신규 국가기관 26개(jeju가 현재의 유일한 reporter_svc)
  'kagroquality', 'kairport', 'kanimalquarantine', 'kcoastguard', 'kcourt',
  'kdata', 'kenv', 'kfishquality', 'kfoodimport', 'khumanquarantine',
  'kimmigration', 'kinternet', 'klabor', 'klaborimprove', 'klaborrel',
  'kmma', 'knhis', 'knps', 'kport', 'kpost', 'kpps', 'kprobation',
  'kprosecution', 'kradio', 'kveterans', 'kweather',
  // 2026-07-04e: jeju발 신규 도 자체 부서 13개(마찬가지로 전국 scope —
  // 다른 도도 유사 조직을 가질 것으로 상정)
  'kagri', 'kclimate', 'kculture', 'kecon', 'khousing',
  'kinnov', 'kjachi', 'kocean', 'kplan', 'ksafety',
  'ktourism', 'ktransport', 'kwelfare',
  // 2026-07-15: 공무원 직무보조 트랙1/2(SCOPE-MAPPING-TRACK1-2_v1_0) 대응 —
  // 시민 본인이 PDV에 직접 기록하는 자산·소득 신고(기초생활수급·국가장학금
  // 소득분위 심사 등에 필요). 특정 정부기관 리포터가 없어 신규 scope 필요.
  // 'kfinance'로 명명하려 했으나 이미 SVC_ALIAS(아래)에서 K-Stock(투자
  // 서비스)의 별칭으로 선점돼 있어 충돌 회피를 위해 'kassetdecl'로 명명함.
  'kassetdecl',
  // 2026-07-15e: 공무원 직무보조 100번(여권 재발급) 대응 — 외교부(여권) 소관
  // scope가 51종 어디에도 없었다(kimmigration은 법무부 출입국관리로 성격이
  // 다름). 여권 접수·재발급은 실제로 시/군/구 여권과(제주 포함)에서 국가
  // 위임사무로 처리하므로, 다른 jeju발 위임사무 scope와 동일하게 jeju를
  // source로 등록한다. 이름 충돌 여부(SVC_ALIAS·UNIVERSAL_FORCED_K_SERVICES·
  // DEPT_TASK_TAXONOMY) 확인 완료 — 'kforeign'은 어디에도 선점돼 있지 않음.
  'kforeign',
];
const SCOPE_MIN_LEVEL = {
  ktraffic:'L1', khealth:'L1', pdv_general:'L1', k119:'L1', kmarket:'L0',
  klaw:'L0', ktax:'L1', kinsurance:'L1', kgdc:'L1', kdemocracy:'L1', klogistics:'L0',
  kschool:'L1', kstock:'L1', // 학습기록·투자정보는 L1(본인 확인) 이상 요구
  kpolice:'L1', kpublic:'L0',
  // jeju 신규 scope — 전부 잠정 L1(기본값)로 등록. TODO(피터 확인 필요):
  // kcourt·kprosecution·kprobation·kimmigration·khumanquarantine은 성격상
  // L2 이상이 맞아 보이지만, Bearer 토큰 검증 배선이 아직 없는 상태에서
  // L2로 걸면(handlePdvQuery의 "검증 불가 → L1 강등" 정책상) 그 즉시 아무도
  // 통과 못 하는 scope가 된다 — 배선 완성 후에 올리는 걸 권장.
  kagroquality:'L1', kairport:'L1', kanimalquarantine:'L1', kcoastguard:'L1', kcourt:'L1',
  kdata:'L1', kenv:'L1', kfishquality:'L1', kfoodimport:'L1', khumanquarantine:'L1',
  kimmigration:'L1', kinternet:'L1', klabor:'L1', klaborimprove:'L1', klaborrel:'L1',
  kmma:'L1', knhis:'L1', knps:'L1', kport:'L1', kpost:'L1', kpps:'L1', kprobation:'L1',
  kprosecution:'L1', kradio:'L1', kveterans:'L1', kweather:'L0', // 날씨는 낮은 민감도
  kagri:'L1', kclimate:'L1', kculture:'L0', kecon:'L1', khousing:'L1',
  kinnov:'L1', kjachi:'L1', kocean:'L1', kplan:'L1', ksafety:'L1',
  ktourism:'L0', ktransport:'L0', kwelfare:'L1',
  // 2026-07-15: 자산·소득 정보는 L1보다 높은 게 맞다 — L2로 지정한다.
  // 발견④ 수정(silent-auth.html의 지갑 경로 Bearer 토큰 누락 수정)으로
  // 배선의 SSO 쪽 절반(서명된 토큰을 실제로 세션에 담아 전달하는 부분)은
  // 됐지만, 이건 부분 수정이다 — (1) _runRedirectMode 경로는 여전히
  // 비서명 base64 토큰(367행)만 쓰고, (2) 각 K-서비스 앱 코드가
  // session.token을 실제로 queryPdvScope({sessionToken})에 넘기도록
  // 연동하는 다운스트림 작업도 아직 안 됐다(발견④ 커밋 메시지에 명시).
  // 그래서 지금 L2로 걸어도 당장 실사용에서 통과되리라는 보장은 없다 —
  // 다만 이전처럼 "L2를 걸면 구조적으로 무조건 실패"였던 상태에서 "배선이
  // 끝나는 만큼 점진적으로 동작 가능"한 상태로는 바뀌었다.
  kassetdecl:'L2',
  // 2026-07-15e: 여권 정보(여권번호 등)는 주민등록번호급 식별정보라 다른
  // jeju발 scope들과 마찬가지로 원칙상 L2 이상이 맞지만, 위 TODO(966행)와
  // 동일한 이유로 지금 L2를 걸면 Bearer 배선 미완성 상태에서 무조건 실패하는
  // scope가 된다. kcourt·kimmigration 등과 동일하게 잠정 L1로 등록 — 배선
  // 완성 후 이 값들과 함께 일괄 L2로 올리는 걸 권장(개별로 올리면 "왜 얘만
  // L2였지" 식의 비일관성이 생긴다).
  kforeign:'L1',
};
// 2026-07-04c: scope → source 배열(1:다)로 변경. 이전엔 scope 하나당 저장소
// 하나만 가능했는데, 같은 종류의 데이터(예: 세무 상담)를 여러 지역/서비스가
// 보고할 수 있어야 한다 — jeju가 대표 사례(ktax·kpolice에 'jeju' 추가).
// _fetchPdvByScope가 이 배열을 Supabase `source=in.(...)` 필터로 사용한다.
const SCOPE_SOURCE_MAP = {
  ktraffic:['traffic'], khealth:['health'], pdv_general:null, kmarket:['market'], k119:['911'],
  klaw:['klaw'], ktax:['tax','jeju'], kinsurance:['insurance'], kgdc:['gdc'], kdemocracy:['democracy'],
  klogistics:['logistics'], kschool:['school'], kstock:['stock'],
  kpolice:['police','jeju'], kpublic:['public'],
  kagroquality:['jeju'], kairport:['jeju'], kanimalquarantine:['jeju'], kcoastguard:['jeju'], kcourt:['jeju'],
  kdata:['jeju'], kenv:['jeju'], kfishquality:['jeju'], kfoodimport:['jeju'], khumanquarantine:['jeju'],
  kimmigration:['jeju'], kinternet:['jeju'], klabor:['jeju'], klaborimprove:['jeju'], klaborrel:['jeju'],
  kmma:['jeju'], knhis:['jeju'], knps:['jeju'], kport:['jeju'], kpost:['jeju'], kpps:['jeju'], kprobation:['jeju'],
  kprosecution:['jeju'], kradio:['jeju'], kveterans:['jeju'], kweather:['jeju'],
  kagri:['jeju'], kclimate:['jeju'], kculture:['jeju'], kecon:['jeju'], khousing:['jeju'],
  kinnov:['jeju'], kjachi:['jeju'], kocean:['jeju'], kplan:['jeju'], ksafety:['jeju'],
  ktourism:['jeju'], ktransport:['jeju'], kwelfare:['jeju'],
  kassetdecl:null, // pdv_general과 동일 — 정부기관 리포터 없음, 시민 본인이 직접 기록
  kforeign:['jeju'], // 여권과 위임사무 — 다른 jeju발 국가위임사무 scope와 동일 패턴
};

const SVC_ALIAS = {
  'kemergency':'911','kpolice':'police','ksecurity':'security',
  'khealth':'health','kedu':'school','kgdc':'gdc','kfinance':'stock',
  'kinsurance':'insurance','ktax':'tax','kcommerce':'market',
  'ktransport':'traffic','klogistics':'logistics','fiil-kcleaner':'fiil',
  'kgov':'public','kdemocracy':'democracy',
  // ── 백업 별칭(2026-07-03) — GOV_AGENCIES/AGENCY_ID를 REGISTERED_SERVICES
  // 키와 통일했지만, 혹시 남은 캐시된 클라이언트나 실수로 하이픈형을 보내는
  // 경우에도 /pdv/report가 조용히 실패하지 않도록 하는 안전망. GOV_AGENCIES
  // 자체는 별칭 해석을 안 거치므로 이걸로 /gov/relay까지 고쳐지진 않는다 —
  // 그쪽은 반드시 (a) 방식(직접 통일)으로만 해결된다.
  'k-public':'public', 'k-province':'public', 'k-city':'public', 'k-county':'public',
  'k-tax':'tax', 'k-health':'health', 'k-insurance':'insurance',
  'k-logistics':'logistics', 'k-traffic':'traffic',
};

function _resolveSvcId(svcId) { return SVC_ALIAS[svcId] || svcId; }

function getCorsOrigin(request) {
  const origin = request.headers.get('Origin') || '';
  if (ALLOWED_ORIGINS.some(o => origin.startsWith(o))) return origin;
  if (origin === '') return '';
  return null;
}

function buildCorsHeaders(corsOrigin, extra = {}) {
  return {
    'Content-Type':                     'application/json',
    'Access-Control-Allow-Origin':      corsOrigin || '*',
    'Access-Control-Allow-Credentials': 'true',
    'Access-Control-Allow-Methods':     'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization',
    ...extra,
  };
}

function _err(status, code, detail, corsHeaders) {
  return new Response(
    JSON.stringify({ ok: false, error: code, detail }),
    { status, headers: corsHeaders }
  );
}

// ═══════════════════════════════════════════════════════════
// L1 PocketBase Admin 인증 — X25519/Ed25519 등 보안 필드는 L1이 소스
// Supabase는 필드 테스트/시뮬레이션 용도이므로 신원 관련 핵심 키는 L1에 둔다.
// 토큰은 Worker 인스턴스 생애 동안 메모리에 캐싱 (PocketBase 토큰 기본 유효기간 길음).
// ═══════════════════════════════════════════════════════════
// 2026-07-07 수정(제주 L1~L3 필드 테스트): 43개 L1 + L2 + L3가 전부 별개
// PocketBase 프로세스라, admin 토큰도 노드(base URL)별로 따로 받아야 한다
// — 예전처럼 L1_DEFAULT(hanlim) 토큰 하나를 전역 캐싱해 재사용하면, 다른
// 노드 호출 시 그 인스턴스가 서명하지 않은 토큰이라 인증에 실패한다.
const _l1AdminTokenCache = {}; // base URL → { token, exp }

async function _l1AdminTokenFor(env, base) {
  const now = Date.now();
  const cached = _l1AdminTokenCache[base];
  if (cached && now < cached.exp) return cached.token;

  const email = env.L1_ADMIN_EMAIL;
  const password = env.L1_ADMIN_PASSWORD;
  if (!email || !password) throw new Error('L1_ADMIN_EMAIL/L1_ADMIN_PASSWORD secret 미설정');

  // 이 L1 인스턴스(PocketBase 구버전)는 /api/admins/auth-with-password 경로 사용
  // (※ /api/collections/_superusers/auth-with-password는 이 인스턴스에서 404)
  const res = await fetch(`${base}/api/admins/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: email, password }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`L1 admin auth(${base}) ${res.status}: ${errText.slice(0, 200)}`);
  }
  const data = await res.json().catch(() => null);
  if (!data?.token) throw new Error(`L1 admin auth(${base}): token 없음`);
  _l1AdminTokenCache[base] = { token: data.token, exp: now + 25 * 60 * 1000 }; // 25분 캐시
  return data.token;
}

// 기존 호출부(hanlim 고정) 하위호환용 래퍼 — 신규 코드는 _l1AdminTokenFor를 직접 쓸 것
async function _l1AdminToken(env) {
  return _l1AdminTokenFor(env, L1_DEFAULT);
}


// ═══════════════════════════════════════════════════════════
// GOV_OPEN_DATA_MAP — KOSIS 리졸버 (2026-07-16 배선)
// 선행 문서: GOV_OPEN_DATA_MAP-통합설계_v1.0, resolveGovData-최소버전설계_v1.0
//
// 핵심 원칙: 트랙4/57건류 예시를 정적으로 미리 채워두지 않는다. 혼디 사용자
// (공무원 SP·K-Public)의 실제 질의마다 KOSIS 통합검색을 호출해 그때그때
// 대응 통계표를 찾고, 확정된 것만 GOV_DATA_KV에 캐싱해 재사용한다.
//
// 스코어링 알고리즘은 아직 안 만든다 — 단순 배제 규칙 3개 + 후보 2건 이상이면
// 무조건 사람(공무원 SP는 "담당자_확인_필요" 플래그, K-Public은 되묻기)에게
// 넘긴다. 모든 시도는 gov_data_resolve_log에 기록해, 실사용 로그가 쌓인 뒤
// 2단계에서 스코어링을 정교화할 근거로 쓴다.
// ═══════════════════════════════════════════════════════════

// KOSIS는 format=json이어도 표준 JSON이 아니라 키를 따옴표 없이 반환한다
// (JS 객체 리터럴 표기, 예: {ORG_ID:"101",...} — 키에 따옴표가 없다).
// 표준 JSON.parse는 이걸 정당하게 SyntaxError로 거부하므로, 단순 식별자
// 형태의 키(영문/숫자/언더스코어)만 따옴표로 감싸는 전처리 후 파싱한다.
// eval()은 신뢰할 수 없는 외부 응답에 쓰지 않는다 — 정규식 전처리 + JSON.parse로 한정.
function _lenientJsonParse(text) {
  const withQuotedKeys = text.replace(/([{,]\s*)([A-Za-z0-9_]+)(\s*:)/g, '$1"$2"$3');
  return JSON.parse(withQuotedKeys);
}

async function _kosisSearch(query, apiKey) {
  const url = `https://kosis.kr/openapi/statisticsSearch.do?method=getList&apiKey=${apiKey}&searchNm=${encodeURIComponent(query)}&format=json`;
  const res = await fetch(url);
  const bodyText = await res.text();
  if (!res.ok) throw new Error(`KOSIS 검색 실패(HTTP ${res.status}): ${bodyText.slice(0, 200)}`);

  let data;
  try {
    data = _lenientJsonParse(bodyText);
  } catch (e) {
    throw new Error(`KOSIS 응답 파싱 실패: ${bodyText.slice(0, 200)}`);
  }

  // KOSIS는 결과가 없거나 오류일 때도 200을 주며 {err, errMsg} 객체를 반환하는 경우가
  // 있다(예: 유효하지 않은 인증키). 이전 버전은 이 경우를 조용히 빈 배열로 취급해서
  // "진짜 검색결과 0건"과 "인증키 오류"를 구분할 수 없었다 — 이제 예외로 명확히 구분한다.
  if (!Array.isArray(data)) {
    throw new Error(`KOSIS 오류 응답: ${JSON.stringify(data).slice(0, 200)}`);
  }
  return data;
}

// 규칙 A: 세부항목표(REC_TBL_SE='Y')는 1차 후보에서 제외 — 원자료 상세표라
// 지역단위 집계 요청 의도와 대부분 안 맞는다(오늘 세션 "기초생활수급자현황"
// 검색 20건 중 실제 부합은 REC_TBL_SE='N' 1건뿐이었던 사례 참조).
function _filterRuleA(candidates) {
  return candidates.filter((c) => c.REC_TBL_SE !== 'Y');
}

// 규칙 B: 검색어와 TBL_NM(통계표명) 사이 단순 부분일치. 형태소 분석기 없이
// 시작하는 최소 버전이라 오탐 가능성이 있다 — 정교화는 2단계 과제.
function _filterRuleB(candidates, query) {
  const q = query.replace(/\s/g, '');
  return candidates.filter((c) => (c.TBL_NM || '').replace(/\s/g, '').includes(q));
}

// 규칙 C: 동일 STAT_ID(통계조사 자체가 같은 경우) 중 최신 END_PRD_DE만 유지
function _dedupeRuleC(candidates) {
  const bestByStat = new Map();
  for (const c of candidates) {
    const key = c.STAT_ID || c.TBL_ID;
    const prev = bestByStat.get(key);
    if (!prev || (c.END_PRD_DE || '') > (prev.END_PRD_DE || '')) bestByStat.set(key, c);
  }
  return [...bestByStat.values()];
}

// gov_data_resolve_log 기록 — 실패해도 본 요청(통계 조회)을 막지 않는다.
async function _recordGovDataResolveLog(entry, env) {
  try {
    const token = await _l1AdminTokenFor(env, L1_BASE_HOST);
    const res = await fetch(`${L1_BASE_HOST}/api/collections/gov_data_resolve_log/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...entry, recorded_at: new Date().toISOString() }),
    });
    if (!res.ok) console.error('gov_data_resolve_log 기록 실패:', res.status, await res.text().catch(() => ''));
  } catch (e) {
    console.error('gov_data_resolve_log 기록 실패:', e.message);
  }
}

// TTL — 최소버전은 고정 30일. update_cycle/publish_lag 파싱한 동적 계산은
// KOSIS 통계표설명 API 연동 후 2단계 과제(resolveGovData-최소버전설계 §4 참조).
function _computeGovDataTTL() {
  return 60 * 60 * 24 * 30;
}

// GET /api/stats/resolve?q=1인가구비율&requester_type=k-public
async function handleGovDataResolve(request, url, env, corsHeaders) {
  const rawQuery = (url.searchParams.get('q') || '').trim();
  const requesterType = url.searchParams.get('requester_type') || 'k-public';
  if (!rawQuery) return _err(400, 'MISSING_QUERY', 'q 파라미터 필수', corsHeaders);
  if (!env.KOSIS_API_KEY) return _err(500, 'KOSIS_KEY_MISSING', 'KOSIS_API_KEY secret 미설정', corsHeaders);

  const cacheKey = `gov-data:${rawQuery}`;
  if (env.GOV_DATA_KV) {
    const cached = await env.GOV_DATA_KV.get(cacheKey, 'json');
    if (cached) return new Response(JSON.stringify({ source: 'cache', ...cached }), { headers: corsHeaders });
  }

  let raw;
  try {
    raw = await _kosisSearch(rawQuery, env.KOSIS_API_KEY);
  } catch (e) {
    // 인증키 오류 등 KOSIS 자체 문제를 not_found로 뭉개지 않고 명확히 구분한다.
    return new Response(
      JSON.stringify({ status: 'upstream_error', message: 'KOSIS 조회 중 오류', detail: e.message }),
      { status: 502, headers: corsHeaders }
    );
  }
  let candidates = _filterRuleA(raw);
  candidates = _filterRuleB(candidates, rawQuery);
  candidates = _dedupeRuleC(candidates);

  const logEntry = {
    raw_query: rawQuery,
    requester_type: requesterType,
    kosis_search_candidates: raw,
    filtered_candidates: candidates,
  };

  if (candidates.length === 0) {
    logEntry.outcome = 'not_found';
    await _recordGovDataResolveLog(logEntry, env);
    return new Response(
      JSON.stringify({
        status: 'not_found',
        message: '대응하는 KOSIS 통계표를 찾지 못했습니다.',
        // 진단용 — KOSIS 검색 자체가 0건인지(raw=0, 키/검색어 문제), 검색은
        // 됐는데 규칙 A/B/C가 다 걸러냈는지(raw>0, filtered=0, 규칙 문제)를
        // 구분하기 위한 필드. 정상 운영에도 부담 없는 크기라 상시 포함한다.
        debug: { raw_candidate_count: raw.length, filtered_candidate_count: candidates.length,
          raw_sample: raw.slice(0, 3).map((c) => ({ tbl_nm: c.TBL_NM, rec_tbl_se: c.REC_TBL_SE })) },
      }),
      { status: 404, headers: corsHeaders }
    );
  }

  if (candidates.length > 1) {
    // 확신 없는 자동 선택을 하지 않는다 — 후보를 그대로 넘겨 사람이 고르게 한다.
    // (공무원 SP 쪽에서는 이 응답을 §3 "담당자_확인_필요" 플래그로 받아 처리)
    logEntry.outcome = 'ambiguous';
    await _recordGovDataResolveLog(logEntry, env);
    return new Response(
      JSON.stringify({
        status: 'ambiguous',
        candidates: candidates.map((c) => ({ tbl_nm: c.TBL_NM, org_id: c.ORG_ID, tbl_id: c.TBL_ID })),
      }),
      { status: 300, headers: corsHeaders }
    );
  }

  const picked = candidates[0];
  const entry = {
    entry_id: `kosis:${picked.ORG_ID}:${picked.TBL_ID}`,
    source_type: 'kosis',
    consent_required: false,
    status: 'confirmed',
    kosis: { org_id: picked.ORG_ID, tbl_id: picked.TBL_ID, tbl_nm: picked.TBL_NM },
  };
  logEntry.outcome = 'confirmed';
  logEntry.selected_entry_id = entry.entry_id;
  await _recordGovDataResolveLog(logEntry, env);

  const result = { entry, tbl_nm: picked.TBL_NM };
  let kvWriteStatus = 'skipped (env.GOV_DATA_KV 바인딩 없음)';
  if (env.GOV_DATA_KV) {
    try {
      await env.GOV_DATA_KV.put(cacheKey, JSON.stringify(result), { expirationTtl: _computeGovDataTTL() });
      kvWriteStatus = 'ok';
    } catch (e) {
      // put() 실패를 조용히 삼키지 않는다 — 캐싱이 실제로 도는지 여기서 바로 확인 가능하게.
      kvWriteStatus = `error: ${e.message}`;
    }
  }
  return new Response(JSON.stringify({ source: 'live', kv_write: kvWriteStatus, ...result }), { headers: corsHeaders });
}


// ── META_TABLE_UPDATE 태그 파싱/기록 — AGENCY-AC-COMMON_v1.3.md §6 ──────
// (2026-07-14 신설, 1c891de가 이전 버전 worker.js 기준으로 편집하며
// 한 차례 삭제됐다가 이번에 복구됨)
// 태그 형식: agency_id=..., category=..., task_type=..., dept_chain=[a,b],
// outcome=completed|pending|referred, received_ts=ISO, processing_started_ts=ISO,
// completed_ts=ISO, duration_seconds=123
function _parseMetaTableTag(raw) {
  try {
    const fields = {};
    const parts = [];
    let depth = 0, buf = '';
    for (const ch of raw) {
      if (ch === '[') depth++;
      if (ch === ']') depth--;
      if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; }
      else buf += ch;
    }
    if (buf.trim()) parts.push(buf);

    for (const part of parts) {
      const eq = part.indexOf('=');
      if (eq === -1) continue;
      const key = part.slice(0, eq).trim();
      let val = part.slice(eq + 1).trim();
      if (val.startsWith('{') && val.endsWith('}')) val = val.slice(1, -1).trim();
      if (key === 'dept_chain') {
        if (val.startsWith('[') && val.endsWith(']')) val = val.slice(1, -1);
        fields.dept_chain = val.split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(Boolean);
      } else {
        fields[key] = val.replace(/^["']|["']$/g, '');
      }
    }
    if (!fields.agency_id || !fields.category || !fields.outcome || !fields.received_ts) return null;
    return fields;
  } catch (e) { return null; }
}

async function _writeMetaTableRecord(env, sessionAgency, fields) {
  const token = await _l1AdminToken(env);
  let duration = fields.duration_seconds ? parseInt(fields.duration_seconds, 10) : null;
  if ((duration === null || Number.isNaN(duration)) && fields.completed_ts && fields.received_ts) {
    const d = (new Date(fields.completed_ts) - new Date(fields.received_ts)) / 1000;
    duration = Number.isFinite(d) && d >= 0 ? Math.round(d) : null;
  }
  const res = await fetch(`${L1_DEFAULT}/api/collections/meta_table_records/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agency_id: fields.agency_id || sessionAgency,
      category: fields.category,
      task_type: fields.task_type || null,
      dept_chain: fields.dept_chain || [],
      outcome: ['completed', 'pending', 'referred'].includes(fields.outcome) ? fields.outcome : 'pending',
      received_ts: fields.received_ts,
      processing_started_ts: fields.processing_started_ts || null,
      completed_ts: fields.completed_ts || null,
      duration_seconds: duration,
    }),
  });
  if (!res.ok) throw new Error(`meta_table_records 저장 실패 HTTP ${res.status}: ${await res.text().catch(() => '')}`);
}

// GET /stats/agency-report — AGENCY-AC-COMMON §6이 요구한 주기별 보고서.
async function handleStatsAgencyReport(request, env, corsHeaders) {
  const url = new URL(request.url);
  const agencyId = url.searchParams.get('agency_id');
  const period = url.searchParams.get('period') || 'monthly';
  if (!agencyId) return _err(400, 'MISSING_FIELD', 'agency_id 필수', corsHeaders);
  const PERIOD_DAYS = { weekly: 7, monthly: 30, quarterly: 91, halfyear: 182, yearly: 365 };
  const days = PERIOD_DAYS[period];
  if (!days) return _err(400, 'INVALID_PERIOD', 'weekly|monthly|quarterly|halfyear|yearly 중 하나여야 합니다', corsHeaders);
  const anchor = url.searchParams.get('anchor') ? new Date(url.searchParams.get('anchor')) : new Date();
  const since = new Date(anchor.getTime() - days * 86400000).toISOString();

  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`agency_id='${agencyId}' && received_ts >= '${since}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/meta_table_records/records?filter=${filter}&perPage=500`,
    { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null);
  if (!res || !res.ok) return _err(503, 'FETCH_FAILED', '', corsHeaders);
  const json = await res.json().catch(() => null);
  const items = json?.items || [];

  const byCategory = {};
  for (const it of items) {
    const cat = it.category || '(미분류)';
    if (!byCategory[cat]) byCategory[cat] = { count: 0, completed: 0, durations: [] };
    byCategory[cat].count++;
    if (it.outcome === 'completed') byCategory[cat].completed++;
    if (it.duration_seconds != null) byCategory[cat].durations.push(it.duration_seconds);
  }
  const categories = Object.entries(byCategory).map(([category, v]) => ({
    category,
    count: v.count,
    completion_rate: v.count ? +(v.completed / v.count).toFixed(3) : null,
    avg_duration_seconds: v.durations.length ? Math.round(v.durations.reduce((a, b) => a + b, 0) / v.durations.length) : null,
  }));

  return new Response(JSON.stringify({
    ok: true, agency_id: agencyId, period, since, until: anchor.toISOString(),
    total_count: items.length, categories,
  }), { status: 200, headers: corsHeaders });
}

// ── 업무 성과/효율성 측정 — STAFF_TASK_QUEUE_v1_0.md §3 ──────────────
// (2026-07-14 신설, 1c891de 회귀로 삭제됐다가 이번에 복구됨)
async function _computeTaskStats(env, { targetType, targetId }) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`target_type='${targetType}' && target_id='${targetId}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/dept_tasks/records?filter=${filter}&perPage=200`,
    { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null);
  if (!res || !res.ok) return null;
  const json = await res.json().catch(() => null);
  const items = json?.items || [];
  const total = items.length;
  const completed = items.filter(t => t.status === 'completed');
  const rejected = items.filter(t => t.status === 'rejected');
  const durationsHrs = completed
    .map(t => (new Date(t.updated) - new Date(t.created)) / 3600000)
    .filter(h => h >= 0);
  const avgHrs = durationsHrs.length ? durationsHrs.reduce((a, b) => a + b, 0) / durationsHrs.length : null;
  return {
    total_count: total,
    completed_count: completed.length,
    rejected_count: rejected.length,
    completion_rate: total ? +(completed.length / total).toFixed(3) : null,
    avg_completion_hours: avgHrs !== null ? +avgHrs.toFixed(1) : null,
  };
}

async function handleStatsOrgCompare(request, env, corsHeaders) {
  const url = new URL(request.url);
  const orgIds = (url.searchParams.get('org_ids') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 20);
  if (!orgIds.length) return _err(400, 'MISSING_FIELD', 'org_ids 필수(콤마 구분, 최대 20개)', corsHeaders);
  const results = [];
  for (const orgId of orgIds) {
    const isOrgLevel = DEPT_TASK_TAXONOMY.org?.has(orgId) || DEPT_TASK_TAXONOMY.national?.has(orgId);
    if (!isOrgLevel) continue;
    const stats = await _computeTaskStats(env, { targetType: DEPT_TASK_TAXONOMY.national?.has(orgId) ? 'national' : 'org', targetId: orgId });
    if (stats) results.push({ org_id: orgId, ...stats });
  }
  return new Response(JSON.stringify({ ok: true, compared_at: new Date().toISOString(), results }), { status: 200, headers: corsHeaders });
}

async function handleStatsDeptCompare(bodyText, env, corsHeaders) {
  let body = null;
  try { body = JSON.parse(bodyText); } catch {}
  const deptIds = Array.isArray(body?.dept_ids) ? body.dept_ids.slice(0, 30) : [];
  if (!deptIds.length) return _err(400, 'MISSING_FIELD', 'dept_ids 필수', corsHeaders);
  if (!body?.access_cert || !body?.guid) return _err(401, 'MANAGER_ACCESS_CERT_REQUIRED', '부서 간 비교는 검증된 관리자만 조회할 수 있습니다(access_cert, guid 필수)', corsHeaders);
  const verifiedOrgId = await _verifyAccessCert(env, body.access_cert, body.guid, { _verifyEd25519Simple, _l1FindProfileByGuid }).catch(() => null);
  if (!verifiedOrgId) return _err(401, 'ACCESS_CERT_INVALID', '', corsHeaders);
  if (body.access_cert.role !== 'manager') return _err(403, 'MANAGER_ROLE_REQUIRED', 'staff 권한으로는 부서 비교를 조회할 수 없습니다', corsHeaders);
  const results = [];
  for (const deptId of deptIds) {
    if (!DEPT_TASK_TAXONOMY.dept?.has(deptId)) continue;
    const sameJurisdiction = deptId.split(':').slice(0, 2).join(':') === verifiedOrgId.split(':').slice(0, 2).join(':');
    if (!sameJurisdiction) continue;
    const stats = await _computeTaskStats(env, { targetType: 'dept', targetId: deptId });
    if (stats) results.push({ dept_id: deptId, ...stats });
  }
  return new Response(JSON.stringify({ ok: true, compared_at: new Date().toISOString(), results }), { status: 200, headers: corsHeaders });
}

async function handleStatsSelf(bodyText, env, corsHeaders) {
  let body = null;
  try { body = JSON.parse(bodyText); } catch {}
  const { guid, org_id, viewer_pubkey, viewer_sig, viewer_ts } = body || {};
  if (!guid || !org_id) return _err(400, 'MISSING_FIELD', 'guid/org_id 필수', corsHeaders);
  if (!viewer_pubkey || !viewer_sig) return _err(401, 'SIGNATURE_REQUIRED', '본인 서명이 필요합니다', corsHeaders);
  // (2026-07-14 추가 — ts 신선도 검증. worker.js 상단 _isFreshTs 주석 참고.)
  if (!_isFreshTs(viewer_ts)) return _err(401, 'STALE_TIMESTAMP', 'ts가 만료되었습니다', corsHeaders);
  const sigMsg = `view:${guid}:${viewer_pubkey}:${viewer_ts || ''}`;
  const sigOk = await _verifyEd25519Simple(viewer_pubkey, viewer_sig, sigMsg).catch(() => false);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '', corsHeaders);
  const profile = await _l1FindProfileByGuid(env, guid).catch(() => null);
  if (!profile?.pubkey_ed25519 || profile.pubkey_ed25519 !== viewer_pubkey) return _err(401, 'PUBKEY_MISMATCH', '', corsHeaders);
  const affList = profile.extra?.public?.identity?.affiliation || [];
  if (!affList.some(a => a.org_id === org_id && a.verified)) {
    return _err(403, 'NOT_A_VERIFIED_MEMBER', '해당 소속의 검증된 구성원이 아닙니다', corsHeaders);
  }
  const myStats = await _computeTaskStats(env, { targetType: 'staff', targetId: guid });
  const poolStats = await _computeTaskStats(env, { targetType: 'org_staff_pool', targetId: org_id });
  return new Response(JSON.stringify({
    ok: true, self: myStats, dept_average: poolStats,
    note: '이 값은 본인에게만 보입니다. 관리자는 이 조회 결과를 볼 수 없습니다.',
  }), { status: 200, headers: corsHeaders });
}

// POST /gov/dept-task/my-assignments — 배정된 STAFF_TASK_QUEUE 작업 확인.
async function handleMyAssignments(bodyText, env, corsHeaders) {
  let body = null;
  try { body = JSON.parse(bodyText); } catch {}
  const { guid, viewer_pubkey, viewer_sig, viewer_ts } = body || {};
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!viewer_pubkey || !viewer_sig) return _err(401, 'SIGNATURE_REQUIRED', '본인 서명이 필요합니다', corsHeaders);
  // (2026-07-14 추가 — ts 신선도 검증. worker.js 상단 _isFreshTs 주석 참고.)
  if (!_isFreshTs(viewer_ts)) return _err(401, 'STALE_TIMESTAMP', 'ts가 만료되었습니다', corsHeaders);
  const sigMsg = `view:${guid}:${viewer_pubkey}:${viewer_ts || ''}`;
  const sigOk = await _verifyEd25519Simple(viewer_pubkey, viewer_sig, sigMsg).catch(() => false);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '', corsHeaders);
  const profile = await _l1FindProfileByGuid(env, guid).catch(() => null);
  if (!profile?.pubkey_ed25519 || profile.pubkey_ed25519 !== viewer_pubkey) return _err(401, 'PUBKEY_MISMATCH', '', corsHeaders);

  const token = await _l1AdminToken(env);
  const results = [];

  const staffFilter = encodeURIComponent(
    `target_type='staff' && target_id='${guid}' && (status='requested' || status='acknowledged' || status='in_progress')`);
  const staffRes = await fetch(`${L1_DEFAULT}/api/collections/dept_tasks/records?filter=${staffFilter}&sort=-created&perPage=20`,
    { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null);
  if (staffRes?.ok) {
    const json = await staffRes.json().catch(() => null);
    for (const t of (json?.items || [])) {
      results.push({ task_id: t.id, mode: 'staff', requester_id: t.requester_id, task_type: t.task_type, directive: t.directive, status: t.status, created: t.created });
    }
  }

  const affList = profile.extra?.public?.identity?.affiliation || [];
  const verifiedOrgIds = affList.filter(a => a.verified && a.active !== false).map(a => a.org_id);
  for (const orgId of verifiedOrgIds.slice(0, 10)) {
    const poolFilter = encodeURIComponent(
      `target_type='org_staff_pool' && target_id='${orgId}' && (status='requested' || status='acknowledged' || status='in_progress')`);
    const poolRes = await fetch(`${L1_DEFAULT}/api/collections/dept_tasks/records?filter=${poolFilter}&sort=-created&perPage=20`,
      { headers: { 'Authorization': `Bearer ${token}` } }).catch(() => null);
    if (poolRes?.ok) {
      const json = await poolRes.json().catch(() => null);
      for (const t of (json?.items || [])) {
        results.push({ task_id: t.id, mode: 'org_staff_pool', org_id: orgId, requester_id: t.requester_id, task_type: t.task_type, directive: t.directive, status: t.status, created: t.created });
      }
    }
  }

  return new Response(JSON.stringify({ ok: true, count: results.length, assignments: results }), { status: 200, headers: corsHeaders });
}

// ── §4 guid→L1 소속 레지스트리 (L3 guid_home_l1 컬렉션) ──────────────
const L1_ONLY_NODE_IDS = [
  'KR-JEJU-JEJU-AEWOL',
  'KR-JEJU-JEJU-ARA',
  'KR-JEJU-JEJU-BONGGAE',
  'KR-JEJU-JEJU-CHUJA',
  'KR-JEJU-JEJU-DODU',
  'KR-JEJU-JEJU-GEONIP',
  'KR-JEJU-JEJU-GUJWA',
  'KR-JEJU-JEJU-HANGYEONG',
  'KR-JEJU-JEJU-HANLIM',
  'KR-JEJU-JEJU-HWABUK',
  'KR-JEJU-JEJU-IDO1',
  'KR-JEJU-JEJU-IDO2',
  'KR-JEJU-JEJU-IHO',
  'KR-JEJU-JEJU-ILDO1',
  'KR-JEJU-JEJU-ILDO2',
  'KR-JEJU-JEJU-JOCHEON',
  'KR-JEJU-JEJU-NOHYEONG',
  'KR-JEJU-JEJU-OEDO',
  'KR-JEJU-JEJU-ORA',
  'KR-JEJU-JEJU-SAMDO1',
  'KR-JEJU-JEJU-SAMDO2',
  'KR-JEJU-JEJU-SAMYANG',
  'KR-JEJU-JEJU-UDO',
  'KR-JEJU-JEJU-YEONDONG',
  'KR-JEJU-JEJU-YONGDAM1',
  'KR-JEJU-JEJU-YONGDAM2',
  'KR-JEJU-SGP-ANDEOK',
  'KR-JEJU-SGP-CHEONJI',
  'KR-JEJU-SGP-DAECHEON',
  'KR-JEJU-SGP-DAEJEONG',
  'KR-JEJU-SGP-DAERYUN',
  'KR-JEJU-SGP-DONGHONG',
  'KR-JEJU-SGP-HYODON',
  'KR-JEJU-SGP-JEONGBANG',
  'KR-JEJU-SGP-JUNGANG-SGP',
  'KR-JEJU-SGP-JUNGMUN',
  'KR-JEJU-SGP-NAMWON',
  'KR-JEJU-SGP-PYOSEON',
  'KR-JEJU-SGP-SEOHONG',
  'KR-JEJU-SGP-SEONGSAN',
  'KR-JEJU-SGP-SONGSAN',
  'KR-JEJU-SGP-YEONGCHEON',
  'KR-JEJU-SGP-YERAE',
];

// 판매자(또는 임의 guid)의 소속 L1을 L3 레지스트리에서 조회.
// 없으면 null 반환 — 호출부는 null을 "기본값(hanlim)"으로 처리한다.
async function _resolveHomeL1Node(env, guid) {
  try {
    const token = await _l1AdminTokenFor(env, L3_BASE);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const res = await fetch(`${L3_BASE}/api/collections/guid_home_l1/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json().catch(() => ({ items: [] }));
    return data.items?.[0]?.node_id || null;
  } catch (e) {
    console.warn('[HomeL1] 조회 실패(기본값으로 폴백):', e.message);
    return null;
  }
}

// guid의 소속 L1을 L3 레지스트리에 기록(가입/키등록 시점). 이미 있으면 갱신.
async function _writeHomeL1Node(env, guid, nodeId) {
  try {
    const token = await _l1AdminTokenFor(env, L3_BASE);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const existingRes = await fetch(`${L3_BASE}/api/collections/guid_home_l1/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const existingData = await existingRes.json().catch(() => ({ items: [] }));
    const existing = existingData.items?.[0];
    if (existing) {
      if (existing.node_id === nodeId) return; // 이미 같은 값 — 갱신 불필요
      await fetch(`${L3_BASE}/api/collections/guid_home_l1/records/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ node_id: nodeId }),
      });
    } else {
      await fetch(`${L3_BASE}/api/collections/guid_home_l1/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid, node_id: nodeId, registered_at: new Date().toISOString() }),
      });
    }
  } catch (e) {
    console.error('[HomeL1] 레지스트리 기록 실패(guid가 어느 L1 소속인지 못 찾게 될 수 있음):', e.message);
  }
}

// ── §5 브릿지 릴레이 — Worker가 허브로서 두 L1을 중개(P1: L1끼리 직접 통신 금지) ──
// bridge-in 성공 시 소스 L1에 completed로 갱신, 실패 시 그대로 두어(pending)
// scheduled() 크론 스윕이 재시도하게 한다.
async function _relayBridge(env, { sourceBase, targetNodeId, tx_hash, guid, amount }) {
  const targetBase = L1_NODE_MAP[targetNodeId] || null;
  if (!targetBase) {
    console.error('[Bridge] 대상 L1 URL을 못 찾음:', targetNodeId);
    return false;
  }
  try {
    const res = await fetch(`${targetBase}/api/bridge-in`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_hash, source_node: L1_NODE_MAP_ID_OF(sourceBase), guid, amount, bridge_secret: _bridgeSecret(env) }),
    });
    const data = await res.json().catch(() => ({ ok: false }));
    if (!data.ok) {
      console.warn('[Bridge] bridge-in 실패:', tx_hash, JSON.stringify(data));
      return false;
    }
    // 완료 처리 — 실패해도 치명적이지 않음(다음 스윕 때 재조회하면 이미
    // ok:true였던 tx_hash는 bridge-in의 멱등성이 지켜주므로 중복 크레딧 없음)
    await fetch(`${sourceBase}/api/bridge-out/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tx_hash, bridge_secret: _bridgeSecret(env) }),
    }).catch(e => console.warn('[Bridge] complete 통지 실패(다음 스윕에서 재시도):', e.message));
    console.info('[Bridge] 완료:', tx_hash, '→', targetNodeId);
    return true;
  } catch (e) {
    console.warn('[Bridge] 릴레이 실패(재시도 대상으로 남음):', tx_hash, e.message);
    return false;
  }
}

// sourceBase(URL)로부터 L1_NODE_MAP 역조회 — bridge-in 호출 시 "어느 L1에서
// 왔는지"를 상대 L1에 알려주기 위한 보조 함수.
function L1_NODE_MAP_ID_OF(base) {
  for (const [id, url] of Object.entries(L1_NODE_MAP)) if (url === base) return id;
  return 'UNKNOWN';
}

// L1 profiles 컬렉션에서 guid로 레코드 조회 (Admin 토큰 필요 — is_public=false인 레코드도 봐야 하므로)
// ── AI 사용량 상세 로그 (2026-07-14 신설) ──────────────────────────
// HONDI_CHAT_COST 콘솔 로그는 조회가 안 되므로(Cloudflare 로그는
// 검색·집계용이 아니다), /usage.html의 모델별·기간별 상세 내역을
// 위해 L1에 요청 단위로 영구 기록한다. 컬렉션 스키마는
// pb_migrations/1784800001_created_ai_usage_log.js 참조.
async function _l1CreateUsageLog(env, { guid, serviceId, tier, model, hitTokens, missTokens, outTokens, costKRW, billedKRW }) {
  if (!guid) return;
  try {
    const token = await _l1AdminToken(env);
    const res = await fetch(`${L1_DEFAULT}/api/collections/ai_usage_log/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, service_id: serviceId || 'hondi-chat', tier: tier || '', model: model || '',
        hit_tokens: Math.round(hitTokens || 0), miss_tokens: Math.round(missTokens || 0),
        out_tokens: Math.round(outTokens || 0),
        cost_krw: Math.round((costKRW || 0) * 100) / 100,
        billed_krw: Math.round((billedKRW || 0) * 100) / 100,
      }),
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn('[UsageLog] 기록 실패 (HTTP ' + res.status + '): ' + errText);
    }
  } catch (e) {
    // 사용량 로그 기록 실패가 실제 채팅 응답을 막아서는 안 된다 — 조용히 경고만 남긴다.
    console.warn('[UsageLog] 기록 실패:', e.message);
  }
}

// ── AI 사용량 계산+기록 공통 함수 (2026-07-14 신설) ──────────────────
// callDeepSeek(일반 챗)·handleKlawRelay·handleBusinessRelay·handleGovRelay가
// 전부 이 함수 하나를 호출한다. "모든 AC/SP에 로그를 붙여야 한다"는
// 요구에 대한 답: gov/relay와 biz/relay는 이미 각각 342개 국가기관·모든
// 사업체 유형을 agency/business_id 파라미터로 처리하는 단일 공유
// 엔드포인트이므로, 이 두 곳만 연결하면 사실상 "모든 AC/SP"가 한 번에
// 커버된다 — 기관 하나하나에 반복 연결할 필요가 없다.
//
// 왜 별도 파일(src/worker/*.js)로 빼지 않았는가: 지금 이 함수를 호출하는
// 4곳이 전부 이미 worker.js 안에 있다. 별도 모듈로 빼려면
// computeBilledKRW·_l1CreateUsageLog·_klawSpendAdd 등 worker.js 로컬
// 헬퍼 여러 개를 매개변수로 주입해야 하는데, 지금 시점엔 그 비용이
// 이득보다 크다. 나중에 relay 핸들러들을 ai-chat-handler.js처럼 별도
// 파일로 옮기게 되면, 그때 이 함수도 같이 옮기면 된다 — 아래는 클로저를
// 최소화해 순수 함수에 가깝게 작성해뒀으므로 그 시점의 이관 비용은 낮다.
//
// spendKeys: 서비스별 KV 예산 카운터 키 목록(예: [1인1일 한도 키, 계정
// 전체 한도 키]). 30시간 TTL로 자동 리셋되는 _klawSpendAdd를 그대로
// 재사용한다 — 이름은 klaw 전용처럼 보이지만 실제로는 K-Law 전용이 아닌
// 범용 "KV 카운터 누적" 헬퍼다(2026-07-02 K-Law용으로 먼저 만들어졌을
// 뿐). 일반 챗의 "평생 누적 무료 한도"(_recordFreeSpend)는 TTL이 없어야
// 하므로 spendKeys가 아니라 onAfterRecord로 별도 처리한다 — 여기 섞으면
// 무료 한도가 30시간마다 조용히 리셋되는 심각한 회귀가 생긴다.
async function _recordAiUsage(env, ctx, {
  guid, serviceId, tier, priceTier, model, usage,
  logTag, extraLogFields = {}, spendKeys = [], onAfterRecord = null,
}) {
  if (!usage) return null;
  const bill = computeBilledKRW(env, usage, priceTier);
  console.log(JSON.stringify({
    tag: logTag, guid, tier, apiCostKRW: bill.apiCostKRW, billedKRW: bill.billedKRW,
    multiplier: bill.multiplier, ts: new Date().toISOString(), ...extraLogFields,
  }));

  const tasks = [
    _l1CreateUsageLog(env, {
      guid, serviceId, tier, model,
      hitTokens: usage?.prompt_cache_hit_tokens, missTokens: usage?.prompt_cache_miss_tokens,
      outTokens: usage?.completion_tokens, costKRW: bill.apiCostKRW, billedKRW: bill.billedKRW,
    }),
    ...spendKeys.map(key => _klawSpendAdd(env, key, bill.billedKRW)),
  ];
  if (onAfterRecord) tasks.push(Promise.resolve(onAfterRecord(bill)));

  const combined = Promise.all(tasks);
  if (ctx?.waitUntil) ctx.waitUntil(combined);
  else combined.catch(e => console.warn('[UsageRecord] 기록 실패:', e.message));
  return bill;
}


// GET /usage-log?guid=...&days=30 이 호출하는 조회+집계 함수.
// PocketBase REST에는 GROUP BY가 없으므로, 기간 내 레코드를 그대로
// 받아와 Worker에서 집계한다 — 개인 사용자 단위라 레코드 수가
// 많지 않으므로(하루 수십~수백 건 수준) 이 방식으로 충분하다.
async function _l1QueryUsageLog(env, guid, days) {
  const token = await _l1AdminToken(env);
  const sinceISO = new Date(Date.now() - days * 86400000).toISOString().replace('T', ' ').slice(0, 19);
  const filter = encodeURIComponent(`guid='${guid}' && created>='${sinceISO}'`);
  let page = 1, items = [];
  // PocketBase 기본 perPage 상한(500) 안에서, 필요하면 페이지네이션.
  for (;;) {
    const res = await fetch(
      `${L1_DEFAULT}/api/collections/ai_usage_log/records?filter=${filter}&perPage=500&page=${page}&sort=-created`,
      { headers: { 'Authorization': `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`ai_usage_log 조회 실패 (HTTP ${res.status})`);
    const data = await res.json();
    items = items.concat(data.items || []);
    if (page >= (data.totalPages || 1)) break;
    page++;
  }
  return items;
}

// 가입자 GUID로 profiles 레코드 조회
async function _l1FindProfileByGuid(env, guid) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`guid='${guid}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

// L1 profiles 컬렉션에서 handle로 레코드 조회 — 관리자 일괄삭제에서 @handle 입력을 guid로 환산할 때 사용
async function _l1FindProfileByHandle(env, handle) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`handle='${handle}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

// L1 profiles 레코드 PATCH (Admin 토큰 필요 — Update rule이 Admins only이므로)

async function _l1PatchProfile(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`L1 PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

// ── 소속(affiliation) 승인 — AC-EVOLUTION_v1_1.md §3 ─────────────────
// createDeptTaskCore와 정확히 같은 신뢰 모델: authoritativeAgency가 없으면
// (=순수 HTTP POST) dept/org 승인자는 무조건 거부한다. "내가 위생과
// 관리자다"를 자유 텍스트로 자칭해서 통과할 방법이 없다 — 반드시
// handleGovRelay/handleBusinessRelay가 실제로 그 agency/bizKey 세션 안에서
// 감지한 [AFFILIATION_APPROVE] 태그를 통해서만 호출된다.
//
// 2026-07-13 — 전 직종 확대 반영. org_id가 07-org 고정목록(org:JTO 등)이
// 아니어도, handleBusinessRelay와 동일한 규칙(DEPT_TASK_REQUEST가 이미
// org:{bizKey} 형식을 쓴다)으로 민간기업도 org_id="org:{bizKey}" 형태로
// 그대로 받는다 — 고정 목록이 아니라 _validateTarget의 business 분기와
// 동일하게 L1에 실존하고 claim된 사업자인지로 검증한다(신규 사업자는
// 매일 생기므로 하드코딩 목록이 성립하지 않는다는 dept-task-handler.js의
// 기존 원칙을 그대로 계승).
async function approveAffiliationCore(env, { orgId, targetGuid, approverLabel = '', evidence = '' }, opts = {}) {
  const { authoritativeAgency = null } = opts;
  if (!orgId || !targetGuid) return { ok: false, reason: 'MISSING_FIELD' };

  const orgType = orgId.startsWith('city-dept:') || orgId.startsWith('do-dept:') || orgId.startsWith('do-agency:')
    ? 'dept' : orgId.startsWith('org:') ? 'org' : orgId.startsWith('national:') ? 'national' : null;
  if (!orgType) return { ok: false, reason: 'UNKNOWN_ORG_TYPE' };

  if (orgType === 'org') {
    const fixedOrgSet = DEPT_TASK_TAXONOMY.org;
    if (!fixedOrgSet.has(orgId)) {
      // 07-org 고정목록에 없으면 "org:{bizKey}" 형태의 민간기업으로 간주 —
      // _validateTarget(dept-task-handler.js)의 business 분기와 동일 검증.
      const bizGuid = orgId.slice('org:'.length);
      const bizProfile = await _l1FindProfileByGuid(env, bizGuid).catch(() => null);
      if (!bizProfile) return { ok: false, reason: 'ORG_NOT_REGISTERED' };
      const claimStatus = bizProfile.claim_status ?? bizProfile.extra?.claim_status;
      if (claimStatus === 'unclaimed') return { ok: false, reason: 'ORG_BUSINESS_UNCLAIMED' };
    }
  } else {
    const taxonomySet = DEPT_TASK_TAXONOMY[orgType === 'national' ? 'national' : orgType];
    if (!taxonomySet || !taxonomySet.has(orgId)) return { ok: false, reason: 'ORG_NOT_REGISTERED' };
  }

  // 이 승인 행위 자체가 "그 기관을 대표해 하는 행동"이므로, dept-task
  // 요청과 동일한 강도로 authoritativeAgency를 요구한다 — 여기서
  // requesterType은 항상 'dept'|'org'로 취급(승인자는 곧 그 기관이므로).
  const authCheck = _authoritativeCheck(orgType === 'national' ? 'dept' : orgType, orgId, authoritativeAgency);
  if (!authCheck.ok) return { ok: false, reason: authCheck.reason };

  const profile = await _l1FindProfileByGuid(env, targetGuid).catch(() => null);
  if (!profile) return { ok: false, reason: 'TARGET_NOT_FOUND' };

  const prevExtra = profile.extra || {};
  const prevIdentity = (prevExtra.public || {}).identity || {};
  const affList = Array.isArray(prevIdentity.affiliation) ? prevIdentity.affiliation : [];
  const idx = affList.findIndex(a => a.org_id === orgId);
  if (idx === -1) {
    return { ok: false, reason: 'AFFILIATION_NOT_REQUESTED', detail: '해당 org_id로 신청된 소속 레코드가 없습니다 — 사용자가 먼저 프로필에서 소속을 신고해야 합니다' };
  }

  const now = new Date().toISOString();
  // AC-EVOLUTION-GAPS #4 — 재확인 주기. AC-AUTHOR §7과 동일하게 30일로
  // 통일(공무원 소속은 job_ksco보다 변경 빈도가 낮을 수 있지만, 퇴직·전보
  // 누락 위험이 더 크므로 더 짧은 주기를 우선한다).
  const reviewDue = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  // AC-EVOLUTION-GAPS #6 — 관리자가 "이 사람이 진짜 우리 직원 맞다"를
  // 무엇을 보고 판단했는지 근거를 함께 남긴다(사번·기관메일 등 자유
  // 텍스트 — 이 저장소가 사번 체계를 직접 검증할 방법은 없으므로 형식
  // 검증은 하지 않고 감사 기록으로만 남긴다. 동명이인 오승인 자체를
  // 막지는 못하지만, 나중에 "무엇을 근거로 승인했는지" 추적은 가능해진다).
  affList[idx] = {
    ...affList[idx], verified: true, verified_at: now, verified_by: approverLabel || orgId,
    verified_evidence: evidence ? String(evidence).slice(0, 200) : null,
    review_due: reviewDue, revoked_at: null, revoked_by: null,
  };

  const newExtra = {
    ...prevExtra,
    public: { ...(prevExtra.public || {}), identity: { ...prevIdentity, affiliation: affList } },
  };
  await _l1PatchProfile(env, profile.id, { extra: newExtra });
  return { ok: true, org_id: orgId, target_guid: targetGuid, review_due: reviewDue };
}

// ── 소속 철회 — AC-EVOLUTION-GAPS #4 완결 ─────────────────────────────
// approveAffiliationCore의 짝. 퇴직·전보 시 기관 측이 명시적으로
// 철회한다(자동 만료가 아니라 명시적 행위 — 관리자가 잊으면 여전히
// 남아있을 수 있다는 잔여 위험은 있지만, 최소한 "철회할 방법이 아예
// 없는" 상태보다는 낫다. 완전 자동화하려면 각 기관 인사시스템과의
// 연동이 필요한데 그건 이 저장소 밖의 과제).
async function revokeAffiliationCore(env, { orgId, targetGuid, revokerLabel = '', reason = '' }, opts = {}) {
  const { authoritativeAgency = null } = opts;
  if (!orgId || !targetGuid) return { ok: false, reason: 'MISSING_FIELD' };
  const orgType = orgId.startsWith('city-dept:') || orgId.startsWith('do-dept:') || orgId.startsWith('do-agency:')
    ? 'dept' : orgId.startsWith('org:') ? 'org' : orgId.startsWith('national:') ? 'national' : null;
  if (!orgType) return { ok: false, reason: 'UNKNOWN_ORG_TYPE' };
  const authCheck = _authoritativeCheck(orgType === 'national' ? 'dept' : orgType, orgId, authoritativeAgency);
  if (!authCheck.ok) return { ok: false, reason: authCheck.reason };

  const profile = await _l1FindProfileByGuid(env, targetGuid).catch(() => null);
  if (!profile) return { ok: false, reason: 'TARGET_NOT_FOUND' };
  const prevExtra = profile.extra || {};
  const prevIdentity = (prevExtra.public || {}).identity || {};
  const affList = Array.isArray(prevIdentity.affiliation) ? prevIdentity.affiliation : [];
  const idx = affList.findIndex(a => a.org_id === orgId);
  if (idx === -1) return { ok: false, reason: 'AFFILIATION_NOT_FOUND' };

  affList[idx] = {
    ...affList[idx], verified: false, active: false,
    revoked_at: new Date().toISOString(), revoked_by: revokerLabel || orgId,
    revoke_reason: reason ? String(reason).slice(0, 200) : null,
  };
  const newExtra = {
    ...prevExtra,
    public: { ...(prevExtra.public || {}), identity: { ...prevIdentity, affiliation: affList } },
  };
  await _l1PatchProfile(env, profile.id, { extra: newExtra });
  return { ok: true, org_id: orgId, target_guid: targetGuid };
}

// AC-EVOLUTION-GAPS #4 — review_due가 지났으면 재확인 전까지 "검증됨"으로
// 취급하지 않는다(자동 revoke는 아니고, 소비하는 쪽이 이 함수로 판단만
// 하게 한다 — DB 값 자체를 배치로 고치는 크론은 별도 과제로 남긴다).
function _isAffiliationCurrentlyVerified(affEntry) {
  if (!affEntry || !affEntry.verified || affEntry.active === false) return false;
  if (affEntry.review_due && new Date(affEntry.review_due) < new Date()) return false;
  return true;
}

// ── 업무영역 PDV 조회 요청 게이트 — AC-EVOLUTION_v1_1.md §PDV-SPLIT ──────
// "업무 영역은 명시적으로 권한을 부여받은 사람이나 기관, 또는 에이전트만
// 데이터 제출을 요청할 수 있다"(주피터님 지시)를 코드로 강제한다.
// approveAffiliationCore와 동일한 신뢰 모델 재사용 — authoritativeAgency
// 없이는(순수 HTTP POST) 무조건 거부한다.
//
// ★ 2026-07-13 재설계 — 주피터님 지시로 "풀(pull)"에서 "요청(request)"
// 모델로 전면 수정. 이전 버전은 verified:true인 소속만 있으면 서버가
// 곧바로 데이터를 반환했는데, 이건 AGENCY-AC-COMMON v1.3 공리 0-4("부서
// SP는 소속 직원 개인의 AC를 관리·감독하지 않는다")와 정면으로 배치된다.
// 지금 버전은 기관/에이전트가 "요청"만 할 수 있고, 실제로 데이터를
// 내줄지는 대상자 본인(AC 사용자)이 매번 결정한다 — 의사가 환자의
// 과거 병력을 요청할 수 있어도 제공 여부는 환자 본인 결정인 것과
// 동일한 구조(주피터님 예시). 그래서 기존 handlePdvQuery가 이미 갖고
// 있던 동의 요청 인프라(_storeConsentRequest)를 그대로 재사용한다 —
// 새 동의 메커니즘을 또 만들지 않는다.
//
// 요청 허용 기준도 "대상자와 사전에 verified 소속이 있어야 한다"에서
// "요청자 자신이 실제로 존재가 검증된 기관/사업자/에이전트다"로
// 완화했다 — 의사·부서 둘 다 "이 특정 환자/직원과 이미 소속 관계가
// 있어야 요청 가능"이 아니라 "등록된 정당한 기관이면 누구든 요청은
// 할 수 있고, 승인 여부만 당사자가 정한다"는 게 지시받은 원칙이다.
async function requestWorkDomainPdvCore(env, { orgId, targetGuid, purpose = '' }, opts = {}) {
  const { authoritativeAgency = null } = opts;
  if (!orgId || !targetGuid) return { ok: false, reason: 'MISSING_FIELD' };

  const orgType = orgId.startsWith('city-dept:') || orgId.startsWith('do-dept:') || orgId.startsWith('do-agency:')
    ? 'dept' : orgId.startsWith('org:') ? 'org' : orgId.startsWith('national:') ? 'national' : null;
  if (!orgType) return { ok: false, reason: 'UNKNOWN_ORG_TYPE' };

  if (orgType === 'org' && !DEPT_TASK_TAXONOMY.org.has(orgId)) {
    // 07-org 고정목록 밖이면 민간기업(org:{bizKey}) — approveAffiliationCore와
    // 동일하게 L1 실존+claimed 여부로 검증.
    const bizGuid = orgId.slice('org:'.length);
    const bizProfile = await _l1FindProfileByGuid(env, bizGuid).catch(() => null);
    if (!bizProfile) return { ok: false, reason: 'ORG_NOT_REGISTERED' };
    const claimStatus = bizProfile.claim_status ?? bizProfile.extra?.claim_status;
    if (claimStatus === 'unclaimed') return { ok: false, reason: 'ORG_BUSINESS_UNCLAIMED' };
  } else if (orgType !== 'org') {
    const taxonomySet = DEPT_TASK_TAXONOMY[orgType === 'national' ? 'national' : orgType];
    if (!taxonomySet || !taxonomySet.has(orgId)) return { ok: false, reason: 'ORG_NOT_REGISTERED' };
  }

  // 요청자 신원 자체는 검증하되(자칭 방지), 이 특정 대상자와 사전에
  // verified 소속이 있어야 한다는 요구는 하지 않는다(위 설명 참고).
  const authCheck = _authoritativeCheck(orgType === 'national' ? 'dept' : orgType, orgId, authoritativeAgency);
  if (!authCheck.ok) return { ok: false, reason: authCheck.reason };

  const profile = await _l1FindProfileByGuid(env, targetGuid).catch(() => null);
  if (!profile) return { ok: false, reason: 'TARGET_NOT_FOUND' };

  // 기존 handlePdvQuery와 동일한 동의요청 레코드를 그대로 재사용한다 —
  // scope를 "work_pdv:{orgId}"로 지정해, 승인 후 실제 데이터 조회 시
  // handlePdvQuery가 L1 기반 조회 경로로 분기하도록 표시해 둔다(아래
  // handlePdvQuery 수정 참고 — 일반 scope는 여전히 레거시 Supabase
  // pdv_log를 읽지만, work_pdv:*는 L1 pdv_records를 읽는다).
  const reqId = `WPDVREQ-${targetGuid.replace(/:/g, '').slice(0, 8)}-${Date.now()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + 3600; // 업무 요청은 즉답 압박이 없어 1시간으로 여유
  await _storeConsentRequest(env, reqId, {
    ipv6: targetGuid, svc: orgId, scope: [`work_pdv:${orgId}`],
    purpose: purpose || '(목적 미기재)',
    period: { start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10), end: new Date().toISOString().slice(0, 10) },
  }, expiresAt);

  const consentUrl = 'https://hondi.net/consent' +
    `?req=${encodeURIComponent(reqId)}&svc=${encodeURIComponent(orgId)}` +
    `&scope=work_pdv&purpose=${encodeURIComponent(purpose || '')}`;

  return { ok: true, status: 'PENDING_USER_APPROVAL', request_id: reqId, consent_url: consentUrl };
}


// _l1FindProfileByGuid 등 기존 함수와 동일 패턴(컬렉션별 전용 함수,
// 범용 _l1Find/_l1Create 같은 건 이 코드베이스에 없다 — 이전 설계
// 문서(worker_orchestration_registry_patch_2026-07-08.md)가 가정했던
// 범용 헬퍼는 실제 코드와 안 맞아 이번에 컬렉션별 전용 함수로 정정함).

async function _l1FindProcedureMap(env, goal) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`goal='${goal.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/procedure_maps/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`procedure_maps 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1CreateProcedureMap(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/procedure_maps/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`procedure_maps 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1PatchProcedureMap(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/procedure_maps/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`procedure_maps PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1FindOrgProfile(env, orgId) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`org_id='${orgId.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/org_profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`org_profiles 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1FindAtomRow(env, atomId) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`atom_id='${atomId.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/atom_rows/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`atom_rows 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

// ★ 2026-07-09 추가 — org_profiles/atom_rows에는 지금까지 조회(Find)
// 함수만 있고 생성(Create) 함수가 없어서, 개인파산 사고실험 데이터를
// 시딩할 방법 자체가 없었다(procedure_maps만 draft POST가 있었음).
// _l1CreateProcedureMap과 동일 패턴으로 나머지 둘도 채운다.

async function _l1CreateOrgProfile(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/org_profiles/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`org_profiles 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1CreateAtomRow(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/atom_rows/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`atom_rows 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

// ★ 2026-07-09 추가 — N-08 통합테스트에서 발견된 구멍을 메운다.
// draft로 심은 org_profiles/atom_rows는 항상 pending_review로 시작하는데
// (핸들러가 이미 그렇게 강제함), 그걸 active로 승격할 방법이 procedure_maps
// 와 달리 없어서 관리자 패널 수동 조작에 의존해야 했다. _l1PatchProcedureMap
// 과 동일 패턴으로 채운다.

async function _l1PatchOrgProfile(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/org_profiles/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`org_profiles PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1PatchAtomRow(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/atom_rows/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`atom_rows PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

// ── 오케스트레이션 HTTP 핸들러 (2026-07-08 신설) ────────────────────
// status:active인 항목만 실제 라우팅에 안전하게 쓸 수 있다고 간주한다
// — draft/pending_review는 조회는 되지만 호출자(K-Compose)가 이용자에게
// "아직 검토 중"이라고 고지해야 한다(AGENT-COMMON §3-0 SP_DRAFT_REQUEST와
// 동일한 승인 원칙, 여기서도 그대로 적용).

// ★ 2026-07-11 추가 — SP-Author 자동화(신호 큐잉 + ESCALATE 최소구현).
// 지금까지 [SP_DRAFT_REQUEST]/[GOV_SP_DRAFT_REQUEST]/[ESCALATE] 태그가
// 나가도 그걸 받아 저장하는 곳이 없어(call-ai.js 주석: "아직 미처리") 신호가
// 허공으로 사라졌다. sp_draft_requests(큐)·escalations(알림)를 채운다.
// SP-Author 자체(실제 조사·작성)는 여전히 사람이 수행하지만, 최소한
// "무엇을 검토해야 하는지"가 유실되지 않고 대시보드에서 조회 가능해진다.

async function _l1CreateDraftRequest(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/sp_draft_requests/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`sp_draft_requests 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1FindOpenDraftRequest(env, institution, task, targetSpId) {
  // 같은 (institution, task) 조합의 queued/assigned 요청이 이미 있으면
  // 새로 만들지 않고 그 레코드를 재사용한다(중복 신호 누적 방지 — 같은
  // 기관 공백을 여러 이용자가 같은 날 건드리면 큐가 도배될 수 있다).
  //
  // ★ 2026-07-11 Phase 4 버그 수정 ★ request_type=update(정기 갱신 등)
  // 신호는 institution이 비어 있고 task가 전부 같은 정형 문구("정기
  // 갱신 — tier 스케줄 도래...")라서, 원래 필터로는 서로 다른 SP의
  // 갱신 요청이 전부 같은 (institution='', task='정기 갱신...')으로
  // 매칭돼 첫 번째 요청 하나로 뭉개지는 버그가 있었다(로컬 통합테스트로
  // 재현). target_sp_id가 있으면 그걸로 식별하고, 없으면(신규 기관
  // 발굴 등) 기존 institution+task 방식을 그대로 쓴다.
  const token = await _l1AdminToken(env);
  let filter;
  if (targetSpId) {
    filter = encodeURIComponent(
      `target_sp_id='${targetSpId.replace(/'/g, "\\'")}' && (status='queued' || status='assigned')`
    );
  } else {
    filter = encodeURIComponent(
      `institution='${(institution || '').replace(/'/g, "\\'")}' && task='${(task || '').replace(/'/g, "\\'")}' && (status='queued' || status='assigned')`
    );
  }
  const res = await fetch(`${L1_DEFAULT}/api/collections/sp_draft_requests/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null; // 조회 실패는 중복확인 스킵으로 처리(신규 생성 진행)
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1ListDraftRequests(env, status) {
  const token = await _l1AdminToken(env);
  const filter = status ? encodeURIComponent(`status='${status}'`) : '';
  const url = `${L1_DEFAULT}/api/collections/sp_draft_requests/records?perPage=200&sort=-created` +
    (filter ? `&filter=${filter}` : '');
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`sp_draft_requests 목록 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items || [];
}

async function _l1PatchDraftRequest(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/sp_draft_requests/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`sp_draft_requests PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1CreateEscalation(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/escalations/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`escalations 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1ListEscalations(env, unreadOnly) {
  const token = await _l1AdminToken(env);
  const filter = unreadOnly ? encodeURIComponent(`read=false`) : '';
  const url = `${L1_DEFAULT}/api/collections/escalations/records?perPage=200&sort=-created` +
    (filter ? `&filter=${filter}` : '');
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  if (!res.ok) throw new Error(`escalations 목록 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items || [];
}

async function _l1FindRefreshSchedule(env, spId) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`sp_id='${spId.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/sp_refresh_schedule/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sp_refresh_schedule 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1UpsertRefreshSchedule(env, spId, patch) {
  const existing = await _l1FindRefreshSchedule(env, spId);
  const token = await _l1AdminToken(env);
  if (existing) {
    const res = await fetch(`${L1_DEFAULT}/api/collections/sp_refresh_schedule/records/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(`sp_refresh_schedule PATCH 실패 (HTTP ${res.status})`);
    return res.json();
  }
  const res = await fetch(`${L1_DEFAULT}/api/collections/sp_refresh_schedule/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ sp_id: spId, ...patch }),
  });
  if (!res.ok) throw new Error(`sp_refresh_schedule 생성 실패 (HTTP ${res.status})`);
  return res.json();
}

async function _l1ListDueRefreshSchedules(env) {
  // next_due_at <= 오늘인 항목 — 갱신 대상 조회(§SP-REFRESH-METHODOLOGY 참조)
  const token = await _l1AdminToken(env);
  const today = new Date().toISOString().slice(0, 10);
  const filter = encodeURIComponent(`next_due_at <= '${today}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/sp_refresh_schedule/records?filter=${filter}&perPage=200`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`sp_refresh_schedule 마감목록 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items || [];
}

const ORCHESTRATION_STALE_THRESHOLD_DAYS = 90; // 신선도 경고 임계값(임의값, 운영 중 조정 필요)

function _daysSince(dateStr) {
  if (!dateStr) return Infinity;
  return (Date.now() - new Date(dateStr).getTime()) / 86400000;
}

async function handleProcedureMapLookup(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const goal = searchParams.get('goal');
  if (!goal) return new Response(JSON.stringify({ error: 'goal required' }), { status: 400, headers: corsHeaders });

  let rec;
  try {
    rec = await _l1FindProcedureMap(env, goal);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
  if (!rec) return new Response(JSON.stringify({ status: 'miss' }), { headers: corsHeaders });

  const steps = rec.steps || [];
  // steps 각 항목의 atom_id를 실제 atom_rows로 조인 — sub_goal 항목은
  // atom이 아니므로 조인하지 않고 그대로 둔다(K-Compose가 재귀 조회).
  const resolvedSteps = await Promise.all(steps.map(async (s) => {
    if (s.sub_goal) return s;
    try {
      const atom = await _l1FindAtomRow(env, s.atom_id);
      return { ...s, atom };
    } catch {
      return { ...s, atom: null };
    }
  }));

  const body = {
    status: rec.status === 'active' ? 'hit' : 'hit_pending_review',
    procedure: { ...rec, steps: resolvedSteps },
  };
  if (_daysSince(rec.as_of_date) > ORCHESTRATION_STALE_THRESHOLD_DAYS) {
    body.freshness_warning = `이 절차 정보는 ${rec.as_of_date} 기준입니다 — 재검증 권장`;
  }
  return new Response(JSON.stringify(body), { headers: corsHeaders });
}

// ── 혜택 후보 검색 (2026-07-16 신설, 2026-07-16 v2 — 100건 사고실험
//    docs/BENEFIT_CANDIDATE_SEARCH_100_thought_experiment_2026-07-16.md
//    에서 발견된 치명적 결함 3건 + 심각 2건 + 중간 1건 반영) ──
// 배경: _l1FindProcedureMap(위)는 goal 완전일치라 "이용자가 정확한
// 사업명을 이미 알고 있음"을 전제한다. 하지만 혜택 카탈로그(gov24
// civil-petitions, procedure_maps에 10,289건 시딩됨)의 실제 용도는
// 그 반대 — "청년인데 뭐 받을 거 있어?"처럼 사업명을 모르는 상태에서
// 후보를 찾아주는 것이다.
//
// v2에서 고친 것:
//  1. (치명적) keywords[] 다중 조건 AND 검색 신설 — v1은 q가 단일
//     문자열이라 "청년 30세"처럼 여러 속성을 조합한 재검색이
//     구조적으로 불가능했다(그 연속 문자열이 원문에 있을 리 없음).
//     이제 keywords=청년,30세처럼 콤마 구분으로 넘기면 각각 독립된
//     LIKE 절로 만들어 AND 결합한다 — STEP 0-C의 "속성 하나씩 좁혀
//     재검색"이 실제로 의미를 갖게 된다.
//  2. (치명적) 불용어·최소길이 필터링 — q="지원"이 전체의 73.6%를
//     삼키던 문제. 조사·범용 행정용어를 STOPWORDS로 걸러내고, 필터링
//     후 남은 키워드가 하나도 없으면 400으로 명확히 거부한다(임의
//     30건을 의미있는 결과처럼 반환하지 않는다).
//  3. (심각) domain 정규화 — K-Intent가 넘기는 자유텍스트 domain이
//     고정 10종과 안 맞으면(예: "취업"·"창업지원") 매핑을 시도하고,
//     매핑 실패 시 domain 절 자체를 버린다(예전처럼 q까지 함께
//     죽이지 않는다).
//  4. (심각) total_match_estimate 추가 — PocketBase 응답의 totalItems
//     를 그대로 실어보내, K-Compose가 "30건이 전부"와 "2,117건 중
//     30건"을 구분할 수 있게 한다.
//  5. (중간) 띄어쓰기 정규화 폴백 — 1차 검색이 0건이면, 공백을 제거한
//     키워드로 넓게(앞 2~4글자) 재조회한 뒤 애플리케이션 레벨에서
//     공백을 지운 문자열끼리 포함 여부를 다시 검사한다("친환경농산물"
//     이 "친환경 농산물"을 찾게 한다).
//  6. (경미) limit 0·음수를 명시적으로 30으로 강제(기존엔 JS falsy
//     함정에 암묵적으로 의존했다).
//
// ★ 정직한 한계 ★ 그래도 진짜 의미검색(semantic search)은 아니다 —
// 동의어(예: "MZ세대" vs "청년")는 여전히 못 잡는다. 후보를 넉넉히
// 반환해 K-Compose가 직접 읽고 판단하게 하는 이유가 이거다 — 서버가
// 아니라 모델이 최종 적합성을 판단한다.

const BENEFIT_SEARCH_STOPWORDS = new Set([
  '지원', '신청', '확인', '사업', '제도', '혜택', '보조금', '바우처',
  '이용', '대상', '안내', '관련', '있나요', '있어요', '알려줘', '해줘',
  '받고', '받을', '싶어요', '무엇', '무슨', '어떤', '위한',
]);

const BENEFIT_DOMAIN_MAP = {
  '농림축산어업': ['농업', '축산', '어업', '임업', '농림'],
  '행정·안전': ['행정', '안전', '재난'],
  '보건·의료': ['보건', '의료', '건강', '병원'],
  '생활안정': ['생활안정', '생계', '저소득'],
  '보호·돌봄': ['돌봄', '보호', '요양'],
  '문화·환경': ['문화', '환경', '관광', '체육'],
  '주거·자립': ['주거', '주택', '자립', '전세', '임대'],
  '임신·출산': ['임신', '출산', '산모'],
  '보육·교육': ['보육', '교육', '어린이집', '학교'],
  '고용·창업': ['고용', '창업', '취업', '일자리', '소상공인'],
};

function _normalizeBenefitDomain(freeText) {
  if (!freeText) return null;
  if (BENEFIT_DOMAIN_MAP[freeText]) return freeText; // 이미 고정 10종과 정확히 일치
  const t = freeText.replace(/[·\s]/g, '');
  for (const [fixed, hints] of Object.entries(BENEFIT_DOMAIN_MAP)) {
    if (hints.some((h) => t.includes(h)) || fixed.replace(/[·\s]/g, '').includes(t)) {
      return fixed;
    }
  }
  return null; // 매핑 실패 — 절대 원문 그대로 필터에 쓰지 않는다(q까지 죽이는 사고 방지)
}

function _cleanBenefitKeywords(raw) {
  // ★ 2026-07-16 v2 — 구분자를 콤마가 아니라 '+'로 쓴다. 이 함수를
  // 호출하는 call-ai.js의 태그 파싱(benefitSearchMatch[1].split(','))이
  // 태그 전체를 콤마로 나누기 때문에, q 값 안에 콤마를 쓰면
  // "q=청년,30세"가 "q=청년"과 "30세"(키 없음, 유실)로 깨진다.
  // '+'는 그 파싱과 충돌하지 않는다. 공백 구분(단일 문자열)도 계속 지원.
  const tokens = raw.includes('+') ? raw.split('+') : raw.split(/\s+/);
  return tokens
    .map((t) => t.trim())
    .filter((t) => t.length >= 2 && !BENEFIT_SEARCH_STOPWORDS.has(t));
}

async function handleBenefitCandidateSearch(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const qRaw = searchParams.get('q') || searchParams.get('keywords');
  const domainRaw = searchParams.get('domain');
  let limit = parseInt(searchParams.get('limit') || '30', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 30; // ★ 경미-6 수정
  limit = Math.min(limit, 50);

  const keywords = qRaw ? _cleanBenefitKeywords(qRaw) : [];
  const domain = _normalizeBenefitDomain(domainRaw);

  if (!qRaw && !domainRaw) {
    return new Response(JSON.stringify({ error: 'q(or keywords) or domain required' }), { status: 400, headers: corsHeaders });
  }
  // ★ 치명적-2 수정: 불용어 제거 후 아무 것도 안 남으면 "전체 카탈로그
  // 무작위 30건"을 그럴듯한 결과처럼 반환하지 않는다.
  if (qRaw && keywords.length === 0 && !domainRaw) {
    return new Response(JSON.stringify({
      error: 'q에 의미있는 검색어가 없습니다(조사·범용어만 입력됨)',
      stripped_input: qRaw,
    }), { status: 400, headers: corsHeaders });
  }

  const token = await _l1AdminToken(env);

  const buildClauses = (kwList, useDomain) => {
    const clauses = kwList.map((kw) => {
      const esc = kw.replace(/'/g, "\\'").replace(/%/g, '');
      // goal과 eligibility_gate(문자열로 저장된 JSON) 양쪽에서 검색 —
      // eligibility_gate까지 뒤지는 이유는 이용자가 "청년"이라고만
      // 말해도, 사업명엔 "청년"이 없지만 eligibility_gate.conditions에
      // "만 18~34세 청년"이라고 적혀 있는 경우가 많기 때문이다.
      return `(goal ~ '${esc}' || eligibility_gate ~ '${esc}' || domain ~ '${esc}')`;
    });
    // ★ 치명적-1 수정: 여러 키워드는 OR가 아니라 AND로 묶는다 — 이게
    // STEP 0-C "속성 하나씩 좁혀 재검색"이 실제로 좁혀지게 하는 지점.
    if (useDomain && domain) clauses.push(`domain = '${domain.replace(/'/g, "\\'")}'`);
    return clauses.join(' && ');
  };

  async function runQuery(filterStr, perPage) {
    const filter = encodeURIComponent(filterStr);
    const res = await fetch(
      `${L1_DEFAULT}/api/collections/procedure_maps/records?filter=${filter}&perPage=${perPage}&sort=-created`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`benefit-candidates 조회 실패 (HTTP ${res.status}): ${errText}`);
    }
    return res.json().catch(() => ({ items: [], totalItems: 0 }));
  }

  let data;
  try {
    data = await runQuery(buildClauses(keywords, true), limit);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }

  // ★ 심각-3 수정: domain 매핑이 있는데 결과가 0건이면, domain 절을
  // 빼고 q만으로 재시도한다 — 잘못된 domain 하나가 유효했을 q 매칭
  // 전체를 죽이던 v1의 가장 위험한 결함.
  let domainDropped = false;
  if ((data.items || []).length === 0 && domain && keywords.length > 0) {
    try {
      data = await runQuery(buildClauses(keywords, false), limit);
      domainDropped = true;
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
    }
  }

  // ★ 중간 수정: 띄어쓰기 정규화 폴백 — 여전히 0건이고 공백이 없는
  // 단일 키워드라면, 앞부분만으로 넓게 조회한 뒤 애플리케이션에서
  // 공백 제거 후 포함 여부를 재확인한다.
  let spacingFallbackUsed = false;
  if ((data.items || []).length === 0 && keywords.length === 1 && keywords[0].length >= 3) {
    const kw = keywords[0];
    const broadKw = kw.slice(0, Math.max(2, kw.length - 2)); // 앞부분만 남겨 그물을 넓힌다
    try {
      const broad = await runQuery(buildClauses([broadKw], false), Math.min(limit * 3, 50));
      const kwNoSpace = kw.replace(/\s/g, '');
      const filtered = (broad.items || []).filter((rec) => {
        const hay = ((rec.goal || '') + (rec.eligibility_gate || '')).replace(/\s/g, '');
        return hay.includes(kwNoSpace);
      });
      if (filtered.length > 0) {
        data = { items: filtered.slice(0, limit), totalItems: filtered.length };
        spacingFallbackUsed = true;
      }
    } catch (e) {
      // 폴백 실패는 치명적이지 않다 — 원래 0건 결과를 그대로 반환한다.
    }
  }

  const items = (data.items || []).map((rec) => ({
    goal: rec.goal,
    domain: rec.domain,
    org_id: (rec.steps && rec.steps[0] && rec.steps[0].org_id) || null,
    eligibility_gate: rec.eligibility_gate,
    status: rec.status,
    as_of_date: rec.as_of_date,
  }));

  return new Response(JSON.stringify({
    status: items.length ? 'candidates_found' : 'no_candidates',
    count: items.length,
    // ★ 심각-4 수정: 30건이 "전부"인지 "일부"인지 K-Compose가 구분할
    // 수 있게 전체 매칭 추정치를 함께 실어보낸다.
    total_match_estimate: data.totalItems ?? items.length,
    domain_filter_dropped: domainDropped,
    spacing_fallback_used: spacingFallbackUsed,
    // pending_review인 후보가 섞여 있으면 K-Compose가 이용자에게
    // 반드시 고지해야 한다는 걸 명시적으로 알려준다(§0-H와 동일 원칙,
    // 서버가 판단을 대신하지 않고 신호만 준다).
    has_unverified: items.some((i) => i.status !== 'active'),
    candidates: items,
  }), { headers: corsHeaders });
}

// ════════════════════════════════════════════════════════════
// 혜택 후보 의미검색 — 임베딩 기반 (2026-07-16, 처음부터 재설계)
// ════════════════════════════════════════════════════════════
// 배경: handleBenefitCandidateSearch(위, LIKE 기반)를 v2까지 패치했지만,
// LIKE의 부분일치 폭발·조합 조건 조회 불가라는 구조적 한계 자체는 못
// 넘었다. 임베딩(Cloudflare Workers AI bge-m3) + Vectorize로 바꾸면서,
// "LIKE의 한계를 우회하려고 만든 구조"(키워드 쪼개기·불용어 필터·
// 다단계 AND 재검색·total_match_estimate)를 그대로 얹지 않고 처음부터
// 다시 설계했다(주피터님 의견 검토 후 반영 — v1→v2 패치가 아니라 새
// 함수):
//   1. q는 이제 자연어 문장 그대로 받는다(키워드 쪼개기·불용어 필터
//      없음 — 벡터 검색은 문맥이 살아있는 원문을 더 잘 다룬다).
//   2. "속성 하나씩 좁혀 재검색"이 아니라 "문맥을 보강한 문장으로
//      재임베딩" — SP-20 STEP 0-C가 재설계됨(이 함수 자체는 그냥
//      매번 주어진 문장을 그대로 임베딩할 뿐, 문맥 보강은 호출부 몫).
//   3. total_match_estimate 대신 결과별 similarity score를 반환한다
//      — kNN에 "전체 몇 건" 개념이 자연스럽지 않다(임계값이 새 튜닝
//      포인트가 됨).
//   4. domain 필터·limit(topK) 개념은 그대로 유지 — 이건 LIKE 특유의
//      문제가 아니라 카테고리 정확일치일 뿐이라 손댈 이유가 없었다.
//
// ★ 정직한 한계 ★ bge-m3가 한국 행정·복지 전문용어 도메인에서 실제로
// 얼마나 잘 되는지 이 세션에서 검증 못 했다 — Vectorize가 로컬에서
// 안 돌아가는 환경 제약. 배포 전 소규모 파일럿으로 실제 유사도가
// 그럴듯하게 나오는지 먼저 확인 필요(주피터님 검토 필요 사항으로
// 남김). 기존 LIKE 기반 handleBenefitCandidateSearch는 코드에 그대로
// 남겨둔다 — SP-20 프로토콜에서는 더 이상 참조하지 않지만, 임베딩
// 경로가 검증 전이라 즉시 삭제하지 않고 비상 폴백으로 유지한다.

const BENEFIT_EMBED_MODEL = '@cf/baai/bge-m3';

async function _embedText(env, texts) {
  // texts: string[] → number[][] (bge-m3 dense 벡터, 1024차원 추정 —
  // wrangler.toml 주석 참조, 최초 실행 결과로 재확인 필요)
  const result = await env.AI.run(BENEFIT_EMBED_MODEL, { text: texts });
  // Workers AI bge-m3 응답 형태: { shape: [...], data: number[][] }
  if (!result || !result.data) throw new Error('bge-m3 임베딩 응답 형식 이상: ' + JSON.stringify(result));
  return result.data;
}

// POST /embed-text (2026-07-17 신설)
// body: { texts: string[] } → { vectors: number[][] }
// _embedText()의 얇은 HTTP 통로. env.AI는 Worker 내부 바인딩이라
// tools/triage_feedback.py 같은 Python 배치 스크립트가 직접 호출할
// 수 없다 — 이미 만든 bge-m3 임베딩 인프라(benefit-semantic-search용)를
// user_feedback 클러스터링에도 그대로 재사용하기 위한 범용 통로.
// 새 임베딩 파이프라인을 또 만들지 않는다는 원칙(docs/
// user_feedback_mechanism_proposal_v1.md §4).
async function handleEmbedText(request, env, corsHeaders) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.texts) || !body.texts.length) {
    return _err(400, 'SCHEMA_ERROR', 'texts(배열) 필드 필수', corsHeaders);
  }
  if (body.texts.length > 100) {
    return _err(400, 'TOO_MANY_TEXTS', '한 번에 최대 100건까지', corsHeaders);
  }
  try {
    const vectors = await _embedText(env, body.texts);
    return new Response(JSON.stringify({ vectors }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'EMBED_FAILED', 'bge-m3 임베딩 실패: ' + e.message, corsHeaders);
  }
}

// POST /orchestration/benefit-embed-index
// body: { records: [{ petition_id, goal, domain, text }] }
// text는 임베딩할 원문 — 호출부(인덱싱 스크립트)가 goal + eligibility_
// gate 요약을 합쳐서 넘긴다. 이 함수는 그걸 그대로 임베딩해 Vectorize
// 에 upsert만 한다 — 무엇을 임베딩할지는 판단하지 않는다.
async function handleBenefitEmbedIndex(request, env, corsHeaders) {
  if (!env.AI) return new Response(JSON.stringify({ error: 'AI 바인딩 없음 — wrangler.toml [ai] 확인' }), { status: 500, headers: corsHeaders });
  if (!env.VECTORIZE) return new Response(JSON.stringify({ error: 'VECTORIZE 바인딩 없음 — wrangler.toml [[vectorize]] 확인, 인덱스 사전 생성 필요' }), { status: 500, headers: corsHeaders });

  let body;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  const records = body.records;
  if (!Array.isArray(records) || records.length === 0) {
    return new Response(JSON.stringify({ error: 'records(배열) 필요' }), { status: 400, headers: corsHeaders });
  }
  if (records.length > 100) {
    // Workers AI 배치 한도 보호 — 대량 인덱싱은 호출부가 100건 단위로
    // 쪼개서 여러 번 호출해야 한다(정확한 한도는 실제 배포 시 재확인).
    return new Response(JSON.stringify({ error: '한 번에 최대 100건 — 호출부에서 배치 분할 필요' }), { status: 400, headers: corsHeaders });
  }

  let vectors;
  try {
    vectors = await _embedText(env, records.map((r) => r.text));
  } catch (e) {
    return new Response(JSON.stringify({ error: `임베딩 생성 실패: ${e.message}` }), { status: 502, headers: corsHeaders });
  }

  const upsertPayload = records.map((r, i) => ({
    id: r.petition_id,
    values: vectors[i],
    metadata: { goal: r.goal, domain: r.domain },
  }));

  try {
    await env.VECTORIZE.upsert(upsertPayload);
  } catch (e) {
    return new Response(JSON.stringify({ error: `Vectorize upsert 실패: ${e.message}` }), { status: 502, headers: corsHeaders });
  }

  return new Response(JSON.stringify({ status: 'indexed', count: upsertPayload.length }), { headers: corsHeaders });
}

// GET /orchestration/benefit-semantic-search?query=...&domain=...&limit=20
async function handleBenefitSemanticSearch(request, env, corsHeaders) {
  if (!env.AI) return new Response(JSON.stringify({ error: 'AI 바인딩 없음' }), { status: 500, headers: corsHeaders });
  if (!env.VECTORIZE) return new Response(JSON.stringify({ error: 'VECTORIZE 바인딩 없음' }), { status: 500, headers: corsHeaders });

  const { searchParams } = new URL(request.url);
  const query = searchParams.get('query');
  const domainRaw = searchParams.get('domain');
  let limit = parseInt(searchParams.get('limit') || '20', 10);
  if (!Number.isFinite(limit) || limit <= 0) limit = 20;
  limit = Math.min(limit, 50);

  if (!query || query.trim().length === 0) {
    return new Response(JSON.stringify({ error: 'query 필요(자연어 문장 그대로 — 키워드로 쪼개서 보내지 않는다)' }), { status: 400, headers: corsHeaders });
  }

  const domain = _normalizeBenefitDomain(domainRaw); // 기존 LIKE 검색용
  // 매핑 함수를 그대로 재사용 — 이건 LIKE 특유의 로직이 아니라 자유
  // 텍스트→고정 10종 정규화라 임베딩 검색에도 동일하게 필요하다.

  let vectors;
  try {
    vectors = await _embedText(env, [query]);
  } catch (e) {
    return new Response(JSON.stringify({ error: `쿼리 임베딩 실패: ${e.message}` }), { status: 502, headers: corsHeaders });
  }

  let matches;
  try {
    const result = await env.VECTORIZE.query(vectors[0], {
      topK: limit,
      filter: domain ? { domain } : undefined,
      returnMetadata: 'all',
    });
    matches = result.matches || [];
  } catch (e) {
    return new Response(JSON.stringify({ error: `Vectorize 조회 실패: ${e.message}` }), { status: 502, headers: corsHeaders });
  }

  if (matches.length === 0) {
    return new Response(JSON.stringify({ status: 'no_candidates', count: 0, candidates: [] }), { headers: corsHeaders });
  }

  // Vectorize 메타데이터엔 goal·domain만 있다(eligibility_gate는 크기
  // 제한 때문에 안 넣음) — 매칭된 것만 골라 PocketBase procedure_maps
  // 에서 전체 레코드를 조회한다(전수가 아니라 이 topK개만이라 가볍다).
  const token = await _l1AdminToken(env);
  const candidates = [];
  for (const m of matches) {
    try {
      const filter = encodeURIComponent(`goal = '${(m.metadata?.goal || '').replace(/'/g, "\\'")}'`);
      const res = await fetch(`${L1_DEFAULT}/api/collections/procedure_maps/records?filter=${filter}&perPage=1`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json().catch(() => ({ items: [] }));
      const rec = data.items?.[0];
      candidates.push({
        goal: m.metadata?.goal || null,
        domain: m.metadata?.domain || null,
        score: m.score, // ★ total_match_estimate 대신 유사도 점수 —
        // K-Compose가 이 점수로 확신도를 판단한다(임계값은 SP-20
        // 문서에서 시작점만 제시, 실사용 데이터로 재검증 필요).
        org_id: rec ? (rec.steps && rec.steps[0] && rec.steps[0].org_id) || null : null,
        eligibility_gate: rec ? rec.eligibility_gate : null,
        status: rec ? rec.status : null,
        as_of_date: rec ? rec.as_of_date : null,
      });
    } catch (e) {
      // 개별 레코드 조회 실패는 그 후보만 건너뛴다 — 전체를 죽이지 않는다.
      continue;
    }
  }

  return new Response(JSON.stringify({
    status: candidates.length ? 'candidates_found' : 'no_candidates',
    count: candidates.length,
    candidates,
  }), { headers: corsHeaders });
}

async function handleProcedureMapDraft(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.goal) return new Response(JSON.stringify({ error: 'goal required' }), { status: 400, headers: corsHeaders });

  const existing = await _l1FindProcedureMap(env, payload.goal).catch(() => null);
  if (existing) {
    return new Response(JSON.stringify({ error: 'already exists', status: existing.status }), { status: 409, headers: corsHeaders });
  }
  try {
    const rec = await _l1CreateProcedureMap(env, {
      goal: payload.goal,
      domain: payload.domain || '',
      steps: payload.steps || [],
      eligibility_gate: payload.eligibility_gate || [],
      free_alternative: payload.free_alternative || null,
      as_of_date: payload.as_of_date || new Date().toISOString().slice(0, 10),
      orchestrator: 'AC',
      status: 'pending_review', // ★ 절대 draft 생성 시점에 active로 두지 않는다
    });
    return new Response(JSON.stringify({ status: 'created', id: rec.id }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

async function handleProcedureMapUpdate(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.goal) return new Response(JSON.stringify({ error: 'goal required' }), { status: 400, headers: corsHeaders });

  const existing = await _l1FindProcedureMap(env, payload.goal).catch(() => null);
  if (!existing) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: corsHeaders });

  // 구조 변경(steps 자체를 바꾸는 것)만 다시 pending_review로 내린다.
  // 단순 사실 갱신(연락처 등)은 기존 status를 유지한다 — 매번 재검토를
  // 강제하면 배보다 배꼽이 크다는 판단(2026-07-08 결정, 사고실험으로
  // 재검증 필요 — 이 기준이 너무 느슨한지 빡빡한지는 운영 데이터로 확인).
  const patch = {};
  let structuralChange = false;
  for (const change of (payload.changes || [])) {
    patch[change.field] = change.value;
    if (change.field === 'steps') structuralChange = true;
  }
  patch.as_of_date = new Date().toISOString().slice(0, 10);
  if (structuralChange && existing.status === 'active') patch.status = 'pending_review';

  try {
    const rec = await _l1PatchProcedureMap(env, existing.id, patch);
    return new Response(JSON.stringify({ status: 'updated', record: rec }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

async function handleOrgProfileLookup(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  if (!orgId) return new Response(JSON.stringify({ error: 'org_id required' }), { status: 400, headers: corsHeaders });
  let rec;
  try {
    rec = await _l1FindOrgProfile(env, orgId);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
  if (!rec) return new Response(JSON.stringify({ status: 'miss' }), { headers: corsHeaders });
  return new Response(JSON.stringify({ status: rec.status === 'active' ? 'hit' : 'hit_pending_review', org: rec }), { headers: corsHeaders });
}

// POST /orchestration/org-profile/draft  (body: {org_id, org_name, branch, ...})
// handleProcedureMapDraft와 동일 원칙 — 생성 시점에 절대 active로 두지
// 않는다. 중복 org_id는 409로 거부(procedure_maps와 동일하게 update
// 경로를 따로 두지 않은 이유: org_profiles는 필드 대부분이 정적 사실
// 정보라 지금은 "이미 있으면 draft 재작성 없이 owner가 관리자 패널에서
// 직접 고친다"는 원칙 — update 엔드포인트가 필요해지면 그때 추가).
async function handleOrgProfileDraft(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.org_id) return new Response(JSON.stringify({ error: 'org_id required' }), { status: 400, headers: corsHeaders });
  if (!payload.org_name) return new Response(JSON.stringify({ error: 'org_name required' }), { status: 400, headers: corsHeaders });
  if (!payload.branch) return new Response(JSON.stringify({ error: 'branch required' }), { status: 400, headers: corsHeaders });

  const existing = await _l1FindOrgProfile(env, payload.org_id).catch(() => null);
  if (existing) {
    return new Response(JSON.stringify({ error: 'already exists', status: existing.status }), { status: 409, headers: corsHeaders });
  }
  try {
    const rec = await _l1CreateOrgProfile(env, {
      org_id: payload.org_id,
      org_name: payload.org_name,
      branch: payload.branch,
      jurisdiction: payload.jurisdiction || '',
      as_of_date: payload.as_of_date || new Date().toISOString().slice(0, 10),
      guid_model: payload.guid_model || 'none',
      resolution_strategy: payload.resolution_strategy || 'single_national_instance',
      input: payload.input || {},
      output: payload.output || {},
      automation: payload.automation || {},
      connected: !!payload.connected,
      unavailable_reason: payload.unavailable_reason || '',
      status: 'pending_review', // ★ 절대 draft 생성 시점에 active로 두지 않는다
    });
    return new Response(JSON.stringify({ status: 'created', id: rec.id }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// POST /orchestration/atom-row/draft  (body: {atom_id, pattern, ...})
// atom_rows도 procedure_maps와 동일한 pending_review 원칙을 따른다.
// connected는 명시적으로 넘기지 않는 한 항상 false로 시작한다 —
// _callGovSys의 GOVSYS_FUNCTIONS 표가 비어 있는 지금 시점에
// connected:true로 시딩하면 _execReport 등이 거짓으로 "자동화됨"을
// 전제하고 GOVSYS 함수를 찾다가 automation_not_implemented로 조용히
// 폴백하게 된다 — 데이터 시딩 단계에서부터 정직하게 false로 둔다.
async function handleAtomRowDraft(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.atom_id) return new Response(JSON.stringify({ error: 'atom_id required' }), { status: 400, headers: corsHeaders });
  const VALID_PATTERNS = ['REPORT', 'DECISION', 'PAY', 'QUERY', 'ADJUDICATE'];
  if (!VALID_PATTERNS.includes(payload.pattern)) {
    return new Response(JSON.stringify({ error: `pattern must be one of ${VALID_PATTERNS.join('/')}` }), { status: 400, headers: corsHeaders });
  }

  const existing = await _l1FindAtomRow(env, payload.atom_id).catch(() => null);
  if (existing) {
    return new Response(JSON.stringify({ error: 'already exists', status: existing.status }), { status: 409, headers: corsHeaders });
  }
  try {
    const rec = await _l1CreateAtomRow(env, {
      atom_id: payload.atom_id,
      pattern: payload.pattern,
      org_class: payload.org_class || '',
      required_docs: payload.required_docs || [],
      automation_sp: payload.automation_sp || '',
      connected: payload.connected === true, // 명시적 true만 인정, 기본 false
      unavailable_reason: payload.unavailable_reason || '',
      pay_subtype: payload.pay_subtype || null,
      regulatory_intensity: payload.regulatory_intensity || null,
      creates_new_status: !!payload.creates_new_status,
      outcome_type: payload.outcome_type || null,
      adjudicate_subtype: payload.adjudicate_subtype || '',
      escalation_to: payload.escalation_to || '',
      status: 'pending_review', // ★ 절대 draft 생성 시점에 active로 두지 않는다
    });
    return new Response(JSON.stringify({ status: 'created', id: rec.id }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// POST /orchestration/org-profile/update  (body: {org_id, changes: [{field, value}, ...]})
// handleProcedureMapUpdate와 동일한 changes-배열 PATCH 형태. org_profiles는
// procedure_maps의 'steps'처럼 뚜렷한 "구조 변경 필드"가 없어서 자동
// pending_review 강등 로직은 두지 않는다 — status 전이는 항상 changes에
// status 필드를 명시적으로 넣어야만 일어난다(승인자가 의도적으로 눌러야
// active가 된다는 원칙 유지, 부수효과로 승격되지 않음).
async function handleOrgProfileUpdate(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.org_id) return new Response(JSON.stringify({ error: 'org_id required' }), { status: 400, headers: corsHeaders });

  const existing = await _l1FindOrgProfile(env, payload.org_id).catch(() => null);
  if (!existing) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: corsHeaders });

  const patch = {};
  for (const change of (payload.changes || [])) {
    patch[change.field] = change.value;
  }
  patch.as_of_date = new Date().toISOString().slice(0, 10);

  try {
    const rec = await _l1PatchOrgProfile(env, existing.id, patch);
    return new Response(JSON.stringify({ status: 'updated', record: rec }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// POST /orchestration/atom-row/update  (body: {atom_id, changes: [{field, value}, ...]})
// atom_rows도 org_profiles와 같은 원칙 — 자동 강등 없음, status 전이는
// changes에 명시해야만 일어난다. atom_rows 스키마에는 as_of_date가 없어서
// (procedure_maps/org_profiles와 달리) 자동 갱신 필드도 없다.
async function handleAtomRowUpdate(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.atom_id) return new Response(JSON.stringify({ error: 'atom_id required' }), { status: 400, headers: corsHeaders });

  const existing = await _l1FindAtomRow(env, payload.atom_id).catch(() => null);
  if (!existing) return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: corsHeaders });

  const patch = {};
  for (const change of (payload.changes || [])) {
    patch[change.field] = change.value;
  }

  try {
    const rec = await _l1PatchAtomRow(env, existing.id, patch);
    return new Response(JSON.stringify({ status: 'updated', record: rec }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── gwp_registry: 무제한 확장 가능한 SP 등록소 (2026-07-11 신설) ──────
// 문제의식: gwp-registry.js는 ~21개 하드코딩 배열을 브라우저에 통째로
// 로드하는 구조라 SP-Author 자동화로 기관 SP가 수백~수백만 개로
// 늘어나면 깨진다. 이 컬렉션은 core(gwp-registry.js와 동기화된 소수
// 핵심 서비스)부터 institutional/business/expert(SP-Author가 계속
// 만들어내는 장기 꼬리)까지 전부 같은 스키마로 담고, "전부 로드"가
// 아니라 "필요한 만큼만 검색·조회"하는 방식으로 규모를 감당한다.
// 상세 설계는 docs/GWP-REGISTRY-SCALING_v1_0.md 참조.

async function _l1FindGwpRegistryEntry(env, gwpId) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`gwp_id='${gwpId.replace(/'/g, "\\'")}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/gwp_registry/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`gwp_registry 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1CreateGwpRegistryEntry(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/gwp_registry/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gwp_registry 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1PatchGwpRegistryEntry(env, recordId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/gwp_registry/records/${recordId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`gwp_registry PATCH 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1SearchGwpRegistry(env, { q, category, tier, jurisdiction, limit }) {
  // ★ 정직한 한계 ★ PocketBase(SQLite) LIKE 기반 검색이다 — 수백만
  // 레코드·복잡한 자연어 질의에서는 성능·재현율이 떨어진다. 그
  // 규모에 실제로 도달하면 외부 전문 검색(예: Typesense·Meilisearch)
  // 또는 임베딩 기반 의미검색으로 교체가 필요하다(docs/GWP-REGISTRY-
  // SCALING_v1_0.md §4 업그레이드 경로 참조) — 지금은 그 단계가 아니다.
  const token = await _l1AdminToken(env);
  const clauses = [`status='active'`];
  if (q) {
    const esc = q.replace(/'/g, "\\'").replace(/%/g, '');
    clauses.push(`(name ~ '${esc}' || keywords ~ '${esc}' || description ~ '${esc}')`);
  }
  if (category) clauses.push(`category='${category.replace(/'/g, "\\'")}'`);
  if (tier) clauses.push(`tier='${tier.replace(/'/g, "\\'")}'`);
  if (jurisdiction) clauses.push(`jurisdiction='${jurisdiction.replace(/'/g, "\\'")}'`);
  const filter = encodeURIComponent(clauses.join(' && '));
  const perPage = Math.min(Number(limit) || 20, 100);
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/gwp_registry/records?filter=${filter}&perPage=${perPage}&sort=-call_count_30d`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`gwp_registry 검색 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items || [];
}

// ── SP-Author 자동화: 큐잉 + ESCALATE + 갱신스케줄 (2026-07-11 신설) ──
// [SP_DRAFT_REQUEST]/[GOV_SP_DRAFT_REQUEST]/[ESCALATE] 태그를 call-ai.js가
// 파싱해 여기로 POST한다(§SP-AUTHOR-AUTOMATION_v1_0.md 참조). SP-Author의
// 실제 조사·작성은 여전히 사람이 수행하지만, 신호가 유실되지 않고
// 큐/알림에 정직하게 남는다.

// POST /sp-author/queue
// body: {request_type, signal_source, institution?, task?, tier_hint?,
//        target_sp_id?, source_conversation?, priority?}
async function handleSPAuthorQueue(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.request_type || !payload.signal_source) {
    return new Response(JSON.stringify({ error: 'request_type, signal_source required' }), { status: 400, headers: corsHeaders });
  }

  // 중복 신호 병합 — request_type=update면 target_sp_id로, 그 외에는
  // (institution, task)로 식별한다(위 _l1FindOpenDraftRequest 주석 참조).
  const dup = await _l1FindOpenDraftRequest(env, payload.institution, payload.task, payload.target_sp_id).catch(() => null);
  if (dup) {
    return new Response(JSON.stringify({ status: 'merged_into_existing', record: dup }), { headers: corsHeaders });
  }

  const record = {
    request_type: payload.request_type,
    signal_source: payload.signal_source,
    institution: payload.institution || '',
    task: payload.task || '',
    tier_hint: payload.tier_hint || '',
    target_sp_id: payload.target_sp_id || '',
    source_conversation: (payload.source_conversation || '').slice(0, 4000),
    priority: payload.priority || 'normal',
    status: 'queued',
  };

  let rec;
  try {
    rec = await _l1CreateDraftRequest(env, record);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }

  // 큐잉과 동시에 최소 ESCALATE 알림도 함께 남긴다 — 별도로 [ESCALATE]
  // 태그가 안 나가도(호출부가 깜빡해도) 최소 신호는 보장한다.
  try {
    await _l1CreateEscalation(env, {
      to: '@owner',
      reason: 'sp_draft_request',
      ref_collection: 'sp_draft_requests',
      ref_id: rec.id,
      summary: `[${record.priority}] ${record.request_type}: ${record.institution || record.target_sp_id || '(미상)'} — ${record.task}`.slice(0, 2000),
      read: false,
    });
  } catch (e) {
    // 알림 실패가 큐잉 자체를 실패시키지 않는다 — 큐 레코드는 이미 저장됨.
    console.error('[sp-author] escalation 생성 실패(큐잉은 성공):', e.message);
  }

  return new Response(JSON.stringify({ status: 'queued', record: rec }), { headers: corsHeaders });
}

// GET /sp-author/queue?status=queued
async function handleSPAuthorQueueList(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get('status') || '';
  try {
    const items = await _l1ListDraftRequests(env, status);
    return new Response(JSON.stringify({ items }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// POST /sp-author/queue/:id/status  body: {status, duplicate_of?}
async function handleSPAuthorQueueStatus(request, env, corsHeaders, recordId) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  const allowed = ['queued', 'assigned', 'drafted', 'pending_review', 'approved', 'rejected', 'duplicate'];
  if (!allowed.includes(payload.status)) {
    return new Response(JSON.stringify({ error: `status must be one of ${allowed.join('|')}` }), { status: 400, headers: corsHeaders });
  }
  const patch = { status: payload.status };
  if (payload.status === 'duplicate' && payload.duplicate_of) patch.duplicate_of = payload.duplicate_of;
  if (['approved', 'rejected'].includes(payload.status)) patch.resolved_at = new Date().toISOString();
  try {
    const rec = await _l1PatchDraftRequest(env, recordId, patch);

    // ★ 2026-07-11 신설 — 승인되면 gwp_registry에 자동 등록한다.
    // "SP 승인 = gwp_registry 등재"를 사람이 매번 손으로 안 해도 되게
    // 만드는 게 이번 확장의 핵심이다(수동 등록에 의존하면 승인 건수가
    // 늘어날수록 등록 누락이 반드시 생긴다). gwp_id는 target_sp_id가
    // 있으면 그대로, 없으면(신규 기관) institution을 slug화해 만든다 —
    // 이미 있으면 register 자체가 멱등(갱신)이라 중복 문제 없다.
    let registration = null;
    if (payload.status === 'approved') {
      const gwpId = rec.target_sp_id || rec.institution || `draft-${recordId}`;
      const registerBody = {
        gwp_id: gwpId,
        name: rec.institution || gwpId,
        tier: 'institutional',
        description: rec.task || '',
        keywords: `${rec.institution || ''} ${rec.task || ''}`.trim(),
        jurisdiction: rec.tier_hint || '',
        file_ref: rec.target_sp_id || gwpId,
        status: 'active',
      };
      try {
        const existing = await _l1FindGwpRegistryEntry(env, gwpId);
        registration = existing
          ? await _l1PatchGwpRegistryEntry(env, existing.id, registerBody)
          : await _l1CreateGwpRegistryEntry(env, registerBody);
      } catch (e) {
        // 등록 실패가 승인 자체를 실패시키지 않는다 — draft_requests의
        // status는 이미 approved로 저장됐다. 수동 보완이 필요하다는
        // 사실만 응답에 남긴다.
        console.error('[gwp-registry] 자동 등록 실패(승인은 유지됨):', e.message);
        registration = { error: e.message };
      }
    }

    return new Response(JSON.stringify({ status: 'updated', record: rec, gwp_registry: registration }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// POST /sp-author/escalate  body: {to?, reason, ref_collection?, ref_id?, summary}
// AGENT-COMMON [ESCALATE: to=..., ...] 태그가 이걸 호출한다(최소 구현 —
// 실제 알림 채널(이메일/슬랙 등) 연동은 이 함수를 확장하면 된다).
async function handleSPAuthorEscalate(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.reason || !payload.summary) {
    return new Response(JSON.stringify({ error: 'reason, summary required' }), { status: 400, headers: corsHeaders });
  }
  try {
    const rec = await _l1CreateEscalation(env, {
      to: payload.to || '@owner',
      reason: payload.reason,
      ref_collection: payload.ref_collection || '',
      ref_id: payload.ref_id || '',
      summary: (payload.summary || '').slice(0, 2000),
      read: false,
    });
    return new Response(JSON.stringify({ status: 'escalated', record: rec }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// GET /sp-author/escalations?unread=true
async function handleSPAuthorEscalationList(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const unreadOnly = searchParams.get('unread') === 'true';
  try {
    const items = await _l1ListEscalations(env, unreadOnly);
    return new Response(JSON.stringify({ items }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// GET /sp-author/refresh-due
// §SP-AUTHOR-AUTOMATION_v1_0.md의 정기 갱신 방법론이 참조하는 조회
// 엔드포인트 — next_due_at이 지난 SP 목록을 반환한다. 실제 스케줄 실행
// (cron)은 이 저장소 밖(예: GitHub Actions 정기 워크플로)에서 이 엔드포인트를
// 주기적으로 호출해 [SP_DRAFT_REQUEST: ..., signal_source=refresh_schedule]
// 큐잉으로 이어가는 방식을 권장한다 — worker.js 자체에는 스케줄러가 없다.
async function handleSPAuthorRefreshDue(request, env, corsHeaders) {
  try {
    const items = await _l1ListDueRefreshSchedules(env);
    return new Response(JSON.stringify({ items }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// POST /sp-author/refresh-schedule  body: {sp_id, call_count_30d?, tier?}
// 갱신 완료 후 next_due_at을 tier에 따라 재계산해 기록한다(멱등 — upsert).
async function handleSPAuthorRefreshScheduleUpsert(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.sp_id) return new Response(JSON.stringify({ error: 'sp_id required' }), { status: 400, headers: corsHeaders });

  const tier = payload.tier || 'monthly';
  const daysByTier = { weekly: 7, monthly: 30, quarterly: 90 };
  const days = daysByTier[tier] || 30;
  const next = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  // ★ 2026-07-11 Phase 4 버그 수정 ★ 원래 이 엔드포인트가 호출될 때마다
  // next_due_at을 무조건 "오늘+tier일수"로 재계산했다 — tier 재분류만
  // 하려고 호출해도(실제 갱신은 안 했는데) 마감일이 매번 미래로 밀려나서,
  // 스케줄러(tools/sp_refresh_scheduler.py)가 매일 tier를 재계산할 때마다
  // due 항목이 영원히 안 생기는 버그였다(로컬 통합테스트로 재현·확인).
  // 이제 next_due_at은 (a) 이 sp_id가 처음 등록되거나, (b)
  // refresh_completed:true(실제 갱신이 방금 끝났다는 명시적 신호)일 때만
  // 갱신한다. 단순 tier 재분류는 tier·call_count_30d만 바꾸고 기존
  // next_due_at은 그대로 둔다 — 그래야 due 판정이 실제로 의미를 가진다.
  const existing = await _l1FindRefreshSchedule(env, payload.sp_id).catch(() => null);
  const isNew = !existing;
  const refreshCompleted = payload.refresh_completed === true;

  const patch = { tier };
  if (typeof payload.call_count_30d === 'number') patch.call_count_30d = payload.call_count_30d;
  if (typeof payload.drift_flag === 'boolean') patch.drift_flag = payload.drift_flag;
  if (payload.drift_reason) patch.drift_reason = payload.drift_reason;
  if (isNew || refreshCompleted) {
    patch.next_due_at = next;
    if (refreshCompleted) patch.last_refreshed_at = new Date().toISOString().slice(0, 10);
  }

  try {
    const rec = await _l1UpsertRefreshSchedule(env, payload.sp_id, patch);
    return new Response(JSON.stringify({ status: 'scheduled', record: rec, next_due_at_changed: isNew || refreshCompleted }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// ── 웹검색(Serper.dev) 예산 카운터 (2026-07-11 신설) ──────────────────
// 캐시 미스로 실제 API를 호출할 때만 증분한다(캐시 히트는 무료이므로
// 카운트 안 함). WEB_SEARCH_DAILY_CAP(env, 기본 500)을 넘으면 그날은
// 더 이상 실제 호출하지 않고 정직하게 한도 초과를 알린다.

function _todayKST() {
  // KST = UTC+9, 날짜 경계만 필요하므로 9시간 더한 뒤 UTC 날짜로 자른다.
  const d = new Date(Date.now() + 9 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function _l1GetWebSearchUsage(env, date) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`date='${date}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/web_search_usage/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`web_search_usage 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1IncrementWebSearchUsage(env, date) {
  const existing = await _l1GetWebSearchUsage(env, date);
  const token = await _l1AdminToken(env);
  if (existing) {
    const res = await fetch(`${L1_DEFAULT}/api/collections/web_search_usage/records/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: (Number(existing.count) || 0) + 1 }),
    });
    if (!res.ok) throw new Error(`web_search_usage PATCH 실패 (HTTP ${res.status})`);
    return res.json();
  }
  const res = await fetch(`${L1_DEFAULT}/api/collections/web_search_usage/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ date, count: 1 }),
  });
  if (!res.ok) throw new Error(`web_search_usage 생성 실패 (HTTP ${res.status})`);
  return res.json();
}

// ── gwp_registry HTTP 핸들러 (2026-07-11 신설) ──────────────────────

// GET /gwp-registry/lookup?id=klaw — 정확한 gwp_id 단건 조회(핫패스)
async function handleGwpRegistryLookup(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const id = searchParams.get('id');
  if (!id) return new Response(JSON.stringify({ error: 'id required' }), { status: 400, headers: corsHeaders });
  try {
    const rec = await _l1FindGwpRegistryEntry(env, id);
    if (!rec) return new Response(JSON.stringify({ status: 'miss' }), { headers: corsHeaders });
    return new Response(JSON.stringify({ status: 'hit', entry: rec }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// GET /gwp-registry/search?q=축산분뇨&category=GOV&tier=institutional&limit=10
// AC/K-Compose가 core 21개(gwp-registry.js)에서 못 찾았을 때, "정말
// 없는지" 확정하기 전에 여기부터 확인한다(§0-H·K-Compose STEP 4-A가
// 참조 — docs/GWP-REGISTRY-SCALING_v1_0.md §3).
async function handleGwpRegistrySearch(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q') || '';
  const category = searchParams.get('category') || '';
  const tier = searchParams.get('tier') || '';
  const jurisdiction = searchParams.get('jurisdiction') || '';
  const limit = searchParams.get('limit') || '20';
  try {
    const items = await _l1SearchGwpRegistry(env, { q, category, tier, jurisdiction, limit });
    return new Response(JSON.stringify({ items, count: items.length }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}

// POST /gwp-registry/register
// body: {gwp_id, name, tier, category?, description?, keywords?, jurisdiction?, file_ref?}
// SP-Author 승인 시(handleSPAuthorQueueStatus의 approved 분기) 자동 호출되고,
// 필요하면 관리자가 직접 호출할 수도 있다. 이미 있는 gwp_id면 갱신(멱등).
async function handleGwpRegistryRegister(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }

  // ★ 2026-07-11 Phase 0 신설 — 증분 전용 호출. gwp/engine.js가 GWP 탭
  // 종료(PDV 기록)마다 이 모드로 호출해 call_count_30d를 +1 한다.
  // 정식 등록(name/tier 필수)과 달리, gwp_id만으로 기존 레코드를 찾아
  // 갱신만 한다 — 레코드가 아직 없으면(core 시딩 누락 등) 조용히
  // 스킵한다(증분 실패로 탭 종료 자체를 막지 않는다는 원칙, 호출부와
  // 동일 — 파이프라인 사고실험 미비점4/Phase0 참조).
  if (payload.increment_call_count === true) {
    if (!payload.gwp_id) {
      return new Response(JSON.stringify({ error: 'gwp_id required' }), { status: 400, headers: corsHeaders });
    }
    try {
      const existing = await _l1FindGwpRegistryEntry(env, payload.gwp_id);
      if (!existing) {
        return new Response(JSON.stringify({ status: 'skipped', reason: 'not_registered' }), { headers: corsHeaders });
      }
      const next = (Number(existing.call_count_30d) || 0) + 1;
      const rec = await _l1PatchGwpRegistryEntry(env, existing.id, { call_count_30d: next });
      return new Response(JSON.stringify({ status: 'incremented', entry: rec }), { headers: corsHeaders });
    } catch (e) {
      return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
    }
  }

  if (!payload.gwp_id || !payload.name || !payload.tier) {
    return new Response(JSON.stringify({ error: 'gwp_id, name, tier required' }), { status: 400, headers: corsHeaders });
  }
  const record = {
    gwp_id: payload.gwp_id,
    name: payload.name,
    tier: payload.tier,
    category: payload.category || '',
    description: payload.description || '',
    keywords: payload.keywords || '',
    jurisdiction: payload.jurisdiction || '',
    file_ref: payload.file_ref || payload.gwp_id,
    status: payload.status || 'active',
  };
  if (typeof payload.call_count_30d === 'number') record.call_count_30d = payload.call_count_30d;
  try {
    const existing = await _l1FindGwpRegistryEntry(env, payload.gwp_id);
    let rec;
    if (existing) {
      rec = await _l1PatchGwpRegistryEntry(env, existing.id, record);
      return new Response(JSON.stringify({ status: 'updated', entry: rec }), { headers: corsHeaders });
    }
    rec = await _l1CreateGwpRegistryEntry(env, record);
    return new Response(JSON.stringify({ status: 'registered', entry: rec }), { headers: corsHeaders });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
}


// ── 시군구(L3) 부서 지연 초기화 리졸버 (2026-07-20 신설, 2026-07-20 재적용) ──
// ⚠️ 이 코드는 한 번 배포됐다가 다른 작업자의 스테일 체크아웃 커밋
// (436e508)에 worker.js 519줄이 통째로 삭제되면서 함께 사라진 적이 있다
// — 재적용 시 반드시 `git pull origin main` 먼저 할 것.
//
// GOV_OPEN_DATA_MAP/KOSIS 리졸버(2026-07-16)와 동일 철학: 226개 시군구를
// 미리 채우지 않고 첫 조회 시점에 초기화한다. 비밀키(WEB_SEARCH_API_KEY,
// L1_ADMIN_EMAIL/PASSWORD)는 전부 이 파일(서버) 안에서만 쓰고 클라이언트
// (gov-router.js)로는 절대 넘기지 않는다.
//
// 10개 표본 실사(강남구·천안시·고창군·원주시 등, 2026-07-20)로 뽑은
// 도메인별 "가장 흔한" 부서명 — 확정 사실이 아니라 통계적 최빈값이라
// 응답에 항상 "미확인 추정" 딱지를 붙인다.
const SIGUNGU_COMMON_DEPT_PATTERNS = {
  plan: '기획(예산)담당관', safety: '안전총괄과', jachi: '총무과',
  econ: '지역경제과', welfare: '복지정책과', family: '여성가족과',
  health: '보건소', climate: '환경과', housing: '건설(도시)과',
  transport: '교통행정과', culture: '문화체육과', tourism: '관광과',
  sports: '체육과', agri: '농정과', ocean: '수산과', innov: null,
};
const SIGUNGU_DOMAIN_LABEL_KO = {
  plan: '기획', safety: '안전', jachi: '행정', econ: '경제', welfare: '복지',
  family: '여성가족', health: '보건', climate: '환경', housing: '건설주택',
  transport: '교통', culture: '문화', tourism: '관광', sports: '체육',
  agri: '농업', ocean: '수산', innov: '산업',
};

function _sigunguRenderFallback(cityGuess, domain) {
  const guess = SIGUNGU_COMMON_DEPT_PATTERNS[domain];
  const label = SIGUNGU_DOMAIN_LABEL_KO[domain] || domain;
  if (!guess) {
    return `${cityGuess}의 '${label}' 담당 부서는 아직 확인되지 않았습니다. 이 지역에는 해당 기능을 ` +
      `전담하는 별도 부서가 없을 수도 있습니다 — 정확한 담당 부서는 ${cityGuess} 대표전화 또는 ` +
      `정부24(gov.kr)로 확인해 주세요.`;
  }
  return `${cityGuess}의 '${label}' 관련 문의는 통상 **${guess}**(정확한 명칭 미확인 — 일반적인 시군구 ` +
    `조직 패턴에 근거한 추정)에서 담당합니다. 실제 부서명은 지자체마다 다를 수 있어, ${cityGuess} ` +
    `대표전화나 정부24(gov.kr)로 재확인을 권합니다.`;
}

// 검색 스니펫에서 "OO과"/"OO국"/"OO담당관" 형태의 부서명을 뽑는다. 보수적
// 설계 — 애매하면 null(허위 데이터를 실사로 위장하는 것보다 미확인 유지가
// 낫다는 이 프로젝트의 반복된 원칙). ★ 2026-07-20 개선: .go.kr 공식
// 도메인에서 나온 결과만 후보로 인정 — 부안군/공기업/타지역 언론기사가
// 섞여 동률로 무산되는 문제를 실사용 테스트(천안시 사례)에서 확인해 반영.
// ★ 2026-07-21 추가 — 실제 배포 재현(홍천군/복지)으로 발견한 문제 두
// 가지를 더 고쳤다: (1) "직위건설안전국장" 같은 스니펫에서 "직위건설
// 안전국"과 "건설안전국"이 같은 부서인데 레이블 단어("직위") 때문에
// 서로 다른 후보로 갈려 인위적 동률이 나던 걸 접두어 제거로 정규화.
// (2) 상위 5개만 보던 걸 10개(Serper가 이미 반환한 전체)로 넓혀 후보
// 풀 자체가 좁아서 정답이 아예 안 걸리는 경우를 줄인다.
const _SIGUNGU_LABEL_PREFIXES = ['직위', '이름', '성명', '전화번호', '담당업무', '소속'];
function _sigunguStripLabelPrefix(candidate) {
  for (const label of _SIGUNGU_LABEL_PREFIXES) {
    if (candidate.startsWith(label) && candidate.length > label.length) return candidate.slice(label.length);
  }
  return candidate;
}
function _sigunguExtractDeptName(organic, cityGuess) {
  if (!organic || organic.length === 0) return null;
  const deptPattern = /([가-힣]{2,8}(?:과|국|담당관|팀))/g;
  const counts = new Map();
  const cityCore = cityGuess.replace(/(시|군|구)$/, '');
  for (const r of organic.slice(0, 10)) {
    if (!r.link || !r.link.includes('.go.kr')) continue; // 공식 도메인만
    const text = `${r.title || ''} ${r.snippet || ''}`;
    if (!text.includes(cityCore)) continue;
    let m;
    while ((m = deptPattern.exec(text)) !== null) {
      const cleaned = _sigunguStripLabelPrefix(m[1]);
      counts.set(cleaned, (counts.get(cleaned) || 0) + 1);
    }
  }
  if (counts.size === 0) return null;
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null; // 동률이면 애매 — 채택 안 함
  return sorted[0][0];
}

async function _sigunguRecordResolveLog(entry, env) {
  try {
    const token = await _l1AdminToken(env);
    await fetch(`${L1_BASE_HOST}/api/collections/sigungu_dept_resolve_log/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...entry, recorded_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('[sigungu-dept-resolve] 로그 기록 실패:', e.message);
  }
}

const SIGUNGU_RESOLVE_TTL = 60 * 60 * 24 * 30; // 30일 — KOSIS 리졸버와 동일 원칙

// GET /gov/sigungu-dept-resolve?city=천안시&domain=welfare[&debug=1]
async function handleSigunguDeptResolve(request, url, env, corsHeaders, ctx) {
  const cityGuess = (url.searchParams.get('city') || '').trim();
  const domain = (url.searchParams.get('domain') || '').trim();
  if (!cityGuess || !domain) {
    return _err(400, 'MISSING_PARAM', 'city/domain 파라미터 필수', corsHeaders);
  }
  if (!SIGUNGU_COMMON_DEPT_PATTERNS.hasOwnProperty(domain)) {
    return _err(400, 'UNKNOWN_DOMAIN', `알 수 없는 domain: ${domain}`, corsHeaders);
  }

  const _sigunguDebug = {
    has_web_search_key: !!env.WEB_SEARCH_API_KEY,
    has_kv: !!env.GOV_DATA_KV,
    has_l1_admin: !!(env.L1_ADMIN_EMAIL && env.L1_ADMIN_PASSWORD),
    has_waituntil: !!ctx?.waitUntil,
  };

  const cacheKey = `gov-data:sigungu-dept:${cityGuess}:${domain}`;
  if (env.GOV_DATA_KV) {
    try {
      const cached = await env.GOV_DATA_KV.get(cacheKey, 'json');
      if (cached?.deptName) {
        return new Response(JSON.stringify({
          text: `${cityGuess}의 '${SIGUNGU_DOMAIN_LABEL_KO[domain] || domain}' 관련 문의는 **${cached.deptName}**에서 담당합니다.`,
          verified: true, source: 'cache',
        }), { headers: corsHeaders });
      }
    } catch (e) {
      console.error('[sigungu-dept-resolve] KV 조회 실패(무시):', e.message);
    }
  }

  // ── 임시 디버그 모드(&debug=1) — 원인 파악용, 필요 없어지면 제거 예정 ──
  // 정상 흐름과 동일하게 실제 검색을 동기적으로 실행하되, 원본 검색
  // 결과와 추출 과정을 응답에 그대로 노출한다.
  if (url.searchParams.get('debug') === '1') {
    // ★ 2026-07-21 — domain 라벨을 다시 포함(실제 재현으로 도메인 없는
    // 쿼리가 무관한 부서로 뒤섞여 다수결이 무산되는 걸 확인). .go.kr
    // 필터 + cityCore 포함 필터가 이미 있어 과거(2026-07-20)의 "타지역·
    // 언론기사 섞임" 문제는 지금은 재발하지 않는다고 판단.
    const query = `${cityGuess} ${SIGUNGU_DOMAIN_LABEL_KO[domain] || domain} 담당부서`;
    let organic = null;
    let serperError = null;
    let serperStatus = null;
    try {
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': env.WEB_SEARCH_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, gl: 'kr', hl: 'ko' }),
      });
      serperStatus = searchRes.status;
      if (searchRes.ok) {
        const raw = await searchRes.json().catch((e) => { serperError = `JSON 파싱 실패: ${e.message}`; return null; });
        organic = raw?.organic || null;
      } else {
        serperError = await searchRes.text().catch(() => `HTTP ${searchRes.status}`);
      }
    } catch (e) {
      serperError = `fetch 예외: ${e.message}`;
    }
    const deptName = _sigunguExtractDeptName(organic, cityGuess);
    return new Response(JSON.stringify({
      debug_mode: true, _debug: _sigunguDebug,
      query, serper_status: serperStatus, serper_error: serperError,
      organic_raw: organic, extracted_dept_name: deptName,
    }, null, 2), { headers: corsHeaders });
  }

  // ★ 2026-07-21 신설 — 주피터 지시: "시간보다 중요한 점은 매 초마다
  // 진행 상황을 알려주고, 정확한 답을 제출하는 것" — Serper 검색을
  // 기다리는 동안 SSE(text/event-stream)로 진행상황(progress)을 매초
  // 흘려보내고, 완료되면 최종 결과(done)를 보낸다. 클라이언트가 SSE를
  // 못 읽는 구버전이어도(gov-router.js resolveSigunguDept 구버전)
  // 안전하게 동작하도록, "done" 이벤트의 payload 형태는 예전 단일
  // JSON 응답과 완전히 동일한 필드(text/verified/source)를 유지한다.
  const streamHeaders = { ...corsHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' };
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const streamTask = (async () => {
    // ★ 2026-07-21 — domain 라벨을 다시 포함(실제 재현: "OO 조직도"만으로는
    // 검색 결과가 무관한 여러 부서로 흩어져 다수결로 domain을 특정할 수
    // 없었다). .go.kr 필터 + cityCore 포함 필터가 이미 과거(2026-07-20)의
    // "타지역·언론기사 섞임" 문제를 막아준다고 판단해 라벨을 되살렸다.
    const label = SIGUNGU_DOMAIN_LABEL_KO[domain] || domain;
    const query = `${cityGuess} ${label} 담당부서`;
    const progressMessages = [
      `${cityGuess}의 '${label}' 담당 부서를 확인하고 있습니다...`,
      `${cityGuess} 공식 자료를 조회하고 있습니다...`,
      `조직도 정보를 분석하고 있습니다...`,
      `담당 부서명을 추출하고 있습니다...`,
    ];
    let tick = 0;
    await send({ status: 'progress', elapsed: 0, message: progressMessages[0] });
    const interval = setInterval(() => {
      tick++;
      send({ status: 'progress', elapsed: tick, message: progressMessages[tick % progressMessages.length] })
        .catch((e) => console.error('[sigungu-dept-resolve] 진행상황 전송 실패(무시):', e.message));
    }, 1000);

    let deptName = null;
    if (env.WEB_SEARCH_API_KEY) {
      try {
        const searchRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': env.WEB_SEARCH_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, gl: 'kr', hl: 'ko' }),
        });
        if (searchRes.ok) {
          const raw = await searchRes.json().catch(() => null);
          const organic = raw?.organic || null;
          deptName = _sigunguExtractDeptName(organic, cityGuess);
        }
      } catch (e) {
        console.error('[sigungu-dept-resolve] Serper 호출 실패:', e.message);
      }
    }

    clearInterval(interval);

    if (ctx?.waitUntil) {
      ctx.waitUntil(_sigunguRecordResolveLog({
        city_guess: cityGuess, domain, query,
        outcome: deptName ? 'resolved' : 'not_found',
        resolved_dept_name: deptName || null,
      }, env).catch((e) => console.error('[sigungu-dept-resolve] 로그 기록 실패(무시):', e.message)));
    }

    if (deptName) {
      if (env.GOV_DATA_KV) {
        try {
          await env.GOV_DATA_KV.put(cacheKey, JSON.stringify({ deptName, resolvedAt: new Date().toISOString() }),
            { expirationTtl: SIGUNGU_RESOLVE_TTL });
        } catch (e) {
          console.error('[sigungu-dept-resolve] KV 저장 실패(무시):', e.message);
        }
      }
      await send({
        status: 'done',
        text: `${cityGuess}의 '${label}' 관련 문의는 **${deptName}**에서 담당합니다.`,
        verified: true, source: 'live_search', _debug: _sigunguDebug,
      });
    } else {
      await send({
        status: 'done', text: _sigunguRenderFallback(cityGuess, domain),
        verified: false, source: 'template_fallback', _debug: _sigunguDebug,
      });
    }
    await writer.close();
  })();

  if (ctx?.waitUntil) {
    // 스트림이 끝까지 안 써지고 끊겨도(클라이언트 중도 이탈 등) Worker가
    // 조기 종료되지 않도록 — 위 streamTask 자체는 이미 실행 중이라
    // waitUntil은 안전망일 뿐이다.
    ctx.waitUntil(streamTask.catch((e) => console.error('[sigungu-dept-resolve] 스트림 처리 실패:', e.message)));
  }

  return new Response(readable, { headers: streamHeaders });
}


// ── 국가기관 지사(L·중앙정부 지역사무소) 지연 초기화 리졸버 (2026-07-20 신설) ──
// 시군구 리졸버(/gov/sigungu-dept-resolve)와 완전히 동일한 철학·구조.
// 원형(SP-NAT-*-TEMPLATE)은 이미 09-national/agencies/templates/에 34개
// 전부 있었다 — 없던 건 제주 외 도의 인스턴스뿐이라 이걸로 채운다.
//
// 19개 핵심 기관(시민 문의 빈도 높은 것)만 원형 폴백 대상 — 명칭 패턴이
// 국가기관은 시군구보다 훨씬 표준화돼 있어("OO세무서", "OO지방법원" 등)
// 확정률이 더 높을 것으로 기대.
const NAT_AGENCY_COMMON_PATTERNS = {
  tax: '{도}세무서', court: '{도}지방법원', prosecution: '{도}지방검찰청',
  police: '{도}지방경찰청', labor: '근로복지공단 {도}지사',
  laborimprove: '{도}지방고용노동청', nhis: '국민건강보험공단 {도}지사',
  nps: '국민연금공단 {도}지역본부', immigration: '{도}출입국·외국인청(사무소)',
  post: '{도}지방우정청', mma: '{도}지방병무청', customs: '{도}세관',
  veterans: '{도}보훈청', weather: '{도}지방기상청', coastguard: '{도}해양경찰서',
  port: '{도}지방해양수산청', probation: '{도}준법지원센터',
  bok: '한국은행 {도}본부', stat: '통계청 {도}사무소',
};
const NAT_AGENCY_LABEL_KO = {
  tax: '세무', court: '법원', prosecution: '검찰', police: '경찰',
  labor: '근로복지', laborimprove: '고용노동', nhis: '건강보험',
  nps: '국민연금', immigration: '출입국', post: '우정(우체국)', mma: '병무',
  customs: '세관', veterans: '보훈', weather: '기상', coastguard: '해양경찰',
  port: '해양수산', probation: '준법지원(보호관찰)', bok: '한국은행', stat: '통계청',
};

function _natAgencyRenderFallback(provinceName, domain) {
  const pattern = NAT_AGENCY_COMMON_PATTERNS[domain];
  const label = NAT_AGENCY_LABEL_KO[domain] || domain;
  if (!pattern) {
    return `'${label}' 관련 국가기관 지사 정보는 아직 확인되지 않았습니다 — 정부24(gov.kr) 또는 ` +
      `국번없이 110(정부민원안내)으로 확인해 주세요.`;
  }
  const guess = pattern.replace('{도}', provinceName);
  return `'${label}' 관련 문의는 통상 **${guess}**(정확한 명칭·관할 미확인 — 일반적인 국가기관 지역조직 ` +
    `명명 패턴에 근거한 추정)에서 담당합니다. 실제 관할·연락처는 해당 기관 공식 홈페이지나 ` +
    `국번없이 110(정부민원안내)으로 재확인을 권합니다.`;
}

// ★ 2026-07-21 추가 — 시군구 리졸버(_sigunguExtractDeptName)에서 실제
// 배포 재현으로 발견한 것과 동일한 유형의 문제를 예방한다: "직위OO
// 세무서장" 같은 스니펫에서 레이블 단어가 후보명 앞에 붙어 같은 기관이
// 서로 다른 문자열로 이중 카운트되며 인위적 동률이 나는 걸 방지.
const _NAT_AGENCY_LABEL_PREFIXES = ['직위', '이름', '성명', '전화번호', '담당업무', '소속', '기관명'];
function _natAgencyStripLabelPrefix(candidate) {
  for (const label of _NAT_AGENCY_LABEL_PREFIXES) {
    if (candidate.startsWith(label) && candidate.length > label.length) return candidate.slice(label.length);
  }
  return candidate;
}
function _natAgencyExtractName(organic, provinceName, domain, cityHint) {
  if (!organic || organic.length === 0) return null;
  const label = NAT_AGENCY_LABEL_KO[domain] || domain;
  // 국가기관은 명칭 패턴이 훨씬 정형화돼 있어("OO지방법원", "OO세무서")
  // 시군구보다 넓게(과/국 접미사 대신) 기관명 접미사로 잡는다.
  const namePattern = /([가-힣]{2,10}(?:세무서|지방법원|지방검찰청|지방경찰청|지사|지방고용노동청|지역본부|출입국\S{0,6}청|지방우정청|지방병무청|세관|보훈청|지방기상청|해양경찰서|지방해양수산청|준법지원센터|본부|사무소))/g;
  const provinceCore = provinceName.replace(/(특별자치도|특별자치시|광역시|특별시|도)$/, '');
  const cityCore = cityHint ? cityHint.replace(/(시|군|구)$/, '') : null;

  // ★ 2026-07-21 추가 — cityHint(시/군)가 있으면 두 갈래로 카운트한다.
  // 실제 배포 재현(홍천군 세무서)에서 확인: 도 전체 관할 목록형 페이지는
  // 전부 .go.kr(국세청 등)에 있지만 스니펫이 짧게 잘려 "홍천" 같은 특정
  // 시/군 이름이 아예 안 보이고, 정작 "홍천세무서"라는 정답이 명시된
  // 페이지는 민간 정리 사이트(.go.kr 아님)에만 있었다. 그래서: (1)
  // .go.kr 공식 도메인 → 기존처럼 도 단위 카운트(provinceCounts, 신뢰도
  // 기준 도메인), (2) cityHint 텍스트까지 명시적으로 일치하면 도메인
  // 불문 카운트(cityCounts, 신뢰도 기준을 도메인 대신 텍스트 특정도로
  // 대체). city 레벨 후보가 있으면 그걸 최우선 채택 — 시/군까지 정확히
  // 언급한 텍스트는 애매할 확률이 낮다. city 레벨이 없거나 동률이면
  // 기존 도 단위 다수결로 폴백(cityHint 없을 때와 완전히 동일 동작,
  // 하위호환 유지).
  const cityCounts = new Map();
  const provinceCounts = new Map();
  for (const r of organic.slice(0, 10)) {
    const text = `${r.title || ''} ${r.snippet || ''}`;
    if (!text.includes(provinceCore)) continue;
    const isOfficial = r.link && r.link.includes('.go.kr');
    const hasCity = !!(cityCore && text.includes(cityCore));
    if (!isOfficial && !hasCity) continue; // 비공식 도메인은 city 일치할 때만 신뢰
    let m;
    while ((m = namePattern.exec(text)) !== null) {
      const cleaned = _natAgencyStripLabelPrefix(m[1]);
      if (isOfficial) provinceCounts.set(cleaned, (provinceCounts.get(cleaned) || 0) + 1);
      if (hasCity) cityCounts.set(cleaned, (cityCounts.get(cleaned) || 0) + 1);
    }
  }

  if (cityCounts.size > 0) {
    const citySorted = [...cityCounts.entries()].sort((a, b) => b[1] - a[1]);
    if (citySorted.length === 1 || citySorted[0][1] > citySorted[1][1]) return citySorted[0][0];
    // city 레벨도 동률이면 아래 도 단위 폴백으로 이어간다.
  }
  if (provinceCounts.size === 0) return null;
  const sorted = [...provinceCounts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return null;
  return sorted[0][0];
}

async function _natAgencyRecordResolveLog(entry, env) {
  try {
    const token = await _l1AdminToken(env);
    await fetch(`${L1_BASE_HOST}/api/collections/national_agency_resolve_log/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ ...entry, recorded_at: new Date().toISOString() }),
    });
  } catch (e) {
    console.error('[national-agency-resolve] 로그 기록 실패:', e.message);
  }
}

const NAT_AGENCY_RESOLVE_TTL = 60 * 60 * 24 * 60; // 60일 — 국가기관은 시군구보다 변동이 적어 더 길게

// GET /gov/national-agency-resolve?domain=tax&province=busan&provinceName=부산광역시
async function handleNationalAgencyResolve(request, url, env, corsHeaders, ctx) {
  const provinceCode = (url.searchParams.get('province') || '').trim();
  const provinceName = (url.searchParams.get('provinceName') || provinceCode).trim();
  const domain = (url.searchParams.get('domain') || '').trim();
  // cityHint(선택, 2026-07-21 신설) — AC가 이미 아는 사용자 위치(PDV/GPS)
  // 로 시/군까지 특정되면, 도 전체가 아니라 그 시/군 관할 지사만 찾는다.
  const cityHint = (url.searchParams.get('city') || '').trim() || null;
  if (!provinceCode || !domain) {
    return _err(400, 'MISSING_PARAM', 'province/domain 파라미터 필수', corsHeaders);
  }

  const _natAgencyDebug = {
    has_web_search_key: !!env.WEB_SEARCH_API_KEY,
    has_kv: !!env.GOV_DATA_KV,
    has_l1_admin: !!(env.L1_ADMIN_EMAIL && env.L1_ADMIN_PASSWORD),
    has_waituntil: !!ctx?.waitUntil,
  };

  // cityHint를 캐시 키에 반영 — 안 하면 홍천군 결과가 다른 시/군
  // 사용자에게도 그대로 캐시로 나가는 사고가 난다.
  const cacheKey = `gov-data:nat-agency:${provinceCode}:${domain}${cityHint ? ':' + cityHint : ''}`;
  if (env.GOV_DATA_KV) {
    try {
      const cached = await env.GOV_DATA_KV.get(cacheKey, 'json');
      if (cached?.agencyName) {
        return new Response(JSON.stringify({
          text: `'${NAT_AGENCY_LABEL_KO[domain] || domain}' 관련 문의는 **${cached.agencyName}**에서 담당합니다.`,
          verified: true, source: 'cache',
        }), { headers: corsHeaders });
      }
    } catch (e) {
      console.error('[national-agency-resolve] KV 조회 실패(무시):', e.message);
    }
  }

  // ── 임시 디버그 모드(&debug=1) — 시군구 리졸버와 동일한 패턴, 원인
  // 파악용. 정상 흐름과 동일하게 실제 검색을 동기적으로 실행하되, 원본
  // 검색 결과와 추출 과정을 응답에 그대로 노출한다.
  if (url.searchParams.get('debug') === '1') {
    const label = NAT_AGENCY_LABEL_KO[domain] || domain;
    const query = `${provinceName} ${cityHint ? cityHint + ' ' : ''}${label} 관할`;
    let organic = null;
    let serperError = null;
    let serperStatus = null;
    try {
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': env.WEB_SEARCH_API_KEY, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: query, gl: 'kr', hl: 'ko' }),
      });
      serperStatus = searchRes.status;
      if (searchRes.ok) {
        const raw = await searchRes.json().catch((e) => { serperError = `JSON 파싱 실패: ${e.message}`; return null; });
        organic = raw?.organic || null;
      } else {
        serperError = await searchRes.text().catch(() => `HTTP ${searchRes.status}`);
      }
    } catch (e) {
      serperError = `fetch 예외: ${e.message}`;
    }
    const agencyName = _natAgencyExtractName(organic, provinceName, domain, cityHint);
    return new Response(JSON.stringify({
      debug_mode: true, _debug: _natAgencyDebug, city_hint: cityHint,
      query, serper_status: serperStatus, serper_error: serperError,
      organic_raw: organic, extracted_agency_name: agencyName,
    }, null, 2), { headers: corsHeaders });
  }

  // ★ 2026-07-21 신설 — 시군구 리졸버(handleSigunguDeptResolve)와 동일한
  // 두 원칙 적용: (1) 캐시 미스여도 추정치를 먼저 던지지 않고 실제
  // 검증(Serper)을 동기적으로 기다린다 — "시간보다 정확한 답이 우선"
  // (주피터 지시). (2) 그 대기 동안 SSE(text/event-stream)로 매초
  // 진행상황을 흘려보낸다. 캐시 히트·잘못된 요청은 기존처럼 즉시 단일
  // JSON 응답(스트리밍 불필요), 실제 검색이 필요한 경우만 스트리밍한다.
  const streamHeaders = { ...corsHeaders, 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache' };
  const encoder = new TextEncoder();
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const send = (obj) => writer.write(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));

  const streamTask = (async () => {
    const label = NAT_AGENCY_LABEL_KO[domain] || domain;
    const query = `${provinceName} ${cityHint ? cityHint + ' ' : ''}${label} 관할`;
    const progressMessages = [
      `'${label}' 관련 담당 기관을 확인하고 있습니다...`,
      `${provinceName} 관할 지역사무소를 조회하고 있습니다...`,
      `공식 자료를 분석하고 있습니다...`,
      `기관명을 추출하고 있습니다...`,
    ];
    let tick = 0;
    await send({ status: 'progress', elapsed: 0, message: progressMessages[0] });
    const interval = setInterval(() => {
      tick++;
      send({ status: 'progress', elapsed: tick, message: progressMessages[tick % progressMessages.length] })
        .catch((e) => console.error('[national-agency-resolve] 진행상황 전송 실패(무시):', e.message));
    }, 1000);

    let agencyName = null;
    if (env.WEB_SEARCH_API_KEY) {
      try {
        const searchRes = await fetch('https://google.serper.dev/search', {
          method: 'POST',
          headers: { 'X-API-KEY': env.WEB_SEARCH_API_KEY, 'Content-Type': 'application/json' },
          body: JSON.stringify({ q: query, gl: 'kr', hl: 'ko' }),
        });
        if (searchRes.ok) {
          const raw = await searchRes.json().catch(() => null);
          const organic = raw?.organic || null;
          agencyName = _natAgencyExtractName(organic, provinceName, domain, cityHint);
        }
      } catch (e) {
        console.error('[national-agency-resolve] Serper 호출 실패:', e.message);
      }
    }

    clearInterval(interval);

    if (ctx?.waitUntil) {
      ctx.waitUntil(_natAgencyRecordResolveLog({
        province_code: provinceCode, domain, query,
        outcome: agencyName ? 'resolved' : 'not_found',
        resolved_agency_name: agencyName || null,
      }, env).catch((e) => console.error('[national-agency-resolve] 로그 기록 실패(무시):', e.message)));
    }

    if (agencyName) {
      if (env.GOV_DATA_KV) {
        try {
          await env.GOV_DATA_KV.put(cacheKey, JSON.stringify({ agencyName, resolvedAt: new Date().toISOString() }),
            { expirationTtl: NAT_AGENCY_RESOLVE_TTL });
        } catch (e) {
          console.error('[national-agency-resolve] KV 저장 실패(무시):', e.message);
        }
      }
      await send({
        status: 'done',
        text: `'${label}' 관련 문의는 **${agencyName}**에서 담당합니다.`,
        verified: true, source: 'live_search', _debug: _natAgencyDebug,
      });
    } else {
      await send({
        status: 'done', text: _natAgencyRenderFallback(provinceName, domain),
        verified: false, source: 'template_fallback', _debug: _natAgencyDebug,
      });
    }
    await writer.close();
  })();

  if (ctx?.waitUntil) {
    ctx.waitUntil(streamTask.catch((e) => console.error('[national-agency-resolve] 스트림 처리 실패:', e.message)));
  }

  return new Response(readable, { headers: streamHeaders });
}

// ── POST /web-search (Serper.dev 연동, 2026-07-11 신설) ────────────
// K-Search RULE-07 "대체형"([WEB_SEARCH: query=...] 태그, call-ai.js가
// 파싱)이 호출한다. §0-B 경로1(웹검색)이 이번까지는 원칙 서술뿐이고
// 실제 실행 수단이 없었다 — 이 엔드포인트가 그 실행 수단이다.
// 키는 서버(WEB_SEARCH_API_KEY env secret)에만 있고 클라이언트에
// 노출되지 않는다(SUPABASE_KEY와 동일 원칙).
//
// 비용 통제 2단: (1) Cloudflare Cache API로 동일 쿼리 1시간 캐시
// (캐시 히트는 예산 카운트 안 함), (2) 일일 예산(WEB_SEARCH_DAILY_CAP,
// 기본 500회) 초과 시 실제 호출을 막고 정직하게 한도 초과를 반환한다.
async function handleWebSearch(request, env, corsHeaders, ctx) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  const query = (payload.query || payload.q || '').trim();
  if (!query) return new Response(JSON.stringify({ error: 'query required' }), { status: 400, headers: corsHeaders });

  const cacheKey = new Request(`https://web-search-cache.internal/?q=${encodeURIComponent(query.toLowerCase())}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json();
    return new Response(JSON.stringify({ ...body, cache: 'hit' }), { headers: corsHeaders });
  }

  if (!env.WEB_SEARCH_API_KEY) {
    return new Response(JSON.stringify({
      error: 'WEB_SEARCH_NOT_CONFIGURED',
      message: 'WEB_SEARCH_API_KEY가 설정되지 않았습니다 — wrangler secret put WEB_SEARCH_API_KEY로 등록하세요.',
    }), { status: 503, headers: corsHeaders });
  }

  const today = _todayKST();
  const cap = Number(env.WEB_SEARCH_DAILY_CAP) || 500;
  let usage;
  try {
    usage = await _l1GetWebSearchUsage(env, today);
  } catch (e) {
    usage = null; // 예산 조회 실패는 안전하게 "아직 0회"로 간주(과금 폭주보다 검색 실패가 낫다는 판단)
  }
  if (usage && Number(usage.count) >= cap) {
    return new Response(JSON.stringify({
      error: 'DAILY_BUDGET_EXCEEDED',
      message: `오늘 웹검색 한도(${cap}회)를 초과했습니다. 내일 다시 시도해주세요.`,
      count: usage.count,
    }), { status: 429, headers: corsHeaders });
  }

  let searchRes;
  try {
    searchRes = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': env.WEB_SEARCH_API_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q: query, gl: 'kr', hl: 'ko' }),
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'FETCH_FAILED', message: e.message }), { status: 502, headers: corsHeaders });
  }

  // 예산 증분은 API 호출 성공 여부와 무관하게(Serper.dev 쪽에서 이미
  // 과금됐을 가능성이 있는 요청이므로) 시도했다는 사실 자체로 센다.
  ctx?.waitUntil?.(_l1IncrementWebSearchUsage(env, today).catch((e) => {
    console.warn('[web-search] 예산 카운터 증분 실패:', e.message);
  }));

  if (!searchRes.ok) {
    const errText = await searchRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'SERPER_ERROR', status: searchRes.status, detail: errText }), { status: 502, headers: corsHeaders });
  }

  const raw = await searchRes.json().catch(() => ({}));
  const organic = Array.isArray(raw.organic) ? raw.organic.slice(0, 5) : [];
  const result = {
    query,
    answer_box: raw.answerBox ? { title: raw.answerBox.title, snippet: raw.answerBox.snippet } : null,
    knowledge_graph: raw.knowledgeGraph ? { title: raw.knowledgeGraph.title, description: raw.knowledgeGraph.description } : null,
    organic: organic.map(r => ({ title: r.title, link: r.link, snippet: r.snippet })),
    source: 'serper.dev',
    cache: 'miss',
  };

  const cacheResponse = new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=3600' },
  });
  ctx?.waitUntil?.(cache.put(cacheKey, cacheResponse.clone()));

  return new Response(JSON.stringify(result), { headers: corsHeaders });
}

// ── 공공데이터포털: 행정표준코드_법정동코드 (2026-07-16 신설) ────────
// PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0 STEP 1.
// 요청주소: http://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList
// 서비스키는 서버(DATA_GO_KR_API_KEY env secret)에만 있고 클라이언트에
// 노출되지 않는다(WEB_SEARCH_API_KEY와 동일 원칙).
//
// ★ 배치 전용 설계 — 이 엔드포인트는 사용자 요청 경로에서 실시간
//   호출되지 않는다(사고실험 시나리오 9). province-tier SP/GDC L1은
//   이 API가 아니라 PocketBase에 저장된 스냅샷을 읽는다. 이 엔드포인트는
//   그 스냅샷을 채우는 배치(Cron Trigger 또는 수동 트리거) 전용이다.
//
// ★ 입력은 자유 텍스트가 아니라 16개 광역시도 화이트리스트로 정규화한다
//   (사고실험 시나리오 4) — 정규화하지 않으면 캐시가 사실상 무력화되어
//   개발계정 트래픽(10,000회)을 빠르게 소진할 수 있다.
//
// ★ 캐시 키는 서비스키를 절대 포함하지 않는다(사고실험 시나리오 8) —
//   handleWebSearch의 cacheKey 패턴(쿼리 텍스트만 사용)을 그대로 따른다.

const SIDO_WHITELIST = [
  '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시',
  '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도',
  '충청북도', '충청남도', '전북특별자치도', '전남광주통합특별시',
  '경상북도', '경상남도', '제주특별자치도',
];
// ★ 위 목록은 GOV-TIER-IO-SCHEMA_v1_1 §A 적용대상과 동일하게 16개로
//   맞췄다(전남광주통합특별시 병합 반영, 2026-07-01). 이 목록 자체도
//   조직개편 시 갱신 대상이라는 점은 GOV-TIER-IO-SCHEMA의 "갱신 원칙"과
//   동일하게 적용된다 — 하드코딩이 아니라 "현재 알려진 최신값"으로 취급.

function _normalizeSidoQuery(raw) {
  const q = (raw || '').trim();
  // 정확히 일치하는 경우만 허용 — 부분 매칭은 의도치 않은 캐시 분산을
  // 유발하므로(시나리오 4) 여기서는 엄격 일치만 허용한다. 부분 검색이
  // 필요하면 별도 오토컴플리트 레이어를 SP-Search 쪽에 둔다.
  return SIDO_WHITELIST.includes(q) ? q : null;
}

async function _l1GetPublicDataUsage(env, dataset, date) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`dataset='${dataset}' && date='${date}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/public_data_usage/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`public_data_usage 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0] || null;
}

async function _l1IncrementPublicDataUsage(env, dataset, date) {
  const existing = await _l1GetPublicDataUsage(env, dataset, date);
  const token = await _l1AdminToken(env);
  if (existing) {
    const res = await fetch(`${L1_DEFAULT}/api/collections/public_data_usage/records/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ count: (Number(existing.count) || 0) + 1 }),
    });
    if (!res.ok) throw new Error(`public_data_usage PATCH 실패 (HTTP ${res.status})`);
    return res.json();
  }
  const res = await fetch(`${L1_DEFAULT}/api/collections/public_data_usage/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ dataset, date, count: 1 }),
  });
  if (!res.ok) throw new Error(`public_data_usage 생성 실패 (HTTP ${res.status})`);
  return res.json();
}

async function handleBdongCode(request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const rawQuery = url.searchParams.get('q') || '';
  const sido = _normalizeSidoQuery(rawQuery);
  if (!sido) {
    return new Response(JSON.stringify({
      error: 'INVALID_SIDO',
      message: '16개 광역시도 명칭과 정확히 일치하는 값을 q 파라미터로 보내주세요.',
      allowed: SIDO_WHITELIST,
    }), { status: 400, headers: corsHeaders });
  }

  // 캐시 키는 정규화된 sido 값만 사용 — 서비스키 미포함(시나리오 8)
  const cacheKey = new Request(`https://bdong-code-cache.internal/?sido=${encodeURIComponent(sido)}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json();
    return new Response(JSON.stringify({ ...body, cache: 'hit' }), { headers: corsHeaders });
  }

  if (!env.DATA_GO_KR_API_KEY) {
    return new Response(JSON.stringify({
      error: 'PUBLIC_DATA_NOT_CONFIGURED',
      message: 'DATA_GO_KR_API_KEY가 설정되지 않았습니다 — wrangler secret put DATA_GO_KR_API_KEY로 등록하세요.',
    }), { status: 503, headers: corsHeaders });
  }

  const DATASET = 'bdong_code';
  const today = _todayKST();
  const cap = Number(env.PUBLIC_DATA_DAILY_CAP_BDONG || env.PUBLIC_DATA_DAILY_CAP) || 300;
  let usage;
  try {
    usage = await _l1GetPublicDataUsage(env, DATASET, today);
  } catch (e) {
    usage = null; // 예산 조회 실패는 안전하게 "아직 0회"로 간주(과금 폭주보다 조회 실패가 낫다는 기존 판단과 동일)
  }
  if (usage && Number(usage.count) >= cap) {
    return new Response(JSON.stringify({
      error: 'DAILY_BUDGET_EXCEEDED',
      message: `오늘 법정동코드 조회 한도(${cap}회)를 초과했습니다. 내일 다시 시도해주세요.`,
      count: usage.count,
    }), { status: 429, headers: corsHeaders });
  }

  const apiUrl = new URL('http://apis.data.go.kr/1741000/StanReginCd/getStanReginCdList');
  apiUrl.searchParams.set('serviceKey', env.DATA_GO_KR_API_KEY);
  apiUrl.searchParams.set('pageNo', '1');
  apiUrl.searchParams.set('numOfRows', '1000');
  apiUrl.searchParams.set('type', 'json');
  apiUrl.searchParams.set('locatadd_nm', sido);

  let apiRes;
  try {
    apiRes = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'FETCH_FAILED', message: e.message }), { status: 502, headers: corsHeaders });
  }

  // 예산 증분은 API 호출 성공 여부와 무관하게(공공데이터포털 쪽에서
  // 이미 카운트됐을 가능성이 있는 요청이므로) 시도했다는 사실 자체로 센다.
  ctx?.waitUntil?.(_l1IncrementPublicDataUsage(env, DATASET, today).catch((e) => {
    console.warn('[bdong-code] 예산 카운터 증분 실패:', e.message);
  }));

  if (!apiRes.ok) {
    const errText = await apiRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'DATA_GO_KR_ERROR', status: apiRes.status, detail: errText }), { status: 502, headers: corsHeaders });
  }

  const raw = await apiRes.json().catch(() => ({}));
  const items = raw?.StanReginCd?.[1]?.row || raw?.response?.body?.items?.item || [];
  const rows = (Array.isArray(items) ? items : [items]).filter(Boolean).map(r => ({
    region_cd: r.region_cd,
    locatadd_nm: r.locatadd_nm,
    locallow_nm: r.locallow_nm,
    locathigh_cd: r.locathigh_cd,
    adpt_de: r.adpt_de,
    locat_rm: r.locat_rm || null, // ★ 병합·폐지 이력은 이 비고란에 자연어로 담길 수 있음 —
                                    //   사람 검토 큐(§3-C)에서 반드시 확인할 필드
  }));

  const result = { sido, count: rows.length, rows, source: 'data.go.kr/StanReginCd', cache: 'miss' };

  const cacheResponse = new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=86400' }, // 24h TTL — PLAN §4
  });
  ctx?.waitUntil?.(cache.put(cacheKey, cacheResponse.clone()));

  return new Response(JSON.stringify(result), { headers: corsHeaders });
}

// ── 공공데이터포털: 법제처 국가법령정보 (법령정보 목록 조회) (2026-07-16 신설) ──
// PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0 STEP 2.
// 요청주소: https://apis.data.go.kr/1170000/law/lawSearchList.do
// DATA_GO_KR_API_KEY 재사용(법정동코드와 동일 계정 공용 인증키, 승인상세 확인 완료).
//
// ★ 이용허락범위: "제3자 권리 포함 — 저작권 표시" + "공공저작물 출처표시
//   (제1유형)"가 걸려 있다(법정동코드와 달리 제한 없음이 아님 — PLAN §5
//   시나리오 6에서 예견한 케이스가 실제로 발생). 따라서 이 함수의 응답에는
//   항상 attribution 필드를 강제로 포함시킨다. 이 데이터를 사용자에게
//   그대로 노출하는 SP/화면에서는 반드시 이 attribution을 함께 표시해야 한다.
//
// ★ 판례(대법원 등)는 이 API 범위 밖이다 — open.law.go.kr의 별도 OC 인증
//   체계를 쓰므로 STEP 2-b(handleLawPrecedent, LAW_GO_KR_OC secret)로 분리.
//
// ★ 배치 전용은 아니다(법정동코드와 다름) — 법령 검색은 사용자 질의마다
//   달라지는 자유 검색이라 SP-Law가 사용자 요청 경로에서 실시간 호출한다.
//   대신 캐시 TTL을 6h로 두어(PLAN §4) 같은 검색어 반복 호출 비용을 줄인다.

// _l1GetPublicDataUsage / _l1IncrementPublicDataUsage는 STEP 1(handleBdongCode)에서
// 이미 정의됐고 dataset 인자로 데이터셋을 구분하므로 그대로 재사용한다.

async function handleLawSearch(request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const query = (url.searchParams.get('q') || '*').trim() || '*';
  const pageNo = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const numOfRows = Math.min(100, Math.max(1, Number(url.searchParams.get('rows')) || 20));

  // 캐시 키 — 서비스키 미포함, 검색어+페이지 조합만 사용(시나리오 8과 동일 원칙)
  const cacheKey = new Request(`https://law-search-cache.internal/?q=${encodeURIComponent(query)}&page=${pageNo}&rows=${numOfRows}`);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json();
    return new Response(JSON.stringify({ ...body, cache: 'hit' }), { headers: corsHeaders });
  }

  if (!env.DATA_GO_KR_API_KEY) {
    return new Response(JSON.stringify({
      error: 'PUBLIC_DATA_NOT_CONFIGURED',
      message: 'DATA_GO_KR_API_KEY가 설정되지 않았습니다.',
    }), { status: 503, headers: corsHeaders });
  }

  const DATASET = 'law_search';
  const today = _todayKST();
  const cap = Number(env.PUBLIC_DATA_DAILY_CAP_LAW || env.PUBLIC_DATA_DAILY_CAP) || 300;
  let usage;
  try {
    usage = await _l1GetPublicDataUsage(env, DATASET, today);
  } catch (e) {
    usage = null;
  }
  if (usage && Number(usage.count) >= cap) {
    return new Response(JSON.stringify({
      error: 'DAILY_BUDGET_EXCEEDED',
      message: `오늘 법령검색 조회 한도(${cap}회)를 초과했습니다. 내일 다시 시도해주세요.`,
      count: usage.count,
    }), { status: 429, headers: corsHeaders });
  }

  const apiUrl = new URL('https://apis.data.go.kr/1170000/law/lawSearchList.do');
  apiUrl.searchParams.set('serviceKey', env.DATA_GO_KR_API_KEY);
  apiUrl.searchParams.set('target', 'law');
  apiUrl.searchParams.set('query', query);
  apiUrl.searchParams.set('numOfRows', String(numOfRows));
  apiUrl.searchParams.set('pageNo', String(pageNo));

  let apiRes;
  try {
    apiRes = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'FETCH_FAILED', message: e.message }), { status: 502, headers: corsHeaders });
  }

  ctx?.waitUntil?.(_l1IncrementPublicDataUsage(env, DATASET, today).catch((e) => {
    console.warn('[law-search] 예산 카운터 증분 실패:', e.message);
  }));

  if (!apiRes.ok) {
    const errText = await apiRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'DATA_GO_KR_ERROR', status: apiRes.status, detail: errText }), { status: 502, headers: corsHeaders });
  }

  // 이 API는 XML이 기본이라(데이터포맷: XML) 여기서는 텍스트로 받은 뒤
  // 최소한의 필드만 정규식으로 뽑아 정리한다. 전면적인 XML 파서 도입은
  // 다음 STEP에서 XML 응답 데이터셋이 더 늘어나면 공용 유틸로 뺀다.
  const xmlText = await apiRes.text();

  function extractAll(tag, text) {
    const re = new RegExp(`<${tag}>([\s\S]*?)</${tag}>`, 'g');
    const out = [];
    let m;
    while ((m = re.exec(text)) !== null) out.push(m[1].trim());
    return out;
  }

  const rows = extractAll('법령명한글', xmlText).map((name, i) => ({
    법령명한글: name,
    법령ID: extractAll('법령ID', xmlText)[i] || null,
    법령일련번호: extractAll('법령일련번호', xmlText)[i] || null,
    현행연혁코드: extractAll('현행연혁코드', xmlText)[i] || null,
    공포일자: extractAll('공포일자', xmlText)[i] || null,
    시행일자: extractAll('시행일자', xmlText)[i] || null,
    소관부처명: extractAll('소관부처명', xmlText)[i] || null,
    법령구분명: extractAll('법령구분명', xmlText)[i] || null,
    법령상세링크: extractAll('법령상세링크', xmlText)[i] || null,
  }));
  const totalCntMatch = xmlText.match(/<totalCnt>(\d+)<\/totalCnt>/);

  const result = {
    query,
    page: pageNo,
    numOfRows,
    totalCnt: totalCntMatch ? Number(totalCntMatch[1]) : rows.length,
    rows,
    source: 'data.go.kr/1170000/law (법제처 국가법령정보 공유서비스)',
    attribution: '자료출처: 법제처 국가법령정보센터 (공공저작물 출처표시 제1유형)', // ★ 이용허락범위 준수 — 응답 노출 시 반드시 함께 표시
    cache: 'miss',
  };

  const cacheResponse = new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' }, // 6h TTL — PLAN §4
  });
  ctx?.waitUntil?.(cache.put(cacheKey, cacheResponse.clone()));

  return new Response(JSON.stringify(result), { headers: corsHeaders });
}

// ── open.law.go.kr: 판례 목록/본문 조회 (2026-07-16 신설) ──────────────
// PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0 STEP 2-b.
// data.go.kr이 아니라 별도 시스템(국가법령정보 공동활용) — 인증은
// env.LAW_GO_KR_OC(값 "openhash")를 OC 요청변수로 넘긴다.
// DATA_GO_KR_API_KEY와는 완전히 무관하니 혼동하지 말 것.
//
// ★ mode=search: 판례 목록 검색 (사건명/본문 키워드)
// ★ mode=detail: 판례 본문 조회 (판례일련번호 ID 필요 — 보통 search
//   결과의 "판례상세링크"나 판례일련번호 필드에서 얻는다)
//
// ★ 캐시 TTL 6h — 법령검색(STEP 2)과 동일 이유(PLAN §4 표에는 없던 값이라
//   법령정보와 같은 갱신 빈도로 잠정 설정, 실제 판례 갱신 주기가 다르면
//   추후 조정)

async function handleLawPrecedent(request, env, corsHeaders, ctx) {
  const url = new URL(request.url);
  const mode = url.searchParams.get('mode') === 'detail' ? 'detail' : 'search';

  if (!env.LAW_GO_KR_OC) {
    return new Response(JSON.stringify({
      error: 'LAW_OC_NOT_CONFIGURED',
      message: 'LAW_GO_KR_OC가 설정되지 않았습니다 — open.law.go.kr에서 발급받은 OC 값을 등록하세요.',
    }), { status: 503, headers: corsHeaders });
  }

  const cacheKeyStr = mode === 'detail'
    ? `https://law-prec-cache.internal/?mode=detail&id=${encodeURIComponent(url.searchParams.get('id') || '')}`
    : `https://law-prec-cache.internal/?mode=search&q=${encodeURIComponent(url.searchParams.get('q') || '')}&page=${url.searchParams.get('page') || '1'}`;
  const cacheKey = new Request(cacheKeyStr);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const body = await cached.json();
    return new Response(JSON.stringify({ ...body, cache: 'hit' }), { headers: corsHeaders });
  }

  const DATASET = 'law_precedent';
  const today = _todayKST();
  const cap = Number(env.PUBLIC_DATA_DAILY_CAP_LAW_PREC || env.PUBLIC_DATA_DAILY_CAP) || 300;
  let usage;
  try {
    usage = await _l1GetPublicDataUsage(env, DATASET, today);
  } catch (e) {
    usage = null;
  }
  if (usage && Number(usage.count) >= cap) {
    return new Response(JSON.stringify({
      error: 'DAILY_BUDGET_EXCEEDED',
      message: `오늘 판례 조회 한도(${cap}회)를 초과했습니다. 내일 다시 시도해주세요.`,
      count: usage.count,
    }), { status: 429, headers: corsHeaders });
  }

  let apiUrl;
  if (mode === 'detail') {
    const id = url.searchParams.get('id');
    if (!id) {
      return new Response(JSON.stringify({ error: 'MISSING_ID', message: 'mode=detail에는 id(판례일련번호)가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }
    apiUrl = new URL('http://www.law.go.kr/DRF/lawService.do');
    apiUrl.searchParams.set('target', 'prec');
    apiUrl.searchParams.set('ID', id);
  } else {
    const query = (url.searchParams.get('q') || '').trim();
    if (!query) {
      return new Response(JSON.stringify({ error: 'MISSING_QUERY', message: 'mode=search(기본값)에는 q가 필요합니다.' }), { status: 400, headers: corsHeaders });
    }
    apiUrl = new URL('http://www.law.go.kr/DRF/lawSearch.do');
    apiUrl.searchParams.set('target', 'prec');
    apiUrl.searchParams.set('query', query);
    apiUrl.searchParams.set('display', String(Math.min(100, Math.max(1, Number(url.searchParams.get('rows')) || 20))));
    apiUrl.searchParams.set('page', String(Math.max(1, Number(url.searchParams.get('page')) || 1)));
  }
  apiUrl.searchParams.set('OC', env.LAW_GO_KR_OC);
  apiUrl.searchParams.set('type', 'JSON');

  let apiRes;
  try {
    apiRes = await fetch(apiUrl.toString(), { signal: AbortSignal.timeout(8000) });
  } catch (e) {
    return new Response(JSON.stringify({ error: 'FETCH_FAILED', message: e.message }), { status: 502, headers: corsHeaders });
  }

  ctx?.waitUntil?.(_l1IncrementPublicDataUsage(env, DATASET, today).catch((e) => {
    console.warn('[law-precedent] 예산 카운터 증분 실패:', e.message);
  }));

  if (!apiRes.ok) {
    const errText = await apiRes.text().catch(() => '');
    return new Response(JSON.stringify({ error: 'LAW_GO_KR_ERROR', status: apiRes.status, detail: errText }), { status: 502, headers: corsHeaders });
  }

  const raw = await apiRes.json().catch(() => null);
  if (raw === null) {
    // JSON 파싱 실패 — open.law.go.kr이 이 요청엔 XML/HTML을 돌려줬을 수
    // 있다(문서에 JSON 봉투가 명시 안 된 것과 같은 맥락). 지어내지 않고
    // 실패를 그대로 알린다.
    return new Response(JSON.stringify({
      error: 'UNEXPECTED_RESPONSE_FORMAT',
      message: 'open.law.go.kr 응답을 JSON으로 파싱하지 못했습니다 — 실제 응답 구조를 확인해 STEP 2-c에서 보정이 필요합니다.',
    }), { status: 502, headers: corsHeaders });
  }

  // STEP 2-c(2026-07-16 실측 확정) — 봉투 없이 최상위에 바로 옴
  const unwrapped = raw?.PrecSearch || raw?.PrecService || raw;

  let rows = null;
  let totalCnt = null;
  if (mode === 'search' && Array.isArray(unwrapped?.prec)) {
    // 실제 라이브 호출로 확인된 필드명 그대로 사용(지어내지 않음, 2026-07-16 확인)
    rows = unwrapped.prec.map(p => ({
      판례일련번호: p['판례일련번호'] ?? null,
      사건명:       p['사건명'] ?? null,
      사건번호:     p['사건번호'] ?? null,
      법원명:       p['법원명'] ?? null,
      법원종류코드: p['법원종류코드'] || null,
      선고:         p['선고'] ?? null,
      선고일자:     p['선고일자'] ?? null,
      사건종류명:   p['사건종류명'] ?? null,
      사건종류코드: p['사건종류코드'] ?? null,
      판결유형:     p['판결유형'] ?? null,
      데이터출처명: p['데이터출처명'] ?? null,
      판례상세링크: p['판례상세링크'] ?? null,
    }));
    totalCnt = Number(unwrapped.totalCnt) || rows.length;
  }
  // mode=detail(본문 조회)은 실측 샘플이 아직 없어 raw 그대로 유지 —
  // 지어내지 않고 다음 확인 후 STEP 2-d로 정리한다.

  const result = {
    mode,
    ...(rows !== null ? { totalCnt, rows } : { raw: unwrapped }),
    source: 'open.law.go.kr (국가법령정보 공동활용, 법제처)',
    attribution: '자료출처: 법제처 국가법령정보센터',
    cache: 'miss',
  };

  const cacheResponse = new Response(JSON.stringify(result), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'max-age=21600' }, // 6h TTL(잠정)
  });
  ctx?.waitUntil?.(cache.put(cacheKey, cacheResponse.clone()));

  return new Response(JSON.stringify(result), { headers: corsHeaders });
}

// ── ATOM_PATTERN 실행 엔진 (2026-07-09 신설) ────────────────────────
// 3~4차 라운드(개인파산·창업 준비 사고실험)에서 확정한 5개 실행 패턴을
// 실제로 구현한다. 지금 시점에 실제로 자동화된 automation_sp는 거의
// 없다는 걸 전제로 정직하게 설계했다 — "자동화됐다"고 지어내지 않고,
// connected/automation_sp 상태에 따라 (a) 실제 GOVSYS-* 프록시 호출을
// 시도하거나 (b) 이용자가 직접 해야 할 일을 구조화해 반환한다. K-Compose
// (SP-20)가 이 결과를 받아 이용자에게 자연스럽게 풀어 전달한다.

async function _callGovSys(env, automationSp, atomInput) {
  // GOVSYS-* 자동화 SP는 대부분 아직 실제 구현이 없다(profile-assistant
  // LBS 사례·worker_datagokr_integration_patch.md에서 이미 밝힌 상태).
  // 같은 worker.js 프로세스 안에서 실행되므로 HTTP로 자기 자신을 다시
  // 호출하지 않고 함수 참조를 직접 매핑한다(SP-DO-TOURISM의
  // fetchJejuTourismBasicInfo()처럼 실제 GOVSYS 함수가 추가되면 아래
  // 표에 등록만 하면 된다). 표가 비어 있는 동안은 전부 정직하게
  // "미구현"으로 떨어진다 — 없는 자동화를 있는 것처럼 만들지 않는다.
  const GOVSYS_FUNCTIONS = {
    // 'GOVSYS-GOV24-FAMILY-CERT': (env, input) => fetchGov24FamilyCert(env, input),
    // 'GOVSYS-WETAX-LICENSE':     (env, input) => fetchWetaxLicenseTax(env, input),
  };
  const fn = GOVSYS_FUNCTIONS[automationSp];
  if (!fn) {
    return { status: 'automation_not_implemented', automation_sp: automationSp };
  }
  try {
    const result = await fn(env, atomInput);
    return { status: 'automated', result };
  } catch (e) {
    return { status: 'automation_failed', error: e.message };
  }
}

function _requiresUserAction(atomRow, reasonKo) {
  return {
    status: 'requires_user_action',
    atom_id: atomRow.atom_id,
    pattern: atomRow.pattern,
    reason: reasonKo,
    unavailable_reason: atomRow.unavailable_reason || null,
  };
}

async function _execReport(env, atomRow, atomInput) {
  // 신고형 — 접수 즉시 수리, 결정 절차 없음. creates_new_status가
  // true면(창설적 신고, 예: 혼인신고) 그 자체로 법률관계가 발생하므로
  // 자동화 여부와 무관하게 최종 접수는 항상 이용자 확인이 필요하다는
  // 점을 결과에 명시한다.
  if (atomRow.connected && atomRow.automation_sp) {
    const r = await _callGovSys(env, atomRow.automation_sp, atomInput);
    if (r.status === 'automated') return { ...r, creates_new_status: !!atomRow.creates_new_status };
  }
  return _requiresUserAction(atomRow,
    atomRow.creates_new_status
      ? '창설적 신고입니다 — 접수 창구에서 본인이 직접 신고해야 법률관계가 발생합니다.'
      : '보고적 신고입니다 — 접수 창구(온라인 가능한 경우 포함)에서 접수해야 합니다.');
}

async function _execDecision(env, atomRow, atomInput) {
  // 심사형(구 APPLY+REGISTER 통합, 4차 라운드 결정) — 재량 심사가
  // 끼면(regulatory_intensity=permit) AI가 결과를 보장할 수 없다는 걸
  // 명시한다(SP-LAW-01 확신도 체계와 결합 지점, ★ 아직 미결합 — 다음
  // 순서 후보로 남김 ★).
  if (atomRow.connected && atomRow.automation_sp) {
    const r = await _callGovSys(env, atomRow.automation_sp, atomInput);
    if (r.status === 'automated') return { ...r, outcome_type: atomRow.outcome_type || null };
  }
  const permitNote = atomRow.regulatory_intensity === 'permit'
    ? ' 재량 심사 대상이라 결과를 보장할 수 없습니다.' : '';
  return _requiresUserAction(atomRow, `심사 절차입니다 — 신청 후 결과를 기다려야 합니다.${permitNote}`);
}

async function _execPay(env, atomRow, atomInput) {
  // 납부형 — self_assessed(신고납부)는 세액 자동계산 자동화 가치가 크고,
  // assessed(부과고지)는 이미 관청이 계산해줘서 "고지서 조회"만 필요하다
  // (4차 라운드 결정, 방향이 반대이므로 분기 유지).
  if (atomRow.connected && atomRow.automation_sp) {
    const r = await _callGovSys(env, atomRow.automation_sp, atomInput);
    if (r.status === 'automated') return { ...r, pay_subtype: atomRow.pay_subtype || null };
  }
  return _requiresUserAction(atomRow,
    atomRow.pay_subtype === 'assessed'
      ? '부과고지형 — 관청이 계산한 고지서를 조회해 납부해야 합니다.'
      : '신고납부형 — 세액을 직접(또는 자동계산 지원으로) 계산해 신고·납부해야 합니다.');
}

async function _execQuery(env, atomRow, atomInput) {
  // 조회형 — 결정 절차가 없어 자동화 가치가 가장 크다(신원확인만 되면
  // 즉시 발급). 그럼에도 지금 connected:true인 조회형 atom은 아직 없다
  // (2026-07-09 기준 — gov24-family-cert 등 전부 connected:false).
  if (atomRow.connected && atomRow.automation_sp) {
    const r = await _callGovSys(env, atomRow.automation_sp, atomInput);
    if (r.status === 'automated') return r;
  }
  return _requiresUserAction(atomRow, '조회·발급 절차입니다 — 본인인증 후 직접 발급받아야 합니다.');
}

async function _execAdjudicate(env, atomRow, atomInput) {
  // 심판형 — 법원(judicial)이든 행정심판위원회(administrative_appeal)든
  // 본인인증이 필수라 완전자동화 대상이 아니다(RULE-01 금지-2류 원칙과
  // 동일 — 인간 전속 경계). escalation_to가 있으면 불복 시 다음 단계
  // atom_id를 K-Compose에게 알려준다(4차 라운드에서 설계한 승계관계).
  return {
    ..._requiresUserAction(atomRow, '심판 절차입니다 — 본인인증 후 직접 접수해야 하며, 완전자동화 대상이 아닙니다.'),
    adjudicate_subtype: atomRow.adjudicate_subtype || null,
    escalation_to: atomRow.escalation_to || null,
  };
}

async function _executeAtom(env, atomRow, atomInput) {
  switch (atomRow.pattern) {
    case 'REPORT':     return _execReport(env, atomRow, atomInput);
    case 'DECISION':   return _execDecision(env, atomRow, atomInput);
    case 'PAY':        return _execPay(env, atomRow, atomInput);
    case 'QUERY':      return _execQuery(env, atomRow, atomInput);
    case 'ADJUDICATE': return _execAdjudicate(env, atomRow, atomInput);
    default:
      return { status: 'unknown_pattern', pattern: atomRow.pattern };
  }
}

// POST /orchestration/execute-atom  (body: {atom_id, atom_input})
// K-Compose(SP-20)가 각 step 실행 시 호출한다.
async function handleExecuteAtom(request, env, corsHeaders) {
  let payload;
  try { payload = await request.json(); } catch { return new Response(JSON.stringify({ error: 'invalid json' }), { status: 400, headers: corsHeaders }); }
  if (!payload.atom_id) return new Response(JSON.stringify({ error: 'atom_id required' }), { status: 400, headers: corsHeaders });

  let atomRow;
  try {
    atomRow = await _l1FindAtomRow(env, payload.atom_id);
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 502, headers: corsHeaders });
  }
  if (!atomRow) return new Response(JSON.stringify({ status: 'miss' }), { headers: corsHeaders });
  if (atomRow.status !== 'active') {
    return new Response(JSON.stringify({
      status: 'not_active', atom_status: atomRow.status,
      note: '이 atom은 아직 검토 완료 상태(active)가 아닙니다 — K-Compose가 이용자에게 고지 후 진행해야 합니다.',
    }), { headers: corsHeaders });
  }

  const result = await _executeAtom(env, atomRow, payload.atom_input || {});
  return new Response(JSON.stringify(result), { headers: corsHeaders });
}

// ── L1 profiles upsert — 2026-06-30 user_profiles 이전 작업 ────────────
// L1 profiles 컬렉션 스키마(2026-06-30 확장 후): guid, handle,
// nickname_hash, native_lang, entity_type, is_public, fpHex, e164,
// country_code, nickname, region, pubkey_ed25519, x25519_pubkey,
// x25519_registered_at, push_subscription, push_sound, extra(json).
// Supabase user_profiles에는 있지만 L1엔 컬럼이 없는 필드
// (name/address/lat/lng/phone/website/casts_for)는 extra.core에 접어서
// 같이 저장한다 — 이번 스키마 변경에서 컬럼을 더 늘리지 않기 위함.
async function _l1UpsertProfile(env, { guid, handle, entityType, nativeLang, isPublic, pubkey, extra, core, claimStatus }) {
  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const mergedExtra = { ...(extra || {}), core: { ...(extra?.core || {}), ...(core || {}) } };

  const body = {
    guid,
    handle,
    entity_type: entityType,
    native_lang: nativeLang || 'ko',
    is_public: isPublic !== false,
    pubkey_ed25519: pubkey || undefined,
    extra: mergedExtra,
    // 2026-07-12 신설 — SP-18 STEP3(unclaimed). 안 보내면(undefined) 기존
    // 값을 건드리지 않는다(PATCH 시 필드 생략은 PocketBase가 무변경으로
    // 처리) — 일반 가입 경로가 이 파라미터를 안 넘겨도 기존 claimed
    // 레코드가 실수로 초기화되지 않는다.
    ...(claimStatus ? { claim_status: claimStatus } : {}),
  };

  const existing = await _l1FindProfileByGuid(env, guid).catch(() => null);
  if (existing?.id) {
    const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records/${existing.id}`, {
      method: 'PATCH', headers, body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`L1 profiles PATCH 실패 (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
    return res.json();
  }
  const res = await fetch(`${L1_DEFAULT}/api/collections/profiles/records`, {
    method: 'POST', headers, body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`L1 profiles POST 실패 (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
  return res.json();
}

// L1 profiles 중 push_subscription이 설정된 전체 레코드 조회 (배포 브로드캐스트용, 페이지네이션)
async function _l1ListPushSubscribers(env) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent("push_subscription != ''");
  const out = [];
  let page = 1;
  const perPage = 200;
  while (true) {
    const res = await fetch(
      `${L1_DEFAULT}/api/collections/profiles/records?filter=${filter}&perPage=${perPage}&page=${page}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`L1 조회 실패 (HTTP ${res.status})`);
    const data = await res.json().catch(() => ({ items: [] }));
    out.push(...(data.items || []));
    if (!data.items?.length || data.items.length < perPage) break;
    page++;
    if (page > 50) break; // 안전장치
  }
  return out;
}

// ═══════════════════════════════════════════════════════════
// 메인 fetch 핸들러
// ═══════════════════════════════════════════════════════════
// ── §5.1 브릿지 아웃박스 스윕 — cron이 주기적으로 호출 ────────────────
// 각 L1의 pending bridge_out을 조회해 재릴레이 시도하고, REFUND_TIMEOUT_MS
// (기본 1시간)을 넘긴 건은 보상 트랜잭션(환불)으로 마감한다. tx_hash가
// buyer_guid를 담고 있지 않으므로, 환불 대상 buyer_guid는 pending 레코드
// 자체엔 없다 — PDV 감사 로그(pdv_log)에서 tx_hash로 역조회한다.
const BRIDGE_REFUND_TIMEOUT_MS = 60 * 60 * 1000; // 1시간(§5.1 유예시간)

async function _sweepBridgeOutbox(env) {
  for (const nodeId of L1_ONLY_NODE_IDS) {
    const base = L1_NODE_MAP[nodeId];
    if (!base) continue;
    let pending;
    try {
      const res = await fetch(`${base}/api/bridge-out/pending?bridge_secret=${encodeURIComponent(_bridgeSecret(env))}`);
      const data = await res.json().catch(() => ({ ok: false }));
      if (!data.ok) continue;
      pending = data.pending || [];
    } catch (e) {
      console.warn(`[BridgeSweep] ${nodeId} 폴링 실패:`, e.message);
      continue;
    }
    for (const item of pending) {
      const ageMs = Date.now() - new Date(item.created_at).getTime();
      if (ageMs > BRIDGE_REFUND_TIMEOUT_MS) {
        // 유예시간 초과 — 원 구매자를 PDV 기록(tx_hash 기준)에서 역조회해 환불
        try {
          // (2026-07-14: Supabase pdv_log → L1 pdv_records 이관. raw_hash는
          //  top-level 필드가 아니라 summary_6w JSON 안에 보존돼 있다
          //  (handlePdvReport 참고) — PocketBase가 JSON 내부 값 필터를
          //  지원하지 않아 최근 500건을 넓게 가져와 JS에서 찾는다.)
          const token = await _l1AdminToken(env);
          const pdvRes = await fetch(
            `${L1_DEFAULT}/api/collections/pdv_records/records?sort=-created&perPage=500`,
            { headers: { 'Authorization': 'Bearer ' + token } });
          const pdvData = await pdvRes.json().catch(() => ({ items: [] }));
          const matched = (pdvData.items || []).find(r => {
            try { return JSON.parse(r.summary_6w || '{}').raw_hash === item.tx_hash; } catch { return false; }
          });
          const buyerGuid = matched?.guid;
          if (!buyerGuid) {
            console.error(`[BridgeSweep] ${item.tx_hash} 환불 대상(구매자) 조회 실패 — 수동 감사 필요`);
            continue;
          }
          await fetch(`${base}/api/bridge-out/refund`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tx_hash: item.tx_hash, buyer_guid: buyerGuid, bridge_secret: _bridgeSecret(env) }),
          });
          console.warn(`[BridgeSweep] 유예시간 초과 환불 처리:`, item.tx_hash, '→', buyerGuid);
        } catch (e) {
          console.error(`[BridgeSweep] 환불 처리 실패:`, item.tx_hash, e.message);
        }
      } else {
        // 아직 유예시간 안 — 재시도
        await _relayBridge(env, {
          sourceBase:   base,
          targetNodeId: item.target_node,
          tx_hash:      item.tx_hash,
          guid:         item.guid,
          amount:       item.amount,
        }).catch(e => console.warn('[BridgeSweep] 재시도 실패(다음 스윕에 재시도):', item.tx_hash, e.message));
      }
    }
  }
}

// 2026-07-18 신설 — 테스트 목적 named export. 런타임 동작에는 영향 없음
// (default export의 fetch 핸들러는 그대로 pathname 매칭으로 호출).
export { handleGdcDepositClose, handleGdcDaoProposalCreate, handleGdcDaoVote, handleGdcDaoProposalsList, handleFeeRate, handleInsClaimCreate, handleInsClaimsList, handleVerifyAdmin };

export default {
  // ── Cron 트리거 (10분마다 머클 앵커링 + 브릿지 아웃박스 스윕) ────────
  async scheduled(event, env, ctx) {
    ctx.waitUntil(anchorL1MerkleRoot(env));
    ctx.waitUntil(_sweepBridgeOutbox(env).catch(e => console.error('[BridgeSweep] 전체 실패:', e.message)));
  },

  async fetch(request, env, ctx) {
    const corsOrigin = getCorsOrigin(request);

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'Access-Control-Allow-Origin':      corsOrigin ?? 'null',
          'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods':     'GET, POST, PATCH, DELETE, OPTIONS',
          'Access-Control-Allow-Headers':     'Content-Type, Authorization',
          'Access-Control-Max-Age':           '86400',
        },
      });
    }

    if (corsOrigin === null) {
      return new Response(
        JSON.stringify({ error: 'Forbidden', origin: request.headers.get('Origin') }),
        { status: 403, headers: { 'Content-Type': 'application/json' } }
      );
    }

    const corsHeaders = buildCorsHeaders(corsOrigin);
    const url         = new URL(request.url);
    const pathname    = url.pathname;

    // ── SSO 인증 ──────────────────────────────────────────
    if (pathname === '/auth/issue')              return handleIssue(request, env, corsHeaders);
    if (pathname === '/auth/verify')             return handleVerify(request, env, corsHeaders);
    if (pathname === '/auth/refresh')            return handleRefresh(request, env, corsHeaders);

    // ── WebAuthn ─────────────────────────────────────────
    if (pathname === '/auth/webauthn/challenge') return handleWAChallenge(request, env, corsHeaders);

    // ── PDV ──────────────────────────────────────────────
    if (pathname === '/pdv/query')               return handlePdvQuery(request, env, corsHeaders);
    if (pathname === '/pdv/report')              return handlePdvReport(request, env, corsHeaders);

    // ── 기관측 PDV (§7, SP_PDV v1.2, 2026-07-20 신설) ──────────
    // 사용자측 /pdv/report와 별개 — K-서비스/전문가 페르소나가 자신의
    // 상담·산출물 이력을 가명화 해시로 남기는 거버넌스 레코드.
    if (pathname === '/owner-pdv/report')        return handleOwnerPdvReport(request, env, corsHeaders);

    // ── 오케스트레이션 project_state (2026-07-17 신설 — mode=project
    // human_action 일시정지/재개, SP-19 v1.2/SP-20 v1.6/SP-22 v1.1) ──
    if (pathname === '/orchestration/project-state/save')  return handleProjectStateSave(request, env, corsHeaders);
    if (pathname === '/orchestration/project-state/query') return handleProjectStateQuery(request, env, corsHeaders);

    // ── SP 자기 갱신 제안 (2026-07-17 신설 — K-Intent v1.3/K-Compose
    // v1.7/K-Deliver v1.3/K-Report v1.1 RULE-03) ──
    if (pathname === '/sp-updates/propose')      return handleSpUpdatePropose(request, env, corsHeaders);
    if (pathname === '/user-feedback/submit')    return handleUserFeedbackSubmit(request, env, corsHeaders);
    if (pathname === '/embed-text')              return handleEmbedText(request, env, corsHeaders);

    // ── PDV 조회 동의 승인 페이지 (consent.html 전용, 2026-07-02 신설) ──
    if (pathname === '/consent/info')            return handleConsentInfo(request, env, corsHeaders);
    if (pathname === '/consent/respond')         return handleConsentRespond(request, env, corsHeaders);

    // ── 개인 AC 호출 프로토콜 (PERSONAL-AC-CALL-PROTOCOL_v1_0, 2026-07-15) ──
    // 공무원 AC가 특정 시민의 개인 AC를 호출하는 진입점. 응답(동의/거부)은
    // 기존 /consent/respond를 그대로 재사용 — 새 응답 엔드포인트를 만들지
    // 않는다(consent.html이 이미 이 흐름을 처리함).
    if (pathname === '/personal-ac/call' && request.method === 'POST')
      return handlePersonalAcCall(request, env, corsHeaders);

    // §5 수신확인 3단계(sw.js push/notificationclick 훅이 호출)
    if (pathname === '/pdv/consent-receipt' && request.method === 'POST')
      return handleConsentReceipt(request, env, corsHeaders);

    // ── 서비스 등록 ───────────────────────────────────────
    if (pathname === '/svc/register')            return handleSvcRegister(request, env, corsHeaders);
    if (pathname === '/svc/verify')              return handleSvcVerify(request, env, corsHeaders);

    // ── 지오코딩 / 카카오 ─────────────────────────────────
    if (pathname.startsWith('/geocode'))         return handleGeocode(url, env, corsHeaders);
    if (pathname === '/kakao/appkey')            return handleKakaoAppKey(request, env, corsHeaders);

    // ── search (v4.7) ────────────────────────────────────
    if (pathname === '/search' && request.method === 'POST') return handleSearch(request, env, corsHeaders);

    // ── 정체성 템플릿 참조 조회 (2026-07-17 신설) ─────────
    // profile-assistant SP의 [INDUSTRY_TEMPLATE_LOOKUP]/[PERSON_TEMPLATE_LOOKUP]
    // 태그가 v2.3부터 SP 텍스트엔 있었으나 이 라우트·핸들러가 없어 응답이
    // 항상 유실되고 있었다(실사 발견). 사업자=schema_id(KSIC), 개인=
    // job_ksco.code/work_domain.statuses를 같은 함수로 처리한다.
    if (pathname === '/template-lookup' && request.method === 'POST') return handleTemplateLookup(request, env, corsHeaders);

    // ── 국가데이터처(KOSIS) 통계 리졸버 (2026-07-16 배선) ──
    if (pathname === '/api/stats/resolve') return handleGovDataResolve(request, url, env, corsHeaders);
    // ── 오케스트레이션 레지스트리 (2026-07-08 신설, 2026-07-09 확장 —
    //    AGENT-COMMON §0-H v3.40 / K-Compose SP-20이 참조. PROCEDURE_MAP·
    //    ORG_PROFILE·ATOM_ROW를 실제 L1 PocketBase 컬렉션에 저장한다.
    //    컬렉션 자체는 pb_migrations/1783500001~003로 생성됨(더 이상
    //    관리자 패널 수동 생성 불필요) ──
    if (pathname === '/orchestration/procedure-map' && request.method === 'GET')
      return handleProcedureMapLookup(request, env, corsHeaders);
    if (pathname === '/orchestration/benefit-candidates' && request.method === 'GET')
      return handleBenefitCandidateSearch(request, env, corsHeaders);
    // 2026-07-16 신설 — 임베딩 기반 의미검색(bge-m3+Vectorize). 위
    // /orchestration/benefit-candidates(LIKE 기반)는 SP-20 프로토콜에서
    // 더 이상 참조하지 않지만 비상 폴백으로 코드에 남겨둔다.
    if (pathname === '/orchestration/benefit-semantic-search' && request.method === 'GET')
      return handleBenefitSemanticSearch(request, env, corsHeaders);
    if (pathname === '/orchestration/benefit-embed-index' && request.method === 'POST')
      return handleBenefitEmbedIndex(request, env, corsHeaders);
    if (pathname === '/orchestration/procedure-map/draft' && request.method === 'POST')
      return handleProcedureMapDraft(request, env, corsHeaders);
    if (pathname === '/orchestration/procedure-map/update' && request.method === 'POST')
      return handleProcedureMapUpdate(request, env, corsHeaders);
    if (pathname === '/orchestration/org-profile' && request.method === 'GET')
      return handleOrgProfileLookup(request, env, corsHeaders);
    if (pathname === '/orchestration/org-profile/draft' && request.method === 'POST')
      return handleOrgProfileDraft(request, env, corsHeaders);
    if (pathname === '/orchestration/org-profile/update' && request.method === 'POST')
      return handleOrgProfileUpdate(request, env, corsHeaders);
    if (pathname === '/orchestration/atom-row/draft' && request.method === 'POST')
      return handleAtomRowDraft(request, env, corsHeaders);
    if (pathname === '/orchestration/atom-row/update' && request.method === 'POST')
      return handleAtomRowUpdate(request, env, corsHeaders);
    if (pathname === '/orchestration/execute-atom' && request.method === 'POST')
      return handleExecuteAtom(request, env, corsHeaders);

    // ── SP-Author 자동화 (2026-07-11 신설) ─────────────────────────
    if (pathname === '/sp-author/queue' && request.method === 'POST')
      return handleSPAuthorQueue(request, env, corsHeaders);
    if (pathname === '/sp-author/queue' && request.method === 'GET')
      return handleSPAuthorQueueList(request, env, corsHeaders);
    if (pathname.match(/^\/sp-author\/queue\/[^/]+\/status$/) && request.method === 'POST')
      return handleSPAuthorQueueStatus(request, env, corsHeaders, pathname.split('/')[3]);
    if (pathname === '/sp-author/escalate' && request.method === 'POST')
      return handleSPAuthorEscalate(request, env, corsHeaders);
    if (pathname === '/sp-author/escalations' && request.method === 'GET')
      return handleSPAuthorEscalationList(request, env, corsHeaders);
    if (pathname === '/sp-author/refresh-due' && request.method === 'GET')
      return handleSPAuthorRefreshDue(request, env, corsHeaders);
    if (pathname === '/sp-author/refresh-schedule' && request.method === 'POST')
      return handleSPAuthorRefreshScheduleUpsert(request, env, corsHeaders);

    // ── gwp_registry (2026-07-11 신설) ──────────────────────────────
    if (pathname === '/gwp-registry/lookup' && request.method === 'GET')
      return handleGwpRegistryLookup(request, env, corsHeaders);
    if (pathname === '/gwp-registry/search' && request.method === 'GET')
      return handleGwpRegistrySearch(request, env, corsHeaders);
    if (pathname === '/gwp-registry/register' && request.method === 'POST')
      return handleGwpRegistryRegister(request, env, corsHeaders);

    // ── 웹검색(Serper.dev) (2026-07-11 신설) ────────────────────────
    if (pathname === '/web-search' && request.method === 'POST')
      return handleWebSearch(request, env, corsHeaders, ctx);

    // ── 국가기관 지사 지연초기화 (2026-07-20 신설) ──────────────────
    if (pathname === '/gov/national-agency-resolve' && request.method === 'GET')
      return handleNationalAgencyResolve(request, url, env, corsHeaders, ctx);

    // ── 시군구 부서 지연초기화 (2026-07-20 신설, 2026-07-20 재적용) ──
    if (pathname === '/gov/sigungu-dept-resolve' && request.method === 'GET')
      return handleSigunguDeptResolve(request, url, env, corsHeaders, ctx);

    // ── 공공데이터포털: 법정동코드 (2026-07-16 신설) ────────────────
    // PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0 STEP 1. 배치 전용 —
    // 사용자 요청 경로 실시간 의존 금지(시나리오 9, 위 함수 주석 참고).
    if (pathname === '/public-data/bdong-code' && request.method === 'GET')
      return handleBdongCode(request, env, corsHeaders, ctx);

    // ── 공공데이터포털: 법령정보 목록 조회 (2026-07-16 신설) ──────────
    // PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0 STEP 2. 판례는 범위 밖
    // (open.law.go.kr 별도 OC 인증 — STEP 2-b에서 분리 구현 예정).
    if (pathname === '/public-data/law-search' && request.method === 'GET')
      return handleLawSearch(request, env, corsHeaders, ctx);

    // ── open.law.go.kr: 판례 목록/본문 조회 (2026-07-16 신설) ────────
    // PUBLIC-DATA-PORTAL-INTEGRATION-PLAN_v1_0 STEP 2-b. LAW_GO_KR_OC
    // 사용 — DATA_GO_KR_API_KEY와 무관한 별도 인증.
    if (pathname === '/public-data/law-precedent' && request.method === 'GET')
      return handleLawPrecedent(request, env, corsHeaders, ctx);

    // ── merkle (T10) ─────────────────────────────────────────
    if (pathname === '/merkle/verify')           return handleMerkleVerify(request, env, corsHeaders);

    // ── OpenHash 앵커링 프록시 ────────────────────────────────
    // buildout_plan_v2 Phase 1: 클라이언트가 GitHub 토큰 직접 보유 금지
    // hashChain.js의 _submitToLayer가 이 엔드포인트를 호출
    // worker.js가 OPENHASH_TOKEN으로 repository_dispatch 중계
    if (pathname === '/openhash/anchor' && request.method === 'POST')
      return handleOpenhashAnchor(request, env, corsHeaders);

    // ── OpenHash ILMV 상태 조회 (Phase 5) ───────────────────────────────
    if (pathname === '/openhash/status' && request.method === 'GET')
      return handleOpenhashStatus(request, env, corsHeaders);

    // ── debug (진단용, 인증 불필요) ──────────────────────────
    if (pathname === '/debug/importance' && request.method === 'GET') {
      const amount        = parseFloat(url.searchParams.get('amount')        || '1050');
      const asset_type    = url.searchParams.get('asset_type')    || 'stable';
      const contract_type = url.searchParams.get('contract_type') || 'instant';
      const buyer_region  = url.searchParams.get('buyer_region')  || null;
      const seller_region = url.searchParams.get('seller_region') || null;
      const score = _computeImportanceScore(amount, asset_type, contract_type);
      const mode  = _selectImportanceMode(score);
      const lcat  = computeLCAT(buyer_region, seller_region);
      return new Response(JSON.stringify({
        ok: true,
        input:  { amount, asset_type, contract_type, buyer_region, seller_region },
        output: {
          score: parseFloat(score.toFixed(4)),
          mode,
          lcat,
          thresholds: { LIGHTWEIGHT_MAX: 25, STANDARD_MAX: 60 },
        },
        note: '이 엔드포인트는 score/LCAT 진단 전용입니다. L1 호출 없음.',
      }, null, 2), { status: 200, headers: corsHeaders });
    }

    // ── biz (v4.8+) ──────────────────────────────────────
    if (pathname.startsWith('/biz/profile/'))   return handleBizProfile(request, env, corsHeaders);
    if (pathname === '/gwp/register-key' && request.method === 'POST') return handleRegisterKey(request, env, corsHeaders);
    if (pathname === '/biz/order'   && request.method === 'POST') return handleBizOrder(request, env, corsHeaders, ctx);
    // 2026-07-18 신설 — GDC P2P 이체(혼디 코드 스캔 → 프로필 → 이체).
    // handleBizOrder를 재구현하지 않고, 필드를 매핑해 그대로 위임한다 —
    // handleBizOrder는 이미 items가 비어있으면(P2P 성격) 카탈로그 가격·
    // 수수료 검증을 건너뛰므로 재사용에 적합하다(설계문서
    // docs/gdc_transfer_design_v0_1.md §2 참고). 크로스-L1 브릿지·중요도
    // 점수·재무제표 일치검증·PDV 기록·판매자(수신자) claim 적재까지
    // handleBizOrder의 검증된 로직을 그대로 물려받는다.
    if (pathname === '/wallet/gdc-transfer' && request.method === 'POST') return handleGdcTransfer(request, env, corsHeaders, ctx);
    // 2026-07-18 신설 — 재무제표 대사. 설계문서 Phase 4.
    if (pathname === '/ledger/reconcile' && request.method === 'GET') return handleLedgerReconcile(request, env, corsHeaders);
    // 2026-07-18 신설 — 발행잔액 집계. 설계문서 Phase 5.
    if (pathname === '/ledger/issuance-summary' && request.method === 'GET') return handleLedgerIssuanceSummary(request, env, corsHeaders);
    // 2026-07-18 신설 — 판매자 자격 확인(사업자등록증 첨부, 정부24 발급).
    // 설계문서: docs/gdc_commerce_completion_plan_v0_1.md Phase 2.
    if (pathname === '/seller/verify-submit' && request.method === 'POST') return handleSellerVerifySubmit(request, env, corsHeaders);
    if (pathname === '/seller/verify-status' && request.method === 'GET') return handleSellerVerifyStatus(request, env, corsHeaders);
    // 2026-07-18 신설 — 판매자 인증 승인 절차(admin_guids 재사용).
    if (pathname === '/seller/verify-queue' && request.method === 'GET') return handleSellerVerifyQueue(request, env, corsHeaders);
    if (pathname === '/seller/verify-review' && request.method === 'POST') return handleSellerVerifyReview(request, env, corsHeaders);
    // 2026-07-18 신설 — 거래 이의제기(사후 신고). 설계문서 Phase 3.
    if (pathname === '/ledger/dispute' && request.method === 'POST') return handleTradeDisputeSubmit(request, env, corsHeaders);
    if (pathname === '/ledger/dispute-queue' && request.method === 'GET') return handleTradeDisputeQueue(request, env, corsHeaders);
    if (pathname === '/ledger/dispute-resolve' && request.method === 'POST') return handleTradeDisputeResolve(request, env, corsHeaders);
    if (pathname === '/biz/gdc-deposit' && request.method === 'POST') return handleGdcDepositCreate(request, env, corsHeaders);
    if (pathname === '/biz/gdc-deposits' && request.method === 'GET') return handleGdcDepositList(request, env, corsHeaders);
    if (pathname === '/biz/fee-rate' && request.method === 'GET') return handleFeeRate(request, env, corsHeaders);
    if (pathname === '/biz/gdc-deposit-close' && request.method === 'POST') return handleGdcDepositClose(request, env, corsHeaders);
    if (pathname === '/biz/gdc-dao/proposal'  && request.method === 'POST') return handleGdcDaoProposalCreate(request, env, corsHeaders);
    if (pathname === '/biz/gdc-dao/vote'      && request.method === 'POST') return handleGdcDaoVote(request, env, corsHeaders);
    if (pathname === '/biz/gdc-dao/proposals' && request.method === 'GET')  return handleGdcDaoProposalsList(request, env, corsHeaders);
    // (2026-07-18 신설 — K-Insurance 청구 접수. HONDI_GAP_REMEDIATION_DIRECTIVE
    // v1.0 §2.1 참고: 자동 심사·지급은 이번 범위 밖 — "접수 → 사람이 확인 →
    // 수동 상태 변경"만 구현한다.)
    if (pathname === '/biz/ins-claim'  && request.method === 'POST') return handleInsClaimCreate(request, env, corsHeaders);
    if (pathname === '/biz/ins-claims' && request.method === 'GET')  return handleInsClaimsList(request, env, corsHeaders);
    // (2026-07-18 신설 — 플랫폼 공통 관리자 인증. HONDI_GAP_REMEDIATION_DIRECTIVE
    // v1.0 §2.3 참고. tax 등 각 K-서비스 관리자 대시보드가 이 엔드포인트로
    // "로그인은 했지만 실제 관리자인지"를 검증한다.)
    if (pathname === '/biz/verify-admin' && request.method === 'GET') return handleVerifyAdmin(request, env, corsHeaders);
    if (pathname === '/biz/balance' && request.method === 'GET')  return handleBizBalance(request, env, corsHeaders);
    if (pathname === '/biz/supply'  && request.method === 'GET')  return handleBizSupply(request, env, corsHeaders);
    // (2026-07-14 신설: GDC 충전 파이프라인 — "고정계좌 + 입금자명 매칭")
    if (pathname === '/biz/charge-request' && request.method === 'POST') return handleChargeRequest(request, env, corsHeaders);
    if (pathname === '/biz/charge-status'  && request.method === 'GET')  return handleChargeStatus(request, env, corsHeaders);
    if (pathname === '/biz/charge-list'    && request.method === 'GET')  return handleChargeList(request, env, corsHeaders);
    if (pathname === '/biz/charge-confirm' && request.method === 'POST') return handleChargeConfirm(request, env, corsHeaders);
    // (2026-07-15 신설: 전화번호 OTP — 가입 시 번호 소유 증명, 솔라피 연동)
    if (pathname === '/biz/phone-otp-request' && request.method === 'POST') return handlePhoneOtpRequest(request, env, corsHeaders);
    if (pathname === '/biz/phone-otp-verify'  && request.method === 'POST') return handlePhoneOtpVerify(request, env, corsHeaders);
    // (2026-07-20 신설: 기기 간 지갑 이전 — PC가 폰과 완전히 같은 개인키를
    // 갖도록, SMS 대신 웹푸시로 폰을 깨우고 폰 화면에 뜬 짧은 코드를 PC에
    // 입력받아 페어링한 뒤, X25519 봉투 암호화로 개인키 자체를 옮긴다.
    // 서버는 암호화된 봉투만 중계하며 평문 개인키를 절대 보지 않는다.)
    if (pathname === '/auth/device-link/init'    && request.method === 'POST') return handleDeviceLinkInit(request, env, corsHeaders);
    if (pathname === '/auth/device-link/session'  && request.method === 'GET')  return handleDeviceLinkSession(request, env, corsHeaders);
    if (pathname === '/auth/device-link/verify'   && request.method === 'POST') return handleDeviceLinkVerify(request, env, corsHeaders);
    if (pathname === '/auth/device-link/resend-sms' && request.method === 'POST') return handleDeviceLinkResendSms(request, env, corsHeaders);
    if (pathname === '/auth/device-link/deliver'  && request.method === 'POST') return handleDeviceLinkDeliver(request, env, corsHeaders);
    if (pathname === '/auth/device-link/poll'     && request.method === 'GET')  return handleDeviceLinkPoll(request, env, corsHeaders);
    if (pathname === '/pdv/relay/push'            && request.method === 'POST') return handlePdvRelayPush(request, env, corsHeaders);
    if (pathname === '/pdv/relay/pull'            && request.method === 'GET')  return handlePdvRelayPull(request, env, corsHeaders);
    if (pathname === '/account/step-up-threshold' && request.method === 'GET')  return handleStepUpThresholdGet(request, env, corsHeaders);
    if (pathname === '/account/step-up-threshold' && request.method === 'POST') return handleStepUpThresholdSet(request, env, corsHeaders);
    if (pathname === '/auth/webauthn/register-key' && request.method === 'POST') return handleWebAuthnRegisterKey(request, env, corsHeaders);
    if (pathname === '/account/step-up-challenge'  && request.method === 'POST') return handleStepUpChallenge(request, env, corsHeaders);
    if (pathname === '/account/step-up-verify'     && request.method === 'POST') return handleStepUpVerify(request, env, corsHeaders);
    // 2026-07-07: /biz/review(Supabase biz_reviews, 5점 척도) → 완전 대체.
    // 실거래(tx_hash) 기반 trade_ratings(PocketBase, polarity+온도)로 이전.
    // handleBizReview는 하단에 DEPRECATED로 남겨두되 라우팅에서 제거함.
    if (pathname === '/biz/trade-rating' && request.method === 'POST') return handleTradeRatingSubmit(request, env, corsHeaders);
    if (pathname === '/biz/temperature'  && request.method === 'GET')  return handleTemperatureQuery(request, env, corsHeaders);
    if (pathname === '/biz/reservation'        && request.method === 'POST')  return handleReservationCreate(request, env, corsHeaders);
    if (pathname === '/biz/reservation/status' && request.method === 'PATCH') return handleReservationStatus(request, env, corsHeaders);
    if (pathname === '/biz/claims'     && request.method === 'GET')  return handleClaimsList(request, env, corsHeaders);
    if (pathname === '/biz/claims/ack' && request.method === 'POST') return handleClaimsAck(request, env, corsHeaders);
    if (pathname === '/biz/settle-ledger' && request.method === 'POST') return handleSettleLedger(request, env, corsHeaders);
    if (pathname === '/biz/financials' && request.method === 'GET') return handleFinancialsGet(request, env, corsHeaders);
    if (pathname === '/biz/tx-history' && request.method === 'GET') return handleTxHistory(request, env, corsHeaders);
    // ★ 2026-07-09 신설 — 짜장면 주문 사고실험 1단계: 프로필-to-프로필
    // AI 메시징(예: 손님의 AI가 식당의 AI에게 주문을 전달). /ai/chat(기존,
    // 슬래시)와 이름이 헷갈리지 않도록 /biz/ 네임스페이스로 통일 —
    // /ai/chat은 범용 LLM 프로바이더 프록시고 이건 완전히 다른 기능이다.
    if (pathname === '/biz/ai-chat' && request.method === 'POST')
      return handleAiChat(request, env, corsHeaders, { _err, _verifyEd25519, _l1FindProfileByGuid, _l1ListSellerProducts, L1_DEFAULT, _l1AdminToken });
    if (pathname === '/biz/escalate' && request.method === 'POST')
      return handleEscalate(request, env, corsHeaders, { _err, _verifyEd25519, _l1FindProfileByGuid, L1_DEFAULT, _l1AdminToken });
    // ★ 2026-07-09 신설 — 짜장면 주문 사고실험 5·6단계: 주문 큐/주방
    // 용량 판단 + 조리시간 추정. buildSystemPrompt가 명시적으로 "이 SP
    // 몫이 아니다"라고 선언해뒀던 부분 — LLM 없이 순수 서버 로직으로 처리.
    if (pathname === '/biz/order-queue' && request.method === 'POST')
      return handleOrderQueue(request, env, corsHeaders, { _err, _verifyEd25519, _l1FindProfileByGuid, _l1CountActiveOrders, _l1CreateOrderQueueEntry });
    // ★ 2026-07-09 신설 — 짜장면 주문 사고실험 7·8단계: 배송업체 검색+
    // 요청. LLM 없이 search_entities RPC + 순수 산술(ETA)로 처리.
    if (pathname === '/biz/delivery-request' && request.method === 'POST')
      return handleDeliveryRequest(request, env, corsHeaders, { _err, _verifyEd25519, _l1FindProfileByGuid, _searchEntitiesRaw, _l1CreateDeliveryRequest });

    // ── 부서/기관/사업자 간 업무지시 큐 (2026-07-12 신설, B그룹 대응) ──
    if (pathname === '/gov/dept-task' && request.method === 'POST')
      return handleDeptTaskCreate(request, env, corsHeaders, { _err, _verifyEd25519, _l1FindProfileByGuid, _l1CreateDeptTask });
    if (pathname.startsWith('/gov/dept-task/') && request.method === 'PATCH') {
      const taskId = pathname.replace('/gov/dept-task/', '');
      return handleDeptTaskUpdate(request, env, corsHeaders, taskId, { _err, _l1UpdateDeptTask });
    }

    // ── ai-setup (AI 비서 설정) ─────────────────────────────
    // v5.1: 토큰 기반 폐기 — Ed25519 서명(/biz/product와 동일 패턴)으로 전환
    //   GET  : ?guid=... 만으로 조회 (저장값은 암호화되어 있어 평문 키 노출 없음)
    //   POST : body={guid,pubkey,signature,...} — _verifyEd25519 + TOFU
    // ── Wallet X25519 (PC→휴대폰 AI 설정 봉투암호화) ──────
    if (pathname === '/wallet/x25519') {
      if (request.method === 'GET')  return handleWalletX25519Get(request, env, corsHeaders);
      if (request.method === 'POST') return handleWalletX25519Post(request, env, corsHeaders);
    }
    if (pathname === '/account/delete-profile' && request.method === 'POST') {
      return handleAccountDeleteProfile(request, env, corsHeaders);
    }
    // 계정 완전 삭제 시 Supabase user_profiles row도 함께 정리 (L1과 별도 저장소이므로 누락되면
    // pubkey_ed25519/x25519 TOFU 키가 남아 재가입 시 PUBKEY_MISMATCH 발생)
    if (pathname === '/account/full-reset' && request.method === 'POST') {
      return handleAccountFullReset(request, env, corsHeaders);
    }
    if (pathname === '/ai-setup/seal') {
      if (request.method === 'GET')  return handleAiSetupSealGet(request, env, corsHeaders);
      if (request.method === 'POST') return handleAiSetupSealPost(request, env, corsHeaders);
    }

    if (pathname === '/ai-setup') {
      if (request.method === 'GET') {
        const guid = url.searchParams.get('guid');
        if (!guid) return _err(400, 'MISSING_FIELD', 'guid 파라미터 필수', corsHeaders);
        return handleAiSetupGet(request, env, corsHeaders, guid);
      }
      if (request.method === 'POST') return handleAiSetupPost(request, env, corsHeaders);
    }

    // ── TURN credential (coturn, RFC 8489) — _TURN_COTURN_PATCH_APPLIED_ ──────
    // GET /turn/credential?guid=...
    // TURN 서버: l1-hanlim.hondi.net:3478 (UDP/TCP), :5349 (TLS)
    // Credential: HMAC-SHA1 time-limited (coturn static-auth-secret 방식)
    if (pathname === '/turn/credential' && request.method === 'GET')
      return handleTurnCredential(request, env, corsHeaders);

    // ── WebRTC 시그널링 (P2P 채팅 — OpenHash 철학) ──────────
    // 메시지는 서버에 저장하지 않음 — 시그널(SDP/ICE)만 임시 경유
    if (pathname === '/signal/send')   return handleSignalSend(request, env, corsHeaders);
    if (pathname === '/signal/poll')   return handleSignalPoll(request, env, corsHeaders);
    if (pathname === '/signal/delete') return handleSignalDelete(request, env, corsHeaders);

    // ── 사용자 P2P 등록/검색 (GDUDA Phase 1) ───────────────────
    if (pathname === '/p2p/register' && request.method === 'POST')
      return handleP2PRegister(request, env, corsHeaders);
    if (pathname === '/p2p/search'   && request.method === 'GET')
      return handleP2PSearch(request, env, corsHeaders);

    // ── 사용자 검색 (GDUDA Phase 1) ──────────────────────────
    if (pathname === '/search/users')  return handleSearchUsers(request, env, corsHeaders);

    // ── profile (사용자/사업자 프로필 등록·조회 — v5.1) ──────
    //   GET  : 인증 불필요 — handle 또는 guid로 공개 조회
    //   POST : body={guid,pubkey,signature,...} — _verifyEd25519 + TOFU
    // 2026-07-01: /profile/delegate(위임 인증서) 폐기 — 별도 그림자
    // 정체성이 없어졌으므로 "위임" 자체가 무의미해짐(_mergeAgentSP 참조).

    // GET /profile/verify-owner — 핸드셰이크 실시간 본인 검증
    // (Ed25519 서명+TOFU. gopang-wallet.js의 sign()/verify()와 동일한
    // 서명 체계 — 전체 시스템이 서명 체계를 하나만 공유한다는 원칙.
    // 2026-07-01: SP를 돌려주던 /profile/my-sp를 대체 — 이제 system_prompt는
    // 단 하나뿐이라 "내려줄 internal SP"가 없고, "본인이 맞는지"만 매
    // 핸드셰이크마다 실시간으로 묻는다. AGENT-COMMON §4 참조)
    if (pathname === '/profile/verify-owner' && request.method === 'GET')
      return handleProfileVerifyOwner(request, env, corsHeaders);

    // 2026-07-12 — SP-18_ksearch STEP3 선행조건 (c): claim(정식 전환) 절차.
    // /profile POST보다 먼저 체크해야 한다 — startsWith('/profile')이
    // '/profile/claim'도 매칭해버리므로, 더 구체적인 경로를 먼저 분기.
    if (pathname === '/profile/claim' && request.method === 'POST')
      return handleProfileClaim(request, env, corsHeaders);

    if (pathname.startsWith('/profile')) {
      if (request.method === 'GET')  return handleProfileGet(request, env, corsHeaders);
      if (request.method === 'POST') return handleProfilePost(request, env, corsHeaders);
    }

    // ── K-Market 판매자 카탈로그(로컬 IndexedDB 원본 + L1 백업/공개미러) ──
    if (pathname === '/biz/catalog/sync' && request.method === 'POST')
      return handleCatalogSync(request, env, corsHeaders);
    if (pathname === '/biz/catalog/hydrate' && request.method === 'POST')
      return handleCatalogHydrate(request, env, corsHeaders);
    if (pathname === '/biz/catalog' && request.method === 'GET')
      return handleCatalogGet(request, env, corsHeaders);

    // ── Feedback ─────────────────────────────────────────────
    if (pathname === '/feedback' && request.method === 'POST')
      return handleFeedbackPost(request, env, corsHeaders);
    if (pathname === '/feedback' && request.method === 'GET')
      return handleFeedbackGet(request, env, corsHeaders);
    if (pathname.startsWith('/feedback/') && request.method === 'PATCH')
      return handleFeedbackPatch(request, env, corsHeaders);

    // ── Push 알림 ───────────────────────────────────────────
    if (pathname === '/push/subscribe' && request.method === 'POST')
      return handlePushSubscribe(request, env, corsHeaders);
    if (pathname === '/push/send' && request.method === 'POST')
      return handlePushSend(request, env, corsHeaders);
    if (pathname === '/push/vapid-public-key' && request.method === 'GET')
      return handlePushVapidKey(request, env, corsHeaders);
    if (pathname === '/push/broadcast' && request.method === 'POST')
      return handlePushBroadcast(request, env, corsHeaders);

    // ── Prompt Editor (관리자 — L1 prompt_admins 인증 + GitHub PR) ──
    if (pathname === '/admin/login' && request.method === 'POST')
      return handleAdminLogin(request, env, corsHeaders);

    // GET /admin/stats — 대시보드 통계 (HMAC 인증, L1 PocketBase 프록시)
    if (pathname === '/admin/stats' && request.method === 'GET')
      return handleAdminStats(request, env, corsHeaders);

    // (2026-07-15 신설) GET /admin/tx-recent — gdc.hondi.net 관리자
    // 대시보드용 전체 최근 거래(admin/stats와 동일 토큰 인증 관례)
    if (pathname === '/admin/tx-recent' && request.method === 'GET')
      return handleAdminTxRecent(request, env, corsHeaders);

    // GET /admin/gov-task-drafts — 대기중 GOV_TASK draft 목록 (2026-07-12 위치 정정
    // — 기존엔 POST 전용 게이트 뒤에 있어서 GET 요청이 그 게이트에서 먼저
    // 405로 막히는 죽은 코드였다. admin/stats와 동일하게 게이트 앞으로 이동)
    if (pathname === '/admin/gov-task-drafts' && request.method === 'GET')
      return handleGovTaskDraftList(request, env, corsHeaders);

    // GET /stats/org, /stats/agency-report — 준공개 통계 엔드포인트
    // (2026-07-14 신설, 회귀로 삭제됐다가 복구됨)
    if (pathname === '/stats/org' && request.method === 'GET')
      return handleStatsOrgCompare(request, env, corsHeaders);
    if (pathname === '/stats/agency-report' && request.method === 'GET')
      return handleStatsAgencyReport(request, env, corsHeaders);

    // POST /admin/cf-dns — Cloudflare DNS CNAME 추가 (CORS 우회 프록시)
    if (pathname === '/admin/cf-dns' && request.method === 'POST')
      return handleAdminCfDns(request, env, corsHeaders);

    // POST /admin/users/bulk-delete — 관리자 일괄 삭제 (L1 + Supabase 9개 테이블 + KV)
    if (pathname === '/admin/users/bulk-delete' && request.method === 'POST')
      return handleAdminBulkDelete(request, env, corsHeaders);

    // ── 디폴트 LLM 키 관리 ──────────────────────────────────────
    // POST /admin/default-key  — 관리자가 KV에 저장 (HMAC 인증)
    // GET  /default-key        — 앱이 체험기간 확인 후 키 수신
    if (pathname === '/admin/default-key' && request.method === 'POST')
      return handleAdminDefaultKeySet(request, env, corsHeaders);
    if (pathname === '/default-key' && request.method === 'GET')
      return handleDefaultKeyGet(request, env, corsHeaders);
    // (2026-07-14: /free-quota-status 재도입 — "가입자당 100원 무료 한도"
    //  정책으로 복귀. 한도값은 FREE_QUOTA_KRW_LIMIT=100 참조.)
    if (pathname === '/free-quota-status' && request.method === 'GET')
      return handleFreeQuotaStatus(request, env, corsHeaders);
    // (2026-07-14 신설) usage.html의 모델별·기간별 상세 내역용.
    if (pathname === '/usage-log' && request.method === 'GET')
      return handleUsageLog(request, env, corsHeaders);
    if (pathname === '/prompt' && request.method === 'GET')
      return handlePromptGet(request, env, corsHeaders);
    if (pathname === '/admin/prompt' && request.method === 'POST')
      return handleAdminPromptSave(request, env, corsHeaders);

    // ── POST 전용 ────────────────────────────────────────
    if (request.method !== 'POST') {
      return new Response(JSON.stringify({ error: 'Method Not Allowed' }), { status: 405, headers: corsHeaders });
    }

    const bodyText = await request.text();

    // ── AI 프록시 라우트 추가 보호 — 비용이 직접 발생하는 경로이므로
    // 한 번 더 엄격하게 검사한다. 위쪽 전역 검사(line ~275)는
    // corsOrigin === null(허용되지 않은 명시적 Origin)일 때만 403을
    // 반환하고, corsOrigin === ''(Origin 헤더 자체가 없는 요청 —
    // curl/스크립트/봇의 기본 동작이며 브라우저는 절대 이렇게 보내지
    // 않음)는 통과시켜버린다. 그 결과 인증 절차가 전혀 없는 이 4개
    // 라우트는 Origin 헤더만 안 보내면 누구나 직접 두드려 env의
    // DEEPSEEK_API_KEY 등 서버 보유 키로 무제한 호출이 가능했다.
    // (2026-06-28 — 기기를 모두 끈 상태에서도 DeepSeek 크레딧이
    // 소진된 사고의 원인 분석 후 추가)
    const AI_PROXY_PATHS = ['/chat/completions', '/deepseek', '/ai/chat', '/gemini/', '/llm/relay', '/klaw/relay', '/gov/relay'];
    const isAiProxyPath = AI_PROXY_PATHS.some(p => pathname === p || pathname.startsWith(p));
    const _meta = {
      ip:     request.headers.get('cf-connecting-ip') || 'unknown',
      origin: request.headers.get('Origin') || '(no-origin)',
      ua:     request.headers.get('User-Agent') || 'unknown',
      path:   pathname,
    };
    if (isAiProxyPath && !corsOrigin) {
      console.warn(JSON.stringify({ tag: 'AI_PROXY_BLOCKED_NO_ORIGIN', ts: new Date().toISOString(), ..._meta }));
      return _err(403, 'FORBIDDEN_NO_ORIGIN', 'AI 프록시 호출에는 브라우저 Origin이 필요합니다.', corsHeaders);
    }

    if (pathname === '/chat/completions')        return callDeepSeek(bodyText, env, corsHeaders, null, _meta, ctx);
    if (pathname.startsWith('/deepseek'))        return callDeepSeek(bodyText, env, corsHeaders, null, _meta, ctx);
    if (pathname === '/llm/relay')               return handleLLMRelay(bodyText, env, corsHeaders, _meta);
    if (pathname === '/klaw/relay')               return handleKlawRelay(bodyText, env, corsHeaders, _meta, ctx);
    if (pathname === '/gov/relay')                return handleGovRelay(bodyText, env, corsHeaders, _meta, ctx);
    if (pathname === '/gov/task/submit')          return handleGovTaskSubmit(bodyText, env, corsHeaders);
    if (pathname === '/gov/task/batch-status')    return handleGovTaskBatchStatus(bodyText, env, corsHeaders);
    if (pathname === '/stats/dept')               return handleStatsDeptCompare(bodyText, env, corsHeaders);
    if (pathname === '/stats/self')                return handleStatsSelf(bodyText, env, corsHeaders);
    if (pathname === '/gov/dept-task/my-assignments') return handleMyAssignments(bodyText, env, corsHeaders);
    if (pathname === '/gov/task/schema/draft')    return handleGovTaskSchemaDraft(bodyText, env, corsHeaders);
    if (pathname === '/admin/gov-task-drafts/review') return handleGovTaskDraftReview(request, bodyText, env, corsHeaders);
    if (pathname === '/business/relay')           return handleBusinessRelay(bodyText, env, corsHeaders, _meta, ctx);
    if (pathname.startsWith('/gemini/'))         return callOpenAIFromGeminiBody(bodyText, env, corsHeaders, _meta);
    if (pathname === '/ai/chat')                 return handleAIChat(bodyText, env, corsHeaders, _meta);

    return new Response(JSON.stringify({ error: 'Not Found', path: pathname }), { status: 404, headers: corsHeaders });
  },
};

// ═══════════════════════════════════════════════════════════
// v4.9 STEP 08 — /biz/order (L1 위임, Worker 검증 제거)
// ═══════════════════════════════════════════════════════════
// 2026-07-07 신설: 플랫폼 수수료율 — 지금까지 서버 어디에도 정해진 값이
// 없어(worker.js/ledger.js/payment.js 세 초안이 각각 다른 값을 가정)
// 클라이언트가 보낸 seller_net/fee 분할을 그대로 신뢰하고 있었다. 이제
// 이 값이 유일한 정본이다 — profile.html의 _PLATFORM_FEE_RATE도 반드시
// 이 값과 같아야 한다(다르면 매 결제가 PRICE_MISMATCH로 거부됨).
const PLATFORM_FEE_RATE = 0.03; // 3% — 변경 시 이 한 줄만 고치면 된다(아래 참고).

// 2026-07-18 신설: profile.html의 _PLATFORM_FEE_RATE가 이 값의 "복사본"이라
// 수동으로 값을 맞춰야 했고(다르면 결제가 전부 PRICE_MISMATCH로 거부),
// market 쪽 판매자 화면엔 수수료율이 아예 노출되지 않았다. 이제 이
// 엔드포인트가 유일한 조회 경로다 — PLATFORM_FEE_RATE를 바꾸면 재배포만
// 하면 클라이언트 전부(profile.html 결제 화면, market 판매자 화면)가
// 다음 로드 시 자동으로 새 값을 받는다. 클라이언트 쪽 하드코딩 상수는
// 전부 이 엔드포인트를 부르는 방식으로 교체했다(fetch 실패 시에만
// 안전한 기본값 0.03으로 폴백).
async function handleFeeRate(request, env, corsHeaders) {
  return new Response(JSON.stringify({ ok: true, rate: PLATFORM_FEE_RATE }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function handleBizOrder(request, env, corsHeaders, ctx) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const {
    tx, tx_hash, buyer_sig, buyer_public_key,
    from_guid, seller_guid, l1_node, memo,
    prev_settle_hash, balance_claimed, outputs,
    session_id, reporter_svc,
    item_name, item_id, quantity,
    seller_net, fee,
    purpose, // 2026-07-18 신설 — GDC 상거래 완성 계획서 Phase 4(재무제표
             // 원장 source 분류용). handleGdcTransfer가 'transfer'|'purchase'로
             // 채워 보낸다 — 직접 /biz/order를 호출하는 K-Market 구매는
             // undefined(→ L1에서 source='market'으로 분류됨).
    // Phase 3/4 추가: 중요도 점수 + LCAT 입력
    asset_type    = 'stable',  // 'stable'|'physical'|'point'
    contract_type = 'instant', // 'instant'|'conditional'|'escrow'
    buyer_region  = null,      // 지역 코드 (예: 'jeju', 'seoul')
    seller_region = null,
  } = body;

  // 필수 필드 확인
  if (!tx_hash)          return _err(400, 'MISSING_FIELD', 'tx_hash 필수', corsHeaders);
  if (!buyer_sig)        return _err(400, 'MISSING_FIELD', 'buyer_sig 필수', corsHeaders);
  if (!buyer_public_key) return _err(400, 'MISSING_FIELD', 'buyer_public_key 필수', corsHeaders);
  if (!from_guid)        return _err(400, 'MISSING_FIELD', 'from_guid 필수', corsHeaders);
  if (!seller_guid)      return _err(400, 'MISSING_FIELD', 'seller_guid 필수', corsHeaders);

  // ── 2026-07-07 신설: 카탈로그 가격 검증(사고실험 G 대응) ──────────────
  // 지금까지는 tx.items에 담긴 price/quantity, 그리고 seller_net/fee를
  // 전부 클라이언트가 보낸 그대로 신뢰했다 — 즉 잔액만 충분하면 임의의
  // 금액으로 "구매"를 만들 수 있었다. 이제 tx.items가 있으면(=Market
  // 카탈로그 구매) 판매자의 실제 seller_products를 서버가 직접 재조회해
  // 가격을 재계산하고, 클라이언트가 주장한 금액과 대조한다.
  // items가 비어 있으면(= P2P 송금 등 카탈로그와 무관한 거래) 이 검증은
  // 건너뛴다 — 애초에 대조할 카탈로그가 없는 케이스이기 때문이다.
  const txItems = Array.isArray(tx?.items) ? tx.items : [];
  // 2026-07-13 신설 — 재고 자동 차감(②단계)을 위해 catalog를 바깥
  // 스코프로 끌어올린다(주문 성공 후 차감 시점에서도 재사용).
  let orderCatalog = null;
  if (txItems.length) {
    let catalog;
    try {
      catalog = await _l1ListSellerProducts(env, seller_guid);
      orderCatalog = catalog;
    } catch (e) {
      return _err(502, 'L1_UNREACHABLE', '카탈로그 조회 실패: ' + e.message, corsHeaders);
    }
    const byId = new Map(catalog.map(r => [r.id, r]));

    let authoritativeTotal = 0;
    for (const item of txItems) {
      const rec = byId.get(item.id);
      if (!rec) {
        return _err(404, 'ITEM_NOT_FOUND', `카탈로그에 없는 상품입니다: ${item.id}`, corsHeaders);
      }
      if (rec.is_public === false) {
        return _err(403, 'ITEM_NOT_PUBLIC', `비공개 상품은 구매할 수 없습니다: ${item.id}`, corsHeaders);
      }
      if (typeof rec.price !== 'number') {
        return _err(400, 'ITEM_PRICE_UNSET', `가격 미정 상품은 이 경로로 구매할 수 없습니다: ${item.id}`, corsHeaders);
      }
      const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
      // 2026-07-13 신설 — 재고 부족 검증. stock_qty가 숫자로 추적되고
      // 있는 상품만 검사한다(null=무제한/미추적 상품은 그대로 통과).
      if (typeof rec.stock_qty === 'number' && qty > rec.stock_qty) {
        return _err(409, 'INSUFFICIENT_STOCK',
          `재고 부족: ${rec.name || item.id} (요청 ${qty}개, 재고 ${rec.stock_qty}개)`,
          corsHeaders);
      }
      authoritativeTotal += rec.price * qty;
    }

    const claimedTotal = (seller_net || 0) + (fee || 0);
    // 정수 원 단위 반올림 오차 허용(1원) — 그 이상 차이는 위조/버그로 간주
    if (Math.abs(claimedTotal - authoritativeTotal) > 1) {
      return _err(409, 'PRICE_MISMATCH',
        `가격 불일치: 서버 계산 ₮${authoritativeTotal} vs 요청 ₮${claimedTotal}`,
        corsHeaders);
    }
    // 총액만 맞추고 seller_net/fee 분할을 임의로 조작하는 걸 막는다(예:
    // fee=0, seller_net=total로 보내 플랫폼 수수료를 가로채거나, 반대로
    // seller_net을 깎고 fee를 부풀리는 경우) — 분할도 서버가 강제한다.
    const authoritativeFee = Math.round(authoritativeTotal * PLATFORM_FEE_RATE);
    const authoritativeSellerNet = authoritativeTotal - authoritativeFee;
    if (Math.abs((fee || 0) - authoritativeFee) > 1 ||
        Math.abs((seller_net || 0) - authoritativeSellerNet) > 1) {
      return _err(409, 'FEE_SPLIT_MISMATCH',
        `수수료 분할 불일치: 서버 계산 seller_net=₮${authoritativeSellerNet}/fee=₮${authoritativeFee} vs 요청 seller_net=₮${seller_net || 0}/fee=₮${fee || 0}`,
        corsHeaders);
    }
  }

  // ── STEP 08: L1 위임 — Worker는 검증 로직 없음 ───────────
  const buyerNodeId = l1_node || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[buyerNodeId] || L1_DEFAULT;
  const l1Url  = l1Base + '/api/tx';

  // ── 2026-07-07 신설(제주 L1~L3 필드 테스트, §4/§5): 판매자 소속 L1 조회 ──
  // 판매자가 구매자와 다른 L1 소속이면, 그 사실을 L1의 /api/tx에 미리
  // 알려줘야 L1이 판매자 몫 output을 sentinel(bridge-out)로 리디렉션할 수
  // 있다. L1은 다른 L1을 직접 조회하지 않으므로(P1), 이 조회는 반드시
  // Worker(허브)가 대신 해서 넘겨준다.
  const sellerHomeNode = await _resolveHomeL1Node(env, seller_guid);
  const isCrossL1 = sellerHomeNode && sellerHomeNode !== buyerNodeId;
  if (isCrossL1) {
    console.log(`[BizOrder] 크로스-L1 거래 감지: ${buyerNodeId} → ${sellerHomeNode}`);
  }

  // ── Phase 3/4: 중요도 점수 + LCAT 계산 ──────────────────────────────────
  // importanceVerifier.js와 동일 공식(단일 정의 원칙) — refactor_plan_v2 §Phase1 참조
  const _txAmount = (tx?.input?.balance_claimed ?? balance_claimed ?? 0);
  const _actualAmount = (seller_net || 0) + (fee || 0) || _txAmount;
  const importance_score = _computeImportanceScore(_actualAmount, asset_type, contract_type);
  const importance_mode  = _selectImportanceMode(importance_score);
  const lcat             = computeLCAT(buyer_region, seller_region);
  // LCAT과 requires_geo는 완전히 독립 — PLSM 계층 라우팅 전용 입력
  console.log(`[BizOrder] score=${importance_score.toFixed(2)} mode=${importance_mode} lcat=${lcat}`);

  // L1에는 순수 UTXO만 전달 (items/memo 등 제거)
  const txPayload = {
    version: tx?.version || 1,
    input: tx?.input || {
      owner_guid:        from_guid,
      prev_settle_hash:  prev_settle_hash || null,
      balance_claimed:   balance_claimed  || 0,
    },
    outputs: tx?.outputs || outputs || [
      { recipient_guid: seller_guid,        amount: seller_net || 0 },
      { recipient_guid: 'gopang-platform',  amount: fee        || 0 },
    ],
    // PLSM 입력값 — L1이 아직 미수신해도 unknown field 무시, 거래 흐름 미차단
    score: importance_score,
    lcat,
  };
  // §5 브릿지 트리거 — cross-L1일 때만 넘긴다(같은 L1이면 undefined로 두어
  // L1의 기존 로컬 처리 경로를 그대로 탄다).
  const bridgeBody = isCrossL1 ? { seller_home_node: sellerHomeNode } : {};

  let l1Result;
  try {
    // 2026-07-07 제거: 여기 있던 Supabase user_profiles.extra.fs 기반
    // BIVM 사전검증(_fetchUserBalance/_bivmVerify)을 걷어냈다. L1의
    // /api/tx가 이제 balance_claimed를 신뢰하지 않고 자기 blocks 원장을
    // 재생(computeBalance)해서 직접 잔액을 검증하므로, Worker가 별도로
    // (그것도 이제 갱신되지 않는 Supabase 값으로) 사전 검증하는 건
    // 중복일 뿐 아니라 유해하다 — Supabase 쪽 값이 실제 L1 잔액과
    // 어긋나면 정상 거래가 여기서 먼저 잘못 막힐 수 있었다.

    const l1Res = await fetch(l1Url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: (() => { const p = { tx: txPayload, tx_hash, buyer_sig, buyer_public_key, purpose, ...bridgeBody }; console.log('[L1] tx:', JSON.stringify(p.tx)); return JSON.stringify(p); })(),
    });
    l1Result = await l1Res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 노드 연결 실패: ' + e.message, corsHeaders);
  }

  if (!l1Result.ok) {
    console.log('[BizOrder] L1 실패:', JSON.stringify(l1Result));
    const statusMap = {
      INVALID_SIGNATURE:    401,
      UNREGISTERED_KEY:     403,
      STALE_STATE:          409,
      INSUFFICIENT_BALANCE: 402,
      BLOCK_SAVE_FAILED:    500,
    };
    return _err(statusMap[l1Result.error] || 400, l1Result.error, l1Result.detail || l1Result.error, corsHeaders);
  }

  const { block_id, block_hash, height } = l1Result;
  // 2026-07-07 수정: buyer_claim/seller_claim을 Worker가 다시 만들지
  // 않는다 — 이전엔 (신뢰하면 안 되는) balance_claimed로 balance_after를
  // 자체 계산했었다. 이제 L1이 자기 원장 재생 결과(computeBalance)로
  // 계산한 진짜 claim을 돌려주므로 그걸 그대로 쓴다.
  const buyer_claim  = l1Result.buyer_claim  || null;
  const seller_claim = l1Result.seller_claim || null;

  // ── §5 브릿지 릴레이 트리거 — L1이 bridge_out을 outbox에 남겼으면
  // (l1Result.bridge.status === 'pending'), Worker가 허브로서 대상 L1의
  // /api/bridge-in을 호출하고 성공하면 소스 L1에 완료 통지한다. 실패해도
  // 여기서 거래 자체를 막지 않는다 — scheduled() 크론 스윕이 재시도한다.
  if (l1Result.bridge && l1Result.bridge.status === 'pending') {
    const bridgePromise = _relayBridge(env, {
      sourceBase:   l1Base,
      targetNodeId: l1Result.bridge.target_node,
      tx_hash,
      guid:         seller_guid,
      amount:       seller_net || 0,
    }).catch(e => console.warn('[BizOrder] 브릿지 릴레이 예외:', e.message));
    if (ctx?.waitUntil) ctx.waitUntil(bridgePromise);
  }

  // ── Module 5.5: verifyOutputConsistency + verifyDeltaZero ──────────
  // 2026-07-07 수정: 이전엔 결과를 로그만 찍고 버렸다("감시 모드") —
  // 사용자가 요청한 "매 거래마다 판매자·구매자 재무제표 변동 일치
  // 검증"을 실제로 기록에 남기려면 결과를 어딘가에 보존해야 한다.
  // 이제 PDV(_recordOrderPdv)와 API 응답 양쪽에 결과를 남긴다 — 검증
  // 자체는 여전히 거래를 막지 않는다(블록은 L1에 이미 저장된 뒤라
  // 여기서 "막는다"는 게 의미가 없다 — 대신 불일치 시 크게 로그를
  // 남기고 응답에도 명시해서, 이상 거래로 추적·감사할 수 있게 한다).
  const _outputs = txPayload.outputs;
  const outputConsistent = verifyOutputConsistency(l1Result, _outputs);
  const deltaZeroResult  = verifyDeltaZero(_outputs, txPayload.input?.balance_claimed || balance_claimed || 0);
  const consistencyCheck = {
    output_consistent: outputConsistent,
    delta_zero_valid:  deltaZeroResult.valid,
    sigma_delta:       deltaZeroResult.sigmaDelta ?? null,
    reason:            deltaZeroResult.reason || (outputConsistent ? null : 'output_mismatch'),
  };
  if (!outputConsistent || !deltaZeroResult.valid) {
    console.error('[BizOrder] 재무제표 변동 일치 검증 실패:', JSON.stringify(consistencyCheck));
  }

  // ── Phase 4: 차등 검증 레이어 (refactor_plan_v2 §Phase1 차등 레이어) ─────
  // baseline(카탈로그+수수료 검증)은 항상 실행됨 — ILMV-100% 대응
  // 표준 모드: 가격 재조회 로그(TOCTOU 창 축소) — 현재 pilot 단계라 로그만
  // 강화 모드: PDV에 risk_tier:'high' 플래그 기록 (L1/L4 강화 모드 트리거 힌트)
  if (importance_mode === 'ENHANCED') {
    console.warn(`[BizOrder][ENHANCED] score=${importance_score.toFixed(2)} — risk_tier:high 기록 예정`);
    // risk_tier 플래그는 아래 PDV 기록 시 extra에 포함됨
  } else if (importance_mode === 'STANDARD') {
    console.log(`[BizOrder][STANDARD] score=${importance_score.toFixed(2)} — 표준 검증`);
  }

  // ── Module 5.5: l1_ledger H_N 기록 (updateNodeHashChain) ──
  // await는 fs_ledger RPC와 병렬 실행 — 거래 응답 차단 안 함
  // 2026-07-07 수정: 이전엔 이 promise가 만들어진 뒤 어디서도 참조되지
  // 않아 .catch()조차 없었다(unhandled rejection 위험) + ctx.waitUntil로
  // 등록도 안 돼 있어 응답 반환 후 Cloudflare Workers가 격리 실행 환경을
  // 종료하면 완료 전에 중단될 수 있었다. 다른 곳(2195/2211행 등)에 이미
  // 확립된 패턴을 그대로 적용한다.
  const userHashPromise = _computeUserHash(tx_hash, block_hash, height);
  const nodeChainPromise = userHashPromise.then(userHash =>
    updateNodeHashChain(env, {
      userHash,
      txId:            tx_hash,
      blockHash:       block_hash,
      buyerGuid:       from_guid,
      sellerGuid:      seller_guid,
      balanceClaimed:  txPayload.input?.balance_claimed || balance_claimed || 0,
    })
  ).catch(e => console.warn('[BizOrder] nodeChainPromise 실패:', e.message));
  if (ctx?.waitUntil) ctx.waitUntil(nodeChainPromise);

  // 2026-07-07 제거: 여기 있던 Supabase market_purchase RPC 호출과
  // _patchFs(buyer/seller extra.fs 메타데이터 병합)를 걷어냈다. 잔액의
  // 유일한 진실은 이제 L1의 blocks 원장이고(computeBalance), L1이
  // 응답으로 돌려주는 block_id/block_hash/buyer_claim/seller_claim만
  // 있으면 충분하다 — 별도로 Supabase에 사본을 만들 필요가 없어졌다.
  // (item_name/quantity 등 상품 메타데이터는 여전히 PDV 기록에 쓰인다 —
  // 아래 _recordOrderPdv 참조.)
  const totalOutput = txPayload.outputs.reduce((s, o) => s + (o.amount || 0), 0);

  // ── STEP 11: reporter_svc 없을 때만 Worker가 PDV 기록 ────
  // reporter_svc가 있으면 하위 시스템이 이미 기록했으므로 중복 방지
  if (!reporter_svc) {
    await _recordOrderPdv(env, {
      from_guid, seller_guid, tx_hash, block_hash, block_id,
      session_id, item_name: item_name || memo || '상품',
      total: totalOutput, l1_result: l1Result,
      importance_score, importance_mode, lcat,
      risk_tier: importance_mode === 'ENHANCED' ? 'high'
               : importance_mode === 'STANDARD' ? 'standard'
               : 'low',
      consistency_check: consistencyCheck,
    });
  }
  console.log('[BizOrder] 성공:', JSON.stringify({ ok: true, block_hash, height, buyer_claim: !!buyer_claim }));

  // 2026-07-13 신설 — 판매자 claim 전달 큐 적재. seller_claim은 지금까지
  // 구매자의 opener 창에만 postMessage로 전달되고, redeemClaim()의
  // claimant 필터에 걸려 조용히 버려지고 있었다(실사로 발견 — 판매자
  // 재무제표가 실제 거래에도 갱신된 적이 없었을 가능성이 높음). 여기서
  // pending_claims에 저장해두면, 판매자가 다음에 앱을 열 때
  // GET /biz/claims로 조회해 직접 redeemClaim()할 수 있다. 이 저장이
  // 실패해도 결제 자체는 이미 끝났으므로 주문을 되돌리지 않는다.
  if (seller_claim) {
    try {
      // 2026-07-13 신설 — GDC-재무제표-재고 연동 4단계(매출원가 인식).
      // 판매된 항목 중 cost_price(매입원가)가 알려진 것만 골라 매출원가
      // (pl-cogs)를 계산한다 — 모르면(cost_price=null) 그 항목은 그냥
      // 제외한다(억지로 추정하지 않음). 재고자산(bs-inventory) 계정으로
      // 매입 단계부터 자산 계상하는 정식 발생주의 회계는 매입 쪽에
      // "재고용 매입 의도" 추적이 별도로 필요해 범위가 훨씬 커진다 —
      // 이번 단계는 "판매 시점에 원가를 얼마나 아는가"만으로 매출총이익
      // (매출-매출원가) 가시성을 주는 것으로 의도적으로 범위를 좁혔다.
      let totalCogs = 0;
      if (orderCatalog && txItems.length) {
        const byIdForCogs = new Map(orderCatalog.map(r => [r.id, r]));
        for (const item of txItems) {
          const rec = byIdForCogs.get(item.id);
          if (!rec || typeof rec.cost_price !== 'number') continue;
          const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
          totalCogs += rec.cost_price * qty;
        }
      }
      const claimsToStore = [seller_claim];
      if (totalCogs > 0) {
        claimsToStore.push({
          claimant: seller_guid,
          fs_account: 'pl-cogs',
          direction: 'debit',
          amount: totalCogs,
        });
      }

      const claimToken = await _l1AdminToken(env);
      await fetch(`${L1_DEFAULT}/api/collections/pending_claims/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${claimToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          claimant: seller_guid,
          claim_data: claimsToStore,
          block_hash, block_id, tx_hash,
          session_id: session_id || null,
          source: reporter_svc || 'kmarket_order',
          redeemed: false,
        }),
      });
    } catch (e) {
      console.warn('[Claims] pending_claims 적재 실패(무시, 결제 자체는 정상 처리됨):', e.message);
    }
  }

  // 2026-07-13 신설 — 재고 자동 차감(②단계). 결제 자체는 이미 완료됐으므로
  // 여기서 실패해도(네트워크 등) 주문을 되돌리지 않는다 — try/catch로
  // 격리하고 실패는 로그만 남긴다(다른 fire-and-forget 후처리와 동일 원칙).
  if (orderCatalog && txItems.length) {
    await _decrementStockAfterOrder(env, orderCatalog, txItems).catch(e =>
      console.warn('[Stock] 재고 차감 실패(무시, 결제 자체는 정상 처리됨):', e.message)
    );
  }

  // ── 2026-07-12 신설 — contract_type이 'escrow'/'conditional'이어도 실제
  // 자금 보류·조건부 해제 로직은 구현돼 있지 않다(사고실험으로 확인 —
  // release/hold 관련 코드가 이 파일 어디에도 없음, F_CONTRACT는 위험도
  // 점수 계산용 입력일 뿐 실제 자금 흐름을 바꾸지 않는다). 사용자가
  // "에스크로라 안전하다"고 오인하지 않도록, instant가 아닌 거래에는
  // 명시적으로 고지한다 — GOV_TASK의 "공식 접수번호 아님" disclaimer와
  // 동일한 원칙(있는 것처럼 보이는 기능을 없다고 정직하게 밝힌다).
  const contract_notice = contract_type !== 'instant'
    ? `이 거래는 '${contract_type}'로 표시됐지만, 현재 시스템은 조건부 자금 ` +
      `보류·해제(에스크로) 기능을 실제로 수행하지 않습니다 — GDC는 즉시 이체됩니다. ` +
      `분쟁 발생 시 별도 환불 절차가 없으니 거래 전 상대방과 직접 확인하십시오.`
    : null;

  return new Response(JSON.stringify({
    ok:           true,
    tx_hash,
    block_id,
    block_hash,
    height,
    openhash:     l1Result.openhash,
    buyer_claim,
    seller_claim,
    // 2026-07-07 수정: rpcResult(Supabase market_purchase RPC 응답) 제거 —
    // 이제 L1이 재생 계산한 진짜 잔액을 그대로 노출한다.
    balance_after: l1Result.balance_after ?? null,
    consistency_check: consistencyCheck,
    reporter_svc: reporter_svc || 'hondi-proxy',
    importance: {
      score: parseFloat(importance_score.toFixed(4)),
      mode:  importance_mode,
      lcat,
    },
    contract_notice,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — GDC 상거래 완성 계획서(docs/gdc_commerce_completion_plan_v0_1.md)
// Phase 1(거래목적 분류) + Phase 2(판매자 자격 확인) 정책 상수.
const GDC_PURCHASE_MEMO_REQUIRED = true;
// verified_seller 아닌 상대에게 purpose='purchase'로 이체할 수 있는 1회
// 상한선(₮). 이 이하는 소규모 개인간 거래로 보고 허용, 초과분은 상대가
// 사업자등록증(정부24) 인증을 마쳐야 한다 — 계획서 §4 제안, 피터 확정
// 전까지 조정 가능하도록 상수로 분리해뒀다.
const GDC_UNVERIFIED_SELLER_LIMIT = 50; // ₮50 = 50,000원

async function _lookupSellerVerification(env, guid) {
  try {
    const token = await _l1AdminTokenFor(env, L1_DEFAULT);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const res = await fetch(`${L1_DEFAULT}/api/collections/seller_verifications/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json().catch(() => ({ items: [] }));
    return data.items?.[0] || null;
  } catch (e) {
    console.warn('[SellerVerify] 조회 실패(미검증으로 폴백):', e.message);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — 발행잔액 집계(/ledger/issuance-summary)
// GDC 상거래 완성 계획서 Phase 5. 지난 턴 법적 검토에서 확인한 전자금융
// 거래법 선불업 등록 면제 기준(발행잔액 30억원 미만 & 연간 총발행액
// 500억원 미만)에 얼마나 가까운지 상시 확인할 수 있어야 하는데, 지금까지
// 이걸 추적하는 코드가 전혀 없었다(2026-07-18 실사 발견).
//
// ⚠️ "발행잔액"의 정확한 정의: 지금 코드베이스에는 GDC를 소각/환급하는
// 경로가 안 보인다(AI-CHARGE도 GDC를 gopang-platform 계정으로 옮길 뿐
// 파괴하지 않는다) — 즉 지금은 "총발행액 = 발행잔액"이다. 나중에 환급
// (KRW 재전환) 기능이 생기면 그 소각분을 여기서 반드시 차감해야 한다 —
// 지금 이 함수는 그 경우를 대비한 자리만 남겨둔다(REDEEMED_TOTAL=0 고정).
async function handleLedgerIssuanceSummary(request, env, corsHeaders) {
  const EXCHANGE_RATE_KRW_PER_GDC = 1000; // pb_hooks와 동일 환율(정본은 그쪽)
  const EXEMPTION_THRESHOLD_BALANCE_GDC = 3_000_000;   // 30억원 / 1,000원
  const EXEMPTION_THRESHOLD_ANNUAL_GDC  = 50_000_000;  // 500억원 / 1,000원

  try {
    const token = await _l1AdminTokenFor(env, L1_DEFAULT);
    const filter = encodeURIComponent(`source='mint'`);
    let totalIssuedGdc = 0;
    let page = 1;
    // 500건씩 페이지네이션 — 규모가 커지면 이 방식은 느려진다(다음 배치
    // 과제: 발행 총액을 별도 카운터 레코드로 캐싱). 지금은 정확성 우선.
    while (true) {
      const res = await fetch(
        `${L1_DEFAULT}/api/collections/ledger_entries/records?filter=${filter}&page=${page}&perPage=500`,
        { headers: { 'Authorization': `Bearer ${token}` } });
      const data = await res.json().catch(() => ({ items: [], totalPages: 0 }));
      for (const item of (data.items || [])) totalIssuedGdc += (item.amount || 0);
      if (page >= (data.totalPages || 1)) break;
      page++;
      if (page > 50) break; // 안전장치 — 25000건 초과 시 중단(다음 배치에서 캐싱으로 대체)
    }

    const REDEEMED_TOTAL_GDC = 0; // 위 주석 참고 — 환급 기능 생기면 여기서 차감
    const outstandingBalanceGdc = totalIssuedGdc - REDEEMED_TOTAL_GDC;

    return new Response(JSON.stringify({
      ok: true,
      total_issued_gdc: totalIssuedGdc,
      total_issued_krw: totalIssuedGdc * EXCHANGE_RATE_KRW_PER_GDC,
      outstanding_balance_gdc: outstandingBalanceGdc,
      outstanding_balance_krw: outstandingBalanceGdc * EXCHANGE_RATE_KRW_PER_GDC,
      exemption_threshold_balance_krw: EXEMPTION_THRESHOLD_BALANCE_GDC * EXCHANGE_RATE_KRW_PER_GDC,
      exemption_threshold_balance_ratio: outstandingBalanceGdc / EXEMPTION_THRESHOLD_BALANCE_GDC,
      note: '연간 총발행액(500억원) 기준은 이번 배치에 미구현 — mint 기록에 연도별 집계가 ' +
            '필요하다(다음 과제). 발행잔액 기준(30억원)만 여기서 확인 가능.',
    }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'ISSUANCE_SUMMARY_FAILED', e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — 재무제표 대사(/ledger/reconcile)
// GDC 상거래 완성 계획서 Phase 4. ledger_entries(회계 부기, 이번에 신설)
// 로부터 역산한 bs-cash와 L1 blocks 원장(정산의 정본)에서 재생한 실제
// 잔액이 항상 같아야 한다는 원칙("GDC=현금계정")을 실제로 검증한다 —
// 지금까지는 이 원칙이 코드로 검증된 적이 없었다(2026-07-18 실사 발견).
async function handleLedgerReconcile(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 쿼리 파라미터 필수', corsHeaders);

  try {
    const token = await _l1AdminTokenFor(env, L1_DEFAULT);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const entriesRes = await fetch(
      `${L1_DEFAULT}/api/collections/ledger_entries/records?filter=${filter}&perPage=500`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const entriesData = await entriesRes.json().catch(() => ({ items: [] }));
    const rows = (entriesData.items || []).map(r => ({
      guid: r.guid, direction: r.direction, amount: r.amount,
    }));

    const expected = reconstructBalances(rows, guid);

    const balRes = await fetch(`${L1_DEFAULT}/api/balance?guid=${encodeURIComponent(guid)}`);
    const balData = await balRes.json().catch(() => ({ balance: null }));
    const actualBalance = balData.balance;

    const anomaly = actualBalance !== null && actualBalance !== expected.bsCash;

    return new Response(JSON.stringify({
      ok: true, guid,
      ledger_entries_count: rows.length,
      expected_bs_cash: expected.bsCash,
      expected_pl_purchase: expected.plPurchase,
      actual_balance_l1: actualBalance,
      anomaly,
      note: anomaly
        ? '불일치 발견 — ledger_entries 기록 누락(예: 서비스 배포 이전 거래) 또는 실제 이상 가능성. block_hash/tx_id로 개별 대조 필요.'
        : '일치 확인됨.',
    }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'RECONCILE_FAILED', e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — GDC P2P 이체 (/wallet/gdc-transfer)
// 혼디 코드 스캔 → 프로필 연결 → "GDC 보내기"에서 호출된다.
// 설계문서: docs/gdc_transfer_design_v0_1.md
//
// handleBizOrder를 다시 구현하지 않고 필드만 매핑해 위임한다 — 이미
// items가 빈 배열이면 카탈로그 가격·수수료 분할 검증을 건너뛰므로(주석
// "items가 비어 있으면(= P2P 송금 등...)" 참고) P2P 이체에 그대로 맞고,
// 크로스-L1 브릿지·중요도 점수·재무제표 일치검증·PDV 기록·수신자 claim
// 적재(pending_claims)까지 검증된 로직을 그대로 물려받는다. 로직이 두
// 곳에 복붙되면 다음에 또 어긋난다(과거 fee-split 버그가 이런 식으로
// 났었다) — 반드시 위임 구조를 유지할 것.

// ═══════════════════════════════════════════════════════════
// 고액 거래 생체 재인증 — 사용자별 문턱 금액 + 서버측 WebAuthn 검증
// (2026-07-20 신설 — 이 worker.js가 여러 차례 이전 상태로 되돌아가면서
// 세 번째로 재적용하는 중. 순수 추가만 하며, 다른 협업자 코드는
// 절대 건드리지 않는다.)
// ═══════════════════════════════════════════════════════════
const GDC_STEP_UP_DEFAULT_THRESHOLD = 100000;
const STEP_UP_CHALLENGE_TTL_SECONDS = 120;
const STEP_UP_TOKEN_TTL_MS = 2 * 60 * 1000;

async function handleStepUpThresholdGet(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  let profile;
  try { profile = await _l1FindProfileByGuid(env, guid); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders); }
  if (!profile) return _err(404, 'PROFILE_NOT_FOUND', '프로필을 찾을 수 없습니다', corsHeaders);
  const threshold = profile.extra?.gdc_step_up_threshold;
  return new Response(JSON.stringify({
    ok: true,
    threshold: (typeof threshold === 'number' && threshold >= 0) ? threshold : GDC_STEP_UP_DEFAULT_THRESHOLD,
    is_default: !(typeof threshold === 'number'),
  }), { status: 200, headers: corsHeaders });
}

async function handleStepUpThresholdSet(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, amount } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!(typeof amount === 'number' && amount >= 0 && Number.isFinite(amount))) {
    return _err(400, 'INVALID_AMOUNT', 'amount는 0 이상의 숫자여야 합니다', corsHeaders);
  }
  let profile;
  try { profile = await _l1FindProfileByGuid(env, guid); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders); }
  if (!profile) return _err(404, 'PROFILE_NOT_FOUND', '프로필을 찾을 수 없습니다', corsHeaders);
  const newExtra = { ...(profile.extra || {}), gdc_step_up_threshold: amount };
  try { await _l1PatchProfile(env, profile.id, { extra: newExtra }); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 PATCH 실패: ' + e.message, corsHeaders); }
  return new Response(JSON.stringify({ ok: true, threshold: amount }), { status: 200, headers: corsHeaders });
}

function _derToRawEcdsaSig(der) {
  if (der[0] !== 0x30) throw new Error('DER 서명 형식이 아님(SEQUENCE 태그 없음)');
  let idx = 2;
  if (der[1] & 0x80) idx = 2 + (der[1] & 0x7f);
  if (der[idx] !== 0x02) throw new Error('DER 서명 형식이 아님(r INTEGER 없음)');
  const rLen = der[idx + 1];
  const r = der.slice(idx + 2, idx + 2 + rLen);
  const sIdx = idx + 2 + rLen;
  if (der[sIdx] !== 0x02) throw new Error('DER 서명 형식이 아님(s INTEGER 없음)');
  const sLen = der[sIdx + 1];
  const s = der.slice(sIdx + 2, sIdx + 2 + sLen);
  const _trimAndPad = (bytes, len) => {
    let b = bytes;
    while (b.length > len && b[0] === 0) b = b.slice(1);
    if (b.length < len) b = _concatBytes(new Uint8Array(len - b.length), b);
    return b;
  };
  return _concatBytes(_trimAndPad(r, 32), _trimAndPad(s, 32));
}

async function handleWebAuthnRegisterKey(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, credentialId, publicKeySpkiB64u } = body;
  if (!guid || !credentialId || !publicKeySpkiB64u) {
    return _err(400, 'MISSING_FIELD', 'guid, credentialId, publicKeySpkiB64u 필수', corsHeaders);
  }
  try {
    await crypto.subtle.importKey('spki', _b64uToBytes(publicKeySpkiB64u), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  } catch (e) {
    return _err(400, 'INVALID_PUBLIC_KEY', '공개키 형식이 올바르지 않습니다: ' + e.message, corsHeaders);
  }
  let profile;
  try { profile = await _l1FindProfileByGuid(env, guid); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders); }
  if (!profile) return _err(404, 'PROFILE_NOT_FOUND', '프로필을 찾을 수 없습니다', corsHeaders);
  const prevExtra = profile.extra || {};
  const creds = Array.isArray(prevExtra.webauthn_credentials) ? prevExtra.webauthn_credentials : [];
  const filtered = creds.filter(c => c.credentialId !== credentialId);
  filtered.push({ credentialId, publicKeySpkiB64u, createdAt: new Date().toISOString() });
  try { await _l1PatchProfile(env, profile.id, { extra: { ...prevExtra, webauthn_credentials: filtered } }); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 PATCH 실패: ' + e.message, corsHeaders); }
  return new Response(JSON.stringify({ ok: true, registered: filtered.length }), { status: 200, headers: corsHeaders });
}

async function handleStepUpChallenge(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, tx_hash } = body;
  if (!guid || !tx_hash) return _err(400, 'MISSING_FIELD', 'guid, tx_hash 필수', corsHeaders);
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);
  const challengeBytes = crypto.getRandomValues(new Uint8Array(32));
  const challengeB64u = _b64uEncode(String.fromCharCode(...challengeBytes));
  const sessionId = crypto.randomUUID();
  await env.QR_SESSIONS_KV.put(`stepup:${sessionId}`, JSON.stringify({ guid, tx_hash, challengeB64u, used: false }), { expirationTtl: STEP_UP_CHALLENGE_TTL_SECONDS });
  return new Response(JSON.stringify({ ok: true, sessionId, challengeB64u, rpId: 'hondi.net', expires_in: STEP_UP_CHALLENGE_TTL_SECONDS }), { status: 200, headers: corsHeaders });
}

async function handleStepUpVerify(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, sessionId, credentialId, authenticatorDataB64u, clientDataJSONB64u, signatureB64u } = body;
  if (!guid || !sessionId || !credentialId || !authenticatorDataB64u || !clientDataJSONB64u || !signatureB64u) {
    return _err(400, 'MISSING_FIELD', '필수 필드 누락', corsHeaders);
  }
  if (!env.QR_SESSIONS_KV) return _err(500, 'KV_NOT_BOUND', '세션 저장소가 설정되지 않았습니다', corsHeaders);
  if (!env.PHONE_VERIFY_SECRET) return _err(500, 'SECRET_NOT_SET', 'PHONE_VERIFY_SECRET이 설정되지 않았습니다', corsHeaders);
  const sessKey = `stepup:${sessionId}`;
  const raw = await env.QR_SESSIONS_KV.get(sessKey);
  if (!raw) return _err(404, 'CHALLENGE_EXPIRED', '챌린지가 만료됐거나 존재하지 않습니다', corsHeaders);
  const session = JSON.parse(raw);
  if (session.used) return _err(409, 'CHALLENGE_ALREADY_USED', '이미 사용된 챌린지입니다', corsHeaders);
  if (session.guid !== guid) return _err(403, 'GUID_MISMATCH', '이 챌린지의 소유자가 아닙니다', corsHeaders);
  let clientData;
  try { clientData = JSON.parse(new TextDecoder().decode(_b64uToBytes(clientDataJSONB64u))); }
  catch (e) { return _err(400, 'CLIENTDATA_PARSE_ERROR', 'clientDataJSON 파싱 실패', corsHeaders); }
  if (clientData.type !== 'webauthn.get') return _err(400, 'WRONG_CEREMONY_TYPE', `type이 webauthn.get이 아닙니다: ${clientData.type}`, corsHeaders);
  if (clientData.challenge !== session.challengeB64u) return _err(403, 'CHALLENGE_MISMATCH', '이 세션에서 발급한 챌린지와 일치하지 않습니다', corsHeaders);
  const expectedOrigin = 'https://hondi.net';
  if (clientData.origin !== expectedOrigin) return _err(403, 'ORIGIN_MISMATCH', `예상 origin(${expectedOrigin})과 다릅니다: ${clientData.origin}`, corsHeaders);
  const authData = _b64uToBytes(authenticatorDataB64u);
  if (authData.length < 37) return _err(400, 'AUTHDATA_TOO_SHORT', 'authenticatorData 형식 오류', corsHeaders);
  const rpIdHashExpected = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('hondi.net')));
  const rpIdHashActual = authData.slice(0, 32);
  if (!rpIdHashExpected.every((b, i) => b === rpIdHashActual[i])) return _err(403, 'RPID_HASH_MISMATCH', 'RP ID 해시가 일치하지 않습니다', corsHeaders);
  const flags = authData[32];
  if (!((flags & 0x01) !== 0)) return _err(403, 'USER_NOT_PRESENT', 'User Presence 플래그가 없습니다', corsHeaders);
  if (!((flags & 0x04) !== 0)) return _err(403, 'USER_NOT_VERIFIED', 'User Verification(생체인증) 플래그가 없습니다', corsHeaders);
  let profile;
  try { profile = await _l1FindProfileByGuid(env, guid); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders); }
  const creds = profile?.extra?.webauthn_credentials || [];
  const credRecord = creds.find(c => c.credentialId === credentialId);
  if (!credRecord) return _err(404, 'CREDENTIAL_NOT_FOUND', '이 기기의 생체인증 키가 서버에 등록돼 있지 않습니다', corsHeaders);
  let verified = false;
  try {
    const pubKey = await crypto.subtle.importKey('spki', _b64uToBytes(credRecord.publicKeySpkiB64u), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const clientDataHash = new Uint8Array(await crypto.subtle.digest('SHA-256', _b64uToBytes(clientDataJSONB64u)));
    const signedData = _concatBytes(authData, clientDataHash);
    const rawSig = _derToRawEcdsaSig(_b64uToBytes(signatureB64u));
    verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, pubKey, rawSig, signedData);
  } catch (e) {
    return _err(400, 'SIGNATURE_VERIFY_ERROR', '서명 검증 중 오류: ' + e.message, corsHeaders);
  }
  if (!verified) return _err(403, 'SIGNATURE_INVALID', '서명이 유효하지 않습니다', corsHeaders);
  session.used = true;
  await env.QR_SESSIONS_KV.put(sessKey, JSON.stringify(session), { expirationTtl: STEP_UP_CHALLENGE_TTL_SECONDS });
  const exp = Date.now() + STEP_UP_TOKEN_TTL_MS;
  const payload = `${guid}:${session.tx_hash}:${exp}`;
  const signature = await _hmacSha256Hex(env.PHONE_VERIFY_SECRET, payload);
  const step_up_token = payload + '.' + signature;
  return new Response(JSON.stringify({ ok: true, step_up_token, expires_at: new Date(exp).toISOString() }), { status: 200, headers: corsHeaders });
}

async function _verifyStepUpToken(env, token, expectedGuid, expectedTxHash) {
  if (!token || typeof token !== 'string') return { ok: false, reason: 'MISSING_TOKEN' };
  const dotIdx = token.lastIndexOf('.');
  if (dotIdx < 0) return { ok: false, reason: 'MALFORMED' };
  const payload = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  const expectedSig = await _hmacSha256Hex(env.PHONE_VERIFY_SECRET, payload);
  if (sig !== expectedSig) return { ok: false, reason: 'BAD_SIGNATURE' };
  const parts = payload.split(':');
  if (parts.length !== 3) return { ok: false, reason: 'MALFORMED_PAYLOAD' };
  const [tokGuid, txHash, expStr] = parts;
  const exp = parseInt(expStr, 10);
  if (!Number.isFinite(exp) || Date.now() > exp) return { ok: false, reason: 'EXPIRED' };
  if (tokGuid !== expectedGuid) return { ok: false, reason: 'GUID_MISMATCH' };
  if (txHash !== expectedTxHash) return { ok: false, reason: 'TX_HASH_MISMATCH' };
  return { ok: true };
}

async function handleGdcTransfer(request, env, corsHeaders, ctx) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const {
    tx, tx_hash, sender_sig, sender_public_key,
    from_guid, to_guid, amount, memo = '',
    purpose = 'transfer',
    prev_settle_hash, balance_claimed, l1_node,
  } = body;

  // 필수 필드 확인
  if (!tx_hash)            return _err(400, 'MISSING_FIELD', 'tx_hash 필수', corsHeaders);
  if (!sender_sig)         return _err(400, 'MISSING_FIELD', 'sender_sig 필수', corsHeaders);
  if (!sender_public_key)  return _err(400, 'MISSING_FIELD', 'sender_public_key 필수', corsHeaders);
  if (!from_guid)          return _err(400, 'MISSING_FIELD', 'from_guid 필수', corsHeaders);
  if (!to_guid)            return _err(400, 'MISSING_FIELD', 'to_guid 필수', corsHeaders);
  if (!(amount > 0))       return _err(400, 'MISSING_FIELD', 'amount 필수(양수)', corsHeaders);

  // ── Phase 1: 거래목적 분류 (설계문서 §4, 법적 리스크 직결) ──────────
  if (purpose !== 'transfer' && purpose !== 'purchase') {
    return _err(400, 'INVALID_PURPOSE', "purpose는 'transfer' 또는 'purchase'여야 합니다", corsHeaders);
  }
  if (purpose === 'purchase' && GDC_PURCHASE_MEMO_REQUIRED && !memo.trim()) {
    return _err(400, 'MEMO_REQUIRED_FOR_PURCHASE', '재화·용역 대금 결제는 품목명(memo)이 필수입니다', corsHeaders);
  }

  // ── Phase 2: 판매자 자격 확인 (설계문서 §4 정책 — 피터 확정: 정부24
  // 사업자등록증 첨부로 인증). purpose='purchase'이고 소액 문턱을 넘으면
  // 수취인이 verified_seller여야 한다. transfer(단순송금)에는 적용 안 함.
  if (purpose === 'purchase' && amount > GDC_UNVERIFIED_SELLER_LIMIT) {
    const verification = await _lookupSellerVerification(env, to_guid);
    if (!verification || verification.status !== 'verified') {
      return _err(403, 'SELLER_NOT_VERIFIED',
        `₮${GDC_UNVERIFIED_SELLER_LIMIT} 초과 재화·용역 대금 결제는 수취인이 사업자등록증(정부24) ` +
        `인증을 완료해야 합니다. 현재 상태: ${verification?.status || '미제출'}`, corsHeaders);
    }
  }

  // ── P2P 전용 검증 (설계문서 §4 정책) ──────────────────────────
  if (from_guid === to_guid) {
    return _err(400, 'SELF_TRANSFER_NOT_ALLOWED', '본인에게는 이체할 수 없습니다', corsHeaders);
  }
  // 최소 이체액 1₮ — 0/음수/비정상 소수점 방지. 최대 한도는 1차 미구현
  // (설계문서 §4 — 결정 시 여기 추가).
  const GDC_TRANSFER_MIN_AMOUNT = 1;
  if (amount < GDC_TRANSFER_MIN_AMOUNT) {
    return _err(400, 'AMOUNT_OUT_OF_RANGE',
      `최소 이체액은 ₮${GDC_TRANSFER_MIN_AMOUNT}입니다`, corsHeaders);
  }

  // ── 고액 거래 생체 재인증 강제(step-up) — 2026-07-20 재적용 ─────────
  {
    let senderProfile;
    try { senderProfile = await _l1FindProfileByGuid(env, from_guid); }
    catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패(재인증 문턱 조회): ' + e.message, corsHeaders); }
    const rawThreshold = senderProfile?.extra?.gdc_step_up_threshold;
    const threshold = (typeof rawThreshold === 'number' && rawThreshold >= 0) ? rawThreshold : GDC_STEP_UP_DEFAULT_THRESHOLD;
    if (amount >= threshold) {
      const stepUpCheck = await _verifyStepUpToken(env, body.step_up_token, from_guid, tx_hash);
      if (!stepUpCheck.ok) {
        return _err(403, 'STEP_UP_REQUIRED',
          `₮${threshold.toLocaleString()} 이상 거래는 생체 재인증이 필요합니다(${stepUpCheck.reason}).`, corsHeaders);
      }
    }
  }

  // ── handleBizOrder가 기대하는 형태로 매핑해 위임 ──────────────
  // outputs는 수취인 1개뿐 — 플랫폼 수수료 output 없음(P2P는 수수료 0%).
  const mappedTx = tx || {
    version: 1,
    input: { owner_guid: from_guid, prev_settle_hash: prev_settle_hash || null,
              balance_claimed: balance_claimed || 0 },
    outputs: [{ recipient_guid: to_guid, amount }],
    items: [],
  };

  const mappedBody = {
    tx: mappedTx, tx_hash,
    buyer_sig: sender_sig, buyer_public_key: sender_public_key,
    from_guid, seller_guid: to_guid, l1_node,
    memo, item_name: memo || 'GDC 이체', purpose,
    prev_settle_hash, balance_claimed,
    seller_net: amount, fee: 0,   // P2P는 플랫폼 수수료 없음
    asset_type: 'stable', contract_type: 'instant',
  };

  const syntheticRequest = new Request(request.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mappedBody),
  });

  return handleBizOrder(syntheticRequest, env, corsHeaders, ctx);
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — 거래 이의제기(사후 신고), GDC 상거래 완성 계획서
// Phase 3. §2 결론대로 완전 자동 가격판단은 이번 배치에 포함하지 않고,
// 신고→관리자 검토 흐름만 구현한다. 신고 권한은 해당 tx_id의 ledger_entries
// 에 실제로 등장하는 guid(=그 거래 당사자)로 제한한다 — 아무나 남의
// 거래를 신고할 수 있으면 악용 소지가 크다.
async function handleTradeDisputeSubmit(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { tx_id, reporter_guid, pubkey, signature, ts, reason } = body;
  if (!tx_id || !reporter_guid || !reason?.trim()) {
    return _err(400, 'MISSING_FIELD', 'tx_id, reporter_guid, reason 필수', corsHeaders);
  }

  const authOk = await _verifyClaimsRequester(env, {
    guid: reporter_guid, pubkey, signature, ts, sigMsg: `dispute:${tx_id}:${reporter_guid}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  try {
    const token = await _l1AdminToken(env);
    const headers = { 'Authorization': `Bearer ${token}` };

    // 신고자가 이 거래 당사자인지 ledger_entries로 확인
    const filter = encodeURIComponent(`tx_id='${String(tx_id).replace(/'/g,"\\'")}' && guid='${String(reporter_guid).replace(/'/g,"\\'")}'`);
    const partyRes = await fetch(`${L1_DEFAULT}/api/collections/ledger_entries/records?filter=${filter}&perPage=1`, { headers });
    const partyData = await partyRes.json().catch(() => ({ items: [] }));
    if (!partyData.items?.length) {
      return _err(403, 'NOT_A_PARTY', '해당 거래의 당사자만 신고할 수 있습니다', corsHeaders);
    }

    const col = 'transaction_disputes';
    const res = await fetch(`${L1_DEFAULT}/api/collections/${col}/records`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tx_id, reporter_guid, reason: reason.trim(), status: 'open',
        created_at: new Date().toISOString(),
      }),
    });
    const saved = await res.json();
    return new Response(JSON.stringify({ ok: true, record: saved }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'DISPUTE_SUBMIT_FAILED', e.message, corsHeaders);
  }
}

async function handleTradeDisputeQueue(request, env, corsHeaders) {
  const url = new URL(request.url);
  const admin_guid = url.searchParams.get('admin_guid');
  const pubkey      = url.searchParams.get('pubkey');
  const signature   = url.searchParams.get('signature');
  const ts          = url.searchParams.get('ts') || '';
  if (!admin_guid) return _err(400, 'MISSING_FIELD', 'admin_guid 필수', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid: admin_guid, pubkey, signature, ts, sigMsg: `dispute-admin:${admin_guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const adminFilter = encodeURIComponent(`guid='${String(admin_guid).replace(/'/g,"\\'")}' && active=true`);
  const adminRes = await fetch(`${L1_DEFAULT}/api/collections/admin_guids/records?filter=${adminFilter}&perPage=1`,
    { headers: { 'Authorization': `Bearer ${token}` } });
  const adminData = await adminRes.json().catch(() => ({ items: [] }));
  const adminRow = adminData.items?.[0];
  let services = [];
  try { services = Array.isArray(adminRow?.services) ? adminRow.services : JSON.parse(adminRow?.services || '[]'); } catch { services = []; }
  const isAdmin = !!adminRow && (services.includes('*') || services.includes('trade_dispute_review'));
  if (!isAdmin) return _err(403, 'AUTH_REQUIRED', 'trade_dispute_review 관리자 권한이 필요합니다', corsHeaders);

  try {
    const filter = encodeURIComponent(`status != 'resolved'`);
    const res = await fetch(`${L1_DEFAULT}/api/collections/transaction_disputes/records?filter=${filter}&sort=created_at&perPage=100`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json().catch(() => ({ items: [] }));
    return new Response(JSON.stringify({ ok: true, count: data.items?.length || 0, items: data.items || [] }),
      { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'QUEUE_FETCH_FAILED', e.message, corsHeaders);
  }
}

async function handleTradeDisputeResolve(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { admin_guid, pubkey, signature, ts, dispute_id, resolution_note } = body;
  if (!admin_guid || !dispute_id) return _err(400, 'MISSING_FIELD', 'admin_guid, dispute_id 필수', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid: admin_guid, pubkey, signature, ts, sigMsg: `dispute-admin:${admin_guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const adminFilter = encodeURIComponent(`guid='${String(admin_guid).replace(/'/g,"\\'")}' && active=true`);
  const adminRes = await fetch(`${L1_DEFAULT}/api/collections/admin_guids/records?filter=${adminFilter}&perPage=1`,
    { headers: { 'Authorization': `Bearer ${token}` } });
  const adminData = await adminRes.json().catch(() => ({ items: [] }));
  const adminRow = adminData.items?.[0];
  let services = [];
  try { services = Array.isArray(adminRow?.services) ? adminRow.services : JSON.parse(adminRow?.services || '[]'); } catch { services = []; }
  const isAdmin = !!adminRow && (services.includes('*') || services.includes('trade_dispute_review'));
  if (!isAdmin) return _err(403, 'AUTH_REQUIRED', 'trade_dispute_review 관리자 권한이 필요합니다', corsHeaders);

  try {
    const patchRes = await fetch(`${L1_DEFAULT}/api/collections/transaction_disputes/records/${dispute_id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: 'resolved', resolution_note: resolution_note || '',
        resolved_at: new Date().toISOString(),
      }),
    });
    const saved = await patchRes.json();
    return new Response(JSON.stringify({ ok: true, record: saved }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'RESOLVE_FAILED', e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — 판매자 인증 승인 절차 (GDC 상거래 완성 계획서
// Phase 2 잔여 과제). 지난 배치(fix10.py)에서 제출(/seller/verify-submit)
// 까지만 만들고 "누가 pending→verified로 바꾸는지"는 비워뒀었다.
//
// 인증 방식은 handleVerifyAdmin과 완전히 동일한 패턴을 그대로 재사용한다
// (admin_guids 컬렉션, Ed25519 서명 검증 — "로그인=관리자" 착각 구조적
// 공백을 gopang 레벨에서 이미 한 번 해결해둔 걸 그대로 따른다). 좁게
// 권한을 줄 수 있도록 service='seller_verification'로 스코프를 잡는다
// (admin_guids에 이 service를 포함해 등록해야 승인 가능 — 등록 자체는
// 이 배치 범위 밖, 서버 관리자가 DB에 직접 넣어야 한다).
async function _isSellerVerificationAdmin(env, { guid, pubkey, signature, ts }) {
  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `seller-verify-admin:${guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return false;

  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`guid='${String(guid).replace(/'/g,"\\'")}' && active=true`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/admin_guids/records?filter=${filter}&perPage=1`,
    { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json().catch(() => ({ items: [] }));
  const row = data.items?.[0];
  let services = [];
  try { services = Array.isArray(row?.services) ? row.services : JSON.parse(row?.services || '[]'); } catch { services = []; }
  return !!row && (services.includes('*') || services.includes('seller_verification'));
}

async function handleSellerVerifyQueue(request, env, corsHeaders) {
  const url = new URL(request.url);
  const admin_guid = url.searchParams.get('admin_guid');
  const pubkey      = url.searchParams.get('pubkey');
  const signature   = url.searchParams.get('signature');
  const ts          = url.searchParams.get('ts') || '';
  if (!admin_guid) return _err(400, 'MISSING_FIELD', 'admin_guid 필수', corsHeaders);

  const isAdmin = await _isSellerVerificationAdmin(env, { guid: admin_guid, pubkey, signature, ts });
  if (!isAdmin) return _err(403, 'AUTH_REQUIRED', 'seller_verification 관리자 권한이 필요합니다', corsHeaders);

  try {
    const token = await _l1AdminToken(env);
    const filter = encodeURIComponent(`status='pending'`);
    const res = await fetch(`${L1_DEFAULT}/api/collections/seller_verifications/records?filter=${filter}&sort=submitted_at&perPage=100`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json().catch(() => ({ items: [] }));
    // 원본 서류 파일은 저장하지 않으므로(해시만 보관) 관리자가 여기서
    // 확인할 수 있는 건 해시·파일명·크기뿐이다 — 실제 서류 진위 확인은
    // 이 큐 바깥(다른 채널로 직접 확인)에서 이뤄져야 한다는 걸 명시.
    return new Response(JSON.stringify({
      ok: true, count: data.items?.length || 0, items: data.items || [],
      note: '원본 파일 미보관(해시만 있음) — 진위 확인은 별도 채널 필요',
    }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'QUEUE_FETCH_FAILED', e.message, corsHeaders);
  }
}

async function handleSellerVerifyReview(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { admin_guid, pubkey, signature, ts, target_guid, decision, reject_reason } = body;
  if (!admin_guid || !target_guid) return _err(400, 'MISSING_FIELD', 'admin_guid, target_guid 필수', corsHeaders);
  if (decision !== 'verified' && decision !== 'rejected') {
    return _err(400, 'INVALID_DECISION', "decision은 'verified' 또는 'rejected'여야 합니다", corsHeaders);
  }

  const isAdmin = await _isSellerVerificationAdmin(env, { guid: admin_guid, pubkey, signature, ts });
  if (!isAdmin) return _err(403, 'AUTH_REQUIRED', 'seller_verification 관리자 권한이 필요합니다', corsHeaders);

  try {
    const token = await _l1AdminToken(env);
    const filter = encodeURIComponent(`guid='${String(target_guid).replace(/'/g,"\\'")}'`);
    const existingRes = await fetch(`${L1_DEFAULT}/api/collections/seller_verifications/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const existingData = await existingRes.json().catch(() => ({ items: [] }));
    const existing = existingData.items?.[0];
    if (!existing) return _err(404, 'NOT_FOUND', '해당 guid의 제출 기록이 없습니다', corsHeaders);

    const patch = { status: decision };
    if (decision === 'verified') patch.verified_at = new Date().toISOString();
    if (decision === 'rejected') patch.reject_reason = reject_reason || '';

    const patchRes = await fetch(`${L1_DEFAULT}/api/collections/seller_verifications/records/${existing.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    });
    const saved = await patchRes.json();
    return new Response(JSON.stringify({ ok: true, status: decision, record: saved }),
      { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'REVIEW_FAILED', e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — 판매자 자격 확인(사업자등록증 첨부) 제출/조회
// (/seller/verify-submit, /seller/verify-status)
//
// worker.js에는 파일 바이너리 저장소가 없다(2026-07-12 K-Gov
// REQUIRED_DOCUMENTS 작업 때 확인된 동일 제약) — SHA-256 해시+파일명+
// 크기만 "서류 소지 증명"으로 받는다. 진위 확인(국세청 API)은 범위 밖
// — 항상 'pending'으로 저장되고, 별도 관리자 승인 절차(이번 배치에는
// 미포함)로만 'verified'가 된다. 즉 지금 이 엔드포인트만으로는 아무도
// 자동으로 verified가 되지 않는다 — 승인 UI/절차가 다음 과제다.
async function handleSellerVerifySubmit(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, biz_reg_hash, biz_reg_filename, biz_reg_size } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!biz_reg_hash || !/^[0-9a-f]{64}$/.test(biz_reg_hash)) {
    return _err(400, 'INVALID_HASH', 'biz_reg_hash는 64자리 hex(SHA-256)여야 합니다', corsHeaders);
  }
  if (!biz_reg_filename) return _err(400, 'MISSING_FIELD', 'biz_reg_filename 필수', corsHeaders);
  if (!(biz_reg_size > 0)) return _err(400, 'MISSING_FIELD', 'biz_reg_size 필수(양수)', corsHeaders);

  try {
    const token = await _l1AdminTokenFor(env, L1_DEFAULT);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const existingRes = await fetch(`${L1_DEFAULT}/api/collections/seller_verifications/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const existingData = await existingRes.json().catch(() => ({ items: [] }));
    const existing = existingData.items?.[0];

    const payload = {
      guid, status: 'pending', biz_reg_hash, biz_reg_filename, biz_reg_size,
      submitted_at: new Date().toISOString(),
    };

    let saved;
    if (existing) {
      // 재제출 — 이전 상태(rejected 등)와 무관하게 pending으로 재시작
      const res = await fetch(`${L1_DEFAULT}/api/collections/seller_verifications/records/${existing.id}`, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      saved = await res.json();
    } else {
      const res = await fetch(`${L1_DEFAULT}/api/collections/seller_verifications/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      saved = await res.json();
    }
    return new Response(JSON.stringify({ ok: true, status: 'pending', record: saved }),
      { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(500, 'SELLER_VERIFY_SUBMIT_FAILED', e.message, corsHeaders);
  }
}

async function handleSellerVerifyStatus(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 쿼리 파라미터 필수', corsHeaders);

  const verification = await _lookupSellerVerification(env, guid);
  return new Response(JSON.stringify({
    ok: true,
    guid,
    status: verification?.status || 'unverified',
    submitted_at: verification?.submitted_at || null,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-15 신설 — GDC 예금 메타데이터(gdc_deposits) L1 이관.
// gdc.hondi.net의 openDep()이 실제 자금 이체는 이미 L1 /biz/order로
// 처리한 뒤(GDC_DEPOSIT_VAULT_GUID='gdc-deposit-vault'로 송금), 그
// 이체에 딸린 상품정보(product_type/interest_rate)만 이 엔드포인트로
// 기록한다. vault_tx_hash로 넘어온 값이 실제 blocks 원장에 존재하고
// 정말 예금금고로 간 거래인지 검증한 뒤에만 기록한다 — 클라이언트가
// 임의의 tx_hash로 가짜 예금 메타데이터를 만들지 못하게 막는다.
// ═══════════════════════════════════════════════════════════
const GDC_DEPOSIT_VAULT_GUID = 'gdc-deposit-vault';

async function handleGdcDepositCreate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { user_guid, product_type, principal, interest_rate, vault_tx_hash } = body;
  if (!user_guid)      return _err(400, 'MISSING_FIELD', 'user_guid 필수', corsHeaders);
  if (!product_type)   return _err(400, 'MISSING_FIELD', 'product_type 필수', corsHeaders);
  if (!(principal > 0)) return _err(400, 'INVALID_AMOUNT', 'principal은 0보다 커야 합니다', corsHeaders);
  if (!vault_tx_hash)  return _err(400, 'MISSING_FIELD', 'vault_tx_hash 필수', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  // vault_tx_hash 검증 — 실제로 이 tx_hash의 블록이 존재하고, buyer가
  // user_guid이며, 예금금고로 가는 output이 있는지 확인.
  try {
    const filter = encodeURIComponent(`tx_hash='${String(vault_tx_hash).replace(/'/g,"\\'")}'`);
    const blockRes = await fetch(`${L1_DEFAULT}/api/collections/blocks/records?filter=${filter}&perPage=1`, { headers });
    const blockData = await blockRes.json().catch(() => ({ items: [] }));
    const block = blockData.items?.[0];
    if (!block || block.buyer_guid !== user_guid) {
      return _err(403, 'TX_VERIFICATION_FAILED', '해당 tx_hash가 이 사용자의 유효한 예치 거래가 아닙니다', corsHeaders);
    }
    let outputs; try { outputs = JSON.parse(block.outputs || '[]'); } catch { outputs = []; }
    const vaultOutput = outputs.find(o => o.recipient_guid === GDC_DEPOSIT_VAULT_GUID);
    if (!vaultOutput || vaultOutput.amount < principal) {
      return _err(403, 'TX_VERIFICATION_FAILED', '거래 금액이 예치금과 일치하지 않습니다', corsHeaders);
    }
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 검증 실패: ' + e.message, corsHeaders);
  }

  try {
    const res = await fetch(`${L1_DEFAULT}/api/collections/gdc_deposits/records`, {
      method: 'POST', headers,
      body: JSON.stringify({
        user_guid, product_type, principal,
        interest_rate: interest_rate || 0,
        vault_tx_hash, status: 'active',
      }),
    });
    if (!res.ok) return _err(500, 'SAVE_FAILED', await res.text(), corsHeaders);
    const row = await res.json().catch(() => null);
    return new Response(JSON.stringify({ ok: true, id: row?.id }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 저장 실패: ' + e.message, corsHeaders);
  }
}

async function handleGdcDepositList(request, env, corsHeaders) {
  const url = new URL(request.url);
  const userGuid = url.searchParams.get('user_guid');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 50);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token };
  const filter = userGuid
    ? encodeURIComponent(`user_guid='${String(userGuid).replace(/'/g,"\\'")}'`)
    : '';
  const url2 = filter
    ? `${L1_DEFAULT}/api/collections/gdc_deposits/records?filter=${filter}&sort=-created&perPage=${limit}`
    : `${L1_DEFAULT}/api/collections/gdc_deposits/records?sort=-created&perPage=${limit}`;
  try {
    const res = await fetch(url2, { headers });
    const data = await res.json().catch(() => ({ items: [] }));
    return new Response(JSON.stringify({ ok: true, items: data.items || [] }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — POST /biz/gdc-deposit-close (예치금 인출/반환).
// 법적 검토(무이자 예치·보관만 허용)에 따라 이자 지급 없이 원금만
// 그대로 돌려준다. GDC_DEPOSIT_VAULT_GUID는 실제 개인키가 없는
// 시스템 계정이라(handleGdcDepositCreate 주석 참고) 사용자처럼
// buyer_sig로 서명할 수 없다 — main.pb.js /api/mint가 쓰는 것과
// 동일한 "서버 관리자 권한으로 직접 blocks 레코드 생성" 패턴을
// 그대로 따른다(buyer_guid=vault, seller_guid=user, buyer_sig='').
// 예치 개설(handleGdcDepositCreate)과 반대 방향 블록이라 총량
// 보존 불변식은 그대로 유지된다(새 발행 아님, 이미 있던 vault
// 잔액을 사용자에게 되돌리는 것뿐).
//
// 자금이 실제로 이동하므로 본인 서명 인증을 반드시 요구한다
// (/biz/claims, /biz/settle-ledger와 동일한 서명+TOFU 원칙 —
// handleGdcDepositCreate 자체는 vault_tx_hash가 이미 서명된
// 거래에서 나온 값이라 별도 인증이 없었지만, 인출은 다르다).
// ═══════════════════════════════════════════════════════════
async function handleGdcDepositClose(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { user_guid, deposit_id, pubkey, signature, ts } = body;
  if (!user_guid)  return _err(400, 'MISSING_FIELD', 'user_guid 필수', corsHeaders);
  if (!deposit_id) return _err(400, 'MISSING_FIELD', 'deposit_id 필수', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid: user_guid, pubkey, signature, ts,
    sigMsg: `gdc-deposit-close:${user_guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 예치 레코드 조회 — 소유자·상태 검증(타인 예치금 인출/중복 인출 방지)
  let dep;
  try {
    const depRes = await fetch(`${L1_DEFAULT}/api/collections/gdc_deposits/records/${encodeURIComponent(deposit_id)}`, { headers });
    if (!depRes.ok) return _err(404, 'DEPOSIT_NOT_FOUND', '예치 기록을 찾을 수 없습니다', corsHeaders);
    dep = await depRes.json();
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders);
  }
  if (dep.user_guid !== user_guid) return _err(403, 'NOT_OWNER', '본인 예치금이 아닙니다', corsHeaders);
  if (dep.status !== 'active')     return _err(409, 'ALREADY_CLOSED', `이미 ${dep.status} 상태입니다`, corsHeaders);

  const principal = Number(dep.principal);
  if (!(principal > 0)) return _err(500, 'INVALID_PRINCIPAL', '예치금 원금 값이 올바르지 않습니다', corsHeaders);

  // 반환 블록 생성 — vault → user (무이자, 원금만 그대로 반환)
  const contentHash = await _sha256Hex(`gdc-deposit-close:${deposit_id}:${user_guid}:${principal}:${Date.now()}`);
  const blockBody = {
    block_type:       'withdrawal',
    tx_hash:           contentHash,
    buyer_guid:         GDC_DEPOSIT_VAULT_GUID,
    seller_guid:        user_guid,
    buyer_sig:          '',
    outputs: JSON.stringify([{ recipient_guid: user_guid, amount: principal, deposit_id }]),
    prev_block_hash:    '',
    content_hash:       contentHash,
    height:             0,
    prev_settle_hash:   '',
  };
  let blockRow;
  try {
    const blockRes = await fetch(`${L1_DEFAULT}/api/collections/blocks/records`, {
      method: 'POST', headers, body: JSON.stringify(blockBody),
    });
    if (!blockRes.ok) return _err(502, 'L1_WRITE_FAILED', await blockRes.text(), corsHeaders);
    blockRow = await blockRes.json().catch(() => null);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 반환 블록 생성 실패: ' + e.message, corsHeaders);
  }

  // 예치 상태를 closed로 표시 — 실패해도 반환 블록은 이미 만들어졌으니
  // 자금은 안전하다(중복 인출은 블록 존재와 무관하게 status 검사로
  // 여전히 1차 방어됨 — 다만 이 PATCH가 실패하면 status가 active로
  // 남아 재시도 시 두 번째 반환 블록이 생길 위험이 있다는 걸 명시).
  try {
    const patchRes = await fetch(`${L1_DEFAULT}/api/collections/gdc_deposits/records/${encodeURIComponent(deposit_id)}`, {
      method: 'PATCH', headers, body: JSON.stringify({ status: 'closed' }),
    });
    if (!patchRes.ok) {
      console.warn('[GDC Deposit Close] 상태 갱신 실패(반환 블록은 생성됨, 자금 안전, 수동 확인 필요):', await patchRes.text());
    }
  } catch (e) {
    console.warn('[GDC Deposit Close] 상태 갱신 예외(반환 블록은 생성됨):', e.message);
  }

  return new Response(JSON.stringify({
    ok: true, tx_hash: contentHash, amount: principal, block_id: blockRow?.id,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — K-Insurance 청구 접수 2종 (POST /biz/ins-claim,
// GET /biz/ins-claims). HONDI_GAP_REMEDIATION_DIRECTIVE v1.0 §2.1 참고.
//
// insurance/js/ins-core.js 등 죽은 코드 클러스터(Supabase placeholder
// 의존, 자동 심사·사기탐지·자동지급 포함)는 완전히 폐기하고, 여기서는
// "접수 → 사람이 확인 → 수동 상태 변경"만 구현한다. 무심사 자동지급은
// 보험업법 인가 문제와 직결되므로 이번 범위에 절대 포함하지 않는다
// (gdc LEGAL-HOLD와 동일한 원칙 — 확실한 것만 현실화).
//
// 청구 내역은 거래 금액 등 민감 정보를 담으므로, handleClaimsList와
// 동일하게 GET도 서명 인증을 요구한다(guid는 공개 정보라 자기주장만으로는
// 부족 — TOFU 방식 pubkey 대조).
// ═══════════════════════════════════════════════════════════
const INS_CLAIM_STATUSES = ['접수', '심사중', '승인', '거부', '지급완료'];

async function handleInsClaimCreate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { user_guid, insurance_type, amount, note, pubkey, signature, ts } = body;
  if (!user_guid)       return _err(400, 'MISSING_FIELD', 'user_guid 필수', corsHeaders);
  if (!insurance_type)  return _err(400, 'MISSING_FIELD', 'insurance_type 필수', corsHeaders);
  if (!(amount > 0))    return _err(400, 'INVALID_AMOUNT', 'amount는 0보다 커야 합니다', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid: user_guid, pubkey, signature, ts,
    sigMsg: `ins-claim:${user_guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  const claimId = 'ins_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);

  try {
    const res = await fetch(`${L1_DEFAULT}/api/collections/ins_claims/records`, {
      method: 'POST', headers,
      body: JSON.stringify({
        claim_id: claimId, user_guid, insurance_type,
        amount, note: note || '', status: '접수',
      }),
    });
    if (!res.ok) return _err(500, 'SAVE_FAILED', await res.text(), corsHeaders);
    const row = await res.json().catch(() => null);
    return new Response(JSON.stringify({ ok: true, claim_id: claimId, id: row?.id, status: '접수' }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 저장 실패: ' + e.message, corsHeaders);
  }
}

async function handleInsClaimsList(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid      = url.searchParams.get('guid');
  const pubkey    = url.searchParams.get('pubkey');
  const signature = url.searchParams.get('signature');
  const ts        = url.searchParams.get('ts') || '';
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `ins-claims:${guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}` };
  const filter = encodeURIComponent(`user_guid='${String(guid).replace(/'/g,"\\'")}'`);
  try {
    const res = await fetch(
      `${L1_DEFAULT}/api/collections/ins_claims/records?filter=${filter}&sort=-created&perPage=50`,
      { headers }
    );
    if (!res.ok) return _err(502, 'L1_UNREACHABLE', '청구 조회 실패', corsHeaders);
    const data = await res.json().catch(() => ({ items: [] }));
    const claims = (data.items || []).map(r => ({
      claim_id: r.claim_id, insurance_type: r.insurance_type,
      amount: r.amount, note: r.note, status: r.status,
      created: r.created, updated: r.updated,
    }));
    return new Response(JSON.stringify({ ok: true, claims }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — 플랫폼 공통 관리자 인증 (GET /biz/verify-admin).
// HONDI_GAP_REMEDIATION_DIRECTIVE v1.0 §2.3 참고. tax뿐 아니라 여러
// K-서비스 관리자 대시보드가 "로그인=관리자"로 착각하기 쉬운 구조적
// 공백을 공유하고 있어 gopang 레벨에서 한 번만 설계한다.
//
// admin_guids 컬렉션 자체가 민감정보(누가 관리자인지)이므로 목록을
// 절대 반환하지 않고, "이 guid가 이 service의 admin인가?" 질의에
// true/false만 응답한다. guid는 자기주장만으로는 신뢰할 수 없으므로
// _verifyClaimsRequester로 서명 인증(TOFU pubkey 대조)까지 통과해야
// 응답한다 — 그렇지 않으면 "내가 admin이 아닌 남의 guid로 조회해서
// 그 사람이 admin인지 알아내는" 정보 유출이 가능해진다.
async function handleVerifyAdmin(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid      = url.searchParams.get('guid');
  const service   = url.searchParams.get('service') || '';
  const pubkey    = url.searchParams.get('pubkey');
  const signature = url.searchParams.get('signature');
  const ts        = url.searchParams.get('ts') || '';
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `verify-admin:${guid}:${service}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}` };
  const filter = encodeURIComponent(`guid='${String(guid).replace(/'/g,"\\'")}' && active=true`);
  try {
    const res = await fetch(`${L1_DEFAULT}/api/collections/admin_guids/records?filter=${filter}&perPage=1`, { headers });
    if (!res.ok) return _err(502, 'L1_UNREACHABLE', '관리자 조회 실패', corsHeaders);
    const data = await res.json().catch(() => ({ items: [] }));
    const row = data.items?.[0];
    let services = [];
    try { services = Array.isArray(row?.services) ? row.services : JSON.parse(row?.services || '[]'); } catch { services = []; }
    const isAdmin = !!row && (services.includes('*') || (service && services.includes(service)));
    return new Response(JSON.stringify({ ok: true, is_admin: isAdmin }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-18 신설 — GDC DAO 거버넌스 3종 (POST /biz/gdc-dao/proposal,
// POST /biz/gdc-dao/vote, GET /biz/gdc-dao/proposals).
// 법적 검토(자금 이동·수익분배 없는 순수 거버넌스 참여로 한정 —
// src/gdc/dao.js 상단 활성화 배너 참고)에 따라 활성화. gdc-deposit류와
// 동일하게 L1(gdc_dao_proposals/gdc_dao_votes)을 유일한 저장소로 쓴다.
//
// 핵심 설계: 투표 시 stake_gdc를 클라이언트가 자기신고하지 않는다 —
// 서버가 GET /biz/balance(L1 실제 잔액 재생)로 직접 조회해서 채운다.
// (이전 세션에서 발견한 버그: 메모리 Map 버전의 vote()는 호출자가
// 주장하는 stakeGDC를 그대로 신뢰했음.)
// ═══════════════════════════════════════════════════════════
const GDC_DAO_MIN_STAKE = 1000;

async function handleGdcDaoProposalCreate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { proposer_guid, title, params, pubkey, signature, ts } = body;
  if (!proposer_guid) return _err(400, 'MISSING_FIELD', 'proposer_guid 필수', corsHeaders);
  if (!title)         return _err(400, 'MISSING_FIELD', 'title 필수', corsHeaders);
  if (params && params.type === 'OWNERSHIP_TRANSFER') {
    return _err(403, 'DAWN_VIOLATION', 'DAWN 원칙 위반: 통화 풀 소유권 이전 제안 불가', corsHeaders);
  }

  const authOk = await _verifyClaimsRequester(env, {
    guid: proposer_guid, pubkey, signature, ts,
    sigMsg: `gdc-dao-proposal:${proposer_guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  const proposalId = 'prop_' + (await _sha256Hex(`${proposer_guid}:${title}:${Date.now()}`)).slice(0, 16);
  const expiresAt = new Date(Date.now() + 30 * 86400 * 1000).toISOString();

  try {
    const res = await fetch(`${L1_DEFAULT}/api/collections/gdc_dao_proposals/records`, {
      method: 'POST', headers,
      body: JSON.stringify({
        proposal_id: proposalId, title, proposer_guid,
        params_json: JSON.stringify(params || {}), expires_at: expiresAt,
      }),
    });
    if (!res.ok) return _err(502, 'L1_WRITE_FAILED', await res.text(), corsHeaders);
    const row = await res.json().catch(() => null);
    return new Response(JSON.stringify({
      ok: true, proposal: { proposalId, title, proposerGuid: proposer_guid, expiresAt, id: row?.id },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 저장 실패: ' + e.message, corsHeaders);
  }
}

async function handleGdcDaoVote(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { proposal_id, user_guid, choice, pubkey, signature, ts } = body;
  if (!proposal_id) return _err(400, 'MISSING_FIELD', 'proposal_id 필수', corsHeaders);
  if (!user_guid)   return _err(400, 'MISSING_FIELD', 'user_guid 필수', corsHeaders);
  if (!['yes', 'no', 'abstain'].includes(choice)) return _err(400, 'INVALID_CHOICE', 'choice는 yes/no/abstain 중 하나여야 합니다', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid: user_guid, pubkey, signature, ts,
    sigMsg: `gdc-dao-vote:${user_guid}:${proposal_id}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

  // 제안 존재·만료 여부 확인
  let proposal;
  try {
    const filter = encodeURIComponent(`proposal_id='${proposal_id}'`);
    const pRes = await fetch(`${L1_DEFAULT}/api/collections/gdc_dao_proposals/records?filter=${filter}&perPage=1`, { headers });
    const pData = await pRes.json().catch(() => ({ items: [] }));
    proposal = pData.items?.[0];
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 제안 조회 실패: ' + e.message, corsHeaders);
  }
  if (!proposal) return _err(404, 'PROPOSAL_NOT_FOUND', '제안을 찾을 수 없습니다', corsHeaders);
  if (new Date(proposal.expires_at).getTime() < Date.now()) {
    return _err(409, 'PROPOSAL_EXPIRED', '투표 기간이 종료된 제안입니다', corsHeaders);
  }

  // ★ 핵심: stake_gdc는 클라이언트 자기신고를 신뢰하지 않는다 —
  // 서버가 L1 실제 잔액을 직접 재조회해서 채운다.
  let stakeGdc = 0;
  try {
    const balRes = await fetch(`${L1_DEFAULT}/api/balance?guid=${encodeURIComponent(user_guid)}`);
    const balData = await balRes.json().catch(() => ({ ok: false }));
    stakeGdc = balData.ok ? (balData.balance || 0) : 0;
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', '잔액 조회 실패: ' + e.message, corsHeaders);
  }
  if (stakeGdc < GDC_DAO_MIN_STAKE) {
    return _err(403, 'INSUFFICIENT_STAKE', `투표 최소 스테이킹 부족: ${stakeGdc} < ${GDC_DAO_MIN_STAKE} GDC`, corsHeaders);
  }

  // 중복 투표 방지 — unique index(proposal_id, user_guid)가 최종 방어선,
  // 여기선 사용자 친화적 에러 메시지를 위해 먼저 조회.
  try {
    const dupFilter = encodeURIComponent(`proposal_id='${proposal_id}' && user_guid='${user_guid}'`);
    const dupRes = await fetch(`${L1_DEFAULT}/api/collections/gdc_dao_votes/records?filter=${dupFilter}&perPage=1`, { headers });
    const dupData = await dupRes.json().catch(() => ({ items: [] }));
    if (dupData.items?.length) return _err(409, 'ALREADY_VOTED', '이미 투표했습니다', corsHeaders);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', '중복 투표 확인 실패: ' + e.message, corsHeaders);
  }

  try {
    const voteRes = await fetch(`${L1_DEFAULT}/api/collections/gdc_dao_votes/records`, {
      method: 'POST', headers,
      body: JSON.stringify({ proposal_id, user_guid, choice, stake_gdc: stakeGdc }),
    });
    if (!voteRes.ok) return _err(502, 'L1_WRITE_FAILED', await voteRes.text(), corsHeaders);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 투표 저장 실패: ' + e.message, corsHeaders);
  }

  const tally = await _gdcDaoTally(env, proposal_id, headers);
  return new Response(JSON.stringify({ ok: true, stake_gdc: stakeGdc, votes: tally }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

async function _gdcDaoTally(env, proposalId, headers) {
  const filter = encodeURIComponent(`proposal_id='${proposalId}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/gdc_dao_votes/records?filter=${filter}&perPage=200`, { headers });
  const data = await res.json().catch(() => ({ items: [] }));
  const tally = { yes: 0, no: 0, abstain: 0 };
  for (const v of (data.items || [])) {
    if (tally[v.choice] != null) tally[v.choice]++;
  }
  return tally;
}

async function handleGdcDaoProposalsList(request, env, corsHeaders) {
  const url = new URL(request.url);
  const proposalId = url.searchParams.get('proposal_id');
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20', 10) || 20, 100);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token };

  try {
    const filter = proposalId ? encodeURIComponent(`proposal_id='${proposalId}'`) : '';
    const listUrl = filter
      ? `${L1_DEFAULT}/api/collections/gdc_dao_proposals/records?filter=${filter}&sort=-created&perPage=${limit}`
      : `${L1_DEFAULT}/api/collections/gdc_dao_proposals/records?sort=-created&perPage=${limit}`;
    const res = await fetch(listUrl, { headers });
    const data = await res.json().catch(() => ({ items: [] }));

    const items = [];
    for (const p of (data.items || [])) {
      const votes = await _gdcDaoTally(env, p.proposal_id, headers);
      const expired = new Date(p.expires_at).getTime() < Date.now();
      const total = votes.yes + votes.no;
      const status = !expired ? 'ACTIVE' : (total > 0 && votes.yes > votes.no ? 'PASSED' : 'REJECTED');
      items.push({
        proposalId: p.proposal_id, title: p.title, proposerGuid: p.proposer_guid,
        params: JSON.parse(p.params_json || '{}'), expiresAt: p.expires_at,
        votes, status,
      });
    }
    return new Response(JSON.stringify({ ok: true, items }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders);
  }
}

// GET /admin/tx-recent?token=&limit= — 관리자 전용 전체 최근 거래 목록.
// (2026-07-15 신설 — gdc.hondi.net dashboard.html의 Supabase fs_ledger
//  전체조회를 대체. handleTxHistory와 달리 guid 필터 없이 최근 blocks를
//  그대로 가져온다 — 관리자가 "전체 흐름"을 보는 용도라 개인정보
//  노출 범위가 넓으므로 admin token 필수.)
async function handleAdminTxRecent(request, env, corsHeaders) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return _err(401, 'MISSING_TOKEN', '', corsHeaders);
  const isValid = await _verifyAdminToken(env, token);
  if (!isValid) return _err(403, 'INVALID_TOKEN', '', corsHeaders);

  const limit = Math.min(parseInt(url.searchParams.get('limit') || '15', 10) || 15, 100);
  const l1Token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + l1Token };

  try {
    const res = await fetch(
      `${L1_DEFAULT}/api/collections/blocks/records?filter=${encodeURIComponent("block_type != ''")}&sort=-created&perPage=${limit}`,
      { headers }
    );
    const data = await res.json().catch(() => ({ items: [] }));
    const items = [];
    for (const b of (data.items || [])) {
      let outputs; try { outputs = JSON.parse(b.outputs || '[]'); } catch { continue; }
      for (const o of outputs) {
        items.push({
          tx_id: b.tx_hash, guid: b.buyer_guid, counterpart: o.recipient_guid,
          direction: 'debit', amount: o.amount || 0,
          fs_account: b.block_type, tx_at: b.created,
        });
      }
    }
    items.sort((a, c) => new Date(c.tx_at) - new Date(a.tx_at));
    return new Response(JSON.stringify({ ok: true, items: items.slice(0, limit) }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders);
  }
}

// ── GET /biz/balance?guid=... — 재대사(reconcile) 지원 ────────────
// 2026-07-07 신설. 클라이언트(gopang-wallet.js) 로컬 IndexedDB가 서버
// 원장과 어긋났을 때(새 기기, 스토리지 초기화 등) 복구용으로 L1의
// /api/balance를 그대로 프록시한다 — 이 리포의 다른 모든 L1 접근과
// 마찬가지로 클라이언트는 L1을 직접 부르지 않고 Worker를 거친다.
async function handleBizBalance(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 쿼리 파라미터 필수', corsHeaders);

  try {
    const res  = await fetch(`${L1_DEFAULT}/api/balance?guid=${encodeURIComponent(guid)}`);
    const data = await res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
    if (!data.ok) return _err(502, data.error || 'L1_ERROR', data.detail || 'L1 잔액 조회 실패', corsHeaders);
    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

// ── GET /biz/supply — GDC 발행 총량 보존 검증 프록시 ──────────────
// 2026-07-07 신설. L1의 /api/supply/verify를 그대로 프록시한다 —
// 발행 총량(mint 누적) == 이 L1에 등장한 모든 guid 잔액 합, 이 두 값이
// 항상 같아야 한다는 불변식을 확인한다. verify=0 쿼리로 가벼운 총량만
// 조회할 수도 있다(대시보드 등 자주 호출하는 곳용).
async function handleBizSupply(request, env, corsHeaders) {
  const url = new URL(request.url);
  const verifyOnly = url.searchParams.get('verify') !== '0';
  const path = verifyOnly ? '/api/supply/verify' : '/api/supply';

  try {
    const res  = await fetch(`${L1_DEFAULT}${path}`);
    const data = await res.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
    if (!data.ok) return _err(502, data.error || 'L1_ERROR', data.detail || 'L1 총량 조회 실패', corsHeaders);
    if (verifyOnly && !data.valid) {
      console.error('[Supply] 보존 검증 실패!', JSON.stringify({ minted: data.total_minted, balance: data.total_balance, diff: data.diff }));
    }
    return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// GDC 충전 파이프라인 — "고정계좌 + 입금자명 매칭" (2026-07-14 신설,
// 2026-07-14 재적용: 낡은 로컬 clone 위에서 작업해 첫 배포 시 유실됨 —
// 이번엔 origin/main 최신 HEAD(ede6c2d) 위에서 다시 붙였다.)
//
// PG·카드는 배제하고 계좌 입금만 쓴다(사고실험 세션 "혼디의 GDC 환전
// 및 판매 체계 설계" 2026-07-14 확정 — GDC↔KRW 환전은 "환급"으로
// 재정의, 충전은 계좌입금 전용). 은행 API(가상계좌) 없이 지금 코드
// 만으로 구현 가능한 옵션 B(고정계좌 + 입금자명 매칭)를 택했다:
//
//   1. 사용자가 /biz/charge-request로 "N원 충전할게요" 신청
//      → 서버가 짧은 매칭 코드(HDxxxxxx) 발급, charge_requests에
//        status="pending"으로 기록
//   2. 사용자가 회사 고정계좌로 직접 이체하면서, "보내는 분 표시"에
//      그 매칭 코드를 포함시킨다(예: "혼디HD482910")
//   3. 관리자(주피터)가 은행 앱에서 입금 내역을 직접 눈으로 확인하고,
//      /biz/charge-confirm으로 그 신청을 확정
//   4. 확정 즉시 L1 /api/mint 호출 → GDC 발행, charge_requests를
//      status="matched"로 갱신
//
// 이 방식의 본질적 한계: 자동화된 은행 API 대사가 없으므로 "확정"은
// 사람(관리자)의 판단에 의존한다 — 관리자 1인 체제인 지금 규모에서는
// 감당 가능한 수동 절차이고, PG 없이 지금 당장 동작하는 걸 우선한
// 트레이드오프다(가상계좌 자동화는 은행 API 계약이 필요해 별도 TODO).
// ═══════════════════════════════════════════════════════════

const CHARGE_MIN_KRW = 1000;    // 너무 작은 신청은 매칭 단서(코드)만으로 은행 명세서 대조가 더 번거로워짐
const CHARGE_EXPIRE_HOURS = 48; // 이 시간 안에 입금 안 되면 UI/관리자 화면에서 만료로 표시(레코드 자체는 감사 보존을 위해 삭제하지 않음)

// POST /biz/charge-request — 사용자가 충전 의사를 밝히고 매칭 코드를 발급받는다.
async function handleChargeRequest(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, krw_amount } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  const krwAmount = Number(krw_amount);
  if (!(krwAmount >= CHARGE_MIN_KRW)) {
    return _err(400, 'INVALID_AMOUNT', `최소 충전 금액은 ${CHARGE_MIN_KRW}원입니다`, corsHeaders);
  }

  const matchCode = _generateChargeMatchCode();
  const expiresAt = new Date(Date.now() + CHARGE_EXPIRE_HOURS * 3600 * 1000).toISOString();

  try {
    const token = await _l1AdminToken(env);
    const res = await fetch(`${L1_DEFAULT}/api/collections/charge_requests/records`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid, match_code: matchCode, requested_krw: krwAmount,
        status: 'pending', expires_at: expiresAt,
      }),
    });
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.id) {
      const errText = JSON.stringify(data || {});
      console.warn('[ChargeRequest] 생성 실패:', errText);
      return _err(502, 'L1_ERROR', '충전 신청 기록 실패: ' + errText.slice(0, 200), corsHeaders);
    }
    return new Response(JSON.stringify({
      ok: true,
      request_id: data.id,
      match_code: matchCode,
      requested_krw: krwAmount,
      bank_account_info: _chargeBankAccountInfo(env),
      expires_at: expiresAt,
      guide: `위 계좌로 ${krwAmount.toLocaleString('ko-KR')}원을 입금하시되, "보내는 분 표시"에 ${matchCode} 코드를 반드시 포함해 주세요(예: 홍길동${matchCode}). 관리자가 입금을 확인하면 자동으로 GDC가 지급됩니다.`,
    }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

// GET /biz/charge-status?guid=...&request_id=... — 사용자가 본인 신청 상태를 폴링.
// request_id 없이 guid만 주면 최근 신청 목록을 최신순으로 반환한다.
async function handleChargeStatus(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  const requestId = url.searchParams.get('request_id');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  try {
    const token = await _l1AdminToken(env);
    const headers = { 'Authorization': `Bearer ${token}` };
    if (requestId) {
      const res = await fetch(`${L1_DEFAULT}/api/collections/charge_requests/records/${requestId}`, { headers });
      if (!res.ok) return _err(404, 'NOT_FOUND', '신청 내역을 찾을 수 없습니다', corsHeaders);
      const rec = await res.json();
      if (rec.guid !== guid) return _err(403, 'FORBIDDEN', '본인 신청이 아닙니다', corsHeaders);
      return new Response(JSON.stringify({ ok: true, request: rec }), { status: 200, headers: corsHeaders });
    }
    const filter = encodeURIComponent(`guid='${guid}'`);
    const res = await fetch(`${L1_DEFAULT}/api/collections/charge_requests/records?filter=${filter}&sort=-created&perPage=20`, { headers });
    if (!res.ok) return _err(502, 'L1_ERROR', '신청 목록 조회 실패', corsHeaders);
    const data = await res.json().catch(() => ({ items: [] }));
    return new Response(JSON.stringify({ ok: true, requests: data.items || [] }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

// GET /biz/charge-list?secret=...&status=pending — 관리자 전용. 은행 앱과
// 대조할 대기 목록을 보여준다.
async function handleChargeList(request, env, corsHeaders) {
  const url = new URL(request.url);
  if (url.searchParams.get('secret') !== _adminActionSecret(env)) {
    return _err(403, 'FORBIDDEN', '시크릿이 일치하지 않습니다', corsHeaders);
  }
  const status = url.searchParams.get('status') || 'pending';
  try {
    const token = await _l1AdminToken(env);
    const headers = { 'Authorization': `Bearer ${token}` };
    const filter = encodeURIComponent(`status='${status}'`);
    const res = await fetch(`${L1_DEFAULT}/api/collections/charge_requests/records?filter=${filter}&sort=-created&perPage=200`, { headers });
    if (!res.ok) return _err(502, 'L1_ERROR', '목록 조회 실패', corsHeaders);
    const data = await res.json().catch(() => ({ items: [] }));
    return new Response(JSON.stringify({ ok: true, requests: data.items || [] }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

// POST /biz/charge-confirm — 관리자 전용. 은행 명세서에서 입금을 직접
// 확인한 뒤 호출 → GDC 발행(L1 /api/mint) + charge_requests 확정 갱신.
async function handleChargeConfirm(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { secret, request_id, matched_krw, depositor_name, memo } = body;
  if (secret !== _adminActionSecret(env)) return _err(403, 'FORBIDDEN', '시크릿이 일치하지 않습니다', corsHeaders);
  if (!request_id) return _err(400, 'MISSING_FIELD', 'request_id 필수', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 멱등성/이중 확정 방지: 이미 matched면 재차감하지 않는다.
  const getRes = await fetch(`${L1_DEFAULT}/api/collections/charge_requests/records/${request_id}`, { headers });
  if (!getRes.ok) return _err(404, 'NOT_FOUND', '신청 내역을 찾을 수 없습니다', corsHeaders);
  const rec = await getRes.json();
  if (rec.status === 'matched') {
    return new Response(JSON.stringify({ ok: true, already_matched: true, mint_content_hash: rec.mint_content_hash }), { status: 200, headers: corsHeaders });
  }
  if (rec.status !== 'pending') {
    return _err(409, 'INVALID_STATUS', `이 신청은 이미 ${rec.status} 상태입니다`, corsHeaders);
  }

  const krwAmount = Number(matched_krw) > 0 ? Number(matched_krw) : rec.requested_krw;

  let mintData;
  try {
    const mintRes = await fetch(`${L1_DEFAULT}/api/mint`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid: rec.guid, krw_amount: krwAmount, secret: _mintSecret(env),
        memo: `charge_request:${request_id}${depositor_name ? ' / 입금자:' + depositor_name : ''}${memo ? ' / ' + memo : ''}`,
      }),
    });
    mintData = await mintRes.json().catch(() => ({ ok: false, error: 'L1_PARSE_FAILED' }));
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'GDC 발행 실패: ' + e.message, corsHeaders);
  }
  if (!mintData.ok) {
    console.warn('[ChargeConfirm] mint 실패:', JSON.stringify(mintData));
    return _err(502, mintData.error || 'MINT_FAILED', mintData.detail || 'GDC 발행 실패', corsHeaders);
  }

  const patchRes = await fetch(`${L1_DEFAULT}/api/collections/charge_requests/records/${request_id}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({
      status: 'matched', matched_krw: krwAmount,
      depositor_name: depositor_name || '', memo: memo || '',
      mint_content_hash: mintData.content_hash, matched_at: new Date().toISOString(),
    }),
  });
  if (!patchRes.ok) {
    // GDC는 이미 발행됐는데 상태 갱신만 실패한 경우 — 발행 자체는 되돌릴 수
    // 없으므로(멱등 처리 없음), 크게 로그를 남겨 수동 정정이 필요함을 표시.
    console.error(JSON.stringify({ tag: 'CHARGE_CONFIRM_PATCH_FAILED_AFTER_MINT', request_id, mint_content_hash: mintData.content_hash, guid: rec.guid, krwAmount, ts: new Date().toISOString() }));
  }

  console.log(JSON.stringify({ tag: 'CHARGE_CONFIRM_OK', request_id, guid: rec.guid, krwAmount, contentHash: mintData.content_hash, ts: new Date().toISOString() }));
  return new Response(JSON.stringify({
    ok: true, guid: rec.guid, charged_krw: krwAmount,
    gdc_amount: mintData.amount, mint_content_hash: mintData.content_hash,
  }), { status: 200, headers: corsHeaders });
}

// ── POST /gwp/register-key — 가입 시점 지갑 공개키 등록 ─────────────
// 2026-07-07 신설. 지금까지 GopangWallet이 로컬에서 Ed25519 키페어를
// 자동 생성하긴 했지만, 그 공개키를 L1의 gdc_keys 컬렉션에 등록하는
// 코드가 어디에도 없었다 — 즉 신규 가입자의 첫 실거래가 L1의 2단계
// (공개키 확인)에서 무조건 UNREGISTERED_KEY(403)로 막히는 상태였다.
//
// TOFU(Trust On First Use) 방식: guid+timestamp를 그 공개키에 대응하는
// 개인키로 서명하게 해서, "이 공개키를 실제로 갖고 있다"는 걸 증명한
// 뒤에만 등록한다 — 서명 없이 아무 공개키나 등록 요청할 수 있으면 안
// 되기 때문이다. 이미 등록된 guid면(기기 교체 등) 갱신(PATCH)한다.
async function handleRegisterKey(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, public_key, signature, ts, home_l1 } = body;
  if (!guid)       return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!public_key) return _err(400, 'MISSING_FIELD', 'public_key 필수', corsHeaders);
  if (!signature)  return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!ts)         return _err(400, 'MISSING_FIELD', 'ts 필수', corsHeaders);

  const sigMsg = `register-key:${guid}:${ts}`;
  const sigOk  = await _verifyEd25519Simple(public_key, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패 — 이 공개키의 개인키로 서명한 게 맞는지 확인하세요', corsHeaders);

  // 2026-07-07 신설(제주 L1~L3 필드 테스트, §4): 클라이언트가 위치 기반으로
  // 확정한 읍면동 소속 L1 노드 ID(home_l1, 예: "KR-JEJU-JEJU-AEWOL")를
  // 받는다. 안 보내면(기존 클라이언트 하위호환) hanlim으로 폴백한다.
  const homeNodeId = (home_l1 && L1_NODE_MAP[home_l1]) ? home_l1 : 'KR-JEJU-JEJU-HANLIM';
  const homeBase    = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;

  try {
    const token  = await _l1AdminTokenFor(env, homeBase);
    const filter = encodeURIComponent(`guid='${guid}'`);
    const existingRes  = await fetch(`${homeBase}/api/collections/gdc_keys/records?filter=${filter}&perPage=1`,
      { headers: { 'Authorization': `Bearer ${token}` } });
    const existingData = await existingRes.json().catch(() => ({ items: [] }));
    const existing = existingData.items?.[0];

    if (existing) {
      // 2026-07-07 수정: 기존 공개키와 다른 값으로 덮어쓰는 걸 거부한다.
      // 이전엔 "제출한 공개키의 개인키를 갖고 있다"만 증명하면 통과했는데,
      // 이건 "이 guid의 원래 주인이다"를 증명하는 게 아니다 — guid만 알면
      // 누구나 새 키페어를 만들어 서명해서 등록을 가로챌 수 있었다.
      // 기기 교체 등 정당한 키 교체는 이미 검증된 별도 경로
      // (_restoreFromBackupKey — 백업 키로 복구)를 쓰게 한다. 같은 키로
      // 다시 등록 요청하는 건(멱등) 그대로 허용한다.
      if (existing.public_key !== public_key) {
        return _err(409, 'KEY_ALREADY_REGISTERED',
          '이 guid는 이미 다른 공개키로 등록돼 있습니다 — 기기 교체는 백업 키 복구 절차를 사용하세요', corsHeaders);
      }
      console.info('[RegisterKey] 이미 동일 키로 등록됨(멱등):', guid.slice(0, 20));
    } else {
      await fetch(`${homeBase}/api/collections/gdc_keys/records`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ guid, public_key, created_at: new Date().toISOString() }),
      });
      console.info('[RegisterKey] 신규 등록:', guid.slice(0, 20), '@', homeNodeId);
    }

    // §4 레지스트리 — 이 guid가 어느 L1 소속인지 L3에 기록(브릿지 거래 시
    // 상대방 소속 L1을 조회할 수 있어야 한다). 등록 실패해도 키 등록
    // 자체는 이미 끝났으므로 여기서 전체 요청을 실패시키지 않는다 —
    // 다만 로그는 크게 남겨 감사 가능하게 한다(_writeHomeL1Node 내부에서 처리).
    await _writeHomeL1Node(env, guid, homeNodeId);

    return new Response(JSON.stringify({ ok: true, guid, home_l1: homeNodeId }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 키 등록 실패: ' + e.message, corsHeaders);
  }
}

// ── STEP 09: PDV 기록 헬퍼 (동기 앵커링) ─────────────────
async function _recordOrderPdv(env, {
  from_guid, seller_guid, tx_hash, block_hash, block_id,
  session_id, item_name, total,
  importance_score = 0, importance_mode = 'LIGHTWEIGHT', lcat = 'B', risk_tier = 'low',
  consistency_check = null,
}) {
  // (2026-07-14: Supabase pdv_log → L1 pdv_records 이관. handlePdvReport와
  //  동일 관례 — pdv_records 스키마에 없는 필드(raw_hash·openhash_block_id·
  //  openhash_anchored_at·importance_score 등)는 summary_6w(JSON) 안에
  //  같이 보존한다.)
  const reportId = session_id || `RPT-kmarket-${Date.now()}`;
  const now      = new Date().toISOString();

  const summary6wFull = JSON.stringify({
    who:   `buyer(${from_guid.slice(0, 20)}...)`,
    when:  now,
    where: 'https://market.hondi.net',
    what:  `구매: ${item_name} ₮${total}`,
    how:   'Ed25519 서명 + L1 4단계 검증',
    why:   '상품 구매 거래',
    raw_hash:             tx_hash,
    openhash_block_id:    block_id,
    openhash_anchored_at: now,
    importance_score:     parseFloat(importance_score.toFixed(4)),
    importance_mode,
    lcat,
    risk_tier,
    consistency_check,
  });

  // risk_level: PDV 표준 필드. importance 기반으로 매핑
  const pdvRiskLevel = risk_tier === 'high' ? 'high'
                     : importance_mode === 'STANDARD' ? 'medium'
                     : 'low';

  try {
    const token = await _l1AdminToken(env);
    await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records`, {
      method:  'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        guid:              from_guid,
        report_id:         reportId,
        reporter_svc:      'hondi-proxy',
        svc:               'market',
        type:              'tx_2party',
        summary:           `구매: ${item_name} ₮${total}`,
        summary_6w:        summary6wFull,
        block_hash:        block_hash,
        risk_level:        pdvRiskLevel,
        source:            'market',
        openhash_anchored: true, // STEP 09: 동기 앵커링 — L1 응답 수신 즉시 true
        domain:            'personal',
        affiliation_org_id: null,
      }),
    });
  } catch (e) { console.warn('[PDV] 기록 실패:', e.message); }
}

// (2026-07-15 삭제 — handlePdvPage(/pdv/page/{identifier}), _generatePdvHtml.
//  라우트는 등록돼 있었지만 저장소 전체에서 이 경로를 fetch로 호출하는
//  클라이언트 코드가 없었다. 게다가 primary_guid/l1_node라는, 지금은
//  guid 하나로 단순화된 것으로 보이는 옛 다중엔티티 스키마 개념에
//  의존하고 있어 이미 개념적으로도 낡은 코드였다. Supabase user_profiles
//  의존이라 정리 대상 — 이관하지 않고 삭제.)

// ═══════════════════════════════════════════════════════════
// v4.7 — /search
// ═══════════════════════════════════════════════════════════
// 2026-07-05: SP-KMARKET RULE-02 [2-D]("품목 동의어 자동 확장")와 동일한
// 목록. 지금까지 이 확장은 AI([SEARCH] 태그를 낼 때 스스로 동의어를
// 떠올리는 것)에게만 맡겨져 있었다 — AI가 매번 동의어를 다 챙기지
// 못하면 검색이 조용히 좁아지는 위험이 있어, 서버 쪽에도 동일한
// 목록을 이중으로 걸어 최소 커버리지를 보장한다.
// ★ 유지보수 주의 ★ SP-KMARKET-v2_7.txt RULE-02 [2-D]를 고칠 때
// 이 목록도 같이 갱신할 것 — 현재 두 곳에 중복 관리됨(단일소스화는
// 추후 과제로 남김).
const PRODUCT_SEARCH_SYNONYMS = {
  '짜장면': ['자장면', '중식', '짜장'],
  '커피':   ['아메리카노', '라떼', '카페'],
  '치킨':   ['닭', '후라이드', '양념'],
  '흑돼지': ['삼겹살', '오겹살', '돼지고기'],
};

function _expandSearchTerms(keyword) {
  const terms = new Set([keyword]);
  for (const [key, syns] of Object.entries(PRODUCT_SEARCH_SYNONYMS)) {
    if (keyword.includes(key)) syns.forEach(s => terms.add(s));
    // 역방향(동의어로 검색했을 때 대표어·다른 동의어도 함께 포함)
    if (syns.some(s => keyword.includes(s))) { terms.add(key); syns.forEach(s => terms.add(s)); }
  }
  return [...terms];
}

// 2026-07-05: 상품명/설명/카테고리 자체로 검색 — search_entities(Supabase)는
// 엔티티 레벨(이름/태그/업종/주소)만 보므로, 판매자 태그에 없는 상품명으로
// 검색하면(예: 소개엔 "정육점"만 있고 상품명은 "이베리코 등심") 그 판매자
// 자체가 검색 결과에서 아예 빠지는 문제가 있었다. seller_products를
// 직접 훑어 매칭된 seller_guid를 찾아내고, 그 판매자의 엔티티 정보를
// L1에서 보강해 entity-level 검색 결과와 합친다.
async function _l1SearchProductsByKeyword(env, keyword, limit = 20) {
  if (!keyword) return [];
  const token = await _l1AdminToken(env);
  const terms = _expandSearchTerms(String(keyword));
  const orClauses = terms.flatMap(t => {
    const esc = t.replace(/'/g, "\\'");
    return [`name~'${esc}'`, `desc~'${esc}'`, `category~'${esc}'`];
  });
  const filter = encodeURIComponent(`is_public=true && (${orClauses.join(' || ')})`);
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/seller_products/records?filter=${filter}&perPage=${limit * 3}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error(`L1 상품검색 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  const items = data.items || [];

  // 관련도 랭킹: 원래 키워드(동의어 확장 전) 기준 — 상품명 완전일치 >
  // 상품명 부분일치 > 카테고리 일치 > 설명만 일치 순.
  const kw = String(keyword).trim();
  function score(p) {
    const name = String(p.name || '');
    if (name === kw) return 4;
    if (name.includes(kw)) return 3;
    if (String(p.category || '').includes(kw)) return 2;
    if (terms.some(t => name.includes(t))) return 2; // 동의어로 이름 매칭
    return 1; // desc만 매칭되거나 동의어로만 매칭
  }
  return items.sort((a, b) => score(b) - score(a)).slice(0, limit);
}

// ═══════════════════════════════════════════════════════════
// ★ 2026-07-12 — Supabase→L1 이관 완성 작업(2단계): search_entities
// (Supabase RPC, sql/search_index.sql)를 L1 PocketBase 기반으로
// 재구현. 완전히 동일하지는 않다 — 알려진 차이:
//   1. PostgreSQL tsvector 가중치 순위(A/B/C/D)를 정확히 재현하지
//      못한다. 대신 Worker에서 name/handle 매칭=3점, occupation
//      매칭=2점, address/search_text 매칭=1점으로 근사 채점한다.
//   2. entity_type의 institution/org/platform 서브타입 별칭
//      (extra.public.identity.entity_subtype)은 이번 1차 이관에서는
//      지원하지 않는다 — entity_type 필드 자체가 정확히 일치하는
//      경우만 매칭한다(알려진 한계, 필요시 후속 작업).
//   3. 거리 정렬(distance_km)은 Haversine 공식으로 Worker에서 직접
//      계산 — PocketBase는 지리공간 연산자가 없다.
// 여러 단어 검색어는 공백으로 나눠 AND 매칭한다(전부 포함해야 함) —
// websearch_to_tsquery의 OR 동작과는 다르다(더 엄격함, 알려진 차이).
// ═══════════════════════════════════════════════════════════
function _haversineKm(lat1, lng1, lat2, lng2) {
  if ([lat1, lng1, lat2, lng2].some(v => typeof v !== 'number' || Number.isNaN(v))) return null;
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// 2026-07-13 신설 — field_visibility 필터링 공용 헬퍼. 원래
// _l1SearchEntities 안에 인라인으로만 있었는데, handleProfileGet(직접
// 조회)에도 똑같이 적용해야 해서 모듈 스코프로 끌어올렸다 — 두 곳에서
// 필터링 기준이 어긋나는(하나는 고치고 하나는 깜빡하는) 사고를 막는다.
function _isFieldVisible(fv, field) {
  const DEFAULT_PUBLIC_FIELDS = new Set(['products']);
  if (fv && typeof fv[field] === 'boolean') return fv[field];
  return DEFAULT_PUBLIC_FIELDS.has(field);
}

function _filterProfileByVisibility({ address, phone, website, extra }) {
  const fv = extra?.public?.field_visibility || {};
  const identity = extra?.public?.identity || {};
  // 2026-07-14 신설 — 구멍 G 해결(AC_SELF_EVOLUTION_THOUGHT_EXPERIMENT_
  // v2_0.md). 이 함수가 description/location/contact/products는 거르면서
  // job_ksco·affiliation·work_domain은 아예 손대지 않고 있었다 — 즉
  // job_ksco.visibility='private'로 저장해도 실제로는 타인 조회 시
  // 그대로 다 보였다(코드 재확인으로 실제 결함 확정, "확인 필요"가
  // 아니라 "결함 확인됨"으로 격상). 이 블록이 이미 한 번(1c891de) 회귀,
  // 이번(a20461b)이 두 번째 회귀 — 복구.
  //
  // job_ksco는 자체 3단계 visibility(private/contacts/public)가 있다 —
  // 다만 "contacts"(지인) 등급을 판별할 관계 데이터가 이 시스템에
  // 없으므로, 지금은 owner가 아니면 public일 때만 노출하고 나머지는
  // 전부 가린다(private와 동일 취급 — 과다노출보다 과소노출이 안전).
  const jobKscoVisible = identity.job_ksco?.visibility === 'public';
  // affiliation·work_domain은 자체 visibility 필드가 없다 — 기존
  // description과 동일하게 boolean field_visibility로 다룬다. 기본값은
  // false(비공개) — is_public 기본 false, job_ksco 기본 private와
  // 동일한 "기본 비공개" 원칙(AC-AUTHOR §6·AC-EVOLUTION §6 근거).
  const affiliationVisible = fv.affiliation === true;
  const workDomainVisible = fv.work_domain === true;

  // 2026-07-17 신설 — 결함 3건 추가 발견·수정(세 번째 회귀 계열).
  // 이 함수가 여전히 extra.public 최상위 키를 손으로 하나씩 나열하는
  // 방식이었다: activity(hours)는 VISIBILITY_FIELDS 목록엔 있었는데
  // 정작 이 함수가 한 번도 손대지 않아 무조건 노출, finance(정산 계좌
  // payout_account 포함!)와 industry_fields는 애초에 목록에도 없어서
  // 역시 무조건 노출 — 이런 식으로 필드를 나열하는 방식 자체가
  // "새 필드가 생길 때마다 여기 코드를 patch해야 한다"는 구조라, PA가
  // 자연어 대화로 새 구조화 슬롯을 만들 때마다(§TEMPLATE-REFERENCE
  // 커스터마이징 등) 또 빠뜨릴 게 뻔하다 — SP-19가 겪은 것과 같은
  // "고정 enum을 계속 patch" 함정. 아래로 대체: location/contact/
  // identity/products처럼 세부 필드 단위 통제가 필요한 것만 개별
  // 처리하고, 나머지 최상위 키(activity·finance·industry_fields·향후
  // 신설될 무엇이든)는 제네릭하게 훑어 field_visibility에 명시적
  // true가 없으면 기본 비공개 — 코드 수정 없이 미래 필드까지 커버.
  const HANDLED_TOP_KEYS = new Set(['location', 'contact', 'identity', 'products', 'field_visibility']);
  const genericFiltered = {};
  for (const [key, value] of Object.entries(extra?.public || {})) {
    if (HANDLED_TOP_KEYS.has(key)) continue;
    genericFiltered[key] = _isFieldVisible(fv, key) ? value : undefined;
  }

  const filteredExtra = extra ? {
    ...extra,
    public: extra.public ? {
      ...genericFiltered,
      location: _isFieldVisible(fv, 'address') ? extra.public.location
        : { ...extra.public.location, address_short: undefined, directions: undefined },
      contact: _isFieldVisible(fv, 'phone') ? extra.public.contact
        : { ...extra.public.contact, phone_display: undefined },
      identity: {
        ...(_isFieldVisible(fv, 'description') ? identity : { ...identity, description: undefined }),
        job_ksco: jobKscoVisible ? identity.job_ksco : undefined,
        affiliation: affiliationVisible ? identity.affiliation : undefined,
        work_domain: workDomainVisible ? identity.work_domain : undefined,
      },
      products: _isFieldVisible(fv, 'products') ? extra.public.products : undefined,
    } : extra.public,
  } : extra;
  return {
    address: _isFieldVisible(fv, 'address') ? address : null,
    phone: _isFieldVisible(fv, 'phone') ? phone : null,
    website: _isFieldVisible(fv, 'website') ? website : null,
    extra: filteredExtra,
  };
}

// 2026-07-13 신설 — GET /profile 뷰어(요청자) 인증. 지금까지 이
// 엔드포인트는 요청자가 누구든 원본 전체를 그대로 돌려주고 있었다
// (실사로 발견 — field_visibility·phone_visible 어느 쪽도 서버 응답
// 자체는 걸러진 적이 없었음). 서명 기반으로 "본인이 자기 프로필을
// 보는 경우"만 가려내 그때만 필터링을 건너뛴다 — POST /profile과
// 동일한 TOFU 원칙(등록된 pubkey와 일치해야 함)을 재사용.
// 2026-07-13 신설 — /biz/claims 요청자 인증 공용 헬퍼. handleClaimsList/
// handleClaimsAck가 지금까지 guid를 자기주장으로만 받고 있었다(사고실험
// 발견 — 공개 정보인 guid만 알면 누구든 남의 미청구 claim을 조회하거나
// "수령 완료"로 표시해 실제 소유자가 영영 못 받게 만들 수 있었다).
// _isAuthenticatedOwnerRequest와 동일한 서명+TOFU 원칙을 재사용하되,
// sigMsg를 호출부가 지정하게 해 GET 조회와 POST 확인(claim_ids 바인딩
// 필요)에서 다른 문구를 쓸 수 있게 한다.
// (2026-07-14 추가 — ts 신선도 검증. 위 _isFreshTs 주석 참고: 서명은
// 검증하면서 ts가 오래됐는지는 확인하지 않아, 캡처된 서명을 무기한
// replay할 수 있는 상태였다. ts를 별도 파라미터로 받아 확인한다 —
// sigMsg 문자열 안에서 ts를 다시 파싱해내는 것보다 호출부가 이미 갖고
// 있는 값을 그대로 넘기는 편이 형식 의존성이 없어 더 안전하다.)
async function _verifyClaimsRequester(env, { guid, pubkey, signature, sigMsg, ts }) {
  if (!guid || !pubkey || !signature) return false;
  if (!_isFreshTs(ts)) return false;
  const sigOk = await _verifyEd25519Simple(pubkey, signature, sigMsg).catch(() => false);
  if (!sigOk) return false;
  const profile = await _l1FindProfileByGuid(env, guid).catch(() => null);
  if (!profile?.pubkey_ed25519 || profile.pubkey_ed25519 !== pubkey) return false;
  return true;
}

async function _isAuthenticatedOwnerRequest(env, targetGuid, url) {
  const viewerGuid   = url.searchParams.get('viewer_guid');
  const viewerPubkey = url.searchParams.get('viewer_pubkey');
  const viewerSig    = url.searchParams.get('viewer_sig');
  const viewerTs     = url.searchParams.get('viewer_ts') || '';
  if (!viewerGuid || !viewerPubkey || !viewerSig) return false;
  if (viewerGuid !== targetGuid) return false; // 본인 프로필 조회만 인증 대상 — 타인 것엔 의미 없음
  // (2026-07-14 추가 — ts 신선도 검증. _isFreshTs 주석 참고: profile.html은
  // 밀리초, call-ai.js는 초 단위로 ts를 보내므로 자동 판별 헬퍼를 쓴다.)
  if (!_isFreshTs(viewerTs)) return false;

  const sigMsg = `view:${viewerGuid}:${viewerPubkey}:${viewerTs}`;
  const sigOk = await _verifyEd25519Simple(viewerPubkey, viewerSig, sigMsg).catch(() => false);
  if (!sigOk) return false;

  // TOFU 확인 — 서명이 유효해도 그 pubkey가 실제로 이 guid 소유자로
  // 등록된 키와 일치해야 한다(임의의 키페어로 아무 guid나 사칭 방지).
  const viewerProfile = await _l1FindProfileByGuid(env, viewerGuid).catch(() => null);
  if (!viewerProfile?.pubkey_ed25519 || viewerProfile.pubkey_ed25519 !== viewerPubkey) return false;

  return true;
}

async function _l1SearchEntities(env, { q, etype, occupation, address, lat, lng, lim = 20, ofst = 0 }) {
  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}` };

  const words = (q || '').trim().split(/\s+/).filter(Boolean);
  const filterParts = ['is_public = true'];
  if (etype) filterParts.push(`entity_type = ${JSON.stringify(etype)}`);
  if (occupation) filterParts.push(`occupation ~ ${JSON.stringify(occupation)}`);
  if (address) filterParts.push(`address ~ ${JSON.stringify(address)}`);
  for (const w of words) {
    const wj = JSON.stringify(w);
    filterParts.push(
      `(name ~ ${wj} || handle ~ ${wj} || occupation ~ ${wj} || address ~ ${wj} || search_text ~ ${wj})`
    );
  }
  const filter = filterParts.join(' && ');

  // rank/거리로 재정렬해야 하므로, 요청한 limit보다 넉넉히 가져온 뒤
  // Worker에서 정렬·페이징한다(최대 200 — 폭주 방지).
  const fetchCount = Math.min(Math.max((lim + ofst) * 3, 60), 200);
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/profiles/records?filter=${encodeURIComponent(filter)}&perPage=${fetchCount}&sort=-updated`,
    { headers }
  );
  if (!res.ok) throw new Error(`L1 검색 실패 (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
  const data = await res.json().catch(() => ({ items: [] }));

  const qLower = (q || '').toLowerCase();
  // 2026-07-13 신설 — field_visibility 서버측 필터링(공용 헬퍼 재사용,
  // _filterProfileByVisibility/_isFieldVisible 정의부 참조). 지금까지
  // 서버가 원본 전체를 그대로 내려주고 있었다(실사로 발견).
  const scored = (data.items || []).map(p => {
    let rank = 1.0;
    if (qLower) {
      rank = 0;
      if ((p.name || '').toLowerCase().includes(qLower) || (p.handle || '').toLowerCase().includes(qLower)) rank += 3;
      if ((p.occupation || '').toLowerCase().includes(qLower)) rank += 2;
      if ((p.address || '').toLowerCase().includes(qLower) || (p.search_text || '').toLowerCase().includes(qLower)) rank += 1;
      if (rank === 0) rank = 0.5; // 단어별 매칭은 됐지만 원문 전체는 안 겹치는 경우(AND 필터를 통과했으므로 최소 점수는 준다)
    }
    const distance_km = _haversineKm(lat, lng, p.lat, p.lng);
    const filtered = _filterProfileByVisibility({
      address: p.address,
      phone: p.extra?.core?.phone ?? null,
      website: p.extra?.core?.website ?? null,
      extra: p.extra,
    });
    return {
      guid: p.guid, name: p.name, handle: p.handle, entity_type: p.entity_type,
      address: filtered.address, phone: filtered.phone, website: filtered.website,
      extra: filtered.extra,
      primary_guid: p.guid, occupation: p.occupation,
      rank, distance_km,
    };
  });

  scored.sort((a, b) => {
    if (b.rank !== a.rank) return b.rank - a.rank;
    if (a.distance_km != null && b.distance_km != null) return a.distance_km - b.distance_km;
    if (a.distance_km != null) return -1;
    if (b.distance_km != null) return 1;
    return 0;
  });

  return scored.slice(ofst, ofst + lim);
}

async function handleSearch(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const keyword = body.p_keyword || body.q || null;

  // ★ 2026-07-12 — Supabase→L1 이관 완성(3단계). 이전엔 Supabase RPC
  // search_entities를 호출했으나, 이제 L1 PocketBase 기반
  // _l1SearchEntities로 대체한다(위 함수 정의부 주석에 알려진 차이점
  // 명시). 파라미터 정규화(p_* 별칭 허용)는 기존 클라이언트 호환을
  // 위해 그대로 유지.
  // 2026-07-13 신설 — schema_id(KSIC 코드) alias. occupation 필드는
  // profiles 테이블에 KSIC_LABELS 라벨 텍스트(예: "음식점업")로 저장돼
  // 있어 코드 숫자로는 매칭이 안 된다 — profile-assistant의 업종 템플릿
  // 조회([INDUSTRY_TEMPLATE_LOOKUP])가 schema_id만 들고 있어도 여기서
  // 라벨로 변환해준다.
  const resolvedOccupationFromSchema = body.schema_id
    ? (KSIC_LABELS[String(body.schema_id)] || null) : null;

  const searchParams = {
    q:          keyword,
    etype:      body.p_entity_type || body.entity_type || null,
    occupation: body.p_occupation  || body.occupation  || resolvedOccupationFromSchema || null,
    address:    body.p_address     || body.address     || null,
    lat:        body.p_lat         || body.lat         || null,
    lng:        body.p_lng         || body.lng         || null,
    lim:        body.p_limit       || body.limit       || body.lim || 20,
    ofst:       body.p_offset      || body.offset      || body.ofst || 0,
  };

  let data;
  try {
    data = await _l1SearchEntities(env, searchParams);
  } catch (e) {
    return _err(502, 'L1_SEARCH_FAILED', 'L1 검색 실패: ' + e.message, corsHeaders);
  }

  // 2026-07-05: L1 seller_products를 join(엔티티 레벨 매칭 결과 보강)하고,
  // 상품명/설명/카테고리로만 매칭되는(엔티티 검색으론 못 찾는) 판매자를
  // 추가로 찾아 결과에 합친다.
  const byGuid = new Map(data.filter(e => e?.primary_guid).map(e => [e.primary_guid, e]));

  await Promise.all(data.map(async (entity) => {
    if (!entity?.primary_guid) return;
    try {
      entity.products = await _l1ListSellerProducts(env, entity.primary_guid)
        .then(list => list.filter(p => p.is_public !== false).slice(0, 10));
    } catch (e) {
      entity.products = [];
    }
  }));

  if (keyword) {
    try {
      const productMatches = await _l1SearchProductsByKeyword(env, keyword, searchParams.lim);
      const newGuids = [...new Set(productMatches.map(p => p.seller_guid))].filter(g => !byGuid.has(g));

      await Promise.all(newGuids.map(async (guid) => {
        try {
          const profile = await _l1FindProfileByGuid(env, guid);
          if (!profile || profile.is_public === false) return;
          const entity = {
            primary_guid: guid,
            name: profile.name,
            entity_type: profile.entity_type,
            occupation: profile.occupation ?? profile.extra?.core?.occupation ?? null,
            address: profile.address ?? profile.extra?.core?.address ?? null,
            matched_via: 'product', // entity-level 필드가 아니라 상품으로 매칭됐음을 표시
            products: productMatches.filter(p => p.seller_guid === guid).slice(0, 10),
          };
          data.push(entity);
          byGuid.set(guid, entity);
        } catch (e) {
          console.warn('[Search] product-match 판매자 프로필 조회 실패(무시):', e.message);
        }
      }));
    } catch (e) {
      console.warn('[Search] 상품 레벨 검색 실패(엔티티 검색 결과는 정상 반환):', e.message);
    }
  }

  return new Response(JSON.stringify(data), { status: 200, headers: corsHeaders });
}

// ── 정체성 템플릿 참조 조회 (2026-07-17 신설) ──────────────────────────
// [§INDUSTRY-TEMPLATE](profile-assistant SP v2.3)가 "schema_id 확정 시
// 동종업계 공개 프로필 최대 8건을 참조한다"고 설계했으나, 이 서버 핸들러가
// 없어 실제로는 한 번도 응답이 간 적이 없었다(실사 발견 — call-ai.js에도
// 대응 코드 없음, 같은 조사 세션에서 함께 확인). 이번에 개인(job_ksco/
// work_domain) 축까지 함께 지원하도록 일반화해 신설한다.
//
// 설계 원칙(docs/ksco_schema_tier_classification_v1.md·
// ksic_schema_tier_classification_v1.md, 2026-07-13 주피터님 승인 —
// AC-EVOLUTION §5 유지): KSIC/KSCO 코드 자체(코드→명칭)는 정적 참조
// 데이터로만 쓰고, 템플릿 "내용"은 그 코드로 이미 등록된 실사용자
// 프로필에서 매번 동적으로 조합한다 — 직종/업종별 정적 템플릿 파일을
// 새로 만들지 않는다는 기존 결정과 배치되지 않는다.
async function _l1FindTemplateReferenceProfiles(env, { entity_type, schema_id, job_ksco_code, work_domain_statuses, exclude_guid }, limit = 8) {
  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}` };

  const filterParts = ['is_public = true'];
  if (entity_type) filterParts.push(`entity_type = ${JSON.stringify(entity_type)}`);
  if (schema_id) {
    // 사업자 — KSIC 코드는 industry_fields.schema_id에 JSON으로 저장돼
    // 있어 PocketBase 텍스트 필터로 부분일치 조회(코드 값 자체가
    // 문자열이라 정확도는 충분 — 오탐 시 아래에서 한 번 더 정확 비교).
    filterParts.push(`extra ~ ${JSON.stringify(`"schema_id":"${schema_id}"`)}`);
  }
  if (job_ksco_code) {
    filterParts.push(`extra ~ ${JSON.stringify(`"code":"${job_ksco_code}"`)}`);
  }
  if (exclude_guid) filterParts.push(`guid != ${JSON.stringify(exclude_guid)}`);
  const filter = filterParts.join(' && ');

  // work_domain.statuses는 배열이라 텍스트 부분일치로 걸러낼 수 없으므로
  // 넉넉히 가져온 뒤 Worker에서 정확히 필터링한다(최대 60건 스캔 후 8건 샘플).
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/profiles/records?filter=${encodeURIComponent(filter)}&perPage=60&sort=-updated`,
    { headers }
  );
  if (!res.ok) throw new Error(`L1 템플릿 참조 조회 실패 (HTTP ${res.status}): ${await res.text().catch(() => '')}`);
  const data = await res.json().catch(() => ({ items: [] }));

  let items = data.items || [];
  if (job_ksco_code) {
    // 텍스트 부분일치로 넉넉히 받은 뒤 정확한 코드 일치만 남긴다.
    items = items.filter(p => (p.extra?.public?.identity?.job_ksco?.code) === job_ksco_code);
  }
  if (schema_id) {
    items = items.filter(p => String(p.extra?.public?.industry_fields?.schema_id ?? p.extra?.industry_fields?.schema_id ?? '') === String(schema_id));
  }
  if (Array.isArray(work_domain_statuses) && work_domain_statuses.length > 0) {
    items = items.filter(p => {
      const s = p.extra?.public?.identity?.work_domain?.statuses
        || (p.extra?.public?.identity?.work_domain?.status ? [p.extra.public.identity.work_domain.status] : []);
      return work_domain_statuses.some(want => s.includes(want));
    });
  }

  // 필드별 공개/비공개(field_visibility)를 이미 만족하는 값만 노출 —
  // _l1SearchEntities와 동일 원칙, 프로필 원본을 그대로 흘려보내지 않는다.
  const refs = items.slice(0, limit).map(p => {
    const pub = p.extra?.public || {};
    const fv = pub.field_visibility || {};
    return {
      entity_subtype: pub.identity?.entity_subtype ?? null,
      description:    fv.description ? pub.identity?.description ?? null : undefined,
      hours:          fv.hours ? pub.activity?.hours ?? null : undefined,
      products:       fv.products ? (pub.products || []).slice(0, 10) : undefined,
      industry_fields: pub.industry_fields ?? null,
      job_ksco_label: pub.identity?.job_ksco?.label ?? null,
      work_domain_statuses: pub.identity?.work_domain?.statuses
        || (pub.identity?.work_domain?.status ? [pub.identity.work_domain.status] : null),
    };
  });
  return refs;
}

async function handleTemplateLookup(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { entity_type, schema_id, job_ksco_code, work_domain_statuses, exclude_guid } = body;
  if (!schema_id && !job_ksco_code && (!Array.isArray(work_domain_statuses) || work_domain_statuses.length === 0)) {
    return _err(400, 'MISSING_FIELD', 'schema_id, job_ksco_code, work_domain_statuses 중 최소 1개 필수', corsHeaders);
  }

  let refs;
  try {
    refs = await _l1FindTemplateReferenceProfiles(env, { entity_type, schema_id, job_ksco_code, work_domain_statuses, exclude_guid }, 8);
  } catch (e) {
    return _err(502, 'L1_TEMPLATE_LOOKUP_FAILED', 'L1 템플릿 조회 실패: ' + e.message, corsHeaders);
  }

  return new Response(JSON.stringify({ refs, count: refs.length }), { status: 200, headers: corsHeaders });
}


// (2026-07-14 삭제 — Supabase 폐기 지시에 따른 정리. handleBizProfile
//  (/biz/profile/{handle}), handleBizReview(/biz/review, 이미
//  [DEPRECATED] 표시돼 있었음), handleBizProduct(/biz/product) 전부
//  삭제했다. 셋 다 Supabase user_profiles/biz_products/biz_reviews에
//  의존했는데, 조사 결과 /biz/review·/biz/profile/*는 라우터에
//  등록조차 안 돼 있었고(router dispatch에 pathname 매칭 자체가 없음),
//  /biz/product는 등록은 돼 있었지만 저장소 전체에서 fetch로 호출하는
//  클라이언트 코드가 하나도 없었다(src/profile2.0/은 어떤 html에서도
//  로드되지 않는 고아 디렉터리). 실제 상품/리뷰는 이미 PocketBase
//  seller_products(/biz/catalog/sync, _l1ListSellerProducts)와
//  trade_ratings로 완전히 대체된 상태였다 — 새로 이관할 대상이 없어
//  그냥 삭제로 정리했다.)

// (_verifyEd25519는 위 삭제된 함수들 전용이 아니라 다른 곳(예:
//  handleGwpRegisterKey류)에서도 쓰이므로 그대로 유지한다 — 아래 주석
//  "/biz/product, /biz/review 전용"이 이제 부정확해 정정.)
// ═══════════════════════════════════════════════════════════
// Ed25519 서명 검증(body 전체 서명 — TX류 공용)
// ═══════════════════════════════════════════════════════════
async function _verifyEd25519(pubkeyB64u, signatureB64u, bodyObj) {
  try {
    const { signature: _sig, ...rest } = bodyObj;
    const payload     = new TextEncoder().encode(JSON.stringify(rest));
    const pubKeyBytes = _b64uToBytes(pubkeyB64u);
    const sigBytes    = _b64uToBytes(signatureB64u);
    const cryptoKey   = await crypto.subtle.importKey('raw', pubKeyBytes, { name:'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, payload);
  } catch (e) { console.warn('[Ed25519]', e.message); return false; }
}

async function _verifyEd25519Simple(pubkeyB64u, signatureB64u, message) {
  try {
    const data       = new TextEncoder().encode(message);
    const pubKeyBytes = _b64uToBytes(pubkeyB64u);
    const sigBytes    = _b64uToBytes(signatureB64u);
    const cryptoKey   = await crypto.subtle.importKey('raw', pubKeyBytes, { name:'Ed25519' }, false, ['verify']);
    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, data);
  } catch (e) { console.warn('[Ed25519Simple]', e.message); return false; }
}

// (2026-07-14 신설 — 사고실험에서 발견: "view:" 서명 메시지를 검증하는
// _isAuthenticatedOwnerRequest와, claims류 서명을 검증하는
// _verifyClaimsRequester 둘 다 서명 자체는 검증하면서도 ts(타임스탬프)의
// 신선도는 전혀 확인하지 않고 있었다 — handleProfileVerifyOwner 등
// 다른 서명 엔드포인트는 이미 5분 윈도우를 강제하는데, 이 두 곳만
// 빠져 있었다. 즉 한 번 유효했던 viewer_sig/signature를(GET 요청이면
// URL 쿼리파라미터라 브라우저 히스토리·서버 로그·리퍼러에 남기 쉽다)
// 무기한 재사용(replay)할 수 있는 상태였다.
//
// 클라이언트마다 ts 단위가 다르다는 것도 함께 확인했다 — profile.html/
// webapp.html의 claims·settle·financials·tx-history류는 전부
// Date.now().toString()(밀리초)을 쓰지만, call-ai.js의
// _loadOwnJobContext()는 String(Math.floor(Date.now()/1000))(초)를
// 쓴다. 이 두 클라이언트를 전부 고치는 대신, 자릿수로 초/밀리초를
// 자동 판별하는 쪽이 더 안전하다(어느 한쪽 클라이언트를 놓쳐 조용히
// 깨뜨릴 위험이 없다) — 1e12(2001-09-09 이후의 밀리초 타임스탬프는
// 항상 13자리 이상, 초 타임스탬프는 항상 10자리)를 기준으로 나눈다.
function _isFreshTs(tsRaw, windowMs = 300000) {
  const tsNum = Number(tsRaw);
  if (!Number.isFinite(tsNum) || tsNum <= 0) return false;
  const tsMs = tsNum >= 1e12 ? tsNum : tsNum * 1000; // 1e12 미만이면 초 단위로 간주
  return Math.abs(Date.now() - tsMs) <= windowMs;
}

function _b64uToBytes(b64u) {
  const b64 = b64u.replace(/-/g,'+').replace(/_/g,'/');
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// ═══════════════════════════════════════════════════════════
// v4.9 STEP 09 — handlePdvReport 동기 앵커링
// ═══════════════════════════════════════════════════════════
async function handlePdvReport(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const origin=request.headers.get('Origin')||'';
  const body=await request.json().catch(()=>null);
  if(!body?.report)return _err(400,'SCHEMA_ERROR','report.report 필드 필수',corsHeaders);
  const r=body.report;
  const svcId=r.svc||request.headers.get('X-Gopang-Svc')||'unknown';
  const ipv6=r.who?.ipv6;
  const reg=_getSvcRegistration(origin,svcId);
  if(!reg)return _err(403,'SERVICE_NOT_REGISTERED',`${svcId} (${origin})은 등록된 서비스가 아닙니다`,corsHeaders);
  if(reg.level<2&&!reg.pdv)return _err(403,'PDV_NOT_ALLOWED','Level 1 서비스는 PDV 보고서 전송 권한이 없습니다',corsHeaders);
  if(!ipv6)return _err(404,'USER_NOT_FOUND','who.ipv6 필수',corsHeaders);

  // T-C 후속(①): session_id 기반 report_id 결정 — sessionId 있으면 'sessionId:reporterSvc'로
  // 고정해 L1 pdv_records의 report_id UNIQUE 인덱스가 중복방지를 대신하게 한다.
  // (기존 Supabase 사전조회 방식은 report_id=eq.${sessionId}로 비교했지만 실제 저장값은
  //  별도 생성된 reportId라서 절대 일치할 수 없던 잠재 버그였음 — 이번에 같이 해소)
  const sessionId = r.session_id || body.session_id || null;
  const reporterSvc = r.reporter_svc || body.reporter_svc || null;

  const resolvedSvcId=_resolveSvcId(svcId);
  const reportId=r.id||`RPT-${resolvedSvcId}-${Date.now()}-auto`;
  const pdvReportId = sessionId ? `${sessionId}:${reporterSvc || resolvedSvcId}` : reportId;
  const summary6w={
    who:`${r.who?.role||'user'} (${ipv6.slice(0,20)}...)`,
    when:`${(r.when?.period_start||'').slice(0,10)} ~ ${(r.when?.period_end||'').slice(0,10)}`,
    where:r.where?.svc_url||`https://${resolvedSvcId}.hondi.net`,
    what:r.what?.summary||'(요약 없음)',
    how:r.how?.method||'자동 집계',
    why:r.why?.goal||'(목표 미지정)',
  };
  const pdvId=`PDV-${ipv6.replace(/:/g,'').slice(0,12)}-${Date.now()}`;
  const now = new Date().toISOString();

  // STEP 09: block_hash가 report에 포함된 경우 동기 앵커링
  const blockHash   = r.block_hash   || body.block_hash   || null;
  const blockId     = r.block_id     || body.block_id     || null;
  const isAnchored  = !!blockHash;

  // pdv_records 스키마에 없는 필드(period/raw_hash/openhash_block_id/openhash_anchored_at)는
  // summary_6w(JSON, 스키마리스) 안에 같이 보존 — 컬렉션 스키마 변경 없이 무손실 이관
  const summary6wFull = {
    ...summary6w,
    period:             r.when ?? r.period ?? null,
    raw_hash:           r.content_hash || null,
    openhash_block_id:  blockId,
    openhash_anchored_at: isAnchored ? now : null,
  };

  const pdvFetch = await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guid:         ipv6,
      report_id:    pdvReportId,
      reporter_svc: reporterSvc || resolvedSvcId,
      svc:          resolvedSvcId,
      type:         r.type || 'report',
      summary:      r.what?.summary || '',
      summary_6w:   JSON.stringify(summary6wFull),
      block_hash:   blockHash,
      risk_level:   r.analysis?.risk_level || 'low',
      source:       resolvedSvcId,
      openhash_anchored: isAnchored,
      // 2026-07-13 신설 — PDV 일상/업무 영역 분할(AC-EVOLUTION_v1_1.md §PDV-SPLIT).
      // 클라이언트(pdv/record.js)가 현재 모드를 태깅해 보내며, 안 보내면
      // 'personal'로 안전하게 기본값 처리한다(과소 노출보다 과소 분류가 낫다
      // — work로 잘못 태깅되면 본인도 못 보는 사고가 나고, personal로 기본
      // 처리되면 최악의 경우 work 스코프 조회에 안 걸릴 뿐이다).
      domain: (r.domain === 'work') ? 'work' : 'personal',
      affiliation_org_id: (r.domain === 'work' && typeof r.affiliation_org_id === 'string') ? r.affiliation_org_id : null,
    }),
  });

  if (!pdvFetch.ok) {
    const errBody = await pdvFetch.json().catch(() => null);
    const isDup = errBody?.data?.report_id?.code === 'validation_not_unique';
    if (isDup) {
      return new Response(JSON.stringify({
        ok: true,
        skipped: true,
        reason: 'DUPLICATE_SESSION',
        session_id: sessionId,
        message: '하위 시스템이 이미 PDV를 기록했습니다',
      }), { status: 200, headers: corsHeaders });
    }
    return _err(503,'PDV_LOCKED','PDV 저장 실패, 60초 후 재시도',corsHeaders);
  }

  return new Response(JSON.stringify({
    ok:true,
    report_id:reportId,
    pdv_entry:pdvId,
    recorded_at:now,
    openhash:{
      anchored:    isAnchored,
      block_hash:  blockHash,
      block_id:    blockId,
      anchored_at: isAnchored ? now : null,
    },
    recipients_notified:(r.who?.recipients||[]).filter(x=>x!=='gopang-pdv'),
    svc_level:reg.level,
    message:`PDV 기록 완료. ${resolvedSvcId} (Level ${reg.level})`,
  }),{status:200,headers:corsHeaders});
}

// ═══════════════════════════════════════════════════════════
// 2026-07-20 신설 — 기관측 PDV (§7, prompts/SP_PDV_v1_2.md).
// handlePdvReport(사용자측, 실명 GUID + 원문 전체)와 목적이 다르다 — 이쪽은
// K-서비스/전문가 페르소나가 만족도·성과 분석용으로 남기는 가명화·요약
// 전용 거버넌스 레코드다. 클라이언트(gwp-report-client.js recordOwnerPDV())는
// 원문 guid를 TLS로 여기까지만 보내고, 해시(who_hash)는 반드시 여기(서버)
// 에서 계산한다 — 클라이언트에서 해시하면 salt가 번들에 노출되어 GUID
// (uuidv5(phone_number), 결정론적)를 전화번호 전수조사로 역산할 수 있게
// 되어 "역추적 불가" 원칙이 무력화되기 때문이다(SP_PDV §7.2).
//
// salt는 에이전시별로 25개 시크릿을 따로 프로비저닝하지 않는다 — 기존
// GOPANG_MASTER_KEY(HMAC 서명 등에 이미 쓰이는 서버 비밀) 하나에서
// ownerAgency별 salt를 결정론적으로 파생한다(아래 salt 계산 참조). 이러면
// 마스터 키가 유출되지 않는 한 어떤 K-서비스도 다른 K-서비스의 salt를
// 알 수 없다(각자 자기 ownerAgency 값으로만 파생 가능) — C8(기관 간 교차
// 금지) 원칙을 시크릿 관리 단에서도 지킨다.
//
// 인증(authz) 참고: 이 엔드포인트는 handlePdvReport처럼 origin 기반
// _getSvcRegistration() 검사를 아직 하지 않는다 — 호출 주체가 개별
// K-서비스 도메인이 아니라 hondi.net 아래 pages/expert-chat.html이기
// 때문에 기존 서비스 등록 체계와 1:1로 안 맞는다. 지금은 스키마 검증만
// 하는 상태이며, 남용 방지가 필요해지면 별도 인증 체계를 얹어야 한다
// (알려진 한계 — 이번 범위 밖).
async function handleOwnerPdvReport(request, env, corsHeaders) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await request.json().catch(() => null);
  const r = body?.record;
  if (!r) return _err(400, 'SCHEMA_ERROR', 'record 필드 필수', corsHeaders);

  const RECORD_TYPES = ['consultation', 'own_output'];
  if (!RECORD_TYPES.includes(r.record_type))
    return _err(400, 'SCHEMA_ERROR', `record_type은 ${RECORD_TYPES.join('|')} 중 하나여야 합니다`, corsHeaders);

  // §6(2026-07-20 사고실험) 대응 — salt 파생 전에 정규화(trim+lowercase)해
  // 대소문자 차이로 같은 K-서비스의 salt가 갈라지는 걸 막고, 화이트리스트
  // 대조로 오타·미등록 값 주입을 막는다. 목록은 gwp-registry.js의 agency id +
  // 'gopang'(오너 없는 카테고리 폴백, expert-registry.js 참조)을 미러링한다 —
  // 매 요청마다 DB(gwp_registry)를 조회하지 않고 하드코딩한 이유는
  // REGISTERED_SERVICES(위 8347행)도 동일하게 정적 화이트리스트 방식이라
  // 기존 관례를 따른 것이다. 새 K-서비스 추가 시 이 배열도 같이 갱신해야
  // 한다(잊기 쉬운 지점 — gwp-registry.js 수정 체크리스트에 추가 권장).
  const OWNER_AGENCY_WHITELIST = new Set([
    'gopang', 'klaw', 'kpolice', 'ksecurity', 'khealth', 'kedu', 'kgdc',
    'kfinance', 'kinsurance', 'kbank', 'ktelecom', 'kestate',
    'kcommerce_seller', 'ktax', 'kcommerce', 'ktransport', 'klogistics',
    'jeju', 'kgov', 'kdemocracy', 'kbusiness', 'kemergency',
    'fiil-kcleaner', 'ksearch', 'kqna', 'kusers',
  ]);
  // 2026-07-20(SSOT 마이그레이션 중 발견) — 개별 K-서비스 저장소의 로컬
  // AGENCY_ID(REGISTERED_SERVICES 키, 예: 'tax'/'market'/'school')와
  // GWP_REGISTRY의 표준 agency id(예: 'ktax'/'kcommerce'/'kedu')는 서로 다른
  // 명명 체계다. klaw는 두 체계에서 우연히 같은 문자열이라 지금까지 문제가
  // 안 드러났을 뿐 — tax부터 SSOT 마이그레이션하며 실제로 걸렸다. 이미 있는
  // SVC_ALIAS(위 1332행, k표준형→로컬형)를 뒤집어 재사용한다 — 새 매핑을
  // 또 만들지 않는다(단일 진실 공급원 원칙).
  const REVERSE_SVC_ALIAS = Object.fromEntries(
    Object.entries(SVC_ALIAS).map(([kForm, localForm]) => [localForm, kForm])
  );
  const ownerAgencyRaw = String(r.owner_agency || '').trim().toLowerCase();
  const ownerAgency = REVERSE_SVC_ALIAS[ownerAgencyRaw] || ownerAgencyRaw;
  if (!ownerAgency) return _err(400, 'SCHEMA_ERROR', 'owner_agency 필수', corsHeaders);
  if (!OWNER_AGENCY_WHITELIST.has(ownerAgency))
    return _err(400, 'UNKNOWN_AGENCY', `등록되지 않은 owner_agency: ${ownerAgency}`, corsHeaders);

  if (!r.what || !r.how) return _err(400, 'SCHEMA_ERROR', 'what/how 필수', corsHeaders);

  const HOW_VALUES = ['completed', 'escalated_success', 'escalated_ai_limit', 'early_exit'];
  if (!HOW_VALUES.includes(r.how))
    return _err(400, 'SCHEMA_ERROR', `how은 ${HOW_VALUES.join('|')} 중 하나여야 합니다`, corsHeaders);

  const guidForHashing = r.guid_for_hashing || null;
  if (r.record_type === 'consultation' && !guidForHashing)
    return _err(400, 'SCHEMA_ERROR', 'consultation 레코드는 guid_for_hashing 필수', corsHeaders);

  // §7.2 가명화 해시 계산 — 원문 guid는 이 함수 밖으로 나가지 않으며
  // 어디에도 로그로 남기지 않는다(아래 catch 포함, guid 관련 값은 찍지 않음).
  let whoHash = null;
  if (guidForHashing) {
    const agencySalt = await _sha256Hex(
      `${env.GOPANG_MASTER_KEY || 'gopang-webauthn-secret-v1'}:owner-pdv-salt:${ownerAgency}`
    );
    whoHash = await _sha256Hex(`${guidForHashing}:${agencySalt}`);
  }

  const now = new Date().toISOString();
  const pbFetch = await fetch(`${L1_DEFAULT}/api/collections/owner_pdv/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      record_type:     r.record_type,
      owner_agency:    ownerAgency,
      persona_key:     r.record_type === 'consultation' ? (r.persona_key || null) : null,
      persona_version: r.record_type === 'consultation' ? (r.persona_version || null) : null,
      who_hash:        whoHash,
      when:            r.when || now,
      where:           r.where || null,
      what:            String(r.what).slice(0, 500),
      how:             r.how,
      why:             r.why || null,
      detail:          r.record_type === 'own_output' && r.detail ? JSON.stringify(r.detail) : null,
      outcome_signals: r.outcome_signals ? JSON.stringify(r.outcome_signals) : null,
      source_ref:      null, // §7.3 원칙 — 원문 미저장
      confidence:      typeof r.confidence === 'number' ? r.confidence : 1,
    }),
  });

  if (!pbFetch.ok) {
    return _err(503, 'OWNER_PDV_WRITE_FAILED', '기관측 PDV 저장 실패, 잠시 후 재시도', corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true,
    recorded_at: now,
    owner_agency: ownerAgency,
    record_type: r.record_type,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-17 신설 — project_state 저장/조회 (SP-19 v1.2/SP-20 v1.6/
// SP-22 v1.1 mode=project, human_action 일시정지·재개). L1 PocketBase
// project_states 컬렉션 직접 사용(handlePdvReport와 동일 방식 —
// Supabase pdv_log 쪽 읽기/쓰기 경로 불일치 문제(sql/pdv_domain_split.sql
// 주석 참조)를 새로 상속하지 않기 위해 별도 컬렉션으로 분리했다).
// third-party consent 흐름(handlePdvQuery)은 필요 없다 — 이건 이용자
// 본인의 세션 안에서 AC 자신이 자기 자신의 진행 중 프로젝트를 확인하는
// 내부 용도이지, 외부 서비스가 조회하는 것이 아니다.
// ═══════════════════════════════════════════════════════════
async function handleProjectStateSave(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const body=await request.json().catch(()=>null);
  if(!body?.project_id||!body?.guid||!body?.goal||!body?.status)
    return _err(400,'SCHEMA_ERROR','project_id, guid, goal, status 필드 필수',corsHeaders);

  const payload={
    project_id: body.project_id,
    guid: body.guid,
    goal: body.goal,
    status: body.status, // awaiting_human_action | completed | abandoned
    paused_at_seq: body.paused_at_seq ?? null,
    // 2026-07-17 신설(사고실험 결함 1) — project_brief를 저장 안 하면
    // 재개 시 K-Execute가 남은 step의 세부 맥락을 잃는다. steps의
    // name만으로는 부족(참여자·순서 제약 등은 project_brief에만 있음).
    project_brief: body.project_brief || '',
    remaining_steps: JSON.stringify(body.remaining_steps ?? []),
    fan_out_targets: JSON.stringify(body.fan_out_targets ?? []),
    results_so_far: JSON.stringify(body.results_so_far ?? []),
    human_action_desc: body.human_action_desc || '',
  };

  // 이미 같은 project_id 레코드가 있으면(재개 후 다시 멈추는 경우 등)
  // 새로 만들지 않고 갱신한다 — project_id UNIQUE 인덱스 그대로 재사용.
  const existing = await fetch(
    `${L1_DEFAULT}/api/collections/project_states/records?filter=` +
    encodeURIComponent(`project_id="${body.project_id}"`),
  ).then(r=>r.json()).catch(()=>null);

  let res;
  if (existing?.items?.length) {
    res = await fetch(`${L1_DEFAULT}/api/collections/project_states/records/${existing.items[0].id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } else {
    res = await fetch(`${L1_DEFAULT}/api/collections/project_states/records`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
  }
  if (!res.ok) {
    const err = await res.text().catch(()=>res.status);
    return _err(503,'PROJECT_STATE_SAVE_FAILED',String(err),corsHeaders);
  }
  return new Response(JSON.stringify({ok:true, project_id: body.project_id}),{status:200,headers:corsHeaders});
}

async function handleProjectStateQuery(request,env,corsHeaders){
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  const status = url.searchParams.get('status') || 'awaiting_human_action';
  if (!guid) return _err(400,'SCHEMA_ERROR','guid 쿼리 파라미터 필수',corsHeaders);

  const filter = encodeURIComponent(`guid="${guid}" && status="${status}"`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/project_states/records?filter=${filter}&sort=-created`)
    .catch(()=>null);
  if (!res || !res.ok) return _err(503,'PROJECT_STATE_QUERY_FAILED','L1 조회 실패',corsHeaders);
  const data = await res.json().catch(()=>({items:[]}));
  const items = (data.items||[]).map(it => ({
    project_id: it.project_id,
    goal: it.goal,
    status: it.status,
    paused_at_seq: it.paused_at_seq,
    project_brief: it.project_brief || '',
    remaining_steps: JSON.parse(it.remaining_steps||'[]'),
    fan_out_targets: JSON.parse(it.fan_out_targets||'[]'),
    results_so_far: JSON.parse(it.results_so_far||'[]'),
    human_action_desc: it.human_action_desc || '',
  }));
  return new Response(JSON.stringify({ok:true, items}),{status:200,headers:corsHeaders});
}

// ═══════════════════════════════════════════════════════════
// 2026-07-17 신설 — SP 자기 갱신 제안(Self-Update Proposal, RULE-03:
// K-Intent v1.3/K-Compose v1.7/K-Deliver v1.3/K-Report v1.1). L1
// PocketBase sp_update_proposals 컬렉션에 status=pending_review로만
// 쌓는다 — 절대 자동 승인·자동 반영하지 않는다(주피터님이 직접
// 검토해 승인하면 그때 사람이 실제 SP 파일의 다음 버전을 만든다).
// protected_sections_touched=true(RULE-01/전문직 가드레일 관련)인
// 제안 중 방향이 "완화"인 것은 애초에 SP 프롬프트 자체가 내지
// 않도록 설계돼 있지만(RULE-03 본문 참조), 서버 쪽에서도 이중
// 방어로 그 조합을 별도 플래그(needs_extra_review)로 표시해 검토
// 우선순위를 높인다 — 차단은 아니다(차단은 SP 프롬프트 단에서 이미
// 함), 검토자가 더 주의 깊게 보게 하는 신호일 뿐이다.
// ═══════════════════════════════════════════════════════════
async function handleSpUpdatePropose(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const body=await request.json().catch(()=>null);
  if(!body?.sp_id||!body?.issue||!body?.proposed_patch)
    return _err(400,'SCHEMA_ERROR','sp_id, issue, proposed_patch 필드 필수',corsHeaders);

  const protectedTouched = !!body.protected_sections_touched;
  const payload = {
    sp_id: body.sp_id,
    current_version: body.current_version || '',
    trigger: body.trigger || 'self_noticed_gap',
    issue: body.issue,
    proposed_patch: body.proposed_patch,
    confidence: body.confidence || 'medium',
    protected_sections_touched: protectedTouched,
    // RULE-01/가드레일 관련 제안은 검토 우선순위를 높인다(차단이 아니라
    // 신호 — 완화 방향 자체는 SP 프롬프트 단에서 이미 내지 않게 설계돼
    // 있으므로, 여기 도달했다는 건 대개 "강화" 방향 제안이다).
    needs_extra_review: protectedTouched,
    status: 'pending_review',
    source_session_note: body.source_session_note || '',
    // 2026-07-17 신설 — user_feedback 취합 배치(tools/triage_feedback.py)가
    // 클러스터를 특정 SP 수정 제안으로 브릿지할 때 이 필드로 출처를
    // 구분한다. 주피터님이 검토할 때 "SP가 스스로 느낀 것"과 "사용자가
    // 실제로 말한 것"을 구분해서 볼 수 있게 — 기본값은 기존 동작과
    // 동일(SP 자기반성)이라 하위호환 깨지지 않는다.
    source: ['sp_self_reflection', 'user_feedback'].includes(body.source) ? body.source : 'sp_self_reflection',
    user_feedback_ids: Array.isArray(body.user_feedback_ids) ? body.user_feedback_ids : [],
  };

  const res = await fetch(`${L1_DEFAULT}/api/collections/sp_update_proposals/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(()=>res.status);
    return _err(503,'SP_UPDATE_PROPOSE_FAILED',String(err),corsHeaders);
  }
  return new Response(JSON.stringify({ok:true, sp_id: body.sp_id, status:'pending_review'}),{status:200,headers:corsHeaders});
}

// ═══════════════════════════════════════════════════════════
// 2026-07-17 신설 — 사용자 개선 제안 능동 획득(docs/
// user_feedback_mechanism_proposal_v1.md). RULE-03(SP 자기 갱신
// 제안)과 검토 창구를 통합하되(sp_update_proposals.source로 구분),
// 사용자 발화 원문·문맥은 별도 컬렉션(user_feedback)에 전부 보존한다
// — 모든 피드백이 다 SP 수정으로 이어지는 건 아니므로(예: "화면이
// 이쁘면 좋겠다"), 원문 보존과 SP 제안 브릿지를 분리했다. 브릿지
// 자체는 이 핸들러가 하지 않는다 — tools/triage_feedback.py(주기
// 배치)가 임베딩 클러스터링 후 명확한 것만 /sp-updates/propose로
// source=user_feedback 브릿지한다.
// ═══════════════════════════════════════════════════════════
async function handleUserFeedbackSubmit(request, env, corsHeaders) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  const body = await request.json().catch(() => null);
  if (!body?.raw_text) return _err(400, 'SCHEMA_ERROR', 'raw_text 필드 필수', corsHeaders);

  const payload = {
    guid: body.guid || null, // 익명 제출 허용
    raw_text: String(body.raw_text).slice(0, 2000), // 과도한 길이 방어
    context_sp: body.context_sp || null,
    context_summary: body.context_summary ? String(body.context_summary).slice(0, 500) : '',
    // category는 포착 시점 SP의 판단일 뿐 — 사람이 나중에 재분류 가능하므로
    // 여기서 엄격히 검증하지 않는다(모르는 값이 오면 'question'으로 안전
    // 폴백, 저장 자체를 막지 않음 — §0 U0: 실패보다 진행).
    category: ['bug', 'feature_request', 'complaint', 'praise', 'question'].includes(body.category)
      ? body.category : 'question',
    status: 'new',
  };

  const res = await fetch(`${L1_DEFAULT}/api/collections/user_feedback/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    return _err(503, 'USER_FEEDBACK_SUBMIT_FAILED', String(err), corsHeaders);
  }
  const saved = await res.json().catch(() => ({}));
  return new Response(JSON.stringify({ ok: true, id: saved.id || null, status: 'new' }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 이하 v4.8과 동일 — PDV Query, SSO, WebAuthn, AI, Geocode
// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// 2026-07-04b(긴급 보안수정): handlePdvQuery — 인증 레벨 자칭 신뢰 제거
//
// 이전엔 query.auth_token(클라이언트가 만든 {exp,level} JSON)을 서명 검증
// 없이 그대로 믿었다. 지금은 모든 VALID_PDV_SCOPES가 L1 이하만 요구해
// 당장 악용 가치는 없었지만, L2/L3 scope가 하나라도 추가되는 순간 이미
// 배포된 12개 서비스 전체가 동시에(그리고 조용히) 뚫리는 구조였다 —
// "level:'L3'"라고 우기기만 하면 통과됐다.
//
// 고친 방식: Authorization: Bearer <token> 헤더가 있으면 parseToken()
// (buildToken/handleVerify/handleRefresh와 동일한 HMAC-SHA256 서명 검증,
// env.GOPANG_MASTER_KEY)으로 실제 레벨을 확인해 사용한다. 헤더가 없거나
// 검증에 실패하거나 ipv6가 query.ipv6와 다르면 — 즉 "검증된 신원을 확인할
// 수 없으면" — 클라이언트가 뭐라고 주장하든 레벨을 무조건 L1로 강등한다.
//
// 왜 이 방식이 지금 당장 안전하게 배포 가능한가: 오늘 등록된 12개 scope는
// 전부 최대 요구 레벨이 L1이므로(SCOPE_MIN_LEVEL 참조), 아직 어느 클라
// 이언트도 진짜 Bearer 토큰을 보내지 않는 상태에서도 강등 결과는 지금
// 동작과 완전히 동일하다 — 기능 회귀가 없다. 다만 이후 L2/L3 scope가
// 추가되면, 그 scope는 실제 검증된 Bearer 토큰 없이는 항상 403으로
// 막힌다(조용히 뚫리는 대신 눈에 보이게 실패한다) — 그게 핵심 개선점이다.
//
// TODO(플랫폼 전체 후속 과제, 이번 수정 범위 밖): 지금은 handleIssue가
// 응답 JSON에 token 필드를 추가로 내려주기 시작했을 뿐, gopang-sso.js/
// subsystem-auth.js가 이 토큰을 캡처해 하위 서비스에 노출하고, 각
// K-서비스가 그걸 Authorization 헤더로 실어 보내는 배선은 아직 없다.
// 그 배선이 완성되기 전까지는 위 "검증 불가 → L1 강등" 경로가 항상
// 타므로 기능은 그대로 동작하되 L2/L3 scope는 아직 아무도 통과 못한다.
// ═══════════════════════════════════════════════════════════
async function _verifiedPdvSession(request,env){
  const auth=request.headers.get('Authorization')||'';
  const m=auth.match(/^Bearer\s+(.+)$/i);
  if(!m)return null;
  const payload=await parseToken(env,m[1].trim());
  return payload; // null이면 서명 불일치/만료 — 호출부가 검증 실패로 처리
}

async function handlePdvQuery(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const origin=request.headers.get('Origin')||'';
  try{
    const body=await request.json().catch(()=>null);
    const query=body?.query;
    if(!query?.svc||!query?.ipv6||!query?.scope||!query?.period)return _err(400,'SCHEMA_ERROR','필수 필드 누락: svc, ipv6, scope, period',corsHeaders);
    if(!Array.isArray(query.scope)||query.scope.length===0)return _err(400,'SCOPE_INVALID','scope는 비어있지 않은 배열이어야 합니다',corsHeaders);
    const invalidScope=query.scope.find(s=>!VALID_PDV_SCOPES.includes(s)&&!/^work_pdv:/.test(s));
    if(invalidScope)return _err(400,'SCOPE_INVALID',`허용되지 않은 scope: ${invalidScope}`,corsHeaders);
    if(!query.period?.start||!query.period?.end)return _err(400,'SCHEMA_ERROR','period.start, period.end 필수',corsHeaders);
    const periodMs=new Date(query.period.end)-new Date(query.period.start);
    if(periodMs>365*24*60*60*1000)return _err(400,'PERIOD_TOO_LONG','조회 기간은 12개월을 초과할 수 없습니다',corsHeaders);
    const svcReg=_getSvcRegistration(origin,query.svc);
    if(!svcReg||!svcReg.pdv)return _err(403,'SVC_NOT_REGISTERED',`미등록 또는 PDV 권한 없는 서비스: ${query.svc}`,corsHeaders);

    const LEVEL_ORDER={L0:0,L1:1,L2:2,L3:3};
    const verified=await _verifiedPdvSession(request,env);
    // 검증된 세션의 ipv6가 조회 대상 ipv6와 다르면 "검증 안 됨"과 동일하게
    // 취급한다 — 타인 명의로 검증된 토큰을 자기 자신의 조회에 갖다 붙이는
    // 것을 막는다(본인 데이터만 조회 가능해야 한다는 설계 의도).
    const effectiveLevel=(verified && verified.ipv6===query.ipv6) ? (verified.level||'L1') : 'L1';
    const userLevel=LEVEL_ORDER[effectiveLevel]??1;
    for(const scope of query.scope){
      const required=LEVEL_ORDER[SCOPE_MIN_LEVEL[scope]||'L1'];
      if(userLevel<required)return _err(403,'LEVEL_INSUFFICIENT',`${scope} 조회는 ${SCOPE_MIN_LEVEL[scope]} 이상 필요 — 검증된 인증 토큰(Authorization: Bearer)이 필요합니다`,corsHeaders);
    }

    if(!query.consent_token||!query.request_id){
      const reqId=`CNSREQ-${query.ipv6.replace(/:/g,'').slice(0,8)}-${Date.now()}`;
      const expiresAt=Math.floor(Date.now()/1000)+300;
      await _storeConsentRequest(env,reqId,query,expiresAt);
      const consentUrl='https://hondi.net/consent'+`?req=${encodeURIComponent(reqId)}&svc=${encodeURIComponent(query.svc)}`+`&scope=${encodeURIComponent(query.scope.join(','))}`+`&purpose=${encodeURIComponent(query.purpose||'')}`+`&ipv6_hash=${encodeURIComponent(await _sha256Hex(query.ipv6))}`+`&return_to=${encodeURIComponent(origin)}`;
      return new Response(JSON.stringify({ok:false,status:'CONSENT_REQUIRED',consent:{request_id:reqId,expires_at:expiresAt,consent_url:consentUrl,message:'사용자가 고팡 앱에서 PDV 조회에 동의해야 합니다.'}}),{status:202,headers:corsHeaders});
    }
    const consentOk=await _verifyConsentToken(env,query.consent_token,query.request_id,query.ipv6);
    if(!consentOk)return _err(401,'CONSENT_INVALID','동의 토큰이 유효하지 않습니다',corsHeaders);
    const withinLimit=await _checkRateLimit(env,query.ipv6,'pdv_query');
    if(!withinLimit)return _err(429,'RATE_LIMITED','PDV 조회 한도 초과',corsHeaders);
    // 2026-07-15 신설(2026-07-15 복구 — 2026-07-14 배치1 커밋(03e8696)이
    // 실수로 이 블록을 되돌렸던 것을 원본 423d246 기준으로 복원함) —
    // 공무원 직무보조 갱신계획 v1.0 §5 레이어 C(92번) 대응.
    // query.official_access_cert가 있으면(=담당공무원이 대신 조회를 실행한
    // 경우) dept-task-handler.js의 기존 _verifyAccessCert로 서명을 검증하고,
    // 검증된 official_guid/org_id를 감사 로그에 남긴다. 없으면(citizen이
    // 자기 자신을 조회하는 일반 경로) officialAudit은 null로 남아 기존 동작과
    // 완전히 동일하다 — 기능 회귀 없음.
    let officialAudit=null;
    if(query.official_access_cert){
      const cert=query.official_access_cert;
      const verifiedOrgId=await _verifyAccessCert(env,cert,cert.official_guid,{_verifyEd25519Simple,_l1FindProfileByGuid}).catch(()=>null);
      if(!verifiedOrgId)return _err(401,'ACCESS_CERT_INVALID','공무원 직책 인증서 검증 실패 — 서명·만료·TOFU 중 하나가 불일치합니다',corsHeaders);
      officialAudit={official_guid:cert.official_guid,org_id:verifiedOrgId,role:cert.role||null};
    }
    // 2026-07-13 신설 — work_pdv:{orgId} scope는 레거시 Supabase pdv_log가
    // 아니라 L1 pdv_records(실제 쓰기가 이뤄지는 테이블)에서 조회한다
    // (AC-EVOLUTION_v1_1.md §5-6 — 기존 _fetchPdvByScope 경로가 최신
    // 데이터를 못 읽고 있을 가능성이 있어 이 신규 경로는 우회한다).
    const normalScopes=query.scope.filter(s=>!s.startsWith('work_pdv:'));
    const workScopes=query.scope.filter(s=>s.startsWith('work_pdv:'));
    const pdvSummary=normalScopes.length?await _fetchPdvByScope(env,query.ipv6,normalScopes,query.period):{};
    for(const ws of workScopes){
      const orgId=ws.slice('work_pdv:'.length);
      pdvSummary[ws]=await _fetchWorkPdvRecordsL1(env,query.ipv6,orgId);
    }
    const queryId=`PDVQ-${query.ipv6.replace(/:/g,'').slice(0,8)}-${Date.now()}`;
    const pdvEntryId=await _recordConsentEvent(env,query,queryId,officialAudit);
    const expOut=verified?.exp ? new Date(verified.exp*1000).toISOString() : new Date(Date.now()+3600*1000).toISOString();
    return new Response(JSON.stringify({ok:true,query_id:queryId,ipv6:query.ipv6,period:query.period,pdv_summary:pdvSummary,consent:{granted_at:new Date().toISOString(),expires_at:expOut,pdv_entry_id:pdvEntryId}}),{status:200,headers:corsHeaders});
  }catch(e){return _err(500,'INTERNAL_ERROR',e.message,corsHeaders);}
}
async function _storeConsentRequest(env,reqId,query,expiresAt){
  // BUG-FIX(2026-07-02): Supabase pdv_consent_requests 테이블이 실제로는
  // 한 번도 생성된 적이 없었다(HTTP 404 PGRST205 확인됨). Supabase→L1
  // 마이그레이션 방향에 맞춰 Supabase 대신 L1(hanlim) PocketBase에
  // 새로 만든 pdv_consent_requests 컬렉션(id: p1tketkfid3uup8)을 쓴다.
  // 이 컬렉션은 consent_token을 담으므로 listRule/createRule 등을 전부
  // null(관리자 전용)로 잠갔다 — 그래서 anon key가 아니라 _l1AdminToken()
  // 관리자 토큰이 필요하다. 원래 Supabase 스키마의 PK "id"(CNSREQ-... 문자열)는
  // PocketBase의 자동생성 15자 id와 충돌하므로 별도 "request_id" 필드에 담는다
  // (pdv_records가 report_id를 별도 필드로 쓰는 것과 동일 패턴).
  try{
    const token=await _l1AdminToken(env);
    const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records`,{
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({
        request_id: reqId,
        ipv6:       query.ipv6,
        svc:        _resolveSvcId(query.svc),
        scope:      query.scope,
        purpose:    query.purpose||'',
        period:     query.period,
        status:     'pending',
        expires_at: new Date(expiresAt*1000).toISOString(),
      }),
    });
    if(!res.ok) console.warn('[PDVQuery] 동의 요청 저장 실패(L1):', res.status, await res.text().catch(()=>''));
  }catch(e){console.warn('[PDVQuery] 동의 요청 저장 실패:',e.message);}
}
async function _verifyConsentToken(env,consentToken,requestId,ipv6){
  // BUG-FIX(2026-07-02): _storeConsentRequest와 동일한 이유로 L1로 전환.
  // PocketBase filter 문법(작은따옴표 문자열 리터럴) — requestId/ipv6에
  // 작은따옴표가 섞일 가능성은 낮지만 방어적으로 이스케이프한다.
  const esc = s => String(s).replace(/'/g, "\\'");
  try{
    const token=await _l1AdminToken(env);
    const filter=encodeURIComponent(`request_id='${esc(requestId)}' && ipv6='${esc(ipv6)}'`);
    const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records?filter=${filter}&perPage=1`,{
      headers:{'Authorization':'Bearer '+token},
    });
    if(!res.ok) return _verifyConsentHmac(env,consentToken,requestId,ipv6);
    const data=await res.json().catch(()=>({items:[]}));
    const row=data.items?.[0];
    if(!row)return false;
    if(new Date(row.expires_at)<new Date())return false;
    if(row.status!=='granted')return false;
    if(row.consent_token!==consentToken)return false;
    return true;
  }catch(e){return _verifyConsentHmac(env,consentToken,requestId,ipv6);}
}
async function _verifyConsentHmac(env,consentToken,requestId,ipv6){try{const masterKey=env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1';const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(masterKey),{name:'HMAC',hash:'SHA-256'},false,['verify']);const data=new TextEncoder().encode(`${requestId}.${ipv6}`);const sigBytes=Uint8Array.from(atob(consentToken.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));return crypto.subtle.verify('HMAC',key,sigBytes,data);}catch{return false;}}

// ── 동의 토큰 발급 — _verifyConsentHmac의 역함수 (2026-07-02 신설) ──────
// "동의 승인 페이지 미구현" 문제의 핵심: _verifyConsentHmac(검증)는 있었지만
// 이 서명 함수가 없어서 사용자가 승인해도 유효한 consent_token을 만들 방법이
// 없었다. _verifyConsentHmac의 정확한 역과정(같은 HMAC 키·같은 base64url
// 변환)을 따라야 두 함수가 서로 맞물린다.
async function _signConsentHmac(env,requestId,ipv6){
  const masterKey=env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1';
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(masterKey),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const data=new TextEncoder().encode(`${requestId}.${ipv6}`);
  const sigBuf=await crypto.subtle.sign('HMAC',key,data);
  let bin='';
  for(const b of new Uint8Array(sigBuf)) bin+=String.fromCharCode(b);
  return btoa(bin).replace(/\+/g,'-').replace(/\//g,'_'); // '=' 패딩은 유지 — _verifyConsentHmac이 '+'/'/'만 되돌리므로
}

// L1(hanlim) pdv_consent_requests에서 request_id로 단일 레코드 조회 (Admin 토큰)
async function _l1FindConsentRequest(env,requestId){
  const token=await _l1AdminToken(env);
  const filter=encodeURIComponent(`request_id='${String(requestId).replace(/'/g,"\\'")}'`);
  const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records?filter=${filter}&perPage=1`,
    {headers:{'Authorization':'Bearer '+token}});
  if(!res.ok) return null;
  const data=await res.json().catch(()=>({items:[]}));
  return data.items?.[0]||null;
}

// GET/POST /consent/info?req=... — 동의 승인 페이지(consent.html)가 요청 상세를 표시하기 위해 호출.
// 관리자 토큰이 필요한 L1 컬렉션을 안전하게 프록시 — svc/scope/purpose/expires_at/status만 노출,
// consent_token·ipv6 원문은 절대 클라이언트에 반환하지 않는다.
// ═══════════════════════════════════════════════════════════
// PERSONAL-AC-CALL-PROTOCOL_v1_0 구현 — /personal-ac/call
// (docs/PERSONAL-AC-CALL-PROTOCOL_v1_0_2026-07-15.md 참조)
//
// 왜 필요한가(발견①): handlePdvQuery의 "동의 필요" 단계는 요청자(=시민 본인의
// 브라우저)가 그대로 consent.html로 리다이렉트되는 걸 전제한다. 공무원이 시민을
// 대신 조회하려는 경우, 이 리다이렉트는 공무원의 화면에서 일어나므로 시민에게는
// 아무 일도 일어나지 않는다 — 요청이 존재한다는 사실 자체를 시민이 알 방법이
// 없었다.
//
// 이 함수가 하는 일은 두 가지뿐이다(나머지는 기존 인프라 재사용):
//  (1) official_access_cert를 요청 "생성 시점"에 미리 검증한다 — handlePdvQuery는
//      consent_token이 이미 있는 "2단계"에서만 이 검증을 했다. 여기서는 애초에
//      1단계(동의요청 생성) 자체를 공무원 신원 확인 없이는 시작하지 않는다.
//  (2) _sendPushToGuid로 대상 시민에게 실제 알림을 보낸다 — 지금까지 없었던
//      알림 채널. 응답(동의/거부)은 시민이 consent.html에서 기존 /consent/respond
//      를 그대로 호출하면 되므로 새 응답 엔드포인트는 만들지 않는다.
//
// 긴급(emergency) 처리에 대한 구현 결정 — 설계문서(§[PERSONAL_AC_EMERGENCY_
// BYPASS])는 "§4 표준 왕복을 거치지 않는다"고 썼으나, 실제 구현에서는 동의
// 요건 자체를 생략하지 않는다 — 이건 법적 근거(강제조사·긴급조항)가 있어야
// 정당화되는 영역이라 AI가 코드 차원에서 단독으로 결정할 사안이 아니다(이전
// 사고실험 "강제조사·수사성 업무" 논의와 동일 원칙). emergency=true는 대신
// (a) 알림의 긴급도(제목·진동 패턴)만 다르게 하고 (b) EMERGENCY_ELIGIBLE_ROLES
// 화이트리스트에 없는 role은 애초에 emergency를 자칭할 수 없게 막는다. 설계
// 문서의 "표준 왕복 생략"은 이번 구현에서 채택하지 않았음을 문서에도 반영 필요.
//
// 2026-07-15b(사고실험 재확인): 이 화이트리스트가 실제로 무엇과 대조되는지
// _verifyAccessCert(dept-task-handler.js)를 직접 확인한 결과, access_cert의
// role 필드는 검증 로직이 `!role`(비어있지 않은지) 하나뿐인 자유 텍스트였다
// — 기관장이 서명 시 임의로 적어 넣는 값이며, 전국 공통 직책 코드 표준이
// 존재하지 않는다. 즉 이 Set에 값을 채워도 "각 기관장이 뭐라고 서명했는가"에
// 안전성이 전적으로 위임될 뿐, 실질적인 화이트리스트 기능을 하지 못한다.
// GWP_REGISTRY 직책 코드 표준(§NATIONAL-OFFICIAL-ROLE-REGISTRY, 별도 설계
// 문서 예정)이 확정되고 _verifyAccessCert가 role을 그 표준에 대조 검증하기
// 전까지는, 검증되지 않는 값과 대조하는 것보다 "아무도 통과 못 함"이 더
// 안전한 실패(fail-safe)다 — 그래서 지금은 빈 Set으로 둔다. 표준 확정 후
// 이 배열에 실제 코드값을 채우고 이 주석은 제거할 것.
// 2026-07-15f(사고실험 후속) — role(직위명)이 아니라 job_series(직류/계급)를
// 검증하도록 축 자체를 바꿨다(dept-task-handler.js _verifyAccessCert 참고,
// access_cert에 job_series 필드 신설·서명 포함). role은 국장급 이상
// 직위명이라 "일선 긴급대응 자격"이라는 질문과 애초에 안 맞았다 —
// 그래서 기존 EMERGENCY_ELIGIBLE_ROLES(role 대조용)는 삭제하고 아래로
// 완전히 교체한다.
//
// job_series는 이제 서명 검증되는 필드이므로(자유 텍스트 아님), 실제
// code.go.kr에서 확인한 값으로 채운다 — 사회복지 직류 2종과 경찰 계급
// 중 '경위' 이상(주무관·책임자급)만 포함했다. '순경'~'경사'까지 전부
// 포함하지 않은 건, code.go.kr이 이 컷오프를 정해준 게 아니라 내가 판단한
// 정책 결정이다 — 실제 긴급조치 발동 권한 기준은 경찰청 등 소관부처와
// 별도 확인이 필요하다. 아동보호는 여전히 비어있다(job-series-registry.js
// 상단 주석 — 독립 국가 직렬 코드 없음, 사회복지로 임의 대체하지 않음).
const EMERGENCY_ELIGIBLE_JOB_SERIES = new Set([
  '사회복지', '사회복지전문',
  '경위', '경감', '경정', '총경', '경무관', '치안감', '치안정감', '치안총감',
  // '순경', '경장', '경사'는 의도적으로 제외 — 위 주석 참고, 컷오프 재검토 필요
]);

async function handlePersonalAcCall(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const {
    target_guid, scope, purpose = '', period,
    official_access_cert, ttl_sec = 3600,
    emergency = false,
  } = body;

  if (!target_guid) return _err(400, 'MISSING_FIELD', 'target_guid 필수', corsHeaders);
  if (!Array.isArray(scope) || scope.length === 0)
    return _err(400, 'SCOPE_INVALID', 'scope는 비어있지 않은 배열이어야 합니다', corsHeaders);
  const invalidScope = scope.find(s => !VALID_PDV_SCOPES.includes(s) && !/^work_pdv:/.test(s));
  if (invalidScope) return _err(400, 'SCOPE_INVALID', `허용되지 않은 scope: ${invalidScope}`, corsHeaders);
  if (!period?.start || !period?.end) return _err(400, 'SCHEMA_ERROR', 'period.start, period.end 필수', corsHeaders);
  if (!official_access_cert?.official_guid) return _err(400, 'MISSING_FIELD', 'official_access_cert 필수', corsHeaders);

  // (1) 공무원 신원 선검증 — handlePdvQuery와 달리 요청 "생성 이전"에 검증한다.
  const verifiedOrgId = await _verifyAccessCert(
    env, official_access_cert, official_access_cert.official_guid,
    { _verifyEd25519Simple, _l1FindProfileByGuid }
  ).catch(() => null);
  if (!verifiedOrgId)
    return _err(401, 'ACCESS_CERT_INVALID', '공무원 직책 인증서 검증 실패 — 서명·만료·TOFU 중 하나가 불일치합니다', corsHeaders);

  if (emergency && !EMERGENCY_ELIGIBLE_JOB_SERIES.has(official_access_cert.job_series || '')) {
    return _err(403, 'EMERGENCY_NOT_ALLOWED', '이 직류/계급은 긴급 플래그를 발화할 권한이 없습니다', corsHeaders);
  }

  const target = await _l1FindProfileByGuid(env, target_guid).catch(() => null);
  if (!target) return _err(404, 'TARGET_NOT_FOUND', '대상 시민 프로필을 찾을 수 없습니다', corsHeaders);

  const reqId = `PACREQ-${target_guid.replace(/:/g, '').slice(0, 8)}-${Date.now()}`;
  const expiresAt = Math.floor(Date.now() / 1000) + (emergency ? 86400 : ttl_sec); // 긴급은 24시간 — "무제한"은 아님(위 주석 참고)
  const query = { svc: verifiedOrgId, ipv6: target_guid, scope, purpose, period };
  await _storeConsentRequest(env, reqId, query, expiresAt);

  const consentUrl = 'https://hondi.net/consent' +
    `?req=${encodeURIComponent(reqId)}&svc=${encodeURIComponent(verifiedOrgId)}` +
    `&scope=${encodeURIComponent(scope.join(','))}&purpose=${encodeURIComponent(purpose)}`;

  // (2) 실제 알림 발송 — 발견①의 핵심 수정. 실패해도 요청 생성 자체는
  // 무효화하지 않는다(대기함 폴백은 STAFF_TASK_QUEUE 패턴 재사용 예정,
  // PERSONAL-AC-CALL-PROTOCOL §6-1 참조 — 이번 구현 범위 밖).
  await _sendPushToGuid(env, target_guid, {
    title: emergency ? '긴급 확인 요청' : `${verifiedOrgId} 확인 요청`,
    body:  purpose || '개인정보 조회 동의 요청이 도착했습니다.',
    tag:   `personal-ac-call-${reqId}`,
    url:   consentUrl,
  }).catch(e => console.warn('[PersonalACCall] push 발송 실패:', e.message));

  // 발견⑤ 패턴 재사용 — 요청 생성 자체도 감사 대상(누가 언제 무슨 목적으로
  // 어떤 시민에게 요청을 보냈는지). 실제 조회 성공 시의 감사 기록은 기존
  // handlePdvQuery의 _recordConsentEvent가 별도로 남긴다 — 이건 "요청 발신"
  // 시점 기록이라 중복이 아니다.
  await _recordConsentEvent(env, query, reqId, {
    official_guid: official_access_cert.official_guid,
    org_id: verifiedOrgId,
    role: official_access_cert.role || null,
  }).catch(() => {});

  return new Response(JSON.stringify({
    ok: true,
    status: emergency ? 'emergency_pending' : 'pending',
    request_id: reqId,
    consent_url: consentUrl,
    expires_at: expiresAt,
  }), { status: 202, headers: corsHeaders });
}

// POST /pdv/consent-receipt { request_id, event:'delivered'|'acknowledged' }
// PERSONAL-AC-CALL-PROTOCOL_v1_0 §5 수신확인 3단계 구현. sw.js의 push/
// notificationclick 핸들러가 각각 delivered/acknowledged를 보고한다.
// sent는 _sendPushToGuid 호출 자체로 이미 감사로그에 남으므로 별도 처리
// 불필요 — 여기서는 delivered_at/acknowledged_at 2개 시각만 기록한다.
async function handleConsentReceipt(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { request_id, event } = body;
  if (!request_id) return _err(400, 'MISSING_FIELD', 'request_id 필수', corsHeaders);
  if (!['delivered', 'acknowledged'].includes(event))
    return _err(400, 'SCHEMA_ERROR', "event는 'delivered' 또는 'acknowledged'여야 합니다", corsHeaders);

  let record;
  try { record = await _l1FindConsentRequest(env, request_id); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders); }
  if (!record) return _err(404, 'NOT_FOUND', '존재하지 않는 동의 요청입니다', corsHeaders);

  const field = event === 'delivered' ? 'delivered_at' : 'acknowledged_at';
  // 이미 기록돼 있으면 덮어쓰지 않는다 — "최초 도달/인지 시각"만 의미
  // 있다(여러 번 push가 재전송되거나 알림을 여러 번 눌러도 첫 시각이
  // 사고실험에서 짚은 "실패의 책임 소재" 판단의 근거 값이다).
  if (record[field]) {
    return new Response(JSON.stringify({ ok: true, already_recorded: true, [field]: record[field] }), { status: 200, headers: corsHeaders });
  }

  try {
    const token = await _l1AdminToken(env);
    const now = new Date().toISOString();
    const patchRes = await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records/${record.id}`, {
      method: 'PATCH',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ [field]: now }),
    });
    if (!patchRes.ok) return _err(502, 'L1_UPDATE_FAILED', '수신확인 기록 실패: HTTP ' + patchRes.status, corsHeaders);
    return new Response(JSON.stringify({ ok: true, [field]: now }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
}

async function handleConsentInfo(request,env,corsHeaders){
  const url=new URL(request.url);
  const reqId=(request.method==='POST'?(await request.json().catch(()=>({})))?.req:url.searchParams.get('req'))||'';
  if(!reqId) return _err(400,'MISSING_FIELD','req 필수',corsHeaders);
  let record;
  try{ record=await _l1FindConsentRequest(env,reqId); }
  catch(e){ return _err(502,'L1_UNREACHABLE','L1 연결 실패: '+e.message,corsHeaders); }
  if(!record) return _err(404,'NOT_FOUND','존재하지 않는 동의 요청입니다',corsHeaders);
  if(new Date(record.expires_at)<new Date()) return _err(410,'EXPIRED','동의 요청이 만료됐습니다',corsHeaders);
  return new Response(JSON.stringify({
    ok:true,
    request_id: record.request_id,
    svc:        record.svc,
    scope:      record.scope,
    purpose:    record.purpose||'',
    period:     record.period,
    status:     record.status,
    expires_at: record.expires_at,
  }),{status:200,headers:corsHeaders});
}

// POST /consent/respond — body: { req, ipv6, decision:'grant'|'deny' }
// consent.html에서 사용자가 동의/거부 버튼을 눌렀을 때 호출. ipv6는 사용자
// 로컬 기기(localStorage gopang_user_v4)에서 읽은 "본인의" 값 — 원 요청이
// 저장해 둔 ipv6와 정확히 일치해야만 승인/거부를 처리한다(다른 사람이 링크만
// 보고 남의 요청에 응답하는 것을 막는 핵심 검증).
async function handleConsentRespond(request,env,corsHeaders){
  if(request.method!=='POST') return new Response('Method Not Allowed',{status:405});
  const body=await request.json().catch(()=>null);
  const reqId=body?.req, ipv6=body?.ipv6, decision=body?.decision;
  if(!reqId||!ipv6||!['grant','deny'].includes(decision))
    return _err(400,'SCHEMA_ERROR','req, ipv6, decision(grant|deny) 필수',corsHeaders);

  let record;
  try{ record=await _l1FindConsentRequest(env,reqId); }
  catch(e){ return _err(502,'L1_UNREACHABLE','L1 연결 실패: '+e.message,corsHeaders); }
  if(!record) return _err(404,'NOT_FOUND','존재하지 않는 동의 요청입니다',corsHeaders);
  if(new Date(record.expires_at)<new Date()) return _err(410,'EXPIRED','동의 요청이 만료됐습니다',corsHeaders);
  if(record.status!=='pending') return _err(409,'ALREADY_RESPONDED',`이미 처리된 요청입니다(${record.status})`,corsHeaders);
  if(record.ipv6!==ipv6) return _err(403,'IPV6_MISMATCH','본인의 요청이 아닙니다',corsHeaders);

  const token=await _l1AdminToken(env);
  // 2026-07-04: 기존엔 승인(grant) 후에도 expires_at을 최초 요청 생성 시점의
  // 5분짜리 값(_storeConsentRequest의 300초) 그대로 뒀다 — 즉 "5분 안에
  // 동의 안 하면 무효"뿐 아니라 "동의해도 5분 지나면 어차피 무효"였다.
  // PDV_HISTORY_REQUEST(K-Public_common P11) 같은 연속성 조회는 수일~수개월
  // 뒤에도 재사용돼야 하므로, 승인 시점에 expires_at을 STANDING_CONSENT_TTL_SEC
  // 만큼 연장한다. 거부(deny)는 연장할 이유가 없으므로 그대로 둔다.
  const STANDING_CONSENT_TTL_SEC = 90*24*60*60; // 90일
  const patch = decision==='grant'
    ? {
        status:'granted',
        consent_token: await _signConsentHmac(env,record.request_id,ipv6),
        expires_at: new Date(Date.now()+STANDING_CONSENT_TTL_SEC*1000).toISOString(),
      }
    : { status:'denied' };

  const patchRes=await fetch(`${L1_DEFAULT}/api/collections/pdv_consent_requests/records/${record.id}`,{
    method:'PATCH',
    headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
    body:JSON.stringify(patch),
  });
  if(!patchRes.ok) return _err(502,'L1_UPDATE_FAILED','동의 상태 갱신 실패: HTTP '+patchRes.status,corsHeaders);

  return new Response(JSON.stringify({
    ok:true,
    decision,
    consent_token: patch.consent_token || null,
  }),{status:200,headers:corsHeaders});
}
async function _checkRateLimit(env,ipv6,action){if(env.RATE_LIMIT_KV){const kvKey=`rl:${action}:${ipv6}`;const current=parseInt(await env.RATE_LIMIT_KV.get(kvKey)||'0');if(current>=3)return false;await env.RATE_LIMIT_KV.put(kvKey,String(current+1),{expirationTtl:300});return true;}return true;}
// (2026-07-14: Supabase pdv_log → L1 pdv_records 이관. PocketBase 필터
//  문법으로 날짜범위+source 목록을 직접 표현한다 — Supabase의
//  created_at=gte./lte., source=in.()와 동등한 PocketBase 문법.)
async function _fetchPdvByScope(env,ipv6,scopes,period){
  const token = await _l1AdminToken(env);
  const result={};
  for(const scope of scopes){
    const sources=SCOPE_SOURCE_MAP[scope];
    let filter = `guid='${ipv6.replace(/'/g,"\\'")}' && created >= '${period.start} 00:00:00' && created <= '${period.end} 23:59:59'`;
    if(sources && sources.length===1){
      filter += ` && source='${sources[0]}'`;
    } else if(sources && sources.length>1){
      filter += ` && (${sources.map(s=>`source='${s}'`).join(' || ')})`;
    }
    try{
      const res=await fetch(
        `${L1_DEFAULT}/api/collections/pdv_records/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=50`,
        {headers:{'Authorization':'Bearer '+token}}
      );
      const data=await res.json().catch(()=>({items:[]}));
      const rows=data.items||[];
      if(!rows.length){result[scope]={available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{}};continue;}
      const RISK_ORDER={low:0,medium:1,high:2};
      const maxRisk=rows.reduce((max,r)=>{const lvl=r.risk_level||'low';return RISK_ORDER[lvl]>RISK_ORDER[max]?lvl:max;},'low');
      let summary6w=null;
      for(const row of rows){try{summary6w=JSON.parse(row.summary_6w);break;}catch{}}
      result[scope]={available:true,entry_count:rows.length,risk_level:maxRisk,summary_6w:summary6w,risk_factors:_aggregateRiskFactors(scope,rows),sources:[...new Set(rows.map(r=>r.source).filter(Boolean))]};
    }catch(e){
      result[scope]={available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{},error:'fetch_failed'};
    }
  }
  return result;
}
function _aggregateRiskFactors(scope,rows){if(scope==='ktraffic')return{accident_count:rows.filter(r=>{try{return JSON.parse(r.summary_6w)?.what?.includes('사고');}catch{return false;}}).length,entry_count:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length,accident_free_months:0};if(scope==='khealth')return{total_records:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length,medium_risk_count:rows.filter(r=>r.risk_level==='medium').length};return{entry_count:rows.length,high_risk_count:rows.filter(r=>r.risk_level==='high').length};}
async function _fetchWorkPdvRecordsL1(env,ipv6,orgId){
  try{
    const token=await _l1AdminToken(env);
    const filter=encodeURIComponent(`guid='${ipv6}' && domain='work' && affiliation_org_id='${orgId}'`);
    const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records?filter=${filter}&sort=-created&perPage=50`,{headers:{'Authorization':'Bearer '+token}});
    if(!res.ok)return{available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{},error:'fetch_failed'};
    const json=await res.json().catch(()=>null);
    const items=json?.items||[];
    if(!items.length)return{available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{}};
    const RISK_ORDER={low:0,medium:1,high:2};
    const maxRisk=items.reduce((max,r)=>{const lvl=r.risk_level||'low';return RISK_ORDER[lvl]>RISK_ORDER[max]?lvl:max;},'low');
    return{available:true,entry_count:items.length,risk_level:maxRisk,summary_6w:items.slice(0,10).map(it=>({summary:it.summary,type:it.type,created_at:it.created})),risk_factors:{},sources:[orgId]};
  }catch(e){return{available:false,entry_count:0,risk_level:'unknown',summary_6w:null,risk_factors:{},error:'fetch_failed'};}
}
// ── 2026-07-15 신설(2026-07-15 복구 — 배치1 커밋(03e8696)이 실수로
// 통째로 지웠던 걸 423d246 원본 그대로 복원): _recordConsentEvent ──
// BUG: handlePdvQuery는 2026-07-04경부터 이 함수를 호출해왔으나(조회 성공
// 시마다 pdv_entry_id를 응답에 담기 위해), 실제 정의가 이 파일에도 어느
// import 모듈에도 없었다 — 즉 지금까지 모든 PDV 조회 성공 경로가 이 줄에서
// ReferenceError를 던지고 바깥 catch(e)에 걸려 500 INTERNAL_ERROR를
// 반환했을 가능성이 높다(실운영 트래픽에서 실제로 그랬는지는 로그 확인
// 필요 — 이번 수정 범위 밖).
//
// 공무원 직무보조 갱신계획 v1.0 §5 레이어 C(92번, 개인정보 오남용 감사) 요구
// 사항을 그대로 반영: "누가, 언제, 무슨 목적으로, 몇 명분을 뽑았는지"를
// 사후에 확인 가능해야 한다. officialAudit이 있으면(=handlePdvQuery에서
// access_cert로 서명 검증까지 끝난 공무원 요청) official_guid/org_id를
// 함께 남기고, 없으면 시민의 자기 조회(self-query)로 기록한다.
//
// batch_size는 항상 1로 고정한다 — 이 경로(query.ipv6는 항상 단일 문자열)는
// 구조적으로 한 번에 한 시민만 조회 가능하다. 다수인 대상 집계·명단 추출은
// 이 함수의 대상이 아니라 별도 기관 AC 경로(트랙3, work_pdv와도 다른 축)로만
// 허용해야 한다는 원칙을 스키마 차원에서 강제한다 — 나중에 이 함수가 배열
// ipv6를 받아들이도록 "편의상" 확장되는 일이 없도록 주석으로 남겨둔다.
async function _recordConsentEvent(env,query,queryId,officialAudit=null){
  try{
    const token=await _l1AdminToken(env);
    const res=await fetch(`${L1_DEFAULT}/api/collections/pdv_query_audit_log/records`,{
      method:'POST',
      headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},
      body:JSON.stringify({
        query_id:      queryId,
        ipv6:          query.ipv6,
        svc:           _resolveSvcId(query.svc),
        scope:         query.scope,
        purpose:       query.purpose||'',
        batch_size:    1,
        official_guid: officialAudit?.official_guid||null,
        official_org:  officialAudit?.org_id||null,
        official_role: officialAudit?.role||null,
        recorded_at:   new Date().toISOString(),
      }),
    });
    if(!res.ok){
      console.warn('[PDVQuery] 감사 로그 저장 실패(L1):', res.status, await res.text().catch(()=>''));
      await _incrAuditFailureCounter(env,'l1_error').catch(()=>{});
      return null;
    }
    const row=await res.json().catch(()=>null);
    return row?.id||null;
  }catch(e){
    // 감사 로그 저장 실패가 조회 자체를 막지는 않는다(가용성 우선 — 시민이
    // 정당한 조회 도중 로그 시스템 장애로 서비스를 못 받는 상황을 피한다).
    // 2026-07-15(발견⑤ 수정): 다만 이 catch가 console.warn에만 남으면 Cloudflare
    // 실시간 로그를 그 순간 보고 있지 않은 한 아무도 모른 채 사라진다(사고실험
    // 지적사항 — 92번 감사 안전장치가 배포 파이프라인 실수로 통째로 사라졌던
    // 전례가 이미 있었음). KV 카운터에 집계해 나중에라도 실패율을 확인할 수
    // 있게 최소한의 관측성만 추가한다 — 진짜 알림(Phase 4 온나라시스템 연동)이
    // 붙기 전까지의 임시 안전망이다.
    console.warn('[PDVQuery] 감사 로그 저장 실패:',e.message);
    await _incrAuditFailureCounter(env,'exception').catch(()=>{});
    return null;
  }
}
// 2026-07-15 신설(발견⑤ 대응) — 감사 로그 저장 실패를 날짜별로 집계하는
// 최소 관측성 카운터. _checkRateLimit과 동일한 RATE_LIMIT_KV를 재사용하며
// (새 KV 바인딩 추가 없음), 이 카운터 자체의 기록 실패는 절대 상위로
// 전파하지 않는다(호출부가 이미 .catch(()=>{})로 무시하지만 이중 방어).
// 조회 결과(_fetchPdvByScope) 이후 시점에서 실행되므로 사용자 응답 지연에는
// 영향 없다 — await하되 실패해도 무해하다.
async function _incrAuditFailureCounter(env,reason){
  if(!env.RATE_LIMIT_KV)return;
  try{
    const day=new Date().toISOString().slice(0,10);
    const kvKey=`audit_fail:pdv_query:${day}:${reason}`;
    const current=parseInt(await env.RATE_LIMIT_KV.get(kvKey)||'0');
    await env.RATE_LIMIT_KV.put(kvKey,String(current+1),{expirationTtl:30*24*60*60});
  }catch{/* 카운터 자체 실패는 무시 — 원래 조회를 막지 않는다는 원칙과 동일 */}
}
async function _sha256Hex(text){const buf=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text));return Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');}
function buildCookie(token){return[`gopang_token=${token}`,'Path=/','Domain=.hondi.net','Max-Age=3600','SameSite=None','Secure','HttpOnly'].join('; ');}
function parseCookie(header,name){const match=header.match(new RegExp(`(?:^|;)\\s*${name}=([^;]+)`));return match?decodeURIComponent(match[1]):null;}
// ═══════════════════════════════════════════════════════════
// v6.0 — 세션 토큰: HMAC-SHA256 서명 (env.GOPANG_MASTER_KEY, _verifyConsentHmac/
// handleWAChallenge와 동일 패턴). 이전 버전은 base64 평문이라 누구나 임의의
// ipv6로 토큰을 위조할 수 있었다 — 서명 검증 없이는 token이 절대 발급되지 않는다.
// ═══════════════════════════════════════════════════════════
async function buildToken(env,guid,level,svc){
  const now=Math.floor(Date.now()/1000);
  const payload={ipv6:guid,level,svc,iat:now,exp:now+3600};
  const b64p=btoa(JSON.stringify(payload)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['sign']);
  const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(b64p));
  const b64s=btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');
  return `${b64p}.${b64s}`;
}
async function parseToken(env,token){
  try{
    const [b64p,b64s]=String(token).split('.');
    if(!b64p||!b64s)return null;
    const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['verify']);
    const sigBytes=Uint8Array.from(atob(b64s.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
    const sigOk=await crypto.subtle.verify('HMAC',key,sigBytes,new TextEncoder().encode(b64p));
    if(!sigOk)return null;
    const padded=b64p.replace(/-/g,'+').replace(/_/g,'/');
    const payload=JSON.parse(atob(padded+'=='.slice((padded.length%4)||4)));
    if(payload.exp<Math.floor(Date.now()/1000))return null;
    return payload;
  }catch{return null;}
}

// POST /auth/issue — v6.0: Ed25519 서명 + TOFU(Trust-On-First-Use) 검증 후에만 세션 발급
// 이전 버전은 클라이언트가 보낸 ipv6를 무검증으로 토큰화했다 — 누구나 임의의 ipv6를
// 자칭해 그 사람으로 로그인할 수 있었다(계정 탈취). 이제는 그 ipv6(guid)에 연결된
// Ed25519 개인키를 실제로 보유하고 있다는 서명 증거 없이는 토큰이 발급되지 않는다.
// body: { guid, pubkey, signature, ts, level, svc }
// 서명 대상: `auth-issue:${guid}:${pubkey}:${svc}:${ts}`
async function handleIssue(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const body=await request.json().catch(()=>null);
  if(!body)return _err(400,'INVALID_JSON','JSON body 필수',corsHeaders);
  const{guid,pubkey,signature,ts,level='L0',svc='*'}=body;
  if(!guid)      return _err(400,'MISSING_FIELD','guid 필수',corsHeaders);
  if(!pubkey)    return _err(400,'MISSING_FIELD','pubkey 필수',corsHeaders);
  if(!signature) return _err(400,'MISSING_FIELD','signature 필수',corsHeaders);
  if(!ts)        return _err(400,'MISSING_FIELD','ts 필수',corsHeaders);

  // 재전송(replay) 방지 — 서명 시각이 현재로부터 120초 이상 벗어나면 거부
  const tsNum=Number(ts);
  if(!Number.isFinite(tsNum)||Math.abs(Date.now()-tsNum)>120000){
    return _err(401,'TS_EXPIRED','서명 시각이 만료되었습니다',corsHeaders);
  }

  const sigMsg=`auth-issue:${guid}:${pubkey}:${svc}:${ts}`;
  const sigOk=await _verifyEd25519Simple(pubkey,signature,sigMsg);
  if(!sigOk)return _err(401,'INVALID_SIGNATURE','서명 검증 실패',corsHeaders);

  // TOFU: 이 guid에 이미 핀(pin)된 Ed25519 공개키와 대조 — /profile 등록 시
  // 핀이 기록된다(handleProfilePost). 핀이 있는데 다른 키로 서명했다면, 이 기기는
  // 그 계정의 정당한 기기가 아니다(다른 사람의 전화번호/닉네임을 알아냈을 뿐).
  // (2026-07-15: Supabase user_profiles → L1 이관. 이미 저장소 전반에서
  //  표준으로 쓰이는 _l1FindProfileByGuid로 교체 — 다른 여러 TOFU 체크와
  //  동일한 조회 경로를 타게 된다.)
  let existing=null;
  try{
    existing = await _l1FindProfileByGuid(env, guid);
  }catch(e){
    return _err(502,'L1_UNREACHABLE','L1 연결 실패: '+e.message,corsHeaders);
  }
  if(existing?.pubkey_ed25519 && existing.pubkey_ed25519!==pubkey){
    return _err(403,'PUBKEY_MISMATCH','이 기기는 해당 계정의 등록된 기기가 아닙니다',corsHeaders);
  }
  // existing이 없거나 pubkey_ed25519가 비어있는 경우 — 핀 기록 자체는 /profile(POST)이
  // 전담한다(단일 책임). 여기서는 "아직 아무도 핀을 선점하지 않았다"는 사실만으로
  // 통과시키며, 곧이어 /profile 호출이 이 pubkey를 핀으로 기록한다.

  const token=await buildToken(env,guid,level,svc);
  // 2026-07-04b: 쿠키(HttpOnly, .hondi.net)는 그대로 유지하되, 같은 토큰
  // 문자열을 JSON 본문에도 내려준다 — 쿠키는 워커의 실제 도메인이
  // *.hondi.net과 다르면(현재 wrangler.json에 커스텀 도메인 라우트가
  // 없다) 브라우저가 전송하지 않을 수 있다. 본문의 token은 클라이언트가
  // 직접 Authorization: Bearer 헤더로 실어 보낼 수 있어 도메인에 무관하다.
  return new Response(JSON.stringify({ok:true,guid,level,token}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(token)}});
}

async function handleVerify(request,env,corsHeaders){const cookieHeader=request.headers.get('Cookie')||'';const raw=parseCookie(cookieHeader,'gopang_token');if(!raw)return _err(401,'NO_TOKEN','no_token',corsHeaders);const payload=await parseToken(env,raw);if(!payload)return _err(401,'INVALID_TOKEN','expired_or_invalid',corsHeaders);return new Response(JSON.stringify({valid:true,ipv6:payload.ipv6,level:payload.level,svc:payload.svc,exp:payload.exp}),{status:200,headers:corsHeaders});}
async function handleRefresh(request,env,corsHeaders){const cookieHeader=request.headers.get('Cookie')||'';const raw=parseCookie(cookieHeader,'gopang_token');if(!raw)return _err(401,'NO_TOKEN','no_token',corsHeaders);const payload=await parseToken(env,raw);if(!payload)return _err(401,'INVALID_TOKEN','expired_or_invalid',corsHeaders);const remaining=payload.exp-Math.floor(Date.now()/1000);if(remaining>1800)return new Response(JSON.stringify({ok:false,reason:'not_yet',remaining}),{status:200,headers:corsHeaders});const newToken=await buildToken(env,payload.ipv6,payload.level,payload.svc);return new Response(JSON.stringify({ok:true}),{status:200,headers:{...corsHeaders,'Set-Cookie':buildCookie(newToken)}});}
// (2026-07-15 삭제 — sbFetch. handleSvcRegister(7차 배치)와
//  ai-chat-handler.js(8차 배치) 둘 다 L1로 이관되면서 유일하게 남았던
//  호출자가 사라졌다. Supabase 전용 헬퍼라 정리 대상.)
async function handleWAChallenge(request,env,corsHeaders){const challenge=crypto.getRandomValues(new Uint8Array(32));const chalB64=btoa(String.fromCharCode(...challenge)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'');const exp=Math.floor(Date.now()/1000)+300;const sigData=`${chalB64}.${exp}`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['sign']);const sig=await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(sigData));const sigHex=Array.from(new Uint8Array(sig)).map(b=>b.toString(16).padStart(2,'0')).join('');return new Response(JSON.stringify({challenge:chalB64,exp,sig:sigHex}),{status:200,headers:corsHeaders});}
async function _verifyChallengeToken(env,chalB64,exp,sig){if(exp<Math.floor(Date.now()/1000))return false;const sigData=`${chalB64}.${exp}`;const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(env.GOPANG_MASTER_KEY||'gopang-webauthn-secret-v1'),{name:'HMAC',hash:'SHA-256'},false,['verify']);const sigBytes=Uint8Array.from(sig.match(/.{2}/g).map(h=>parseInt(h,16)));return crypto.subtle.verify('HMAC',key,sigBytes,new TextEncoder().encode(sigData));}
// (2026-07-14 삭제 — handleWARegister/handleWAVerify. 라우팅 자체가
//  제거됐고(위 참고), 이 대화에서 확인한 바 저장소 전체에서
//  /auth/webauthn/register·/verify를 fetch로 실제 호출하는 클라이언트
//  코드가 없었다 — src/gopang/core/auth.js는 로컬에 저장된
//  s.webauthn?.credentialId 값을 "여러 인증 신호 중 하나"로 읽기만
//  할 뿐, 그 값을 채워 넣을 호출부 자체가 없어 항상 undefined였다.
//  Supabase webauthn_credentials 의존이라 정리 대상.)
const REGISTERED_SERVICES={'gopang':{level:3,domain:'hondi.net',minAuth:'L0',pdv:true},'klaw':{level:3,domain:'klaw.hondi.net',minAuth:'L0',pdv:true},'market':{level:3,domain:'market.hondi.net',minAuth:'L0',pdv:true},'school':{level:3,domain:'school.hondi.net',minAuth:'L0',pdv:true},'security':{level:3,domain:'security.hondi.net',minAuth:'L1',pdv:true},'health':{level:3,domain:'health.hondi.net',minAuth:'L1',pdv:true},'tax':{level:3,domain:'tax.hondi.net',minAuth:'L0',pdv:true},'gdc':{level:3,domain:'gdc.hondi.net',minAuth:'L1',pdv:true},'public':{level:3,domain:'public.hondi.net',minAuth:'L0',pdv:true},'democracy':{level:3,domain:'democracy.hondi.net',minAuth:'L1',pdv:true},'911':{level:3,domain:'911.hondi.net',minAuth:'L0',pdv:true},'police':{level:3,domain:'police.hondi.net',minAuth:'L1',pdv:true},'insurance':{level:3,domain:'insurance.hondi.net',minAuth:'L1',pdv:true},'stock':{level:3,domain:'stock.hondi.net',minAuth:'L1',pdv:true},'traffic':{level:3,domain:'traffic.hondi.net',minAuth:'L0',pdv:true},'logistics':{level:3,domain:'logistics.hondi.net',minAuth:'L0',pdv:true},'fiil':{level:2,domain:'fiil.kr',minAuth:'L0',pdv:true},'klaw-ext':{level:2,domain:'klaw.openhash.kr',minAuth:'L0',pdv:false},'users':{level:3,domain:'users.hondi.net',minAuth:'L0',pdv:false}};
function _getSvcRegistration(origin,svcId){const resolvedId=_resolveSvcId(svcId);const svc=REGISTERED_SERVICES[resolvedId];if(svc&&origin.includes(svc.domain))return{...svc,svcId:resolvedId,originalId:svcId};if(/^https:\/\/[a-z0-9-]+\.gopang\.net$/.test(origin))return{level:1,domain:origin,minAuth:'L0',pdv:false,svcId:resolvedId,originalId:svcId};return null;}
async function handleSvcRegister(request,env,corsHeaders){
  if(request.method!=='POST')return new Response('Method Not Allowed',{status:405});
  const body=await request.json().catch(()=>null);
  if(!body?.svc_id||!body?.domain||!body?.operator_ipv6)return _err(400,'MISSING_FIELD','svc_id, domain, operator_ipv6 필수',corsHeaders);
  const{svc_id,domain,description,min_auth,operator_ipv6}=body;
  const isGopangSub=/^[a-z0-9-]+\.gopang\.net$/.test(domain);
  // (2026-07-15: Supabase svc_registry → L1 이관. 컬렉션은 별도 신설
  //  없이 기존 관례대로 profiles 밖의 범용 등록부이므로, 이번엔 다른
  //  단순 CRUD 테이블들과 동일하게 svc_registry 컬렉션을 새로 만든다.)
  try {
    const token = await _l1AdminToken(env);
    await fetch(`${L1_DEFAULT}/api/collections/svc_registry/records`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        svc_id, domain, description: description || '', operator_ipv6,
        min_auth: min_auth || 'L0',
        trust_level: isGopangSub ? 1 : 0,
        status: isGopangSub ? 'auto_approved' : 'pending',
      }),
    });
  } catch (e) {
    console.warn('[SvcRegister] L1 저장 실패:', e.message);
  }
  return new Response(JSON.stringify({ok:true,svc_id,domain,trust_level:isGopangSub?1:0,status:isGopangSub?'auto_approved':'pending_review',message:isGopangSub?'*.hondi.net 서브도메인으로 자동 승인됐습니다. (Level 1)':'등록 신청이 접수됐습니다.'}),{status:200,headers:corsHeaders});
}
async function handleSvcVerify(request,env,corsHeaders){const url=new URL(request.url);const svcId=url.searchParams.get('svc_id');const origin=request.headers.get('Origin')||'';if(!svcId)return _err(400,'MISSING_FIELD','svc_id 파라미터 필수',corsHeaders);const reg=_getSvcRegistration(origin,svcId);if(!reg)return new Response(JSON.stringify({ok:false,registered:false,svc_id:svcId,message:'등록되지 않은 서비스입니다.'}),{status:200,headers:corsHeaders});return new Response(JSON.stringify({ok:true,registered:true,svc_id:svcId,trust_level:reg.level,pdv_allowed:reg.pdv,min_auth:reg.minAuth,message:`등록된 서비스 (Level ${reg.level})`}),{status:200,headers:corsHeaders});}
async function handleGeocode(url,env,corsHeaders){const lat=url.searchParams.get('lat');const lng=url.searchParams.get('lng');if(!lat||!lng)return _err(400,'MISSING_FIELD','lat, lng required',corsHeaders);try{const res=await fetch(`${KAKAO_BASE}?x=${lng}&y=${lat}&input_coord=WGS84`,{headers:{'Authorization':`KakaoAK ${env.KAKAO_REST_KEY}`}});const data=await res.json();return new Response(JSON.stringify(data),{headers:corsHeaders});}catch(e){return _err(502,'GEOCODE_ERROR',e.message,corsHeaders);}}

// 2026-07-13 신설 — 정방향 지오코딩(주소→좌표). handleGeocode(위)는
// 좌표→주소(역방향)만 지원했다 — profile-assistant가 대화로 받은 주소
// 텍스트를 좌표로 바꿀 방법이 서버에 전혀 없었다(사고실험으로 발견 —
// _l1SearchEntities의 거리순 정렬이 사업자 프로필에 대해 항상 무의미
// 했음, p.lat/p.lng가 늘 null이었기 때문). Kakao의 주소 검색 API
// (coord2address의 반대인 search/address)를 사용한다. 실패해도(주소
// 인식 불가 등) null을 반환할 뿐 예외를 던지지 않는다 — 호출부가
// "지오코딩 실패해도 프로필 저장 자체는 막지 않는다"는 원칙을 지키게.
const KAKAO_ADDRESS_SEARCH_BASE = 'https://dapi.kakao.com/v2/local/search/address.json';
async function _geocodeAddressForward(env, address) {
  if (!address || !env.KAKAO_REST_KEY) return null;
  try {
    const res = await fetch(`${KAKAO_ADDRESS_SEARCH_BASE}?query=${encodeURIComponent(address)}`, {
      headers: { 'Authorization': `KakaoAK ${env.KAKAO_REST_KEY}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    const doc = data?.documents?.[0];
    if (!doc) return null;
    return { lat: parseFloat(doc.y), lng: parseFloat(doc.x) };
  } catch (e) {
    console.warn('[Geocode] 정방향 지오코딩 실패(무시):', e.message);
    return null;
  }
}
async function handleKakaoAppKey(request,env,corsHeaders){const appkey=env.KAKAO_JS_KEY||env.KAKAO_REST_KEY;if(!appkey)return _err(500,'CONFIG_ERROR','Kakao key not configured',corsHeaders);return new Response(JSON.stringify({appkey}),{status:200,headers:{...corsHeaders,'Cache-Control':'public, max-age=300'}});}
async function handleAIChat(bodyText,env,corsHeaders,meta=null){let body;try{body=JSON.parse(bodyText);}catch{return _err(400,'INVALID_JSON','Invalid JSON',corsHeaders);}const{provider='deepseek',model,system,messages,max_tokens=2000}=body;const builtMessages=[...(system?[{role:'system',content:system}]:[]),...(messages||[])];
console.log(JSON.stringify({tag:'AI_PROXY_CALL',fn:'handleAIChat',ts:new Date().toISOString(),provider,model,...meta}));
try{if(provider!=='anthropic'){
  const _orKey=env.OPENROUTER_API_KEY||env.DEEPSEEK_API_KEY;
  const _orUrl=env.OPENROUTER_API_KEY?OR_URL:DEEPSEEK_URL;
  const _orMdl=model||(env.OPENROUTER_API_KEY?OR_MODEL_FAST:DEEPSEEK_MODEL);
  const _orHdr={'Content-Type':'application/json','Authorization':`Bearer ${_orKey}`,...(env.OPENROUTER_API_KEY?{'HTTP-Referer':'https://hondi.net','X-Title':'Hondi'}:{})};
  const res=await fetch(_orUrl,{method:'POST',headers:_orHdr,body:JSON.stringify({model:_orMdl,max_tokens,messages:builtMessages})});
  const data=await res.json();const content=data.choices?.[0]?.message?.content;
  if(!content)throw new Error('AI 응답 없음: '+JSON.stringify(data));
  return new Response(JSON.stringify({content,provider:env.OPENROUTER_API_KEY?'openrouter':'deepseek',model:_orMdl}),{status:200,headers:corsHeaders});}else{const res=await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':env.ANTHROPIC_API_KEY||env.OpenAI,'anthropic-version':'2023-06-01'},body:JSON.stringify({model:model||'claude-sonnet-4-20250514',max_tokens,...(system?{system}:{}),messages:messages||[]})});const data=await res.json();const content=data.content?.find(c=>c.type==='text')?.text;return new Response(JSON.stringify({content,provider:'anthropic'}),{status:200,headers:corsHeaders});}}catch(e){return _err(502,'AI_ERROR',e.message,corsHeaders);}}
async function callOpenAIFromGeminiBody(bodyText,env,corsHeaders,meta=null){const apiKey=env.OpenAI;if(!apiKey)return _err(500,'CONFIG_ERROR','OpenAI key not configured',corsHeaders);let geminiBody;try{geminiBody=JSON.parse(bodyText);}catch{return _err(400,'INVALID_JSON','Invalid JSON body',corsHeaders);}const systemPrompt=geminiBody.system_instruction?.parts?.[0]?.text||'';const parts=geminiBody.contents?.[0]?.parts||[];const textPart=parts.find(p=>p.text)?.text||'';const imagePart=parts.find(p=>p.inline_data);const maxTokens=geminiBody.generationConfig?.maxOutputTokens||1500;const messages=[];if(systemPrompt)messages.push({role:'system',content:systemPrompt});if(imagePart?.inline_data){messages.push({role:'user',content:[{type:'image_url',image_url:{url:`data:${imagePart.inline_data.mime_type};base64,${imagePart.inline_data.data}`}},{type:'text',text:textPart||'이미지를 분석하여 JSON으로만 출력하라.'}]});}else{messages.push({role:'user',content:textPart});}
console.log(JSON.stringify({tag:'AI_PROXY_CALL',fn:'callOpenAIFromGeminiBody',ts:new Date().toISOString(),...meta}));
try{const res=await fetch(OPENAI_URL,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${apiKey}`},body:JSON.stringify({model:OPENAI_MODEL,messages,max_tokens:maxTokens,temperature:geminiBody.generationConfig?.temperature??0.1})});const data=await res.json();if(!res.ok)throw new Error(data.error?.message||`HTTP ${res.status}`);const text=data.choices?.[0]?.message?.content||'{}';return new Response(JSON.stringify({candidates:[{content:{parts:[{text}],role:'model'},finishReason:'STOP'}],_provider:'openai',_model:OPENAI_MODEL}),{headers:corsHeaders});}catch(e){const fbBody=JSON.stringify({model:DEEPSEEK_MODEL,messages,max_tokens:maxTokens,temperature:0.1,stream:false});return callDeepSeek(fbBody,env,corsHeaders,e.message,meta);}}
async function callDeepSeek(bodyText,env,corsHeaders,fallbackFrom=null,meta=null,ctx=null){try{
  let parsedBody = null; try { parsedBody = JSON.parse(bodyText); } catch {}
  const isStream = !!parsedBody?.stream;
  const guid = parsedBody?.guid || null;

  // ── 티어 해석: 클라이언트는 "hondi-flash"/"hondi-pro" 논리 이름만 보낸다.
  // 알려진 티어 이름이면 실제 벤더 모델명으로 치환하고, 아니면(레거시 호출 등)
  // 받은 model 값을 그대로 쓴다 — 하위 호환.
  const requestedModel = parsedBody?.model || '';
  const tierKey = HONDI_TIER_MODELS[requestedModel] ? requestedModel : null;
  // 알려진 티어명("hondi-flash" 등)이면 그 tier의 backendModel을 쓰고,
  // 아니면(레거시 직접 호출 등) requestedModel을 resolveDeepseekModel로
  // 한 번 더 정규화한다 — 'deepseek-chat'/'deepseek-reasoner' 같은
  // 폐기 예정 별칭이 그대로 들어와도 여기서 걸러진다.
  const backendModel = tierKey ? HONDI_TIER_MODELS[tierKey].backendModel : resolveDeepseekModel(requestedModel);

  // guid가 실려 있으면(=call-ai.js의 deepseek-default 경로) 1,000원 누적 한도 체크.
  let outboundBody = parsedBody ? { ...parsedBody, model: backendModel } : null;
  if (outboundBody) delete outboundBody.guid; // 벤더 API는 guid 필드를 모름

  // UNIVERSAL 레이어 서버 강제 주입 (2026-07-05, handleLLMRelay와 동일 목록/원칙).
  // 이 경로(callDeepSeek)는 gdc처럼 messages 배열이 아니라 별도 system
  // 필드를 쓰는 클라이언트도 있어(client-shape 불일치), 두 형태 모두 지원한다.
  if (outboundBody && parsedBody?.service_id && UNIVERSAL_FORCED_K_SERVICES.has(parsedBody.service_id)) {
    delete outboundBody.service_id; // 벤더 API는 이 필드를 모름
    const [universalIntegrity, universalCommon] = await Promise.all([
      _fetchUniversalIntegrity(), _fetchUniversalCommon(),
    ]);
    const injected = [universalIntegrity, universalCommon].filter(Boolean).join('\n\n---\n\n');
    if (injected) {
      if (Array.isArray(outboundBody.messages)) {
        outboundBody.messages = [{ role: 'system', content: injected }, ...outboundBody.messages];
      } else if (typeof outboundBody.system === 'string') {
        outboundBody.system = injected + '\n\n---\n\n' + outboundBody.system;
      }
    }
    console.log(JSON.stringify({ tag: 'DEEPSEEK_UNIVERSAL_INJECTED', service_id: parsedBody.service_id, ts: new Date().toISOString(), ...meta }));
  } else if (outboundBody) {
    delete outboundBody.service_id; // 강제대상 아니어도 벤더 API로 그대로 넘기지 않음
  }

  let outboundBodyText = outboundBody ? JSON.stringify(outboundBody) : bodyText;

  // (2026-07-14: "가입자당 100원 무료 한도" 게이트. guid가 있다는 것 자체가
  //  가입자라는 뜻이므로(익명 모드 없음 — FREE_QUOTA_KRW_LIMIT 선언부 주석
  //  참조), 별도의 profiles 조회 없이 guid 존재만으로 자격을 인정한다.
  //  100원을 다 쓴 뒤에는 이제 GDC 유료 차감 파이프라인이 연결되어 있으므로
  //  (L1 /api/ai-charge — SP-GDC-BILLING-v2_0 STEP 0/3) 즉시 차단하지
  //  않고, 실제 GDC 잔액을 확인해 최소 예약금 이상이면 통과시킨다. 잔액도
  //  부족하면 그때 비로소 차단한다 — "무료로 새는 것"도 "무제한 통과"도
  //  아니라, 정확히 "낸 만큼만 쓸 수 있다"가 최종 상태다.)
  if (guid && FREE_QUOTA_ENFORCEMENT_ENABLED) {
    const kv = env.AI_SETUP_SEALS_KV;
    if (kv) {
      const spendKey = `hondi:free_spend:${guid}`;
      const spent = parseFloat(await kv.get(spendKey) || '0');
      if (spent >= FREE_QUOTA_KRW_LIMIT) {
        // 무료 한도 소진 — STEP 0 2단계: GDC 잔액 확인. 일반 대화 1턴의
        // 실제 원가는 대략 1~3원 수준(SP-GDC-BILLING-v1.0 STEP 2-3 계산
        // 예시 참고)이므로, 최소 예약금 3원을 문턱값으로 둔다 — v1.0의
        // 정밀 reserve_μT 홀드 대신 채택한 단순화(파일 상단 _l1GetBalanceKRW
        // 주석 참고).
        const AI_CHARGE_MIN_RESERVE_KRW = 3;
        const balanceKRW = await _l1GetBalanceKRW(guid);
        if (balanceKRW === null) {
          // L1 잔액 조회 자체가 실패한 경우: 과금 상태를 확인할 수 없는
          // 채로 통과시키면 무제한 무료로 새는 것과 같으므로, 안전하게
          // 차단한다(무료 한도 소진 전 정상 이용에는 영향 없음 — 이 분기는
          // 애초에 100원을 다 쓴 뒤에만 탄다).
          console.warn(JSON.stringify({ tag: 'GDC_BALANCE_CHECK_FAILED', guid, ts: new Date().toISOString(), ...meta }));
          return new Response(JSON.stringify({
            error: 'GDC_BALANCE_CHECK_FAILED',
            message: '잔액 확인에 실패했습니다. 잠시 후 다시 시도해 주세요.',
          }), { status: 502, headers: corsHeaders });
        }
        if (balanceKRW < AI_CHARGE_MIN_RESERVE_KRW) {
          console.warn(JSON.stringify({ tag: 'GDC_INSUFFICIENT_BALANCE', guid, spent, balanceKRW, ts: new Date().toISOString(), ...meta }));
          return new Response(JSON.stringify({
            error: 'GDC_INSUFFICIENT_BALANCE',
            message: `무료 한도(${FREE_QUOTA_KRW_LIMIT}원)를 모두 사용했고 GDC 잔액도 부족합니다. GDC를 충전한 뒤 다시 이용해 주세요.`,
            spent_krw: Math.round(spent),
            balance_krw: Math.round(balanceKRW),
          }), { status: 402, headers: corsHeaders });
        }
        // 잔액 충분 — 통과. 실제 차감은 이번 요청의 실사용량이 확정된
        // 뒤(_recordAiUsage → _settleAiUsage → /api/ai-charge)에 일어난다.
      }
    }
  }


  // ── 백엔드 선택: 혼디 자체 서버(준비되면) > OpenRouter > 공식 DeepSeek API ──
  const _useSelfHost = _selfHostReady(env);
  const _useOR = !_useSelfHost && !!env.OPENROUTER_API_KEY;
  const _url = _useSelfHost ? env.HONDI_SELFHOST_URL : (_useOR ? OR_URL : DEEPSEEK_URL);
  const _key = _useSelfHost ? env.HONDI_SELFHOST_API_KEY : (_useOR ? env.OPENROUTER_API_KEY : env.DEEPSEEK_API_KEY);
  console.log(JSON.stringify({tag:'AI_PROXY_CALL',fn:'callDeepSeek',ts:new Date().toISOString(),target:_useSelfHost?'hondi-selfhost':(_useOR?'openrouter':'deepseek'),tier:tierKey,model:backendModel,guid,fallbackFrom,...meta}));
  const res=await fetch(_url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${_key}`,...(_useOR?{'HTTP-Referer':'https://hondi.net','X-Title':'Hondi'}:{})},body:outboundBodyText});
  if(!res.ok){const errText=await res.text();let errMsg;try{errMsg=JSON.parse(errText)?.error?.message;}catch{}return new Response(JSON.stringify({error:errMsg||`HTTP ${res.status}`}),{status:res.status,headers:corsHeaders});}

  const spendTier = tierKey || 'hondi-flash'; // 레거시 호출은 flash 단가로 보수적 계산
  if(isStream){
    if (guid && env.AI_SETUP_SEALS_KV) {
      const [forClient, forUsage] = res.body.tee();
      const usageTask = _parseUsageFromStream(forUsage).then(usage => _recordAiUsage(env, ctx, {
        guid, serviceId: 'hondi-chat', tier: spendTier, priceTier: spendTier, model: backendModel, usage,
        logTag: 'HONDI_CHAT_COST', extraLogFields: meta,
        // (2026-07-14: 무료 한도 100원을 넘는 사용량은 이제 GDC 잔액에서
        //  실제로 차감된다 — _settleAiUsage가 무료/유료 경계를 나눠 처리)
        onAfterRecord: bill => _settleAiUsage(env, guid, bill, {
          serviceId: 'hondi-chat', model: backendModel,
          hitTokens: usage?.prompt_cache_hit_tokens, missTokens: usage?.prompt_cache_miss_tokens,
          outTokens: usage?.completion_tokens,
        }),
      }));
      if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
      return new Response(forClient,{status:200,headers:{...corsHeaders,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
    }
    return new Response(res.body,{status:200,headers:{...corsHeaders,'Content-Type':'text/event-stream','Cache-Control':'no-cache','X-Accel-Buffering':'no'}});
  }
  const data=await res.json();
  if (guid && env.AI_SETUP_SEALS_KV && data?.usage) {
    _recordAiUsage(env, ctx, {
      guid, serviceId: 'hondi-chat', tier: spendTier, priceTier: spendTier, model: backendModel, usage: data.usage,
      logTag: 'HONDI_CHAT_COST', extraLogFields: meta,
      onAfterRecord: bill => _settleAiUsage(env, guid, bill, {
        serviceId: 'hondi-chat', model: backendModel,
        hitTokens: data.usage?.prompt_cache_hit_tokens, missTokens: data.usage?.prompt_cache_miss_tokens,
        outTokens: data.usage?.completion_tokens,
      }),
    });
  }
  if(fallbackFrom){const text=data.choices?.[0]?.message?.content||'{}';return new Response(JSON.stringify({candidates:[{content:{parts:[{text}],role:'model'},finishReason:'STOP'}],_provider:'deepseek-fallback',_fallback_from:fallbackFrom}),{headers:corsHeaders});}
  return new Response(JSON.stringify(data),{headers:corsHeaders});
}catch(e){return _err(502,'DEEPSEEK_ERROR',e.message,corsHeaders);}}


// ═══════════════════════════════════════════════════════════
// /llm/relay — 사용자 본인 키(BYOK) 범용 중계 (2026-06-29)
//
// 배경: ai-setup-mobile.html에서 등록한 사용자 본인 키로 DeepSeek 등을
// "브라우저에서 직접" 호출하던 기존 클라이언트 코드가 CORS에 막혔다(대부분
// LLM 벤더 API는 브라우저발 요청을 허용하지 않음 — 서버 간 호출만 허용).
// 무료 폴백(gopang-proxy)이 항상 마지막에 받아주던 시절엔 이게 안 드러났다.
//
// 이 엔드포인트는 "무료 모델을 제공"하는 게 아니다 — 사용자가 직접 등록한
// 키를 그대로, 그 사용자가 고른 모델로, 서버를 한 번 거쳐서만 전달한다
// (서버 간 호출은 CORS 대상이 아님). 비용은 여전히 사용자 본인의 키로 청구됨.
//
// 보안: baseUrl을 알려진 LLM 벤더 호스트로만 제한한다(그 외 호스트로의
// 임의 중계를 막아 이 엔드포인트가 오픈 프록시/SSRF 통로가 되는 것을 방지).
//
// 범위: OpenAI 호환(/chat/completions, 같은 요청·응답 스키마) 벤더만 지원—
// DeepSeek·Gemini(OpenAI 호환 레이어)·OpenAI·Grok·OpenRouter. Claude(Anthropic)는
// 엔드포인트 경로(/v1/messages)와 요청·응답 스키마 자체가 달라서 이 범용
// 중계로 안 된다 — 별도 작업 필요(지금은 일부러 손 안 댐).
// ═══════════════════════════════════════════════════════════
const ALLOWED_LLM_RELAY_HOSTS = new Set([
  'generativelanguage.googleapis.com', // Gemini (OpenAI 호환 레이어)
  'api.deepseek.com',
  'api.x.ai',                          // Grok
  'openrouter.ai',
  'api.openai.com',
  // 'api.anthropic.com' 의도적으로 제외 — OpenAI 호환 스키마가 아님
]);

// K서비스 중 전용 relay(klaw/gov/business)가 없는 14개 — 이 id로 호출하면
// UNIVERSAL-INTEGRITY+UNIVERSAL-common을 서버가 강제로 앞에 붙인다.
// (2026-07-05 신설 — SP-CATALOG_v1_0.md에서 발견한 불일치 해소: 이 목록
// 밖의 klaw/gov/business는 이미 각자 전용 relay에서 처리하므로 제외.
// jeju/kgov는 'gov' 하나로 이미 처리되지만, 클라이언트가 실수로 이
// 목록에 'kgov'를 넣어 보내도 중복 주입만 될 뿐 해는 없다.)
const UNIVERSAL_FORCED_K_SERVICES = new Set([
  'kemergency', 'kpolice', 'ksecurity', 'khealth', 'kedu', 'kgdc',
  'kfinance', 'kinsurance', 'ktax', 'kcommerce', 'ktransport',
  'klogistics', 'kdemocracy', 'fiil-kcleaner',
]);

async function handleLLMRelay(bodyText, env, corsHeaders, meta = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { provider, baseUrl, apiKey, model, messages, max_tokens, temperature, stream, service_id } = body || {};
  if (!baseUrl || !apiKey || !model || !Array.isArray(messages)) {
    return _err(400, 'MISSING_FIELD', 'baseUrl/apiKey/model/messages 필수', corsHeaders);
  }

  // UNIVERSAL 레이어 서버 강제 주입 — 클라이언트가 service_id를 보내지
  // 않거나 목록 밖이면 기존 동작 그대로(주입 없음, 예: 메인 AGENT-COMMON
  // 채팅·BYOK 일반 호출). 클라이언트가 조립한 system 메시지를 대체하지
  // 않고 그 앞에 별도 system 메시지로 추가한다(klaw/relay와 동일 방식 —
  // 각 K서비스 SP가 이미 갖고 있을 수도 있는 자체 규칙과 중복되더라도
  // "모든 SP가 이 문서를 상속한다"는 원칙을 예외 없이 지키기 위함).
  let relayMessages = messages;
  if (service_id && UNIVERSAL_FORCED_K_SERVICES.has(service_id)) {
    const [universalIntegrity, universalCommon] = await Promise.all([
      _fetchUniversalIntegrity(), _fetchUniversalCommon(),
    ]);
    const injected = [universalIntegrity, universalCommon].filter(Boolean).join('\n\n---\n\n');
    if (injected) relayMessages = [{ role: 'system', content: injected }, ...messages];
    console.log(JSON.stringify({ tag: 'LLM_RELAY_UNIVERSAL_INJECTED', service_id, ts: new Date().toISOString(), ...meta }));
  }

  let targetHost;
  try { targetHost = new URL(baseUrl).host; } catch { return _err(400, 'INVALID_BASEURL', 'baseUrl 형식이 올바르지 않습니다', corsHeaders); }
  if (!ALLOWED_LLM_RELAY_HOSTS.has(targetHost)) {
    console.warn(JSON.stringify({ tag: 'LLM_RELAY_HOST_BLOCKED', host: targetHost, ts: new Date().toISOString(), ...meta }));
    return _err(403, 'HOST_NOT_ALLOWED', `허용되지 않은 호스트: ${targetHost}`, corsHeaders);
  }

  const targetUrl = baseUrl.replace(/\/+$/, '') + '/chat/completions';
  const isStream  = !!stream;

  const headers = { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` };
  if (provider === 'openrouter') { headers['HTTP-Referer'] = 'https://hondi.net'; headers['X-Title'] = 'Hondi'; }

  const payload = { model, messages: relayMessages, stream: isStream };
  if (max_tokens  != null) payload.max_tokens  = max_tokens;
  if (temperature != null) payload.temperature = temperature;

  console.log(JSON.stringify({ tag: 'LLM_RELAY_CALL', provider: provider || targetHost, model, stream: isStream, ts: new Date().toISOString(), ...meta }));

  try {
    const res = await fetch(targetUrl, { method: 'POST', headers, body: JSON.stringify(payload) });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return new Response(errText || JSON.stringify({ error: `HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
    }
    if (isStream) {
      return new Response(res.body, {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
      });
    }
    const data = await res.text();
    return new Response(data, { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    return _err(502, 'RELAY_ERROR', e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// /klaw/relay — K-Law 전용 공유 계정 릴레이 (2026-07-02)
//
// 배경: DeepSeek 계정 1개(guid 무관, K-Law 전용 발급 키 — 없으면 공용
// DEEPSEEK_API_KEY로 폴백)를 100여 명이 동시에 공유하며 API 비용을 나눠
// 부담한다. gopang 일반 챗(가입자당 100원 무료 한도 소진 후에는 현재
// 차단 — GDC 유료 차감 미연결, 2026-07-14 정책 확정)과는 별개의 예산으로
// 관리한다 — K-Law 판결 시뮬레이션은 호출당 비용이 훨씬 크므로 같은
// 버킷을 쓰면 일반 챗의 무료 한도 소진 속도에 영향을 준다.
// 방어선 3중: (1) 1인 1일 KRW 한도 (2) 계정 전체 1일 예산 상한
// (3) 1인 1일 "판결 생성"(STEP 0~C 풀사이클) 횟수 한도.
// ═══════════════════════════════════════════════════════════
const KLAW_TIER_MODELS = {
  'klaw-flash': { backendModel: 'deepseek-v4-flash', price: { cacheHit: 0.0028, cacheMiss: 0.14,  output: 0.28 } }, // 인터뷰·분석 — 경량
  'klaw-pro':   { backendModel: 'deepseek-v4-pro',   price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 } }, // STEP 0~C 판결 생성 — 추론
};
const KLAW_USER_DAILY_KRW_LIMIT   = 300;    // 1인 1일 한도(원)
const KLAW_GLOBAL_DAILY_KRW_LIMIT = 30000;  // 계정 전체 1일 예산 상한(원) — 공유 계정 보호
const KLAW_USER_DAILY_STEP_LIMIT  = 3;      // 1인 1일 "판결 생성"(STEP 0~C) 횟수 한도

function _todayKey() { return new Date().toISOString().slice(0, 10); } // YYYY-MM-DD (UTC 기준 일 단위 리셋)
const _KLAW_KV_TTL = 60 * 60 * 30; // 30시간 — 자정 경계 안전마진을 둔 1일 리셋

async function _klawSpendGet(env, key) {
  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return 0;
  return parseFloat(await kv.get(key) || '0');
}
async function _klawSpendAdd(env, key, amount) {
  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv || !amount) return;
  try {
    const prev = await _klawSpendGet(env, key);
    await kv.put(key, String(prev + amount), { expirationTtl: _KLAW_KV_TTL });
  } catch (e) { console.warn('[KLaw] 지출 기록 실패:', e.message); }
}

async function handleKlawRelay(bodyText, env, corsHeaders, meta = null, ctx = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { guid, tier, messages, max_tokens, stream, step_cycle } = body || {};
  if (!guid || !Array.isArray(messages)) return _err(400, 'MISSING_FIELD', 'guid/messages 필수', corsHeaders);

  // UNIVERSAL-INTEGRITY·UNIVERSAL-common 서버측 강제 주입(2026-07-04 신설,
  // 2026-07-20 UNIVERSAL-common 추가) — K-Law는 클라이언트가 시스템 메시지를
  // 직접 조립해 보내는 구조(/gov/relay와 다름)라, 클라이언트의 system
  // 메시지를 대체하지는 않되 그 앞에 별도 system 메시지로 추가한다.
  // ★ 2026-07-20 실사로 발견: UNIVERSAL-common은 그동안 이 릴레이에서
  // 누락돼 있었다 — U7-3·U8·U11 등이 K-Law에는 적용되지 않고 있었다.
  const [universalIntegrity, universalCommon] = await Promise.all([
    _fetchUniversalIntegrity(), _fetchUniversalCommon(),
  ]);
  const universalInjected = [universalIntegrity, universalCommon].filter(Boolean).join('\n\n---\n\n');
  const messagesWithIntegrity = universalInjected
    ? [{ role: 'system', content: universalInjected }, ...messages]
    : messages;

  const tierKey = KLAW_TIER_MODELS[tier] ? tier : 'klaw-flash';
  const backendModel = KLAW_TIER_MODELS[tierKey].backendModel;

  const day       = _todayKey();
  const userKey   = `klaw:spend:${guid}:${day}`;
  const globalKey = `klaw:spend:global:${day}`;
  const stepKey   = `klaw:steps:${guid}:${day}`;

  const [userSpent, globalSpent, stepCount] = await Promise.all([
    _klawSpendGet(env, userKey), _klawSpendGet(env, globalKey), _klawSpendGet(env, stepKey)
  ]);

  if (globalSpent >= KLAW_GLOBAL_DAILY_KRW_LIMIT) {
    return _err(429, 'KLAW_GLOBAL_QUOTA_EXCEEDED', '오늘 K-Law 전체 이용자의 사용량이 한도에 도달했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }
  if (userSpent >= KLAW_USER_DAILY_KRW_LIMIT) {
    return _err(429, 'KLAW_USER_QUOTA_EXCEEDED', '오늘 사용 가능한 K-Law 한도를 모두 사용했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }
  if (step_cycle && stepCount >= KLAW_USER_DAILY_STEP_LIMIT) {
    return _err(429, 'KLAW_STEP_LIMIT_EXCEEDED', `오늘 판결 시뮬레이션 생성 한도(${KLAW_USER_DAILY_STEP_LIMIT}회)를 모두 사용했습니다. 내일 다시 이용해 주세요.`, corsHeaders);
  }

  const isStream = !!stream;
  const payload = { model: backendModel, messages: messagesWithIntegrity, stream: isStream };
  if (max_tokens != null) payload.max_tokens = max_tokens;

  console.log(JSON.stringify({ tag:'KLAW_RELAY_CALL', guid, tier: tierKey, stream: isStream, userSpent, globalSpent, ts: new Date().toISOString(), ...meta }));

  const t0 = Date.now(); // 과금에는 쓰지 않음 — 로그 진단(지연 모니터링) 용도로만 유지
  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      // ★ SP-COMMON-05 H6: 모든 서브시스템이 반드시 같은 API 키를 공유해야
      // 캐시 공유(계층 상속의 토큰 절약 전제)가 성립한다. 과거엔 전용 키
      // KLAW_DEEPSEEK_API_KEY가 있으면 그걸 우선 쓰는 폴백이 있었는데,
      // 이게 실수로라도 등록되면 조용히(에러 없이) K-Law만 캐시 공유에서
      // 이탈하는 위험이 있어 폴백 자체를 제거했다 — 정책을 코드로 강제.
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (e) { return _err(502, 'KLAW_RELAY_ERROR', e.message, corsHeaders); }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return new Response(errText || JSON.stringify({ error:`HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
  }

  const priceTier = tierKey === 'klaw-pro' ? 'hondi-pro' : 'hondi-flash'; // _deepseekUsageToKRW는 hondi-* 가격표를 조회하므로 매핑
  const recordStep = async () => { if (step_cycle) await _klawSpendAdd(env, stepKey, 1); };

  if (isStream) {
    const [forClient, forUsage] = res.body.tee();
    const usageTask = _parseUsageFromStream(forUsage).then(usage => _recordAiUsage(env, ctx, {
      guid, serviceId: 'klaw', tier: tierKey, priceTier, model: backendModel, usage,
      logTag: 'KLAW_RELAY_COST', extraLogFields: { elapsedMs: Date.now() - t0, ...meta },
      spendKeys: [userKey, globalKey], onAfterRecord: recordStep,
    }));
    if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
    return new Response(forClient, { status:200, headers:{ ...corsHeaders, 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' } });
  }

  const data = await res.json();
  if (data?.usage) {
    _recordAiUsage(env, ctx, {
      guid, serviceId: 'klaw', tier: tierKey, priceTier, model: backendModel, usage: data.usage,
      logTag: 'KLAW_RELAY_COST', extraLogFields: { elapsedMs: Date.now() - t0, ...meta },
      spendKeys: [userKey, globalKey], onAfterRecord: recordStep,
    });
  }
  return new Response(JSON.stringify(data), { headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// /gov/relay — K-Public 산하 모든 국가기관 AI 공용 릴레이 (2026-07-03)
//
// SP-COMMON-05 H2/H6 강제 조치: 클라이언트는 시스템 메시지를 직접 조립하지
// 않는다. 서버가 K-Public_common_v1_0.md를 GitHub에서 캐시 fetch해 항상
// system 맨 앞에 붙이고, 클라이언트가 보낸 messages 중 role:'system'은
// 전부 무시한다 — 클라이언트 코드가 실수(또는 고의)로 공통 규칙을
// 빠뜨리거나 조작할 수 있는 여지를 구조적으로 없앤다.
// ═══════════════════════════════════════════════════════════
// ★ 2026-07-20 정정: sp-catalog.json에 "K-Public_common" 키를 신설하고
// manifest 경로로 전환해 이 클래스의 버그를 근본적으로 없앤다.
let _kPublicCommonCache = null;
let _kPublicCommonCacheAt = 0;
const _K_PUBLIC_COMMON_TTL_MS = 10 * 60 * 1000; // 10분 — 문서 갱신 반영 최대 지연

// ═══════════════════════════════════════════════════════════
// UNIVERSAL-common — 정체성 무관 절차·원칙(U1~U8) (2026-07-05 신설)
// K-Public_common v1.2의 P2~P11을 정체성 무관 공통부로 추출한 문서.
// 국가기관(K-Public_common)·전문가 보조 모듈(PROFESSIONAL-common)
// 양쪽 모두 이 문서를 상속한다.
// ═══════════════════════════════════════════════════════════
// 2026-07-15(사고실험, job-assist 모듈 신설 중 발견) — 이 URL이 v1_3에 박제된 채
// 방치돼 있었다. 실제 파일은 v1_5까지 올라갔고, v1.4(U10-5 emd: 접두어)·
// v1.5(U1 "업무 직접 실행" 명문화)가 이 fetch 경로로는 한 번도 반영된 적이
// 없었다는 뜻이다 — UNIVERSAL-common을 상속하는 모든 institutional SP(국가기관·
// 전문가보조 계열 전체)가 몇 주간 구버전 U1~U8만 받고 있었을 가능성이 있다.
// UNIVERSAL-INTEGRITY가 2026-07-09에 이 정확한 위험(하드코딩 URL의 버전 박제)을
// 피하려고 manifest 체계로 전환했었는데, UNIVERSAL-common은 그 전환에서
// 빠져 있었다 — 이번엔 우선 버전 문자열만 수정하고, manifest 전환은 별도
// 과제로 남긴다(worker.js는 서버 쪽이라 client-side _loadSpByKey 체계와
// 통합하려면 별도 설계가 필요함).
// 2026-07-16: v1_5 → v1_6 갱신(U0 "의도 특정 후 해법 제시" 신설 반영).
// 지난 v1_3→v1_5 박제 사고(위 주석 참조)를 반복하지 않으려면, 이 URL의
// 버전 문자열이 실제 최신 prompts/UNIVERSAL-common_*.md 파일과 항상
// 일치하는지 파일 변경 시마다 이 상수도 같이 갱신해야 한다는 점을
// 다시 한번 명시해둔다 — 근본적으로는 sp-catalog.json 같은 manifest
// 기반 조회로 옮기는 게 맞지만, 이번 변경 범위에는 포함하지 않았다.
// 2026-07-20 정정: 위 경고가 세 번째로 재현될 뻔했다 — UNIVERSAL-common에
// U11(사용자 현황·성향 우선 파악 원칙)을 신설하며 파일을 v1_7→v1_8로
// 올렸는데, 이 하드코딩 URL을 그대로 뒀다면 K-Service·공공기관 AC·개인
// AC 전부가 U11 없는 v1.7을 계속 받았을 것이다. UNIVERSAL-INTEGRITY가
// 이미 쓰고 있는 `_fetchByManifestKeyFromGithub()`(sp-catalog.json 경유)
// 로 전환해 이 클래스의 버그를 구조적으로 제거한다.
let _universalCommonCache = null;
let _universalCommonCacheAt = 0;
const _UNIVERSAL_COMMON_TTL_MS = 10 * 60 * 1000;

async function _fetchUniversalCommon() {
  const now = Date.now();
  if (_universalCommonCache && (now - _universalCommonCacheAt) < _UNIVERSAL_COMMON_TTL_MS) return _universalCommonCache;
  try {
    _universalCommonCache = await _fetchByManifestKeyFromGithub('UNIVERSAL-common');
    _universalCommonCacheAt = now;
  } catch (e) {
    console.warn('[UniversalCommon] 로드 실패:', e.message);
    if (!_universalCommonCache) _universalCommonCache = '';
  }
  return _universalCommonCache;
}

// ═══════════════════════════════════════════════════════════
// PROFESSIONAL-common — 전문가 보조 모듈(K-Doctor 등) 정체성 레이어
// (2026-07-05 신설). khealth는 K-Public_common(국가기관 정체성) 대신
// 이 문서를 상속한다 — "국가기관을 대신한다"고 잘못 자기소개하던
// 버그를 구조적으로 해소.
// ═══════════════════════════════════════════════════════════
let _professionalCommonCache = null;
let _professionalCommonCacheAt = 0;
const _PROFESSIONAL_COMMON_TTL_MS = 10 * 60 * 1000;

async function _fetchProfessionalCommon() {
  const now = Date.now();
  if (_professionalCommonCache && (now - _professionalCommonCacheAt) < _PROFESSIONAL_COMMON_TTL_MS) return _professionalCommonCache;
  try {
    _professionalCommonCache = await _fetchByManifestKeyFromGithub('PROFESSIONAL-common');
    _professionalCommonCacheAt = now;
  } catch (e) {
    console.warn('[ProfessionalCommon] 로드 실패:', e.message);
    if (!_professionalCommonCache) _professionalCommonCache = '';
  }
  return _professionalCommonCache;
}

// agency별로 어떤 "정체성 레이어"를 상속하는지 — health는 국가기관이
// 아니라 전문가(의사) 보조 모듈이므로 PROFESSIONAL-common을 쓴다.
const PROFESSIONAL_IDENTITY_AGENCIES = new Set(['health']);

// ═══════════════════════════════════════════════════════════
// UNIVERSAL-INTEGRITY — 트랙 무관 전체 SP 최상위 공통 원칙 (2026-07-04 신설)
// K-Law v15.1의 확신도 이원화·불확실 식별자 생성 차단 메커니즘을 일반화한
// 문서. K-Public_common보다도 먼저 로드되어야 한다(§U5 — "어떻게 판단
// 하는가"가 "누구로서 응답하는가"보다 앞선다).
//
// 2026-07-09 정정: 파일명(_v1_0)을 하드코딩하고 있었다 — 클라이언트 쪽
// expert-chat.html이 COMMON_GUARDRAILS_URL을 하드코딩해 SP_lawyer가
// v3.2에 몇 주간 고정돼 있던 것과 정확히 같은 종류의 위험이다(실사로
// 발견·수정한 사례, manifest-loader.js 참조). 여기도 같은 원리로
// GitHub raw의 sp-catalog.json을 먼저 읽어 최신 파일명을 알아낸 뒤 그
// 파일을 가져오도록 바꾼다 — UNIVERSAL-INTEGRITY는 지금 버전이 1개뿐이라
// 당장 깨진 상태는 아니었지만, v2가 생기는 순간 조용히 stale해질
// 뻔한 걸 미리 막는다.
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main';
let _githubManifestCache = null;
let _githubManifestCacheAt = 0;
const _GITHUB_MANIFEST_TTL_MS = 10 * 60 * 1000;

async function _fetchGithubManifest() {
  const now = Date.now();
  if (_githubManifestCache && (now - _githubManifestCacheAt) < _GITHUB_MANIFEST_TTL_MS) return _githubManifestCache;
  const res = await fetch(`${GITHUB_RAW_BASE}/prompts/sp-catalog.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`sp-catalog.json fetch 실패: HTTP ${res.status}`);
  _githubManifestCache = await res.json();
  _githubManifestCacheAt = now;
  return _githubManifestCache;
}

async function _fetchByManifestKeyFromGithub(manifestKey) {
  const manifest = await _fetchGithubManifest();
  const fname = manifest[manifestKey];
  if (!fname) throw new Error(`manifest 키 없음: ${manifestKey}`);
  const res = await fetch(`${GITHUB_RAW_BASE}/prompts/${fname}`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${manifestKey} 로드 실패: HTTP ${res.status} (${fname})`);
  return res.text();
}

let _universalIntegrityCache = null;
let _universalIntegrityCacheAt = 0;
const _UNIVERSAL_INTEGRITY_TTL_MS = 10 * 60 * 1000;

async function _fetchUniversalIntegrity() {
  const now = Date.now();
  if (_universalIntegrityCache && (now - _universalIntegrityCacheAt) < _UNIVERSAL_INTEGRITY_TTL_MS) return _universalIntegrityCache;
  try {
    _universalIntegrityCache = await _fetchByManifestKeyFromGithub('UNIVERSAL-INTEGRITY');
    _universalIntegrityCacheAt = now;
  } catch (e) {
    console.warn('[UniversalIntegrity] 로드 실패:', e.message);
    if (!_universalIntegrityCache) _universalIntegrityCache = '';
  }
  return _universalIntegrityCache;
}

async function _fetchKPublicCommon() {
  const now = Date.now();
  if (_kPublicCommonCache && (now - _kPublicCommonCacheAt) < _K_PUBLIC_COMMON_TTL_MS) return _kPublicCommonCache;
  try {
    _kPublicCommonCache = await _fetchByManifestKeyFromGithub('K-Public_common');
    _kPublicCommonCacheAt = now;
  } catch (e) {
    console.warn('[GovRelay] K-Public 공통 규칙 로드 실패:', e.message);
    if (!_kPublicCommonCache) _kPublicCommonCache = ''; // 완전 실패해도 서비스 자체는 지속(경고만)
  }
  return _kPublicCommonCache;
}

// agency 식별자 허용 목록 — K-Law는 다음 개정 때 이 경로로 통합 예정(현재는 /klaw/relay 유지)
// REGISTERED_SERVICES 키와 완전히 동일하게 통일(하이픈 접두어 제거) —
// /pdv/report의 _getSvcRegistration()이 이 값을 그대로 svc 키로 쓰기 때문에
// 여기서 어긋나면 PDV 저장이 조용히 실패한다. province/city/county는 별도
// 서비스로 등록돼 있지 않고(모두 'public' 하나로 처리) 실제 코드에서 보낸
// 적도 없어 제거.
const GOV_AGENCIES = new Set([
  'public', 'tax', 'health', 'police', '911', 'democracy', 'insurance',
  'traffic', 'logistics',
  // 2026-07-05 추가: jeju_do/jeju_national을 SP_DELEGATION_ORIGINATORS에
  // 넣었으나 정작 GOV_AGENCIES에 없어 /gov/relay 최상위 호출 자체가
  // UNKNOWN_AGENCY로 즉시 거부되는 결함을 실제 테스트 하네스
  // (src/tests/sp-intercall.test.mjs 시나리오 3)로 발견해 수정.
  // ★ 2026-07-11 정정: 이전 주석은 "jeju-router.js가 /ai/chat을 직접
  // 호출해 이 두 값이 아직 실트래픽에 안 쓰인다"고 적혀 있었으나 이는
  // 2026-07-05 시점에 이미 낡은 정보였다. 실제로 jeju.hondi.net을
  // 서빙하는 독립 저장소 Openhash-Gopang/jeju의 jeju-router.js는
  // 2026-07-05부로 /gov/relay 호출(_govRelayCompletion)로 마이그레이션
  // 완료된 상태다 — 즉 이 agency들은 정상적으로 실트래픽에서 쓰이고
  // 있다. (2026-07-12: 과거엔 gopang 모노레포의 src/gopang/ai/jeju-router.js가
  // 이름만 같은 별개 파일이라 혼동 위험이 있었으나, 이제
  // src/gopang/ai/gov-template-renderer.js로 파일명이 분리되어 이름
  // 충돌 자체가 해소됐다 — 2026-07-08 SP-AUTHOR 템플릿 렌더링 전용
  // 엔진이며 jeju.hondi.net과는 여전히 무관. 해당 파일 주석 참고.)
  'gov_do', 'gov_national',
]);

// gov_do/gov_national의 agencyPrompt는 이미 GOV-COMMON을 통해 자체
// 정체성 레이어를 포함하고 있다(지방행정 트리는 K-Public_common을
// 상속하지 않는 독립 계통 — 2026-07-21 이전엔 jeju_do/jeju_national로
// 불렸으나 제주 전용이 아니라 전국 공통 지방행정 트리였다는 게 명확해져
// 개명). 이 agency들에는 K-Public_common/PROFESSIONAL-common을 추가로
// 덧씌우지 않는다 — 덧씌우면 정체성이 이중으로 겹치는(khealth 때와
// 같은 유형의) 버그가 난다.
const NO_IDENTITY_LAYER_AGENCIES = new Set(['gov_do', 'gov_national']);

// ═══════════════════════════════════════════════════════════
// k-business / business-kr — 사업체 보조 AI (2026-07-05 신설)
// K-Market 판매자 관리 대시보드(kmarket_admin_dashboard.html)의 AI
// 경영 어드바이저가 이 릴레이를 통해 재무·세금·고용 업무를 보조한다.
// GOV_AGENCIES와 별개 축(사업체 모듈)이라 agency 개념 대신 국가모듈
// 하나(business-kr)만 우선 지원 — 다른 국가 확장 시 BUSINESS_COUNTRY_MODULES
// 에 추가한다.
// ═══════════════════════════════════════════════════════════
let _kBusinessCache = null, _kBusinessCacheAt = 0;
let _businessKrCache = null, _businessKrCacheAt = 0;
const _BUSINESS_TTL_MS = 10 * 60 * 1000;

async function _fetchKBusiness() {
  const now = Date.now();
  if (_kBusinessCache && (now - _kBusinessCacheAt) < _BUSINESS_TTL_MS) return _kBusinessCache;
  try {
    _kBusinessCache = await _fetchByManifestKeyFromGithub('k-business');
    _kBusinessCacheAt = now;
  } catch (e) {
    console.warn('[k-business] 로드 실패:', e.message);
    if (!_kBusinessCache) _kBusinessCache = '';
  }
  return _kBusinessCache;
}

async function _fetchBusinessKr() {
  const now = Date.now();
  if (_businessKrCache && (now - _businessKrCacheAt) < _BUSINESS_TTL_MS) return _businessKrCache;
  try {
    _businessKrCache = await _fetchByManifestKeyFromGithub('business-kr');
    _businessKrCacheAt = now;
  } catch (e) {
    console.warn('[business-kr] 로드 실패:', e.message);
    if (!_businessKrCache) _businessKrCache = '';
  }
  return _businessKrCache;
}

const BUSINESS_TIER_MODELS = {
  'biz-flash': { backendModel: 'deepseek-v4-flash', price: { cacheHit: 0.0028, cacheMiss: 0.14,  output: 0.28 } },
  'biz-pro':   { backendModel: 'deepseek-v4-pro',   price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 } },
};
const BUSINESS_USER_DAILY_KRW_LIMIT   = 300;
const BUSINESS_GLOBAL_DAILY_KRW_LIMIT = 30000;

async function handleBusinessRelay(bodyText, env, corsHeaders, meta = null, ctx = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { guid, business_id, agencyPrompt, messages, max_tokens, stream, tier } = body || {};
  if (!guid || !Array.isArray(messages)) return _err(400, 'MISSING_FIELD', 'guid/messages 필수', corsHeaders);

  // 클라이언트가 보낸 messages 중 system 역할은 전부 제거 — 서버가 직접
  // 조립한 system(k-business 공통 + business-kr + agencyPrompt)만 유효.
  const dialogOnly = (messages || []).filter(m => m.role !== 'system');

  const tierKey = BUSINESS_TIER_MODELS[tier] ? tier : 'biz-flash';
  const backendModel = BUSINESS_TIER_MODELS[tierKey].backendModel;

  const day       = _todayKey();
  const bizKey    = business_id || guid; // 사업체 단위 식별자, 없으면 guid로 대체
  const userKey   = `biz:spend:${bizKey}:${day}`;
  const globalKey = `biz:spend:global:${day}`;

  // ── 2026-07-14 보안 수정(#18) — 회귀 복구 ─────────────────────────
  // business_id는 클라이언트 자칭 문자열이다. access_cert가 있고, 그
  // org_id가 정확히 이 요청의 bizKey와 일치할 때만 verifiedOrgId를
  // 인정한다(다른 사업체 인증서로 이 세션의 bizKey를 대신 인증하는
  // 것 방지). 이 블록이 한 번 삭제됐다가 복구됐다 — 다른 무관한
  // 커밋(1c891de, AI 사용량 로그)이 이전 버전 worker.js를 기준으로
  // 편집해 통째로 되돌아갔었다.
  const expectedOrgId = `org:${bizKey}`;
  const verifiedOrgId = (body.access_cert && body.access_cert.org_id === expectedOrgId)
    ? await _verifyAccessCert(env, body.access_cert, guid, { _verifyEd25519Simple, _l1FindProfileByGuid }).catch(() => null)
    : null;

  const [userSpent, globalSpent] = await Promise.all([
    _klawSpendGet(env, userKey), _klawSpendGet(env, globalKey)
  ]);
  if (globalSpent >= BUSINESS_GLOBAL_DAILY_KRW_LIMIT) {
    return _err(429, 'BIZ_GLOBAL_QUOTA_EXCEEDED', '오늘 전체 이용자의 사용량이 한도에 도달했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }
  if (userSpent >= BUSINESS_USER_DAILY_KRW_LIMIT) {
    return _err(429, 'BIZ_USER_QUOTA_EXCEEDED', '오늘 사용 가능한 한도를 모두 사용했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }

  const [universalIntegrity, universalCommon, kBusiness, businessKr] = await Promise.all([
    _fetchUniversalIntegrity(), _fetchUniversalCommon(), _fetchKBusiness(), _fetchBusinessKr(),
  ]);
  const systemParts = [universalIntegrity, universalCommon, kBusiness, businessKr, agencyPrompt || ''].filter(Boolean);
  const systemContent = systemParts.length
    ? systemParts.join('\n\n---\n\n')
    : (agencyPrompt || '');

  const isStream = !!stream;
  const payload = { model: backendModel, messages: [{ role: 'system', content: systemContent }, ...dialogOnly], stream: isStream };
  if (max_tokens != null) payload.max_tokens = max_tokens;

  console.log(JSON.stringify({ tag: 'BUSINESS_RELAY_CALL', guid, business_id: bizKey, tier: tierKey, stream: isStream, userSpent, globalSpent, ts: new Date().toISOString(), ...meta }));

  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (e) { return _err(502, 'BUSINESS_RELAY_ERROR', e.message, corsHeaders); }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return new Response(errText || JSON.stringify({ error:`HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
  }

  const priceTier = tierKey === 'biz-pro' ? 'hondi-pro' : 'hondi-flash';

  if (isStream) {
    const [forClient, forUsage] = res.body.tee();
    const usageTask = _parseUsageFromStream(forUsage).then(usage => _recordAiUsage(env, ctx, {
      guid, serviceId: `biz:${bizKey}`, tier: tierKey, priceTier, model: backendModel, usage,
      logTag: 'BUSINESS_RELAY_COST', extraLogFields: { business_id: bizKey, ...meta },
      spendKeys: [userKey, globalKey],
    }));
    if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
    return new Response(forClient, { status:200, headers:{ ...corsHeaders, 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' } });
  }

  const data = await res.json();
  if (data?.usage) {
    _recordAiUsage(env, ctx, {
      guid, serviceId: `biz:${bizKey}`, tier: tierKey, priceTier, model: backendModel, usage: data.usage,
      logTag: 'BUSINESS_RELAY_COST', extraLogFields: { business_id: bizKey, ...meta },
      spendKeys: [userKey, globalKey],
    });
  }

  // ── DEPT_TASK_REQUEST 서버측 처리 (2026-07-12 신설) ──────────────
  // handleGovRelay와 동일 원칙 — bizKey를 authoritativeAgency로 그대로
  // 넘겨 requester_id가 org:{bizKey}와 일치하는지 서버가 직접 검증한다.
  {
    const firstContent = data?.choices?.[0]?.message?.content;
    const deptTaskMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[DEPT_TASK_REQUEST\]([\s\S]*?)\[\/DEPT_TASK_REQUEST\]/)
      : null;
    if (deptTaskMatch) {
      let taskPayload = null;
      try { taskPayload = JSON.parse(deptTaskMatch[1].trim()); } catch (e) { /* ok:false로 처리 */ }
      const result = taskPayload
        ? await createDeptTaskCore(env, {
            requesterType: taskPayload.requester_type, requesterId: taskPayload.requester_id,
            requesterLabel: taskPayload.requester_label, targetType: taskPayload.target_type,
            targetId: taskPayload.target_id, taskType: taskPayload.task_type, directive: taskPayload.directive,
            payload: taskPayload.payload, originChain: taskPayload.origin_chain || [],
          }, {
            _l1FindProfileByGuid, _l1CreateDeptTask,
            _verifyEd25519, // 2026-07-14 수정(회귀 복구) — async()=>true 스텁 제거
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };

      const cleanedText = firstContent.replace(/\[DEPT_TASK_REQUEST\][\s\S]*?\[\/DEPT_TASK_REQUEST\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(업무지시가 접수됐습니다 — 접수번호 ${result.taskId}. 처리 완료 여부는 대상 기관이 별도로 갱신합니다.)`
        : `\n\n(업무지시 접수에 실패했습니다: ${result.reason}${result.detail ? ' — ' + result.detail : ''})`;
      data.choices[0].message.content = (cleanedText || '요청하신 업무지시를 처리했습니다.') + noticeText;
    }
  }

  // ── AFFILIATION_APPROVE 서버측 처리 (2026-07-13 신설, AC-EVOLUTION_v1_1.md §3) ──
  // DEPT_TASK_REQUEST와 동일하게 authoritativeAgency=bizKey를 서버가 직접
  // 넘긴다 — LLM이 "나는 이 회사 관리자다"를 자유 텍스트로 자칭해서
  // 통과할 방법이 없다.
  {
    const firstContent = data?.choices?.[0]?.message?.content;
    const affMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[AFFILIATION_APPROVE\]([\s\S]*?)\[\/AFFILIATION_APPROVE\]/)
      : null;
    if (affMatch) {
      let affPayload = null;
      try { affPayload = JSON.parse(affMatch[1].trim()); } catch (e) { /* ok:false로 처리 */ }
      const result = affPayload
        ? await approveAffiliationCore(env, {
            orgId: affPayload.org_id, targetGuid: affPayload.target_guid,
            approverLabel: affPayload.approver_label, evidence: affPayload.evidence,
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };
      const cleanedText = firstContent.replace(/\[AFFILIATION_APPROVE\][\s\S]*?\[\/AFFILIATION_APPROVE\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(소속 승인이 완료됐습니다 — 다음 재확인 예정일 ${result.review_due}.)`
        : `\n\n(소속 승인에 실패했습니다: ${result.reason}${result.detail ? ' — ' + result.detail : ''})`;
      data.choices[0].message.content = (cleanedText || '소속 승인 요청을 처리했습니다.') + noticeText;
    }
  }

  // ── AFFILIATION_REVOKE 서버측 처리 (2026-07-13 신설, AC-EVOLUTION-GAPS #4 완결) ──
  {
    const firstContent = data?.choices?.[0]?.message?.content;
    const revMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[AFFILIATION_REVOKE\]([\s\S]*?)\[\/AFFILIATION_REVOKE\]/)
      : null;
    if (revMatch) {
      let revPayload = null;
      try { revPayload = JSON.parse(revMatch[1].trim()); } catch (e) { /* ok:false로 처리 */ }
      const result = revPayload
        ? await revokeAffiliationCore(env, {
            orgId: revPayload.org_id, targetGuid: revPayload.target_guid,
            revokerLabel: revPayload.revoker_label, reason: revPayload.reason,
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };
      const cleanedText = firstContent.replace(/\[AFFILIATION_REVOKE\][\s\S]*?\[\/AFFILIATION_REVOKE\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(소속이 철회됐습니다.)`
        : `\n\n(소속 철회 실패: ${result.reason})`;
      data.choices[0].message.content = (cleanedText || '소속 철회 요청을 처리했습니다.') + noticeText;
    }
  }

  // ── WORK_PDV_REQUEST 서버측 처리 (2026-07-13 신설, AC-EVOLUTION_v1_1.md §PDV-SPLIT) ──
  {
    const firstContent = data?.choices?.[0]?.message?.content;
    const wpMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[WORK_PDV_REQUEST\]([\s\S]*?)\[\/WORK_PDV_REQUEST\]/)
      : null;
    if (wpMatch) {
      let wpPayload = null;
      try { wpPayload = JSON.parse(wpMatch[1].trim()); } catch (e) { /* ok:false로 처리 */ }
      const result = wpPayload
        ? await requestWorkDomainPdvCore(env, {
            orgId: wpPayload.org_id, targetGuid: wpPayload.target_guid, purpose: wpPayload.purpose,
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };
      const cleanedText = firstContent.replace(/\[WORK_PDV_REQUEST\][\s\S]*?\[\/WORK_PDV_REQUEST\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(업무영역 데이터 제공을 요청했습니다 — 승인 여부는 해당 직원 본인이 결정합니다. 요청 ID: ${result.request_id})`
        : `\n\n(업무영역 데이터 요청 실패: ${result.reason}${result.detail ? ' — ' + result.detail : ''})`;
      data.choices[0].message.content = (cleanedText || '') + noticeText;
    }
  }
  return new Response(JSON.stringify(data), { headers: corsHeaders });
}

// 2026-07-04b: K-Public_common의 P11(PDV_HISTORY_REQUEST) 절엔
// "scope={본인 서비스의 VALID_PDV_SCOPES 값}"라는 자리표시자만 있고,
// 어느 agency도 자기 몫의 구체적 값을 프롬프트에 명시하지 않고 있었다.
// 본문엔 "K-Tax는 ktax" 식 예시가 일부만 있어 LLM이 나머지(특히 police·
// public·911)는 근거 없이 추측해야 했다 — 911은 패턴상 'k911'로 추측하기
// 쉬운데 실제 등록값은 'k119'라 100% 어긋난다. 서버가 agency를 이미 알고
// 있으므로, 여기서 결정적으로 치환해 추측 자체를 없앤다.
const GOV_AGENCY_PDV_SCOPE = {
  tax:'ktax', health:'khealth', police:'kpolice', '911':'k119',
  democracy:'kdemocracy', insurance:'kinsurance', traffic:'ktraffic',
  logistics:'klogistics', public:'kpublic',
};
const _PDV_SCOPE_PLACEHOLDER_RE = /\{본인 서비스의 VALID_PDV_SCOPES 값\}/g;

const GOV_TIER_MODELS = {
  'gov-flash': { backendModel: 'deepseek-v4-flash', price: { cacheHit: 0.0028, cacheMiss: 0.14,  output: 0.28 } },
  'gov-pro':   { backendModel: 'deepseek-v4-pro',   price: { cacheHit: 0.0145, cacheMiss: 0.435, output: 0.87 } },
};
const GOV_USER_DAILY_KRW_LIMIT   = 300;
const GOV_GLOBAL_DAILY_KRW_LIMIT = 30000;

// ═══════════════════════════════════════════════════════════
// SP 간 호출(위임) 메커니즘 — /gov/relay 전용 v1.0 (2026-07-05 신설)
//
// 배경: JEJU-NATIONAL-SP_v1.0.md §0는 "도청 트리와 국가기관 트리를 동시에
// 체인하지 않는다"고 명시하며 배타적 단일 분기만 지원해왔다 — SP 간
// 호출이라는 어려운 문제를 애초에 피하는 설계였다. 그러나 "국세와 지방세
// 체납액을 합쳐서 알려줘"처럼 두 관할이 모두 필요한 질의는 이 방식으로
// 답할 수 없다. 이 블록은 그 간극을 메운다 — 단, 무한 위임을 막는 두
// 겹의 방어선(프롬프트 차원: UNIVERSAL-common U9-3 / 서버 차원: 아래
// MAX_SP_HOPS·MAX_LLM_CALLS_PER_TURN·call_chain 순환 검사)을 반드시
// 함께 둔다.
// ═══════════════════════════════════════════════════════════

// 이 턴에서 실제로 응답을 생성하는 SP(에이전시)의 최대 개수. 최초 SP를
// 포함해 2 — 즉 "위임은 최대 1회"만 허용한다. 위임 대상이 다시 위임을
// 시도해도(U9-3 위반) _callDelegationTarget()이 그 결과의 sp_call 여부를
// 아예 확인하지 않으므로 구조적으로 무시된다 — 이 상수보다 먼저 작동하는
// 방어선이다.
const MAX_SP_HOPS = 2;
// 홉 수 계산과는 별개의 2차 방어선. 정상 경로에서 LLM 호출은 최대 3번
// (원 SP 판단 1 + 위임 대상 답변 1 + 원 SP 최종 합성 1)이다. 어떤 경로로든
// 이 한도를 넘기면 그 즉시 있는 답으로 종료한다(방어적 프로그래밍 — 위
// 로직에 버그가 있어도 폭주하지 않도록).
const MAX_LLM_CALLS_PER_TURN = 3;

// target 식별자 → 시스템 프롬프트 로드 방법.
//   via:'manifest' — prompts/sp-catalog.json의 키를 그대로 재사용
//     (SP-00-ROUTER 로더와 동일 인프라, 2026-07-09 prompts/manifest.json
//     에서 개명, W-16). sp-catalog.json에 등록되지 않은
//     agency(예: tax — 현재 카탈로그에 SP-XX_ktax 키가 없음)는 절대
//     여기 넣지 않는다. 넣으면 fetch가 항상 실패해 위임이 조용히
//     죽는다 — 위임 대상으로 열려면 sp-catalog.json에 해당 agency의
//     안정적 "총괄" SP 키 등록이 선행돼야 한다.
//   via:'url' — Jeju 트리처럼 manifest 밖에서 직접 raw URL로 관리되는
//     문서.
// identity: 'professional' | 'kpublic' | null(문서 자체가 이미 정체성
//     레이어를 포함 — Jeju 트리).
const SP_DELEGATION_REGISTRY = {
  health:     { via: 'manifest', key: 'SP-04_khealth',    identity: 'professional', pdvScope: 'khealth' },
  police:     { via: 'manifest', key: 'SP-03_kpolice',    identity: 'kpublic',       pdvScope: 'kpolice' },
  '911':      { via: 'manifest', key: 'SP-02_k119',       identity: 'kpublic',       pdvScope: 'k119' },
  democracy:  { via: 'manifest', key: 'SP-12_kdemocracy', identity: 'kpublic',       pdvScope: 'kdemocracy' },
  insurance:  { via: 'manifest', key: 'SP-16_kinsurance', identity: 'kpublic',       pdvScope: 'kinsurance' },
  traffic:    { via: 'manifest', key: 'SP-06_ktraffic',   identity: 'kpublic',       pdvScope: 'ktraffic' },
  logistics:  { via: 'manifest', key: 'SP-13_klogistics', identity: 'kpublic',       pdvScope: 'klogistics' },
  public:     { via: 'manifest', key: 'SP-10_kpublic',    identity: 'kpublic',       pdvScope: 'kpublic' },
  // ★ 2026-07-21 개명 — jeju_do/jeju_national이었다. 제주는 16개
  // 광역시도 중 하나일 뿐이라 정적 파일(JEJU-DO-SP_v1.5.md 등)로 고정
  // 폴백하지 않는다 — dynamicRegional 플래그가 있으면
  // _fetchDelegationPrompt가 provinceCode 기반으로 매번 동적 렌더링하고,
  // provinceCode가 없거나 그 도가 아직 실사되지 않았으면 "정직한
  // 정보없음" 메시지로 대체한다(gov-router.js _loadDoSp()의 PR#30
  // 원칙과 동일 — 특정 도 내용을 다른 도인 것처럼 내보내지 않는다).
  gov_do: {
    dynamicRegional: 'do',
    identity: null, label: '광역시도청(총괄)',
  },
  gov_national: {
    dynamicRegional: 'national',
    identity: null, label: '국가기관 지역사무소(총괄)',
  },
  // tax: sp-catalog.json에 SP-XX_ktax 없음 — 등록 전까지 위임 대상에서 제외.
};

// v1.0 파일럿: 이 목록에 속한 agency만 위임을 "시작"할 수 있다(originate).
// 위임을 "받는" 쪽은 SP_DELEGATION_REGISTRY에 있으면 누구나 대상이 된다.
// 시작 가능 목록을 좁혀두는 이유: 이 목록에 속하면 클라이언트가 stream:true를
// 보내도 서버가 강제로 non-stream 처리한다(아래 handleGovRelay 참조) — 위임
// 여부를 알려면 첫 응답 전체를 먼저 봐야 하기 때문이다. 파일럿 단계에서는
// 영향 범위를 최소화한다.
const SP_DELEGATION_ORIGINATORS = new Set(['public', 'gov_do', 'gov_national']);

let _spDelegationCache = new Map();
const _SP_DELEGATION_TTL_MS = 10 * 60 * 1000;

// ★ 2026-07-09 신설 — kgov(SP-10_kpublic) + <PROVINCE>-GOV-COMMON-OVERLAY +
// GOV-TREE-PROTOCOL을 조립한다. jeju.hondi.net(독립 jeju 저장소)의
// jeju-router.js `_loadGovCommon()`과 정확히 같은 로직을 worker.js
// 서버사이드에도 이식했다 — 지금까지 /gov/relay의 gov_do/gov_national
// (당시 jeju_do/jeju_national) 위임 경로만 이 상위 체인 없이
// JEJU-DO-SP/JEJU-NATIONAL-SP를 단독으로 보내고 있었다(발견 경위:
// GOV_COMMON 조사, 2026-07-09). 2026-07-21 — 이 두 agency를 제주
// 전용에서 전국 공통으로 개명.
let _govCommonChainCache = new Map(); // 도코드 -> { text, at }
const _GOV_COMMON_CHAIN_TTL_MS = 10 * 60 * 1000;

async function _loadGovCommonChain(doCode) {
  const cached = _govCommonChainCache.get(doCode);
  const now = Date.now();
  if (cached && (now - cached.at) < _GOV_COMMON_CHAIN_TTL_MS) return cached.text;

  const [kgov, overlayTemplate, overlayDataRaw, treeProtocol] = await Promise.all([
    _fetchDelegationPrompt('public'), // kgov == SP-10_kpublic, 'public' 항목과 동일 소스 재사용
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/00-common/overlays/GOV-COMMON-OVERLAY-TEMPLATE_v1.1.md', { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`GOV-COMMON-OVERLAY-TEMPLATE fetch 실패: HTTP ${r.status}`);
      return r.text();
    }),
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/00-common/overlays/gov-common-overlay-master-data.json', { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`gov-common-overlay-master-data.json fetch 실패: HTTP ${r.status}`);
      return r.json();
    }),
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/00-common/GOV-TREE-PROTOCOL_v1.0.md', { cache: 'no-cache' }).then(r => {
      if (!r.ok) throw new Error(`JEJU-TREE-PROTOCOL fetch 실패: HTTP ${r.status}`);
      return r.text();
    }),
  ]);

  const rec = (overlayDataRaw.도목록 || []).find(r => r['도코드'] === doCode);
  if (!rec) throw new Error(`GOV-COMMON-OVERLAY 데이터 없음(도코드=${doCode}) — gov-common-overlay-master-data.json에 레코드 추가 필요`);

  const overlay = overlayTemplate
    .replaceAll('{도이름}', rec['도이름'] || '')
    .replaceAll('{콜센터명}', rec['콜센터명'] || '')
    .replaceAll('{콜센터번호}', rec['콜센터번호'] || '')
    .replaceAll('{출자기관예시_문구}', rec['출자기관예시_문구'] || '')
    .replaceAll('{행정시목록_문구}', rec['행정시목록_문구'] || '')
    .replaceAll('{관할예시_문구}', rec['관할예시_문구'] || '');

  const text = kgov + '\n\n---\n\n' + overlay + '\n\n---\n\n' + treeProtocol;
  _govCommonChainCache.set(doCode, { text, at: now });
  return text;
}

// ── 도별 동적 위임 콘텐츠 렌더링 (2026-07-21 신설) ────────────────
// gov_do/gov_national이 무조건 제주 정적 파일을 돌려주던 걸 도별로
// 동적 렌더링하게 한다 — gov-router.js의 _loadDoSp()/_loadNationalSp()와
// 완전히 동일한 소스(province-master-data.json, national-agency-master-data.json
// 등)를 서버측에서 그대로 재사용한다(로직 중복이지만, Workers 런타임이
// 원격 ES 모듈을 안전하게 동적 import할 방법이 없어 불가피 — 클라이언트
// 쪽이 바뀌면 이 두 함수도 같이 봐야 함을 주석으로 남긴다).
async function _renderDoSpDynamic(provinceCode) {
  const [templateRes, masterRes] = await Promise.all([
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/01-do/templates/SP-PROVINCE-TEMPLATE_v1.1.md', { cache: 'no-cache' }),
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/01-do/templates/province-master-data.json', { cache: 'no-cache' }),
  ]);
  if (!templateRes.ok) throw new Error(`SP-PROVINCE-TEMPLATE fetch 실패: HTTP ${templateRes.status}`);
  if (!masterRes.ok) throw new Error(`province-master-data.json fetch 실패: HTTP ${masterRes.status}`);
  const template = await templateRes.text();
  const records = (await masterRes.json())['도목록'] || [];
  const rec = records.find(r => r['도코드'] === provinceCode);
  if (!rec) return null; // 실사 안 된 도 — 호출부가 null을 보고 정직한 정보없음으로 대체
  return template
    .replaceAll('{도이름}', rec['도이름'] || '')
    .replaceAll('{도코드}', rec['도코드'] || '')
    .replaceAll('{통치구조_문구}', rec['통치구조_문구'] || '')
    .replaceAll('{이원화_문구}', rec['이원화_문구'] || '')
    .replaceAll('{인접기관_문구}', rec['인접기관_문구'] || '')
    .replaceAll('{광역출력_문구}', rec['광역출력_문구'] || '')
    .replaceAll('{위임사무_문구}', rec['위임사무_문구'] || '')
    .replaceAll('{하위SP_접두어}', rec['하위SP_접두어'] || '')
    .replaceAll('{유의사항_추가}', rec['유의사항_추가'] || '');
}

function _renderNatCatalogSectionServer(records, provinceCode) {
  const rows = records.filter(r => r['도코드'] === provinceCode);
  if (rows.length === 0) {
    return `## §3. 라우팅 테이블\n\n이 지역의 국가기관 지사 목록은 아직 조사되지 않았습니다 — ` +
      `정확한 관할 기관은 정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`;
  }
  const tableRows = rows.map(r =>
    `| SP-NAT-${(r.domain || '').toUpperCase()} | ${r['지사명'] || ''} | ${r['소속부처'] || ''} |`
  ).join('\n');
  return (
    `## §3. 라우팅 테이블 (national-agency-master-data.json 기준, 매 요청 시 동적 생성)\n\n` +
    `| 코드 | 기관명 | 소속 |\n|---|---|---|\n${tableRows}`
  );
}

async function _renderNationalSpDynamic(provinceCode) {
  const [coreRes, overlayTemplateRes, overlayMasterRes, natMasterRes] = await Promise.all([
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/09-national/NATIONAL-SP-CORE_v1.2.md', { cache: 'no-cache' }),
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/09-national/overlays/NATIONAL-SP-OVERLAY-TEMPLATE_v1.0.md', { cache: 'no-cache' }),
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/09-national/overlays/national-sp-overlay-master-data.json', { cache: 'no-cache' }),
    fetch(GITHUB_RAW_BASE + '/prompts/gov-tree/09-national/agencies/templates/national-agency-master-data.json', { cache: 'no-cache' }),
  ]);
  if (!coreRes.ok) throw new Error(`NATIONAL-SP-CORE fetch 실패: HTTP ${coreRes.status}`);
  if (!overlayTemplateRes.ok) throw new Error(`NATIONAL-SP-OVERLAY-TEMPLATE fetch 실패: HTTP ${overlayTemplateRes.status}`);
  if (!overlayMasterRes.ok) throw new Error(`national-sp-overlay-master-data.json fetch 실패: HTTP ${overlayMasterRes.status}`);
  if (!natMasterRes.ok) throw new Error(`national-agency-master-data.json fetch 실패: HTTP ${natMasterRes.status}`);
  const core = await coreRes.text();
  const overlayTemplate = await overlayTemplateRes.text();
  const overlayRecords = (await overlayMasterRes.json())['도목록'] || [];
  const natRecords = (await natMasterRes.json())['기관목록'] || [];

  const overlayRec = overlayRecords.find(r => r['도코드'] === provinceCode);
  const overlay = overlayRec
    ? overlayTemplate.replaceAll('{도이름}', overlayRec['도이름'] || '')
    : `[참고: 이 지역(${provinceCode})의 국가기관 지사 상세 정보는 아직 준비 중입니다.]`;
  const catalogSection = _renderNatCatalogSectionServer(natRecords, provinceCode);
  return core + '\n\n---\n\n' + overlay + '\n\n---\n\n' + catalogSection;
}

async function _fetchDelegationPrompt(regKey, provinceCode) {
  const entry = SP_DELEGATION_REGISTRY[regKey];
  if (!entry) return null;

  // ── gov_do/gov_national(dynamicRegional) 전용 경로 — 정적 파일 없음.
  // provinceCode가 없거나 그 도가 실사되지 않았으면 "정직한 정보없음"
  // 메시지로 답한다(제주 특별 취급 폐지 — 주피터 지시). ──────────────
  if (entry.dynamicRegional) {
    const cacheKey = `${regKey}:${provinceCode || 'unknown'}`;
    const cached = _spDelegationCache.get(cacheKey);
    const now = Date.now();
    if (cached && (now - cached.at) < _SP_DELEGATION_TTL_MS) return cached.text;

    let body = null;
    if (provinceCode) {
      try {
        body = entry.dynamicRegional === 'do'
          ? await _renderDoSpDynamic(provinceCode)
          : await _renderNationalSpDynamic(provinceCode);
      } catch (e) {
        console.warn(`[worker] 도별 동적 위임 렌더링 실패(${regKey}, ${provinceCode}): ${e.message}`);
        body = null;
      }
    }
    if (body === null) {
      body = `[지역 정보 없음] ${entry.label} 관련 상세 안내는 ` +
        (provinceCode
          ? `이 지역(${provinceCode})이 아직 실사되지 않아 제공할 수 없습니다.`
          : `요청에 지역 정보가 없어 제공할 수 없습니다.`) +
        ` 정부24(gov.kr) 또는 국번없이 110(정부민원안내)으로 확인해 주세요.`;
    }

    let text = body;
    if (provinceCode) {
      try {
        const chain = await _loadGovCommonChain(provinceCode);
        text = chain + '\n\n---\n\n' + text;
      } catch (e) {
        console.warn(`[worker] GOV-COMMON 체인 로드 실패(${provinceCode}): ${e.message} — 본문만 반환`);
      }
    }

    _spDelegationCache.set(cacheKey, { text, at: now });
    return text;
  }

  // ── 기존 경로(K-서비스 SP 등, manifest/url 방식) — 변경 없음 ──────
  const cached = _spDelegationCache.get(regKey);
  const now = Date.now();
  if (cached && (now - cached.at) < _SP_DELEGATION_TTL_MS) return cached.text;

  let url;
  if (entry.via === 'manifest') {
    const manifestRes = await fetch('https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/sp-catalog.json', { cache: 'no-cache' });
    if (!manifestRes.ok) throw new Error(`manifest fetch 실패: ${manifestRes.status}`);
    const manifest = await manifestRes.json();
    const fname = manifest[entry.key];
    if (!fname) throw new Error(`manifest에 ${entry.key} 키 없음`);
    url = `https://raw.githubusercontent.com/Openhash-Gopang/gopang/main/prompts/${fname}`;
  } else {
    url = entry.url;
  }

  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`위임 대상 SP 로드 실패(${regKey}): HTTP ${res.status}`);
  let text = await res.text();

  if (entry.govCommonDoCode) {
    const chain = await _loadGovCommonChain(entry.govCommonDoCode);
    text = chain + '\n\n---\n\n' + text;
  }

  _spDelegationCache.set(regKey, { text, at: now });
  return text;
}

// LLM 응답이 순수 JSON 위임 요청(U9-2 형식)인지 검사한다. 아니면 null —
// 일반 자연어 답변은 '{'로 시작하지 않으므로 대부분 JSON.parse 비용 없이 걸러진다.
function _parseSpCallRequest(content) {
  if (typeof content !== 'string') return null;
  // router.js와 동일한 관용: 지시(U9-2)를 어기고 ```json 코드펜스로 감싸
  // 내놓는 경우까지 허용 — 완전한 자연어 답변만 확실히 배제하면 된다.
  const trimmed = content.replace(/```json|```/g, '').trim();
  if (!trimmed.startsWith('{')) return null;
  let parsed;
  try { parsed = JSON.parse(trimmed); } catch { return null; }
  const call = parsed?.sp_call;
  if (!call || typeof call.target !== 'string' || typeof call.query !== 'string') return null;
  return call;
}

// 위임 대상 SP 서브 호출. 대화 이력 전체가 아니라 query 한 줄만 전달한다
// (U9-2 최소 전달 원칙 — PDV scope 최소화와 동일한 사상). 서브 호출 결과가
// 규칙을 어기고 또 sp_call JSON을 내놓더라도 절대 따르지 않는다 — 그 결과의
// sp_call 여부 자체를 확인하지 않고 raw content 그대로 반환한다. 이것이
// "재위임 금지"의 실제 강제 지점이다(U9-3은 프롬프트 차원의 심층 방어).
async function _callDelegationTarget(env, regKey, query, backendModel, provinceCode) {
  const entry = SP_DELEGATION_REGISTRY[regKey];
  if (!entry) return { ok: false, reason: 'TARGET_NOT_REGISTERED' };

  let promptText;
  try { promptText = await _fetchDelegationPrompt(regKey, provinceCode); }
  catch (e) { return { ok: false, reason: 'PROMPT_LOAD_FAILED', detail: e.message }; }

  const [universalIntegrity, universalCommon] = await Promise.all([
    _fetchUniversalIntegrity(), _fetchUniversalCommon(),
  ]);
  let systemContent;
  if (entry.identity === 'professional') {
    const prof = await _fetchProfessionalCommon();
    systemContent = [universalIntegrity, universalCommon, prof, promptText].filter(Boolean).join('\n\n---\n\n');
  } else if (entry.identity === 'kpublic') {
    const kpub = await _fetchKPublicCommon();
    systemContent = [universalIntegrity, universalCommon, kpub, promptText].filter(Boolean).join('\n\n---\n\n');
  } else {
    systemContent = [universalIntegrity, universalCommon, promptText].filter(Boolean).join('\n\n---\n\n');
  }
  systemContent += '\n\n---\n\n[내부 안내] 이 요청은 다른 SP로부터 위임받은 서브 질의입니다. ' +
    '당신은 이 요청에 대해 다시 다른 SP로 위임할 수 없습니다(U9-3) — 아는 선에서 직접 답하십시오.';

  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify({
        model: backendModel, max_tokens: 800, temperature: 0.2, stream: false,
        messages: [{ role: 'system', content: systemContent }, { role: 'user', content: query }],
      }),
    });
  } catch (e) { return { ok: false, reason: 'FETCH_ERROR', detail: e.message }; }

  if (!res.ok) return { ok: false, reason: `HTTP_${res.status}` };
  const data = await res.json();
  const raw  = data?.choices?.[0]?.message?.content || '';
  return { ok: true, content: raw, usage: data?.usage || null, label: entry.label || regKey };
}

// ═══════════════════════════════════════════════════════════
// /gov/task/submit — GOV_TASK 서류접수·처리결과 기록 (2026-07-12 신설)
//
// SP-10_kpublic v3.6 §REQUIRED-DOCUMENTS가 프롬프트로 선언한 원칙
// ("기관 SP가 서류를 요구→접수→처리")을 실제로 검증·기록하는 서버 코드가
// 없었다(2026-07-12 사고실험으로 확인). 이 블록이 그 간극을 메운다.
//
// 설계 제약(중요): 이 워커에는 파일 바이너리 저장소(R2 등) 바인딩이 없다
// (worker.js 전체에서 확인 — 2026-07-12). 따라서 원본 파일 자체는 받지
// 않고, 클라이언트가 계산한 SHA-256 해시 + 파일명 + 크기만 "서류 소지
// 증명"으로 받아 REQUIRED_DOCUMENTS-SCHEMA와 대조한다. 실제 서류 내용
// 검증(위변조·진위 확인)은 이 구현 범위 밖이다 — 아래 KNOWN_LIMITATIONS
// 참조.
// ═══════════════════════════════════════════════════════════

// ── 기관별 REQUIRED_DOCUMENTS-SCHEMA 레지스트리 ────────────────────
// SP-10_kpublic §DATA_REQUIREMENT 예시(위치기반서비스사업_등록절차,
// 방송통신위원회)를 실제 스키마로 옮긴 최초 항목. 신규 기관/업무 추가 시
// 이 객체에 키를 추가하면 된다 — 키 형식: "{agency}:{task_key}".
const REQUIRED_DOCUMENTS_REGISTRY = {
  'kcc:location_service_registration': {
    agency:      'kcc',
    agency_name: '방송통신위원회',
    task_name:   '위치기반서비스사업 등록(신고)',
    legal_basis: '위치정보의 보호 및 이용 등에 관한 법률 제9조',
    documents: [
      { id: 'biz_reg',         name: '사업자등록증 사본',                 required: true,  acquisition: 'gov24' },
      { id: 'biz_plan',        name: '위치기반서비스사업 사업계획서',       required: true,  acquisition: 'user_authored' },
      { id: 'privacy_policy',  name: '개인위치정보 처리방침',              required: true,  acquisition: 'user_authored' },
      { id: 'protection_plan', name: '개인위치정보 보호조치 이행계획서',    required: true,  acquisition: 'user_authored' },
      { id: 'insurance_proof', name: '손해배상책임 이행보증보험 가입증서', required: false, acquisition: 'external_insurer' },
    ],
  },
  // ★ 2026-07-12 추가 — 두 번째 검증 사례(법원, 개인파산·면책 신청).
  // 근거: 채무자 회생 및 파산에 관한 법률 §302, 채무자회생법 규칙 §72
  // (웹검색 확인, 2026-07-12). ⚠ 아래 목록은 대표적 필수서류이며,
  // 개별 사건 특성(재산 처분 이력 등)에 따라 법원이 추가자료를 요구할
  // 수 있다(예규 제1조의2 제3항) — kgov는 이 목록으로 접수를 "완결"로
  // 판단하되, 반드시 "법원이 사건별로 추가서류를 요구할 수 있다"는
  // 문구를 함께 안내해야 한다(아래 disclaimer와 별개로 SP 차원에서 필요).
  'court:personal_bankruptcy_filing': {
    agency:      'court',
    agency_name: '관할 지방법원(파산부)',
    task_name:   '개인파산·면책 신청',
    legal_basis: '채무자 회생 및 파산에 관한 법률 제302조, 동법 규칙 제72조',
    documents: [
      { id: 'petition',          name: '파산 및 면책신청서',                required: true,  acquisition: 'user_authored' },
      { id: 'statement',         name: '진술서',                           required: true,  acquisition: 'user_authored' },
      { id: 'creditor_list',     name: '채권자목록',                        required: true,  acquisition: 'user_authored' },
      { id: 'asset_list',        name: '재산목록',                          required: true,  acquisition: 'user_authored' },
      { id: 'resident_cert',     name: '주민등록초본(주소변동내역 포함)',    required: true,  acquisition: 'gov24' },
      { id: 'family_cert',       name: '가족관계증명서',                    required: true,  acquisition: 'gov24' },
      { id: 'tax_cert',          name: '지방세 세목별 과세증명서(5년)',     required: true,  acquisition: 'gov24' },
      { id: 'income_proof',      name: '소득 관련 소명자료(급여명세서 등)', required: true,  acquisition: 'user_authored' },
    ],
    note: '법원이 사건별로 추가 소명자료를 요구할 수 있음(개인파산 및 면책신청사건의 처리에 관한 예규 §1의2③) — 접수 후에도 보완 요청 가능성을 반드시 안내할 것.',
  },
};

// ── 신규 기관/업무 판단절차 (agency/task_key 미등록 시) ──────────────
// kgov(SP-10_kpublic)가 REQUIRED_DOCUMENTS_REGISTRY에 없는 요청을 받으면:
//   1. 웹검색 도구(SP-10_kpublic 상위 UNIVERSAL-common U8 원칙에 따라
//      의무 사용)로 담당기관·법적 근거·필요서류를 조사한다.
//   2. 조사 결과를 REQUIRED_DOCUMENTS_REGISTRY 형식의 초안으로 만들어
//      '/gwp-registry/register' 또는 이에 준하는 큐(SP-AUTHOR의
//      pending_agents 패턴과 동일)에 status:'pending'으로 임시 등록한다.
//   3. 즉시 그 초안 스키마로 사용자 요청을 처리하되, 응답에 "이 기관은
//      방금 조사해 임시로 준비한 것이라 실제 요건과 다를 수 있다"는
//      경고를 disclaimer와 별도로 덧붙인다.
//   4. 사람 검토(승인) 전까지 다른 사용자에게는 이 임시 스키마가 자동
//      노출되지 않도록 별도 심사 경로를 거친다 — pending_agents가
//      즉시 병합되는 현재의 알려진 결함(2026-07-11 확인)을 이 신규
//      경로에는 그대로 물려받지 않도록 별도 검토 필요.


// acquisition 값 의미:
//   'gov24'           — 정부24에서 발급 가능(§공문서 발급 안내로 유도)
//   'user_authored'   — 정부기관이 발급하는 게 아니라 사용자(사업자)가 직접
//                        작성해야 하는 문서. 정부24 안내 대상이 아님 —
//                        AC가 작성을 도와줄 수는 있지만(K-Business 연계 등)
//                        "발급받아 오세요"로 안내하면 틀린 안내가 된다.
//   'external_insurer'— 정부기관도 정부24도 아닌 제3자(보험사)에게서 받는
//                        서류.

// RESOLUTION_TIER_REGISTRY — 폐기됨 (2026-07-16 당일 신설 → 당일 폐기)
// 신설 당시 org_profiles/atom_rows(이미 라이브, K-Compose SP-20이 소비)와
// 정확히 같은 개념(기관별 자동화 수준: full_api/assisted/manual_only)을
// 담는 별도 하드코딩 레지스트리를 또 만든 것이었다 — SP-CIVIL-* vs
// SP-10_kpublic 때와 같은 "따로 만들었다가 나중에 충돌" 패턴을 이번엔
// 제가 직접 반복했다. 대학재학증명·사실증명13종 2건은
// pb_migrations/1786200001_seeded_kgov_resolution_tier_migration.js로
// org_profiles에 이관했고(org_id: 'university-generic', 'nts-hometax'),
// 조회는 아래처럼 기존 _l1FindOrgProfile을 그대로 재사용한다 — 새 조회
// 함수도 만들지 않는다.
async function _resolveResolutionTier(env, orgId) {
  const profile = await _l1FindOrgProfile(env, orgId).catch(() => null);
  if (!profile) return null;
  let automation = {};
  try { automation = JSON.parse(profile.automation || '{}'); } catch {}
  return {
    tier: automation.level || 'manual_only',   // full_api | assisted | manual_only
    profile,                                    // input/output/unavailable_reason 등 원본 그대로 전달
  };
}

// ═══════════════════════════════════════════════════════════
// 승인 게이트 (2026-07-12 신설) — "귀하의 의견대로 진행" 지시 반영
//
// REQUIRED_DOCUMENTS_REGISTRY(하드코딩, 사람이 직접 검토해 커밋한 항목)에
// 없는 agency:task_key를 kgov가 웹검색으로 조사해 즉시 쓸 수 있게 하되,
// pending_agents의 "즉시 병합" 결함을 반복하지 않도록 최소 게이트를 둔다:
//
//   - 임시 조사 결과는 L1 PocketBase 'gov_task_schema_drafts' 컬렉션에
//     status:'pending' + created_by_guid로 저장된다.
//   - 조회 시(_resolveDocSchema) 'pending' 항목은 **created_by_guid가
//     일치하는 요청자 본인에게만** 반환된다. 다른 사용자가 같은
//     agency:task_key를 요청하면 이 draft를 보지 못하고 새로 조사한다
//     (중복 조사가 비효율이긴 하나, 검증 안 된 법적 요건이 여러 사용자에게
//     자동 확산되는 것보다 안전 쪽을 택함).
//   - status:'active'(주피터 승인 완료)가 되면 모든 사용자에게 반환된다.
//   - 승인/반려는 handleGovTaskSchemaReview()가 담당하며, 기존
//     prompt_admins/ADMIN_MASTER_KEY 인증(_requireAdmin, 8102줄)을
//     그대로 재사용한다 — 새 인증 체계를 만들지 않는다.
// ═══════════════════════════════════════════════════════════

async function _fetchDraftSchema(env, agency, taskKey, requesterGuid) {
  // 1) 이미 승인된(active) draft가 있으면 누구에게나 반환
  const activeUrl = `${L1_DEFAULT}/api/collections/gov_task_schema_drafts/records`
    + `?filter=${encodeURIComponent(`agency='${agency}' && task_key='${taskKey}' && status='active'`)}`
    + `&perPage=1&sort=-created`;
  const activeRes = await fetch(activeUrl).then(r => r.json()).catch(() => null);
  if (activeRes?.items?.length) return { schema: JSON.parse(activeRes.items[0].schema_json), verified: true, draftId: activeRes.items[0].id };

  // 2) 본인이 만든 pending draft가 있으면 재사용(중복 조사 방지)
  const pendingUrl = `${L1_DEFAULT}/api/collections/gov_task_schema_drafts/records`
    + `?filter=${encodeURIComponent(`agency='${agency}' && task_key='${taskKey}' && status='pending' && created_by_guid='${requesterGuid}'`)}`
    + `&perPage=1&sort=-created`;
  const pendingRes = await fetch(pendingUrl).then(r => r.json()).catch(() => null);
  if (pendingRes?.items?.length) return { schema: JSON.parse(pendingRes.items[0].schema_json), verified: false, draftId: pendingRes.items[0].id };

  return null;
}

// 하드코딩 레지스트리 → DB draft(승인분 우선, 본인 pending 다음) 순으로 조회.
// 둘 다 없으면 null 반환 — 호출측(handleGovTaskSchemaDraft)이 새 조사를 트리거해야 함.
async function _resolveDocSchema(env, agency, taskKey, requesterGuid) {
  const curated = _findDocSchema(agency, taskKey);
  if (curated) return { schema: curated, verified: true, draftId: null, source: 'curated' };
  const draft = await _fetchDraftSchema(env, agency, taskKey, requesterGuid);
  if (draft) return { ...draft, source: 'draft' };
  return null;
}

// POST /gov/task/schema/draft — kgov가 웹검색으로 조사한 결과를 pending으로 저장
// body: { guid, agency, task_key, agency_name, task_name, legal_basis, documents, source_urls }
async function handleGovTaskSchemaDraft(bodyText, env, corsHeaders) {
  // ★ 2026-07-12 정정 — 라우터가 이미 bodyText = await request.text()로 본문을
  // 소진한 뒤 이 함수를 호출한다. request.json()을 다시 부르면 스트림이
  // 이미 비어 있어 항상 실패한다(사고실험으로 발견한 진짜 원인). bodyText를
  // 직접 파싱하는 것으로 교체.
  let body = null;
  try { body = JSON.parse(bodyText); } catch {}
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);
  const { guid, agency, task_key, agency_name, task_name, legal_basis, documents, source_urls } = body;
  if (!guid || !agency || !task_key || !task_name || !Array.isArray(documents) || !documents.length) {
    return _err(400, 'MISSING_FIELD', 'guid/agency/task_key/task_name/documents 필수', corsHeaders);
  }
  // 이미 curated거나 본인 pending/전체 active가 있으면 새로 만들지 않고 그걸 반환
  const existing = await _resolveDocSchema(env, agency, task_key, guid);
  if (existing) {
    return new Response(JSON.stringify({ ok: true, reused: true, verified: existing.verified, schema: existing.schema }), { status: 200, headers: corsHeaders });
  }

  const schemaJson = JSON.stringify({ agency, agency_name: agency_name || agency, task_name, legal_basis: legal_basis || null, documents });
  const draftRes = await fetch(`${L1_DEFAULT}/api/collections/gov_task_schema_drafts/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agency, task_key,
      schema_json: schemaJson,
      source_urls: JSON.stringify(source_urls || []),
      status: 'pending',
      created_by_guid: guid,
    }),
  }).then(r => r.json()).catch(e => { console.warn('[GovTaskSchemaDraft] 저장 실패:', e.message); return null; });

  if (!draftRes?.id) return _err(500, 'DRAFT_SAVE_FAILED', 'gov_task_schema_drafts 저장 실패', corsHeaders);

  return new Response(JSON.stringify({
    ok: true,
    reused: false,
    verified: false,
    draft_id: draftRes.id,
    warning: '방금 웹검색으로 조사해 임시로 준비한 서류 목록입니다. 실제 요건과 다를 수 있으니 최종 제출 전 관할 기관 공식 안내로 다시 확인해 주세요. 사람 검토가 끝나기 전까지는 다른 사용자에게 이 목록이 공유되지 않습니다.',
    schema: JSON.parse(schemaJson),
  }), { status: 200, headers: corsHeaders });
}

// GET  /admin/gov-task-drafts        — 대기중 draft 목록 (Authorization: Bearer <admin token>)
// POST /admin/gov-task-drafts/review — body: { draft_id, decision: 'approve'|'reject' }
async function handleGovTaskDraftList(request, env, corsHeaders) {
  const admin = await _requireAdmin(request, env);
  if (!admin) return _err(401, 'UNAUTHORIZED', 'admin 토큰 필요', corsHeaders);
  const url = `${L1_DEFAULT}/api/collections/gov_task_schema_drafts/records?filter=${encodeURIComponent("status='pending'")}&sort=-created&perPage=50`;
  const res = await fetch(url).then(r => r.json()).catch(() => null);
  return new Response(JSON.stringify({ ok: true, items: res?.items || [] }), { status: 200, headers: corsHeaders });
}

async function handleGovTaskDraftReview(request, bodyText, env, corsHeaders) {
  const admin = await _requireAdmin(request, env);
  if (!admin) return _err(401, 'UNAUTHORIZED', 'admin 토큰 필요', corsHeaders);
  // ★ 2026-07-12 정정 — schemaDraft와 동일한 이유로 request.json() 대신 bodyText 파싱.
  let body = null;
  try { body = JSON.parse(bodyText); } catch {}
  const { draft_id, decision } = body || {};
  if (!draft_id || !['approve', 'reject'].includes(decision)) {
    return _err(400, 'MISSING_FIELD', 'draft_id/decision(approve|reject) 필수', corsHeaders);
  }
  const newStatus = decision === 'approve' ? 'active' : 'rejected';
  const patchRes = await fetch(`${L1_DEFAULT}/api/collections/gov_task_schema_drafts/records/${draft_id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: newStatus, reviewed_by: admin.admin, reviewed_at: new Date().toISOString() }),
  }).catch(() => null);
  if (!patchRes?.ok) return _err(500, 'REVIEW_FAILED', 'draft 상태 갱신 실패', corsHeaders);
  return new Response(JSON.stringify({ ok: true, draft_id, status: newStatus }), { status: 200, headers: corsHeaders });
}

// SubtleCrypto로 서버측에서도 해시 형식만 검증(진짜 파일 해시인지는 확인
// 불가 — 클라이언트가 보낸 값을 신뢰하는 구조). 64자 hex(SHA-256)인지만 검사.
function _isValidSha256Hex(s) {
  return typeof s === 'string' && /^[a-f0-9]{64}$/i.test(s);
}

async function handleGovTaskSubmit(bodyText, env, corsHeaders) {
  // ★ 2026-07-12 정정 — 라우터가 이미 bodyText로 본문을 읽어놓은 뒤 호출되므로
  // request.json()이 아니라 bodyText를 직접 파싱한다(handleGovTaskSchemaDraft와 동일 원인).
  let body = null;
  try { body = JSON.parse(bodyText); } catch {}
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);

  const { guid, agency, task_key, documents, notes } = body;
  if (!guid || !agency || !task_key) {
    return _err(400, 'MISSING_FIELD', 'guid/agency/task_key 필수', corsHeaders);
  }
  // 2026-07-13 신설 — GAP-LIST-50 B-3(병렬·팬아웃 처리 모델 부재) 해소.
  // batch_id가 있으면 이 제출이 "한 사건을 여러 기관에 동시 처리"하는
  // 그룹의 일부임을 표시한다. K-Compose(SP-20)가 PROCEDURE_MAP의
  // parallel_group이 같은 step들을 실행할 때 하나의 batch_id를 만들어
  // 각 제출에 동일하게 실어 보낸다. fanout_mode는 그 그룹의 집계 방식:
  //   'notify' — 통지형(예: 폐업신고→세무서+국민연금+건강보험). 서로
  //              독립적, 하나가 실패해도 나머지는 그대로 유효.
  //   'join'   — 협의형(예: 건축허가=건축과+소방서+환경과 전원 승인
  //              필요). 하나라도 거부되면 전체 목표가 실패.
  // 둘 다 없으면(batch_id 없음) 기존과 동일한 단일 제출로 처리한다 —
  // 하위호환 유지, 이 필드들은 선택적이다.
  const batchId = typeof body.batch_id === 'string' ? body.batch_id.slice(0, 100) : null;
  const fanoutMode = ['notify', 'join'].includes(body.fanout_mode) ? body.fanout_mode : null;
  // ★ 2026-07-12 정정 — GOV_AGENCIES.has(agency) 검증을 제거했다.
  // GOV_AGENCIES는 /gov/relay의 라우팅·정체성 목록(public/gov_do/
  // gov_national/health/police 등)이고, 여기서 쓰는 agency는
  // REQUIRED_DOCUMENTS_REGISTRY의 키 접두어(kcc, court, 342개 기관 코드
  // 등)로 완전히 다른 네임스페이스다. 실제로 /gov/relay에 도달하는
  // agency 값은 국가기관 전체에 대해 언제나 'public' 하나뿐이며(client
  // 쪽 gwp-registry.js에 기관별 개별 GWP 엔트리가 없음), kcc/court가
  // /gov/relay의 agency로 넘어올 경로 자체가 없다 — 이 둘을 같은 Set으로
  // 검증한 것은 개념 혼동이었다(사고실험으로 발견, 2026-07-12).
  // 이 스키마 키의 유효성은 _resolveDocSchema()가 curated 레지스트리 또는
  // 승인된/본인 pending draft로 대신 검증하므로 별도 화이트리스트가
  // 필요 없다.

  const resolved = await _resolveDocSchema(env, agency, task_key, guid);
  if (!resolved) {
    return _err(404, 'TASK_SCHEMA_NOT_FOUND',
      `${agency}:${task_key}에 대한 서류 스키마가 없습니다 — 먼저 /gov/task/schema/draft로 조사·등록하십시오`,
      corsHeaders);
  }
  const { schema, verified } = resolved;

  const submitted = Array.isArray(documents) ? documents : [];

  // 제출된 서류 각각의 형식 검증(해시 형식만 — 내용 진위는 검증 불가)
  const invalidEntries = submitted.filter(d => !d?.doc_id || !_isValidSha256Hex(d?.sha256));
  if (invalidEntries.length) {
    return _err(400, 'INVALID_DOCUMENT_ENTRY', '각 서류는 doc_id와 유효한 sha256(64자 hex)이 필요합니다', corsHeaders);
  }

  const submittedIds = new Set(submitted.map(d => d.doc_id));
  const requiredDocs  = schema.documents.filter(d => d.required);
  const missingDocs   = requiredDocs.filter(d => !submittedIds.has(d.id));
  const matchedDocs   = schema.documents.filter(d => submittedIds.has(d.id));

  const status     = missingDocs.length === 0 ? 'accepted' : 'pending_documents';
  const receiptNo  = status === 'accepted'
    ? `GOV-${agency}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`
    : null;
  const now = new Date().toISOString();

  // ── 구조화 PDV 기록 — handlePdvReport와 동일한 L1 pdv_records 컬렉션에
  // type:'gov_task_submission'으로 남긴다. 스키마리스 확장은 summary_6w에. ──
  const summary6wFull = {
    who:   `사용자(${guid.slice(0, 20)}...)`,
    when:  now,
    where: `${schema.agency_name}(${agency}) AI비서`,
    what:  `${schema.task_name} — ${status === 'accepted' ? '서류 접수 완료' : '서류 보완 필요'}`,
    how:   'REQUIRED_DOCUMENTS-SCHEMA 대조(해시 기반 소지 증명)',
    why:   notes || schema.legal_basis,
    // 구조화 필드 — 이 GOV_TASK 전용
    gov_task: {
      agency, task_key,
      task_name:   schema.task_name,
      legal_basis: schema.legal_basis,
      status,
      schema_verified: verified,
      receipt_no:  receiptNo,
      documents_required: requiredDocs.map(d => d.id),
      documents_matched:  matchedDocs.map(d => ({ id: d.id, name: d.name, sha256: submitted.find(s => s.doc_id === d.id)?.sha256 })),
      documents_missing:  missingDocs.map(d => ({ id: d.id, name: d.name, acquisition: d.acquisition })),
      // 2026-07-13 신설(#15) — 팬아웃 그룹 소속 여부. 둘 다 null이면
      // 기존과 동일한 단일 제출.
      batch_id: batchId,
      fanout_mode: batchId ? fanoutMode : null,
    },
  };

  const pdvId = `PDV-${guid.replace(/:/g, '').slice(0, 12)}-${Date.now()}`;
  const pdvReportId = `govtask:${agency}:${task_key}:${guid}:${Date.now()}`;

  const pdvFetch = await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      guid,
      report_id:    pdvReportId,
      reporter_svc: agency,
      svc:          agency,
      type:         'gov_task_submission',
      summary:      summary6wFull.what,
      summary_6w:   JSON.stringify(summary6wFull),
      block_hash:   null,
      risk_level:   'low',
      source:       agency,
      openhash_anchored: false,
      // 2026-07-13 — 시민이 기관에 제출하는 개인 민원이지 그 시민의
      // "업무"가 아니다(위생과 "직원"의 업무 대행과는 다른 축) —
      // 명시적으로 personal로 태깅해 혼동을 막는다.
      domain: 'personal',
    }),
  }).catch(e => { console.warn('[GovTaskSubmit] PDV 기록 실패:', e.message); return null; });

  if (!pdvFetch || !pdvFetch.ok) {
    console.warn('[GovTaskSubmit] PDV 기록 실패 — 접수 판정 자체는 반환하되 감사로그 없이 진행됨을 로그로 남김');
  }

  return new Response(JSON.stringify({
    ok: true,
    status,
    receipt_no: receiptNo,
    // ★ 2026-07-12 신설 — 강제 면책 필드. AC가 사용자에게 언급하는 걸
    // "잊을 수 있는" 방식(프롬프트 지시만으로는 누락 가능)이 아니라,
    // 이 응답을 읽는 모든 클라이언트 코드가 항상 이 필드를 받도록 만든다.
    // 프론트엔드(각 기관 webapp.html)는 이 disclaimer를 receipt_no와
    // 분리해서 보여주지 말고 항상 같은 말풍선에 이어붙여야 한다
    // (아래 KNOWN_LIMITATIONS #3 참조 — 실제 기관 시스템 미연동).
    disclaimer: receiptNo
      ? `${receiptNo}는 혼디 내부 접수번호이며, ${schema.agency_name}이(가) 발급한 공식 접수번호가 아닙니다. 실제 기관 시스템과의 연동 전까지는 사용자님이 직접 제출하거나 별도 확인이 필요합니다.`
         + (verified ? '' : ' 아울러 이 서류 목록 자체가 아직 사람 검토를 거치지 않은 임시 조사 결과이니, 최종 제출 전 관할 기관 공식 안내로 다시 확인해 주세요.')
      : null,
    schema_verified: verified,
    task_name:  schema.task_name,
    documents_missing: missingDocs.map(d => ({ id: d.id, name: d.name, acquisition: d.acquisition })),
    pdv_id: pdvId,
  }), { status: 200, headers: corsHeaders });
}

// ── GOV_TASK 팬아웃 집계 조회 (2026-07-13 신설, #15) ──────────────────
// batch_id로 묶인 모든 gov_task_submission을 모아 집계 상태를 낸다.
// fanout_mode에 따라 집계 규칙이 다르다:
//   notify — 각 건이 독립적. overall = 전부 accepted면 'complete',
//            일부만 accepted면 'partial'(실패한 것만 재시도 대상),
//            전부 pending_documents면 'in_progress'.
//   join   — AND 조건. 하나라도 명시적으로 거부되면 overall='denied'
//            (이 구현 범위에서 '거부'는 기관 측 별도 PATCH가 필요 —
//            handleGovTaskSubmit 자체는 accepted/pending_documents만
//            내므로, 실제 '거부' 판정은 이 조회 시점엔 아직 배선이
//            없다 — KNOWN_LIMITATIONS에 명시). 전부 accepted여야만
//            'complete'.
async function handleGovTaskBatchStatus(bodyText, env, corsHeaders) {
  let body = null;
  try { body = JSON.parse(bodyText); } catch {}
  const batchId = body?.batch_id;
  if (!batchId) return _err(400, 'MISSING_FIELD', 'batch_id 필수', corsHeaders);

  // pdv_records(L1)에서 type='gov_task_submission' + summary_6w 안의
  // gov_task.batch_id 일치 건을 모은다. summary_6w가 JSON 문자열로
  // 저장돼 있어 PocketBase filter로 직접 못 거르므로, guid로 1차
  // 필터한 뒤 서버에서 JSON 파싱해 batch_id를 대조한다(guid 없이
  // batch_id만으로 조회하면 전체 스캔이 되므로, guid도 함께 받는다).
  const guid = body?.guid;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수(batch_id만으로는 조회 범위가 너무 넓어짐)', corsHeaders);

  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`guid='${guid}' && type='gov_task_submission'`);
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/pdv_records/records?filter=${filter}&sort=-created&perPage=100`,
    { headers: { 'Authorization': `Bearer ${token}` } },
  ).catch(() => null);
  if (!res || !res.ok) return _err(503, 'FETCH_FAILED', 'batch 조회 실패', corsHeaders);
  const json = await res.json().catch(() => null);
  const items = json?.items || [];

  const members = [];
  for (const it of items) {
    let sw = null;
    try { sw = JSON.parse(it.summary_6w); } catch { continue; }
    const gt = sw?.gov_task;
    if (!gt || gt.batch_id !== batchId) continue;
    members.push({
      agency: gt.agency, task_key: gt.task_key, task_name: gt.task_name,
      status: gt.status, receipt_no: gt.receipt_no, created_at: it.created,
      fanout_mode: gt.fanout_mode || null,
    });
  }

  if (!members.length) return _err(404, 'BATCH_NOT_FOUND', `batch_id=${batchId}에 해당하는 제출 기록이 없습니다`, corsHeaders);

  const fanoutMode = members[0].fanout_mode;
  const acceptedCount = members.filter(m => m.status === 'accepted').length;
  const total = members.length;

  let overall;
  if (acceptedCount === total) overall = 'complete';
  else if (fanoutMode === 'join') overall = 'in_progress'; // join은 전원 완료 전까지 부분완료 개념이 없음(AND 조건)
  else if (acceptedCount > 0) overall = 'partial';
  else overall = 'in_progress';

  return new Response(JSON.stringify({
    ok: true, batch_id: batchId, total, accepted_count: acceptedCount,
    overall_status: overall, members,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// KNOWN_LIMITATIONS (2026-07-12) — 이 구현이 아직 하지 않는 것
// ═══════════════════════════════════════════════════════════
// 1. 원본 파일을 저장하지 않는다(R2 등 바인딩 없음) — 해시만 대조하므로
//    "정말 이직확인서/사업계획서 맞는지"는 검증 불가. 사용자가 아무
//    파일이나 올려도 doc_id만 맞으면 통과한다.
// 2. sha256 값 자체를 서버가 재계산하지 않는다 — 클라이언트(브라우저/새 탭)가
//    계산해 보낸 값을 그대로 신뢰한다. 위변조 방지가 아니라 "같은 파일을
//    나중에 다시 봤을 때 동일本인지" 정도의 무결성 체크에 가깝다.
// 3. 실제 방송통신위원회 시스템(예: 위치정보관리시스템)에 아무것도
//    전송하지 않는다 — receipt_no는 이 시스템이 자체 발급한 내부 접수번호일
//    뿐, 기관이 발급한 공식 접수번호가 아니다. AC가 사용자에게 이 차이를
//    반드시 명확히 알려야 한다(아래 방송통신위원회 역할수행 참조).
// ═══════════════════════════════════════════════════════════

async function handleGovRelay(bodyText, env, corsHeaders, meta = null, ctx = null) {
  let body;
  try { body = JSON.parse(bodyText); } catch { return _err(400, 'INVALID_JSON', '', corsHeaders); }

  const { guid, agency, agencyPrompt, messages, max_tokens, stream, tier, provinceCode } = body || {};
  if (!guid || !agency || !Array.isArray(messages)) return _err(400, 'MISSING_FIELD', 'guid/agency/messages 필수', corsHeaders);
  if (!GOV_AGENCIES.has(agency)) return _err(400, 'UNKNOWN_AGENCY', `등록되지 않은 기관: ${agency}`, corsHeaders);
  // provinceCode는 선택 필드(2026-07-21 신설) — gov_do/gov_national 위임
  // 서브 호출이 어느 도 내용을 렌더링할지 결정한다. 안 보내면(구 클라이언트)
  // 아래 _fetchDelegationPrompt가 "정직한 정보없음" 메시지로 답한다 —
  // 예전처럼 조용히 제주 내용이 나가지 않는다(주피터 지시: 제주 특별
  // 취급 폐지).

  // ── 2026-07-14 보안 수정(#18) — 회귀 복구 ─────────────────────────
  // agency는 클라이언트 자칭 문자열이다. body.access_cert(있으면)를
  // 검증해 실제로 서명 확인이 끝난 org_id만 verifiedOrgId로 인정한다
  // — 없거나 검증 실패 시 null(= 아래 privileged 태그 전부 거부).
  // 일반 대화는 access_cert 없이도 그대로 동작한다. 이 블록이 한 번
  // 삭제됐다가 복구됐다(1c891de가 이전 버전 worker.js 기준으로 편집).
  const verifiedOrgId = body.access_cert
    ? await _verifyAccessCert(env, body.access_cert, guid, { _verifyEd25519Simple, _l1FindProfileByGuid }).catch(() => null)
    : null;

  // 클라이언트가 보낸 messages 중 system 역할은 전부 제거 — 서버가 직접 조립한
  // system(K-Public 공통 + agencyPrompt)만 유효하다.
  const dialogOnly = (messages || []).filter(m => m.role !== 'system');

  const tierKey = GOV_TIER_MODELS[tier] ? tier : 'gov-flash';
  const backendModel = GOV_TIER_MODELS[tierKey].backendModel;

  const day       = _todayKey();
  const userKey   = `gov:${agency}:spend:${guid}:${day}`;
  const globalKey = `gov:${agency}:spend:global:${day}`;

  const [userSpent, globalSpent] = await Promise.all([
    _klawSpendGet(env, userKey), _klawSpendGet(env, globalKey)
  ]);
  if (globalSpent >= GOV_GLOBAL_DAILY_KRW_LIMIT) {
    return _err(429, 'GOV_GLOBAL_QUOTA_EXCEEDED', `오늘 ${agency} 전체 이용자의 사용량이 한도에 도달했습니다. 내일 다시 이용해 주세요.`, corsHeaders);
  }
  if (userSpent >= GOV_USER_DAILY_KRW_LIMIT) {
    return _err(429, 'GOV_USER_QUOTA_EXCEEDED', '오늘 사용 가능한 한도를 모두 사용했습니다. 내일 다시 이용해 주세요.', corsHeaders);
  }

  const usesProfessionalIdentity = PROFESSIONAL_IDENTITY_AGENCIES.has(agency);
  const noIdentityLayer = NO_IDENTITY_LAYER_AGENCIES.has(agency);
  const [universalIntegrity, universalCommonRaw, identityDocRaw] = await Promise.all([
    _fetchUniversalIntegrity(),
    _fetchUniversalCommon(),
    noIdentityLayer ? Promise.resolve('') : (usesProfessionalIdentity ? _fetchProfessionalCommon() : _fetchKPublicCommon()),
  ]);
  const pdvScope = GOV_AGENCY_PDV_SCOPE[agency];
  // PDV_HISTORY_REQUEST(U8) scope 자리표시자는 이제 UNIVERSAL-common에 있다.
  const universalCommon = pdvScope
    ? universalCommonRaw.replace(_PDV_SCOPE_PLACEHOLDER_RE, pdvScope)
    : universalCommonRaw;
  const systemParts = [universalIntegrity, universalCommon, identityDocRaw, agencyPrompt || ''].filter(Boolean);
  const systemContent = systemParts.length
    ? systemParts.join('\n\n---\n\n')
    : (agencyPrompt || ''); // 공통 규칙 로드 실패해도 기관 고유 규칙만으로 서비스 지속

  // 위임 가능(originator) agency는 stream을 서버가 강제로 끈다 — 위임 여부를
  // 판단하려면 응답 전체를 먼저 봐야 하는데, 이미 클라이언트로 흘려보낸 SSE
  // 청크는 취소할 수 없기 때문이다(SP_DELEGATION_ORIGINATORS 정의부 주석 참조).
  const canDelegate = SP_DELEGATION_ORIGINATORS.has(agency);
  const isStream = !!stream && !canDelegate;
  const payload = { model: backendModel, messages: [{ role: 'system', content: systemContent }, ...dialogOnly], stream: isStream };
  if (max_tokens != null) payload.max_tokens = max_tokens;

  console.log(JSON.stringify({ tag: 'GOV_RELAY_CALL', guid, agency, tier: tierKey, stream: isStream, userSpent, globalSpent, ts: new Date().toISOString(), ...meta }));

  let res;
  try {
    res = await fetch(DEEPSEEK_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
      body: JSON.stringify(payload),
    });
  } catch (e) { return _err(502, 'GOV_RELAY_ERROR', e.message, corsHeaders); }

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    return new Response(errText || JSON.stringify({ error:`HTTP ${res.status}` }), { status: res.status, headers: corsHeaders });
  }

  const priceTier = tierKey === 'gov-pro' ? 'hondi-pro' : 'hondi-flash'; // computeBilledKRW는 hondi-* 가격표를 조회

  // 비용 기록 공통 헬퍼 — 위임 흐름에서 여러 번(원 SP 판단 / 위임 대상 / 최종 합성) 호출된다.
  // via는 감사(audit) 로그용 호출 경로 표시일 뿐 과금 로직에는 영향 없음(같은 guid·agency 한도로 합산).
  // 342개 국가기관 전부가 이 handleGovRelay 하나를 agency 파라미터로 공유하므로,
  // 이 클로저 하나만 고치면 전 기관에 동시 적용된다(기관별 반복 연결 불필요).
  const billGovCall = (usage, via) => {
    if (!usage) return;
    _recordAiUsage(env, ctx, {
      guid, serviceId: `gov:${agency}`, tier: tierKey, priceTier, model: backendModel, usage,
      logTag: 'GOV_RELAY_COST', extraLogFields: { agency, via, ...meta },
      spendKeys: [userKey, globalKey],
    });
  };

  if (isStream) {
    const [forClient, forUsage] = res.body.tee();
    const usageTask = _parseUsageFromStream(forUsage).then(usage => billGovCall(usage, agency));
    if (ctx?.waitUntil) ctx.waitUntil(usageTask); else usageTask.catch(() => {});
    return new Response(forClient, { status:200, headers:{ ...corsHeaders, 'Content-Type':'text/event-stream', 'Cache-Control':'no-cache', 'X-Accel-Buffering':'no' } });
  }

  const data = await res.json();
  billGovCall(data?.usage, agency);

  // ── META_TABLE_UPDATE 서버측 처리 (2026-07-14 신설, 회귀 복구) ─────
  // AGENCY-AC-COMMON_v1.3.md §6 배선. canDelegate 여부와 무관하게 모든
  // 기관 세션에 적용 — 응답 흐름을 막지 않는다(얼리리턴 없음).
  {
    const mtContent = data?.choices?.[0]?.message?.content;
    const mtMatch = typeof mtContent === 'string'
      ? mtContent.match(/\[META_TABLE_UPDATE:([\s\S]*?)\]/)
      : null;
    if (mtMatch) {
      const mtFields = _parseMetaTableTag(mtMatch[1]);
      if (mtFields) {
        const writeTask = _writeMetaTableRecord(env, agency, mtFields).catch(e =>
          console.warn('[MetaTable] 기록 실패(응답 흐름은 계속 진행):', e.message));
        if (ctx?.waitUntil) ctx.waitUntil(writeTask); else writeTask.catch(() => {});
      } else {
        console.warn('[MetaTable] 태그 파싱 실패 — 형식이 예상과 다름:', mtMatch[1].slice(0, 200));
      }
      data.choices[0].message.content = mtContent.replace(/\[META_TABLE_UPDATE:[\s\S]*?\]/, '').trim();
    }
  }

  // ── SP 간 호출(위임) 오케스트레이션 — canDelegate agency에서만 시도 ──────
  // call_chain은 이 요청 안에서만 존재하는 서버 내부 상태다(클라이언트가 보낸
  // 값이 아니다) — 최초 호출은 항상 [agency]에서 시작하므로 순환 검사가
  // 클라이언트 조작에 노출되지 않는다.
  if (canDelegate) {
    const firstContent = data?.choices?.[0]?.message?.content;

    // ── DEPT_TASK_REQUEST 서버측 처리 (2026-07-12 재설계) ──────────
    // sp_call과 달리 "이번 턴 답을 완성하기 위한 재귀 호출"이 아니라
    // 부수효과(레코드 생성)만 있으면 되므로, 감지되면 그 자리에서 바로
    // 처리하고 sp_call 분기로 내려가지 않는다. authoritativeAgency로
    // 이 요청이 실제로 어느 agency 세션에서 나왔는지 서버가 직접
    // 넘겨준다 — LLM이 자기 신원을 자유 텍스트로 자칭하게 두지 않는다
    // (dept-task-handler.js _authoritativeCheck 참고).
    const deptTaskMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[DEPT_TASK_REQUEST\]([\s\S]*?)\[\/DEPT_TASK_REQUEST\]/)
      : null;
    if (deptTaskMatch) {
      let payload = null;
      try { payload = JSON.parse(deptTaskMatch[1].trim()); } catch (e) { /* 아래 result.ok=false로 처리 */ }
      const result = payload
        ? await createDeptTaskCore(env, {
            requesterType: payload.requester_type, requesterId: payload.requester_id,
            requesterLabel: payload.requester_label, targetType: payload.target_type,
            targetId: payload.target_id, taskType: payload.task_type, directive: payload.directive,
            payload: payload.payload, originChain: payload.origin_chain || [],
          }, {
            _l1FindProfileByGuid, _l1CreateDeptTask,
            _verifyEd25519, // 2026-07-14 수정(회귀 복구) — async()=>true 스텁 제거
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };

      const cleanedText = firstContent.replace(/\[DEPT_TASK_REQUEST\][\s\S]*?\[\/DEPT_TASK_REQUEST\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(업무지시가 접수됐습니다 — 접수번호 ${result.taskId}. 처리 완료 여부는 대상 기관이 별도로 갱신합니다.)`
        : `\n\n(업무지시 접수에 실패했습니다: ${result.reason}${result.detail ? ' — ' + result.detail : ''})`;
      data.choices[0].message.content = (cleanedText || '요청하신 업무지시를 처리했습니다.') + noticeText;
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // ── AFFILIATION_APPROVE 서버측 처리 (2026-07-13 신설, AC-EVOLUTION_v1_1.md §3) ──
    const affMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[AFFILIATION_APPROVE\]([\s\S]*?)\[\/AFFILIATION_APPROVE\]/)
      : null;
    if (affMatch) {
      let affPayload = null;
      try { affPayload = JSON.parse(affMatch[1].trim()); } catch (e) { /* ok:false로 처리 */ }
      const result = affPayload
        ? await approveAffiliationCore(env, {
            orgId: affPayload.org_id, targetGuid: affPayload.target_guid,
            approverLabel: affPayload.approver_label, evidence: affPayload.evidence,
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };
      const cleanedText = firstContent.replace(/\[AFFILIATION_APPROVE\][\s\S]*?\[\/AFFILIATION_APPROVE\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(소속 승인이 완료됐습니다 — 다음 재확인 예정일 ${result.review_due}.)`
        : `\n\n(소속 승인에 실패했습니다: ${result.reason}${result.detail ? ' — ' + result.detail : ''})`;
      data.choices[0].message.content = (cleanedText || '소속 승인 요청을 처리했습니다.') + noticeText;
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // ── AFFILIATION_REVOKE 서버측 처리 (2026-07-13 신설, AC-EVOLUTION-GAPS #4 완결) ──
    const revMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[AFFILIATION_REVOKE\]([\s\S]*?)\[\/AFFILIATION_REVOKE\]/)
      : null;
    if (revMatch) {
      let revPayload = null;
      try { revPayload = JSON.parse(revMatch[1].trim()); } catch (e) { /* ok:false로 처리 */ }
      const result = revPayload
        ? await revokeAffiliationCore(env, {
            orgId: revPayload.org_id, targetGuid: revPayload.target_guid,
            revokerLabel: revPayload.revoker_label, reason: revPayload.reason,
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };
      const cleanedText = firstContent.replace(/\[AFFILIATION_REVOKE\][\s\S]*?\[\/AFFILIATION_REVOKE\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(소속이 철회됐습니다.)`
        : `\n\n(소속 철회 실패: ${result.reason})`;
      data.choices[0].message.content = (cleanedText || '소속 철회 요청을 처리했습니다.') + noticeText;
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    // ── WORK_PDV_REQUEST 서버측 처리 (2026-07-13 신설, AC-EVOLUTION_v1_1.md §PDV-SPLIT) ──
    const wpMatch = typeof firstContent === 'string'
      ? firstContent.match(/\[WORK_PDV_REQUEST\]([\s\S]*?)\[\/WORK_PDV_REQUEST\]/)
      : null;
    if (wpMatch) {
      let wpPayload = null;
      try { wpPayload = JSON.parse(wpMatch[1].trim()); } catch (e) { /* ok:false로 처리 */ }
      const result = wpPayload
        ? await requestWorkDomainPdvCore(env, {
            orgId: wpPayload.org_id, targetGuid: wpPayload.target_guid, purpose: wpPayload.purpose,
          }, { authoritativeAgency: verifiedOrgId })
        : { ok: false, reason: 'INVALID_JSON' };
      const cleanedText = firstContent.replace(/\[WORK_PDV_REQUEST\][\s\S]*?\[\/WORK_PDV_REQUEST\]/, '').trim();
      const noticeText = result.ok
        ? `\n\n(업무영역 데이터 제공을 요청했습니다 — 승인 여부는 해당 직원 본인이 결정합니다. 요청 ID: ${result.request_id})`
        : `\n\n(업무영역 데이터 요청 실패: ${result.reason}${result.detail ? ' — ' + result.detail : ''})`;
      data.choices[0].message.content = (cleanedText || '') + noticeText;
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }

    const call = _parseSpCallRequest(firstContent);

    if (call) {
      const callChain = [agency];
      const target = call.target;
      const isCycle = callChain.includes(target);
      const overHopCap = callChain.length >= MAX_SP_HOPS;
      const unknownTarget = !SP_DELEGATION_REGISTRY[target];

      if (isCycle || overHopCap || unknownTarget) {
        // 위임 거부 — 원 SP를 한 번 더(2번째 호출) 불러 "위임 불가"를 알리고
        // 가진 정보로 마무리하게 한다(U9-4). 재시도에서도 sp_call이 다시
        // 오면(MAX_LLM_CALLS_PER_TURN 도달) 더 재귀하지 않고 안전하게 종료.
        const reason = unknownTarget ? 'TARGET_NOT_REGISTERED' : (isCycle ? 'CYCLE_DETECTED' : 'HOP_LIMIT_EXCEEDED');
        const denialNote = { role: 'user', content:
          `[시스템 안내] 방금 요청한 위임(target=${target})이 거부되었습니다(사유: ${reason}). ` +
          `다시 위임을 시도하지 말고, 지금 가진 정보만으로 답변을 마무리하십시오(U9-4).` };
        let res2;
        try {
          res2 = await fetch(DEEPSEEK_URL, {
            method: 'POST',
            headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
            body: JSON.stringify({ model: backendModel, max_tokens: max_tokens || 800, temperature: 0, stream: false,
              messages: [{ role:'system', content: systemContent }, ...dialogOnly, { role:'assistant', content: firstContent }, denialNote] }),
          });
        } catch (e) { return new Response(JSON.stringify(data), { headers: corsHeaders }); } // 실패 시 원 응답이라도 반환

        if (res2.ok) {
          const data2 = await res2.json();
          billGovCall(data2?.usage, `${agency}(denied:${reason})`);
          const finalContent = _parseSpCallRequest(data2?.choices?.[0]?.message?.content)
            ? '죄송합니다, 요청을 처리하는 중 확인이 필요한 절차가 있어 완전한 답을 드리기 어렵습니다. 관련 기관에 직접 문의해 주시기 바랍니다.'
            : data2?.choices?.[0]?.message?.content;
          data2.choices[0].message.content = finalContent;
          return new Response(JSON.stringify(data2), { headers: corsHeaders });
        }
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }

      // ── 위임 승인 — 대상 SP 서브 호출(2번째 LLM 호출) ──────────────
      const sub = await _callDelegationTarget(env, target, call.query, backendModel, provinceCode);
      billGovCall(sub.usage, `${agency}→${target}`);

      if (!sub.ok) {
        // 서브 호출 자체가 실패(네트워크/HTTP 오류 등) — 원 SP에게 알리고 마무리(3번째 호출).
        const failNote = { role:'user', content:
          `[시스템 안내] 위임(target=${target}) 호출이 기술적으로 실패했습니다(${sub.reason}). ` +
          `이 정보 없이 지금 가진 정보만으로 답변을 마무리하십시오.` };
        const res3 = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({ model: backendModel, max_tokens: max_tokens || 800, temperature: 0.3, stream: false,
            messages: [{ role:'system', content: systemContent }, ...dialogOnly, { role:'assistant', content: firstContent }, failNote] }),
        }).catch(() => null);
        if (res3 && res3.ok) {
          const data3 = await res3.json();
          billGovCall(data3?.usage, `${agency}(sub-fail)`);
          return new Response(JSON.stringify(data3), { headers: corsHeaders });
        }
        return new Response(JSON.stringify(data), { headers: corsHeaders });
      }

      // ── 위임 성공 — 원 SP에게 결과를 넘겨 최종 합성(3번째, 마지막 LLM 호출) ──
      // MAX_LLM_CALLS_PER_TURN(=3)에 맞춰 여기서 대화를 종결한다 — 이 합성
      // 응답이 또 sp_call을 내놓아도(U9-3 위반) 절대 따르지 않는다.
      const resultNote = { role:'user', content:
        `[시스템 안내] 위임 결과 — ${sub.label}의 답변: """${sub.content}"""\n` +
        `이 정보를 반영해 사용자에게 최종 답변을 작성하십시오. 어느 기관을 통해 확인한 정보인지 밝히십시오(U9-5). ` +
        `다시 위임을 시도하지 마십시오(U9-3).` };
      let res4;
      try {
        res4 = await fetch(DEEPSEEK_URL, {
          method: 'POST',
          headers: { 'Content-Type':'application/json', 'Authorization':`Bearer ${env.DEEPSEEK_API_KEY}` },
          body: JSON.stringify({ model: backendModel, max_tokens: max_tokens || 1200, temperature: 0.3, stream: false,
            messages: [{ role:'system', content: systemContent }, ...dialogOnly, { role:'assistant', content: firstContent }, resultNote] }),
        });
      } catch (e) { return new Response(JSON.stringify(data), { headers: corsHeaders }); }

      if (res4.ok) {
        const data4 = await res4.json();
        billGovCall(data4?.usage, `${agency}←${target}(synth)`);
        // 마지막 방어선: 여전히 sp_call JSON이면 절대 재귀하지 않고 안전한 문구로 대체.
        if (_parseSpCallRequest(data4?.choices?.[0]?.message?.content)) {
          data4.choices[0].message.content =
            `${sub.label} 확인 결과를 포함해 안내드리려 했으나 응답 처리 중 문제가 있었습니다. ` +
            `${sub.label}에 직접 문의하시거나 잠시 후 다시 시도해 주세요.`;
        }
        return new Response(JSON.stringify(data4), { headers: corsHeaders });
      }
      return new Response(JSON.stringify(data), { headers: corsHeaders });
    }
  }

  return new Response(JSON.stringify(data), { headers: corsHeaders });
}

// Phase 1 — OpenHash 앵커링 프록시 (/openhash/anchor)
// buildout_plan_v2 Phase 1: _submitToLayer 교체
//
// 설계 원칙:
//   - 클라이언트(브라우저)는 GitHub 토큰을 직접 보유하지 않음
//   - hashChain.js anchor()가 POST /openhash/anchor를 호출
//   - worker.js가 env.OPENHASH_TOKEN으로 repository_dispatch 중계
//
// 앵커링 상태:
//   submitted  : dispatch 202 Accepted — 블록 생성 진행 중 (비동기)
//   confirmed  : chain_status.json 재조회로 block 생성 확인
//   failed     : 네트워크 오류 또는 token 누락
// ═══════════════════════════════════════════════════════════
async function handleOpenhashAnchor(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { entry_hash, content_hash, msg_id, signatures, layer, score, lcat, block_height, submitted_at } = body;

  // 필수 필드 검증
  if (!entry_hash || entry_hash.length !== 64)
    return _err(400, 'INVALID_ENTRY_HASH', 'entry_hash는 SHA-256 hex(64자) 필수', corsHeaders);
  if (!layer || !LAYER_REPOS[layer])
    return _err(400, 'INVALID_LAYER', `지원 계층: ${Object.keys(LAYER_REPOS).join(', ')}`, corsHeaders);

  // OPENHASH_TOKEN 확인 (env 변수 — wrangler secret)
  const token = env.OPENHASH_TOKEN;
  if (!token) {
    console.warn('[OpenHash] OPENHASH_TOKEN 미설정 — submitted=false');
    return new Response(JSON.stringify({
      ok:        false,
      status:    'failed',
      reason:    'OPENHASH_TOKEN not configured',
      entry_hash,
      layer,
    }), { status: 200, headers: corsHeaders });
  }

  const repo = LAYER_REPOS[layer];

  // repository_dispatch 전송 (GitHub API)
  // 응답: 204 No Content = 수락됨 (비동기 처리)
  let dispatchStatus;
  try {
    const res = await fetch(`${GITHUB_API}/repos/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept':        'application/vnd.github+json',
        'Content-Type':  'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent':    'hondi-proxy/1.0',
      },
      body: JSON.stringify({
        event_type:     'HASH_CHAIN_ANCHOR',
        client_payload: {
          entry_hash,
          content_hash:  content_hash  || '',
          msg_id:        msg_id        || '',
          signatures:    signatures    || [],
          merkle_layer:  layer,
          score:         score         ?? 0,
          lcat:          lcat          || 'B',
          block_height:  block_height  || 0,
          submitted_at:  submitted_at  || new Date().toISOString(),
        },
      }),
    });
    dispatchStatus = res.status;
  } catch (e) {
    console.error('[OpenHash] dispatch 실패:', e.message);
    return new Response(JSON.stringify({
      ok: false, status: 'failed', reason: e.message, entry_hash, layer,
    }), { status: 200, headers: corsHeaders });
  }

  // 204 = 수락됨 (블록 생성은 Actions 워크플로우가 비동기 처리)
  const submitted = dispatchStatus === 204;
  console.log(`[OpenHash] dispatch ${layer} → ${repo} | status=${dispatchStatus} | entry=${entry_hash.slice(0,16)}...`);

  return new Response(JSON.stringify({
    ok:         submitted,
    status:     submitted ? 'submitted' : 'failed',
    layer,
    repo,
    entry_hash,
    dispatch_status: dispatchStatus,
    note: submitted
      ? '블록 생성 진행 중.'
      : `dispatch 실패 (HTTP ${dispatchStatus})`,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// Phase 5 — OpenHash ILMV 상태 조회 (/openhash/status)
// chain_status.json을 fetch해 실시간 ILMV 감사 결과 반환
// ═══════════════════════════════════════════════════════════
async function handleOpenhashStatus(request, env, corsHeaders) {
  const url2 = new URL(request.url);
  const layer = url2.searchParams.get('layer') || null;  // 특정 계층만 조회
  const LAYER_STATUS_URLS = {
    L1: 'https://openhash-gopang.github.io/openhash-L1-ido1/chain_status.json',
    L2: 'https://openhash-gopang.github.io/openhash-L2-jeju-city/chain_status.json',
    L3: 'https://openhash-gopang.github.io/openhash-L3-jeju/chain_status.json',
    L4: 'https://openhash-gopang.github.io/openhash-L4-kr/chain_status.json',
    L5: 'https://openhash-gopang.github.io/openhash-L5-global/chain_status.json',
  };
  // 계층별 타임스탬프 신선도 임계값 (논문 §4.3 주기 기반)
  // L1: 실시간 100% 스트리밍 → 5분
  // L2: 10분 주기 → 15분 (여유 50%)
  // L3: 30분 주기 → 45분
  // L4: 1시간 주기 → 90분
  // L5: 1시간 주기 → 90분
  const STALENESS_THRESHOLDS = {
    L1:  5 * 60,      // 300초
    L2: 15 * 60,      // 900초
    L3: 45 * 60,      // 2700초
    L4: 90 * 60,      // 5400초
    L5: 90 * 60,      // 5400초
  };

  async function fetchOne(l) {
    const url = LAYER_STATUS_URLS[l];
    try {
      const res = await fetch(url, { cf: { cacheTtl: 30 } });
      if (!res.ok) return { layer: l, fetched: false, error: `HTTP ${res.status}` };
      const raw = await res.json();
      const now = Date.now();
      const lastMs = raw.last_verified ? new Date(raw.last_verified).getTime() : 0;
      const staleMs = now - lastMs;
      const staleThresholdSec = STALENESS_THRESHOLDS[l] ?? 300;
      const isStale = lastMs > 0 && staleMs > staleThresholdSec * 1000;
      return {
        layer:          l,
        fetched:        true,
        node_id:        raw.node_id,
        total_blocks:   raw.total_blocks,
        latest_hash:    raw.latest_hash,
        chain_valid:    raw.chain_valid,
        ilmv_status:    raw.ilmv_status,
        openhash_tx:    raw.openhash_tx,
        last_verified:  raw.last_verified,
        staleness_sec:  Math.round(staleMs / 1000),
        staleness_threshold_sec: staleThresholdSec,
        timestamp_stale: isStale,
        audit: {
          hashChainBreak:   raw.chain_valid === false,
          bivmViolation:    raw.ilmv_status === 'VIOLATION',
          timestampStale:   isStale,
          signatureFailure: raw.ilmv_status === 'SIGNATURE_FAILURE',
          errorRate:        raw.openhash_tx === 'FAILED' ? 1.0 : 0,
        },
      };
    } catch(e) {
      return { layer: l, fetched: false, error: e.message };
    }
  }

  let results;
  if (layer && LAYER_STATUS_URLS[layer]) {
    results = { [layer]: await fetchOne(layer) };
  } else {
    const layers = ['L1','L2','L3','L4','L5'];
    const settled = await Promise.allSettled(layers.map(l => fetchOne(l)));
    results = {};
    settled.forEach((r,i) => {
      results[layers[i]] = r.status === 'fulfilled' ? r.value : { layer: layers[i], fetched: false };
    });
  }

  // 전체 상태 요약
  const allFetched = Object.values(results).filter(r => r.fetched);
  // summary: 치명적 이슈(체인단절/BIVM/서명실패)와 경고(타임스탬프)를 분리
  const criticalIssue = allFetched.some(r =>
    r.audit?.hashChainBreak || r.audit?.bivmViolation || r.audit?.signatureFailure
  );
  const staleWarning = allFetched.some(r => r.audit?.timestampStale);

  return new Response(JSON.stringify({
    ok:        true,
    summary:   criticalIssue ? 'ISSUE_DETECTED' : staleWarning ? 'STALE_WARNING' : 'NORMAL',
    queried_at: new Date().toISOString(),
    layers:    results,
  }, null, 2), { status: 200, headers: corsHeaders });
}

// Module 5.5 — Hash Chain & BIVM (PDV-HASHCHAIN-DESIGN-v3.0)
// ═══════════════════════════════════════════════════════════

// ── 중요도 점수 (논문 §4.1 공식) ────────────────────────────────────────
// importanceVerifier.js와 100% 동일 공식 유지 — 단일 정의 원칙
// worker.js는 ES 모듈 import 불가(단일 파일 구조)이므로 인라인 포팅
//
// score = W_AMOUNT·f_amount + W_TYPE·f_type + W_CONTRACT·f_contract
//   f_amount(v)   = min(v / V_REF, 1.0) × 100
//   f_type        : stable=1.0, physical=0.8, point=0.3
//   f_contract    : escrow=1.0, conditional=0.8, instant=0.5
//   임계값: LIGHTWEIGHT<25, STANDARD<60, ENHANCED≥60
const _IMPORTANCE = {
  W_AMOUNT: 0.5, W_TYPE: 0.3, W_CONTRACT: 0.2,
  V_REF: 100_000,
  F_TYPE:     { stable: 1.0, physical: 0.8, point: 0.3 },
  F_CONTRACT: { escrow: 1.0, conditional: 0.8, instant: 0.5 },
  LIGHTWEIGHT_MAX: 25,
  STANDARD_MAX:    60,
};

/**
 * 거래 중요도 점수 계산 (논문 §4.1)
 * importanceVerifier.js#calculateImportanceScore 와 동일 공식
 * @param {number} amount       - 거래 금액 (GDC)
 * @param {string} assetType    - 'stable'|'physical'|'point'
 * @param {string} contractType - 'instant'|'conditional'|'escrow'
 * @returns {number} score (0~100)
 */
function _computeImportanceScore(amount, assetType = 'stable', contractType = 'instant') {
  const fAmount   = Math.min(amount / _IMPORTANCE.V_REF, 1.0) * 100;
  const fType     = _IMPORTANCE.F_TYPE[assetType]     ?? _IMPORTANCE.F_TYPE.stable;
  const fContract = _IMPORTANCE.F_CONTRACT[contractType] ?? _IMPORTANCE.F_CONTRACT.instant;
  return (
    _IMPORTANCE.W_AMOUNT   * fAmount   +
    _IMPORTANCE.W_TYPE     * fType     +
    _IMPORTANCE.W_CONTRACT * fContract
  );
}

/**
 * score → 검증 모드
 * @param {number} score
 * @returns {'LIGHTWEIGHT'|'STANDARD'|'ENHANCED'}
 */
function _selectImportanceMode(score) {
  if (score < _IMPORTANCE.LIGHTWEIGHT_MAX) return 'LIGHTWEIGHT';
  if (score < _IMPORTANCE.STANDARD_MAX)    return 'STANDARD';
  return 'ENHANCED';
}

// ── LCAT 계산 (논문 §4.1 PLSM 입력) ────────────────────────────────────
// LCAT(Localized Commit Affinity Type): 거래 당사자의 물리적 위치로 결정
// 검색 requires_geo 플래그와 완전히 독립 — 절대 같은 플래그로 묶지 않는다
//
// 현재: gopang 한림읍 파일럿 단계 → 제주 내부=A, 제주↔육지=B, 국제=C
// geo 정보가 없는 경우 보수적으로 'B' (표준 계층 라우팅) 사용
/**
 * LCAT 계산
 * @param {string|null} buyerRegion  - 구매자 지역 코드 (예: 'jeju', 'seoul', 'us')
 * @param {string|null} sellerRegion - 판매자 지역 코드
 * @returns {'A'|'B'|'C'}
 */
function computeLCAT(buyerRegion, sellerRegion) {
  const jeju = new Set(['jeju', 'jeju-si', 'seogwipo']);
  const kr   = new Set(['seoul', 'busan', 'daegu', 'incheon', 'gwangju',
                        'daejeon', 'ulsan', 'sejong', 'gyeonggi', 'gangwon',
                        'chungbuk', 'chungnam', 'jeonbuk', 'jeonnam',
                        'gyeongbuk', 'gyeongnam', 'jeju']); // 제주도 본인도 kr 포함
  if (!buyerRegion || !sellerRegion) return 'B'; // 정보 없음 → 보수적
  const bJeju = jeju.has(buyerRegion.toLowerCase());
  const sJeju = jeju.has(sellerRegion.toLowerCase());
  const bKr   = kr.has(buyerRegion.toLowerCase());
  const sKr   = kr.has(sellerRegion.toLowerCase());
  if (bJeju && sJeju) return 'A';   // 제주 내부
  if (bKr   && sKr)   return 'B';   // 국내 (제주↔육지 포함)
  return 'C';                        // 국제
}

// 2026-07-07 제거: _fetchUserBalance()(Supabase user_profiles.extra.fs 조회)와
// _bivmVerify()(그 값 기반 사전검증)를 삭제했다 — handleBizOrder에서 이미
// 호출부를 걷어내 완전히 죽은 코드가 됐다. 잔액 검증은 이제 L1의
// computeBalance()(blocks 원장 재생)가 전담한다.

/**
 * C-1: L1 노드 Hash Chain H_N 기록
 * n_i = SHA-256(n_{i-1} ∥ h_{user,i})
 */
async function updateNodeHashChain(env, { userHash, txId, blockHash, buyerGuid, sellerGuid, balanceClaimed }) {
  try {
    // (2026-07-14: Supabase l1_ledger(선형 해시체인 전용 테이블 — main.pb.js의
    //  동명 l1_ledger 블록원장과는 완전히 별개) → L1 tx_hash_chain 이관.
    //  이 체인은 엄격히 순차적이라 위 tx_hash_chain 마이그레이션 주석에
    //  적어둔 대로 경쟁 상태 위험이 있다 — Supabase 버전에도 있던 한계라
    //  이번 이관에서 새로 생긴 문제는 아니다.)
    const token = await _l1AdminToken(env);
    const headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };

    // 직전 node_hash 조회
    const lastRes = await fetch(
      `${L1_DEFAULT}/api/collections/tx_hash_chain/records?sort=-anchored_at&perPage=1`,
      { headers }
    );
    const lastData = lastRes.ok ? await lastRes.json().catch(() => ({ items: [] })) : { items: [] };
    const prevNodeHash = lastData.items?.[0]?.node_hash || '0'.repeat(64);

    // n_i = SHA-256(n_{i-1} ∥ h_{user,i})
    const input    = new TextEncoder().encode(prevNodeHash + userHash);
    const buf      = await crypto.subtle.digest('SHA-256', input);
    const nodeHash = Array.from(new Uint8Array(buf))
      .map(b => b.toString(16).padStart(2, '0')).join('');

    await fetch(`${L1_DEFAULT}/api/collections/tx_hash_chain/records`, {
      method:  'POST',
      headers,
      body: JSON.stringify({
        tx_id:           txId,
        buyer_guid:      buyerGuid,
        seller_guid:     sellerGuid,
        block_hash:      blockHash,
        user_hash:       userHash,
        node_hash:       nodeHash,
        balance_claimed: balanceClaimed,
        anchored_at:     new Date().toISOString(),
      }),
    });

    console.log('[H_N] tx_hash_chain 기록 완료 | tx_id:', txId?.slice(0, 8),
      '| node_hash:', nodeHash.slice(0, 8));
    return nodeHash;
  } catch(e) {
    console.warn('[H_N] updateNodeHashChain 실패:', e.message);
  }
}

/**
 * 사용자 Hash Chain h_i 계산
 * h_i = SHA-256(block_hash ∥ tx_hash ∥ height)
 * ※ 클라이언트의 전체 공식과 달리 Worker는 prev_local_hash 없이
 *   block_hash + tx_hash + height로 user_hash를 산출합니다.
 *   (IDB 없는 서버 환경 — L1 응답 기반 단순화)
 */
async function _computeUserHash(txHash, blockHash, height) {
  const input = new TextEncoder().encode(blockHash + txHash + String(height));
  const buf   = await crypto.subtle.digest('SHA-256', input);
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * C-2a: L1 응답 vs outputs 일관성 검증
 * 감시 모드 — 불일치 시 로그만 기록, 거래 차단 안 함 (T10까지)
 */
// 2026-07-07 수정: 이전엔 구매자 쪽(buyer_claim.amount vs 전체 outputs
// 합계)만 봤다 — "판매자와 구매자의 재무제표 변동 사항 일치 검증"이라는
// 요청에 정확히 맞추려면 판매자 쪽도 봐야 한다. L1이 독립적으로 계산해
// 돌려준 seller_claim.amount가, 원래 보내려던 판매자 몫(outputs 중
// gopang-platform이 아닌 첫 수취인)과 정확히 일치하는지도 검증한다.
// [2026-07 통합 수정] 허용오차를 src/openhash/bivm.js의 BIVM_CONST.EPSILON과
// 일치시킨다. 기존 0.01은 bivm.js의 1e-9보다 1,000만 배 느슨해서, 클라이언트
// (GDC 송금 등 bivm.js 경유)와 서버(이 파일)가 서로 다른 기준으로 같은 이름의
// 검증을 하고 있었다 — 정본은 bivm.js이므로 여기 값을 반드시 함께 맞춘다.
// 정본: src/openhash/bivm.js BIVM_CONST.EPSILON — 그쪽을 고치면 이 값도 같이 고칠 것.
const _BIVM_EPSILON = 1e-9;

function verifyOutputConsistency(l1Response, outputs) {
  const l1BuyerTotal  = l1Response.buyer_claim?.amount  || 0;
  const l1SellerTotal = l1Response.seller_claim?.amount || 0;
  const calcTotal     = outputs.reduce((s, o) => s + (o.amount || 0), 0);
  const calcSellerNet = outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0;

  const buyerConsistent  = Math.abs(l1BuyerTotal  - calcTotal)     < _BIVM_EPSILON;
  const sellerConsistent = Math.abs(l1SellerTotal - calcSellerNet) < _BIVM_EPSILON;
  const consistent = buyerConsistent && sellerConsistent;

  if (!consistent) {
    console.error('[BIVM] L1 응답 vs outputs 불일치!', JSON.stringify({
      buyer:  { l1: l1BuyerTotal,  calc: calcTotal,     diff: l1BuyerTotal  - calcTotal },
      seller: { l1: l1SellerTotal, calc: calcSellerNet, diff: l1SellerTotal - calcSellerNet },
    }));
  }
  return consistent;
}

/**
 * C-2b: 실시간 Σδ=0 검증 (설계서 E1 수정)
 * buyer_debit = seller_credit + platform_debit
 * 감시 모드 — 불일치 시 로그만 기록, 거래 차단 안 함 (T10까지)
 */
function verifyDeltaZero(outputs, balanceClaimed) {
  const sellerNet   = outputs.find(o => o.recipient_guid !== 'gopang-platform')?.amount || 0;
  const platformFee = outputs.find(o => o.recipient_guid === 'gopang-platform')?.amount  || 0;
  const buyerDebit  = sellerNet + platformFee;
  const sigmaDelta  = Math.abs(buyerDebit - sellerNet - platformFee);

  if (sigmaDelta > _BIVM_EPSILON) {
    console.error('[BIVM] Σδ ≠ 0 — 집합 잔액 불변성 위반!',
      JSON.stringify({ buyerDebit, sellerNet, platformFee, sigmaDelta }));
    return { valid: false, sigmaDelta };
  }
  // 2026-07-07 제거: 여기 있던 "balanceClaimed < buyerDebit → 잔액 부족"
  // 판정을 걷어냈다. balance_claimed는 클라이언트 자체 신고값이라 더 이상
  // 신뢰하지 않기로 했고(L1의 computeBalance가 유일한 권위) — 이 시점에
  // 이미 L1이 잔액을 승인했으니(그러지 않았으면 handleBizOrder가 여기까지
  // 오지도 못했다) 거래는 실제로 정상이다. 그런데 이 체크가 남아있으면
  // balance_claimed를 정확히 안 보낸(이제 그럴 필요가 없어진) 모든 정상
  // 거래를 매번 "불일치"로 잘못 표시해서, 감사 기록(consistency_check)
  // 자체를 오염시킨다. balanceClaimed 인자는 참고 로그용으로만 남긴다.
  if (balanceClaimed != null) {
    console.log('[BIVM] balance_claimed(참고용, 판정에 미사용):',
      JSON.stringify({ balanceClaimed, buyerDebit }));
  }
  return { valid: true, sigmaDelta: 0 };
}

// ═══════════════════════════════════════════════════════════
// Module T10 — Merkle Anchoring (anchorL1MerkleRoot)
// Cron: 10분마다 실행
// 미앵커링 pdv_log 배치 → 머클 루트 계산 → merkle_anchors INSERT
// → pdv_log openhash_anchored = true 갱신
// ═══════════════════════════════════════════════════════════

// ═══════════════════════════════════════════════════════════
// Wallet X25519 — PC가 휴대폰의 암호화 공개키를 조회/등록
// ═══════════════════════════════════════════════════════════

// GET /wallet/x25519?guid=...  (PC가 호출, 인증 불필요 — 공개키는 비밀 아님)
async function handleWalletX25519Get(request, env, corsHeaders) {
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  let record;
  try {
    record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }

  const pubkey = record?.x25519_pubkey || null;

  if (!pubkey) {
    return new Response(JSON.stringify({
      ok: false, registered: false,
      message: '암호화 키가 아직 준비되지 않았습니다. 휴대폰에서 고팡 앱을 한 번 완전히 종료한 뒤 다시 열어 주세요. (가입이 안 되어 있다면 먼저 가입을 완료해 주세요.)',
    }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, registered: true, x25519_pubkey: pubkey }),
    { status: 200, headers: corsHeaders });
}

// POST /wallet/x25519  — 휴대폰이 자신의 X25519 공개키 등록
// body: { guid, x25519_pubkey, ed25519_pubkey, signature, ts }
// 서명 대상: `${guid}:${x25519_pubkey}:${ts}` (固定 문자열, /profile과 동일 패턴)
// Ed25519 서명을 요구하는 이유: 서명 없이 등록을 허용하면 공격자가
// 피해자의 guid를 알아내 먼저 자신의 키로 선점 등록(레이스 컨디션)할 수 있고,
// 이후 PC가 그 guid로 암호화한 API Key를 공격자가 복호화할 수 있게 된다.
async function handleWalletX25519Post(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, x25519_pubkey, ed25519_pubkey, signature, ts } = body;
  if (!guid)           return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!x25519_pubkey)  return _err(400, 'MISSING_FIELD', 'x25519_pubkey 필수', corsHeaders);
  if (!ed25519_pubkey) return _err(400, 'MISSING_FIELD', 'ed25519_pubkey 필수', corsHeaders);
  if (!signature)      return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  const sigMsg = `${guid}:${x25519_pubkey}:${ts || ''}`;
  const sigOk  = await _verifyEd25519Simple(ed25519_pubkey, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  let record;
  try {
    record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  // L1 profiles row는 가입(_register) 시 이미 생성되어 있어야 한다 — guid가 L1에 없으면
  // 가입 자체가 안 된 상태이므로 등록을 거부한다.
  if (!record) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);

  // TOFU: 이 guid에 이미 등록된 Ed25519 공개키와 일치해야만 진짜 소유자로 인정
  const knownEdPubkey = record.pubkey_ed25519;
  if (knownEdPubkey && knownEdPubkey !== ed25519_pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
  }

  // 정책: Ed25519 서명 검증 통과 = 본인 증명.
  // 기기 교체/앱 재설치는 계정 삭제로 처리하므로, 동일 기기에서 재등록 시
  // (앱 업데이트 후 IDB 유지 등) Ed25519가 일치하면 X25519도 갱신 허용.
  const alreadyRegistered = !!record.x25519_pubkey;
  try {
    await _l1PatchProfile(env, record.id, {
      pubkey_ed25519: knownEdPubkey || ed25519_pubkey,
      x25519_pubkey,
      x25519_registered_at: new Date().toISOString(),
    });
  } catch (e) {
    return _err(500, 'L1_PATCH_FAILED', e.message, corsHeaders);
  }

  return new Response(JSON.stringify({ ok: true, already_registered: alreadyRegistered, x25519_pubkey }),
    { status: 200, headers: corsHeaders });
}


// POST /account/delete-profile — "계정 삭제"(경량) — L1 profiles 레코드만 삭제
// body: { guid, phone, ed25519_pubkey, signature, ts }
// 서명 대상: `delete-profile:${guid}:${ts}` — full-reset과 동일한 서명 검증 패턴
//
// full-reset과의 차이(2026-07-02 신설, 설정 화면 "계정 삭제" 슬라이드아웃 전용):
//   - full-reset은 L1 + Supabase 9개 테이블 + KV까지 전부 지우고, 클라이언트도
//     로컬 데이터(PDV·지갑)까지 전부 초기화한다 — "완전 초기화" 용도.
//   - 이 엔드포인트는 L1 profiles(전화번호·guid 연결 정보) 딱 하나만 지운다.
//     PDV·지갑 같은 로컬 데이터는 이용자 기기에 그대로 남아있으므로(혼디는
//     서버에 원본 데이터를 두지 않는다는 설계 원칙), 나중에 같은 번호로
//     다시 가입하면 로컬에 남아있던 기록과 함께 이전 상태로 자연스럽게
//     이어진다 — 서버가 곧 원본인 기존 SNS와 근본적으로 다른 지점이다.
async function handleAccountDeleteProfile(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, phone, ed25519_pubkey, signature, ts } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  let l1Record = null;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!l1Record) {
    // 이미 없는 계정 — 삭제할 것도 없으므로 성공으로 취급(멱등성)
    return new Response(JSON.stringify({ ok: true, deleted: true, already_gone: true }),
      { status: 200, headers: corsHeaders });
  }

  // ── 본인 확인 1: 서명(핵심 보안 근거) ─────────────────────
  const knownEdPubkey = l1Record.pubkey_ed25519;
  if (knownEdPubkey) {
    if (!ed25519_pubkey || !signature)
      return _err(400, 'MISSING_FIELD', '본인 확인을 위해 ed25519_pubkey/signature가 필요합니다', corsHeaders);
    if (knownEdPubkey !== ed25519_pubkey)
      return _err(403, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
    const sigOk = await _verifyEd25519Simple(ed25519_pubkey, signature, `delete-profile:${guid}:${ts || ''}`);
    if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);
  }

  // ── 본인 확인 2: 전화번호(사용자가 화면에서 직접 재입력한 값) ──
  // 서명만으로도 충분히 안전하지만, 실수로 잘못된 계정을 지우는 걸 한 번
  // 더 막기 위한 보조 확인 — 저장된 값과 다르면 거부한다.
  if (phone && l1Record.phone && phone !== l1Record.phone) {
    return _err(403, 'PHONE_MISMATCH', '입력한 전화번호가 계정과 일치하지 않습니다', corsHeaders);
  }

  try {
    const token = await _l1AdminToken(env);
    const r = await fetch(
      `${L1_DEFAULT}/api/collections/profiles/records/${l1Record.id}`,
      { method: 'DELETE', headers: { 'Authorization': 'Admin ' + token } }
    );
    if (!r.ok && r.status !== 404) {
      return _err(502, 'L1_DELETE_FAILED', `L1 삭제 실패 (HTTP ${r.status})`, corsHeaders);
    }
  } catch (e) {
    return _err(502, 'L1_DELETE_FAILED', 'L1 삭제 실패: ' + e.message, corsHeaders);
  }

  console.info('[DeleteProfile] 삭제 완료 | guid:', guid.slice(0, 16));
  return new Response(JSON.stringify({ ok: true, deleted: true }), { status: 200, headers: corsHeaders });
}

// POST /account/full-reset — 계정 완전 삭제 시 Supabase user_profiles row 삭제
// body: { guid, ed25519_pubkey, signature, ts }
// 서명 대상: `full-reset:${guid}:${ts}` — 기존 등록된 ed25519 키로 서명해야 본인 확인됨
// (등록된 키가 없는 경우 — 즉 가입 직후 한 번도 X25519 설정을 안 한 계정 —는 서명 검증 없이 허용)
async function handleAccountFullReset(request, env, corsHeaders) {
  // POST /account/full-reset
  // 정책: 해당 사용자의 모든 기록을 서버에서 완전 삭제.
  // L1(profiles), Supabase(전 테이블), KV(봉투)에서 guid에 연결된 모든 row 제거.
  // 본인 확인: L1 pubkey_ed25519로 서명 검증. L1 키가 없으면(가입 직후 미등록) 서명 생략 허용.
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, ed25519_pubkey, signature, ts } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  // ── 본인 확인: L1 기준 ───────────────────────────────────
  let l1Record = null;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  const knownEdPubkey = l1Record?.pubkey_ed25519;
  if (knownEdPubkey) {
    if (!ed25519_pubkey || !signature)
      return _err(400, 'MISSING_FIELD', '본인 확인을 위해 ed25519_pubkey/signature가 필요합니다', corsHeaders);
    if (knownEdPubkey !== ed25519_pubkey)
      return _err(403, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
    const sigOk = await _verifyEd25519Simple(ed25519_pubkey, signature, `full-reset:${guid}:${ts || ''}`);
    if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);
  }

  const results = await _deleteAllUserData(env, guid, l1Record);

  console.info('[FullReset] 삭제 완료 | guid:', guid.slice(0, 16), '| 결과:', JSON.stringify(results));
  return new Response(JSON.stringify({ ok: true, deleted: true, results }), { status: 200, headers: corsHeaders });
}

// ── 사용자 1명의 모든 서버측 데이터 삭제 (L1 + Supabase 9개 테이블 + KV) ──────
// handleAccountFullReset(본인 요청)과 handleAdminBulkDelete(관리자 요청)이 공용으로 호출.
// ⚠️ 호출 전 전제조건: user_profiles.casts_for(그림자 FK)가 이 guid를 가리키는 row가
//    남아있으면 2번 단계(user_profiles 삭제)가 FK 위반으로 실패한다 — 호출자가 먼저
//    그림자 정리를 끝내야 한다(handleAdminBulkDelete의 ① casts_for 일괄 정리 참고).
async function _deleteAllUserData(env, guid, l1Record) {
  const results = {};

  // (2026-07-14 신설 — Supabase 폐기에 따라 여러 컬렉션에서 반복 필요해진
  //  "필터로 목록 조회 후 개별 DELETE" 패턴을 공용 헬퍼로 추출했다.
  //  PocketBase REST API는 Supabase처럼 필터 조건으로 여러 row를 한 번에
  //  지우는 벌크 DELETE가 없다.)
  async function _l1DeleteByFilter(collectionName, filter) {
    try {
      const token = await _l1AdminToken(env);
      const listRes = await fetch(
        `${L1_DEFAULT}/api/collections/${collectionName}/records?filter=${encodeURIComponent(filter)}&perPage=200`,
        { headers: { 'Authorization': 'Bearer ' + token } }
      );
      if (!listRes.ok) return `error:${listRes.status}`;
      const listData = await listRes.json().catch(() => ({ items: [] }));
      const items = listData.items || [];
      let failCount = 0;
      for (const item of items) {
        const delRes = await fetch(
          `${L1_DEFAULT}/api/collections/${collectionName}/records/${item.id}`,
          { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } }
        );
        if (!delRes.ok && delRes.status !== 404) failCount++;
      }
      return failCount === 0 ? `deleted(${items.length})` : `error:${failCount}/${items.length}_failed`;
    } catch (e) { return 'error:' + e.message; }
  }

  // ── 1. L1 profiles 삭제 ──────────────────────────────────
  if (l1Record?.id) {
    try {
      const token = await _l1AdminToken(env);
      const r = await fetch(
        `${L1_DEFAULT}/api/collections/profiles/records/${l1Record.id}`,
        { method: 'DELETE', headers: { 'Authorization': 'Admin ' + token } }
      );
      results.l1_profiles = r.ok || r.status === 404 ? 'deleted' : `error:${r.status}`;
    } catch (e) { results.l1_profiles = 'error:' + e.message; }
  } else {
    results.l1_profiles = 'not_found';
  }

  // ── 2. L1: user_llm_keys ─────────────────────────────────
  results.l1_user_llm_keys = await _l1DeleteByFilter('user_llm_keys', `guid='${String(guid).replace(/'/g, "\\'")}'`);

  // ── 3. L1: pdv_records ───────────────────────────────────
  results.l1_pdv_records = await _l1DeleteByFilter('pdv_records', `guid='${String(guid).replace(/'/g, "\\'")}'`);

  // ── 4. L1(hanlim): pdv_consent_requests ──────────────────
  // BUG-FIX(2026-07-02): 원래 Supabase pdv_consent_requests 테이블이 한 번도
  // 생성된 적이 없어(HTTP 404 PGRST205 확인됨) 여기서 항상 실패해 계정 완전
  // 삭제 전체가 막혔다. Supabase→L1 마이그레이션 방향에 맞춰 테이블을 새로
  // 만드는 대신 L1(hanlim) PocketBase에 pdv_consent_requests 컬렉션을 신설했다
  // (id: p1tketkfid3uup8, listRule 등 전부 관리자 전용).
  results.l1_pdv_consent = await _l1DeleteByFilter('pdv_consent_requests', `ipv6='${String(guid).replace(/'/g, "\\'")}'`);

  // ── 5. L1: tx_hash_chain ──────────────────────────────────
  // (2026-07-14: Supabase l1_ledger(선형 해시체인, updateNodeHashChain이
  //  씀 — PocketBase blocks 원장과는 별개) → L1 tx_hash_chain 이관.
  //  이 체인은 감사 기록이라 사용자별로 지우지 않는다 — buyer_guid/
  //  seller_guid로 지워버리면 그 거래에 관여했던 상대방 쪽 감사 기록도
  //  같이 끊긴다. 계정 삭제와 무관하게 보존한다(다른 항목들과 원칙이
  //  다름을 명시).
  results.l1_tx_hash_chain = 'retained_for_audit';

  // (2026-07-14: biz_products/biz_reviews/webauthn_credentials/
  //  webrtc_signals 항목 제거 — 전부 클라이언트 호출 지점이 없는 죽은
  //  기능이었고(handleBizProduct/handleBizReview/handleBizProfile,
  //  handleWARegister/handleWAVerify), 해당 함수 자체를 이 커밋에서
  //  삭제했다. webrtc_signals는 살아있는 기능이지만 만료시간 60초짜리
  //  휘발성 시그널링 데이터라 계정 삭제 시점까지 남아있을 값이 사실상
  //  없어 별도 정리 불필요.)

  // ── 6. Cloudflare KV: AI Setup 봉투 ────────────────────
  if (env.AI_SETUP_SEALS_KV) {
    try {
      await env.AI_SETUP_SEALS_KV.delete(guid);
      results.kv_ai_seal = 'deleted';
    } catch (e) { results.kv_ai_seal = 'error:' + e.message; }
  }

  return results;
}

// ═══════════════════════════════════════════════════════════
// POST /admin/users/bulk-delete — 관리자 일괄 삭제 (desktop.html 관리자 대시보드 전용)
// body: { admin_token, identifiers: ['@KR-12345678', '2601:db80:...', ...] }
// identifiers: '@'로 시작하면 handle로 보고 L1에서 guid를 조회, 아니면 그 값을 guid로 간주.
// 절차:
//   ① 식별자 → guid 해석 (handle인 경우 L1 조회)
//   ② casts_for(그림자) 일괄 정리 — 대상 guid를 본체로 둔 그림자 row를 먼저 지워야
//      2번 단계(user_profiles 삭제)가 자기참조 FK 위반으로 막히지 않는다.
//   ③ guid별 _deleteAllUserData()로 L1 + Supabase 9개 테이블 + KV 삭제
// 본인 서명(Ed25519) 검증 없음 — 관리자 HMAC 토큰(_verifyAdminToken)으로만 인증.
// 1회 호출당 최대 100개 — 그 이상은 여러 번에 나눠 호출할 것.
// ═══════════════════════════════════════════════════════════
async function handleAdminBulkDelete(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { admin_token, identifiers } = body;
  if (!admin_token) return _err(401, 'MISSING_TOKEN', 'admin_token 필수', corsHeaders);
  const isValid = await _verifyAdminToken(env, admin_token);
  if (!isValid) return _err(403, 'INVALID_TOKEN', '관리자 인증 실패', corsHeaders);

  if (!Array.isArray(identifiers) || identifiers.length === 0)
    return _err(400, 'MISSING_FIELD', 'identifiers(배열) 필수', corsHeaders);
  if (identifiers.length > 100)
    return _err(400, 'TOO_MANY', '한 번에 최대 100개까지 삭제할 수 있습니다', corsHeaders);

  const perItem  = {};

  // ① 식별자 → guid 해석
  const resolved = [];
  for (const raw of identifiers) {
    const id = (raw || '').trim();
    if (!id) continue;
    try {
      if (id.startsWith('@')) {
        const profile = await _l1FindProfileByHandle(env, id.slice(1));
        if (!profile) { perItem[id] = { error: 'handle_not_found' }; continue; }
        resolved.push({ key: id, guid: profile.guid });
      } else {
        resolved.push({ key: id, guid: id });
      }
    } catch (e) { perItem[id] = { error: 'resolve_failed:' + e.message }; }
  }

  if (!resolved.length) {
    return new Response(JSON.stringify({ ok: true, count: 0, results: perItem }),
      { status: 200, headers: corsHeaders });
  }

  // ② 그림자(casts_for) 일괄 정리 — 본체들 삭제 전에 먼저 처리
  // (2026-07-15: Supabase user_profiles → L1 이관. casts_for는 L1
  //  profiles에서 top-level 필드가 아니라 extra.core.casts_for(중첩
  //  JSON)로 저장돼 있어(2885행 주석 참고) PocketBase 필터로 직접
  //  못 찾는다 — profiles 전체를 넓게 가져와 JS에서 매칭한다.)
  let shadowCleanup = 'skipped';
  try {
    const targetGuids = new Set(resolved.map(r => r.guid));
    const token = await _l1AdminToken(env);
    const listRes = await fetch(
      `${L1_DEFAULT}/api/collections/profiles/records?perPage=2000`,
      { headers: { 'Authorization': 'Bearer ' + token } }
    );
    const listData = await listRes.json().catch(() => ({ items: [] }));
    const shadows = (listData.items || []).filter(p => {
      let extra;
      try { extra = typeof p.extra === 'string' ? JSON.parse(p.extra) : p.extra; } catch { return false; }
      return targetGuids.has(extra?.core?.casts_for);
    });
    let failCount = 0;
    for (const s of shadows) {
      const delRes = await fetch(
        `${L1_DEFAULT}/api/collections/profiles/records/${s.id}`,
        { method: 'DELETE', headers: { 'Authorization': 'Bearer ' + token } }
      );
      if (!delRes.ok && delRes.status !== 404) failCount++;
    }
    shadowCleanup = failCount === 0 ? `deleted(${shadows.length})` : `error:${failCount}/${shadows.length}_failed`;
  } catch (e) { shadowCleanup = 'error:' + e.message; }

  // ③ guid별 전체 삭제
  for (const { key, guid } of resolved) {
    let l1Record = null;
    try {
      l1Record = await _l1FindProfileByGuid(env, guid);
    } catch (e) {
      perItem[key] = { l1_profiles: 'error:' + e.message };
      continue;
    }
    perItem[key] = await _deleteAllUserData(env, guid, l1Record);
  }

  console.info('[AdminBulkDelete] 완료 | 대상:', identifiers.length, '| shadow_cleanup:', shadowCleanup);
  return new Response(JSON.stringify({
    ok: true, count: resolved.length, shadow_cleanup: shadowCleanup, results: perItem,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// AI Setup Seal — PC→휴대폰 1회용 암호화 봉투
// 평문 API 키는 절대 이 테이블에 닿지 않음 (PC가 암호화한 바이트만 경유)
// ═══════════════════════════════════════════════════════════

// POST /ai-setup/seal — PC가 암호문 저장 (서명 불필요, 암호문 자체가 무의미한 바이트)
// body: { guid, ephemeral_pubkey, iv, ciphertext }
// AI Setup Seal — PC가 X25519로 암호화한 LLM 설정을 5분짜리 임시 우편함에 보관.
// 영구 저장이 필요 없는 단기 메시지이므로 Supabase(RLS 정책 관리 부담, 관계형 DB)
// 대신 Cloudflare KV를 사용 — TTL을 네이티브로 지원하고 행 단위 권한 정책이
// 없어 이런 종류의 권한 오류(42501 등) 자체가 발생할 수 없다.
async function handleAiSetupSealPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, ephemeral_pubkey, iv, ciphertext } = body;
  if (!guid)             return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!ephemeral_pubkey) return _err(400, 'MISSING_FIELD', 'ephemeral_pubkey 필수', corsHeaders);
  if (!iv)               return _err(400, 'MISSING_FIELD', 'iv 필수', corsHeaders);
  if (!ciphertext)       return _err(400, 'MISSING_FIELD', 'ciphertext 필수', corsHeaders);

  if (!env.AI_SETUP_SEALS_KV)
    return _err(500, 'CONFIG_ERROR', 'AI_SETUP_SEALS_KV 바인딩 미설정', corsHeaders);

  const ttlSeconds = 5 * 60; // 5분 — KV expirationTtl 최소값은 60초이므로 충분히 안전
  const expiresAt  = new Date(Date.now() + ttlSeconds * 1000).toISOString();

  try {
    // KV는 같은 키에 put()하면 자동으로 덮어쓰므로 별도 DELETE 불필요
    await env.AI_SETUP_SEALS_KV.put(
      guid,
      JSON.stringify({ ephemeral_pubkey, iv, ciphertext, created_at: new Date().toISOString() }),
      { expirationTtl: ttlSeconds }
    );
  } catch (e) {
    return _err(502, 'KV_ERROR', 'KV 저장 실패: ' + e.message, corsHeaders);
  }

  // PC가 키 전송을 완료한 "이 순간"이 트리거 — 휴대폰이 화면을 보고 있지 않아도
  // 즉시 푸시 알림을 보내 자동 동기화를 깨운다 (polling 불필요).
  _sendPushToGuid(env, guid, {
    title: 'AI 비서 설정',
    body:  'PC에서 보낸 설정을 적용하는 중입니다.',
    tag:   'gopang-ai-setup-' + guid.slice(-8),
    url:   '/webapp.html',
  }).catch(e => console.warn('[AI Setup] 푸시 트리거 실패 (무시):', e.message));

  return new Response(JSON.stringify({ ok: true, expires_at: expiresAt }),
    { status: 200, headers: corsHeaders });
}

// GET /ai-setup/seal?guid=...&consume=1 — 휴대폰이 자신의 봉투 조회 (consume=1이면 즉시 삭제)
async function handleAiSetupSealGet(request, env, corsHeaders) {
  const url     = new URL(request.url);
  const guid    = url.searchParams.get('guid');
  const consume = url.searchParams.get('consume') === '1';
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  if (!env.AI_SETUP_SEALS_KV)
    return _err(500, 'CONFIG_ERROR', 'AI_SETUP_SEALS_KV 바인딩 미설정', corsHeaders);

  let raw;
  try {
    raw = await env.AI_SETUP_SEALS_KV.get(guid);
  } catch (e) {
    return _err(502, 'KV_ERROR', 'KV 조회 실패: ' + e.message, corsHeaders);
  }
  if (!raw) {
    return new Response(JSON.stringify({ ok: true, sealed: null }), { status: 200, headers: corsHeaders });
  }
  const sealed = JSON.parse(raw);

  if (consume) {
    await env.AI_SETUP_SEALS_KV.delete(guid).catch(() => {});
  }

  return new Response(JSON.stringify({ ok: true, sealed }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// /ai-setup GET — 현재 AI 비서 설정 조회
// ═══════════════════════════════════════════════════════════
async function handleAiSetupGet(request, env, corsHeaders, guid) {
  // (2026-07-14: Supabase user_llm_keys → L1 이관. 겸사겸사 발견한
  //  기존 버그도 고친다 — 원래 select 절에 api_key_enc가 빠져있어서
  //  has_key가 사실상 항상 false였다(row.api_key_enc가 항상 undefined).
  //  PocketBase는 select 파라미터 없이 전체 필드를 반환하므로 이 버그가
  //  구조적으로 재발할 수 없다.)
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`guid='${String(guid).replace(/'/g, "\\'")}'`);
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/user_llm_keys/records?filter=${filter}&perPage=1`,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  if (!res.ok) return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패', corsHeaders);
  const data = await res.json().catch(() => ({ items: [] }));
  const row = (data.items || [])[0];
  if (!row) {
    return new Response(JSON.stringify({
      ai_active: false, provider: 'deepseek', model: 'deepseek-v4-flash',
      has_key: false, custom_prompt: '',
    }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({
    ai_active:     row.ai_active,
    provider:      row.provider,
    model:         row.model,
    has_key:       !!(row.api_key_enc),
    custom_prompt: row.custom_prompt || '',
    native_lang:   row.native_lang || 'ko',
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// ═══════════════════════════════════════════════════════════
// v5.0 — WebRTC 시그널링 핸들러 (P2P 채팅)
// 원칙: 메시지 본문 절대 저장 없음 — SDP/ICE 60초 TTL 후 삭제
// ═══════════════════════════════════════════════════════════

// _SIGNAL_L1_PATCH_APPLIED_
// ═══════════════════════════════════════════════════════════
// 시그널 핸들러 — L1 PocketBase 우선 + Supabase 폴백
// L1: https://l1-hanlim.hondi.net/api/collections/webrtc_signals/records
//     API Rules = 빈칸(모두 허용) — 토큰 불필요
// Supabase: 기존 webrtc_signals 테이블 (L1 실패 시 자동 폴백)
// ═══════════════════════════════════════════════════════════

const L1_SIGNAL_URL = `${L1_DEFAULT}/api/collections/webrtc_signals/records`;

// ── L1 시그널 저장 헬퍼 ──────────────────────────────────────
async function _l1SignalSend(from_guid, to_guid, type, payload, expires_at) {
  const res = await fetch(L1_SIGNAL_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ from_guid, to_guid, type, payload, expires_at }),
  });
  if (!res.ok) throw new Error(`L1 signal send ${res.status}: ${await res.text().catch(()=>'')}`);
  return res;
}

// ── L1 시그널 조회 헬퍼 ──────────────────────────────────────
async function _l1SignalPoll(guid) {
  const now    = new Date().toISOString();
  const filter = encodeURIComponent(`to_guid='${guid}'`);
  // 캐시 완전 무력화: cache:'no-store' + 매번 달라지는 cache-buster 쿼리.
  // Cloudflare Worker의 fetch()는 기본적으로 GET을 엣지에서 캐싱할 수 있어서,
  // 같은 URL 패턴이 반복되는 폴링 요청이 옛(비어있던) 응답을 계속 재사용하는
  // 문제가 있었다. PocketBase에 직접 조회하면 최신 데이터가 보이는데
  // 워커를 거치면 비어있던 게 정확히 이 캐시 문제였다.
  const res    = await fetch(
    `${L1_SIGNAL_URL}?filter=${filter}&sort=-created&perPage=40&_ts=${Date.now()}`,
    { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' }
  );
  if (!res.ok) throw new Error(`L1 signal poll ${res.status}`);
  const data = await res.json().catch(() => ({ items: [] }));
  // PocketBase 응답: { items: [...] } → Supabase 형식 배열로 정규화
  const items = (data.items || []).filter(r => {
    // expires_at 필터 (L1은 필터 표현식으로 처리 안 되므로 클라이언트 필터)
    if (!r.expires_at) return true;
    return new Date(r.expires_at) > new Date();
  });
  return items;
}

// ── L1 시그널 삭제 헬퍼 ──────────────────────────────────────
async function _l1SignalDelete(field, value) {
  // PocketBase: 필터로 목록 조회 후 id별 삭제 (REST v1)
  // 캐시 완전 무력화 (이유는 _l1SignalPoll 주석 참고)
  const filter = encodeURIComponent(`${field}='${value}'`);
  const listRes = await fetch(
    `${L1_SIGNAL_URL}?filter=${filter}&perPage=50&_ts=${Date.now()}`,
    { headers: { 'Content-Type': 'application/json' }, cache: 'no-store' }
  );
  if (!listRes.ok) throw new Error(`L1 signal list ${listRes.status}`);
  const data  = await listRes.json().catch(() => ({ items: [] }));
  const items = data.items || [];
  await Promise.all(items.map(r =>
    fetch(`${L1_SIGNAL_URL}/${r.id}`, { method: 'DELETE' }).catch(() => {})
  ));
}

// ═══════════════════════════════════════════════════════════
// TURN credential 발급 (coturn static-auth-secret 방식)
// RFC 8489 time-limited credential:
//   username  = "{expiry}:{guid}"
//   credential = base64(HMAC-SHA1(TURN_SECRET, username))
// coturn turnserver.conf:
//   use-auth-secret
//   static-auth-secret=${TURN_SECRET}
// ═══════════════════════════════════════════════════════════
async function handleTurnCredential(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const guid   = url.searchParams.get('guid') || 'anonymous';
  const secret = env.TURN_SECRET;

  // TURN_SECRET 미설정 시 STUN 전용 폴백
  if (!secret) {
    console.warn('[TURN] TURN_SECRET 미설정 — STUN 전용 사용');
    return new Response(JSON.stringify({
      ok: true,
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
      ],
      fallback: true,
    }), { status: 200, headers: corsHeaders });
  }

  // expiry = 지금 + 1시간
  const expiry   = Math.floor(Date.now() / 1000) + 3600;
  const username = `${expiry}:${guid}`;

  // HMAC-SHA1(secret, username) → base64
  const keyData   = new TextEncoder().encode(secret);
  const msgData   = new TextEncoder().encode(username);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const sigBuf     = await crypto.subtle.sign('HMAC', cryptoKey, msgData);
  const credential = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));

  const host = 'l1-hanlim.hondi.net';

  return new Response(JSON.stringify({
    ok: true,
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      {
        urls: [
          `turn:${host}:3478?transport=udp`,
          `turn:${host}:3478?transport=tcp`,
          `turns:${host}:5349?transport=tcp`,
        ],
        username,
        credential,
      },
    ],
    expiry,
  }), { status: 200, headers: { ...corsHeaders, 'Cache-Control': 'no-store' } });
}

async function handleSignalSend(request, env, corsHeaders) {
  if (request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);
  const { from_guid, to_guid, type, payload } = body;
  if (!from_guid || !to_guid || !type || !payload)
    return _err(400, 'MISSING_FIELDS', 'from_guid, to_guid, type, payload 필수', corsHeaders);
  if (!['offer','answer','ice'].includes(type))
    return _err(400, 'INVALID_TYPE', 'offer|answer|ice 만 허용', corsHeaders);

  const expires_at = new Date(Date.now() + 60_000).toISOString();

  // (2026-07-14: Supabase 폴백 제거 — L1이 실패하면 그대로 실패 처리한다.
  //  webrtc_signals는 초 단위로 재시도되는 폴링성 데이터라 클라이언트가
  //  다음 폴링에서 다시 시도하면 되므로, 서버가 대신 폴백해줄 필요가 없다.)
  try {
    await _l1SignalSend(from_guid, to_guid, type, payload, expires_at);
  } catch (l1Err) {
    console.warn('[Signal] L1 저장 실패:', l1Err.message);
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + l1Err.message, corsHeaders);
  }

  // ── 수신자에게 Push 알림 전송 (offer 시그널일 때만)
  if (type === 'offer') {
    _sendPushToGuid(env, to_guid, {
      title: from_guid.slice(0, 8) + '님의 메시지',
      body:  '새 메시지가 도착했습니다.',
      tag:   'gopang-msg-' + from_guid.slice(0, 8),
      url:   '/webapp.html',
    }).catch(e => console.warn('[Push] 알림 전송 실패:', e.message));
  }

  return new Response(JSON.stringify({ ok: true, source: 'l1' }), { status: 200, headers: corsHeaders });
}

async function handleSignalPoll(request, env, corsHeaders) {
  if (request.method !== 'GET') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'GUID_REQUIRED', '', corsHeaders);

  try {
    const signals = await _l1SignalPoll(guid);
    return new Response(JSON.stringify({ ok: true, signals, source: 'l1' }), { status: 200, headers: corsHeaders });
  } catch (l1Err) {
    console.warn('[Signal] L1 poll 실패:', l1Err.message);
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + l1Err.message, corsHeaders);
  }
}

async function handleSignalDelete(request, env, corsHeaders) {
  if (request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);

  try {
    if (body.id)        await _l1SignalDelete('id',        body.id);
    if (body.from_guid) await _l1SignalDelete('from_guid', body.from_guid);
    return new Response(JSON.stringify({ ok: true, source: 'l1' }), { status: 200, headers: corsHeaders });
  } catch (l1Err) {
    console.warn('[Signal] L1 delete 실패:', l1Err.message);
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + l1Err.message, corsHeaders);
  }
}



// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/search
// global_profiles에서 닉네임 검색 (DHT 인덱스 노드 임시 대체)
// GET /p2p/search?q=James&country=US&region=New+York&limit=20
// ═══════════════════════════════════════════════════════════
async function handleP2PSearch(request, env, corsHeaders) {
  const url     = new URL(request.url);
  const q       = url.searchParams.get('q')?.trim();
  const country = url.searchParams.get('country')?.trim();
  const region  = url.searchParams.get('region')?.trim();
  const handle  = url.searchParams.get('handle')?.trim();
  const limit   = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);

  if (!q && !handle) return _err(400, 'QUERY_REQUIRED', 'q 또는 handle 파라미터 필수', corsHeaders);

  // ── L1 PocketBase 검색 (GDUDA 본 구현) ──────────────────
  // Supabase global_profiles → L1 PocketBase profiles 컬렉션으로 전환
  // L1 PocketBase: https://l1-hanlim.hondi.net
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';

  let queryUrl = `${L1_PROFILES}?perPage=${limit}&fields=guid,handle,nickname,country_code,region`;

  // handle 직접 검색 (정확히 일치)
  if (handle) {
    const h = handle.startsWith('@') ? handle : '@' + handle;
    queryUrl += `&filter=${encodeURIComponent(`handle='${h}'`)}`;
  } else {
    // 닉네임 부분 일치 + 국가/지역 필터
    let filter = `(nickname~'${q}'||handle~'${q}')`;
    if (country) filter += `&&country_code='${country}'`;
    if (region)  filter += `&&region~'${region}'`;
    queryUrl += `&filter=${encodeURIComponent(filter)}`;
  }

  try {
    const res  = await fetch(queryUrl);
    const data = await res.json().catch(() => ({ items: [] }));
    const users = (data.items || []).map(r => ({
      guid:         r.guid,
      handle:       r.handle,
      nickname:     r.nickname,
      country_code: r.country_code,
      region:       r.region,
      current_l1:   L1_DEFAULT,
    }));

    return new Response(JSON.stringify({
      ok:    true,
      users,
      count: users.length,
      query: { q, country, region, handle },
      source: 'l1-pocketbase',
    }), { status: 200, headers: corsHeaders });
  } catch(e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 PocketBase 검색 실패: ' + e.message, corsHeaders);
  }
}

// ═══════════════════════════════════════════════════════════
// GDUDA Phase 1 — /p2p/register
// global_profiles에 사용자 등록 (HLR 역할)
// ═══════════════════════════════════════════════════════════
async function handleP2PRegister(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', '', corsHeaders);

  const { guid, handle, nickname, nickname_hash, country_code, region, current_l1 } = body;
  if (!guid)   return _err(400, 'MISSING_FIELDS', 'guid 필수', corsHeaders);
  if (!handle) return _err(400, 'MISSING_FIELDS', 'handle 필수', corsHeaders);

  // ── L1 PocketBase 등록 (GDUDA 본 구현) ──────────────────
  // Supabase global_profiles → L1 PocketBase profiles 컬렉션으로 전환
  const L1_PROFILES = L1_DEFAULT + '/api/collections/profiles/records';
  const now = new Date().toISOString();

  // 기존 레코드 확인 (guid 우선, handle도 함께 — 둘 중 하나라도 일치하면 같은 사용자)
  // ※ 이전엔 handle만으로 확인했는데, 가입 직후 다른 등록 경로(auth.js의
  // 기본 가입)와 거의 동시에 호출되면 그 레코드가 아직 안 보일 수 있어서
  // (조회 결과 미반영 — 인덱싱/replication 지연), 같은 guid인데도 "없음"으로
  // 판단해 새 레코드를 또 만드는 경쟁 상태가 있었다. guid까지 같이 보면
  // 더 안전하지만, 동시성 자체를 완전히 막는 건 아니다 — 근본 해결은
  // PocketBase profiles 컬렉션의 guid 필드에 unique 제약을 거는 것.
  try {
    const chkFilter = `handle='${handle}' || guid='${guid}'`;
    const chkRes = await fetch(
      `${L1_PROFILES}?filter=${encodeURIComponent(chkFilter)}&perPage=1`
    );
    const chkData = await chkRes.json().catch(() => ({ items: [] }));
    const existing = chkData.items?.[0];

    if (existing) {
      // 기존 레코드 PATCH (current_l1 갱신)
      const patchRes = await fetch(`${L1_PROFILES}/${existing.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nickname: nickname || existing.nickname,
          region:   region   || existing.region,
        }),
      });
      if (!patchRes.ok) return _err(500, 'L1_UPDATE_ERROR', await patchRes.text(), corsHeaders);
    } else {
      // 신규 레코드 POST
      const postRes = await fetch(L1_PROFILES, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guid,
          handle,
          nickname:      nickname      || null,
          nickname_hash: nickname_hash || null,
          country_code:  country_code  || null,
          region:        region        || null,
          is_public:     true,
        }),
      });
      if (!postRes.ok) return _err(500, 'L1_INSERT_ERROR', await postRes.text(), corsHeaders);
    }

    return new Response(JSON.stringify({ ok: true, source: 'l1-pocketbase' }), {
      status: 200, headers: corsHeaders,
    });
  } catch(e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 PocketBase 등록 실패: ' + e.message, corsHeaders);
  }
}

// (2026-07-15: Supabase rpc/search_users → L1 이관. ⚠️ 완전한 대체가
//  아니다 — Supabase 쪽 search_users()는 필시 pg_trgm 유사도 기반
//  퍼지검색(오타 허용, 유사도 순위)이었을 텐데, PocketBase 필터는
//  `~`(부분일치/LIKE 유사) 연산자만 지원하고 트라이그램 유사도 랭킹은
//  없다. 정확히 포함된 문자열만 찾고, 정렬은 최신순으로 대체했다.
//  검색 품질이 눈에 띄게 떨어지면 별도로 클라이언트 측 fuzzy 매칭
//  (예: Fuse.js)을 얹는 걸 검토해야 한다.)
async function handleSearchUsers(request, env, corsHeaders) {
  if (request.method !== 'GET' && request.method !== 'POST') return _err(405, 'METHOD_NOT_ALLOWED', '', corsHeaders);
  const url   = new URL(request.url);
  const q     = url.searchParams.get('q')?.trim();
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 50);
  if (!q) return _err(400, 'QUERY_REQUIRED', 'q 파라미터 필수', corsHeaders);

  const token = await _l1AdminToken(env);
  const qEsc = q.replace(/'/g, "\\'");
  const filter = `(handle ~ '${qEsc}' || nickname ~ '${qEsc}')`;
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/profiles/records?filter=${encodeURIComponent(filter)}&sort=-created&perPage=${limit}`,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  const data = await res.json().catch(() => ({ items: [] }));
  const users = data.items || [];
  return new Response(JSON.stringify({ ok: true, users, count: users.length }),
    { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// v5.0 — /profile (사용자/사업자 프로필 등록·조회)
//   인증: parseToken(Authorization Bearer) → payload.ipv6
//   저장 대상: user_profiles (BaseProfile v2.0 단순화)
//     고정 컬럼: guid, current_ipv6, entity_type, name, handle,
//                native_lang, address, lat, lng, phone, website,
//                is_public, public_key
//     확장: extra.public.{identity, activity, contact, location, finance}
// ═══════════════════════════════════════════════════════════

// GET /profile/{handle}  또는  /profile?guid={ipv6}
// v5.1: 인증 불필요 — 공개 프로필 조회 (PUBLIC 계층만 노출 대상이나,
//       현재는 단순화를 위해 user_profiles 행 전체를 반환한다.
//       PRIVATE/SEMI 분리 마스킹은 추후 별도 작업에서 처리)
//
// ═══════════════════════════════════════════════════════════
// ⚠️ 임시 경로 (필드 테스트용) — 표준 절차가 아님
// ═══════════════════════════════════════════════════════════
// OpenHash 표준 절차는 다음과 같다:
//   1) A가 L1에서 B의 존재를 확인 (guid만 확보, 상세정보는 L1에 없음)
//   2) A가 B 본인(B의 기기/노드)에게 P2P로 직접 프로필 상세를 요청
//   3) B가 동의하여 자신의 프로필을 A에게 직접 전송
//   4) A가 전송받은 데이터로 B의 프로필 페이지를 직접 조합
// 장기적으로는 L1 자체가 상세 프로필 정보까지 저장하게 되며,
// Supabase는 그 이후에도 백업 레이어로만 남는다.
//
// (2026-07-15 삭제 — _resolveGuidFromL1. handleProfileGet의 Supabase
//  레거시 폴백 블록을 지우면서 유일한 호출자가 사라졌다.)

// GET /profile/verify-owner?guid=&pubkey=&signature=&ts= — 핸드셰이크
// 중 "지금 상대가 본인(운영자)인가"를 실시간으로 검증한다. 2026-07-01
// 신설(/profile/my-sp 대체). gopang-wallet.js의 sign()/verify()와
// 동일한 Ed25519 서명 체계 + TOFU 대조 — 전체 시스템이 서명 체계를
// 하나만 공유한다는 원칙(이전 /profile POST·/profile/delegate와도 동일).
// SP를 돌려주지 않는다 — system_prompt는 이제 단 하나뿐이고 이미 클라이언트가
// 갖고 있으므로(GET /profile/@handle), 여기선 verified 불리언만 반환한다.
async function handleProfileVerifyOwner(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid      = url.searchParams.get('guid');
  const pubkey    = url.searchParams.get('pubkey');
  const signature = url.searchParams.get('signature');
  const ts        = url.searchParams.get('ts') || '';
  if (!guid || !pubkey || !signature)
    return _err(400, 'MISSING_FIELD', 'guid, pubkey, signature 필수', corsHeaders);

  // 리플레이 방지 — ts가 5분 이내인지 (다른 서명 엔드포인트들과 동일한 관용 범위)
  const tsNum = parseInt(ts, 10);
  if (!tsNum || Math.abs(Date.now() / 1000 - tsNum) > 300)
    return _err(401, 'STALE_TIMESTAMP', 'ts가 만료되었거나 형식이 올바르지 않습니다', corsHeaders);

  const sigMsg = `VERIFY-OWNER:${guid}:${ts}`;
  const sigOk  = await _verifyEd25519Simple(pubkey, signature, sigMsg);
  if (!sigOk) {
    return new Response(JSON.stringify({ ok: true, verified: false, reason: 'INVALID_SIGNATURE' }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
  }

  // TOFU: 이 guid에 등록된 pubkey와 요청 pubkey가 일치해야 함.
  // L1 PocketBase가 보안 필드(Ed25519 등)의 권위 있는 소스(_l1AdminToken 주석 참조).
  const ownerRecord = await _l1FindProfileByGuid(env, guid).catch(() => null);
  const knownPubkey = ownerRecord?.pubkey_ed25519;
  const verified = !!knownPubkey && knownPubkey === pubkey;

  return new Response(JSON.stringify({ ok: true, verified, reason: verified ? null : 'PUBKEY_MISMATCH' }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function handleProfileGet(request, env, corsHeaders) {
  const url = new URL(request.url);

  const rawHandle = decodeURIComponent(url.pathname.replace('/profile/', '').replace('/profile', ''));
  const guidParam = url.searchParams.get('guid');
  const normHandle = rawHandle ? (rawHandle.startsWith('@') ? rawHandle : '@' + rawHandle) : null;

  // ── 2026-06-30: L1 PocketBase 직접조회를 1차 경로로 — extra(json) 필드를
  //    L1 자체에 추가했으므로(이전엔 guid 확인만 L1, 상세는 Supabase
  //    "임시 경로"였음) 이제 L1 한 번 조회로 끝난다. 다만 L1의 listRule이
  //    `is_public = true`라 비공개 레코드는 Admin 토큰으로 조회해야
  //    한다 — _l1FindProfileByGuid/_l1FindProfileByHandle은 Admin 토큰을
  //    쓰므로 공개·비공개 모두 조회 가능.
  let l1Record = null;
  try {
    l1Record = guidParam
      ? await _l1FindProfileByGuid(env, guidParam)
      : (rawHandle ? await _l1FindProfileByHandle(env, normHandle) : null);
  } catch (e) {
    console.warn('[Profile] L1 조회 실패:', e.message);  // (실제 폴백 로직 없음 — 낡은 메시지 정정, 2026-07-19)
  }

  if (l1Record) {
    const core = l1Record.extra?.core || {};

    // 2026-07-13 신설 — 뷰어 인증. 서명으로 본인 확인이 된 경우에만
    // 원본 전체를, 그 외(익명 방문자·타인)에는 field_visibility로
    // 걸러진 데이터를 돌려준다.
    const isOwnerRequest = await _isAuthenticatedOwnerRequest(env, l1Record.guid, url);
    const filtered = isOwnerRequest
      ? { address: core.address ?? null, phone: core.phone ?? null, website: core.website ?? null, extra: l1Record.extra || {} }
      : _filterProfileByVisibility({
          address: core.address ?? null,
          phone: core.phone ?? null,
          website: core.website ?? null,
          extra: l1Record.extra || {},
        });

    const profile = {
      guid: l1Record.guid,
      current_ipv6: l1Record.guid,
      handle: l1Record.handle,
      entity_type: l1Record.entity_type,
      native_lang: l1Record.native_lang,
      is_public: l1Record.is_public,
      pubkey_ed25519: l1Record.pubkey_ed25519,
      name: core.name ?? null,
      address: filtered.address,
      lat: core.lat ?? null,
      lng: core.lng ?? null,
      phone: filtered.phone,
      website: filtered.website,
      casts_for: core.casts_for ?? null,
      extra: filtered.extra,
      updated_at: l1Record.updated,
      created_at: l1Record.created,
    };
    return new Response(JSON.stringify({
      ok: true, profile,
      identity_source: 'l1', detail_source: 'l1',
      viewer_authenticated: isOwnerRequest,
    }), { status: 200, headers: corsHeaders });
  }

  // (2026-07-15: Supabase 레거시 폴백 삭제 — L1이 이제 유일한 소스.
  //  개발 단계라 "L1로 아직 안 옮겨진 계정" 자체가 없다는 게 확인됨.)
  return _err(404, 'PROFILE_NOT_FOUND', '프로필 없음', corsHeaders);
}

// POST /profile — 본인 프로필 생성/갱신 (upsert)
// v5.1: Ed25519 서명 인증 (/biz/product와 동일 패턴) + TOFU(Trust-On-First-Use)
// body: {
//   guid, pubkey, signature,      // 인증 — _verifyEd25519(pubkey, signature, body)
//   entity_type, name, native_lang, address, lat, lng, phone, website, is_public,
//   handle,                       // 선택 — 미지정 시 자동 생성(@{이름})
//   description, tags,            // S01 identity
//   hours, holidays,              // S03 activity
//   sns_public, languages_spoken, // S04 contact
//   region, directions, parking,  // S05 location
//   gdc_accepted, currencies, price_range, // S07 finance
//   phone_visible,
// }
// ═══════════════════════════════════════════════════════════
// 그림자(에이전트) 자동 생성 — agent_profile_pdv_plan_v2.md Phase 1
// 2026-06-22
//
// ⚠️ 키 생성/암호화 함수는 src/pdv/keyManager.js의 generateAgentKeyPair/
// importKEK/encryptAgentPrivateKey와 동일 로직의 인라인 포팅이다(worker.js는
// import 구문이 없는 단일 파일 — _computeImportanceScore와 같은 이유).
// keyManager.js를 고치면 여기도 같이 고쳐야 한다.
// ═══════════════════════════════════════════════════════════

function _b64ToBuf(b64) { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); }
function _bufToB64(buf)  { return btoa(String.fromCharCode(...new Uint8Array(buf))); }

// ── signer Worker 위임 함수 (Service Binding 경유) ──────────────────────
// 설계 원칙(2026-06-23):
//   - AGENT_KEK는 이 Worker에 존재하지 않음. signer Worker만 보유.
//   - 호출자는 "누가 서명하는지" 알 필요 없음 (탈중앙화 방향 인터페이스).
//   - 향후 "본체 단말 온라인이면 단말 직접 서명"으로 signer 내부만 교체 가능.
//
// env.AGENT_SIGNER: Service Binding 바인딩 이름 (wrangler.json에 선언)
//                  binding이 없으면 graceful 실패(그림자 생성 자체는 계속).
//
// ⚠️ 2026-07-01: 현재 미사용(dead code). 별도 그림자 정체성·키쌍 생성을
// 폐기(_mergeAgentSP로 통합)하면서 호출부가 사라졌다. wrangler.json의
// AGENT_SIGNER 바인딩 자체는 향후 다른 용도(예: 본인 부재 시 자동
// 서명·결제)로 재사용될 수 있어 함수는 남겨둔다.

async function _signerKeypair(env, agentGuid, principalGuid) {
  if (!env.AGENT_SIGNER) {
    console.warn('[Signer] AGENT_SIGNER binding 없음 — 키 생성 건너뜀');
    return { ok: false, error: 'NO_SIGNER_BINDING', public_key_b64: null };
  }
  const res = await env.AGENT_SIGNER.fetch('http://signer/agent/keypair', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_guid:           agentGuid,
      principal_guid:       principalGuid,
    }),
  });
  return res.json().catch(() => ({ ok: false, error: 'SIGNER_PARSE_ERROR' }));
}

async function _signerSign(env, agentGuid, message) {
  if (!env.AGENT_SIGNER) {
    return { ok: false, error: 'NO_SIGNER_BINDING', signature_b64: null };
  }
  const res = await env.AGENT_SIGNER.fetch('http://signer/agent/sign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      agent_guid:           agentGuid,
      message,
    }),
  });
  return res.json().catch(() => ({ ok: false, error: 'SIGNER_PARSE_ERROR' }));
}

/** 본체 guid로부터 결정론적 IPv6 형태 그림자 guid 파생(같은 본체는 항상 같은 그림자 guid) */
async function _deriveAgentGuid(principalGuid) {
  const hash  = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(principalGuid + ':agent'));
  const bytes = new Uint8Array(hash).slice(0, 16);
  const hex   = [...bytes].map(b => b.toString(16).padStart(2, '0'));
  const groups = [];
  for (let i = 0; i < 16; i += 2) groups.push(hex[i] + hex[i + 1]);
  return groups.join(':');
}

// ── Phase 2: 그림자 SP 합성 ──────────────────────────────────────────
// AGENT-COMMON + AGENT-SUPPLIER-{ksic} + 본인 industry_fields 지식을 합성해
// 그림자의 system_prompt를 만든다.
// 설계 원칙:
//   - 합성 실패 시 null 반환(그림자 생성을 막지 않는다)
//   - 향후 industry_fields 변경 시 /profile/sync-sp 엔드포인트로 재합성 가능하게 설계
async function _compileAgentSP(env, principalProfile) {
  const REPO_RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main';
  const headers  = { 'User-Agent': 'gopang-worker/4.9', 'Cache-Control': 'no-cache' };

  // 0) 실시간 공개 범위 판단 안내문 — 2026-06-30 재설계: 가입 시점에
  //    internal/public 두 변형을 미리 컴파일해 따로 저장하던 방식을 폐기.
  //    SP는 이제 단 하나뿐이고, "지금 상대가 본인인지"는 매 대화의
  //    핸드셰이크(AGENT-COMMON §4)에서 실시간으로 검증한다 — 검증 결과는
  //    GET /profile/verify-owner(Ed25519 서명+TOFU, gopang-wallet.js의
  //    sign()/verify()와 동일한 서명 체계)로 받는다.
  const realtimeDisclosurePreamble =
    `[실시간 공개 범위 판단 — 모든 사업체·기관형 그림자 AI 공통]\n` +
    `이 system_prompt는 단 하나뿐이며, 운영자용/고객용으로 미리 나뉘어\n` +
    `있지 않습니다. 상대가 본인(운영자)인지는 대화 시작 시 핸드셰이크\n` +
    `(AGENT-COMMON §4)에서 GET /profile/verify-owner 서명 검증 결과로\n` +
    `실시간 판단합니다.\n` +
    `  - 검증 통과(verified=true) → 원가·마진·거래처 단가 등 내부\n` +
    `    데이터 질문에도 정직하게 답합니다.\n` +
    `  - 검증 미통과/미시도(verified=false 또는 핸드셰이크 생략) →\n` +
    `    외부 고객·제3자로 간주해 영업기밀을 제공하지 않습니다\n` +
    `    (AGENT-SUPPLIER-COMMON §0 고객 보호 원칙 우선).`;

  // 1) AGENT-COMMON 로드 — sp-catalog.json['AGENT-COMMON'] 키로 파일명 결정
  //    (2026-07-09: prompts/manifest.json → prompts/sp-catalog.json 개명, W-16)
  //    CI 빌드 시 자동 갱신 — AGENT-COMMON-LATEST.txt 포인터 파일 방식 제거
  let commonSP = '';
  try {
    const manifestRes = await fetch(`${REPO_RAW}/prompts/sp-catalog.json`, { ...headers, cache: 'no-cache' });
    if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
    const manifest = await manifestRes.json();
    const commonFile = manifest['AGENT-COMMON'];
    if (!commonFile) throw new Error('manifest 에 AGENT-COMMON 키 없음');
    // ALLOW-EMBEDDED-SP: 이 줄 자체는 로그/fetch 코드일 뿐 SP 사본이 아님 —
    // 정적 분석기(tools/check_no_embedded_sp.py)가 파일 반대편의 무관한
    // 백틱과 잘못 짝지어 큰 가짜 리터럴로 오탐하는 경우(2026-07-05 확인).
    const commonRes = await fetch(`${REPO_RAW}/prompts/${commonFile}`, { headers });
    if (!commonRes.ok) throw new Error('AGENT-COMMON 로드 실패: ' + commonRes.status);
    commonSP = await commonRes.text();
    console.info('[Worker] AGENT-COMMON 로드 완료:', commonFile);
  } catch (e) {
    console.warn('[Worker] AGENT-COMMON 로드 오류, 빈 문자열로 계속:', e.message);
  }

  // 2) AGENT-SUPPLIER-COMMON 로드 (업종 SP 공통 모듈 — Type B 정체성·
  //    K-시스템 연계표·강제규칙 등. 77개 업종 파일이 전부 "상속"한다고
  //    표기만 해두고 실제로는 한 번도 합성되지 않던 버그를 2026-06-30 수정.
  //    업종(schema_id)이 없는 사용자(개인 등)는 Type B 정체성 자체가
  //    해당 없으므로 생략 — 2026-07-01: entity_type 분기 대신 ksic
  //    존재 여부로 통일(개인/기관 별도 컴파일 경로를 없앤 재설계와 일관).
  const ksic = principalProfile?.extra?.public?.industry_fields?.schema_id || null;
  let supplierCommonSP = '';
  if (ksic) {
  try {
    const manifestRes = await fetch(`${REPO_RAW}/prompts/sp-catalog.json`, { ...headers, cache: 'no-cache' });
    if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
    const manifest = await manifestRes.json();
    const commonSupplierFile = manifest['AGENT-SUPPLIER-COMMON'];
    if (!commonSupplierFile) throw new Error('manifest 에 AGENT-SUPPLIER-COMMON 키 없음');
    const csRes = await fetch(`${REPO_RAW}/prompts/${commonSupplierFile}`, { headers });
    if (csRes.ok) {
      supplierCommonSP = await csRes.text();
      console.info('[Worker] AGENT-SUPPLIER-COMMON 로드 완료:', commonSupplierFile);
    } else {
      console.warn('[Worker] AGENT-SUPPLIER-COMMON fetch 실패:', csRes.status);
    }
  } catch (e) {
    console.warn('[Worker] AGENT-SUPPLIER-COMMON 로드 오류, 빈 문자열로 계속:', e.message);
  }
  }

  // 3) AGENT-SUPPLIER-{ksic} 로드 (업종 불명이면 생략)
  // 파일명은 빌드 시 자동 생성된 prompts/sp-catalog.json 에서 결정.
  //    (2026-07-09: prompts/manifest.json → prompts/sp-catalog.json 개명, W-16)
  // SUPPLIER_FILE_MAP 하드코딩 제거 — manifest 갱신만으로 새 버전 자동 반영.
  let supplierSP = '';
  if (ksic && VALID_INDUSTRY_SCHEMA_IDS.has(String(ksic))) {
    try {
      const manifestRes = await fetch(`${REPO_RAW}/prompts/sp-catalog.json`, { ...headers, cache: 'no-cache' });
      if (!manifestRes.ok) throw new Error('manifest fetch 실패: ' + manifestRes.status);
      const manifest = await manifestRes.json();
      const ksicCode = String(ksic).padStart(2, '0');
      const fname = manifest[`AGENT-SUPPLIER-${ksicCode}`];
      if (fname) {
        const supRes = await fetch(`${REPO_RAW}/prompts/${fname}`, { headers });
        supplierSP = supRes.ok ? await supRes.text() : '';
        if (supRes.ok) console.info('[Worker] AGENT-SUPPLIER 로드 완료:', fname);
        else console.warn('[Worker] AGENT-SUPPLIER fetch 실패:', supRes.status, fname);
      } else {
        console.warn('[Worker] manifest 에 KSIC 없음 (supplierSP 생략):', ksicCode);
      }
    } catch (e) {
      console.warn('[Worker] AGENT-SUPPLIER 로드 오류, 빈 문자열로 계속:', e.message);
    }
  }

  // 4) industry_fields 지식 블록(본인 등록 데이터를 AI가 참조할 수 있게)
  const iFields = principalProfile?.extra?.public?.industry_fields;
  const iFieldsBlock = iFields
    ? `

## 나의 업종 정보 (industry_fields)
\`\`\`json
${JSON.stringify(iFields, null, 2)}
\`\`\``
    : '';

  // 5) 합성 — 청중 안내문 → AGENT-COMMON → AGENT-SUPPLIER-COMMON → AGENT-SUPPLIER-{ksic} → industry_fields
  // 5) 합성 — 실시간 공개범위 안내문(업종 SP가 있을 때만, 즉 사업체·기관
  //    한정) → AGENT-COMMON → AGENT-SUPPLIER-COMMON → AGENT-SUPPLIER-{ksic}
  //    → industry_fields. 개인은 안내문 없이 AGENT-COMMON만(영업기밀 같은
  //    공개범위 구분 자체가 해당 없음).
  const universalIntegrity = await _fetchUniversalIntegrity();
  const parts = [universalIntegrity, ksic ? realtimeDisclosurePreamble : '', commonSP, supplierCommonSP, supplierSP, iFieldsBlock].filter(Boolean);
  if (!parts.length) return null;

  const compiled = parts.join('\n\n---\n\n').trim();
  return compiled.length > 100 ? compiled : null;
}

/**
 * 본인(기관형: business/org/institution/platform) 신규가입 직후
 * 그림자(_ai) 자동 생성. 2026-06-30: 개인은 이 함수를 타지 않는다
 * (INDIVIDUAL_ENTITY_TYPES는 handleProfilePost에서 별도 분기로
 * 본인 행에 직접 SP를 기록 — _mergeIndividualSP 참조).
 * 실패해도 본 가입 자체를 막지 않음(호출부에서 .catch로 흡수) — 그림자는
 * 나중에 재시도로도 만들 수 있지만 본인 가입 실패는 되돌릴 수 없는 손해라서.
 */
/**
 * 2026-07-01 전면 재설계: 개인/기관 구분 없이 단일 정체성으로 통합.
 * "나만의 AI비서 = 그림자"이며, 별도 행·별도 guid·별도 키쌍을 만들지
 * 않는다 — 본인 user_profiles 행에 단일 system_prompt를 직접 기록한다.
 * 운영자/고객 공개범위 구분은 사전 컴파일(internal/public 두 변형)이
 * 아니라, 대화 시작 시 [핸드셰이크 절차](AGENT-COMMON §4)에서
 * GET /profile/verify-owner로 실시간 판단한다(_compileAgentSP의
 * realtimeDisclosurePreamble 참조).
 * 이전엔 _createAgentForPrincipal(기관 전용 별도 그림자 행+키쌍 생성)과
 * _mergeIndividualSP(개인 전용 통합 기록)로 나뉘어 있었으나, 이 함수
 * 하나로 합쳤다 — 기관도 더 이상 별도 행을 만들지 않는다.
 */
async function _mergeAgentSP(env, principalProfile) {
  const compiled = await _compileAgentSP(env, principalProfile).catch(() => null);
  if (!compiled) return { ok: false, error: 'COMPILE_FAILED' };

  const newExtra = {
    ...(principalProfile.extra || {}),
    public: {
      ...((principalProfile.extra || {}).public || {}),
      ai_assistant: { system_prompt: compiled, greeting: null },
    },
  };

  // (2026-07-15: Supabase 이중쓰기 제거 — L1이 이미 1차 소스로 저장을
  //  끝냈으므로 더 이상 Supabase에 따로 쓸 이유가 없다.)
  try {
    await _l1UpsertProfile(env, {
      guid: principalProfile.guid, handle: principalProfile.handle,
      entityType: principalProfile.entity_type, nativeLang: principalProfile.native_lang,
      isPublic: principalProfile.is_public, pubkey: principalProfile.pubkey_ed25519,
      extra: newExtra,
    });
  } catch (e) {
    console.warn('[Profile] L1 통합 SP 저장 실패:', e.message);
    return { ok: false, error: 'L1_SAVE_FAILED', detail: e.message };
  }
  return { ok: true, merged: true, guid: principalProfile.guid, sp_updated: true };
}

// ═══════════════════════════════════════════════════════════
// 2026-07-12 신설 — SP-18_ksearch STEP3(미청구 프로필) 구현
// ═══════════════════════════════════════════════════════════
//
// 설계를 원안(SP-18 STEP3 절차안)에서 단순화한 지점 한 가지를 밝혀둔다:
// 원안은 [CALL_PROFILE_ASSISTANT: mode=third_party_draft]로 profile-
// assistant SP를 거치는 대화형 경로였다. 이 구현은 그 대신 K-Search가
// STEP1~2(웹검색 수집 + 이용자 확인)를 마친 뒤 이 엔드포인트를 한 번에
// 직접 호출하는 단일 요청형으로 단순화했다 — profile-assistant는 "본인
// 온보딩"(멀티턴 질문)을 위해 설계된 SP라 "이미 확인된 필드를 그대로
// 저장"하는 이 케이스에는 대화 단계 자체가 불필요하다. call-ai.js의
// _handleCreateUnclaimedProfileTag가 이 엔드포인트를 호출한다.
const UNCLAIMED_ALLOWED_ENTITY_TYPES = new Set(['business', 'org', 'institution', 'platform']);

async function _handleUnclaimedProfilePost(body, env, corsHeaders) {
  const {
    entity_type, name, native_lang = 'ko',
    address = '', lat = null, lng = null,
    phone = null, website = '',
    description = '', tags = [],
    occupation = null,
    claim_source = 'ai_web_search',
  } = body;

  if (!entity_type) return _err(400, 'MISSING_FIELD', 'entity_type 필수', corsHeaders);
  if (!name)        return _err(400, 'MISSING_FIELD', 'name 필수', corsHeaders);
  if (!UNCLAIMED_ALLOWED_ENTITY_TYPES.has(entity_type)) {
    // person/individual/consumer 배제 — 제3자가 서명 없이 "실존 인물"
    // 프로필을 만드는 사칭 경로가 되는 걸 원천 차단(RULE-01 금지-4와
    // 동일한 취지 — SP-18 자신도 STEP1에서 person 대상은 이 STEP으로
    // 오면 안 된다고 전제).
    return _err(400, 'INVALID_FIELD',
      `unclaimed 프로필은 사업체 성격 entity_type만 허용됩니다(허용: ${[...UNCLAIMED_ALLOWED_ENTITY_TYPES].join(',')})`,
      corsHeaders);
  }

  // guid 서버 발급 — 본인이 서명한 게 아니므로 클라이언트가 보낸 guid를
  // 신뢰하지 않는다(기존 정식 가입 경로의 pubkey:guid 바인딩과 동일한
  // TOFU 원칙 — 여기선 "아직 아무도 이 guid를 소유하지 않는다"가 불변식).
  const guid = 'unclaimed_' + crypto.randomUUID();
  const finalHandle = '@' + String(name).trim().toLowerCase()
    .replace(/\s+/g, '_').replace(/[^a-z0-9가-힣_]/g, '') + '_unclaimed_' + guid.slice(-6);

  const resolvedOccupation = occupation
    || (body.industry_fields?.schema_id ? (KSIC_LABELS[String(body.industry_fields.schema_id)] || null) : null);

  const newExtra = {
    claim_status: 'unclaimed',
    claim_source,
    claimed_at: null,
    public: {
      identity: { _schema_version: '2.0', display_name: name, description, tags, entity_subtype: body.entity_subtype || null },
      // phone_visible을 무조건 false로 강제 — 본인 동의 없는 번호 노출 방지.
      // phone_display는 claim 이후 소유자가 원하면 켤 수 있도록 값 자체는 보존.
      contact:  { phone_display: phone, phone_visible: false, website, sns_public: {}, languages_spoken: [] },
      location: { region: '', address_short: address, directions: '', parking: false },
      finance:  { gdc_accepted: false, currencies: ['KRW'], price_range: '' },
      industry_fields: body.industry_fields ?? null,
    },
  };

  try {
    await _l1UpsertProfile(env, {
      guid, handle: finalHandle, entityType: entity_type, nativeLang: native_lang,
      isPublic: true, pubkey: null, extra: newExtra,
      core: { name, address, lat, lng, phone, website, occupation: resolvedOccupation },
      claimStatus: 'unclaimed',
    });
  } catch (e) {
    console.warn('[Profile/Unclaimed] L1 저장 실패:', e.message);
    return _err(502, 'L1_SAVE_FAILED', '미청구 프로필 저장 실패: ' + e.message, corsHeaders);
  }

  // ★ 정식 가입과 달리 _mergeAgentSP(그림자 AI SP 합성)는 호출하지 않는다
  // — 이 프로필엔 아직 서명 소유자가 없어 "본인의 AI 비서"라는 전제가
  // 성립하지 않는다. claim 완료 후 handleProfileClaim에서 수행한다.

  return new Response(JSON.stringify({
    ok: true,
    guid,
    handle: finalHandle,
    claim_status: 'unclaimed',
    confidence: 'provisional',
  }), { status: 201, headers: corsHeaders });
}

// SP-18 STEP3 선행조건 (c) — 미청구 프로필을 실제 소유자가 정식 전환.
// 두 가지 증명 경로를 지원한다:
//  (a) Ed25519 서명(기존) — 이미 지갑이 있는 소유자. 서명 대상 문자열은
//      일반 가입(guid:pubkey:ts)과 겹치지 않게 접두어를 둬 재생공격을 막는다.
//  (b) 전화번호 인증(2026-07-15 신설) — 지갑이 없는 소유자(주로 unclaimed
//      상태로 등록된 소규모 사업자). CROSS-ACTOR-SCENARIOS-100 A축 사고실험
//      발견 대응 — unclaimed 프로필은 claim 전까지 소유자가 없어(pubkey_
//      ed25519: null) 대화 상대(AC) 자체가 없다는 문제였다. solapi 전화번호
//      인증(/biz/phone-otp-verify가 발급하는 phone_verify_token)으로 소유자가
//      "이 전화번호를 실제로 통제한다"는 걸 증명하면, 그 번호가 프로필에
//      이미 등록된 phone과 일치할 때 claim을 허용한다. pubkey는 이 경우
//      "새로 만든 지갑의 공개키를 최초로 핀(pin)한다"는 의미이지 그 키로
//      서명했다는 증명은 아니다 — 증명의 근거가 서명이 아니라 전화번호로
//      바뀌는 것뿐이다.
async function handleProfileClaim(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, pubkey, signature, ts = '', phone_verify_token } = body;
  if (!guid)   return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey) return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);

  const existing = await _l1FindProfileByGuid(env, guid).catch(() => null);
  const claimStatus = existing?.claim_status ?? existing?.extra?.claim_status;
  if (!existing || claimStatus !== 'unclaimed') {
    return _err(404, 'NOT_CLAIMABLE', '미청구 상태의 프로필이 아니거나 존재하지 않습니다', corsHeaders);
  }

  let claimMethod;
  if (phone_verify_token) {
    if (!env.PHONE_VERIFY_SECRET) return _err(500, 'SECRET_NOT_SET', 'PHONE_VERIFY_SECRET이 설정되지 않았습니다', corsHeaders);
    const dotIdx = String(phone_verify_token).lastIndexOf('.');
    if (dotIdx < 0) return _err(400, 'TOKEN_MALFORMED', 'phone_verify_token 형식 오류', corsHeaders);
    const payload = phone_verify_token.slice(0, dotIdx);
    const sig     = phone_verify_token.slice(dotIdx + 1);
    // 2026-07-18 버그 수정: 예전엔 여기서 atob(payload)를 호출했는데,
    // 발급부(handlePhoneOtpVerify)는 2026-07-15(caf72c1)에 btoa()를
    // 이미 제거해서 payload가 원문 그대로 서명 대상이 됐다(pb_hooks의
    // onRecordBeforeCreateRequest 훅은 그때 같이 고쳐졌으나 이 함수만
    // 누락됨). payload는 '+8201012345678:...' 형태라 ':' 문자가 base64
    // 알파벳에 없어 atob()가 매번 예외를 던졌다 — 즉 2026-07-15 이후
    // phone_verify_token으로 claim을 시도한 모든 요청이 항상
    // TOKEN_MALFORMED로 거부되던 실제 프로덕션 버그. 원문 그대로 사용.
    const firstColon = payload.indexOf(':');
    const lastColon  = payload.lastIndexOf(':');
    if (firstColon < 0 || lastColon < firstColon) return _err(400, 'TOKEN_MALFORMED', 'phone_verify_token 페이로드 오류', corsHeaders);
    const e164      = payload.slice(0, firstColon);
    // guid 없는(2-필드, 등록 전용) 토큰이면 firstColon === lastColon
    const tokenGuid = firstColon === lastColon ? null : payload.slice(firstColon + 1, lastColon);
    const exp       = Number(payload.slice(lastColon + 1));
    if (!e164 || !Number.isFinite(exp)) return _err(400, 'TOKEN_MALFORMED', 'phone_verify_token 페이로드 오류', corsHeaders);

    // 2026-07-18 신설 — 토큰을 claim 대상 guid에 바인딩 강제. 이게 없으면
    // 동일 전화번호로 등록된 서로 다른 unclaimed 프로필에 같은 토큰을
    // 재사용해 전부 claim할 수 있었다(실측으로 발견, phase25 I3-2 참고).
    if (!tokenGuid) {
      return _err(400, 'TOKEN_NOT_BOUND', '이 인증 토큰은 claim 전용으로 발급되지 않았습니다(guid 미포함) — /biz/phone-otp-verify 요청 시 guid를 함께 보내주세요', corsHeaders);
    }
    if (tokenGuid !== guid) {
      return _err(403, 'TOKEN_GUID_MISMATCH', '이 인증 토큰은 다른 프로필용으로 발급됐습니다', corsHeaders);
    }

    if (Date.now() > exp) return _err(401, 'TOKEN_EXPIRED', '전화번호 인증 토큰이 만료됐습니다', corsHeaders);
    const expectedSig = await _hmacSha256Hex(env.PHONE_VERIFY_SECRET, payload);
    if (expectedSig !== sig) return _err(401, 'TOKEN_INVALID', '전화번호 인증 토큰 서명이 유효하지 않습니다', corsHeaders);

    // e164는 handlePhoneOtpRequest와 동일 관례로 '+82'가 이미 국내 0으로
    // 시작하는 나머지 숫자 앞에 붙은 형태다(_sendSolapiSms의 치환과 동일).
    const domesticPhone       = e164.replace(/^\+82/, '');
    const existingPhoneDigits = String(existing.phone || '').replace(/\D/g, '');
    const tokenPhoneDigits    = domesticPhone.replace(/\D/g, '');
    if (!existingPhoneDigits || existingPhoneDigits !== tokenPhoneDigits) {
      return _err(403, 'PHONE_MISMATCH', '인증된 전화번호가 이 프로필에 등록된 번호와 일치하지 않습니다', corsHeaders);
    }
    claimMethod = 'phone_verify';
  } else {
    if (!signature) return _err(400, 'MISSING_FIELD', 'signature 또는 phone_verify_token 중 하나가 필요합니다', corsHeaders);
    const sigMsg = `claim:${guid}:${pubkey}:${ts}`;
    const sigOk  = await _verifyEd25519Simple(pubkey, signature, sigMsg);
    if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);
    claimMethod = 'ed25519_signature';
  }

  const newExtra = { ...(existing.extra || {}), claim_status: 'claimed', claimed_at: new Date().toISOString(), claim_method: claimMethod };

  try {
    await _l1UpsertProfile(env, {
      guid, handle: existing.handle, entityType: existing.entity_type, nativeLang: existing.native_lang,
      isPublic: existing.is_public, pubkey, extra: newExtra, claimStatus: 'claimed',
    });
  } catch (e) {
    return _err(502, 'L1_ERROR', 'L1 claim 반영 실패: ' + e.message, corsHeaders);
  }

  // (2026-07-15: Supabase 이중쓰기 제거 — L1이 이미 1차 소스로 저장을
  //  끝냈다. _mergeAgentSP에 넘길 principalProfile은 L1에서 조회했던
  //  existing에 이번에 바뀐 필드(pubkey/claim_status/extra)만 얹어
  //  구성한다 — Supabase 응답에 의존할 필요가 없다.)
  const savedProfile = { ...existing, pubkey_ed25519: pubkey, claim_status: 'claimed', extra: newExtra };

  // 정식 소유자가 생겼으니 이제 그림자 AI SP를 합성한다(일반 가입과 동일 처리).
  const agentResult = await _mergeAgentSP(env, savedProfile).catch(e => {
    console.error('[Profile/Claim] 통합 SP 기록 실패(claim 자체는 정상 처리됨):', e.message);
    return { ok: false, error: 'EXCEPTION', detail: e.message };
  });

  return new Response(JSON.stringify({ ok: true, guid, claim_status: 'claimed', claim_method: claimMethod, agent: agentResult }), { status: 200, headers: corsHeaders });
}

async function handleProfilePost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  // 서명 대상: 'guid:pubkey:ts' 고정 문자열 — JSON 직렬화 불일치 원천 차단
  const ts     = body.ts || '';
  const sigMsg = `${guid}:${pubkey}:${ts}`;
  const sigOk  = await _verifyEd25519Simple(pubkey, signature, sigMsg);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  // 2026-07-13: is_public을 const에서 let으로(Tier3 규제산업 감지 시
  // 서버가 강제로 false 재할당해야 함) + 기본값을 true→false로 변경.
  // 이유: profile-assistant STEP4가 항상 명시적으로 값을 보내므로 정상
  // 경로엔 영향이 없고, 이건 어디까지나 값이 누락되는 예외 상황(모델
  // 실수·전송 유실 등)을 위한 안전망이다 — 그런 실패는 "공개"가 아니라
  // "비공개" 쪽으로 떨어지는 게 안전하다(기존엔 반대였음, 실사로 발견).
  let {
    entity_type, name, native_lang = 'ko',
    address = '', lat = null, lng = null,
    phone = null, website = '', is_public = false,
    handle = null,
    description = '', tags = [],
    hours = [], holidays = [],
    sns_public = {}, languages_spoken = [],
    region = '', directions = '', parking = false,
    gdc_accepted = false, currencies = ['KRW'], price_range = '',
    payout_account = null,  // 2026-07-15 신설 — { bank_name, account_number, holder_name }
    phone_visible = false,
    // 2026-07-13 신설 — AC-AUTHOR_v1_0.md §3(job_ksco 스키마). KSIC 기반
    // occupation(사업자 업종, 검색용)과 절대 혼용하지 않는다 — 이건 개인
    // (entity_type='person')의 KSCO 직업 정보이며 검색 인덱스 대상이
    // 아니다. 라벨 검증(코드→명칭 매핑 대조)은 클라이언트(브라우저,
    // data/ksco_2024_v8.json)의 몫이고, 서버는 형식만 검증한다 — 아래
    // job_ksco != null 처리부 참조.
    job_ksco = null,
    // 2026-07-13 신설 — AC-EVOLUTION_v1_1.md §2(소속·업무 도메인). 배열인
    // 이유는 겸직 가능성(AC-EVOLUTION-GAPS #5) 때문. verified는 클라이언트가
    // 뭐라고 보내든 서버가 절대 그대로 믿지 않는다 — 항상 false로
    // 강제하고, 실제 검증(true 전환)은 별도 관리자 승인 경로
    // (POST /affiliation/approve, authoritativeAgency 세션 필요)로만
    // 가능하다. 자기 신고만으로 권한이 생기면 안 된다는 게 AC-EVOLUTION
    // §3의 핵심 결론이었다.
    affiliation = null,
    // 2026-07-14 신설 — AC-EVOLUTION_v1_1.md §1(업무 도메인, 전 직종
    // 일반화). job_ksco(KSCO)만으로는 학생·은퇴자·전업주부·무직을
    // 표현할 수 없다(KSCO 자체가 "경제활동"만 분류하도록 설계됨) —
    // 이 필드가 그 상위 개념이다(AC_SELF_EVOLUTION_THOUGHT_EXPERIMENT_
    // v2_0.md 구멍 D 해결). job_ksco와 독립적으로 병존 — 학생은
    // work_domain.status='student'만 있고 job_ksco는 없다. (이 필드가
    // a20461b에서 한 차례 회귀했다가 복구됨 — 세 번째 회귀 사례.)
    work_domain = null,
    // 2026-07-13 신설 — products_structured가 여태 이 함수 destructure에
    // 없어 저장 경로 자체가 없었다(실사로 발견 — welcome.js
    // _forwardProductsToMarket()이 Market의 seller_products로는 보냈지만,
    // 프로필 레코드 자신에는 한 번도 저장된 적이 없다. profile.html의
    // "판매 상품" 카드는 처음부터 p.products/pub.products 배열을
    // 기대하고 있었는데 그 값이 항상 undefined라 카드 자체가 한 번도
    // 렌더링된 적이 없었을 가능성이 높다). 여기서 profile 레코드에도
    // 함께 저장해 profile.html이 실제로 읽을 수 있게 한다.
    products_structured = [],
    // 2026-07-13 신설 — 필드별 공개/비공개 토글. 기존 phone_visible
    // 패턴(단일 필드 전용)을 일반화한 것. 명시 안 하면 필드별 기본값을
    // 따른다(DEFAULT_PUBLIC_FIELDS 참조 — products만 기본 공개, 나머지는
    // 기본 비공개).
    field_visibility = {},
    // 2026-07-05: search_entities RPC의 p_occupation, /pdv/page 표시 페이지의
    // p.occupation이 참조하는 컬럼이지만, 지금까지 이 함수의 destructuring
    // 목록에 없어 저장 경로 자체가 없었다(실사로 발견 — 상시 null이었음).
    // 명시적으로 보내면 그 값을 쓰되, 안 보내면 아래에서 industry_fields.schema_id
    // (KSIC)로부터 자동 파생한다 — 손으로 두 번 입력하게 하지 않는다.
    occupation = null,
  } = body;

  if (!entity_type) return _err(400, 'MISSING_FIELD', 'entity_type 필수', corsHeaders);
  if (!name)        return _err(400, 'MISSING_FIELD', 'name 필수', corsHeaders);
  // 2026-06-22: 'agent'(그림자)는 이 화이트리스트에 의도적으로 없다 — 보안 경계.
  // 2026-07-01: 별도 그림자 행 생성 자체를 폐기했으므로(_mergeAgentSP가
  // 본인 행에 직접 SP를 기록) 이제 'agent' entity_type은 어떤 경로로도
  // 만들어지지 않는다. 그래도 화이트리스트엔 영구히 넣지 않는다 — 클라이언트가
  // entity_type:'agent'를 직접 보내 사칭 행을 만들 길을 원천 차단하기 위함.
  if (!['person','consumer','individual','org','institution','business','platform'].includes(entity_type)) {
    return _err(400, 'INVALID_FIELD', 'entity_type 값이 올바르지 않습니다', corsHeaders);
  }

  // 2026-06-22: industry_fields.schema_id 검증 — AI(SP)가 지침을 어기고 "{ksic}" 같은
  // 미치환 리터럴이나 정의되지 않은 코드를 보내도 그대로 저장되지 않게 막는다.
  // null/undefined(=미해당)는 항상 허용 — GENERIC 경로의 정상 동작.
  if (body.industry_fields != null) {
    const sid = body.industry_fields.schema_id;
    if (!sid || !VALID_INDUSTRY_SCHEMA_IDS.has(String(sid))) {
      return _err(400, 'INVALID_SCHEMA_ID',
        `industry_fields.schema_id가 유효하지 않습니다: ${JSON.stringify(sid)} (허용: ${[...VALID_INDUSTRY_SCHEMA_IDS].join(',')})`,
        corsHeaders);
    }

    // 2026-07-13 신설 — Tier 3(규제산업) 서버 강제. docs/
    // ksic_schema_tier_classification_v1.md가 "사람 검토 전까지 보류
    // (status: under_review)"라고 명시했지만, VALID_INDUSTRY_SCHEMA_IDS가
    // 2026-06-30에 77개 코드를 한꺼번에 열면서 이 구분이 서버에 전혀
    // 반영 안 되고 있었다(실사로 발견 — 담배 제조업 등도 검토 없이
    // 그냥 통과). 통째로 막지는 않되(정상 사업자 유입 자체를 막으면
    // 안 되므로), 검토 전까지 검색·공개 노출만 차단한다.
    if (TIER3_REGULATED_SCHEMA_IDS.has(String(sid))) {
      is_public = false; // 클라이언트가 뭘 보냈든 강제 — 검토 전 노출 차단
      body.industry_fields = { ...body.industry_fields, status: 'under_review' };
      console.info('[Profile] Tier3 규제산업 감지 — is_public 강제 false, status=under_review:', sid);
    }
  }

  // 2026-07-05: occupation 자동 파생(3중 분류 통합) — 클라이언트가 occupation을
  // 명시적으로 안 보내면 industry_fields.schema_id(KSIC)에서 KSIC_LABELS로
  // 라벨을 끌어와 채운다. 둘 다 없으면 null(예: person/institution 등
  // 업종 개념이 없는 entity_type) — search_entities의 p_occupation 필터는
  // 그런 경우 애초에 매칭 대상이 아니므로 문제 없다.
  const resolvedOccupation = occupation
    || (body.industry_fields?.schema_id ? (KSIC_LABELS[String(body.industry_fields.schema_id)] || null) : null);

  // 기존 프로필 존재 여부 확인 — L1 PocketBase가 유일한 소스.
  // (2026-07-15: Supabase 레거시 폴백 삭제 — 개발 단계라 "L1로 아직 안
  //  옮겨진 계정" 자체가 없다는 게 확인됨. L1에 없으면 그냥 신규 가입.)
  // TOFU: pubkey 일치 확인은 어느 소스에서 찾았든 동일하게 적용.
  let existing = null;
  try {
    const l1Existing = await _l1FindProfileByGuid(env, guid);
    if (l1Existing) {
      existing = {
        guid: l1Existing.guid,
        handle: l1Existing.handle,
        extra: l1Existing.extra || {},
        pubkey_ed25519: l1Existing.pubkey_ed25519,
        _l1id: l1Existing.id,
      };
    }
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }

  // v6.0: TOFU 복원. "guid는 전화번호 기반이라 안전하다"는 이전 가정은 틀렸다 —
  // 로그인 시점에 전화번호/닉네임만으로 기존 계정에 접근 가능했던 별도 결함이
  // 있었으므로(현재 patch에서 함께 수정), guid 자체는 더 이상 "본인 증명"이 아니다.
  // 최초 등록 시 핀(pin)된 pubkey와 다른 키로는 같은 guid의 프로필을 덮어쓸 수 없다.
  if (existing?.pubkey_ed25519 && existing.pubkey_ed25519 !== pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 이 계정에 등록된 키와 일치하지 않습니다', corsHeaders);
  }

  // handle 자동 생성 (미지정 + 신규일 때)
  let finalHandle = handle || existing?.handle || null;
  if (!finalHandle) {
    const slug = String(name).trim().toLowerCase()
      .replace(/\s+/g, '_')
      .replace(/[^a-z0-9가-힣_]/g, '');
    finalHandle = `@${slug}`;
  }

  // extra.public 병합 (기존 extra 보존, public 섹션만 갱신)
  const prevExtra = existing?.extra || {};

  // 2026-07-13 신설 — 필드별 공개/비공개 기본값. 명시 안 된 필드는
  // products만 기본 공개(디폴트 발견성), 나머지는 기본 비공개(안전
  // 우선 — is_public 기본값을 false로 바꾼 것과 동일한 원칙).
  const DEFAULT_PUBLIC_FIELDS = new Set(['products']);
  const VISIBILITY_FIELDS = ['address', 'phone', 'website', 'description', 'products', 'hours'];
  const resolvedFieldVisibility = {};
  for (const f of VISIBILITY_FIELDS) {
    resolvedFieldVisibility[f] = (typeof field_visibility[f] === 'boolean')
      ? field_visibility[f]
      : DEFAULT_PUBLIC_FIELDS.has(f);
  }

  // 2026-07-13 신설 — job_ksco 형식 검증(AC-AUTHOR_v1_0.md §3-1/§6).
  // 서버는 코드 형식과 허용 필드만 검증한다 — 1,999개 KSCO 코드→명칭
  // 전체를 worker.js에 인라인하지 않는다(이미 540K가 넘는 파일, KSIC_LABELS
  // 77개와 규모가 다르다). label의 사실 여부는 클라이언트가
  // data/ksco_2024_v8.json으로 조회해 채운 값을 신뢰하고 서버는 재검증하지
  // 않는다 — U2(불확실 식별자 지어내지 않기) 준수는 "LLM이 label을 직접
  // 짓지 않는다"는 클라이언트 측 규칙(personal-assistant SP)으로 담보한다.
  // 2026-07-14 수정(사고실험 구멍 B 해결, a20461b에서 회귀했다가 복구) —
  // 이전엔 entity_type==='person'일 때만 처리했는데, 이건 AC-AUTHOR
  // §3-2("한 사람이 사업자이면서 동시에 직업 정체성을 가질 수 있다 —
  // 카페 사장이자 바리스타, job_ksco와 occupation(KSIC)이 독립적으로
  // 병존")를 실제로 막고 있던 구현 결함이었다. business도 job_ksco를
  // 가질 수 있게 게이트를 넓힌다 — occupation(KSIC, industry_fields.
  // schema_id)과는 완전히 별개 필드이므로 서로 자동 파생하거나
  // 덮어쓰지 않는다.
  const KSCO_CODE_RE = /^[0-9A][0-9]{0,4}$/;
  const KSCO_VISIBILITY = new Set(['private', 'contacts', 'public']);
  // 2026-07-17 신설 — KSCO Tier3(자격규제·민감직종) 게이트.
  // docs/ksco_schema_tier_classification_v1.md v1.1 재분류 결과.
  // industry_fields.schema_id의 TIER3_REGULATED_SCHEMA_IDS와 동일 원칙 —
  // 자기신고(visibility)로 이 목록의 직종을 공개로 노출할 수 없게 강제한다.
  // KSCO 코드는 자릿수가 곧 계층(1자리=대분류...5자리=세세분류)이라 문자열
  // startsWith로 상위 코드를 매칭하면 그 하위 전체가 자동으로 걸린다.
  const TIER3_REGULATED_KSCO_PREFIXES = [
    '2411', '2412', '2413', '2414', // 의사(전문/일반)·한의사·치과의사
    '242',                          // 수의사
    '2431', '2432',                 // 약사·한약사
    '2711',                         // 판사·검사
  ];
  let resolvedJobKsco = null;
  if ((entity_type === 'person' || entity_type === 'business') && job_ksco && typeof job_ksco === 'object') {
    const code = job_ksco.code != null ? String(job_ksco.code) : null;
    if (code === null || KSCO_CODE_RE.test(code)) {
      const isRegulatedKsco = !!code && TIER3_REGULATED_KSCO_PREFIXES.some(p => code.startsWith(p));
      resolvedJobKsco = {
        code,
        label: (typeof job_ksco.label === 'string' && job_ksco.label.trim()) ? job_ksco.label.trim().slice(0, 100) : null,
        level: code ? code.length : null,
        source: ['self_reported', 'pdv_inferred', 'unconfirmed'].includes(job_ksco.source) ? job_ksco.source : 'unconfirmed',
        // 기본값 private — AC-AUTHOR §6(민감 직종 접근통제), is_public 기본 false와 동일 원칙.
        // 규제 직종이면 클라이언트가 무엇을 보내든 무조건 private로 강제한다
        // (industry_fields.schema_id의 TIER3_REGULATED_SCHEMA_IDS가 is_public을
        // 강제하는 것과 동일한 원칙 — 자기신고만으로 공개 노출 불가).
        visibility: isRegulatedKsco ? 'private' : (KSCO_VISIBILITY.has(job_ksco.visibility) ? job_ksco.visibility : 'private'),
        confirmed_at: job_ksco.confirmed_at || new Date().toISOString().slice(0, 10),
        review_due: isRegulatedKsco
          ? (job_ksco.review_due || new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10))
          : (job_ksco.review_due || null),
      };
      if (isRegulatedKsco) {
        console.info('[Profile] KSCO Tier3 규제직종 감지 — visibility 강제 private:', code);
      }
    }
    // 코드 형식이 어긋나면 조용히 무시(저장 자체를 막지 않음) — 프로필
    // 등록 실패의 사유가 되기엔 너무 지엽적인 필드(§0 U0: 실패보다 진행).
  }

  // 2026-07-13 신설 — affiliation 검증(AC-EVOLUTION_v1_1.md §3).
  // DEPT_TASK_TAXONOMY(dept-task-handler.js)를 재사용해 org_id 형식이라도
  // 걸러낸다 — 완전히 임의의 문자열을 소속으로 자칭하는 것만은 막는다
  // (그 자체가 verified를 true로 만들진 않는다, 아래 참조).
  let resolvedAffiliation = null;
  if (entity_type === 'person' && Array.isArray(affiliation)) {
    const prevAffList = (prevExtra.public || {}).identity?.affiliation || [];
    resolvedAffiliation = affiliation.slice(0, 5).map(a => { // 겸직 상한 5(과도한 배열 남용 방지, 임의값)
      const orgId = typeof a?.org_id === 'string' ? a.org_id.trim().slice(0, 100) : null;
      const prevMatch = prevAffList.find(p => p.org_id === orgId);
      const userWantsInactive = a?.active === false;
      return {
        org_type:  typeof a?.org_type === 'string' ? a.org_type.slice(0, 30) : null,
        org_id:    orgId,
        role:      ['staff', 'manager'].includes(a?.role) ? a.role : 'staff',
        active:    !userWantsInactive, // 은퇴·퇴직 시 클라이언트가 false로 명시
        // ★ 핵심: verified는 이전 값을 그대로 이어받을 뿐, 이번 요청의
        // affiliation 배열에 담긴 verified 값(사용자가 뭘 보내든)은
        // 절대 참조하지 않는다 — 자기 신고로는 권한이 생기지 않는다.
        // AC-EVOLUTION-GAPS #4 완결 — 단, 사용자 본인이 active:false를
        // 명시(자진 철회 — 예: "저 퇴사했어요")하면 verified도 함께
        // false로 내린다. 이건 "자기 신고로 권한을 얻는" 게 아니라
        // "자기 신고로 권한을 내려놓는" 것이라 원칙과 배치되지 않는다
        // (권한 획득은 항상 기관 승인만, 권한 포기는 본인이 즉시 가능
        // — 대칭이 아니라 의도된 비대칭이다).
        verified:      userWantsInactive ? false : (prevMatch?.verified || false),
        verified_at:   prevMatch?.verified_at || null,
        verified_evidence: prevMatch?.verified_evidence || null,
        review_due:    userWantsInactive ? null : (prevMatch?.review_due || null),
        revoked_at:    userWantsInactive ? new Date().toISOString() : (prevMatch?.revoked_at || null),
        revoked_by:    userWantsInactive ? 'self' : (prevMatch?.revoked_by || null),
      };
    }).filter(a => a.org_id);
  }

  // 2026-07-14 신설 — work_domain 검증(AC-EVOLUTION_v1_1.md §1, 구멍 D,
  // a20461b에서 회귀했다가 복구). status는 고정 enum만 허용 — LLM이
  // 자유 문자열을 지어내 넣지 못하게 막는다(U2와 동일 원칙). job_ksco와
  // 달리 검증 절차가 없는 것은 동일하다(자기신고) — 다만 이 필드는
  // "안전 판단을 낮추는" 위험군이 아니라 순수 맥락 정보라 §0-1-R의
  // C30 교차참조가 굳이 필요 없다(고용 상태 자체가 전문성 주장이
  // 아니므로).
  const WORK_DOMAIN_STATUS = new Set([
    'employed_public', 'employed_private', 'self_employed',
    'student', 'retired', 'homemaker', 'unemployed', 'other',
  ]);
  let resolvedWorkDomain = null;
  // 2026-07-17 신설 — statuses 배열화(다중 정체성 지원, 주피터님 지시).
  // 이전엔 status 단일 문자열이라 "학생이면서 부업 자영업" 같은 동시
  // 결합을 표현할 수 없었다(job_ksco와의 독립 결합은 이미 가능했지만,
  // work_domain 축 내부의 다중 결합은 불가능했음). 하위호환: 옛 저장값
  // (prevWd.status, 문자열)과 구버전 클라이언트가 여전히 work_domain.status로
  // 단일 문자열을 보내는 경우 둘 다 배열로 승격해 처리한다.
  if (entity_type === 'person' && work_domain && typeof work_domain === 'object') {
    const prevWd = (prevExtra.public || {}).identity?.work_domain || null;
    const prevStatuses = Array.isArray(prevWd?.statuses)
      ? prevWd.statuses
      : (prevWd?.status ? [prevWd.status] : []); // 구버전 단일값 승격

    const rawInput = Array.isArray(work_domain.statuses)
      ? work_domain.statuses
      : (work_domain.status ? [work_domain.status] : []); // 구버전 클라이언트 페이로드 승격
    const statuses = [...new Set(rawInput.filter(s => WORK_DOMAIN_STATUS.has(s)))].slice(0, 5); // 겸직 상한 5(affiliation과 동일 원칙)

    if (statuses.length > 0) {
      const setsEqual = statuses.length === prevStatuses.length && statuses.every(s => prevStatuses.includes(s));
      resolvedWorkDomain = {
        statuses,
        // active 기본값: 배열 안에 retired/unemployed"만" 있으면 false,
        // 그 외 하나라도 활동성 상태(학생·재직·자영업·전업주부·기타)가
        // 섞여 있으면 true. job_ksco가 이번에 확정돼 있으면(은퇴자인데
        // 자문·소일거리 등으로 직업 코드가 있는 경우) 그 자체도 활동성
        // 신호로 반영한다 — 2026-07-17 100인 사고실험(§IDENTIFY-EXP)
        // 케이스 #37에서 발견: "은퇴했지만 주 2일 자문"이 job_ksco는
        // 채워지는데 work_domain.statuses=['retired']만 있어 active가
        // false로 잘못 계산되던 결함. 명시적 active 값이 오면 그걸 최우선.
        active: typeof work_domain.active === 'boolean'
          ? work_domain.active
          : (statuses.some(s => !['retired', 'unemployed'].includes(s)) || !!resolvedJobKsco),
        // 조합 자체가 바뀐 시점만 갱신(원소 추가/제거 포함) — 같은
        // 조합을 매번 다시 제출해도 status_since가 밀리지 않게 한다.
        status_since: setsEqual ? (prevWd?.status_since || new Date().toISOString().slice(0, 10)) : new Date().toISOString().slice(0, 10),
      };
    }
    // 유효한 status가 하나도 없으면 조용히 무시(§0 U0: 실패보다 진행).
  }

  const newExtraPublic = {
    ...(prevExtra.public || {}),
    identity: {
      _schema_version: '2.0', display_name: name, description, tags,
      entity_subtype: body.entity_subtype || null,
      // 'job_ksco' in body로 "안 보냄(기존값 보존)"과 "null 명시(비움)"를 구분.
      job_ksco: ('job_ksco' in body) ? resolvedJobKsco : ((prevExtra.public || {}).identity?.job_ksco ?? null),
      affiliation: ('affiliation' in body) ? resolvedAffiliation : ((prevExtra.public || {}).identity?.affiliation ?? null),
      work_domain: ('work_domain' in body) ? resolvedWorkDomain : ((prevExtra.public || {}).identity?.work_domain ?? null),
    },
    activity: { timezone: 'Asia/Seoul', hours, holidays },
    contact:  { phone_display: phone, phone_visible: !!phone_visible, website, sns_public, languages_spoken },
    location: { region, address_short: address, directions, parking },
    finance:  { gdc_accepted, currencies, price_range, payout_account },
    // 2026-07-13 신설 — products_structured를 profile 레코드 자신에도
    // 저장(위 destructure 주석 참조). 'products_structured' in body로
    // "안 보냄(보존)"과 "빈 배열을 명시적으로 보냄(비움)"을 구분한다.
    products: ('products_structured' in body) ? products_structured : ((prevExtra.public || {}).products ?? []),
    field_visibility: resolvedFieldVisibility,
    // 2026-06-22: 업종/유형별 확장 슬롯(profile_pdv_schema_plan_v1.md Phase 1).
    // 'industry_fields' in body로 "필드 자체를 안 보냄(보존)"과 "null을 명시적으로 보냄(비움)"을 구분.
    industry_fields: ('industry_fields' in body) ? body.industry_fields : ((prevExtra.public || {}).industry_fields ?? null),
  };
  const newExtra = { ...prevExtra, public: newExtraPublic };

  // 2026-07-13 신설 — 주소 자동 지오코딩. profile-assistant는 주소를
  // 텍스트로만 수집하고 lat/lng를 채울 방법이 없었다(사고실험으로 발견
  // — 위치 기반 검색이 사업자 프로필에 대해 항상 무의미했음). 클라이언트가
  // lat/lng를 이미 보냈으면(예: GPS 자동감지) 그대로 신뢰하고, 주소만
  // 있고 좌표가 없으면 서버가 자동으로 지오코딩한다. 실패해도(주소
  // 인식 불가 등) 조용히 null로 남기고 프로필 저장 자체는 계속 진행한다
  // — 지오코딩은 부가 기능이지 저장의 필수 전제가 아니다.
  if (address && (lat == null || lng == null)) {
    const geocoded = await _geocodeAddressForward(env, address);
    if (geocoded) {
      lat = geocoded.lat;
      lng = geocoded.lng;
    }
  }

  const record = {
    guid,
    current_ipv6: guid,
    pubkey_ed25519: pubkey,
    entity_type,
    name,
    handle: finalHandle,
    native_lang,
    address,
    lat,
    lng,
    phone,
    website,
    occupation: resolvedOccupation,
    is_public,
    extra: newExtra,
    updated_at: new Date().toISOString(),
  };

  // ★ 2026-07-12 — Supabase→L1 이관 완성(4단계). 우선순위를 뒤집는다.
  // 이전: L1 먼저 시도(실패해도 무시) → Supabase 필수(실패하면 가입
  // 자체가 502로 막힘) — 즉 지금까지는 "이관 중"이라면서도 실제로는
  // Supabase가 여전히 최종 관문이었다(250건 사고실험 중 발견).
  // 이제:   L1 필수(실패하면 가입 자체가 502) → Supabase는 best-effort
  // (실패해도 가입은 성공 처리, 로그만 남김 — 다른 레거시 읽기 경로가
  // 아직 Supabase를 참조할 수 있어 당분간 병행 쓰기는 유지한다).
  let l1Result;
  try {
    l1Result = await _l1UpsertProfile(env, {
      guid, handle: finalHandle, entityType: entity_type, nativeLang: native_lang,
      isPublic: is_public, pubkey, extra: newExtra,
      core: { name, address, lat, lng, phone, website, occupation: resolvedOccupation },
    });
  } catch (e) {
    return _err(502, 'L1_SAVE_FAILED', 'L1 프로필 저장 실패: ' + e.message, corsHeaders);
  }

  // (2026-07-15: Supabase 병행쓰기 제거 — L1이 유일한 소스가 됐고,
  //  L1을 읽던 레거시 폴백 경로들도 전부 이 배치에서 함께 제거됐다.)
  const savedProfile = { ...record, id: l1Result?.id };

  // 2026-06-23: SP 합성 시점 — 가입 직후가 아니라 PROFILE_SUBMIT 완료 후.
  // 2026-07-01 전면 재설계: 개인/기관 구분 없이 _mergeAgentSP 하나로 통합
  // (이전엔 INDIVIDUAL/INSTITUTION으로 나눠 기관만 별도 그림자 행+키쌍을
  // 만들었으나, "나만의 AI비서=그림자, 별도 정체성 분리 불필요" 설계
  // 합의에 따라 모든 entity_type이 본인 행에 단일 SP를 직접 기록한다).
  const agentResult = await _mergeAgentSP(env, savedProfile).catch(e => {
    console.error('[Profile] 통합 SP 기록 실패(본 저장은 정상 처리됨):', e.message);
    return { ok: false, error: 'EXCEPTION', detail: e.message };
  });


  return new Response(JSON.stringify({ ok: true, profile: savedProfile, agent: agentResult }), { status: 200, headers: corsHeaders });
}


// ═══════════════════════════════════════════════════════════
// 2026-07-05 — K-Market 판매자 카탈로그 (seller_products)
//
// 오픈해시 철학: 로컬(IndexedDB, 판매자 기기)이 원본(source of truth)이고
// L1 PocketBase는 판매자가 로컬에서 상품을 등록/수정할 때마다 자동으로
// 반영되는 "백업이자 공개 검색용 미러"다. 판매자가 직접 여기(서버)에
// CRUD하는 관리자 패널이 아니다 — 클라이언트(gopang-seller-catalog.js)가
// 로컬 변경 즉시(디바운스) 전체 스냅샷을 이 엔드포인트로 밀어넣고,
// 서버는 그 guid 소유 레코드를 스냅샷 기준으로 통째로 교체한다.
//
// 업종(occupation/industry_fields.schema_id)은 사용자가 직접 고르지 않는다.
// 상품 카테고리(seller_products.category)에서 KSIC_KEYWORD_MAP으로
// 결정적으로 유도한다(_deriveOccupationFromCategories) — "market 시스템이
// 업종을 판단하고, 사용자는 상품·서비스만 등록한다"는 원칙.
// ═══════════════════════════════════════════════════════════

// L1 seller_products 컬렉션에서 guid 소유 레코드 전체 조회
async function _l1ListSellerProducts(env, guid) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`seller_guid='${guid}'`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/seller_products/records?filter=${filter}&perPage=200`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 seller_products 조회 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items || [];
}

// 2026-07-13 신설 — 재고 자동 차감(②단계). handleBizOrder가 이미
// 조회해둔 catalog(byId 매칭용, 가격검증 재사용)와 txItems를 그대로
// 받아, stock_qty가 숫자로 추적되는 상품만 차감한다(null=무제한/미추적
// 상품은 건드리지 않음 — 기존 동작 그대로 유지). worker.js
// handleCatalogSync의 legacy stock(select) 자동 파생 로직과 동일한
// 임계값(0=out, ≤3=low)을 재사용해 두 경로가 어긋나지 않게 한다.
async function _decrementStockAfterOrder(env, catalog, txItems) {
  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  const byId = new Map(catalog.map(r => [r.id, r]));
  for (const item of txItems) {
    const rec = byId.get(item.id);
    if (!rec || typeof rec.stock_qty !== 'number') continue; // 미추적 상품은 건드리지 않음
    const qty = Number(item.quantity) > 0 ? Number(item.quantity) : 1;
    const newQty = Math.max(0, rec.stock_qty - qty);
    const derivedStock = newQty <= 0 ? 'out' : (newQty <= 3 ? 'low' : 'in');
    await fetch(`${L1_DEFAULT}/api/collections/seller_products/records/${rec.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ stock_qty: newQty, stock: derivedStock }),
    }).catch(e => console.warn('[Stock] 개별 상품 차감 실패(무시):', rec.id, e.message));
  }
}

// ★ 2026-07-09 신설 — 짜장면 주문 사고실험 5·6번(주문 큐/주방 용량 판단,
// 조리시간 파악)용. seller_products와 동일한 _l1AdminToken 인증 패턴.
async function _l1CountActiveOrders(env, sellerGuid) {
  const token = await _l1AdminToken(env);
  const filter = encodeURIComponent(`seller_guid='${sellerGuid}' && (status='accepted' || status='preparing')`);
  const res = await fetch(`${L1_DEFAULT}/api/collections/order_queue/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`L1 order_queue 카운트 실패 (HTTP ${res.status})`);
  const data = await res.json().catch(() => ({ totalItems: 0 }));
  return data.totalItems || 0;
}

async function _l1CreateOrderQueueEntry(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/order_queue/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`order_queue 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

// ── dept_tasks(부서/기관/사업자 간 업무지시 큐) L1 헬퍼 (2026-07-12 신설) ──
async function _l1CreateDeptTask(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/dept_tasks/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`dept_tasks 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

async function _l1UpdateDeptTask(env, taskId, patch) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/dept_tasks/records/${taskId}`, {
    method: 'PATCH',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`dept_tasks 갱신 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

// (2026-07-15 삭제 — _searchEntitiesRaw. 유일한 실 검색 경로는 이미
//  _l1SearchEntities(L1 기반, 4511행)로 대체돼 있었고, 이 함수는
//  정의만 있을 뿐 호출하는 곳이 저장소 전체에 하나도 없었다 — 짜장면
//  배송업체 검색용으로 별도 분리했다는 주석이 있었지만 실제로는
//  연결된 적이 없었던 것으로 보인다. Supabase rpc/search_entities
//  의존이라 정리 대상.)

async function _l1CreateDeliveryRequest(env, record) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/delivery_requests/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(record),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`delivery_requests 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}

// 로컬 스냅샷 기준으로 서버 미러를 통째로 교체(삭제 후 재삽입) — PocketBase엔
// 벌크 upsert가 없어 건별 처리. 상품 수가 보통 수십 개 수준이라 무리 없음.
//
// @param {string} mode — 'replace'(기본값) | 'merge' (2026-07-07 신설)
//   'replace': 기존 동작 그대로 — 스냅샷에 없는 기존 레코드는 삭제한다.
//     gopang-seller-catalog.js(판매자 본인이 로컬 IndexedDB를 원본으로
//     운영하며 전체 스냅샷을 보내는 경우)가 쓰는 모드 — 그 판매자의
//     전체 카탈로그를 이 호출 하나로 완전히 대체하고 싶을 때 맞다.
//   'merge': 삭제 단계를 건너뛰고 upsert만 한다. 호출자가 그 판매자의
//     "전체" 카탈로그를 모르는 채로(예: CA/PA가 프로필에서 파악한 상품
//     일부만 들고 있는 경우) 보낼 때 쓴다 — 여기 없는 기존 상품을
//     실수로 지우면 안 되는 경우.
async function _l1SyncSellerProducts(env, guid, products, mode = 'replace', deletedNames = []) {
  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const existing = await _l1ListSellerProducts(env, guid);
  const existingByProductId = new Map(existing.map(r => [r.product_id, r]));

  if (mode === 'replace') {
    const incomingIds = new Set(products.map(p => p.id));
    // 스냅샷에 없는 기존 레코드 삭제(판매자가 로컬에서 삭제한 상품)
    for (const rec of existing) {
      if (!incomingIds.has(rec.product_id)) {
        await fetch(`${L1_DEFAULT}/api/collections/seller_products/records/${rec.id}`, {
          method: 'DELETE', headers,
        }).catch(e => console.warn('[Catalog] 삭제 실패(무시하고 계속):', e.message));
      }
    }
  }
  // mode === 'merge'면 위 전체교체 삭제 단계는 건너뛴다.

  // 2026-07-13 신설 — 이름 기반 표적 삭제. mode와 무관하게(merge에서도)
  // 동작한다 — profile-assistant처럼 "그 세션에서 파악한 상품 일부만"
  // 들고 있는 호출자가, 사용자가 "이제 안 팔아요"라고 말한 특정 상품
  // 하나만 정확히 지우고 싶을 때 쓴다. mode='replace'로 전체 스냅샷을
  // 요구하지 않아도 되므로, 알지 못하는 다른 상품을 실수로 지울 위험이
  // 없다(이름이 정확히 일치하는 것만 지움).
  if (Array.isArray(deletedNames) && deletedNames.length) {
    const targetNames = new Set(deletedNames.map(n => String(n || '').trim().toLowerCase()).filter(Boolean));
    for (const rec of existing) {
      if (targetNames.has(String(rec.name || '').trim().toLowerCase())) {
        await fetch(`${L1_DEFAULT}/api/collections/seller_products/records/${rec.id}`, {
          method: 'DELETE', headers,
        }).catch(e => console.warn('[Catalog] 표적 삭제 실패(무시하고 계속):', rec.id, e.message));
      }
    }
  }

  // upsert
  for (const p of products) {
    // 2026-07-13 신설 — stock_qty(숫자)가 오면 legacy stock(select
    // in/low/out)을 여기서 자동 파생한다. 클라이언트가 stock_qty 없이
    // stock만 보내는 기존 방식도 그대로 지원(하위호환).
    const hasQty = typeof p.stock_qty === 'number';
    const derivedStock = hasQty
      ? (p.stock_qty <= 0 ? 'out' : (p.stock_qty <= 3 ? 'low' : 'in'))
      : (p.stock || 'in');
    const body = {
      seller_guid: guid,
      product_id: p.id,
      name: p.name || '',
      desc: p.desc || '',
      price: typeof p.price === 'number' ? p.price : null,
      // 2026-07-13 신설 — GDC-재무제표-재고 연동 4단계(매출원가/COGS).
      // 절대 공개 카탈로그에 포함하지 않는다(handleCatalogGet에서 명시
      // 제외 — 원가는 사업자 본인 외 누구에게도 노출되면 안 됨).
      cost_price: typeof p.cost_price === 'number' ? p.cost_price : null,
      unit: p.unit || '',
      category: p.category || '',
      stock: derivedStock,
      stock_qty: hasQty ? p.stock_qty : null,
      image_url: p.image_url || '',
      is_public: p.is_public !== false,
      updated_at: p.updated_at || new Date().toISOString(),
    };
    const existingRec = existingByProductId.get(p.id);
    if (existingRec) {
      await fetch(`${L1_DEFAULT}/api/collections/seller_products/records/${existingRec.id}`, {
        method: 'PATCH', headers, body: JSON.stringify(body),
      }).catch(e => console.warn('[Catalog] 갱신 실패(무시하고 계속):', e.message));
    } else {
      await fetch(`${L1_DEFAULT}/api/collections/seller_products/records`, {
        method: 'POST', headers, body: JSON.stringify(body),
      }).catch(e => console.warn('[Catalog] 신규 저장 실패(무시하고 계속):', e.message));
    }
  }
}

// ═══════════════════════════════════════════════════════════
// 2026-07-07 신설 — trade_ratings / 온도(temperature)
// /biz/review(Supabase, 5점 척도)를 완전 대체. 실거래(tx_hash) 당사자만
// 평가 가능 — 대화 중 합의된 설계 원칙:
//   1) 세금계산서/현금영수증이 걸리는 실거래라 허위 평가 자체가 비용을 짐
//   2) polarity 3단계(자유서술 아님) — comment는 온도 계산과 분리
//   3) 금액 비례(카테고리 중앙값 정규화) + 평가자 신뢰도(온도 스냅샷) 가중
//   4) rater_temp_snapshot 고정 — 시간순 DAG, 순환 재계산 없음
// ═══════════════════════════════════════════════════════════
const POLARITY_WEIGHT       = { positive: 0.3, neutral: 0.0, negative: -0.7 };
const RATING_DECAY           = 0.97;
const RATING_DELTA_CLAMP     = 8.0;
const MIN_RATINGS_FOR_TEMP   = 5;
const DEFAULT_TEMP           = 36.5;
const TEMP_MIN               = 0;
const TEMP_MAX               = 99;

// Δ_i 계산 — 합의된 최종 산식
function _computeRatingDelta({ polarity, decayIndex, repeatIndex, amount, categoryMedian, raterTempSnapshot }) {
  const polarityWeight   = POLARITY_WEIGHT[polarity];
  const decay            = Math.pow(RATING_DECAY, decayIndex);
  const repeatDampening  = repeatIndex > 3 ? Math.pow(0.5, repeatIndex - 3) : 1.0;
  const amountRatio      = categoryMedian > 0 ? amount / categoryMedian : 1.0;
  const raterCredibility = 0.5 + (raterTempSnapshot - DEFAULT_TEMP) / 62.5; // 36.5→0.5, 99→1.5
  const raw = polarityWeight * decay * repeatDampening * amountRatio * raterCredibility;
  return Math.max(-RATING_DELTA_CLAMP, Math.min(RATING_DELTA_CLAMP, raw));
}

// 업종별 최근 90일 L1 중앙값 거래액 캐시 조회 (category_medians 컬렉션,
// 일 1회 배치 갱신은 scheduled() 크론에 별도 등록 — 이 함수는 조회 전용)
async function _getCategoryMedianAmount(l1Base, token, category) {
  const filter = encodeURIComponent(`category='${category}'`);
  const res = await fetch(`${l1Base}/api/collections/category_medians/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return 1; // 캐시 미존재 시 정규화 비율 1.0으로 폴백
  const data = await res.json().catch(() => ({ items: [] }));
  return data.items?.[0]?.median_amount ?? 1;
}

// POST /biz/trade-rating — tx_hash 실거래 당사자만 평가 가능
async function handleTradeRatingSubmit(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { tx_hash, rater_guid, ratee_guid, rater_role, polarity, comment, amount, category,
          pubkey, signature, ts = '' } = body;
  if (!tx_hash)     return _err(400, 'MISSING_FIELD', 'tx_hash 필수', corsHeaders);
  if (!rater_guid)  return _err(400, 'MISSING_FIELD', 'rater_guid 필수', corsHeaders);
  if (!ratee_guid)  return _err(400, 'MISSING_FIELD', 'ratee_guid 필수', corsHeaders);
  if (!pubkey)      return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature)   return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!/^[0-9a-f]{64}$/.test(tx_hash)) return _err(400, 'INVALID_TX_HASH', 'tx_hash 형식 오류', corsHeaders);
  if (!['positive', 'neutral', 'negative'].includes(polarity)) return _err(400, 'INVALID_POLARITY', 'polarity는 positive/neutral/negative만 허용', corsHeaders);
  if (!['buyer', 'seller'].includes(rater_role)) return _err(400, 'INVALID_ROLE', 'rater_role은 buyer/seller만 허용', corsHeaders);
  if (typeof amount !== 'number' || amount <= 0) return _err(400, 'MISSING_FIELD', 'amount 필수(양수)', corsHeaders);
  if (!category) return _err(400, 'MISSING_FIELD', 'category 필수', corsHeaders);

  // 2026-07-15 재적용 — 이 블록이 원래 같은 날 07:13 커밋(852b1a7)으로
  // 추가됐는데, 4분 뒤 무관한 커밋(a7c19e5, anchorL1MerkleRoot 이관)이
  // 오래된 로컬 체크아웃에서 작업하다 실수로 되돌렸다(2026-07-15
  // 저장소 점검에서 발견 — git이 같은 파일의 다른 부분이라 충돌 없이
  // 조용히 통과시킴). 내용은 최초 추가 때와 동일:
  //
  // rater_guid를 요청 바디값 그대로 믿으면, 거래 상대방이 상대 개인키
  // 없이도 "구매자가 남긴 것처럼" 가짜 긍정 평가를 대신 제출해 자기
  // 온도를 올릴 수 있다 — "실거래 검증이라 허위 평가가 어렵다"는 원래
  // 설계 의도를 무력화하는 구멍이었다. /biz/claims·/biz/settle-ledger와
  // 동일한 서명+TOFU 인증 원칙을 쓰되, tx_hash·양쪽 guid·polarity를
  // 전부 서명 메시지에 묶어서 재생공격도 막는다.
  const authOk = await _verifyClaimsRequester(env, {
    guid: rater_guid, pubkey, signature,
    sigMsg: `rating:${tx_hash}:${rater_guid}:${ratee_guid}:${polarity}:${pubkey}:${ts}`,
    ts,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  // 판매자(ratee) 소속 L1 조회 — seller_products와 동일 패턴(§4 guid_home_l1)
  const homeNodeId = (await _resolveHomeL1Node(env, ratee_guid)) || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;
  const token = await _l1AdminTokenFor(env, l1Base);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1) 거래 실재성 + 당사자 일치 검증 — blocks 컬렉션에서 tx_hash로 조회
  const blockFilter = encodeURIComponent(`tx_hash='${tx_hash}'`);
  const blockRes = await fetch(`${l1Base}/api/collections/blocks/records?filter=${blockFilter}&perPage=1`, { headers });
  if (!blockRes.ok) return _err(502, 'L1_UNREACHABLE', 'blocks 조회 실패: ' + blockRes.status, corsHeaders);
  const blockData = await blockRes.json().catch(() => ({ items: [] }));
  const blockRecord = blockData.items?.[0];
  if (!blockRecord) return _err(404, 'TX_NOT_FOUND', '해당 tx_hash의 거래를 찾을 수 없습니다', corsHeaders);
  if (rater_guid !== blockRecord.buyer_guid && rater_guid !== blockRecord.seller_guid) {
    return _err(403, 'NOT_A_PARTICIPANT', '거래 당사자만 평가할 수 있습니다', corsHeaders);
  }
  if (ratee_guid !== blockRecord.buyer_guid && ratee_guid !== blockRecord.seller_guid) {
    return _err(400, 'RATEE_MISMATCH', 'ratee_guid가 해당 거래의 당사자가 아닙니다', corsHeaders);
  }

  // 2) 중복 방지 — (tx_hash, rater_guid) 복합 유니크
  const dupFilter = encodeURIComponent(`tx_hash='${tx_hash}'&&rater_guid='${rater_guid}'`);
  const dupRes = await fetch(`${l1Base}/api/collections/trade_ratings/records?filter=${dupFilter}&perPage=1`, { headers });
  const dupData = await dupRes.json().catch(() => ({ items: [] }));
  if (dupData.items?.length > 0) return _err(409, 'ALREADY_RATED', '이미 이 거래를 평가했습니다', corsHeaders);

  // 3) rater 온도 스냅샷 고정 (미래 rater 온도 변화가 과거 Δ에 소급 전파되지 않도록)
  const raterFilter = encodeURIComponent(`guid='${rater_guid}'`);
  const raterRes = await fetch(`${l1Base}/api/collections/profiles/records?filter=${raterFilter}&perPage=1`, { headers });
  const raterData = await raterRes.json().catch(() => ({ items: [] }));
  const raterTempSnapshot = raterData.items?.[0]?.temp_score ?? DEFAULT_TEMP;

  // 4) 동일 (rater, ratee) 쌍 반복거래 횟수 조회 (감쇠 계산용)
  const pairFilter = encodeURIComponent(`rater_guid='${rater_guid}'&&ratee_guid='${ratee_guid}'`);
  const pairRes = await fetch(`${l1Base}/api/collections/trade_ratings/records?filter=${pairFilter}&perPage=1`, { headers });
  const pairData = await pairRes.json().catch(() => ({ items: [] }));
  const repeatIndex = (pairData.totalItems ?? 0) + 1;

  // 5) decay 인덱스 — ratee 기준 현재까지의 평가 건수
  const raterCountRes = await fetch(`${l1Base}/api/collections/trade_ratings/records?filter=${encodeURIComponent(`ratee_guid='${ratee_guid}'`)}&perPage=1`, { headers });
  const raterCountData = await raterCountRes.json().catch(() => ({ totalItems: 0 }));
  const decayIndex = raterCountData.totalItems ?? 0;

  // 6) 업종 중앙값 조회
  const categoryMedian = await _getCategoryMedianAmount(l1Base, token, category);

  // 7) insert (append-only — update/delete 경로 없음)
  const insRes = await fetch(`${l1Base}/api/collections/trade_ratings/records`, {
    method: 'POST', headers,
    body: JSON.stringify({
      tx_hash, rater_guid, ratee_guid, rater_role, polarity,
      comment: comment || '', amount, category,
      rater_temp_snapshot: raterTempSnapshot,
      created_at: new Date().toISOString(),
    }),
  });
  if (!insRes.ok) return _err(500, 'INSERT_FAILED', await insRes.text(), corsHeaders);
  const inserted = await insRes.json().catch(() => null);

  // 8) Δ 계산 후 profiles.temp_score 증분 업데이트
  const delta = _computeRatingDelta({ polarity, decayIndex, repeatIndex, amount, categoryMedian, raterTempSnapshot });
  const rateeFilter = encodeURIComponent(`guid='${ratee_guid}'`);
  const rateeRes = await fetch(`${l1Base}/api/collections/profiles/records?filter=${rateeFilter}&perPage=1`, { headers });
  const rateeData = await rateeRes.json().catch(() => ({ items: [] }));
  const rateeProfile = rateeData.items?.[0];
  if (rateeProfile) {
    const currentTemp = rateeProfile.temp_score ?? DEFAULT_TEMP;
    const currentCount = rateeProfile.temp_rating_count ?? 0;
    const nextTemp = Math.max(TEMP_MIN, Math.min(TEMP_MAX, currentTemp + delta));
    await fetch(`${l1Base}/api/collections/profiles/records/${rateeProfile.id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({
        temp_score: nextTemp,
        temp_rating_count: currentCount + 1,
        temp_updated_at: new Date().toISOString(),
      }),
    }).catch(e => console.warn('[TradeRating] 온도 갱신 실패:', e.message));
  }

  return new Response(JSON.stringify({ ok: true, record_id: inserted?.id || null, delta }), { status: 200, headers: corsHeaders });
}

// GET /biz/temperature?guid=... — 공개 조회(온도 + 배지). 5건 미만이면 "신규 판매자" 배지.
async function handleTemperatureQuery(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const homeNodeId = (await _resolveHomeL1Node(env, guid)) || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;
  const token = await _l1AdminTokenFor(env, l1Base);
  const filter = encodeURIComponent(`guid='${guid}'`);
  const res = await fetch(`${l1Base}/api/collections/profiles/records?filter=${filter}&perPage=1`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  const data = await res.json().catch(() => ({ items: [] }));
  const profile = data.items?.[0];
  const count = profile?.temp_rating_count ?? 0;

  if (count < MIN_RATINGS_FOR_TEMP) {
    return new Response(JSON.stringify({ ok: true, temp_score: null, badge: 'new_seller', count }), { status: 200, headers: corsHeaders });
  }
  return new Response(JSON.stringify({ ok: true, temp_score: profile.temp_score ?? DEFAULT_TEMP, badge: null, count }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-13 신설 — 예약(reservations)
//   시간대(slot)/날짜단위(range) 둘 다 지원. 확정 방식(confirm_mode)과
//   보증금 온도 임계값(deposit_temp_threshold)은 사업자가
//   industry_fields.reservation_config에 설정한 값을 예약 생성 시점에
//   스냅샷한다(trade_ratings의 rater_temp_snapshot과 동일 원칙 — 이후
//   사업자가 설정을 바꿔도 이미 생성된 예약엔 소급 적용되지 않음).
//   보증금은 별도 결제 시스템을 새로 만들지 않고 기존 /biz/order
//   (contract_type='escrow')의 tx_hash를 deposit_order_tx_hash로 참조만
//   한다 — 그 tx의 실재성 검증(blocks 조회)은 v1에서는 생략하고 존재
//   여부만 확인한다(TODO: trade-rating처럼 blocks 조회로 당사자·금액까지
//   검증하는 건 후속 패치 — 이번 범위는 예약 스케줄링 자체).
// ═══════════════════════════════════════════════════════════
const RESERVATION_ALLOWED_TYPES   = new Set(['slot', 'range']);
const RESERVATION_ALLOWED_STATUS  = new Set(['pending', 'confirmed', 'cancelled', 'completed', 'no_show']);
const RESERVATION_DEPOSIT_TEMP_DEFAULT = 36.5; // DEFAULT_TEMP와 동일 값 — 별도 상수로 분리(설정 가능성 대비)

// 요청/전이 유효성 — {현재상태: {허용 다음상태 집합}}
const RESERVATION_TRANSITIONS = {
  pending:   new Set(['confirmed', 'cancelled']),
  confirmed: new Set(['cancelled', 'completed', 'no_show']),
};

// POST /biz/reservation — 예약 생성
async function handleReservationCreate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const {
    guid, seller_guid, reservation_type, start_at, end_at = null,
    deposit_order_tx_hash = null, note = '',
  } = body;

  if (!guid)              return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!seller_guid)       return _err(400, 'MISSING_FIELD', 'seller_guid 필수', corsHeaders);
  if (!reservation_type)  return _err(400, 'MISSING_FIELD', 'reservation_type 필수', corsHeaders);
  if (!RESERVATION_ALLOWED_TYPES.has(reservation_type)) {
    return _err(400, 'INVALID_TYPE', `reservation_type은 slot/range만 허용됩니다`, corsHeaders);
  }
  if (!start_at) return _err(400, 'MISSING_FIELD', 'start_at 필수', corsHeaders);
  if (reservation_type === 'range' && !end_at) {
    return _err(400, 'MISSING_FIELD', 'range 예약은 end_at 필수', corsHeaders);
  }

  const homeNodeId = (await _resolveHomeL1Node(env, seller_guid)) || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;
  const token  = await _l1AdminTokenFor(env, l1Base);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  // 1) 사업자 예약 설정 조회
  const sellerFilter = encodeURIComponent(`guid='${seller_guid}'`);
  const sellerRes = await fetch(`${l1Base}/api/collections/profiles/records?filter=${sellerFilter}&perPage=1`, { headers });
  const sellerData = await sellerRes.json().catch(() => ({ items: [] }));
  const sellerProfile = sellerData.items?.[0];
  if (!sellerProfile) return _err(404, 'SELLER_NOT_FOUND', '사업자 프로필을 찾을 수 없습니다', corsHeaders);

  const rc = sellerProfile.extra?.public?.industry_fields?.reservation_config || null;
  if (!rc || !rc.enabled) {
    return _err(400, 'NOT_RESERVABLE', '이 사업자는 예약을 받지 않습니다', corsHeaders);
  }
  if (rc.mode !== 'both' && rc.mode !== reservation_type) {
    return _err(400, 'TYPE_NOT_SUPPORTED', `이 사업자는 ${rc.mode} 방식만 지원합니다`, corsHeaders);
  }
  const confirmMode = rc.confirm_mode === 'manual' ? 'manual' : 'auto';
  const depositThreshold = typeof rc.deposit_temp_threshold === 'number'
    ? rc.deposit_temp_threshold : RESERVATION_DEPOSIT_TEMP_DEFAULT;

  // 2) 요청자 온도 조회 — /biz/temperature와 동일 로직(내부 재사용)
  const requesterFilter = encodeURIComponent(`guid='${guid}'`);
  const requesterRes = await fetch(`${l1Base}/api/collections/profiles/records?filter=${requesterFilter}&perPage=1`, { headers });
  const requesterData = await requesterRes.json().catch(() => ({ items: [] }));
  const requesterProfile = requesterData.items?.[0];
  const requesterTemp = requesterProfile?.temp_score ?? DEFAULT_TEMP; // 신규 사용자는 기본값(온도 배지 렌더링 규칙과 동일)

  const depositRequired = requesterTemp < depositThreshold;
  if (depositRequired && !deposit_order_tx_hash) {
    return _err(402, 'DEPOSIT_REQUIRED',
      `신뢰도 온도(${requesterTemp.toFixed(1)}°)가 기준(${depositThreshold}°) 미만이라 보증금 결제가 필요합니다`,
      corsHeaders);
  }

  // 3) 예약 레코드 생성
  const now = new Date().toISOString();
  const record = {
    guid, seller_guid, reservation_type, start_at, end_at,
    status: confirmMode === 'manual' ? 'pending' : 'confirmed',
    confirm_mode: confirmMode,
    deposit_required: depositRequired,
    deposit_order_tx_hash: deposit_order_tx_hash || null,
    note: String(note || '').slice(0, 500),
    created_at: now, updated_at: now,
  };

  const insRes = await fetch(`${l1Base}/api/collections/reservations/records`, {
    method: 'POST', headers, body: JSON.stringify(record),
  });
  if (!insRes.ok) return _err(500, 'INSERT_FAILED', await insRes.text(), corsHeaders);
  const inserted = await insRes.json().catch(() => null);

  return new Response(JSON.stringify({
    ok: true, reservation_id: inserted?.id || null,
    status: record.status, deposit_required: depositRequired,
  }), { status: 201, headers: corsHeaders });
}

// PATCH /biz/reservation/status — 상태 전이(확정/취소/완료/노쇼)
// 원칙: pending→confirmed/cancelled, confirmed→cancelled/completed/no_show만 허용.
// TODO: actor_guid가 실제로 seller_guid/guid 당사자인지 서명 검증은 이번 범위 밖
// (handleProfileClaim류 Ed25519 서명 검증 패턴을 후속 패치에서 적용 필요 —
// 지금은 profile.html이 로그인 세션의 guid를 그대로 보내는 경량 체크만 수행).
async function handleReservationStatus(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { reservation_id, actor_guid, new_status } = body;
  if (!reservation_id) return _err(400, 'MISSING_FIELD', 'reservation_id 필수', corsHeaders);
  if (!actor_guid)     return _err(400, 'MISSING_FIELD', 'actor_guid 필수', corsHeaders);
  if (!RESERVATION_ALLOWED_STATUS.has(new_status)) {
    return _err(400, 'INVALID_STATUS', 'new_status 값이 올바르지 않습니다', corsHeaders);
  }

  // reservation_id만으로는 어느 L1인지 알 수 없으므로, seller_guid 매핑을
  // 못 쓰는 대신 요청 본문에 seller_guid를 함께 받아 홈 노드를 찾는다.
  const { seller_guid } = body;
  if (!seller_guid) return _err(400, 'MISSING_FIELD', 'seller_guid 필수(홈 노드 조회용)', corsHeaders);

  const homeNodeId = (await _resolveHomeL1Node(env, seller_guid)) || 'KR-JEJU-JEJU-HANLIM';
  const l1Base = L1_NODE_MAP[homeNodeId] || L1_DEFAULT;
  const token  = await _l1AdminTokenFor(env, l1Base);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };

  const getRes = await fetch(`${l1Base}/api/collections/reservations/records/${reservation_id}`, { headers });
  if (!getRes.ok) return _err(404, 'NOT_FOUND', '예약을 찾을 수 없습니다', corsHeaders);
  const existing = await getRes.json().catch(() => null);
  if (!existing) return _err(404, 'NOT_FOUND', '예약을 찾을 수 없습니다', corsHeaders);

  if (actor_guid !== existing.guid && actor_guid !== existing.seller_guid) {
    return _err(403, 'NOT_A_PARTICIPANT', '예약 당사자만 상태를 변경할 수 있습니다', corsHeaders);
  }
  const allowedNext = RESERVATION_TRANSITIONS[existing.status];
  if (!allowedNext || !allowedNext.has(new_status)) {
    return _err(400, 'INVALID_TRANSITION', `${existing.status} → ${new_status} 전이는 허용되지 않습니다`, corsHeaders);
  }

  const patchRes = await fetch(`${l1Base}/api/collections/reservations/records/${reservation_id}`, {
    method: 'PATCH', headers,
    body: JSON.stringify({ status: new_status, updated_at: new Date().toISOString() }),
  });
  if (!patchRes.ok) return _err(500, 'UPDATE_FAILED', await patchRes.text(), corsHeaders);

  return new Response(JSON.stringify({ ok: true, reservation_id, status: new_status }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-13 신설 — 판매자 claim 전달 큐(pending_claims)
//   redeemClaim()의 claimant 필터(2026-07-07, 이중계상 방지) 때문에
//   구매자 opener 창에만 전달되던 seller_claim이 판매자에게 도달할
//   방법이 전혀 없었다(실사로 발견). order_queue와 동일한 "확인 후
//   처리" 패턴 — 판매자가 앱을 열 때 자기 앞으로 온 미청구 claim을
//   조회해 로컬에서 redeemClaim()한 뒤 서버에 수령 처리한다.
// ═══════════════════════════════════════════════════════════

// GET /biz/claims?guid=...&pubkey=...&signature=...&ts=... — 미청구 claim 목록 조회
async function handleClaimsList(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid      = url.searchParams.get('guid');
  const pubkey    = url.searchParams.get('pubkey');
  const signature = url.searchParams.get('signature');
  const ts        = url.searchParams.get('ts') || '';
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  // 2026-07-13 신설 — 서명 인증 필수. guid는 공개 정보라 자기주장만으로는
  // 남의 claim 목록(거래 금액 등 민감 정보 포함)을 볼 수 있었다.
  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `claims:${guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}` };
  const filter = encodeURIComponent(`claimant='${guid}' && redeemed=false`);
  const res = await fetch(
    `${L1_DEFAULT}/api/collections/pending_claims/records?filter=${filter}&sort=created&perPage=50`,
    { headers }
  );
  if (!res.ok) return _err(502, 'L1_UNREACHABLE', 'claim 조회 실패', corsHeaders);
  const data = await res.json().catch(() => ({ items: [] }));
  const claims = (data.items || []).map(r => ({
    id: r.id,
    claim_data: r.claim_data,
    block_hash: r.block_hash,
    block_id: r.block_id,
    tx_hash: r.tx_hash,
    session_id: r.session_id,
    source: r.source,
  }));
  return new Response(JSON.stringify({ ok: true, claims }), { status: 200, headers: corsHeaders });
}

// POST /biz/claims/ack — 로컬 redeemClaim() 성공 후 수령 확인(중복 적용 방지)
async function handleClaimsAck(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, claim_ids, pubkey, signature, ts = '' } = body;
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!Array.isArray(claim_ids) || !claim_ids.length) {
    return _err(400, 'MISSING_FIELD', 'claim_ids 배열 필수', corsHeaders);
  }

  // 2026-07-13 신설 — 서명 인증 필수. 지금까지 guid만 body에 넣으면
  // 누구든 남의 claim을 "수령 완료"로 표시해 실제 소유자가 영영 못
  // 받게 만들 수 있었다(사고실험 발견 — DoS성 공격). 서명을 이번
  // claim_ids 목록에 정확히 바인딩해, 다른 claim_ids로 재사용(replay)
  // 하는 것도 함께 막는다.
  const sortedIds = [...claim_ids].sort().join(',');
  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `claims_ack:${guid}:${pubkey}:${ts}:${sortedIds}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' };
  let acked = 0;
  for (const id of claim_ids) {
    // claimant 재확인 — 다른 사람의 claim_id를 추측해 남의 것을 ack
    // 처리하지 못하도록 조회 후 소유자를 대조한다.
    const getRes = await fetch(`${L1_DEFAULT}/api/collections/pending_claims/records/${id}`, { headers });
    if (!getRes.ok) continue;
    const rec = await getRes.json().catch(() => null);
    if (!rec || rec.claimant !== guid) continue;
    const patchRes = await fetch(`${L1_DEFAULT}/api/collections/pending_claims/records/${id}`, {
      method: 'PATCH', headers,
      body: JSON.stringify({ redeemed: true, redeemed_at: new Date().toISOString() }),
    });
    if (patchRes.ok) acked++;
  }
  return new Response(JSON.stringify({ ok: true, acked }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-14 신설 — GDC 재무제표 재결선(옵션 b: Supabase → L1 이관).
// 검증 결과: K-Market 주문의 revenue/cogs가 2026-07-07 L1 이관 이후
// Supabase fs_ledger에 더 이상 기록되지 않는데, GDC의 settleLedger()/
// gdc_settle_ledger RPC는 여전히 그 테이블만 읽고 있어 실거래가 있어도
// 손익계산서가 갱신되지 않았다. 판매자 매출(pl-revenue)·매출원가
// (pl-cogs)는 L1 pending_claims에 실제로 쌓이고 있으므로(handleBizOrder
// 참고) 여기서 그걸 직접 집계한다.
//
// 2026-07-14 추가 지시 반영 — "Supabase는 더 이상 사용하면 안됩니다":
// Supabase user_profiles로의 병행(미러) PATCH를 완전히 제거했다. 쓰기는
// L1 profiles.extra.fs.pl만 정본으로 삼는다. 읽기 쪽은 아래 신설한
// GET /biz/financials로 대체한다(gdc-core.js가 호출).
//
// 범위: 판매자(claimant=seller_guid) 측 매출·매출원가만 다룬다. 구매자
// 측 매입(pl-purchase)은 buyer_claim이 로컬 지갑에만 즉시 반영되고
// pending_claims에는 적재되지 않아 서버에서 재구성할 수 없다 — 별도
// 이관 필요(후속 작업).
// ═══════════════════════════════════════════════════════════
async function handleSettleLedger(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);
  const { guid, pubkey, signature, ts = '' } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  // /biz/claims와 동일한 서명+TOFU 인증 — guid만 자기주장하면 남의 매출
  // 정보를 조회/재계산시킬 수 있는 것을 막는다(2026-07-13 /biz/claims에
  // 적용된 것과 동일한 원칙).
  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `settle:${guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}` };

  // pending_claims 전체 페이지네이션 — claimant=guid 레코드 전부
  // (redeemed 무관 — 로컬 지갑 수령 여부와 무관하게 발생한 거래는 전부
  // 누적 집계에 포함돼야 한다). 안전판: 최대 20페이지(2,000건)까지만
  // 순회한다 — 그 이상이면 truncated:true로 응답에 표시한다(완전한
  // 커서 기반 페이지네이션은 후속 작업).
  let revenue = 0, cogs = 0;
  let page = 1, truncated = false;
  const PER_PAGE = 100, MAX_PAGES = 20;
  const filter = encodeURIComponent(`claimant='${guid}'`);
  while (page <= MAX_PAGES) {
    const res = await fetch(
      `${L1_DEFAULT}/api/collections/pending_claims/records?filter=${filter}&page=${page}&perPage=${PER_PAGE}`,
      { headers }
    );
    if (!res.ok) return _err(502, 'L1_UNREACHABLE', 'pending_claims 조회 실패', corsHeaders);
    const data = await res.json().catch(() => ({ items: [], totalPages: 0 }));
    const items = data.items || [];
    for (const rec of items) {
      const claims = Array.isArray(rec.claim_data) ? rec.claim_data : [];
      for (const c of claims) {
        if (c.claimant && c.claimant !== guid) continue; // 방어적 재확인
        const amt = parseFloat(c.amount) || 0;
        if (c.fs_account === 'pl-revenue' && c.direction === 'credit') revenue += amt;
        else if (c.fs_account === 'pl-cogs' && c.direction === 'debit') cogs += amt;
      }
    }
    if (page >= (data.totalPages || 1)) break;
    page++;
  }
  if (page > MAX_PAGES) {
    truncated = true;
    console.warn('[GDC Settle] pending_claims 페이지 상한 도달 — 부분 집계:', guid);
  }

  // 손실도 그대로 보여준다 — 이전 클라이언트 구현(Math.max(0,...))은
  // 적자를 항상 ₮0으로 지워서 실제 손실이 재무제표에서 사라졌었다
  // (2026-07-14 검증에서 발견, 함께 수정).
  const grossProfit = revenue - cogs;
  const opex = 0; // TODO: pl-opex claim 발행 경로가 생기면 여기 합산
  const netIncome = grossProfit - opex;

  const plPatch = {
    'pl-revenue':      String(revenue),
    'pl-cogs':          String(cogs),
    'pl-gross-profit':  String(grossProfit),
    'pl-opex':          String(opex),
    'pl-net-income':    String(netIncome),
  };

  // L1 profiles.extra.fs.pl PATCH — 유일한 쓰기 대상(Supabase 미사용).
  const profile = await _l1FindProfileByGuid(env, guid);
  if (!profile) return _err(404, 'PROFILE_NOT_FOUND', 'L1에 프로필이 없습니다', corsHeaders);

  let l1Ok = false;
  try {
    const ex = profile.extra || {};
    ex.fs = ex.fs || {};
    ex.fs.pl = { ...(ex.fs.pl || {}), ...plPatch };
    await _l1PatchProfile(env, profile.id, { extra: ex });
    l1Ok = true;
  } catch (e) {
    console.warn('[GDC Settle] L1 PATCH 실패:', e.message);
    return _err(502, 'L1_PATCH_FAILED', 'L1 재무제표 갱신 실패: ' + e.message, corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true,
    pl: { revenue, cogs, gross_profit: grossProfit, opex, net_income: netIncome },
    truncated,
    l1_updated: l1Ok,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-14 신설 — GET /biz/financials. Supabase user_profiles를 더
// 이상 쓰지 않기로 하면서(위 handleSettleLedger 참고), gdc-core.js의
// getBalance()/getFinancials()가 재무제표(pl+bs)를 읽어올 곳이 필요해
// 신설했다. /biz/claims와 동일한 서명+TOFU 인증 원칙을 그대로 쓴다 —
// guid만 자기주장하면 남의 잔액·매출을 조회할 수 있는 걸 막는다.
// ═══════════════════════════════════════════════════════════
async function handleFinancialsGet(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid      = url.searchParams.get('guid');
  const pubkey    = url.searchParams.get('pubkey');
  const signature = url.searchParams.get('signature');
  const ts        = url.searchParams.get('ts') || '';
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `financials:${guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const profile = await _l1FindProfileByGuid(env, guid).catch(() => null);
  if (!profile) return _err(404, 'PROFILE_NOT_FOUND', 'L1에 프로필이 없습니다', corsHeaders);

  const fs = profile.extra?.fs || {};
  return new Response(JSON.stringify({ ok: true, fs }), {
    status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

// ═══════════════════════════════════════════════════════════
// 2026-07-14 신설 — GET /biz/tx-history. GDC(gdc 레포) webapp.html의
// 홈 화면 "최근 거래" 목록(home-ledger)이 지금까지 Supabase fs_ledger를
// 직접 읽고 있었는데, doTransfer()가 L1 /biz/order로 재작성되면서 더는
// 그 테이블에 쓰지 않게 됐다(fix2.py 참고) — 그 목록이 채워질 곳이
// 필요해서 신설한다. /biz/financials와 동일한 서명+TOFU 인증 원칙.
//
// L1에는 거래내역 전용 인덱스가 없다(computeBalance와 동일한 한계 —
// main.pb.js 상단 주석 "규모가 커지면 스냅샷+증분 방식 필요" 참고).
// 지금 규모(개발 단계)에서는 최근 blocks를 넓게 가져와 이 guid가
// buyer_guid이거나 outputs의 recipient_guid인 것만 JS에서 추려내는
// 방식으로 충분하다 — 다만 이 guid의 거래가 "최근 스캔 범위" 밖에
// 있으면(즉 다른 사용자들의 거래가 그 사이에 아주 많았으면) 누락될 수
// 있다는 걸 명시한다(truncated 플래그로 알림).
// ═══════════════════════════════════════════════════════════
async function handleTxHistory(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid      = url.searchParams.get('guid');
  const pubkey    = url.searchParams.get('pubkey');
  const signature = url.searchParams.get('signature');
  const ts        = url.searchParams.get('ts') || '';
  const limit     = Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), 50);
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const authOk = await _verifyClaimsRequester(env, {
    guid, pubkey, signature, ts, sigMsg: `tx-history:${guid}:${pubkey}:${ts}`,
  });
  if (!authOk) return _err(403, 'AUTH_REQUIRED', '본인 서명 인증이 필요합니다', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': `Bearer ${token}` };

  // 최신순으로 최대 5페이지(1,000건)까지만 스캔 — handleSettleLedger의
  // MAX_PAGES 안전판과 동일한 관례. 그 안에서 limit개를 채우면 조기 종료.
  const PER_PAGE = 200, MAX_PAGES = 5;
  const items = [];
  let page = 1, truncated = false, scanned = 0;
  try {
    while (page <= MAX_PAGES && items.length < limit) {
      const filter = encodeURIComponent(`block_type != ''`);
      const res = await fetch(
        `${L1_DEFAULT}/api/collections/blocks/records?filter=${filter}&sort=-created&page=${page}&perPage=${PER_PAGE}`,
        { headers }
      );
      if (!res.ok) return _err(502, 'L1_UNREACHABLE', '거래내역 조회 실패', corsHeaders);
      const data = await res.json().catch(() => ({ items: [], totalPages: 0 }));
      const blocks = data.items || [];
      scanned += blocks.length;

      for (const b of blocks) {
        let outputs;
        try { outputs = JSON.parse(b.outputs || '[]'); } catch { continue; }
        const isBuyer = b.buyer_guid === guid;
        const recipientOutput = outputs.find(o => o.recipient_guid === guid);
        if (!isBuyer && !recipientOutput) continue;

        if (isBuyer) {
          // 이 guid가 지불자 — outputs 각각을 개별 차변 항목으로 표시
          // (예: 판매자 몫 + 플랫폼 수수료를 따로 보여줌).
          for (const o of outputs) {
            items.push({
              tx_hash: b.tx_hash, block_type: b.block_type, direction: 'debit',
              counterpart: o.recipient_guid || null, amount: o.amount || 0,
              memo: o.memo || o.service_id || b.block_type,
              created: b.created,
            });
          }
        } else if (recipientOutput) {
          items.push({
            tx_hash: b.tx_hash, block_type: b.block_type, direction: 'credit',
            counterpart: b.buyer_guid || null, amount: recipientOutput.amount || 0,
            memo: recipientOutput.memo || recipientOutput.service_id || b.block_type,
            created: b.created,
          });
        }
      }
      if (page >= (data.totalPages || 1)) break;
      page++;
    }
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (page > MAX_PAGES) {
    truncated = true;
    console.warn('[TxHistory] 스캔 페이지 상한 도달 — 일부만 조회됨:', guid);
  }

  items.sort((a, b) => new Date(b.created) - new Date(a.created));
  return new Response(JSON.stringify({
    ok: true, items: items.slice(0, limit), truncated, scanned,
  }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

// POST /biz/catalog/sync — 로컬 IndexedDB 전체 스냅샷을 서버 백업/공개미러에 반영
async function handleCatalogSync(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, pubkey, signature, products, industry_fields, mode, deleted_names } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);
  if (!Array.isArray(products)) return _err(400, 'MISSING_FIELD', 'products 배열 필수(빈 배열 허용)', corsHeaders);
  // 2026-07-07: mode 검증 — 잘못된 값이면 안전한 쪽(merge, 삭제 없음)으로 폴백하지
  // 않고 명시적으로 거부한다. 'replace'의 삭제 동작은 되돌릴 수 없으므로, 오탈자로
  // 인한 의도치 않은 replace를 막기 위해 화이트리스트 밖 값은 에러로 처리한다.
  const syncMode = mode || 'replace';
  if (!['replace', 'merge'].includes(syncMode)) {
    return _err(400, 'INVALID_MODE', `mode는 replace 또는 merge만 허용됩니다: ${JSON.stringify(mode)}`, corsHeaders);
  }

  // 2026-07-05: 업종은 키워드 매칭이나 별도 분류용 API 호출로 이 함수가
  // 직접 "결정"하지 않는다 — "모든 사용자는 나만의 AI비서를 정의한다"는
  // 설계 원칙에 따라, 판매자와 대화하며 상품을 등록시킨 그 AI비서
  // (SP-MKT_seller_site 등)가 이미 판단해서 industry_fields.schema_id로
  // 실어 보낸다. 이 함수는 그 판단을 검증(화이트리스트)하고 저장만 한다
  // — 다른 모든 도메인에서 "판단은 호출한 쪽 AI가, 백엔드는 검증·저장만"
  // 하는 패턴과 동일하다.
  // 2026-07-07 수정(사고실험 #3): 이전엔 schema_id 형식이 안 맞으면 상품
  // 동기화 요청 전체를 400으로 거부했다 — 코드 주석은 "그 필드만 무시하고
  // 계속 진행된다"고 돼 있었는데 실제 동작과 달랐다(설명 오류). PA SP가
  // 정확한 형식(숫자 2자리 문자열)을 강제받은 적이 없어 형식 불일치가
  // 흔히 발생할 수 있는데, 그 때문에 정상 상품 동기화 자체가 막히는 건
  // 손해가 더 크다. 이제 실제로 주석대로 동작하도록 고친다 — 형식이
  // 안 맞으면 이 필드만 버리고(업종 판단은 아래 keyword_fallback에 위임),
  // 상품 동기화는 계속 진행한다.
  let industryFieldsValid = null;
  if (industry_fields != null) {
    const sid = industry_fields.schema_id;
    if (sid && VALID_INDUSTRY_SCHEMA_IDS.has(String(sid))) {
      industryFieldsValid = { schema_id: String(sid) };
    } else {
      console.warn('[Catalog] industry_fields.schema_id 무효, 무시:', JSON.stringify(sid));
    }
  }

  // TOFU: L1에 이미 등록된 pubkey와 일치해야 함 — /profile 가입이 선행돼야 함
  let l1Record;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!l1Record) return _err(404, 'PROFILE_NOT_FOUND', '프로필 등록이 먼저 필요합니다', corsHeaders);
  if (l1Record.pubkey_ed25519 && l1Record.pubkey_ed25519 !== pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 이 계정에 등록된 키와 일치하지 않습니다', corsHeaders);
  }

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  // 상품 스키마 최소 검증 — RULE-01급 원칙(허위/불완전 데이터로 검색 오염 방지).
  // 2026-07-07 수정(사고실험 #2): 이전엔 배열 중 하나라도 id/name이 없으면
  // 요청 전체를 400으로 거부했다 — 상품 여러 개 중 하나가 이름 없이 왔다고
  // (LLM 환각 등) 나머지 정상 상품까지 전부 버려지는 건 손해가 크다.
  // 이제 무효한 항목만 걸러내고 유효한 것만 동기화한다. 걸러진 항목은
  // 응답의 skipped에 실어 클라이언트가 알 수 있게 한다. 원본이 비어있지
  // 않은데 전부 걸러졌으면(=완전히 잘못된 요청) 여전히 에러로 처리한다.
  const validProducts = products.filter(p => p && p.id && p.name);
  const skippedCount = products.length - validProducts.length;
  if (skippedCount > 0) {
    console.warn(`[Catalog] id/name 누락 상품 ${skippedCount}개 제외:`,
      products.filter(p => !p || !p.id || !p.name).slice(0, 3).map(p => JSON.stringify(p).slice(0, 100)));
  }
  if (products.length > 0 && validProducts.length === 0) {
    return _err(400, 'INVALID_PRODUCT', '유효한 상품이 하나도 없습니다(모두 id/name 누락)', corsHeaders);
  }

  try {
    await _l1SyncSellerProducts(env, guid, validProducts, syncMode, deleted_names);
  } catch (e) {
    return _err(502, 'L1_SYNC_FAILED', '카탈로그 동기화 실패: ' + e.message, corsHeaders);
  }

  // 업종 갱신 — 1순위: AI비서가 보낸 industry_fields(검증됨). 2순위(폴백):
  // AI비서를 안 거친 구버전 클라이언트를 위해 카테고리 키워드 매칭을
  // 최후 수단으로만 쓴다(정확도가 떨어짐을 알고 쓰는 안전망일 뿐,
  // 이걸로 이미 있는 AI비서 판단을 덮어쓰지 않는다).
  const derived = industryFieldsValid?.schema_id
    ? { schema_id: industryFieldsValid.schema_id, occupation: KSIC_LABELS[industryFieldsValid.schema_id] || null, source: 'agent' }
    : { ..._deriveOccupationFromCategories(validProducts.map(p => p.category)), source: 'keyword_fallback' };

  let occupationUpdated = false;
  if (derived?.schema_id) {
    try {
      const prevExtra = l1Record.extra || {};
      const newExtraPublic = {
        ...(prevExtra.public || {}),
        industry_fields: { schema_id: derived.schema_id, _source: derived.source, _updated_at: new Date().toISOString() },
      };
      await _l1UpsertProfile(env, {
        guid, handle: l1Record.handle, entityType: l1Record.entity_type, nativeLang: l1Record.native_lang,
        isPublic: l1Record.is_public, pubkey: l1Record.pubkey_ed25519,
        extra: { ...prevExtra, public: newExtraPublic },
        core: { ...(prevExtra.core || {}), occupation: derived.occupation },
      });
      // (2026-07-15: Supabase 병행 미러링 제거 — L1이 유일한 소스)
      occupationUpdated = true;
    } catch (e) {
      console.warn('[Catalog] 업종 갱신 실패(카탈로그 동기화 자체는 성공):', e.message);
    }
  }

  return new Response(JSON.stringify({
    ok: true, synced: validProducts.length, skipped: skippedCount, mode: syncMode,
    occupation: derived?.occupation || null, occupation_updated: occupationUpdated,
  }), { status: 200, headers: corsHeaders });
}

// GET /biz/catalog?guid=... — 공개 상품 목록 조회(구매자·K-Market 검색 전용)
// 항상 is_public=true인 상품만 반환한다 — 비공개 상품은 여기서 절대 노출되지 않는다.
async function handleCatalogGet(request, env, corsHeaders) {
  const url = new URL(request.url);
  const guid = url.searchParams.get('guid');
  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 쿼리 파라미터 필수', corsHeaders);

  let products;
  try {
    products = await _l1ListSellerProducts(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  // 2026-07-13 신설 — cost_price(매입원가)는 절대 공개 응답에 포함하지
  // 않는다. 원래 이 함수는 원본 레코드를 그대로(publicOnly) 반환하고
  // 있었는데, cost_price 필드가 새로 생기면서 그대로 두면 방문자 누구나
  // 사업자의 원가·마진을 그대로 볼 수 있는 상태가 될 뻔했다 — 명시적
  // 화이트리스트로 바꿔 필요한 필드만 내보낸다.
  const publicOnly = products
    .filter(p => p.is_public !== false)
    .map(p => ({
      id: p.id,
      product_id: p.product_id,
      name: p.name,
      desc: p.desc,
      price: p.price,
      unit: p.unit,
      category: p.category,
      stock: p.stock,
      stock_qty: p.stock_qty,
      image_url: p.image_url,
      is_public: p.is_public,
      updated_at: p.updated_at,
      // cost_price 의도적으로 제외
    }));
  return new Response(JSON.stringify({ ok: true, guid, products: publicOnly }), { status: 200, headers: corsHeaders });
}

// POST /biz/catalog/hydrate — 판매자 본인이 새 기기에서 로컬 IndexedDB를 처음
// 채울 때 쓰는 인증된 조회. 비공개 상품을 포함한 전체 목록을 서명 검증 후 반환한다
// (오픈해시 원칙: 로컬이 원본이지만, 기기를 새로 시작할 땐 서버 백업에서
// 복원해야 하므로 이 엔드포인트가 그 유일한 합법적 경로다).
async function handleCatalogHydrate(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  let l1Record;
  try {
    l1Record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!l1Record) return _err(404, 'PROFILE_NOT_FOUND', '프로필이 없습니다', corsHeaders);
  if (l1Record.pubkey_ed25519 && l1Record.pubkey_ed25519 !== pubkey) {
    return _err(403, 'PUBKEY_MISMATCH', '공개키가 이 계정에 등록된 키와 일치하지 않습니다', corsHeaders);
  }
  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  let products;
  try {
    products = await _l1ListSellerProducts(env, guid);
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  return new Response(JSON.stringify({ ok: true, guid, products }), { status: 200, headers: corsHeaders });
}


// /ai-setup POST — AI 비서 설정 저장 (API 키 AES-256-GCM 암호화)
// ═══════════════════════════════════════════════════════════
async function handleAiSetupPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  // v5.1: Ed25519 서명 인증 + TOFU
  const { guid, pubkey, signature } = body;
  if (!guid)      return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!pubkey)    return _err(400, 'MISSING_FIELD', 'pubkey 필수', corsHeaders);
  if (!signature) return _err(400, 'MISSING_FIELD', 'signature 필수', corsHeaders);

  const sigOk = await _verifyEd25519(pubkey, signature, body);
  if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);

  // TOFU: L1이 중심 저장소 — Supabase가 아닌 L1 profiles에서 Ed25519 공개키 확인
  {
    let l1Record;
    try {
      l1Record = await _l1FindProfileByGuid(env, guid);
    } catch (e) {
      return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
    }
    if (!l1Record) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);
    const existingPubkey = l1Record.pubkey_ed25519;
    if (existingPubkey && existingPubkey !== pubkey) {
      return _err(401, 'PUBKEY_MISMATCH', '등록된 공개키와 일치하지 않습니다', corsHeaders);
    }
  }

  const {
    provider = 'deepseek', model = 'deepseek-v4-flash',
    ai_active = false, api_key,
    custom_prompt = '', welcome_message = '',
    off_hours_message = '', endpoint = '',
  } = body;

  // provider는 워커가 직접 호출하지 않고 단순히 DB 컬럼에 저장되는 값일 뿐이며,
  // 실제 LLM 호출은 클라이언트가 config.js의 PROVIDER_INFO(baseUrl)를 보고 수행한다.
  // 워커에 하드코딩된 화이트리스트는 클라이언트가 새 provider를 추가할 때마다
  // 같이 갱신해야 해서 동기화가 깨지기 쉽다(오늘 'gemini' 누락이 그 사례).
  // 완전히 검증을 없애는 대신, 형식만 확인해 오타/이상값 유입만 방지한다.
  if (!/^[a-z0-9-]{2,30}$/.test(provider))
    return _err(400, 'INVALID_PROVIDER', 'provider는 영문 소문자/숫자/하이픈 2~30자여야 합니다', corsHeaders);

  // (2026-07-14: Supabase user_llm_keys → L1 이관. PocketBase는
  //  on_conflict 벌크 upsert가 없어 "guid로 조회 → 있으면 PATCH,
  //  없으면 CREATE" 패턴을 직접 구현한다 — charge_requests/register-key
  //  류와 동일 관례.)
  const token = await _l1AdminToken(env);
  const l1Headers = { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' };
  const filter = encodeURIComponent(`guid='${String(guid).replace(/'/g, "\\'")}'`);
  const existingRes = await fetch(
    `${L1_DEFAULT}/api/collections/user_llm_keys/records?filter=${filter}&perPage=1`,
    { headers: l1Headers }
  ).catch(() => null);
  const existingData = existingRes?.ok ? await existingRes.json().catch(() => ({ items: [] })) : { items: [] };
  const existingRow = (existingData.items || [])[0] || null;

  let apiKeyEnc = existingRow?.api_key_enc || null;

  if (api_key && api_key.trim()) {
    if (!env.AES_ENCRYPTION_KEY)
      return _err(500, 'ENCRYPTION_KEY_MISSING', 'AES 키 미설정', corsHeaders);
    apiKeyEnc = await _aesEncrypt(api_key.trim(), env.AES_ENCRYPTION_KEY);
  }

  if (!apiKeyEnc)
    return _err(400, 'API_KEY_REQUIRED', 'API 키를 입력해 주세요', corsHeaders);

  const tokenEst = Math.ceil(custom_prompt.length / 3.5);

  const payload = {
    guid, provider, model, api_key_enc: apiKeyEnc,
    ai_active, custom_prompt,
    native_lang: 'ko',
    ...(endpoint && { endpoint }),
  };

  let upsertRes;
  try {
    upsertRes = existingRow
      ? await fetch(`${L1_DEFAULT}/api/collections/user_llm_keys/records/${existingRow.id}`, {
          method: 'PATCH', headers: l1Headers, body: JSON.stringify(payload),
        })
      : await fetch(`${L1_DEFAULT}/api/collections/user_llm_keys/records`, {
          method: 'POST', headers: l1Headers, body: JSON.stringify(payload),
        });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }

  if (!upsertRes.ok) {
    const err = await upsertRes.text();
    return _err(500, 'SAVE_FAILED', err, corsHeaders);
  }

  return new Response(JSON.stringify({
    ok: true, ai_active, provider, model,
    token_est: tokenEst,
    token_warn: tokenEst > 800,
    message: tokenEst > 800
      ? `저장 완료. 프롬프트가 약 ${tokenEst} 토큰으로 비용이 증가할 수 있습니다.`
      : '저장 완료',
  }), { status: 200, headers: corsHeaders });
}

// AES-256-GCM 암호화
async function _aesEncrypt(plaintext, keyHex) {
  const key = await crypto.subtle.importKey(
    'raw', _hexToBytes(keyHex), { name: 'AES-GCM' }, false, ['encrypt']
  );
  const iv  = crypto.getRandomValues(new Uint8Array(12));
  const enc = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key,
    new TextEncoder().encode(plaintext));
  const combined = new Uint8Array(12 + enc.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(enc), 12);
  return btoa(String.fromCharCode(...combined));
}

function _hexToBytes(hex) {
  return new Uint8Array(hex.match(/.{2}/g).map(h => parseInt(h, 16)));
}

async function anchorL1MerkleRoot(env) {
  try {
    const token = await _l1AdminToken(env);
    const headers = { 'Authorization': 'Bearer ' + token };

    // 1. 미앵커링 pdv_records 조회 (최대 100건, 오래된 순)
    // (2026-07-14: Supabase pdv_log → L1 pdv_records 이관. 이 쿼리가
    //  이미 openhash_anchored=false로 걸러주므로, l1_ledger/node_ledger
    //  Merkle 버그(전체 재계산)가 여기엔 애초에 없다 — 배치가 자연히
    //  분리된다.)
    const filter = encodeURIComponent("openhash_anchored = false");
    const listRes = await fetch(
      `${L1_DEFAULT}/api/collections/pdv_records/records?filter=${filter}&sort=created&perPage=100`,
      { headers }
    );
    if (!listRes.ok) { console.warn('[Merkle] pdv_records 조회 실패:', listRes.status); return; }
    const listData = await listRes.json().catch(() => ({ items: [] }));
    const rows = listData.items || [];
    if (!rows.length) {
      console.log('[Merkle] 미앵커링 pdv_records 없음 — 스킵');
      return;
    }

    // 2. 머클 트리 계산
    // (chain_local_hash는 Supabase 전용 필드라 pdv_records엔 없다 —
    //  block_hash(있으면) 또는 id를 leaf로 쓴다. 기존 폴백 순서와 동일.)
    const leaves = rows.map(r => r.block_hash || r.id);
    const merkleRoot = await _computeMerkleRoot(leaves);
    const pdvIds     = rows.map(r => r.id);
    const now        = new Date().toISOString();

    // 3. pdv_merkle_anchors INSERT
    const insRes = await fetch(`${L1_DEFAULT}/api/collections/pdv_merkle_anchors/records`, {
      method:  'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        merkle_root: merkleRoot, anchored_at: now,
        block_count: rows.length, pdv_ids: JSON.stringify(pdvIds), status: 'confirmed',
      }),
    });
    const insResult = await insRes.json().catch(() => null);
    const anchorId   = insResult?.id || null;

    // 4. pdv_records openhash_anchored = true 일괄 갱신
    // (PocketBase REST는 Supabase의 IN 조건 배치 업데이트가 없어 개별 PATCH)
    for (const id of pdvIds) {
      await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records/${id}`, {
        method: 'PATCH', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ openhash_anchored: true }),
      }).catch(() => {});
    }

    console.log(`[Merkle] 앵커링 완료 | root=${merkleRoot.slice(0,8)} | count=${rows.length} | anchor_id=${anchorId}`);
  } catch(e) {
    console.error('[Merkle] anchorL1MerkleRoot 실패:', e.message);
  }
}

/**
 * 머클 트리 루트 계산
 * leaves: string[] (hash 또는 id)
 * 홀수 노드: 마지막 leaf 복제
 */
async function _computeMerkleRoot(leaves) {
  if (!leaves.length) return '0'.repeat(64);

  // leaf 해시화
  let nodes = await Promise.all(
    leaves.map(l => _sha256Hex(l))
  );

  while (nodes.length > 1) {
    const next = [];
    for (let i = 0; i < nodes.length; i += 2) {
      const left  = nodes[i];
      const right = nodes[i + 1] || nodes[i]; // 홀수 시 복제
      next.push(await _sha256Hex(left + right));
    }
    nodes = next;
  }
  return nodes[0];
}

/**
 * verifyWithMerkle 검증용 API
 * GET /merkle/verify?pdv_id={id}
 */
async function handleMerkleVerify(request, env, corsHeaders) {
  const url   = new URL(request.url);
  const pdvId = url.searchParams.get('pdv_id');
  if (!pdvId) return _err(400, 'MISSING_PARAM', 'pdv_id 필수', corsHeaders);

  const token = await _l1AdminToken(env);
  const headers = { 'Authorization': 'Bearer ' + token };

  // pdv_records 조회
  const pdvRes = await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records/${pdvId}`, { headers });
  if (!pdvRes.ok) return _err(404, 'PDV_NOT_FOUND', 'pdv_records 없음', corsHeaders);
  const pdv = await pdvRes.json();

  if (!pdv.openhash_anchored) {
    return new Response(JSON.stringify({
      valid: false,
      reason: 'NOT_ANCHORED',
      pdv_id: pdvId,
    }), { status: 200, headers: corsHeaders });
  }

  // pdv_merkle_anchors에서 해당 pdv_id를 포함한 레코드 조회.
  // (2026-07-14: pdv_ids를 JSON.stringify한 텍스트 필드로 저장하고 있어
  //  PocketBase 필터로 "배열이 이 값을 포함하는지"를 직접 조회할 수 없다
  //  — 이 코드베이스 전반의 관례(P12 필터 버그 회피)와 동일하게, 최근
  //  배치(최대 500개, anchorL1MerkleRoot가 10분마다 하나씩 추가하므로
  //  약 3일치)를 넓게 가져와 JS에서 JSON.parse 후 includes로 찾는다.)
  const anchorListRes = await fetch(
    `${L1_DEFAULT}/api/collections/pdv_merkle_anchors/records?sort=-anchored_at&perPage=500`,
    { headers }
  );
  if (!anchorListRes.ok) return _err(502, 'L1_UNREACHABLE', '앵커 목록 조회 실패', corsHeaders);
  const anchorListData = await anchorListRes.json().catch(() => ({ items: [] }));
  const anchor = (anchorListData.items || []).find(a => {
    try { return JSON.parse(a.pdv_ids || '[]').includes(pdvId); } catch { return false; }
  });
  if (!anchor) {
    return new Response(JSON.stringify({
      valid: false,
      reason: 'ANCHOR_NOT_FOUND',
      pdv_id: pdvId,
    }), { status: 200, headers: corsHeaders });
  }

  // 머클 루트 재계산으로 검증
  const leaves = JSON.parse(anchor.pdv_ids || '[]');
  const recomputed = await _computeMerkleRoot(
    await Promise.all(leaves.map(async id => {
      const r = await fetch(`${L1_DEFAULT}/api/collections/pdv_records/records/${id}`, { headers });
      if (!r.ok) return id; // 이미 지워졌거나 조회 실패 — anchorL1MerkleRoot가 저장할 때와 동일 폴백(id 자체)
      const row = await r.json().catch(() => null);
      return row?.block_hash || id;
    }))
  );

  const valid = recomputed === anchor.merkle_root;

  return new Response(JSON.stringify({
    valid,
    pdv_id:      pdvId,
    merkle_root: anchor.merkle_root,
    recomputed,
    anchor_id:   anchor.id,
    anchored_at: anchor.anchored_at,
    block_count: anchor.block_count,
  }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// Push 알림 — VAPID Web Push
// ═══════════════════════════════════════════════════════════

// GET /push/vapid-public-key
function handlePushVapidKey(request, env, corsHeaders) {
  const key = env.VAPID_PUBLIC_KEY;
  if (!key) return _err(500, 'CONFIG_ERROR', 'VAPID_PUBLIC_KEY 미설정', corsHeaders);
  return new Response(JSON.stringify({ publicKey: key }), { status: 200, headers: corsHeaders });
}

// POST /push/broadcast — 배포 스크립트가 호출. 활성 구독자 전체에게
// "새 버전이 있습니다" push 전송 → sw.js가 CHECK_FOR_UPDATE를 클라이언트에 전달
// → 포그라운드 30분 폴링을 기다리지 않고 즉시 업데이트 체크.
// 관리자(배포자) 전용 — 평소 polling 부하는 그대로, 배포 시점에만 1회 발생.
async function handlePushBroadcast(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.secret || body.secret !== env.DEPLOY_PUSH_SECRET)
    return _err(403, 'FORBIDDEN', '시크릿이 일치하지 않습니다', corsHeaders);

  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT)
    return _err(500, 'CONFIG_ERROR', 'VAPID 환경변수 미설정', corsHeaders);

  let rows;
  try { rows = await _l1ListPushSubscribers(env); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 조회 실패: ' + e.message, corsHeaders); }

  const payload = JSON.stringify({
    title: body.title || '고팡 업데이트',
    body:  body.body  || '새 버전이 준비됐습니다.',
    tag:   'gopang-version-update',
    url:   body.url   || '/webapp.html',
  });

  let sent = 0, failed = 0;
  for (const row of rows) {
    try {
      const sub = JSON.parse(row.push_subscription);
      const ok = await _sendWebPush(env, sub, payload);
      if (ok) sent++; else failed++;
    } catch (e) {
      failed++;
    }
  }
  return new Response(JSON.stringify({ ok: true, total: rows.length, sent, failed }), { status: 200, headers: corsHeaders });
}

// POST /push/subscribe — 구독 정보 저장
async function handlePushSubscribe(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.guid)
    return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  // unsubscribe는 subscription 없어도 허용
  if (!body.unsubscribe && !body.subscription)
    return _err(400, 'MISSING_FIELD', 'subscription 필수', corsHeaders);

  let record;
  try { record = await _l1FindProfileByGuid(env, body.guid); }
  catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders); }
  if (!record) return _err(404, 'PROFILE_NOT_FOUND', '가입(L1 등록)이 먼저 완료되어야 합니다', corsHeaders);

  // 구독 취소: L1 row는 삭제 불가 → 빈 문자열로 PATCH
  if (body.unsubscribe) {
    try { await _l1PatchProfile(env, record.id, { push_subscription: '', push_sound: '' }); }
    catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 PATCH 실패: ' + e.message, corsHeaders); }
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  }

  // 구독 등록/갱신: 프로필 row는 가입 시 이미 존재 → 항상 PATCH
  try {
    await _l1PatchProfile(env, record.id, {
      push_subscription: JSON.stringify(body.subscription),
      push_sound:        body.sound || 'ping',
    });
  } catch (e) { return _err(502, 'L1_UNREACHABLE', 'L1 PATCH 실패: ' + e.message, corsHeaders); }
  return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
}

// (2026-07-14 삭제 — Supabase 폐기 지시. _backupPushSubscriptionToSupabase는
//  L1 쓰기 완료 후 Supabase에 best-effort로 미러링만 하던 백업용 함수였다
//  — 원래도 "메인 흐름은 L1만으로 완결"이라고 스스로 명시하고 있었으니,
//  Supabase 자체를 없애는 지금 삭제해도 기능 손실이 없다.)
async function handlePushSend(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body?.to_guid) return _err(400, 'MISSING_FIELD', 'to_guid 필수', corsHeaders);

  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY || !env.VAPID_SUBJECT)
    return _err(500, 'CONFIG_ERROR', 'VAPID 환경변수 미설정', corsHeaders);

  let rows = [];
  const source = 'l1';
  try {
    const record = await _l1FindProfileByGuid(env, body.to_guid);
    if (record?.push_subscription) {
      rows = [{ subscription: record.push_subscription, sound: record.push_sound }];
    }
  } catch (e) {
    // (2026-07-14: Supabase 백업 폴백 제거 — L1 연결 실패는 그대로 실패로
    //  처리한다. 재시도는 호출부(클라이언트) 책임.)
    console.warn('[Push] L1 조회 실패:', e.message);
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }

  if (!rows.length) return new Response(JSON.stringify({ ok: true, sent: 0, reason: 'NO_SUBSCRIPTION', source }), { status: 200, headers: corsHeaders });

  const payload = JSON.stringify({
    title: body.title || '고팡',
    body:  body.body  || '새 메시지가 도착했습니다.',
    sound: rows[0].sound || body.sound || 'ping',
    url:   body.url   || '/webapp.html',
    tag:   body.tag   || 'gopang-msg',
  });

  let sent = 0;
  for (const row of rows) {
    try {
      const sub = JSON.parse(row.subscription);
      const result = await _sendWebPush(env, sub, payload);
      if (result) sent++;
    } catch(e) {
      console.warn('[Push] 전송 실패:', e.message);
    }
  }
  return new Response(JSON.stringify({ ok: true, sent, source }), { status: 200, headers: corsHeaders });
}

// Web Push 전송 (VAPID)
// ── Web Push 페이로드 암호화 (RFC 8291 aes128gcm) ──────────────
// 브라우저 푸시 서비스(FCM 등)는 암호화되지 않은 페이로드를 사양 위반으로
// 거부한다 — 이 암호화 없이는 구독·VAPID가 다 정상이어도 실제 발송이
// 매번 조용히 실패한다(닫힌 상태에서 알림이 아예 안 오던 근본 원인).
function _concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) { out.set(a, offset); offset += a.length; }
  return out;
}

async function _hmacSha256(keyBytes, data) {
  const key = await crypto.subtle.importKey(
    'raw', keyBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, data));
}

async function _encryptWebPushPayload(payloadStr, p256dhB64u, authB64u) {
  const ua_public   = _b64uToBytes(p256dhB64u);   // 65바이트 비압축 EC 포인트(구독자)
  const auth_secret = _b64uToBytes(authB64u);     // 16바이트

  // 1) 발신 서버용 임시(message마다 새로) ECDH 키쌍
  const asKeyPair = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const as_public = new Uint8Array(await crypto.subtle.exportKey('raw', asKeyPair.publicKey));

  // 2) 구독자 공개키 import + ECDH 공유 비밀
  const uaPublicKey = await crypto.subtle.importKey(
    'raw', ua_public, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const ecdhSecret = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: uaPublicKey }, asKeyPair.privateKey, 256
  ));

  // 3) HKDF 1단계 — auth_secret을 salt로 PRK_key 도출 → IKM' 도출
  const keyInfo = _concatBytes(
    new TextEncoder().encode('WebPush: info\0'), ua_public, as_public
  );
  const prkKey = await _hmacSha256(auth_secret, ecdhSecret);
  const ikm    = (await _hmacSha256(prkKey, _concatBytes(keyInfo, new Uint8Array([1])))).slice(0, 32);

  // 4) 메시지별 salt(16바이트 랜덤) + HKDF 2단계 — CEK, NONCE 도출
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const prk  = await _hmacSha256(salt, ikm);

  const cekInfo = new TextEncoder().encode('Content-Encoding: aes128gcm\0');
  const cek = (await _hmacSha256(prk, _concatBytes(cekInfo, new Uint8Array([1])))).slice(0, 16);

  const nonceInfo = new TextEncoder().encode('Content-Encoding: nonce\0');
  const nonce = (await _hmacSha256(prk, _concatBytes(nonceInfo, new Uint8Array([1])))).slice(0, 12);

  // 5) 평문 + 레코드 구분자(0x02, 단일 레코드라 패딩 없음) + AES-128-GCM
  const plaintext  = new TextEncoder().encode(payloadStr);
  const padded     = _concatBytes(plaintext, new Uint8Array([2]));
  const cekKey     = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, cekKey, padded
  ));

  // 6) RFC 8188 aes128gcm 본문 헤더: salt(16) | rs(4, big-endian) | idlen(1) | keyid(as_public)
  // rs는 레코드 크기 상한값 — 단일 레코드이므로 고정값 4096이면 충분(웹푸시 페이로드는 항상 작음)
  const recordSize = new Uint8Array(4);
  new DataView(recordSize.buffer).setUint32(0, 4096, false);
  const header = _concatBytes(salt, recordSize, new Uint8Array([as_public.length]), as_public);

  return _concatBytes(header, ciphertext);
}

async function _sendWebPush(env, subscription, payload) {
  const p256dh = subscription.keys?.p256dh;
  const auth   = subscription.keys?.auth;
  if (!p256dh || !auth) {
    console.warn('[Push] 구독에 p256dh/auth 없음 — 암호화 불가, 발송 건너뜀');
    return false;
  }

  const body = await _encryptWebPushPayload(payload, p256dh, auth);
  const vapidHeaders = await _buildVapidHeaders(env, subscription.endpoint);

  const res = await fetch(subscription.endpoint, {
    method:  'POST',
    headers: {
      ...vapidHeaders,
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'Content-Length':   body.length.toString(),
      'TTL': '60',
    },
    body,
  });
  const ok = res.ok || res.status === 201;
  if (ok) {
    console.info('[Push] 발송 성공:', res.status, subscription.endpoint?.slice(0, 60));
  } else {
    console.warn('[Push] 발송 실패:', res.status, await res.text().catch(() => ''));
  }
  return ok;
}

// VAPID JWT 생성
async function _buildVapidHeaders(env, endpoint) {
  const url      = new URL(endpoint);
  const audience = `${url.protocol}//${url.host}`;
  const now      = Math.floor(Date.now() / 1000);

  const header  = _b64uEncode(JSON.stringify({ alg: 'ES256', typ: 'JWT' }));
  const claims  = _b64uEncode(JSON.stringify({ aud: audience, exp: now + 3600, sub: env.VAPID_SUBJECT }));
  const sigInput = `${header}.${claims}`;

  // ECDSA 개인키는 WebCrypto 'raw' import가 공개키 전용이라 지원되지 않는다.
  // VAPID_PUBLIC_KEY(65바이트 비압축 포인트)에서 x/y를 떼어 JWK로 조립해 import한다.
  const pubBytes = _b64uToBytes(env.VAPID_PUBLIC_KEY);
  const jwk = {
    kty: 'EC', crv: 'P-256', ext: true,
    d: env.VAPID_PRIVATE_KEY.replace(/=+$/, ''),
    x: _b64uEncode(pubBytes.slice(1, 33)),
    y: _b64uEncode(pubBytes.slice(33, 65)),
  };
  const cryptoKey = await crypto.subtle.importKey(
    'jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const sig    = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(sigInput));
  const sigB64 = _b64uEncode(String.fromCharCode(...new Uint8Array(sig)));
  const jwt    = `${sigInput}.${sigB64}`;

  return {
    'Authorization': `vapid t=${jwt}, k=${env.VAPID_PUBLIC_KEY}`,
  };
}

function _b64uEncode(str) {
  return btoa(typeof str === 'string' ? str : String.fromCharCode(...new Uint8Array(str)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

// ── Push 알림 전송 헬퍼 (guid 기준) ─────────────────────
async function _sendPushToGuid(env, guid, { title, body, tag, url }) {
  if (!env.VAPID_PRIVATE_KEY || !env.VAPID_PUBLIC_KEY) return;

  let record;
  try {
    record = await _l1FindProfileByGuid(env, guid);
  } catch (e) {
    console.warn('[Push] L1 조회 실패:', e.message);
    return;
  }
  if (!record?.push_subscription) {
    console.warn('[Push] push_subscription 없음 — 구독 안 된 계정, 발송 건너뜀. guid:', guid);
    return;
  }

  const payload = JSON.stringify({
    title, body, tag,
    sound: record.push_sound || 'ping',
    url:   url || '/webapp.html',
  });

  try {
    const sub = JSON.parse(record.push_subscription);
    console.info('[Push] 발송 시도:', guid, sub.endpoint?.slice(0, 50));
    await _sendWebPush(env, sub, payload);
  } catch(e) {
    console.warn('[Push] _sendPushToGuid 실패:', e.message);
  }
}

// ═══════════════════════════════════════════════════════════
// Feedback — 기능 제안
// ═══════════════════════════════════════════════════════════

// POST /feedback — 제안 등록 + DeepSeek 카테고리 분류
async function handleFeedbackPost(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { guid, handle, content } = body;
  if (!guid)    return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);
  if (!handle)  return _err(400, 'MISSING_FIELD', 'handle 필수', corsHeaders);
  if (!content) return _err(400, 'MISSING_FIELD', 'content 필수', corsHeaders);

  // DeepSeek v4 flash — 카테고리 자동 분류
  let category = 'etc';
  try {
    const _fbKey = env.OPENROUTER_API_KEY || env.DEEPSEEK_API_KEY;
    const _fbUrl = env.OPENROUTER_API_KEY ? OR_URL : DEEPSEEK_URL;
    const aiRes = await fetch(_fbUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${_fbKey}`,
                 ...(env.OPENROUTER_API_KEY ? {'HTTP-Referer':'https://hondi.net','X-Title':'Hondi'} : {}) },
      body: JSON.stringify({
        model: env.OPENROUTER_API_KEY ? OR_MODEL_FAST : 'deepseek/deepseek-r1:free',
        max_tokens: 10,
        messages: [
          { role: 'system', content: '사용자 제안을 bug/feature/ui/etc 중 하나로만 분류하라. 단어 하나만 출력.' },
          { role: 'user',   content },
        ],
      }),
    });
    const aiData = await aiRes.json();
    const raw = aiData.choices?.[0]?.message?.content?.trim().toLowerCase() || 'etc';
    if (['bug','feature','ui','etc'].includes(raw)) category = raw;
  } catch(e) {
    console.warn('[Feedback] AI 분류 실패:', e.message);
  }

  // (2026-07-15: Supabase feedback → L1 이관)
  const token = await _l1AdminToken(env);
  const insRes = await fetch(`${L1_DEFAULT}/api/collections/feedback/records`, {
    method:  'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ guid, handle, content, category, status: 'pending' }),
  });
  if (!insRes.ok) return _err(500, 'DB_ERROR', await insRes.text(), corsHeaders);
  const row = await insRes.json().catch(() => null);

  return new Response(JSON.stringify({ ok: true, id: row?.id, category }), { status: 200, headers: corsHeaders });
}

// GET /feedback — 목록 조회
async function handleFeedbackGet(request, env, corsHeaders) {
  const url    = new URL(request.url);
  const status = url.searchParams.get('status');
  const limit  = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100);

  const token = await _l1AdminToken(env);
  const filter = status ? `?filter=${encodeURIComponent(`status='${status}'`)}&sort=-created&perPage=${limit}` : `?sort=-created&perPage=${limit}`;
  const res  = await fetch(`${L1_DEFAULT}/api/collections/feedback/records${filter}`, { headers: { 'Authorization': 'Bearer ' + token } });
  const data = await res.json().catch(() => ({ items: [] }));
  const rows = data.items || [];
  return new Response(JSON.stringify({ ok: true, items: rows, count: rows.length }), { status: 200, headers: corsHeaders });
}

// PATCH /feedback/{id} — 상태 변경 (관리자 전용) + Push 알림
async function handleFeedbackPatch(request, env, corsHeaders) {
  const id   = new URL(request.url).pathname.replace('/feedback/', '');
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON body 필수', corsHeaders);

  const { status, admin_note, admin_guid } = body;
  if (!status)     return _err(400, 'MISSING_FIELD', 'status 필수', corsHeaders);
  if (!admin_guid) return _err(400, 'MISSING_FIELD', 'admin_guid 필수', corsHeaders);

  // 관리자 확인 (주피터 guid)
  const adminProfile = await _l1FindProfileByGuid(env, admin_guid).catch(() => null);
  if (!adminProfile || adminProfile.handle !== '@96627170')
    return _err(403, 'FORBIDDEN', '관리자만 상태를 변경할 수 있습니다', corsHeaders);

  // 상태 변경
  // (2026-07-15: Supabase feedback → L1 이관)
  const token = await _l1AdminToken(env);
  const patchRes = await fetch(`${L1_DEFAULT}/api/collections/feedback/records/${encodeURIComponent(id)}`, {
    method:  'PATCH',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status, admin_note: admin_note || null }),
  });
  if (!patchRes.ok) return _err(500, 'DB_ERROR', await patchRes.text(), corsHeaders);
  const item = await patchRes.json().catch(() => null);

  // 제안자에게 Push 알림
  const STATUS_LABEL = { pending: '검토 대기', reviewing: '검토중', accepted: '반영 확정', rejected: '보류' };
  if (item?.guid) {
    _sendPushToGuid(env, item.guid, {
      title: '제안 상태가 변경됐습니다',
      body:  `"${item.content?.slice(0, 30)}..." → ${STATUS_LABEL[status] || status}`,
      tag:   'gopang-feedback-' + id,
      url:   '/feedback.html',
    }).catch(e => console.warn('[Feedback Push]', e.message));
  }

  return new Response(JSON.stringify({ ok: true, item }), { status: 200, headers: corsHeaders });
}

// ═══════════════════════════════════════════════════════════
// Prompt Editor — 조회는 공개, 편집은 관리자 인증(L1 prompt_admins) + GitHub PR
//
// GET /prompt는 인증 없이 누구나 호출 가능 — System Prompt 원문은 일반인도
// 볼 수 있어야 한다는 요구사항. 인증은 POST /admin/prompt(저장)에만 걸린다.
//
// 인증: L1 PocketBase의 prompt_admins(Auth Collection)에 위임 — Worker는
//   비밀번호를 직접 검증하지 않고, PocketBase의
//   /api/collections/prompt_admins/auth-with-password 결과만 신뢰한다.
//   성공 시 Worker가 자체 admin 세션 토큰(HMAC-SHA256, ADMIN_MASTER_KEY로 서명)을
//   발급한다. 이 토큰은 쿠키가 아니라 Authorization: Bearer 헤더로 주고받는다 —
//   이 Worker는 커스텀 도메인(hondi.net) 라우트가 없는 *.workers.dev 인스턴스라
//   기존 buildCookie()처럼 Domain=.hondi.net 쿠키를 발급해도 브라우저가 도메인
//   불일치로 폐기한다. prompt-editor.html은 새 탭에서 열리는 독립 단일 페이지라
//   세션을 메모리에만 들고 있으면 충분하다(새로고침 시 재로그인 — 의도된 동작).
//
// 저장 대상 제한: prompts/ 디렉터리의 .txt 파일만 — 그 외 경로는 일괄 거부
// (worker.js 자체나 다른 파일을 덮어쓸 수 없도록 화이트리스트로 강제).
//
// 반영 방식: main 직접 커밋이 아니라 새 브랜치 + PR — 머지는 GitHub에서
// 사람이 검토 후 수동으로 진행한다(요청하신 "PR 생성 후 검토·머지" 워크플로).
//
// 필요 secret (wrangler secret put):
//   ADMIN_MASTER_KEY — admin 토큰 서명용 HMAC 키. GOPANG_MASTER_KEY와는
//                      별개 키를 쓴다(사용자 세션 토큰 위조 경로와 완전히 분리).
//   GITHUB_TOKEN     — Openhash-Gopang/gopang repo로 한정한 fine-grained PAT.
//                      권한: Contents (Read and write), Pull requests (Read and write).
//
// 필요 L1 PocketBase 설정 (Admin UI에서 1회 수동 작업):
//   Collections → New collection → name: prompt_admins → type: Auth
//   Options에서 Email/Password를 사용(Username/Password, OAuth2는 미사용이면 꺼두기) →
//   admin마다 레코드 1개씩 생성(email + password). 로그인 ID는 이메일 주소.
// ═══════════════════════════════════════════════════════════

function _isAllowedPromptPath(path) {
  if (typeof path !== 'string') return false;
  if (path.includes('..')) return false;
  return /^prompts\/[A-Za-z0-9_.-]+\.txt$/.test(path);
}

async function buildAdminToken(env, username) {
  if (!env.ADMIN_MASTER_KEY) throw new Error('ADMIN_MASTER_KEY secret 미설정');
  const now = Math.floor(Date.now() / 1000);
  const payload = { role: 'prompt_admin', admin: username, iat: now, exp: now + 1800 }; // 30분
  const b64p = btoa(JSON.stringify(payload)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const key  = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_MASTER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig  = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(b64p));
  const b64s = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${b64p}.${b64s}`;
}

async function parseAdminToken(env, token) {
  if (!env.ADMIN_MASTER_KEY) return null;
  try {
    const [b64p, b64s] = String(token).split('.');
    if (!b64p || !b64s) return null;
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.ADMIN_MASTER_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sigBytes = Uint8Array.from(atob(b64s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const sigOk = await crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(b64p));
    if (!sigOk) return null;
    const padded = b64p.replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '=='.slice((padded.length % 4) || 4)));
    if (payload.role !== 'prompt_admin') return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch { return null; }
}

async function _requireAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const m = auth.match(/^Bearer\s+(.+)$/i);
  if (!m) return null;
  return parseAdminToken(env, m[1]);
}

// POST /admin/login  body: { email, password }
async function handleAdminLogin(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  const email = body?.email?.trim();
  const password = body?.password;
  if (!email || !password) return _err(400, 'MISSING_FIELD', 'email, password 필수', corsHeaders);

  let authRes;
  try {
    authRes = await fetch(`${L1_DEFAULT}/api/collections/prompt_admins/auth-with-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: email, password }),
    });
  } catch (e) {
    return _err(502, 'L1_UNREACHABLE', 'L1 연결 실패: ' + e.message, corsHeaders);
  }
  if (!authRes.ok) return _err(401, 'INVALID_CREDENTIALS', '이메일 또는 비밀번호가 올바르지 않습니다', corsHeaders);

  const data = await authRes.json().catch(() => null);
  const adminName = data?.record?.email || data?.record?.username || email;
  const token = await buildAdminToken(env, adminName);
  const now = Math.floor(Date.now() / 1000);
  return new Response(JSON.stringify({ ok: true, admin: adminName, token, exp: now + 1800 }), { status: 200, headers: corsHeaders });
}

function _ghHeaders(env) {
  return {
    'Authorization':        `Bearer ${env.GITHUB_TOKEN}`,
    'Accept':                'application/vnd.github+json',
    'X-GitHub-Api-Version':  '2022-11-28',
    'User-Agent':             'gopang-prompt-editor',
  };
}

function _b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes  = Uint8Array.from(binary, c => c.charCodeAt(0));
  return new TextDecoder('utf-8').decode(bytes);
}

function _b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

async function _ghGetFile(env, path, ref = GITHUB_DEFAULT_BRANCH) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret 미설정');
  const url = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}/contents/${path}?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, { headers: _ghHeaders(env) });
  if (!res.ok) throw new Error(`GitHub 조회 실패 (HTTP ${res.status})`);
  const data = await res.json();
  return { content: _b64DecodeUtf8(data.content), sha: data.sha };
}

// 새 브랜치를 만들어 커밋하고 main으로의 PR을 생성한다 (직접 main 커밋 없음).
async function _ghCommitViaPR(env, path, newContent, baseSha, adminName, message) {
  if (!env.GITHUB_TOKEN) throw new Error('GITHUB_TOKEN secret 미설정');
  const headers  = _ghHeaders(env);
  const repoBase = `${GITHUB_API}/repos/${GITHUB_OWNER}/${GITHUB_REPO_NAME}`;

  const refRes = await fetch(`${repoBase}/git/ref/heads/${GITHUB_DEFAULT_BRANCH}`, { headers });
  if (!refRes.ok) throw new Error(`main ref 조회 실패 (HTTP ${refRes.status})`);
  const mainSha = (await refRes.json()).object.sha;

  const slug   = path.split('/').pop().replace(/\.[^.]+$/, '').toLowerCase();
  const branch = `prompt-edit/${slug}-${Date.now()}`;
  const createRefRes = await fetch(`${repoBase}/git/refs`, {
    method: 'POST', headers,
    body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: mainSha }),
  });
  if (!createRefRes.ok) throw new Error(`브랜치 생성 실패 (HTTP ${createRefRes.status})`);

  const putRes = await fetch(`${repoBase}/contents/${path}`, {
    method: 'PUT', headers,
    body: JSON.stringify({
      message: (message && message.trim()) || `prompt-editor: ${adminName}님이 ${path} 수정`,
      content: _b64EncodeUtf8(newContent),
      sha:     baseSha,
      branch,
      committer: { name: 'Gopang Prompt Editor', email: 'noreply@hondi.net' },
    }),
  });
  if (!putRes.ok) {
    if (putRes.status === 409 || putRes.status === 422) {
      throw new Error('충돌: 다른 곳에서 먼저 수정됐습니다. 새로고침 후 다시 시도하세요.');
    }
    const errBody = await putRes.text().catch(() => '');
    throw new Error(`커밋 실패 (HTTP ${putRes.status}): ${errBody.slice(0, 200)}`);
  }

  const prRes = await fetch(`${repoBase}/pulls`, {
    method: 'POST', headers,
    body: JSON.stringify({
      title: `[prompt-editor] ${path} 수정 (${adminName})`,
      head:  branch,
      base:  GITHUB_DEFAULT_BRANCH,
      body:  (message && message.trim()) || `관리자 \`${adminName}\`님이 Prompt Editor에서 직접 수정한 변경사항입니다.`,
    }),
  });
  if (!prRes.ok) throw new Error(`PR 생성 실패 (HTTP ${prRes.status})`);
  return (await prRes.json()).html_url;
}

// GET /prompt?file=prompts/SP-01_klaw_v1.0.txt — 공개. 누구나 System Prompt 원문을
// 조회할 수 있어야 한다(요청사항). 화이트리스트(prompts/*.txt)는 그대로 유지 —
// 어차피 GitHub repo 자체가 public이라 정보 노출 위험은 없고, 의도한 파일 범위만
// 이 엔드포인트로 받게 하기 위한 것. 수정(POST /admin/prompt)만 관리자 인증 필요.
async function handlePromptGet(request, env, corsHeaders) {
  const file = new URL(request.url).searchParams.get('file') || '';
  if (!_isAllowedPromptPath(file)) return _err(400, 'INVALID_FILE', '허용되지 않은 파일 경로', corsHeaders);

  try {
    const { content, sha } = await _ghGetFile(env, file);
    return new Response(JSON.stringify({ ok: true, file, content, sha }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'GITHUB_ERROR', e.message, corsHeaders);
  }
}

// POST /admin/prompt  body: { file, content, sha, message? }
async function handleAdminPromptSave(request, env, corsHeaders) {
  const admin = await _requireAdmin(request, env);
  if (!admin) return _err(401, 'UNAUTHORIZED', '관리자 인증이 필요합니다', corsHeaders);

  const body = await request.json().catch(() => null);
  const { file, content, sha, message } = body || {};
  if (!_isAllowedPromptPath(file)) return _err(400, 'INVALID_FILE', '허용되지 않은 파일 경로', corsHeaders);
  if (typeof content !== 'string' || !content.trim()) return _err(400, 'MISSING_FIELD', 'content 필수', corsHeaders);
  if (!sha) return _err(400, 'MISSING_FIELD', 'sha 필수 (충돌 감지용 — GET /prompt로 먼저 조회하세요)', corsHeaders);

  try {
    const prUrl = await _ghCommitViaPR(env, file, content, sha, admin.admin, message);
    return new Response(JSON.stringify({ ok: true, pr_url: prUrl }), { status: 200, headers: corsHeaders });
  } catch (e) {
    return _err(502, 'GITHUB_ERROR', e.message, corsHeaders);
  }
}


// ══════════════════════════════════════════════════════════════
// 디폴트 LLM 키 관리
// KV 키:
//   hondi:default_llm_keys  — [{provider,model,key,active}]
//   hondi:trial_days        — number (무료 체험 일수)
//   hondi:trial_expired_msg — string (만료 안내 메시지)
// ══════════════════════════════════════════════════════════════

// POST /admin/default-key
// body: { admin_token, keys:[{provider,model,key,active}], trial_days, expired_msg }
// admin_token: desktop.html에서 HMAC-SHA256으로 생성한 토큰
async function handleAdminDefaultKeySet(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return _err(400, 'INVALID_JSON', 'JSON 파싱 실패', corsHeaders);

  // HMAC 검증 — desktop.html의 ADMIN_SALT와 동일한 키로 검증
  const { admin_token, keys, trial_days, expired_msg } = body;
  if (!admin_token) return _err(401, 'MISSING_TOKEN', 'admin_token 필수', corsHeaders);

  const isValid = await _verifyAdminToken(env, admin_token);
  if (!isValid) return _err(403, 'INVALID_TOKEN', '관리자 인증 실패', corsHeaders);

  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return _err(500, 'KV_UNAVAILABLE', 'KV 바인딩 없음', corsHeaders);

  // 키 저장 (active인 것만 실제 사용, inactive는 보관)
  if (Array.isArray(keys)) {
    await kv.put('hondi:default_llm_keys', JSON.stringify(keys));
  }
  if (trial_days !== undefined) {
    await kv.put('hondi:trial_days', String(parseInt(trial_days) || 7));
  }
  if (expired_msg !== undefined) {
    await kv.put('hondi:trial_expired_msg', expired_msg);
  }

  return new Response(JSON.stringify({ ok: true, saved_at: new Date().toISOString() }),
    { status: 200, headers: corsHeaders });
}

// GET /default-key?guid=...&registered_at=ISO8601
// 체험기간 내이면 활성 키 중 첫 번째 반환 (key 값은 마스킹 안 함 — HTTPS 전용)
// 체험기간 만료이면 expired_msg 반환
//
// 2026-06-27: 공용 디폴트 키 제공 전면 중단 (토큰 낭비 방지 — 모든
// 사용자는 자신의 API 키를 직접 입력해야 한다). 클라이언트
// (loadDefaultKeyIfNeeded)도 이미 막아뒀지만, KV에 남은 키가 있어도
// 서버가 절대 내려주지 않도록 이중으로 차단한다. 되돌리려면
// DEFAULT_KEY_PROVISIONING_ENABLED만 true로.
const DEFAULT_KEY_PROVISIONING_ENABLED = false;

async function handleDefaultKeyGet(request, env, corsHeaders) {
  if (!DEFAULT_KEY_PROVISIONING_ENABLED) {
    return new Response(JSON.stringify({
      ok: false,
      status: 'PROVISIONING_DISABLED',
      message: '공용 체험 키 제공이 중단됐습니다. 설정에서 본인의 AI 키를 직접 입력해 주세요.',
    }), { status: 200, headers: corsHeaders });
  }

  const url  = new URL(request.url);
  const guid = url.searchParams.get('guid');
  const registeredAt = url.searchParams.get('registered_at');

  if (!guid) return _err(400, 'MISSING_FIELD', 'guid 필수', corsHeaders);

  const kv = env.AI_SETUP_SEALS_KV;
  if (!kv) return _err(500, 'KV_UNAVAILABLE', 'KV 바인딩 없음', corsHeaders);

  // 체험 기간 계산
  const trialDays = parseInt(await kv.get('hondi:trial_days') || '7');
  const regTime   = registeredAt ? new Date(registeredAt).getTime() : 0;
  const now       = Date.now();
  const trialMs   = trialDays * 24 * 60 * 60 * 1000;
  const inTrial   = regTime > 0 && (now - regTime) <= trialMs;
  const daysLeft  = inTrial ? Math.ceil((regTime + trialMs - now) / 86400000) : 0;

  if (!inTrial) {
    const expiredMsg = await kv.get('hondi:trial_expired_msg') ||
      'AI 비서 무료 체험 기간이 종료됐습니다. 계속 이용하시려면 이메일로 키를 발급받거나 유료 플랜을 선택해 주세요.';
    return new Response(JSON.stringify({
      ok: false,
      status: 'TRIAL_EXPIRED',
      message: expiredMsg,
      trial_days: trialDays,
    }), { status: 200, headers: corsHeaders });
  }

  // 활성 키 조회
  const keysRaw = await kv.get('hondi:default_llm_keys');
  const keys    = keysRaw ? JSON.parse(keysRaw).filter(k => k.active && k.key) : [];

  if (!keys.length) {
    return new Response(JSON.stringify({
      ok: false,
      status: 'NO_DEFAULT_KEY',
      message: '관리자가 디폴트 키를 아직 등록하지 않았습니다.',
    }), { status: 200, headers: corsHeaders });
  }

  // 첫 번째 활성 키 반환
  const { provider, model, key } = keys[0];
  return new Response(JSON.stringify({
    ok: true,
    status: 'TRIAL_ACTIVE',
    days_left: daysLeft,
    provider,
    model,
    key,            // HTTPS 전용 — 평문 전달
    trial_days: trialDays,
  }), { status: 200, headers: corsHeaders });
}

// 관리자 토큰 검증 — HMAC-SHA256(timestamp, GOPANG_MASTER_KEY)
// desktop.html에서 생성한 토큰: {ts}.{hmac}
// POST /admin/cf-dns — Cloudflare DNS CNAME 추가 (브라우저 CORS 우회)
// body: { token, apiKey, email, zoneId, name, content }
async function handleAdminCfDns(request, env, corsHeaders) {
  const body = await request.json().catch(() => ({}));
  const { token, apiKey, email, zoneId, name, content } = body;
  if (!token) return new Response(JSON.stringify({error:'MISSING_TOKEN'}), {status:401, headers:corsHeaders});
  const isValid = await _verifyAdminToken(env, token);
  if (!isValid) return new Response(JSON.stringify({error:'INVALID_TOKEN'}), {status:403, headers:corsHeaders});
  if (!apiKey || !email || !zoneId || !name) 
    return new Response(JSON.stringify({error:'MISSING_PARAMS'}), {status:400, headers:corsHeaders});

  const cfRes = await fetch(`https://api.cloudflare.com/client/v4/zones/${zoneId}/dns_records`, {
    method: 'POST',
    headers: { 'X-Auth-Key': apiKey, 'X-Auth-Email': email, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type:'CNAME', name, content: content||'openhash-gopang.github.io', ttl:1, proxied:false })
  });
  const data = await cfRes.json();
  return new Response(JSON.stringify(data), {
    status: cfRes.status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

// GET /admin/stats?token=... — 통계 (L1 profiles 기반)
// (2026-07-15: Supabase → L1 이관. 기존 주석("L1은 SSL 미설정이라 Worker
//  에서 직접 접근 불가")은 이제 사실이 아니다 — L1_DEFAULT가 이미
//  'https://l1-hanlim.hondi.net'로 저장소 전체에서 수백 곳에서 정상
//  호출되고 있다. 오래된 주석이 남아있었을 뿐이다.)
async function handleAdminStats(request, env, corsHeaders) {
  const url = new URL(request.url);
  const token = url.searchParams.get('token');
  if (!token) return new Response(JSON.stringify({error:'MISSING_TOKEN'}), {status:401, headers:corsHeaders});
  const isValid = await _verifyAdminToken(env, token);
  if (!isValid) return new Response(JSON.stringify({error:'INVALID_TOKEN'}), {status:403, headers:corsHeaders});

  try {
    const l1Token = await _l1AdminToken(env);
    const l1Headers = { 'Authorization': 'Bearer ' + l1Token };

    // 전체 카운트 — PocketBase 목록 응답의 totalItems를 이용 (perPage=1로 최소 조회)
    const r1 = await fetch(
      `${L1_DEFAULT}/api/collections/profiles/records?perPage=1`,
      { headers: l1Headers, signal: AbortSignal.timeout(6000) }
    );
    const d1 = await r1.json().catch(() => ({ totalItems: 0 }));
    const total = d1.totalItems || 0;

    // 최근 500개 created 날짜
    const r2 = await fetch(
      `${L1_DEFAULT}/api/collections/profiles/records?sort=-created&perPage=500`,
      { headers: l1Headers, signal: AbortSignal.timeout(8000) }
    );
    const d2 = await r2.json().catch(() => ({ items: [] }));
    const items = d2.items || [];

    return new Response(JSON.stringify({
      total,
      items: items.map(u => ({created: u.created}))
    }), {status:200, headers:{...corsHeaders,'Content-Type':'application/json'}});
  } catch(e) {
    return new Response(JSON.stringify({error: e.message}), {status:502, headers:corsHeaders});
  }
}

async function _verifyAdminToken(env, token) {
  try {
    const [tsStr, hmacHex] = token.split('.');
    if (!tsStr || !hmacHex) return false;
    const ts  = parseInt(tsStr);
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > 300) return false;  // 5분 유효

    const secret = env.GOPANG_MASTER_KEY || 'gopang-webauthn-secret-v1';
    const k = await crypto.subtle.importKey(
      'raw', new TextEncoder().encode(secret),
      { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']
    );
    const sigBytes = Uint8Array.from(hmacHex.match(/.{2}/g).map(h => parseInt(h, 16)));
    return await crypto.subtle.verify('HMAC', k, sigBytes, new TextEncoder().encode(tsStr));
  } catch { return false; }
}
