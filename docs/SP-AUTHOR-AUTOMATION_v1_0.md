# SP-AUTHOR-AUTOMATION_v1_0.md
## SP-Author 자동화 — 다중 촉발 경로 + 정기 갱신 방법론

작성일: 2026-07-11 | 작성자: 주피터 지시, Claude 작성
전제: `/sp-author/queue`·`/sp-author/escalate`·`/sp-author/refresh-*` 엔드포인트(worker.js,
2026-07-11 신설)와 `sp_draft_requests`·`escalations`·`sp_refresh_schedule` 컬렉션(L1
PocketBase)이 이미 존재한다고 전제한다. 이 문서는 그 큐를 **무엇이 채우는가**(촉발 경로)와
**등록된 SP를 어떻게 계속 정교하게 유지하는가**(정기 갱신)를 다룬다.

SP-Author 자신(실제 조사·초안 작성)은 여전히 사람이 수행한다 — 이 문서는 "신호가 언제,
어떻게 생기는가"의 설계이지 SP-Author 프로세스 자체의 재설계가 아니다.

---

## 1부. 촉발 경로 (Trigger Sources)

기존에는 촉발 경로가 사실상 하나뿐이었다 — 대화 중 AC 또는 K-Compose가 실시간으로 태그를
내는 경우(`realtime_ac`, `kcompose_match_fail`). 이건 "누군가 한 번 물어봐야만" 공백이
드러나는 반응형 경로다. 아래 3개 경로를 추가해 공백을 더 일찍, 더 넓게 발견한다.

### 1-1. `realtime_ac` — 실시간 대화 신호 (기존)
AGENT-COMMON §3-0 ③이 대화 중 즉시 판단. `[SP_DRAFT_REQUEST: domain=..., request=...,
suggested_slug=...]`.

### 1-2. `kcompose_match_fail` — 오케스트레이션 매칭 실패 (기존, 2026-07-11 STEP 4-A로 연결)
K-Compose STEP 4-A가 match_score < 0.7로 후보를 전부 기각했을 때. `[GOV_SP_DRAFT_REQUEST:
institution=..., task=..., tier_hint=..., source_conversation=...]`.

### 1-3. `search_miss_pattern` — K-Search 반복 실패 패턴 (신설)
**문제의식**: 한 명이 "축산분뇨 감독기관"을 물어봐서 매칭 실패가 나면 그 한 번만 큐에
남는다. 그런데 여러 사람이 각자 다른 표현("분뇨 처리 신고", "축산 악취 민원", "가축분뇨
배출시설 허가")으로 같은 공백을 반복해서 건드리면, `kcompose_match_fail`이 매번 개별
레코드로 쌓이기만 하고 "이건 사실 하나의 진짜 공백"이라는 신호로 승격되지 않는다.

**설계**: 배치(일 1회 권장, cron 또는 GitHub Actions 스케줄) 작업이 `sp_draft_requests`에서
최근 7일간 `status=queued`인 레코드를 모아, `task` 필드의 의미적 유사도(임베딩 코사인
유사도 또는 LLM 클러스터링)로 그룹화한다. 같은 그룹이 **3건 이상**이면:
  - 그룹 내 첫 레코드를 대표로 남기고 나머지는 `status=duplicate`, `duplicate_of=`대표
    레코드ID로 병합 처리(`/sp-author/queue/:id/status`).
  - 대표 레코드의 `priority`를 `normal → high`로 승격.
  - `signal_source`는 원래 값을 유지하되(어차피 `realtime_ac`/`kcompose_match_fail`에서
    승격된 것이므로), 승격 자체를 알리는 `escalations` 레코드를 새로 만든다
    (`reason=sp_draft_request`, `summary="반복 매칭 실패 3건 이상 감지 — 우선순위 상향"`).

이 배치는 이 저장소 안에 실행기(cron)를 두지 않는다 — GitHub Actions 스케줄 워크플로가
`GET /sp-author/queue?status=queued`로 가져와 그룹화 로직을 실행하고
`POST /sp-author/queue/:id/status`로 반영하는 방식을 권장한다(worker.js는 무상태 HTTP
핸들러만 제공, 스케줄러는 저장소 밖).

### 1-4. `gov_data_monitor` — 공공데이터 모니터링 (신설)
**문제의식**: 신설되거나 개편된 정부기관(예: 새로 생긴 위원회, 명칭이 바뀐 부서)은 아무도
안 물어봐도 미리 알 수 있는 공백이다 — 실사용자가 걸려 넘어지기 전에 먼저 채우는 게
`kcompose_match_fail`(반응형)보다 낫다.

**설계**: 주 1회 배치가 공공데이터포털(data.go.kr)·행정안전부 조직도 API 등을 조회해
신설/개편 기관 목록을 가져온 뒤, `org_profiles`에 없는 기관명을 찾는다. 발견되면
`POST /sp-author/queue`로 직접 큐잉(`signal_source=gov_data_monitor`, `priority=low` —
아직 실사용자 수요가 확인 안 됐으므로 낮은 우선순위로 시작, `search_miss_pattern`이 나중에
같은 기관을 잡으면 `high`로 재승격됨).

### 1-5. `user_feedback` — 사용자 피드백 상관 (신설)
**설계**: 이용자가 "이 답변이 도움 안 됐다"(👎) 같은 피드백을 남긴 대화 중, AC의 응답에
"그 분야를 전담하는 AI가 없어" 류의 정직 고지 문구가 포함돼 있으면(§3-0 ③의 표준 안내
문구와 매칭), 그 대화를 `source_conversation`으로 삼아 자동 큐잉한다. 이건 이미 §3-0 ③에서
한 번 큐잉됐을 신호이므로, 실제로는 "그 큐 레코드의 우선순위를 사용자 불만 신호로
가중치를 준다"에 가깝다 — 새 레코드를 또 만들지 않고 기존 레코드를 찾아
(`institution`/`task` 매칭) `priority`만 올린다.

### 1-6. `admin_manual` — 관리자 수동 트리거 (신설)
주피터님(또는 위임 관리자)이 굳이 실사용자 신호를 기다리지 않고 직접
`POST /sp-author/queue`(`signal_source=admin_manual`)로 큐잉. 예: "이번에 신설된
탄소중립위원회는 곧 문의가 많을 것 같으니 미리 만들어두자."

### 1-7. `refresh_schedule` — 정기 갱신 (2부에서 상세)
기존 SP를 새로 만드는 게 아니라 갱신하는 신호. `request_type=update`, `target_sp_id` 필수.

---

## 2부. 정기 갱신 방법론 (Refresh Methodology)

### 2-1. 왜 필요한가
SP는 한 번 작성되면 멈춰 있지만, 세상은 안 멈춘다 — 기준중위소득·세율·법정한도 같은
날짜 있는 수치는 매년/분기 바뀌고, 조직개편으로 소관이 옮겨가고, 실사용 중 발견된
사고실험 결과가 쌓여도 원본 SP에 반영 안 되면 다음에 또 같은 문제가 재현된다. `worker.js`에
이미 `ORCHESTRATION_STALE_THRESHOLD_DAYS = 90`(procedure_maps의 as_of_date가 90일 넘으면
`freshness_warning`)라는 개념이 있었다 — 이 문서는 그 개념을 **SP 전체**로 확장한다.

### 2-2. 갱신 주기 결정 — 호출 빈도 기반 계층화
`sp_refresh_schedule.tier`를 아래 기준으로 배정한다(호출 빈도는 PDV 레코드의 `serviceId`
집계 또는 GWP 라우팅 로그에서 30일 집계, `call_count_30d`에 기록):

| tier | 기준(30일 호출수) | 갱신 주기 | 근거 |
|---|---|---|---|
| weekly | 상위 20% (예: 200회 이상) | 7일 | 고빈도 서비스는 오류 하나가 훨씬 많은 이용자에게 영향 — K-Health·K-Market·kgov/jeju 등 |
| monthly | 중위 60% (예: 20~199회) | 30일 | 대부분의 K-서비스·행정시/읍면동 SP |
| quarterly | 하위 20% (예: 20회 미만) | 90일 | 저빈도·특수 절차 SP(예: 희귀 케이스 전담) |

최초 배정 시 호출 이력이 없는 신규 SP는 `monthly`로 시작하고, 첫 30일 집계 후 재분류한다.
분류는 자동(위 표 그대로) — 사람이 매번 정하지 않는다. `POST /sp-author/refresh-schedule`
호출 시 `tier`를 넘기면 `next_due_at`이 자동 계산된다.

### 2-3. 갱신 트리거 — 스케줄 외의 조기 발동
정기 스케줄(`next_due_at` 도달)만 기다리지 않는다. 아래 중 하나라도 해당하면 즉시
`priority=high`로 갱신 큐잉한다(`drift_flag=true`, `drift_reason` 기록):
  - **수치 드리프트 감지**: SP 안에 날짜 있는 수치(기준중위소득·세율·법정한도 등)가 있고,
    §0-B 경로1(웹검색)로 확인했을 때 SP에 적힌 값과 실제 공식 발표치가 다름을 AC가 대화
    도중 우연히 발견한 경우 — 이 경우 AC는 즉시 `POST /sp-author/refresh-schedule`에
    `drift_flag=true`로 갱신 요청을 얹는다(§0-B 경로1 사용 원칙과 자연스럽게 결합됨).
  - **반복 사고실험 실패**: 같은 SP를 대상으로 `kcompose_match_fail`류 신호가 누적되면
    (1-3 참조) 그 SP 자체의 범위 재정의가 필요하다는 신호일 수 있다.
  - **관할 변경 뉴스**: `gov_data_monitor`(1-4)가 기존 등록 기관의 조직개편(명칭 변경,
    소관 이전)을 감지하면 `create`가 아니라 `update` 요청으로 처리한다.

### 2-4. 갱신 프로세스 — SP-Author PHASE UPDATE (신설, 기존 PHASE -1~E와 구분)
기존 SP-Author는 "신규 작성"(PHASE -1 클러스터링 → PHASE 0 관할판별 → PHASE B-0 입출력
파악 → PHASE C 역할·절차조사 → PHASE D 조립)만 상정했다. 갱신은 아래처럼 짧게 간다:

  1. **대조**: 기존 SP 본문과 `as_of_date`(있으면)를 읽는다.
  2. **재검증**: 날짜 있는 수치·법령 조문·기관 연락처 등 "시간이 지나면 틀릴 수 있는"
     항목만 골라 §0-B 경로1(웹검색)로 재확인한다 — SP 전체를 처음부터 다시 조사하지
     않는다(PHASE C 전체 재실행 아님, 비용 절감).
  3. **분기**:
     - 변경 없음 → `as_of_date`만 오늘 날짜로 갱신하고 `status`는 그대로(재검토 불필요,
       `pending_review`로 내리지 않는다 — K-Deliver의 기존 원칙과 동일하게 "구조 변경만
       재검토 유발").
     - 변경 있음(수치·절차·소관 등 실질 변경) → 변경분만 반영한 새 버전을 `pending_review`
       상태로 저장하고, 변경 전/후 diff 요약과 함께 `POST /sp-author/escalate`
       (`reason=sp_refresh_drift`)로 알린다. 사람이 승인해야 `active`로 전환된다 — 신규
       작성과 동일한 승인 원칙(HUMAN-AUTHORITY-GATE 정신 계승).
  4. **완료 기록**: `POST /sp-author/refresh-schedule`로 `last_refreshed_at`·`next_due_at`
     갱신.

### 2-5. 우선순위 조정 — "더욱 정교한 버전"으로
단순 수치 갱신을 넘어, 갱신 시점마다 그 SP를 대상으로 쌓인 실사용 정보를 함께 반영한다:
  - 그 SP로 라우팅됐던 대화 중 `kcompose_match_fail`(1-3)로 병합된 레코드들 — "이런 표현도
    이 SP가 받아야 했는데 못 받았다"는 사례 → SP의 트리거·설명 범위를 넓히는 데 반영.
  - `procedure_maps`의 `steps` 중 이 SP가 관여하는 절차가 실행 중 막힌 이력(K-Deliver의
    `pending_user_action` 누적 패턴) → SP 문서에 "이 단계는 자동화 안 됨, 이용자가 직접"을
    더 명확히 기재.

이렇게 하면 갱신이 단순 "날짜 최신화"에 그치지 않고, 매 주기 실사용 경험이 누적 반영되는
"더욱 정교한 버전"이 된다 — 이게 정기 갱신을 요청하신 핵심 취지다.

---

## 3부. 요약 — 무엇이 새로 생겼나

- 신호 소스 7종(`realtime_ac`/`kcompose_match_fail`/`search_miss_pattern`/`gov_data_monitor`/
  `user_feedback`/`admin_manual`/`refresh_schedule`)이 전부 같은 큐(`sp_draft_requests`)로
  모인다 — 어디서 왔든 처리 방식(사람의 검토·승인)은 동일하다.
- 큐잉과 동시에 최소 ESCALATE 알림(`escalations` 컬렉션)이 자동으로 남는다.
- 갱신 주기는 호출 빈도로 자동 계층화(주간/월간/분기)되고, 스케줄 외에도 드리프트 감지 시
  조기 발동된다.
- 이 문서에 설명된 배치(1-3, 1-4)·스케줄러(2-2)는 저장소 밖(GitHub Actions 등)에서 이
  세션에 신설된 HTTP 엔드포인트를 호출하는 방식을 전제한다 — worker.js 자체는 무상태
  핸들러만 제공하고 스케줄러 기능을 갖지 않는다(정직한 경계 — 실제 cron 워크플로 구현은
  별도 작업).
