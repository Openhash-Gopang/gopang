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
  emd: new Set([
    // 05-emd 43개 읍면동 × 6개 코드(general/civil/welfare/outreach/
    // industry/agent) — emd-master-data.json(42개) + hallim(1개) 실사,
    // 2026-07-13 신설(기존에는 emd 계층 자체가 U10-5/여기 어디에도
    // 등록돼 있지 않아 이 계층의 DEPT_TASK_REQUEST가 원천적으로
    // 불가능했음). 최초 등록 시 git add 목록에서 이 파일이 누락돼
    // push가 안 됐던 것을 2026-07-13 최종 감사에서 재발견, 재적용함.
    // industry는 12개 읍·면 인스턴스만 실사용하지만, do-dept/city-dept
    // 크로스곱과 동일하게 "안 쓰는 조합도 등록만 해둔다" 원칙을 유지해
    // 43개 전체 × 6개를 등록한다.
    ...['aewol','jocheon','gujwa','hangyeong','chuja','udo','daejeong','namwon',
        'seongsan','andeok','pyoseon','ildo1','ildo2','ido1','ido2','samdo1',
        'samdo2','yongdam1','yongdam2','geonip','hwabuk','samyang','bonggae',
        'ara','ora','yeondong','nohyeong','oedo','iho','dodu','songsan',
        'jeongbang','jungang-sgp','cheonji','hyodon','yeongcheon','donghong',
        'seohong','daeryun','daecheon','jungmun','yerae','hallim']
      .flatMap(emd =>
        ['general','civil','welfare','outreach','industry','agent']
          .map(t => `emd:${emd}:${t}`)),
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

async function _validateTarget(env, targetType, targetId, deps) {
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
  const set = DEPT_TASK_TAXONOMY[targetType];
  if (!set) return { ok: false, reason: 'UNKNOWN_TARGET_TYPE' };
  if (!set.has(targetId)) return { ok: false, reason: 'TARGET_NOT_REGISTERED' };
  return { ok: true };
}

// authoritativeAgency가 주어지면(=handleGovRelay/handleBusinessRelay가
// 서버 안에서 직접 호출) requester가 그 세션과 실제로 일치하는지 검사한다.
// null이면(=순수 HTTP POST) dept/org 요청자는 아예 거부한다 — 이 경로로는
// "부서를 자칭"할 신뢰 근거가 전혀 없기 때문(위 상단 주석 참고).
function _authoritativeCheck(requesterType, requesterId, authoritativeAgency) {
  if (requesterType !== 'dept' && requesterType !== 'org') return { ok: true }; // business/citizen은 서명으로 별도 검증
  if (!authoritativeAgency) {
    return { ok: false, reason: 'DEPT_ORG_REQUIRES_RELAY_SESSION' };
  }
  if (authoritativeAgency === 'jeju_do') {
    const ok = requesterType === 'dept' &&
      (requesterId.startsWith('do-dept:') || requesterId.startsWith('do-agency:') || requesterId.startsWith('city-dept:'));
    return ok ? { ok: true } : { ok: false, reason: 'REQUESTER_AGENCY_MISMATCH' };
  }
  if (authoritativeAgency === 'jeju_national') {
    const ok = requesterType === 'dept' && requesterId.startsWith('national:');
    return ok ? { ok: true } : { ok: false, reason: 'REQUESTER_AGENCY_MISMATCH' };
  }
  // handleBusinessRelay — authoritativeAgency는 bizKey 문자열 그대로.
  const ok = requesterType === 'org' && requesterId === `org:${authoritativeAgency}`;
  return ok ? { ok: true } : { ok: false, reason: 'REQUESTER_AGENCY_MISMATCH' };
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

  const targetCheck = await _validateTarget(env, targetType, targetId, deps);
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

export { handleDeptTaskCreate, handleDeptTaskUpdate, createDeptTaskCore, DEPT_TASK_TAXONOMY, _authoritativeCheck };
