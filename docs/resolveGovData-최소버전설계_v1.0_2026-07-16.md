# resolveGovData 최소 버전 설계 — 스코어링 대신 단순규칙 + 로깅

작성일: 2026-07-16
선행 문서: `GOV_OPEN_DATA_MAP-통합설계_v1.0_2026-07-16.md`
결정 사항: 정교한 스코어링 알고리즘을 지금 만들지 않는다. 실사용 로그가 쌓이기 전까지는
**"단순 규칙 2~3개 + 확신 없으면 무조건 사람에게 넘김 + 전체 로깅"**으로 최소 버전을 만들고,
이후 로그를 근거로 2단계에서 스코어링을 정교화한다.

---

## 1. 왜 정적 매핑이 아니라 실시간 리졸버인가 (전제)

트랙4 6건, 57건 매핑표는 혼디가 실제로 받을 질의 전체를 대표하지 못한다(KOSIS만 4만 표 이상,
공공데이터포털 11만 건 이상). 사람이 미리 엔트리를 채우는 방식은 이 규모와 맞지 않는다.
`GOV_OPEN_DATA_MAP`은 사람이 채우는 설정 파일이 아니라, 실행 중 스스로 채워지는 캐시로
동작해야 한다 — 오늘 확인한 6건도 이 캐시의 첫 항목일 뿐이다.

---

## 2. 처리 흐름

```
resolveGovData(query_context)
  query_context = { raw_query, requester_type: 'gov-sp' | 'k-public', scope_hint? }

  1. 캐시 조회
     cacheKey = normalize(query_context.raw_query 또는 scope_hint)
     hit → 곧장 §5(데이터 조회)로

  2. 캐시 미스 → KOSIS 통합검색 API 호출 (statisticsSearch.do)
     (공공데이터포털 등 타 소스 확장은 2단계 과제 — 지금은 KOSIS만)

  3. 단순 규칙 필터링 (스코어링 아님, 순차 배제 규칙)
     규칙 A: REC_TBL_SE = 'Y'(세부항목표)는 1차 후보에서 제외
             — 원자료 상세표라 요청 의도(지역단위 집계)와 안 맞는 경우가 대부분
     규칙 B: 검색어와 TBL_NM에 형태소 기준 완전포함 관계가 없는 항목 제외
             (예: "1인가구비율" 검색에 "1인가구" TBL_NM은 포함, "가구소득"은 제외)
     규칙 C: 동일 STAT_ID 중복 시 최신 END_PRD_DE(자료 최종연도) 항목만 유지

  4. 필터링 후 후보 개수로 분기
     - 0건 → status: 'not_found', §6(에스컬레이션)로
     - 1건 → 충분히 명확 → §5(데이터 조회)로
     - 2건 이상 → status: 'ambiguous', §6(에스컬레이션)으로
       (정교한 우선순위 규칙으로 자동 선택하지 않는다 — 이게 이번 설계의 핵심 결정)

  5. 데이터 조회 및 캐싱
     확정된 org_id/tbl_id로 실제 통계자료 조회 → GOV_OPEN_DATA_MAP에 신규 entry로 저장
     (source_type: 'kosis', status: 'confirmed') → 다음부터는 캐시 히트

  6. 에스컬레이션 (not_found 또는 ambiguous)
     - requester_type = 'gov-sp' → 기존 §3(공무원직무보조계획) "담당자_확인_필요" 플래그 재사용,
       후보 목록(또는 없음)을 그대로 담당자에게 넘김
     - requester_type = 'k-public' → 사용자에게 "정확히 어떤 통계를 찾으시나요?" 되묻거나,
       후보가 있으면 "OO 통계로 추정되나 확실하지 않습니다" 캐비엇과 함께 제공하고
       KOSIS 검색 페이지 링크를 함께 제공 (그럴듯하게 틀린 단정 금지)
```

## 3. 로깅 스키마

2단계 스코어링 정교화의 근거 데이터가 되므로, 검색 시도마다 빠짐없이 기록한다.

```javascript
GOV_DATA_RESOLVE_LOG = {
  timestamp,
  raw_query,
  requester_type,
  kosis_search_candidates,   // 필터링 전 원본 후보 전체 (TBL_NM, ORG_ID, TBL_ID, REC_TBL_SE)
  filtered_candidates,       // 규칙 A/B/C 적용 후 남은 후보
  outcome,                   // 'confirmed' | 'ambiguous' | 'not_found'
  selected_entry_id,         // outcome='confirmed'일 때만
  human_override,            // 에스컬레이션된 경우 사람이 최종 선택한 항목 (나중에 채워짐)
}
```

`human_override`가 핵심이다 — 이 필드가 쌓여야 "사람이 실제로 어떤 후보를 골랐는지"를 근거로
2단계 스코어링 가중치를 정할 수 있다. 지금 단계에서는 이 필드를 채우는 것 자체가 목적이지,
자동화가 목적이 아니다.

## 4. 코드 스켈레톤

```javascript
async function resolveGovData(queryContext, env) {
  const cacheKey = normalize(queryContext.raw_query || queryContext.scope_hint);
  const cached = await env.HONDI_KV.get(`gov-data:${cacheKey}`, 'json');
  if (cached) return fetchStatData(cached.entry, env);

  const rawCandidates = await searchKosis(queryContext.raw_query, env.KOSIS_API_KEY);

  // 규칙 A/B/C — 스코어링이 아니라 배제 규칙 순차 적용
  let candidates = rawCandidates.filter(c => c.REC_TBL_SE !== 'Y');
  candidates = filterByMorphemeMatch(candidates, queryContext.raw_query);
  candidates = dedupeByLatestPeriod(candidates);

  const log = {
    timestamp: Date.now(),
    raw_query: queryContext.raw_query,
    requester_type: queryContext.requester_type,
    kosis_search_candidates: rawCandidates,
    filtered_candidates: candidates,
  };

  if (candidates.length === 0) {
    log.outcome = 'not_found';
    await writeResolveLog(log, env);
    return escalate(queryContext, null, env);
  }

  if (candidates.length > 1) {
    log.outcome = 'ambiguous';
    await writeResolveLog(log, env);
    return escalate(queryContext, candidates, env);
  }

  const entry = buildEntry(candidates[0]);
  log.outcome = 'confirmed';
  log.selected_entry_id = entry.entry_id;
  await writeResolveLog(log, env);
  await env.HONDI_KV.put(`gov-data:${cacheKey}`, JSON.stringify({ entry }), { expirationTtl: computeTTL(entry) });

  return fetchStatData(entry, env);
}
```

`filterByMorphemeMatch`, `dedupeByLatestPeriod`, `escalate`, `buildEntry`는 다음 단계에서
구현한다 — 지금은 인터페이스와 책임 분리만 확정한다.

## 5. 이번 설계로 자연스럽게 해소되는 것

- 트랙4 6건·57건은 더 이상 "완성해야 할 리스트"가 아니라, 이 리졸버가 처음 캐싱하는 사례가 된다
  (이번 세션에서 확인한 66,69,71 결과를 `GOV_OPEN_DATA_MAP`에 수동으로 시드(seed)해두면
  첫 캐시 히트로 재사용 가능 — 굳이 버릴 필요는 없다)
- `KOSIS-API-활용계획-사고실험`의 ISSUE-4(not_found/미착수 구분 기록 안 됨)가
  `status` 필드와 로그의 `outcome`으로 자동 해소된다

## 6. 다음 단계 (미착수)

- [ ] `filterByMorphemeMatch`, `dedupeByLatestPeriod` 실제 구현 (규칙 B/C)
- [ ] `escalate()` — gov-sp/k-public 분기별 실제 응답 포맷 구현
- [ ] `GOV_DATA_RESOLVE_LOG` 저장소 결정 (KV vs PocketBase — 감사로그 요구사항 고려 시 PocketBase가 더 적합할 수 있음, 기존 GWP_DONE 감사로그 인프라와 통일성 확인 필요)
- [ ] 트랙4 66,69,71 확인 결과를 캐시에 시드
- [ ] 로그 일정량(예: 50건) 누적 후 2단계 스코어링 설계 재검토
