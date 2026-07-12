// ═══════════════════════════════════════════════════════════
// src/worker/dept-task-handler.js — 부서/기관/사업자 간 업무지시 큐
// (2026-07-12 신설, B그룹 100건 사고실험 대응)
// ═══════════════════════════════════════════════════════════
//
// 설계 배경은 pb_migrations/1784200001_created_dept_tasks.js 상단 주석
// 참고. 요약: SP_DELEGATION_REGISTRY(LLM 컨텍스트 합성, 영속 없음)와
// GOV_TASK(시민→기관 서류접수, 요청자가 항상 시민 1명)로는 "부서가
// 부서에 지시", "민간사업자가 행정기관에 지시" 같은 흐름을 표현할 수
// 없었다(100건 사고실험 B-1/B-4/B-5, 30건 중 18건·60%). 이 파일이 그
// 간극을 메운다.
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
    // city-dept — 제주시/서귀포시 × 12개 domain(do-dept와 동일 domain 체계 공유)
    ...['jeju', 'seogwipo'].flatMap(city =>
      ['welfare','plan','safety','jachi','econ','innov','climate','housing','transport','culture','tourism','agri','ocean']
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

/**
 * POST /gov/dept-task — 업무지시 생성
 * body: { requester_type, requester_id, requester_label?, target_type, target_id,
 *         task_type, directive, payload?, origin_chain? }
 *
 * ★ 서명 검증: business/citizen 요청자는 Ed25519 서명을 요구한다(guid 소유
 * 증명). dept/org 요청자는 개인 키페어 개념이 없으므로(제주도청 자체가
 * 서명 주체가 아님 — worker.js jeju_do delegation과 동일하게 "누구나
 * 접근 가능한 관할 SP"로 취급) 서명을 요구하지 않는다. 이건 알려진
 * 한계다 — 지금은 "요청 출처가 실제 그 부서 시스템인지"를 서버가
 * 검증할 방법이 없다(아래 KNOWN_LIMITATIONS 참조).
 */
async function handleDeptTaskCreate(request, env, corsHeaders, deps) {
  const { _err, _verifyEd25519, _l1FindProfileByGuid, _l1CreateDeptTask } = deps;
  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }

  const {
    requester_type, requester_id, requester_label = '',
    target_type, target_id, task_type, directive, payload = {},
    origin_chain = [],
    pubkey = null, signature = null,
  } = body;

  if (!requester_type || !requester_id) return _err(400, 'MISSING_FIELD', 'requester_type/requester_id 필수', corsHeaders);
  if (!target_type || !target_id)       return _err(400, 'MISSING_FIELD', 'target_type/target_id 필수', corsHeaders);
  if (!task_type)                       return _err(400, 'MISSING_FIELD', 'task_type 필수', corsHeaders);
  if (!directive || !directive.trim())  return _err(400, 'MISSING_FIELD', 'directive 필수', corsHeaders);

  if (['business', 'citizen'].includes(requester_type)) {
    if (!pubkey || !signature) return _err(400, 'MISSING_FIELD', 'business/citizen 요청자는 pubkey/signature 필수', corsHeaders);
    const sigOk = await _verifyEd25519(pubkey, signature, body);
    if (!sigOk) return _err(401, 'INVALID_SIGNATURE', '서명 검증 실패', corsHeaders);
    const requesterProfile = await _l1FindProfileByGuid(env, requester_id).catch(() => null);
    if (!requesterProfile) return _err(404, 'REQUESTER_NOT_FOUND', '요청자 프로필이 없습니다', corsHeaders);
    if (requesterProfile.pubkey_ed25519 && requesterProfile.pubkey_ed25519 !== pubkey) {
      return _err(401, 'PUBKEY_MISMATCH', '공개키가 일치하지 않습니다', corsHeaders);
    }
  }

  // 순환 위임 방지(SP-INTERCALL-PROTOCOL 원칙3과 동일 사상) — 이 target이
  // 이미 origin_chain에 있으면 거부. 상한(MAX_DEPT_TASK_CHAIN)도 강제한다.
  if (origin_chain.includes(target_id)) {
    return _err(409, 'CIRCULAR_DELEGATION', `이미 경유한 대상입니다(순환 위임): ${target_id}`, corsHeaders);
  }
  if (origin_chain.length >= MAX_DEPT_TASK_CHAIN) {
    return _err(429, 'CHAIN_LIMIT_EXCEEDED', `업무지시 연쇄 한도(${MAX_DEPT_TASK_CHAIN}단계)를 초과했습니다`, corsHeaders);
  }

  const targetCheck = await _validateTarget(env, target_type, target_id, deps);
  if (!targetCheck.ok) {
    return _err(400, targetCheck.reason, `등록되지 않았거나 지시를 받을 수 없는 대상입니다: ${target_type}:${target_id}`, corsHeaders);
  }

  let record;
  try {
    record = await _l1CreateDeptTask(env, {
      requester_type, requester_id, requester_label,
      target_type, target_id, task_type, directive, payload,
      status: 'requested',
      origin_chain: [...origin_chain, target_id],
    });
  } catch (e) {
    return _err(502, 'DEPT_TASK_CREATE_FAILED', e.message, corsHeaders);
  }

  return new Response(JSON.stringify({ ok: true, task_id: record.id, status: 'requested' }),
    { status: 201, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/**
 * PATCH /gov/dept-task/:id — 상태 전환(대상 측만 호출). AC가 자동으로
 * completed를 호출하는 경로는 이 파일 어디에도 없다 — 위 상단 주석의
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

export { handleDeptTaskCreate, handleDeptTaskUpdate, DEPT_TASK_TAXONOMY };
