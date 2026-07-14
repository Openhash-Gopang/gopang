# GOV_TASK 병렬·팬아웃 처리 모델 v1.0 (GOV_TASK_FANOUT)

> **작성일:** 2026-07-13 | **근거:** GAP-LIST-50 B-3, AC-EVOLUTION-GAPS
> #15 | **관련 문서:** `DEPT-TASK-PROTOCOL_v1_1.md`(순환위임 방지 등
> 신뢰모델 재사용), `SP-19_kintent`·`SP-20_kcompose`·`SP-21_kdeliver`
> (오케스트레이션 3단), `HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md` G11(장기
> 절차 단계관리 — 이 문서와는 다른 축, 아래 §5 참고)
> **구현 위치:** `worker.js`(`handleGovTaskSubmit`·
> `handleGovTaskBatchStatus`), `prompts/SP-20_kcompose_v1.3.txt` STEP
> 4-P, `prompts/SP-21_kdeliver_v1.0.txt` STEP 1

## 0. 무엇을 풀었나

GAP-LIST-50 B-3(2026-07-08)가 지적한 공백: "지금까지 GOV_TASK는 전부
'기관 하나와 순차 대화'를 전제한다. 여러 부서 동시 협의(건축허가)나
한 사건을 여러 기관에 동시 통지(폐업신고→세무서+국민연금+건강보험)
하는 구조는 설계에 없다."

## 1. 핵심 재정의 — "병렬"은 물리적 동시실행이 아니다

이 시스템은 턴 단위 LLM 호출로 동작하고, 외부 위임 태그
([CALL_GOVSYS]·[KSEARCH_HANDOFF] 등)는 그 자체가 한 턴을 끝내고
응답을 기다린다. 진짜 동시성(여러 기관 API를 동시에 non-blocking으로
호출)은 이 아키텍처에서 근본적으로 불가능하다.

**그래서 "병렬"을 "순서 의존관계가 없다"로 재정의한다.** 여러 턴에
걸쳐 순서대로(1번 기관 처리 → 2번 기관 처리 → ...) 실행하더라도,
그 순서 자체가 결과에 영향을 주지 않으면 이 문서가 다루는 "병렬"
범주에 든다. 반대로 A의 결과가 B의 입력이 되는 경우(순차 의존)는
이 문서 범위가 아니다 — 기존 PROCEDURE_MAP의 순차 steps로 충분하다.

## 2. 두 가지 팬아웃 유형

```
notify (통지형) — 서로 독립, AND 조건 아님
  예: 폐업신고 → 세무서 + 국민연금공단 + 건강보험공단에 각각 통지
  하나가 실패해도 나머지는 그대로 유효. 재시도 대상은 실패한 것만.

join (협의형) — AND 조건, 전원 완료돼야 상위 목표 완료
  예: 건축허가 = 건축과 + 소방서 + 환경과 전원 승인 필요
  하나라도 거부되면 상위 목표 전체가 partial_denied.
  이미 승인된 기관 결과는 취소된 것처럼 왜곡하지 않는다(사실은 사실대로).
```

## 3. 데이터 모델

기존 `gov_task_submission`(PDV 기록, `handleGovTaskSubmit`이 생성)에
필드 2개만 추가했다 — 새 컬렉션을 만들지 않았다:

```
gov_task.batch_id     — 같은 팬아웃 그룹에 속한 제출들의 공통 식별자
gov_task.fanout_mode  — 'notify' | 'join' | null(팬아웃 아님, 기존과 동일)
```

`batch_id`가 없으면(기존 단일 제출) 완전히 기존과 동일하게 동작한다
— 하위호환 100% 유지.

## 4. 실행 흐름

1. K-Compose(SP-20 STEP 4-P)가 PROCEDURE_MAP에서 같은 `parallel_group`
   을 가진 step들을 발견하면 `batch_id`를 하나 생성.
2. 그룹 내 각 step을 (턴 제약상 순서대로, 그러나 순서 무관하게) 실행,
   각 `[CALL_GOVSYS]`/GOV_TASK 제출에 같은 `batch_id`+`fanout_mode`를
   실어 보낸다.
3. 매 step 완료 시 `[ORCHESTRATION_PROGRESS]`로 "N개 기관 중 M번째
   처리 중"을 알린다(기존 진행상황 태그 재사용, 신규 태그 아님).
4. 그룹을 다 처리하면 `POST /gov/task/batch-status`
   `{guid, batch_id}`로 집계 조회 → `overall_status`
   (complete|partial|in_progress) 획득.
5. K-Deliver(SP-21 STEP 1)가 `batch_status`를 받아 기관별로 정확하게
   전달(뭉뚱그리지 않음).
6. G2(사실확인)·G3(승인) 그대로 적용 — 실패·거부 건을 AI가 자동
   재시도·이의신청하지 않는다.

## 5. G11(장기절차 단계관리)과의 관계 — 다른 축

`HUMAN-AUTHORITY-GATE-SCHEMA` G11은 **한 기관 안에서** 여러 단계를
거치는 장기절차(예: 5단계짜리 건축허가 심사)를 다룬다 — "단일 기관,
다단계, 순차"다. 이 문서는 **여러 기관에** 걸친 팬아웃을 다룬다 —
"다중 기관, 병렬(순서무관)"이다. 실제로는 두 축이 겹칠 수 있다(건축과
자체 심사가 5단계 G11 절차이면서, 동시에 소방서·환경과와 join
팬아웃 관계일 수 있음) — 이 경우 join 그룹의 개별 member 하나하나가
각자 G11 다단계 절차를 가질 수 있다는 뜻으로, 서로 배타적이지 않고
중첩 가능하다.

## 6. 알려진 한계 (KNOWN_LIMITATIONS)

1. **`join` 모드의 "거부" 판정 배선이 아직 없다.** `handleGovTaskSubmit`
   자체는 `accepted`/`pending_documents`만 낸다 — 기관이 명시적으로
   "거부"하는 액션(PATCH 등)이 이 구현 범위에 없다. 그래서 지금은
   `join` 그룹이 전원 `accepted`가 되기 전까지 항상 `in_progress`로만
   보이고, `partial_denied`를 실제로 낼 방법이 없다. 거부 판정 배선은
   후속 과제.
2. **`gov_tickets`(HUMAN-AUTHORITY-GATE-SCHEMA가 참조하는 컬렉션)는
   이 저장소(gopang)에 없다** — 실사 결과 jeju_do/jeju_national SP가
   서빙되는 별도 저장소(`Openhash-Gopang/jeju`)에 있을 가능성이 높다.
   이 문서가 다루는 `gov_task_submission`(PDV 기록 기반)은 그것과
   다른, 이 저장소 안에서 실제로 동작하는 더 단순한 구현이다 — 두
   시스템을 혼동하지 않는다.
3. **`batch_id` 중복 방지·상한이 없다.** DEPT-TASK-PROTOCOL의
   `MAX_DEPT_TASK_CHAIN`·순환위임 방지 같은 안전장치를 이 팬아웃
   모델에는 아직 도입하지 않았다 — 실사용 빈도가 확인되면 재검토.
4. **K-Compose STEP 4-P가 실제로 발동하는 시나리오가 아직 실행
   검증되지 않았다** — 이 문서와 코드는 설계·구현 단계이고, GAP-LIST-50
   과 동일한 신뢰도 구분을 적용하면 B급(가설)이다.

---
*v1.0 (2026-07-13) — 최초 작성. notify/join 두 팬아웃 유형 정의,
batch_id/fanout_mode를 기존 gov_task_submission에 무손실 추가(신규
컬렉션 없음), K-Compose STEP 4-P·K-Deliver STEP 1 반영. join 거부
판정 배선은 후속 과제로 명시.*
