# dept_task_events 적재 후크 — 적용 가이드

이 파일은 실제 diff가 아니라 **적용 가이드**다. `worker.js`와
`src/worker/dept-task-handler.js`는 두 사람이 동시 편집 중일 수 있어(기존 process fix
원칙 — 공유 파일은 최신본 pull 후 직접 적용), 자동 패치 대신 정확한 삽입 위치와 코드를 명시한다.

---

## 1. `worker.js`에 새 L1 헬퍼 2개 추가

**위치**: 기존 `_l1UpdateDeptTask` 함수 바로 아래(worker.js 21033행 부근)

```javascript
// ── dept_task_events(Pathfinder 계측 로그) L1 헬퍼 (2026-08-13 신설) ──
// dept_tasks 자체의 PATCH 로직은 건드리지 않는다 — 이 두 함수는 별도
// 컬렉션에 한 행만 추가한다. 실패해도 dept_tasks 업데이트 자체를
// 막지 않도록 호출부(dept-task-handler.js)에서 반드시 try/catch로 감쌀 것.
async function _l1GetDeptTask(env, taskId) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/dept_tasks/records/${taskId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
  });
  if (!res.ok) return null; // 조회 실패는 로깅 스킵 사유일 뿐 — 상위에서 판단
  return res.json();
}

async function _l1CreateDeptTaskEvent(env, { task_id, from_status, to_status, at, actor_hash }) {
  const token = await _l1AdminToken(env);
  const res = await fetch(`${L1_DEFAULT}/api/collections/dept_task_events/records`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id, from_status: from_status || null, to_status, at, actor_hash: actor_hash || null }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`dept_task_events 생성 실패 (HTTP ${res.status}): ${errText}`);
  }
  return res.json();
}
```

## 2. dept_task 생성 시점 — `requested` 이벤트 기록

**위치**: `src/worker/dept-task-handler.js`의 `createDeptTaskCore` 성공 반환 직전
(`return { ok: true, taskId: record.id, status: 'requested' };` 바로 위, 441행 부근)

```javascript
  // Pathfinder 계측 — 실패해도 본 흐름(dept_task 생성)은 막지 않는다
  try {
    await deps._l1CreateDeptTaskEvent(env, {
      task_id: record.id, from_status: null, to_status: 'requested', at: new Date().toISOString(),
    });
  } catch (e) { /* 계측 실패는 무시 — 로그만 남기고 본 흐름 계속 */ console.warn('[pathfinder] event log failed', e); }

  return { ok: true, taskId: record.id, status: 'requested' };
```

`createDeptTaskCore`가 받는 `deps` 객체에 `_l1CreateDeptTaskEvent`를 추가해야 한다 —
호출부(`handleDeptTaskCreate`, worker.js 456행 근처)에서 넘기는 `deps`에 포함.

## 3. dept_task 상태 전이 시점 — `handleDeptTaskUpdate` 수정

**위치**: `src/worker/dept-task-handler.js` 472~490행, `handleDeptTaskUpdate` 전체를
아래로 교체 (기존 PATCH 로직 자체는 그대로 두고 전후로 조회·기록만 추가)

```javascript
async function handleDeptTaskUpdate(request, env, corsHeaders, taskId, deps) {
  const { _err, _l1UpdateDeptTask, _l1GetDeptTask, _l1CreateDeptTaskEvent } = deps;
  let body;
  try { body = await request.json(); } catch {
    return _err(400, 'INVALID_JSON', '요청 본문이 올바르지 않습니다.', corsHeaders);
  }
  const { status, result_note = '' } = body;
  const ALLOWED = new Set(['acknowledged', 'in_progress', 'completed', 'rejected']);
  if (!ALLOWED.has(status)) return _err(400, 'INVALID_STATUS', `status는 ${[...ALLOWED].join('/')} 중 하나여야 합니다`, corsHeaders);

  // Pathfinder 계측 — PATCH 전에 현재 status를 읽어 from_status로 쓴다.
  // 조회 실패해도 본 흐름은 계속(from_status만 null로 기록됨).
  let fromStatus = null;
  try {
    const before = await _l1GetDeptTask(env, taskId);
    fromStatus = before?.status || null;
  } catch { /* 무시 */ }

  let record;
  try {
    record = await _l1UpdateDeptTask(env, taskId, { status, result_note });
  } catch (e) {
    return _err(502, 'DEPT_TASK_UPDATE_FAILED', e.message, corsHeaders);
  }

  // Pathfinder 계측 — 실패해도 본 흐름(상태 전이 자체)은 이미 성공했으므로 응답은 막지 않는다
  try {
    await _l1CreateDeptTaskEvent(env, {
      task_id: taskId, from_status: fromStatus, to_status: status, at: new Date().toISOString(),
    });
  } catch (e) { console.warn('[pathfinder] event log failed', e); }

  return new Response(JSON.stringify({ ok: true, task_id: taskId, status }),
    { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}
```

## 4. 호출부 deps 주입 업데이트

**위치**: `worker.js` 10777행 부근

```javascript
// 기존
return handleDeptTaskUpdate(request, env, corsHeaders, taskId, { _err, _l1UpdateDeptTask });
// 수정
return handleDeptTaskUpdate(request, env, corsHeaders, taskId, {
  _err, _l1UpdateDeptTask, _l1GetDeptTask, _l1CreateDeptTaskEvent,
});
```

`handleDeptTaskCreate` 호출부(worker.js, `createDeptTaskCore` 호출 지점)에도 동일하게
`_l1CreateDeptTaskEvent`를 deps에 추가해야 한다.

## 5. GOV_TASK ↔ dept_tasks 연결 (선택, 이후 착수)

`dept_tasks.payload`(이미 JSON 필드)에 관례로 `origin_pdv_report_id`를 넣도록 문서화만
해두고, 스키마 마이그레이션은 불필요(자유 JSON 필드라 별도 컬럼 추가 없이 바로 사용 가능).
GOV_TASK 처리 로직에서 내부적으로 dept_task를 생성하는 지점이 있다면 그 호출부의
`payload`에 `{ ...payload, origin_pdv_report_id: pdvReportId }`를 추가하면 된다 — 다만
이번 실사에서는 GOV_TASK가 dept_task를 직접 생성하는 코드 경로를 확인하지 못했다(두 트랙이
분리돼 있다는 기존 발견과 일치). 이 연결이 실제로 필요하다면 어느 지점에서 시민 접수가
내부 부서 위임으로 이어지는지 먼저 확인해야 한다.

## 적용 순서 요약

1. `pb_migrations/1787400001_created_dept_task_events.js` 배포 (신규 컬렉션 생성)
2. `worker.js`에 `_l1GetDeptTask`, `_l1CreateDeptTaskEvent` 헬퍼 추가
3. `dept-task-handler.js`의 `createDeptTaskCore`, `handleDeptTaskUpdate` 수정
4. 두 호출부(`handleDeptTaskCreate`, PATCH 라우트)의 deps 객체 갱신
5. 배포 후 실제 상태 전이 1건을 만들어 `dept_task_events`에 행이 쌓이는지 확인
