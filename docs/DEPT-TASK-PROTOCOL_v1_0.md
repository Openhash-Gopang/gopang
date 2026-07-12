# 부서/기관/사업자 간 업무지시 프로토콜 v1.0 (DEPT_TASK)

> **작성일:** 2026-07-12 | **관련 문서:** `SP-INTERCALL-PROTOCOL_v1_0.md`, `GOV_TASK`(worker.js
> `/gov/task/submit`) | **구현 위치:** `pb_migrations/1784200001_created_dept_tasks.js`,
> `src/worker/dept-task-handler.js`, `worker.js`(라우팅·L1 헬퍼), `call-ai.js`
> `_handleDeptTaskTag`

## 1. 왜 필요한가

100건 업무지시 사고실험(B그룹, 2026-07-12)에서 도청 부서 대 부서(B-1), 07-org·민간 사업자 대
행정기관(B-4/B-5) 지시 30건 중 18건(60%)이 기존 두 메커니즘 어디에도 해당하지 않는다는 게
확인됐습니다:

- `SP_DELEGATION_REGISTRY`/`handleGovRelay` — 한 턴짜리 LLM 컨텍스트 합성(질의 응답용).
  jeju_do/jeju_national/health/police 등 "총괄" 9~10개 대상만 등록 가능하고, 영속 기록이 없어
  "지시가 실제로 이행됐는지" 추적이 안 됩니다.
- `GOV_TASK` — 요청자가 항상 시민 개인 1명으로 고정, 대상 기관도 이미 정해진 1곳 — 부서나
  법인이 요청자가 되는 경로 자체가 없습니다.

## 2. 설계 원칙

```
원칙 1: 지시는 영속 레코드다 — 세션이 끝나도 남아야 한다
  dept_tasks 컬렉션에 상태(requested→acknowledged→in_progress→completed/rejected)로
  남긴다. SP_CALL처럼 한 턴 안에 사라지지 않는다.

원칙 2: 등록된 대상만 지시를 받을 수 있다 (SP-INTERCALL 원칙4 계승)
  DEPT_TASK_TAXONOMY(do-dept 12, do-agency 10, city-dept 26, 07-org 27, national 28,
  k-service 10)에 없는 target_id는 무조건 거부한다. business만 예외 — 고정 목록 대신
  L1 profiles 실존 여부 + claim_status(unclaimed면 거부, A-11과 동일 원칙)로 검증한다.

원칙 3: 순환 위임은 origin_chain으로 막는다
  이미 경유한 target_id가 다시 등장하면 거부(HTTP 409). 체인 길이 상한
  MAX_DEPT_TASK_CHAIN=4(SP_CALL의 MAX_SP_HOPS=2보다 넉넉함 — 비동기라 LLM 비용
  폭주 리스크가 없고, 행정 실무상 2단계 이상 재위임이 흔하기 때문).

원칙 4: 이 큐는 업무를 "수행"하지 않는다 — 기록·추적만 한다
  status를 completed로 바꾸는 건 대상 측의 명시적 PATCH뿐이다. AC가 자동으로
  완료 처리하는 코드는 어디에도 없다(HUMAN-AUTHORITY-GATE와 동일 사상).
```

## 3. API

- `POST /gov/dept-task` — 지시 생성. `{requester_type, requester_id, requester_label?,
  target_type, target_id, task_type, directive, payload?, origin_chain?, pubkey?, signature?}`
  business/citizen 요청자는 서명 필수, dept/org는 서명 없음(§4 한계 참조).
- `PATCH /gov/dept-task/:id` — 대상 측이 상태 전환. `{status, result_note?}`

## 4. 알려진 한계 (KNOWN_LIMITATIONS)

1. **dept/org 요청자는 서명 검증이 없습니다.** 개인 키페어 개념이 없는 "부서"가 요청자일 때,
   그 요청이 실제로 그 부서 시스템에서 온 것인지 서버가 검증할 방법이 지금은 없습니다 —
   `jeju_do` delegation을 "누구나 접근 가능한 관할 SP"로 취급하는 기존 설계(worker.js)와
   같은 수준의 신뢰 모델입니다. 악용 가능성이 있다고 판단되면, dept/org 요청자에도 별도
   인증(예: 내부망 IP 화이트리스트, 기관용 API 키)을 추가해야 합니다.
2. **city-dept 26개는 do-dept와 동일 domain 체계를 그대로 복제해 등록했습니다** — 실제
   `city-dept-master-data.json`에 없는 조합(예: 특정 시에 없는 국)도 taxonomy상으로는
   통과합니다. 실제 조직표와의 정합성 검증은 후속 작업입니다.
3. **SP 텍스트(각 기관 SP 프롬프트) 쪽에 `[DEPT_TASK_REQUEST]` 태그를 실제로 언제 낼지에 대한
   지침이 아직 없습니다.** 이번 구현은 배선(엔드포인트·검증·큐)까지만 완료했고, "도청
   기획조정실 SP가 어떤 상황에서 이 태그를 내야 하는가"는 각 기관 SP 프롬프트를 개별적으로
   갱신해야 하는 별도 작업입니다 — 지금 이 태그를 실제로 낼 SP는 하나도 없습니다(배선은
   됐지만 아직 아무도 안 씀). GOV_TASK가 SP-10_kpublic v3.6에 §REQUIRED-DOCUMENTS로 지침을
   박아뒀던 것과 같은 작업이 기관별로 필요합니다.
4. **§0-G(응급) 상황에서 재위임이 필요할 수 있는데(예: K-119→K-Health 병상 확보 실패 시
   재위임) `SP_DELEGATION_REGISTRY` 쪽 재위임 금지 원칙과 이 큐의 관계가 정리돼 있지
   않습니다.** 응급은 이 큐(비동기)보다 SP_CALL(동기, 즉시 응답)이 맞는 경우가 많아 보이나,
   확정하지 않았습니다 — 다음 설계 검토 대상입니다.
