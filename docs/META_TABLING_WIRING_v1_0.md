# META_TABLING 배선 + 기존 성과측정 체계와의 관계 정리 v1.0

> **작성일:** 2026-07-14 | **근거:** 주피터님 지시("이미 AC가 SP에게
> 요청을 전달한 시각·이행과정·완료시각을 표시하도록 추가했다, 찾아
> 보라") — `AGENCY-AC-COMMON_v1.3.md` §6(META_TABLING)이 이미 그
> 스키마를 정의해뒀고 "백엔드 배선 필요"로 표시돼 있던 것을 발견,
> 이번에 배선했다.

## 0. 두 시스템이 있다 — 충돌이 아니라 다른 층위

같은 지시("기관 효율성을 비교 측정")가 서로 다른 두 세션에 내려가서,
각각 독립적으로 대응하는 설계를 만들었다. 겹치는 것처럼 보이지만
실제로는 **재는 대상의 범위가 다르다**:

| | `STAFF_TASK_QUEUE_v1_0.md`(내가 먼저 만든 것) | `META_TABLING`(AGENCY-AC-COMMON §6, 이번에 배선) |
|---|---|---|
| 재는 대상 | **공식 업무지시**(`dept_tasks`) — 부서 간, 부서→직원 | **그 기관이 받은 모든 요청**(민원·기관간 문의 전체) |
| 원본 저장소 | `dept_tasks` 컬렉션(기존 재사용) | `meta_table_records`(신규) |
| 트리거 | `DEPT_TASK_REQUEST` 태그 | `META_TABLE_UPDATE` 태그(AGY_REPORT와 함께) |
| 시각 필드 | `created`/`updated`(PocketBase 기본) | `received_ts`/`processing_started_ts`/`completed_ts`(§6 지정) |

둘 다 유효하고 필요하다 — `dept_tasks`는 "부서끼리 공식적으로
주고받은 지시"만 잡고, 일반 민원(예: "상하수도 요금 문의")은 애초에
`dept_tasks`를 거치지 않으므로 META_TABLING이 없으면 그 실적이
전혀 안 잡힌다. 장기적으로는 두 스키마를 하나의 상위 리포팅
레이어로 합칠 수도 있겠지만, 이번 범위에서는 **별개 시스템으로
공존**시켰다 — 억지로 합치면 원본이 서로 다른 스키마(하나는 상태
전이 기반, 하나는 3시각 기반)를 무리하게 욱여넣는 꼴이 된다.

## 1. 배선한 것

- `pb_migrations/1784900001_created_meta_table_records.js` — §6이
  정의한 스키마(`agency_id`/`category`/`task_type`/`dept_chain`/
  `outcome`/`received_ts`/`processing_started_ts`/`completed_ts`/
  `duration_seconds`) 그대로 컬렉션화.
- `worker.js`의 `handleGovRelay`에 `[META_TABLE_UPDATE: ...]` 태그
  감지 신설 — `canDelegate` 게이트와 무관하게(위임 여부와 상관없이
  모든 기관 세션에) 적용, 응답 흐름을 막지 않고(얼리리턴 없음) 태그만
  벗겨내고 기록은 비동기로 흘려보낸다.
- `_parseMetaTableTag` — `key=value, key2=[a,b,c]` 형식 파서(대괄호
  안 콤마는 분리 기준에서 제외).
- `GET /stats/agency-report?agency_id=X&period=weekly|monthly|
  quarterly|halfyear|yearly` — §6이 요구한 주기별 보고서. 카테고리별
  건수·완료율·평균 처리시간을 즉석 집계한다.
- **접근권한**: `/stats/org`(기관 간 비교)와 동일한 준공개 원칙을
  그대로 적용했다 — 같은 "기관 효율성" 개념이면 접근권한도 일관돼야
  한다는 판단.

## 2. KNOWN_LIMITATIONS

1. **즉석 집계다, §6이 말한 "배선단 배치 집계 작업"이 아니다** —
   요청이 올 때마다 `meta_table_records`를 필터링해 그 자리에서
   합산한다. 트래픽이 커지면(레코드 수만 건 이상) 느려질 수 있어,
   원 설계(누적 레코드를 배치 잡이 주기적으로 미리 집계)로 옮길
   필요가 있다.
2. **`agency_id` 형식이 검증되지 않는다** — `DEPT_TASK_TAXONOMY`처럼
   고정 목록 대조를 안 했다(AGENCY-AC-COMMON 쪽 기관 식별자 체계가
   이 저장소의 taxonomy와 완전히 같은지 확인이 안 된 상태라, 일단
   그대로 신뢰). 나중에 두 taxonomy를 통일할 필요가 있을 수 있다.
3. **`META_TABLE_UPDATE` 태그가 실제로 몇 번 나오는지 실행 검증
   안 됨** — AGENCY-AC-COMMON 쪽 SP들이 이 태그를 실제로 얼마나
   충실히 내는지는 이 저장소에서 확인할 수 없다(그쪽은 별도
   저장소·세션의 책임 범위).
4. **STAFF_TASK_QUEUE와의 통합은 후속 과제** — §0에서 설명한 대로
   당장은 별개 시스템. 실사용 데이터가 쌓이면 통합 리포팅 레이어
   설계를 재검토할 만하다.

---
*v1.0 (2026-07-14) — META_TABLING 백엔드 배선 완료. STAFF_TASK_QUEUE
와 중복이 아니라 상호보완 관계임을 명시(§0). 즉석 집계 방식의 한계와
후속 통합 가능성을 KNOWN_LIMITATIONS에 남김.*
