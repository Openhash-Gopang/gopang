# worker.js 오케스트레이션 레지스트리 — 스키마 addendum (2026-07-08)

> 적용 대상: `worker_orchestration_registry_patch_2026-07-08.md`에 이미
> 정의된 `procedure_maps` 컬렉션. 개인파산 사고실험 #8(조건부 분기 미지원)
> ·#17(as_of_date 누락)을 반영한다. 컬렉션 스키마 2개 필드만 바뀐다 —
> 엔드포인트·`_executeAtom()` 함수 구조는 그대로다.

## 1. `procedure_maps.steps`에 `condition` 필드 추가

기존(원 패치):
```
steps (json — [{seq, atom_id, expert_advisor}])
```

교체:
```
steps (json — [{seq, atom_id, expert_advisor, condition}])
```

`condition`은 `null`(무조건 실행, 기존과 동일) 또는 조건식 객체다:

```json
{"seq": 8, "atom_id": "court-bankruptcy-manager-appoint",
 "expert_advisor": "lawyer",
 "condition": {"if": "재산 있음", "atom_id_ref": "court-filing.result.has_assets"}}
```

★ 개인파산 사고실험 #8(파산관재인 선임 여부가 재산 유무로 갈리는 것)이
이 필드가 필요한 이유를 정확히 보여준다 — `court-filing`(ADJUDICATE
패턴) 실행 결과에 "재산 있음/없음" 판정이 나오면, 그 값을 다음 step의
`condition.atom_id_ref`가 참조해 분기한다.

`_executeAtom()`(기존 패치 §3)의 실행 순서 로직에 아래를 추가한다:

```js
async function _runProcedureSteps(env, steps, userContext) {
  const results = {};
  for (const step of steps) {
    if (step.condition) {
      const refValue = _resolveConditionRef(results, step.condition.atom_id_ref);
      if (!_conditionMatches(step.condition, refValue)) continue; // 이 step 건너뜀
    }
    const atomRow = await _l1Find(env, 'atom_rows', { atom_id: step.atom_id });
    results[step.atom_id] = await _executeAtom(env, atomRow, userContext);
  }
  return results;
}
```

★ `_resolveConditionRef`/`_conditionMatches`는 이번 패치에서 시그니처만
정의한다(★ 미구현 ★) — 지금은 `court-filing` 같은 ADJUDICATE atom이
"재산 있음/없음" 같은 구조화된 결과를 실제로 반환하지 않으므로(사람이
법원에서 겪는 실제 절차라 결과가 즉시 안 나옴), 이 분기 자체가 아직
자동 실행될 수 없다. 스키마와 순회 로직만 준비해 두고, 조건 판정은
당분간 AC가 이용자와의 대화로 직접 확인해(예: "재산이 있으신가요?")
`results`에 수동으로 채워 넣는 방식으로 대체한다.

## 2. `procedure_maps`에 `as_of_date` 필드 추가

기존(원 패치)에는 `org_profiles`에만 있었다:
```
org_profiles: ... | as_of_date (date) | ...
procedure_maps: goal | domain | status | steps | eligibility_gate |
                free_alternative | orchestrator
```

교체:
```
procedure_maps: goal | domain | status | steps | eligibility_gate |
                free_alternative | orchestrator | as_of_date (date)
```

★ 개인파산 사고실험 #17(법이 2026.3.1 개정됐는데 status:active인
PROCEDURE_MAP이 그 이전 기준으로 굳어 있을 위험)이 이 필드가 필요한
이유다. `handleProcedureMapLookup`(원 패치 §3)에 아래 경고 로직을
추가한다:

```js
// procedure_maps 조회 시 as_of_date가 너무 오래됐으면 신선도 경고를
// 함께 반환한다(자동으로 재검토를 강제하지는 않는다 — 법 개정 여부
// 자체를 자동 감지하는 수단은 아직 없다, 별도 과제).
const STALE_THRESHOLD_DAYS = 90;
if (_daysSince(rec.as_of_date) > STALE_THRESHOLD_DAYS) {
  responseBody.freshness_warning = `이 절차 정보는 ${rec.as_of_date} 기준입니다 — 재검증 권장`;
}
```

## 3. 확인 사항

- [ ] `condition.atom_id_ref`가 참조하는 "atom 실행 결과"를 실제로
      구조화해 반환하는 atom은 아직 하나도 없다 — ADJUDICATE·DECISION
      패턴부터 결과 스키마를 정의해야 조건부 분기가 실제로 자동화된다
      (다음 순서 후보).
- [ ] `STALE_THRESHOLD_DAYS`(90일)는 임의로 정한 값이다 — 절차 성격에
      따라 다를 수 있다(법령 개정 빈도가 높은 절차는 더 짧게).
