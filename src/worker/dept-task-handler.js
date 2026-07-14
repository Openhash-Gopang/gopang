// ═══════════════════════════════════════════════════════════
// src/worker/dept-task-handler.js — 부서/기관/사업자 간 업무지시 큐
// (2026-07-12 신설, B그룹 100건 사고실험 대응 / 2026-07-12 재설계)
// ═══════════════════════════════════════════════════════════
//
// 설계 배경은 pb_migrations/1784200001_created_dept_tasks.js 상단 주석
// 참고. 요약: SP_DELEGATION_REGISTRY(LLM 컨텍스트 합성, 영속 없음)와
// GOV_TASK(시민→기관 서류접수, 요청자가 항상 시민 1명)로는 "부서가
// 부서에 지시", "민간사업자가 행정기관에 지시" 같은 흐름을 표현할 수
// 없었다(100건 사고실험 B-1/B-4/B-5, 30건 중 18건·60%). 이 파일이 그
// 간극을 메운다.
//
// ★★ 2026-07-12 재설계 — 처음 버전은 이 파일을 call-ai.js(gopang 저장소
// 시민용 채팅 클라이언트)가 호출하는 걸 전제로 짰는데, jeju_do/
// jeju_national SP는 실제로 jeju.hondi.net(별도 저장소 Openhash-Gopang/
// jeju)에서 서빙되고, 그 클라이언트는 call-ai.js를 전혀 쓰지 않는다
// (webapp.html의 _govRelayCompletion이 /gov/relay를 직접 호출하고, U9
// sp_call만 서버가 처리 — DEPT_TASK_REQUEST 처리 로직은 클라이언트
// 어디에도 없었다). 즉 이전 버전은 실제 기관 세션에서는 절대 실행될
// 수 없는 죽은 경로였다. sp_call과 동일하게 handleGovRelay/
// handleBusinessRelay가 LLM 응답에서 태그를 직접 감지해 **서버 안에서**
// 처리하도록 바꿨다 — 어떤 클라이언트를 쓰든(jeju.hondi.net이든 gopang
// 웹앱이든) 동작한다.
//
// 이 재설계는 부수 효과로 B-6(#99, 서명 위조) 문제도 상당 부분 해소한다
// — dept/org 요청자는 이제 "서명"이 아니라 "이 요청이 실제로 서버가
// 그 agency/bizKey로 로드해준 /gov/relay·/gov/business-relay 세션
// 안에서 나왔다"는 사실로 인증된다(requireAuthoritative=true 경로만
// dept/org 요청을 받아들인다 — 아래 createDeptTaskCore 참고). 순수
// HTTP POST(/gov/dept-task 직접 호출)로는 dept/org 요청자를 자칭할 수
// 없도록 막았다. 단, 이걸로도 못 막는 잔여 위험은 여전히 있다 —
// jeju_do 세션 "안"에서 실제로 도청과 대화하던 사람이 JEJU_CHAIN을
// 특정 부서(예: jachi)로 유도한 뒤 그 부서를 자칭해 부적절한 지시를
// 내리는 것까지는 막지 못한다(그 세부 부서 배정 자체가 클라이언트
// 쪽에서 검증 없이 결정되기 때문 — jeju-router.js resolveJejuAgency).
// 이건 더 깊은 구조 변경이 필요해 이번 범위 밖으로 남긴다.
//
// ★ 범위를 분명히 해 둔다 — 이 구현이 "하는 일"과 "안 하는 일":
//   하는 일: 지시를 영속 레코드로 남기고(요청자→대상, 상태), 순환 위임을
//            막고, 등록된 taxonomy 밖의 대상을 거부한다.
//   안 하는 일: 지시된 업무를 실제로 "수행"하지 않는다 — 예를 들어
//            "예산 집행내역 취합해서 보내"라는 dept_task가 생성돼도,
//            실제 예산 데이터를 자동으로 취합하는 로직은 없다. 이건
//            어디까지나 "업무지시가 오갔다는 기록과 상태 추적" 계층이고,
//            각 기관의 실제 업무 처리(승인·이행)는 여전히 사람 또는
//            각 기관 시스템의 몫이다 — HUMAN-AUTHORITY-GATE 원칙과
//            동일하게, 이 큐는 절대 자동으로 status를 completed로
//            바꾸지 않는다(대상 측이 명시적으로 PATCH해야만 전환).

// ── 사전 등록된 대상 taxonomy (실사 결과 그대로 하드코딩) ──────────
// SP-INTERCALL-PROTOCOL 원칙4("위임 대상은 사전 등록된 식별자만 허용")를
// 그대로 따른다 — 여기 없는 target_id는 target_type이 뭐든 거부.
const DEPT_TASK_TAXONOMY = {
  dept: new Set([
    // do-dept 12개 domain (prompts/Jejudo/02-do-dept/templates/do-dept-master-data.json 실사)
    'do-dept:welfare', 'do-dept:plan', 'do-dept:safety', 'do-dept:jachi',
    'do-dept:econ', 'do-dept:innov', 'do-dept:climate', 'do-dept:housing',
    'do-dept:transport', 'do-dept:culture', 'do-dept:tourism', 'do-dept:agri', 'do-dept:ocean',
    // do-agency 11개 (prompts/Jejudo/03-do-agency/*.md 실사)
    'do-agency:FIRE', 'do-agency:POLICE', 'do-agency:WATER', 'do-agency:AGRITECH',
    'do-agency:BOHWAN', 'do-agency:CHUKSAN', 'do-agency:LIBRARY', 'do-agency:ARTMUSEUM',
    'do-agency:FOLKMUSEUM', 'do-agency:HERITAGE',
    // city-dept — 제주시/서귀포시 × 13개 domain(do-dept와 공유하는 13개) +
    // 서귀포시 전용 3개(agrieconomy/construction/health, 2026-07-13 등록
    // — city-dept-master-data.json 실사 결과 서귀포시 조직도에는 있으나
    // 기존 do-dept 13개 domain 크로스곱에는 없어 U10 DEPT_TASK_REQUEST가
    // 조용히 실패하던 것을 발견·수정. 제주시에는 해당 3개 부서가 없어
    // city-dept:jeju:agrieconomy 등은 등록은 되지만 실사용은 없음 — 기존
    // 크로스곱 방식과 동일하게 "안 쓰는 조합도 등록만 해둔다"는 원칙 유지)
    ...['jeju', 'seogwipo'].flatMap(city =>
      ['welfare','plan','safety','jachi','econ','innov','climate','housing','transport','culture','tourism','agri','ocean']
        .map(d => `city-dept:${city}:${d}`)),
    ...['jeju', 'seogwipo'].flatMap(city =>
      ['agrieconomy','construction','health']
        .map(d => `city-dept:${city}:${d}`)),
  ]),
  org: new Set([
    // 07-org 27개 (prompts/Jejudo/07-org/*.md 실사)
    'org:JTO', 'org:JFAC', 'org:JPASS', 'org:IPF', 'org:JTP', 'org:JCPA', 'org:SGPMED',
    'org:ICCJEJU', 'org:MAEUL', 'org:JDC', 'org:JCGF', 'org:JEJUMED', 'org:JEDA',
    'org:JPSPO', 'org:URBANREGEN', 'org:JEA', 'org:JSPO', 'org:JILES', 'org:JTA',
    'org:JERI', 'org:JCCEI', 'org:JEJU43', 'org:JWFRI', 'org:CHILDMEAL', 'org:JPDC',
    'org:TRANSWEAK', 'org:CHILDCARE',
  ]),
  national: new Set([
    // 09-national/agencies 28개 domain (national-agency-master-data.json 실사)
    'national:agroquality', 'national:airport', 'national:animalquarantine', 'national:coastguard',
    'national:court', 'national:data', 'national:env', 'national:fishquality', 'national:foodimport',
    'national:humanquarantine', 'national:immigration', 'national:internet', 'national:labor',
    'national:laborimprove', 'national:laborrel', 'national:mma', 'national:nhis', 'national:nps',
    'national:police', 'national:port', 'national:post', 'national:pps', 'national:probation',
    'national:prosecution', 'national:radio', 'national:tax', 'national:veterans', 'national:weather',
  ]),
  'k-service': new Set([
    // worker.js SP_DELEGATION_REGISTRY와 동일 목록 — 두 레지스트리가 갈라지지
    // 않도록 이 파일을 고칠 때 worker.js SP_DELEGATION_REGISTRY도 함께 볼 것.
    'k-service:health', 'k-service:police', 'k-service:911', 'k-service:democracy',
    'k-service:insurance', 'k-service:traffic', 'k-service:logistics', 'k-service:public',
    'k-service:jeju_do', 'k-service:jeju_national',
  ]),
  // business는 고정 목록이 아니라 L1 profiles에 실제로 존재하는 guid인지를
  // 요청 시점에 조회로 검증한다(아래 _validateTarget 참조) — 사업자는
  // 매일 새로 생기므로 하드코딩 목록이 성립하지 않는다.
};

const MAX_DEPT_TASK_CHAIN = 4; // SP_CALL의 MAX_SP_HOPS(2)보다 넉넉히 둔다 —
// 이쪽은 비동기 상태추적이라 실시간 LLM 비용 폭주 리스크가 없고, 대신
// 행정 실무상 2단계 이상 재위임이 흔하기 때문(예: 부서→부서→외부기관).
// 그래도 무한 루프 자체는 반드시 막아야 하므로 유한 상한은 유지한다.

async function _validateTarget(env, targetType, targetId, deps, requesterId = null) {
  if (targetType === 'business') {
    const profile = await deps._l1FindProfileByGuid(env, targetId).catch(() => null);
    if (!profile) return { ok: false, reason: 'TARGET_BUSINESS_NOT_FOUND' };
    const claimStatus = profile.claim_status ?? profile.extra?.claim_status;
    if (claimStatus === 'unclaimed') {
      // A-11과 같은 원칙 — 미청구 사업자에게 "업무지시"(사실상 거래/이행
      // 요구를 포함할 수 있음)를 보내는 것도 같은 사기 벡터가 될 수 있다.
      return { ok: false, reason: 'TARGET_BUSINESS_UNCLAIMED' };
    }
    return { ok: true };
  }
  // 2026-07-14 신설 — STAFF_TASK_QUEUE_v1_0.md. "호출"이 아니라 "게시"다
  // (AGENCY-AC-COMMON 0-4) — 그래도 아무 부서나 아무 직원에게나 게시할
  // 순 없다. 반드시 (1) 그 직원이 실제로 그 부서 소속으로 검증돼 있고,
  // (2) 게시하는 쪽(requesterId)이 정확히 그 소속 부서 자신이어야 한다.
  if (targetType === 'staff') {
    if (!requesterId) return { ok: false, reason: 'STAFF_TARGET_REQUIRES_REQUESTER' };
    const profile = await deps._l1FindProfileByGuid(env, targetId).catch(() => null);
    if (!profile) return { ok: false, reason: 'TARGET_STAFF_NOT_FOUND' };
    const affList = profile.extra?.public?.identity?.affiliation || [];
    const match = affList.find(a => a.org_id === requesterId && a.verified && a.active !== false);
    if (!match) return { ok: false, reason: 'TARGET_STAFF_NOT_VERIFIED_MEMBER' };
    return { ok: true };
  }
  if (targetType === 'org_staff_pool') {
    // 공용 게시판 — targetId는 org_id 자신이어야 하고, 그 org_id를 게시할
    // 자격은 그 부서 본인뿐이다(다른 부서가 남의 직원 풀에 게시 금지).
    if (!requesterId || targetId !== requesterId) return { ok: false, reason: 'ORG_STAFF_POOL_SELF_ONLY' };
    const set = DEPT_TASK_TAXONOMY.dept?.has(targetId) || DEPT_TASK_TAXONOMY.org?.has(targetId) || DEPT_TASK_TAXONOMY.national?.has(targetId);
    if (!set) return { ok: false, reason: 'UNKNOWN_TARGET_TYPE' };
    return { ok: true };
  }
  const set = DEPT_TASK_TAXONOMY[targetType];
  if (!set) return { ok: false, reason: 'UNKNOWN_TARGET_TYPE' };
  if (!set.has(targetId)) return { ok: false, reason: 'TARGET_NOT_REGISTERED' };
  return { ok: true };
}

// authoritativeAgency가 주어지면(=handleGovRelay/handleBusinessRelay가
// 서버 안에서 직접 호출) requester가 그 세션과 실제로 일치하는지 검사한다.
// null이면(=순수 HTTP POST) dept/org 요청자는 아예 거부한다 — 이 경로로는
// "부서를 자칭"할 신뢰 근거가 전혀 없기 때문(위 상단 주석 참고).
// ═══════════════════════════════════════════════════════════
// 기관/기업 신원 암호 검증 — 2026-07-14 신설
// (주피터님 지시: "모든 공무원은 국가가 서명한 증명서를 보유하며, 모든
// 직책은 소속 기관장의 디지털 서명에 의해 유효하다. 국가와 기관의
// 공개키로 신분을 검증한다.")
//
// 이전까지 authoritativeAgency는 handleGovRelay/handleBusinessRelay가
// 클라이언트 요청 본문에서 그대로 읽은 agency/bizKey 문자열이었다 —
// 누구든 {agency:"jeju_do"}만 보내면 그 세션 안에서 "저는 위생과
// 관리자입니다"라고 자칭하는 것만으로 _authoritativeCheck를 통과했다
// (사고실험이 아니라 실제 코드 검토로 발견한 결함). 이 블록이 그
// 자기신고를 서명 검증으로 대체한다 — 이미 있는 Ed25519 TOFU 인프라
// (business/citizen 요청자용, worker.js _verifyEd25519)를 그대로
// 재사용하고, 새 암호 로직은 만들지 않는다.
//
// AGENCY_PUBKEY_REGISTRY — 정부기관의 "기관 공개키"(기관장 서명키에
// 해당). 하드코딩(DEPT_TASK_TAXONOMY와 동일 관례) — 최초 등록은
// 플랫폼 관리자가 실제 기관과 오프라인으로 신원을 확인한 뒤 채워
// 넣는다. 이건 여전히 이 저장소 밖의 절차다(#18의 "관련 법령이
// 최초 임명의 근거" 원칙과 동일 — 시스템은 이 값이 일단 등록되면
// 그 이후의 서명 검증만 암호학적으로 보장한다, 최초 등록 행위 자체의
// 진위는 시스템이 재검증할 방법이 없다). 값이 없는 기관은 접근증명을
// 아예 발급 못 하므로 안전한 기본값(거부)이 유지된다.
//
// 민간기업(org:{bizKey})은 새 레지스트리가 필요 없다 — 이미 존재하는
// L1 profiles.pubkey_ed25519(사업자 claim 절차로 등록된 본인 키)를
// "기관 공개키"로 그대로 쓴다. deps._l1FindProfileByGuid로 조회.
const AGENCY_PUBKEY_REGISTRY = {
  // 'city-dept:jeju:health': '<base64url Ed25519 공개키 — 실제 기관장
  //    키 확보 후 채울 것, 그 전까지 이 기관은 access_cert 발급 불가>',
};

/**
 * _verifyAccessCert — "직책 인증서"(기관장이 특정 GUID에게 특정
 * 직책을 부여했다는 서명) + "본인 서명"(그 GUID가 진짜 자기 키로
 * 이번 요청을 보냈다는 서명) 둘 다 검증한다.
 *
 * cert = {
 *   org_id, official_guid, role, issued_at, expires_at,
 *   issuer_signature,      // org_id의 공개키로 서명 — 아래 canonical 대상
 *   official_pubkey,       // official_guid 본인의 공개키
 *   official_signature,    // official_pubkey로 이번 요청(request_nonce) 서명
 *   request_nonce,         // 재전송 공격 방지용 — 호출부가 매 요청 새로 생성
 * }
 * 반환: 검증 통과 시 org_id 문자열, 실패 시 null(이유는 console.warn만).
 */
async function _verifyAccessCert(env, cert, callerGuid, deps) {
  const { _verifyEd25519Simple, _l1FindProfileByGuid } = deps;
  if (!cert || typeof cert !== 'object') return null;
  const { org_id, official_guid, role, issued_at, expires_at,
          issuer_signature, official_pubkey, official_signature, request_nonce } = cert;
  if (!org_id || !official_guid || !role || !expires_at || !issuer_signature ||
      !official_pubkey || !official_signature || !request_nonce) {
    console.warn('[AccessCert] 필드 누락'); return null;
  }
  if (official_guid !== callerGuid) {
    console.warn('[AccessCert] official_guid가 요청자 guid와 불일치'); return null;
  }
  if (new Date(expires_at).getTime() < Date.now()) {
    console.warn('[AccessCert] 만료된 인증서'); return null;
  }

  // 1) 기관장 서명(issuer_signature) 검증 — "이 GUID에게 이 직책을 준다"는
  //    선언 자체가 진짜 그 기관의 공개키로 서명됐는지.
  let issuerPubkey = null;
  if (org_id.startsWith('org:')) {
    // 민간기업 — 기존 L1 profile pubkey_ed25519 재사용.
    const bizProfile = await _l1FindProfileByGuid(env, org_id.slice('org:'.length)).catch(() => null);
    issuerPubkey = bizProfile?.pubkey_ed25519 || null;
  } else {
    issuerPubkey = AGENCY_PUBKEY_REGISTRY[org_id] || null;
  }
  if (!issuerPubkey) { console.warn('[AccessCert] 기관 공개키 미등록:', org_id); return null; }

  const appointmentMessage = JSON.stringify({ org_id, official_guid, role, issued_at, expires_at });
  const issuerOk = await _verifyEd25519Simple(issuerPubkey, issuer_signature, appointmentMessage).catch(() => false);
  if (!issuerOk) { console.warn('[AccessCert] 기관장 서명 검증 실패'); return null; }

  // 2) 본인 서명(official_signature) 검증 — 이번 요청을 실제로 그
  //    official_pubkey의 개인키 소유자가 보냈는지(request_nonce 재사용
  //    공격 방지는 호출부가 매번 새 nonce를 쓰는 것으로 담보 — 이
  //    함수는 서명 유효성만 확인, nonce 재사용 여부 추적은 범위 밖).
  const selfOk = await _verifyEd25519Simple(official_pubkey, official_signature, request_nonce).catch(() => false);
  if (!selfOk) { console.warn('[AccessCert] 본인 서명 검증 실패'); return null; }

  // 3) TOFU — official_guid의 L1 프로필에 이미 등록된 키가 있으면 일치해야
  //    한다(다른 사람이 같은 GUID를 사칭해 새 키로 서명 검증만 통과시키는
  //    것 방지 — business/citizen 경로와 동일 원칙).
  const officialProfile = await _l1FindProfileByGuid(env, official_guid).catch(() => null);
  if (officialProfile?.pubkey_ed25519 && officialProfile.pubkey_ed25519 !== official_pubkey) {
    console.warn('[AccessCert] official pubkey TOFU 불일치'); return null;
  }

  return org_id;
}

/**
 * _authoritativeCheck — 2026-07-14 재설계. authoritativeAgency는 이제
 * 클라이언트 자칭 문자열이 아니라 _verifyAccessCert가 서명까지 검증한
 * org_id다. 그래서 느슨한 접두어 매칭("jeju_do면 city-dept:*는 다
 * 통과")을 버리고 정확히 일치해야만 통과한다 — 검증이 이미 구체적인
 * org_id 단위로 끝났으므로 느슨하게 풀어줄 이유가 없다.
 */
function _authoritativeCheck(requesterType, requesterId, authoritativeAgency) {
  if (requesterType !== 'dept' && requesterType !== 'org') return { ok: true }; // business/citizen은 서명으로 별도 검증
  if (!authoritativeAgency) {
    return { ok: false, reason: 'DEPT_ORG_REQUIRES_VERIFIED_ACCESS_CERT' };
  }
  return authoritativeAgency === requesterId ? { ok: true } : { ok: false, reason: 'REQUESTER_AGENCY_MISMATCH' };
}

/**
 * createDeptTaskCore — 실제 생성 로직(taxonomy·순환·인증 검사 전부 포함).
 * HTTP 핸들러(handleDeptTaskCreate)와 서버 내부 호출(worker.js
 * handleGovRelay/handleBusinessRelay의 태그 감지) 양쪽에서 공유한다.
 *
 * params: { requesterType, requesterId, requesterLabel, targetType, targetId,
 *           taskType, directive, payload, originChain, pubkey, signature }
 * opts:   { authoritativeAgency } — 서버 내부 호출일 때만 agency/bizKey를 넘긴다.
 * 반환: { ok:true, taskId, status } | { ok:false, reason, httpStatus }
 */
async function createDeptTaskCore(env, params, deps, opts = {}) {
  const {
    requesterType, requesterId, requesterLabel = '',
    targetType, targetId, taskType, directive, payload = {},
    originChain = [], pubkey = null, signature = null,
  } = params;
  const { authoritativeAgency = null } = opts;
  const { _verifyEd25519, _l1FindProfileByGuid, _l1CreateDeptTask } = deps;

  if (!requesterType || !requesterId) return { ok: false, reason: 'MISSING_FIELD', httpStatus: 400, detail: 'requester_type/requester_id 필수' };
  if (!targetType || !targetId)       return { ok: false, reason: 'MISSING_FIELD', httpStatus: 400, detail: 'target_type/target_id 필수' };
  if (!taskType)                       return { ok: false, reason: 'MISSING_FIELD', httpStatus: 400, detail: 'task_type 필수' };
  if (!directive || !String(directive).trim()) return { ok: false, reason: 'MISSING_FIELD', httpStatus: 400, detail: 'directive 필수' };

  if (requesterType === 'business' || requesterType === 'citizen') {
    if (!pubkey || !signature) return { ok: false, reason: 'MISSING_FIELD', httpStatus: 400, detail: 'business/citizen 요청자는 pubkey/signature 필수' };
    const sigOk = await _verifyEd25519(pubkey, signature, params);
    if (!sigOk) return { ok: false, reason: 'INVALID_SIGNATURE', httpStatus: 401 };
    const requesterProfile = await _l1FindProfileByGuid(env, requesterId).catch(() => null);
    if (!requesterProfile) return { ok: false, reason: 'REQUESTER_NOT_FOUND', httpStatus: 404 };
    if (requesterProfile.pubkey_ed25519 && requesterProfile.pubkey_ed25519 !== pubkey) {
      return { ok: false, reason: 'PUBKEY_MISMATCH', httpStatus: 401 };
    }
  } else {
    const authCheck = _authoritativeCheck(requesterType, requesterId, authoritativeAgency);
    if (!authCheck.ok) return { ok: false, reason: authCheck.reason, httpStatus: 401 };
  }

  if (originChain.includes(targetId)) {
    return { ok: false, reason: 'CIRCULAR_DELEGATION', httpStatus: 409, detail: `이미 경유한 대상입니다: ${targetId}` };
  }
  if (originChain.length >= MAX_DEPT_TASK_CHAIN) {
    return { ok: false, reason: 'CHAIN_LIMIT_EXCEEDED', httpStatus: 429, detail: `업무지시 연쇄 한도(${MAX_DEPT_TASK_CHAIN}단계) 초과` };
  }

  const targetCheck = await _validateTarget(env, targetType, targetId, deps, requesterId);
  if (!targetCheck.ok) {
    return { ok: false, reason: targetCheck.reason, httpStatus: 400, detail: `등록되지 않았거나 지시를 받을 수 없는 대상: ${targetType}:${targetId}` };
  }

  let record;
  try {
    record = await _l1CreateDeptTask(env, {
      requester_type: requesterType, requester_id: requesterId, requester_label: requesterLabel,
      target_type: targetType, target_id: targetId, task_type: taskType, directive, payload,
      status: 'requested',
      origin_chain: [...originChain, targetId],
    });
  } catch (e) {
    return { ok: false, reason: 'DEPT_TASK_CREATE_FAILED', httpStatus: 502, detail: e.message };
  }

  return { ok: true, taskId: record.id, status: 'requested' };
}

/**
 * POST /gov/dept-task — 순수 HTTP 경로. dept/org 요청자는 이제 이 경로로는
 * 절대 만들 수 없다(authoritativeAgency가 없어 _authoritativeCheck가 항상
 * 거부) — business/citizen(서명 있음)만 이 경로로 직접 생성 가능하다.
 * dept/org는 handleGovRelay/handleBusinessRelay 내부에서만 생성된다.
 */
async function handleDeptTaskCreate(request, env, corsHeaders, deps) {
  const { _err } = deps;
  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }
  const result = await createDeptTaskCore(env, {
    requesterType: body.requester_type, requesterId: body.requester_id, requesterLabel: body.requester_label,
    targetType: body.target_type, targetId: body.target_id, taskType: body.task_type, directive: body.directive,
    payload: body.payload, originChain: body.origin_chain || [], pubkey: body.pubkey, signature: body.signature,
  }, deps /* opts 없음 = authoritativeAgency null */);

  if (!result.ok) return _err(result.httpStatus || 400, result.reason, result.detail || '', corsHeaders);
  return new Response(JSON.stringify({ ok: true, task_id: result.taskId, status: result.status }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/**
 * PATCH /gov/dept-task/:id — 상태 전환(대상 측만 호출). AC가 자동으로
 * completed를 호출하는 경로는 이 파일 어디에도 없다 — 상단 주석의
 * "안 하는 일" 원칙을 코드로도 강제한다.
 */
async function handleDeptTaskUpdate(request, env, corsHeaders, taskId, deps) {
  const { _err, _l1UpdateDeptTask } = deps;
  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }
  const { status, result_note = '' } = body;
  const ALLOWED = new Set(['acknowledged', 'in_progress', 'completed', 'rejected']);
  if (!ALLOWED.has(status)) return _err(400, 'INVALID_STATUS', `status는 ${[...ALLOWED].join('/')} 중 하나여야 합니다`, corsHeaders);

  let record;
  try {
    record = await _l1UpdateDeptTask(env, taskId, { status, result_note });
  } catch (e) {
    return _err(502, 'DEPT_TASK_UPDATE_FAILED', e.message, corsHeaders);
  }
  return new Response(JSON.stringify({ ok: true, task_id: taskId, status }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

export { handleDeptTaskCreate, handleDeptTaskUpdate, createDeptTaskCore, DEPT_TASK_TAXONOMY, _authoritativeCheck, _verifyAccessCert, AGENCY_PUBKEY_REGISTRY };
