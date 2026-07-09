# worker.js 오케스트레이션 레지스트리 — 스키마 addendum 2 (2026-07-08)

> 적용 대상: `worker_registry_schema_addendum_2026-07-08.md`까지 반영된
> 상태 위에 추가한다. 창업 준비 사고실험 20건 중 새 결함 2(condition
> 참조 대상 불분명)·새 결함 3(병렬 조합 표현 불가), 그리고
> `AGENT-COMMON_v3_39_addendum_0H.md`가 도입한 `sub_goal` 합성을
> 실제로 실행하는 로직을 반영한다.

## 1. `condition`에 `ref_type` 추가 (새 결함 2)

기존:
```json
{"if": "재산 있음", "atom_id_ref": "court-filing.result.has_assets"}
```

교체:
```json
{"if": "재산 있음", "ref_type": "atom_result", "ref": "court-filing.result.has_assets"}
```
또는
```json
{"if": "법인", "ref_type": "initial_input", "ref": "business_type"}
```

`_resolveConditionRef()`를 분기하도록 갱신한다:

```js
function _resolveConditionRef(results, initialInput, condition) {
  if (condition.ref_type === 'initial_input') {
    return initialInput[condition.ref]; // 이용자가 0-H-1 시점에 답한 값
  }
  // 기본값(ref_type 생략 시 하위호환): atom_result
  return _resolveFromAtomResults(results, condition.ref);
}
```

`initialInput`은 §0-H 0-H-1(발화 판별) 시점에 AC가 확보한 이용자 답변
(예: "법인으로 하실 건가요, 개인사업자로 하실 건가요?"에 대한 답)을
`_runProcedureSteps()` 호출 시 함께 넘기는 파라미터다 — 원 패치의
`userContext`에 이미 있던 자리에 구조만 명확히 한다.

## 2. `steps`에 `parallel_group` 추가 (새 결함 3)

```json
{"seq": 5, "atom_id": "biz-registration-cafe", "parallel_group": "A"}
{"seq": 6, "atom_id": "biz-registration-online", "parallel_group": "A"}
{"seq": 7, "atom_id": "4insurance-enrollment", "parallel_group": null}
```

같은 `parallel_group` 값을 가진 step들은 순서 무관, 동시 실행 대상이다
(`null`은 기존과 동일하게 순차). `_runProcedureSteps()`를 갱신한다:

```js
async function _runProcedureSteps(env, steps, userContext, initialInput) {
  const results = {};
  const groups = _groupBySequenceOrParallel(steps); // [step] 또는 [step,step,...] 단위 배열
  for (const group of groups) {
    const groupResults = await Promise.all(
      group.filter(s => !s.condition || _conditionMatches(
          s.condition, _resolveConditionRef(results, initialInput, s.condition)))
        .map(async (step) => {
          if (step.sub_goal) return [step.sub_goal, await _executeSubGoal(env, step.sub_goal, userContext, initialInput)];
          const atomRow = await _l1Find(env, 'atom_rows', { atom_id: step.atom_id });
          return [step.atom_id, await _executeAtom(env, atomRow, userContext)];
        })
    );
    for (const [key, val] of groupResults) results[key] = val;
  }
  return results;
}
```

## 3. `sub_goal` 재귀 실행 + 순환 참조 검증

```js
async function _executeSubGoal(env, goalName, userContext, initialInput, _visited = new Set()) {
  if (_visited.has(goalName)) {
    throw new Error(`순환 참조 감지: ${[..._visited, goalName].join(' → ')}`);
  }
  _visited.add(goalName);

  const rec = await _l1Find(env, 'procedure_maps', { goal: goalName });
  if (!rec) throw new Error(`sub_goal 미등록: ${goalName}`);
  // sub_goal도 pending_review 상태 규칙(0-H-2)을 그대로 따른다 — 검토
  // 안 된 하위 목표를 조용히 실행하지 않는다.
  return _runProcedureSteps(env, rec.steps, userContext, initialInput /* , _visited 전달 */);
}
```

★ 순환 참조 검증은 실행 시점(runtime)에만 걸려 있다 — `PROCEDURE_MAP_
DRAFT`(신규 등재) 시점에 미리 정적으로 검사하는 게 더 안전하지만
이번 패치 범위에서는 실행 시점 검사만 구현했다(★ 다음 순서 후보 —
등재 시점 정적 검사★).

## 4. 확인 사항

- [ ] `initialInput`을 AC가 정확히 언제·어떤 형태로 `_runProcedureSteps`
      호출부에 넘기는지는 §0-H 쪽 태그 스펙(0-H-4 실행 호출)에 아직
      명시가 없다 — AGENT-COMMON 쪽 다음 패치에서 맞춰야 한다.
- [ ] `sub_goal`이 가리키는 목표가 `status:miss`(아예 없음)면 어떻게
      되는지는 정의 안 됐다 — 아마 0-H-3(최초 조사)를 그 목표로 다시
      트리거해야 하는데, 이건 서버 함수(`_executeSubGoal`)가 아니라
      AC(대화형 판단이 필요한 조사)의 몫이라 서버 쪽에서 자동으로
      처리할 수 없다 — 에러를 던지고 AC가 받아 처리하게 하는 지금
      설계가 맞는지 재검토 필요.
