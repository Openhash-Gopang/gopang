# 부서/기관/사업자 간 업무지시 프로토콜 v1.1 (DEPT_TASK)

> **작성일:** 2026-07-12 (v1.1: 2026-07-12 재설계) | **관련 문서:** `SP-INTERCALL-PROTOCOL_v1_0.md`,
> `GOV_TASK`(worker.js `/gov/task/submit`) | **구현 위치:**
> `pb_migrations/1784200001_created_dept_tasks.js`, `src/worker/dept-task-handler.js`,
> `worker.js`(handleGovRelay/handleBusinessRelay 서버측 감지, L1 헬퍼), `call-ai.js`(보조 경로)

## 0. v1.1 재설계 — 왜 바뀌었나

v1.0은 `call-ai.js`(gopang 시민 채팅 클라이언트)가 `[DEPT_TASK_REQUEST]` 태그를 감지해
`/gov/dept-task`를 호출하는 걸 전제로 짰다. 그런데 실제 jeju_do/jeju_national SP는
`jeju.hondi.net`(별도 저장소 `Openhash-Gopang/jeju`)에서 서빙되고, 그 클라이언트는
`call-ai.js`를 전혀 쓰지 않는다 — U9(SP_CALL)이 `handleGovRelay` 서버 안에서 직접
처리되는 것과 달리, v1.0의 DEPT_TASK_REQUEST는 **실제 기관 세션에서는 절대 실행될 수
없는 죽은 경로**였다(2026-07-12 100건 사고실험 이후 재검토 중 발견).

v1.1은 `sp_call`과 동일한 원칙으로 `handleGovRelay`/`handleBusinessRelay`가 LLM 응답에서
태그를 **서버 안에서 직접** 감지·처리하도록 바꿨다. 부수 효과로 서명 문제(§4-1 옛 버전이
지적한 한계)도 상당 부분 해소됐다 — dept/org 요청자는 이제 "서명"이 아니라 "이 요청이
실제로 서버가 그 agency/bizKey로 로드해준 세션 안에서 나왔다"는 사실로 인증된다
(`createDeptTaskCore`의 `authoritativeAgency` — 순수 HTTP POST로는 dept/org 요청자를
자칭할 수 없다, 아래 §3 참고).

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
  **business/citizen 요청자만** 이 경로로 직접 생성 가능(서명 필수). dept/org 요청자는
  이 경로로는 항상 거부됩니다 — `handleGovRelay`/`handleBusinessRelay`가 LLM 응답의
  `[DEPT_TASK_REQUEST]` 태그를 서버 내부에서 감지해 `createDeptTaskCore`를 직접 호출하는
  경로로만 생성됩니다(§0 참고, sp_call과 동일한 서버측 감지 패턴).
- `PATCH /gov/dept-task/:id` — 대상 측이 상태 전환. `{status, result_note?}`

## 4. 알려진 한계 (KNOWN_LIMITATIONS)

1. **[v1.1 부분 해소] dept/org 요청자 신뢰 모델이 "서명"에서 "세션 인증"으로 바뀌었습니다.**
   순수 HTTP POST(`/gov/dept-task` 직접 호출)로는 dept/org 요청자를 더 이상 자칭할 수
   없습니다 — `createDeptTaskCore`가 `authoritativeAgency`(서버가 `handleGovRelay`/
   `handleBusinessRelay` 내부에서 이미 알고 있는 실제 agency/bizKey) 없이는 무조건
   거부합니다. **단, 남은 잔여 위험이 있습니다**: jeju_do 세션 "안"에서 실제로 도청과
   대화하던 사람이 JEJU_CHAIN을 특정 부서(예: jachi)로 유도한 뒤 그 부서를 자칭해
   부적절한 지시를 내리는 것까지는 막지 못합니다 — 그 세부 부서 배정 자체가 클라이언트
   (jeju-router.js `resolveJejuAgency`)에서 검증 없이 결정되기 때문입니다. 100건
   사고실험 v3의 B-6 #99가 이 잔여 위험의 구체적 사례입니다. U10-6(UNIVERSAL-common)이
   최소한 "개인정보 조회 목적으로는 이 절차를 쓰지 않는다"는 프롬프트 차원 제약을
   추가했지만, 서버 차원의 근본 해결은 아닙니다.
2. **city-dept 26개는 do-dept와 동일 domain 체계를 그대로 복제해 등록했습니다** — 실제
   `city-dept-master-data.json`에 없는 조합(예: 특정 시에 없는 국)도 taxonomy상으로는
   통과합니다. 실제 조직표와의 정합성 검증은 후속 작업입니다.
3. **[v1.1 갱신] SP 텍스트 트리거는 jeju_do 하나만 시범 반영됐고, 나머지 07-org 27개·
   national·k-service SP는 여전히 개별 트리거 지침이 없습니다.** 다만 v1.1에서
   UNIVERSAL-common U10-5를 신설해, 개별 SP마다 매핑표를 만드는 대신 **식별자 접두어
   구조 하나만 설명하고 나머지는 SP 자신의 조직 지식·추론으로 판단**하게 하는 일반화된
   접근으로 바꿨습니다 — jeju_do §4-1 같은 구체적 표가 없는 조직도 원칙적으로는 이
   기능을 쓸 수 있어야 합니다(단, 실제로 잘 작동하는지는 아직 실사 검증 전입니다 —
   다음 100건 사고실험에서 07-org 하나를 골라 확인 권장).
4. **§0-G(응급) 상황에서 재위임이 필요할 수 있는데(예: K-119→K-Health 병상 확보 실패 시
   재위임) `SP_DELEGATION_REGISTRY` 쪽 재위임 금지 원칙과 이 큐의 관계가 정리돼 있지
   않습니다.** 응급은 이 큐(비동기)보다 SP_CALL(동기, 즉시 응답)이 맞는 경우가 많아 보이나,
   확정하지 않았습니다 — 다음 설계 검토 대상입니다.

