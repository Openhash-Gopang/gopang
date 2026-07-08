# worker.js — 기관·절차 오케스트레이션 레지스트리 구현 패치 (2026-07-08)

> §0-H(AGENT-COMMON v3.36)·SP-LAW-01 v4.0·SP-COMMON-02 C40이 참조하는
> PROCEDURE_MAP·ORG_PROFILE·ATOM_ROW를 실제로 저장·조회하는 백엔드다.
> gov_tickets 컬렉션(SP-EXP-WATER 사례)과 동일하게 L1 PocketBase에
> 컬렉션을 두고, worker.js가 프록시 엔드포인트를 제공하는 기존 패턴을
> 그대로 따른다. 검토용 패치이며 직접 커밋하지 않았다.

## 1. PocketBase(L1) 컬렉션 3개 신설

```
collection: org_profiles
  org_id (text, unique) | org_name (text) | branch (select: legislative|
  judicial|admin_central|admin_local|public_institution|private_registry)
  | jurisdiction (text) | as_of_date (date) | guid_model (select:
  government_agency|judicial|private_registry|none) | resolution_strategy
  (select: fallback_hierarchy|complete_lookup_table|single_national_
  instance|user_choice) | input (json) | output (json) | automation (json)
  | connected (bool) | unavailable_reason (text) | status (select: draft|
  pending_review|active|deprecated)

collection: atom_rows
  atom_id (text, unique) | pattern (select: REPORT|DECISION|PAY|QUERY|
  ADJUDICATE) | org_class (text) | required_docs (json) | automation_sp
  (text, nullable) | connected (bool) | unavailable_reason (text) |
  status (select: draft|pending_review|active|deprecated)

collection: procedure_maps
  goal (text, unique) | domain (text) | status (select: draft|
  pending_review|active|deprecated) | steps (json — [{seq, atom_id,
  expert_advisor}]) | eligibility_gate (json) | free_alternative (json)
  | orchestrator (text, 항상 "AC")
```

★ ATOM_PATTERN(REPORT/DECISION/PAY/QUERY/ADJUDICATE) 5종의 **실행
로직 자체**는 DB 행이 아니라 코드다 — 아래 §3의 `_executeAtom()`이
패턴별 분기를 담당하고, `atom_rows`는 그 로직에 꽂아 넣을 데이터만
갖는다(3차 라운드에서 확정한 "원자 = 패턴+데이터" 구분을 그대로
반영).

## 2. 라우팅 엔드포인트

```js
// GET /orchestration/procedure-map?goal=개인파산+면책
if (pathname === '/orchestration/procedure-map' && request.method === 'GET') {
  return handleProcedureMapLookup(request, env, corsHeaders);
}
// POST /orchestration/procedure-map/draft  (body: {goal, domain, steps})
if (pathname === '/orchestration/procedure-map/draft' && request.method === 'POST') {
  return handleProcedureMapDraft(request, env, corsHeaders);
}
// POST /orchestration/procedure-map/update (body: {goal, changes})
if (pathname === '/orchestration/procedure-map/update' && request.method === 'POST') {
  return handleProcedureMapUpdate(request, env, corsHeaders);
}
// GET /orchestration/org-profile?org_id=court-seoul-rehab
if (pathname === '/orchestration/org-profile' && request.method === 'GET') {
  return handleOrgProfileLookup(request, env, corsHeaders);
}
```

## 3. 핵심 함수

```js
// ── 오케스트레이션 레지스트리 (2026-07-08, §0-H/STEP R/C40이 참조) ──
// status:active인 항목만 실제 라우팅에 쓴다 — draft/pending_review는
// 조회는 되지만 AC가 "아직 검토 중"으로 취급해야 한다(AGENT-COMMON
// §3-0 SP_DRAFT_REQUEST와 동일한 승인 원칙, 여기서도 그대로 적용).

async function handleProcedureMapLookup(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const goal = searchParams.get('goal');
  if (!goal) return new Response(JSON.stringify({error:'goal required'}), {status:400, headers:corsHeaders});

  const rec = await _l1Find(env, 'procedure_maps', { goal });
  if (!rec) return new Response(JSON.stringify({status:'miss'}), {headers:corsHeaders});

  // steps에 걸린 atom_id를 실제 atom_rows로 해석해 함께 반환 —
  // 호출 측(AC)이 매번 두 번 조회하지 않도록 여기서 조인한다.
  const resolvedSteps = await Promise.all(
    (rec.steps || []).map(async (s) => ({
      ...s,
      atom: await _l1Find(env, 'atom_rows', { atom_id: s.step_ref || s.atom_id }),
    }))
  );
  return new Response(JSON.stringify({
    status: rec.status === 'active' ? 'hit' : 'hit_pending_review',
    procedure: { ...rec, steps: resolvedSteps },
  }), { headers: corsHeaders });
}

async function handleProcedureMapDraft(request, env, corsHeaders) {
  const body = await request.json(); // {goal, domain, steps, eligibility_gate, free_alternative}
  if (!body.goal) return new Response(JSON.stringify({error:'goal required'}), {status:400, headers:corsHeaders});

  const existing = await _l1Find(env, 'procedure_maps', { goal: body.goal });
  if (existing) {
    return new Response(JSON.stringify({error:'already exists', status: existing.status}),
      {status:409, headers:corsHeaders});
  }
  const rec = await _l1Create(env, 'procedure_maps', {
    ...body,
    status: 'pending_review',   // ★ 절대 draft 생성 시점에 active로 두지 않는다
    orchestrator: 'AC',
  });
  // 사람 검토 알림 — 기존 [SP_DRAFT_REQUEST] → [ESCALATE: to=@owner] 경로 재사용
  await _notifyOwnerForReview(env, 'procedure_map', rec.id);
  return new Response(JSON.stringify({status:'created', id: rec.id}), {headers:corsHeaders});
}

async function handleProcedureMapUpdate(request, env, corsHeaders) {
  const body = await request.json(); // {goal, changes}
  const existing = await _l1Find(env, 'procedure_maps', { goal: body.goal });
  if (!existing) return new Response(JSON.stringify({error:'not found'}), {status:404, headers:corsHeaders});

  // status:active인 절차의 갱신도 다시 pending_review로 내리지 않는다 —
  // 이미 승인된 절차에 사소한 정보(연락처 등)를 갱신하는 것과, 절차
  // 자체를 새로 만드는 것(draft)은 승인 강도가 달라야 한다는 걸
  // 이번 구현에서 결정했다: 사실 갱신(changes)은 즉시 반영, 구조 변경
  // (steps 자체를 바꾸는 것)만 다시 pending_review로 내린다.
  const structuralChange = body.changes.some(c => c.field === 'steps');
  const patch = _applyChanges(existing, body.changes);
  if (structuralChange && existing.status === 'active') patch.status = 'pending_review';

  const rec = await _l1Update(env, 'procedure_maps', existing.id, patch);
  return new Response(JSON.stringify({status:'updated', record: rec}), {headers:corsHeaders});
}

async function handleOrgProfileLookup(request, env, corsHeaders) {
  const { searchParams } = new URL(request.url);
  const orgId = searchParams.get('org_id');
  const rec = await _l1Find(env, 'org_profiles', { org_id: orgId });
  if (!rec) return new Response(JSON.stringify({status:'miss'}), {headers:corsHeaders});
  return new Response(JSON.stringify({ status: rec.status === 'active' ? 'hit' : 'hit_pending_review', org: rec }),
    { headers: corsHeaders });
}

// ── ATOM_PATTERN 실행 로직 (5종 고정, 3차 라운드 확정) ──
// atom_row의 데이터(required_docs, automation_sp 등)를 이 함수들에 꽂는다.
async function _executeAtom(env, atomRow, userContext) {
  switch (atomRow.pattern) {
    case 'REPORT':
      return _execReport(env, atomRow, userContext); // 접수 즉시 수리
    case 'DECISION':
      return _execDecision(env, atomRow, userContext); // 심사 대기(APPLY+REGISTER 통합, 4차 라운드)
    case 'PAY':
      return atomRow.pay_subtype === 'assessed'
        ? _execPayAssessed(env, atomRow, userContext)   // 관청이 계산(고지서 조회)
        : _execPaySelfAssessed(env, atomRow, userContext); // 납세자가 계산·신고
    case 'QUERY':
      return _execQuery(env, atomRow, userContext); // 즉시 발급
    case 'ADJUDICATE':
      return _execAdjudicate(env, atomRow, userContext); // 법원/행정심판, 본인인증 필요
    default:
      throw new Error(`알 수 없는 atom pattern: ${atomRow.pattern}`);
  }
}
// ★ 5개 _exec* 함수는 이번 패치에서 시그니처만 정의했고 본문은 아직
// 없다(★ 미구현 ★) — connected:true인 atom_row가 실제로 생기는 시점
// (지금은 court-filing 등 소수)에 맞춰 하나씩 채워나간다.
```

## 4. 확인 사항 (배포 전 체크리스트)

- [ ] `_l1Find`/`_l1Create`/`_l1Update`는 기존 `gov_tickets` 컬렉션
      접근에 쓰던 헬퍼와 동일 패턴을 재사용한다는 전제다 — 실제 함수명
      은 gopang 저장소의 L1 접근 유틸을 확인 후 맞출 것.
- [ ] `_notifyOwnerForReview`는 기존 `[ESCALATE: to=@owner, ...]` 태그
      경로(AGENT-COMMON §9)와 동일한 알림 채널을 재사용해야 한다 —
      새 알림 시스템을 만들지 않는다.
- [ ] `handleProcedureMapUpdate`의 "구조 변경만 재검토" 규칙은 이번에
      새로 정한 것이라, 실제 운영 중 너무 느슨하거나 빡빡하지 않은지
      운영 데이터로 재검증 필요(다음 순서 후보).
- [ ] ATOM_PATTERN 5종의 `_exec*` 함수는 이 패치에 본문이 없다 — 다음
      단계는 이 중 이미 `connected:true`로 표시된 3개(court-filing,
      biz-registration, registry-office-filing)부터 실제 구현하는 것.
