# GOV_TREE_LAZY_INSTANCING_DESIGN_v1_0.md
## gov-tree(04-city-dept·05-emd) 인스턴스를 "첫 호출 시점 즉석 저작"으로 전환하는 설계

작성일: 2026-08-05 | 지시자: 주피터 | 배경: 부산 해운대·강서·금정 43개 읍면동 +
16개 구·군 jachi를 세션마다 수작업(웹서치 → JSON 커밋)으로 채우던 방식이
전국 단위(약 3,556개 읍면동 하부행정기관 + 226개 시군구 × 10여 개 도메인)로는
지속 불가능하다는 지적에 따른 아키텍처 전환 설계.

주피터님 원문 지시: "나머지 광역시도, 시군구, 읍면동, 산하 기관 등의
인스턴스는 사용자 발화가 해당 기관 또는 부서를 호출하는 시점에 구성해야
합니다. 물론, 이미 이전에 구성된 결과물이 있으면 그대로 불러와야 합니다.
따라서, 첫째, 사용자의 현재 위치와 주소지 정보를 획득하여, 관할 기관과
부서를 특정하고, 둘째, 해당 기관을 검색하여 이미 사용자 등록 및 SP 작성이
완료되었는지 여부를 판단한 뒤, 셋째, 첫 호출이면 SP-Author를 호출하여, SP
작성과 사용자 등록을 진행합니다."

결정사항(주피터 확인, 2026-08-05):
- 저장소: **PocketBase(L1)가 정본**, 이 저장소의 JSON 마스터데이터 파일은
  파일럿 검증용 미러로 유지.
- 해운대구 18 + 강서구 9 + 금정구 16 = 43개 동, city-dept jachi 16/16 —
  **그대로 유지, 부트스트랩 시드 데이터로 활용**.
- 이번 문서는 설계 확정 단계 — 코드 구현은 이 문서 승인 후 후속 세션.

---

## 0. 핵심 발견 — 이미 있는 것과 없는 것

코드를 먼저 감사한 결과, 지시하신 "3단계 흐름"에 필요한 부품이 **이미
셋으로 나뉘어 존재**하고 있었습니다. 이 문서의 실제 작업은 "0부터 설계"가
아니라 "이미 있는 세 부품을 gov-tree 04/05 계층에 맞게 연결"입니다.

| # | 이미 있는 것 | 위치 | 커버 범위 | gov-tree(04/05)에 연결됐는가 |
|---|---|---|---|---|
| A | 이름 있는 기관 실시간 SP-Author | `worker.js` `handleSPAuthorQueue`→`_generateGovDraftSP`(SP-AUTHOR_v1_15.md 상속, LLM+웹검색 5회 왕복, PocketBase `sp_gov_draft_realtime`+`profiles` 등록) | §GOV_MATCH가 다루는 "이름으로 특정된 기관"(국민연금공단 등) | **아니오** — institution 자유텍스트 매칭 전용, 시·군·구/읍·면·동 구조화 키 개념이 없음 |
| B | 시군구 부서 지연 초기화 | `worker.js` `handleSigunguDeptResolve` + `gov-router.js` `resolveSigunguDept()` (Serper 웹검색 1회, KV 30일 캐시, SSE 진행상황) | **정적 PROVINCE_TABLES에 아예 없는** 시/군/구(예: 천안시·고창군) | **부분적** — "완전 미등록 도(道)"에서만 트리거, "온보딩된 도인데 스텁"인 경우(이번 세션 내내 다룬 상황)는 안 걸림 |
| C | 관할 계층 판별 스키마 | `prompts/gov-tree/08-schema/JURISDICTION-RESOLVER-SCHEMA_v1_2.md` | intake_tier/substantive_tier 구분, SP-AUTHOR PHASE 0 근거 문서 | 문서만 있고 코드 미반영, 제주 전용 표현 잔존(2026-07-08 작성, 부산 파일럿 이전) |
| — | (없음) | — | **"온보딩된 도(province)인데 특정 구·군·동만 스텁이거나 완전 누락"** — 이번 세션 내내 제가 손으로 메운 바로 그 공백 | 대상 없음(신설 필요) |

**결론**: 지시하신 3단계 중 1단계(위치→관할 판별)는 이미 완성돼 있고
(PROVINCE_REGISTRY·`_findEntryAcrossProvinces`·`_findEmdEntryAcrossProvinces`
— 이전 두 세션에서 만든 것), 2단계(등록 여부 판단)·3단계(SP-Author 호출)는
A·B 두 부품을 gov-tree 04/05 계층용으로 변형·재사용하면 됩니다 — 완전히
새로 짓는 게 아닙니다.

---

## 1. 문제의 정확한 경계

### 1-1. 지금 각 계층의 실제 커버리지

```
province(도)         : PROVINCE_REGISTRY — 17개 광역시도 전부 정적 등록됨(라우팅 배선 기준)
city(시/군/구)        : 시코드별 국(局) 목록 — 17개 도 대부분 이미 _makeGenericCityDeptEntries로
                        "도메인 키워드 라우팅"까지는 존재. 그러나 city-dept-master-data.json의
                        "실제 국이름·산하과·청사주소·콜센터"는 부산 jachi 16/16만 실사 완료,
                        나머지 도메인·나머지 15개 도는 스텁 또는 미착수.
emd(읍/면/동)         : EMD_PATHS에 jeju(43개 전체 실사)·busan(43개, 해운대+강서+금정만) 2개
                        도만 등록됨. 나머지 15개 도는 EMD_PATHS 자체에 키가 없음 —
                        `_findEmdEntryAcrossProvinces`가 순회할 대상 자체가 없어 항상 미스.
sigungu-lazy(B 부품)  : PROVINCE_TABLES에 아예 없는 시/군/구(강남구·천안시 등, "10개 표본
                        실사"로 확인된 소수) — 부서명만 웹검색 1회로 즉석 추정, SP 저작까지는
                        안 함(경량 리졸버).
```

### 1-2. 이번 세션이 실제로 메운 것

`city-dept-master-data.json`의 **jachi 도메인만 16/16**(부산), `emd-master-data-busan.json`
**43개 동**(해운대·강서·금정) — 이게 전국 커버리지에서 차지하는 비중은 대략
아래와 같습니다(자릿수 감 잡기용 추정, 정밀 통계 아님):

- 시/군/구: 전국 226개 × 대략 10개 도메인(jachi/econ/welfare/housing/...) ≈ 2,260칸.
  이번 세션 완료분: 부산 16개 구·군 × jachi 1개 도메인 = 16칸. **0.7%**.
- 읍/면/동: 공공데이터포털 기준 전국 읍면동 하부행정기관 3,556개소.
  이번 세션 완료분: 43개(제주 기존 43개 포함해도 86개). **약 1.2~2.4%**.

이 숫자가 바로 "수작업으로는 끝나지 않는다"는 지적의 근거입니다.

---

## 2. 제안 아키텍처 — 3단계를 코드 위치에 매핑

```
사용자 발화("우리 동네 인감증명 어떻게 떼요?")
   │
   ▼
[1단계: 위치 특정] ── 이미 완성됨, 손댈 곳 없음
   PDV 위치 힌트 / GPS → _resolveProvinceCode() → _guessSigunguName()
   → (city 계층) _findEntryAcrossProvinces('city', ...)
   → (emd 계층)  _findEmdEntryAcrossProvinces(r => r.읍면동명 === code)
   │
   ▼
[2단계: 등록 여부 판단] ── 신설 — "3분류 판정기" 하나만 추가하면 됨
   _classifyGovTreeInstance(record) → 'REAL' | 'STUB' | 'MISSING'
   (판정 기준은 §3 참조 — city-dept-master-data.json의 국이름/청사주소 유무,
    emd-master-data*.json의 청사주소/대표전화 유무로 기계적 판별)
   │
   ├── REAL   → 기존 그대로 렌더링(현재 코드 무변경)
   │
   └── STUB 또는 MISSING
       │
       ▼
   [3단계: SP-Author 호출] ── A·B 부품을 gov-tree 전용으로 변형
       (a) 지금 이 사용자에게는 STUB의 일반화 내용으로 즉답(현재도 이미
           이렇게 동작 — 응답을 막지 않음, §DRAFT_REQUEST risk_tier=low
           원칙과 동일)
       (b) 백그라운드(ctx.waitUntil)로 POST /gov-tree-instance/queue
           → _generateGovTreeInstanceSP() 실시간 저작(§4)
       (c) 검증 통과 시 PocketBase sp_gov_tree_instance_realtime에 저장
           + profiles 등록(K-Search 검색 가능하게, 기존 A 부품의
           _handleUnclaimedProfilePost 패턴 재사용)
       (d) 다음 사용자부터는 2단계에서 이 레코드를 찾아 REAL로 취급
```

---

## 3. 2단계 — "이미 구성됐는가" 판정 기준(3분류)

지금까지 "스텁이냐 아니냐"를 사람이 눈으로 보고 판단해왔습니다(이번
세션의 `_비고`에 "산하과목록 TBD로 남김" 같은 식으로). 이걸 기계적으로
판정 가능한 규칙으로 명문화합니다 — SP-Author 자동 트리거의 전제조건이기
때문에 사람 판단에 맡길 수 없습니다.

### city-dept(04) 판정 기준

```js
function _classifyCityDeptInstance(rec /* city-dept-master-data.json 레코드 or undefined */) {
  if (!rec) return 'MISSING';               // (시코드,국코드) 자체가 없음
  if (!rec.국이름) return 'STUB';            // 국이름조차 없는 완전 스텁
  if (!rec.산하과목록) return 'STUB';        // ★ 국이름은 있지만 산하과 미상 —
                                              //   이번 세션 다수(동구·북구·사상구 등)가 여기 해당
  return 'REAL';
}
```

`산하과목록` 없음도 STUB으로 분류할지는 트레이드오프입니다 — 이번 세션에
채운 "국이름만 확인" 레코드들(동구·북구·사상구·사하구·서구·연제구)은
이 기준으로는 전부 STUB이 되어 재저작 대상이 됩니다. 이건 의도된
설계입니다: 국이름만으로도 이미 이전보다 나은 응답이 가능했으니 STUB
상태로도 즉답에는 지장이 없고(§DRAFT_REQUEST 정신), 재저작 시도가 낭비가
아니라 "더 정교한 버전으로" 이어지는 정상 경로입니다(SP-AUTHOR-AUTOMATION
§2-5 "정기 갱신 = 더 정교한 버전" 원칙과 동일선상).

### emd(05) 판정 기준

```js
function _classifyEmdInstance(rec /* emd-master-data*.json 레코드 or undefined */) {
  if (!rec) return 'MISSING';
  if (!rec.청사주소 || !rec.대표전화) return 'STUB';
  if (rec.청사주소.includes('TBD') || rec.무인발급기위치?.includes('TBD 재검증')) return 'STUB';
  return 'REAL';
}
```

이번 세션에 채운 43개 동은 청사주소·대표전화가 전부 공식 홈페이지
기준으로 확인됐으므로 전부 REAL로 판정됩니다 — 무인발급기위치만 TBD인
건은 STUB으로 안 내리도록 조건을 좁혀놨습니다(부가 정보 하나 없다고
전체를 재생성 낭비할 필요는 없음).

---

## 4. 3단계 — SP-Author 호출 상세 설계

### 4-1. 새 신호 타입 — `signal_source='gov_tree_instance_miss'`

`SP-AUTHOR-AUTOMATION_v1_0.md` §1이 이미 8종의 `signal_source`
(`realtime_ac`·`kcompose_match_fail`·`search_miss_pattern`·`gov_data_monitor`·
`user_feedback`·`admin_manual`·`refresh_schedule`·`unresolved_tag_signal`)를
정의해뒀습니다. 이번 설계는 **9번째 신호 타입**을 그 표에 추가하는
것으로 취급합니다 — 새 인프라(큐/에스컬레이션)를 짓지 않고 기존
`sp_draft_requests`/`escalations` 파이프라인에 올라탑니다.

```
### 1-9. `gov_tree_instance_miss` — gov-tree 계층 인스턴스 공백 (신설)
gov-router.js가 city-dept/emd 계층에서 STUB 또는 MISSING을 만나면
(§3 판정기), 지금 이 사용자에게는 기존 §DRAFT_REQUEST risk_tier=low
원칙대로 즉답한 뒤, 백그라운드로 아래 페이로드를 큐잉한다:

  POST /sp-author/queue
  {
    request_type: 'gov_tree_instance',
    signal_source: 'gov_tree_instance_miss',
    institution: '{도이름} {시이름} {국이름 또는 읍면동명}',  // 사람이 읽는 표시용
    task: '{사용자 발화 요지}',
    tier_hint: 'city-dept' | 'emd',
    risk_tier: 'low',   // city-dept/emd는 정의상 (a)담당기관 공개돼 명확 (b)생명·재산
                          // 직결 아님 — §DRAFT_REQUEST risk_tier 판정 기준 그대로 적용하면
                          // 거의 항상 low. high로 갈 예외(예: 재난안전 담당부서 오안내가
                          // 실제 응급 대응 지연으로 이어질 수 있는 case)는 §5-3에서 별도 처리.
    // ★ gov-tree 전용 구조화 필드 — institution(자유텍스트) 매칭 대신 정확한 키로 중복判定.
    gov_tree_key: { 도코드, 시코드, 국코드 or 읍면동명, tier },
  }
```

`institution` 자유텍스트 매칭(기존 A 부품의 `_normalizeInstitutionKey`)은
"국민연금공단" 같은 고유명사에는 적합하지만, "부산 동구 jachi"처럼 구조화된
키에는 오탐 위험이 있습니다 — 그래서 `gov_tree_key`라는 구조화 필드를
추가하고, 중복 판정(`_l1FindOpenDraftRequest` 확장 또는 신설
`_l1FindGovTreeInstanceRealtime(env, gov_tree_key)`)은 이 구조화 키의
완전일치로 합니다(B 부품의 `institution~'...'` LIKE 매칭보다 안전).

### 4-2. 저작 함수 — `_generateGovTreeInstanceSP()`(신설, worker.js)

기존 `_generateGovDraftSP()`(named institution용, SP-AUTHOR_v1_15.md
전문을 상속)와 자매 함수로 만들되, 핵심 차이는 **"원형 템플릿을 이미
알고 있다"**는 점입니다 — SP-AUTHOR PHASE B(템플릿 조회)를 생략하고
바로 그 계층의 확정된 템플릿으로 시작합니다:

```js
async function _generateGovTreeInstanceSP(env, govTreeKey, task, ctx) {
  const REPO_RAW = 'https://raw.githubusercontent.com/Openhash-Gopang/gopang/main';
  const { tier, 도코드, 시코드, 국코드, 읍면동명 } = govTreeKey;

  // 계층별 원형 템플릿 fetch — 이미 확정된 파일을 그대로 재사용
  // (city-dept: SP-CITYDEPT-*-TEMPLATE_v1.0.md, emd: SP-EMD-TEMPLATE_v1.3.md).
  const templateFile = tier === 'emd'
    ? '05-emd/SP-EMD-TEMPLATE_v1.3.md'
    : `04-city/templates/SP-CITYDEPT-${국코드}-TEMPLATE_v1.0.md`; // 국코드별 템플릿, 없으면 범용본 폴백
  const [template, existingSiblingRecords] = await Promise.all([
    fetch(`${REPO_RAW}/prompts/gov-tree/${templateFile}`).then(r => r.text()),
    // 같은 도의 이미 REAL 판정된 이웃 레코드 1~2건을 few-shot 참고자료로 —
    // 이번 세션이 손으로 했던 "동래구·수영구는 나무위키 상세 조직도, 국이름만
    // 확인된 곳은 TBD로" 같은 판단을 LLM이 그대로 재현하게 하기 위함.
    _fetchSiblingRealRecordsForFewShot(env, tier, 도코드, 시코드),
  ]);

  const systemPrompt = `당신은 SP-AUTHOR 절차를 이 gov-tree 인스턴스 하나에 대해
약식 실행합니다. 계층: ${tier}, 대상: ${시코드}/${국코드 || 읍면동명}.
이용자 용건: "${task}".

아래 원형 템플릿의 변수를 실제 조사로 채우십시오:
${template}

--- 참고: 같은 도(province)에서 이미 신뢰도 높게 실사된 이웃 사례 ---
${existingSiblingRecords}
--- 이 사례들의 출처 신뢰도 표기 관행(나무위키/공식 홈페이지 구분,
"TBD — 재검증 필요" 명시 등)을 그대로 따르십시오. ---

확인 안 된 세부사항은 지어내지 말고 "TBD — 재검증 필요"로 남기십시오
(U2 원칙). 검색이 필요하면 [WEB_SEARCH: query=검색어]를 응답 끝에 내십시오.`;

  // 이하 _generateGovDraftSP와 동일한 5회 왕복 웹검색 루프 재사용(중복 구현
  // 대신 공통 헬퍼로 추출 권장 — §6 구현 순서 참조).
  return await _runSPAuthorSearchLoop(env, systemPrompt, ctx);
}
```

**핵심 설계 결정**: 처음부터 새로 조사하게 하지 않고, ①확정된 원형
템플릿 ②같은 도의 이미 검증된 이웃 사례(few-shot)를 함께 주입합니다.
이번 세션에 제가 직접 한 작업(나무위키 우선 검색 → 공식 홈페이지 교차
검증 → 신뢰도 낮으면 TBD로 명시)을 LLM이 프롬프트만으로 재현하게
하는 것이 핵심 — 새 판단 기준을 발명하는 게 아니라 "제가 43개 동에 대해
실제로 했던 절차를 그대로 시켜본다"는 뜻입니다.

### 4-3. 검증 — `_validateGovTreeInstanceSP()`(신설, `_validateGovDraftSP` 자매 함수)

```js
function _validateGovTreeInstanceSP(tier, content) {
  const required = tier === 'emd'
    ? ['청사주소', '대표전화', '관할구역']
    : ['국이름'];  // city-dept는 국이름만 있어도 §3 기준상 STUB→REAL 승격 아님(산하과 필요)이지만
                    // 생성 결과의 최소 유효성 게이트는 국이름 유무로 충분 — 나머지는 사람 검토.
  const missing = required.filter(k => !content.includes(k));
  return { valid: missing.length === 0, missing };
}
```

---

## 5. 저장소 — PocketBase 정본 + JSON 파일럿 미러

### 5-1. 신규 PocketBase 컬렉션 `sp_gov_tree_instance_realtime`

기존 `sp_gov_draft_realtime`(named institution용)과 나란한 자매 컬렉션
— 스키마는 거의 동일하되 자유텍스트 `institution` 대신 구조화 키를
1급 필드로 둡니다.

| 필드 | 타입 | 비고 |
|---|---|---|
| `tier` | select(city-dept\|emd) | |
| `도코드`/`시코드`/`국코드`/`읍면동명` | text | `gov_tree_key`를 그대로 분해 저장 — 인덱스 걸어 완전일치 조회 |
| `institution` | text | 사람이 읽는 표시용("부산 동구 총무국") |
| `task` | text | |
| `risk_tier` | select(low\|high) | 거의 항상 low(§4-1) |
| `status` | select(active_pending_review\|generation_failed) | 기존 컬렉션과 동일 원칙 |
| `generated_content` | text(long) | 저작된 SP 본문 |
| `validation_notes` | text | |
| `generated_at` | date | |
| `source_conversation` | text | |

### 5-2. JSON 파일 미러 전략(파일럿 기간 한정)

이번 세션까지 커밋한 `city-dept-master-data.json`·`emd-master-data-busan.json`은
**정본이 아니라 파일럿 검증용 미러**로 격하합니다. 구체적으로:

1. **부트스트랩 시드**: 지금 이 저장소의 43개 동 + jachi 16개 레코드 중
   §3 판정기로 REAL인 것만(43개 동 전부 + jachi 11개 — 나머지 5개 구는
   국이름만 확인되고 산하과목록이 없어 STUB으로 남아있음, 정상 동작:
   그 5곳은 오히려 다음 사용자 발화 때 §4-1 미스 신호가 나가 자동으로
   재저작 대상이 되는 게 의도된 흐름) 1회성 시딩 스크립트
   (`tools/seed_gov_tree_pocketbase.mjs`, 구현 완료 — §12 참조)로
   PocketBase `sp_gov_tree_instance_realtime`에 `status='active_pending_review'`
   (사람 검토 완료 취급 — 이미 이번 세션에서 신뢰도 표기와 함께 사람이
   검토한 내용이므로)로 이관합니다. 이후 gov-router.js의 2단계 판정에서
   이 레코드들은 즉시 REAL로 인식됩니다. 범위는 부산(도코드=busan)으로
   한정했습니다 — 제주 등 다른 도에 이미 있던 REAL 레코드(이번 세션
   이전부터 완성돼 있던 것)는 이번 부트스트랩 범위 밖이며, 필요하면
   별도 세션에서 명시적으로 다시 결정합니다.
2. **gov-router.js의 데이터 소스 우선순위 변경**(§6 참조): 지금은
   `_fetchText()`가 GitHub raw의 JSON만 봅니다. 이걸 "PocketBase 먼저
   조회 → 없으면 JSON 미러(초기 이행기 동안 하위호환용) → 그래도 없으면
   STUB/MISSING 처리"로 바꿉니다.
3. **JSON 파일의 향후 역할**: 신규 SP-Author 저작 결과를 **자동으로
   JSON에 반영하지 않습니다**(그러면 다시 "git 커밋이 정본"이 되어버림
   — 목적에 반함). JSON은 이 파일럿 단계에서 "PocketBase가 맞게
   동작하는지 눈으로 비교하기 위한 스냅샷"으로만 쓰고, 파일럿 검증이
   끝나면(§7 Phase 4) 이 저장소에서 제거하거나 읽기전용 아카이브로
   보존합니다.

---

## 6. 구체적으로 어디를 고쳐야 하는가

| 파일 | 변경 내용 | 신규/수정 |
|---|---|---|
| `src/gopang/gov/gov-router.js` | `_classifyCityDeptInstance()`, `_classifyEmdInstance()` 신설(§3). `_fetchCityDeptText()`·EMD 렌더링 경로에서 STUB/MISSING 판정 시 `onProgress`/반환값에 미스 신호를 실어 호출부(worker.js 또는 call-ai.js)가 큐잉하도록 훅 추가. **데이터 소스를 PocketBase 우선으로 전환**(§5-2 ②) — 이 부분이 가장 큰 리팩터, `_fetchText()`에 PocketBase 조회 분기 추가 필요. | 수정 |
| `worker.js` | `handleSPAuthorQueue`에 `request_type==='gov_tree_instance'` 분기 신설(기존 named-institution 분기와 병렬) → `_generateGovTreeInstanceSP()`(§4-2, 신설) → `_validateGovTreeInstanceSP()`(§4-3, 신설) → `_l1CreateGovTreeInstanceRealtime()`(신설, `_l1CreateGovDraftRealtime` 자매 함수) → `_handleUnclaimedProfilePost()`(기존 재사용, institution/subtype만 gov-tree 전용으로) | 수정+신설 함수 다수 |
| `src/gopang/ai/call-ai.js` | 필요 시 gov-router.js가 미스 신호를 직접 worker.js에 못 쏘는 실행 맥락(순수 클라이언트)이라면, 기존 `GOV_SP_DRAFT_REQUEST` 태그 파싱·큐잉 로직(2020~2041행)을 재사용해 gov-tree 미스도 같은 경로로 흘려보냄 — AC가 태그를 낼 필요 없이 gov-router.js가 직접 `fetch(/sp-author/queue)` 하는 게 더 간단할 수 있음(§8 미결사항 1) | 수정 검토 |
| `prompts/gov-tree/08-schema/JURISDICTION-RESOLVER-SCHEMA_v1_2.md` | 제주 전용 표현(§1의 "제주도 조례로 도가 직접 수행" 등)을 다도(多道) 일반 표현으로 갱신, `jeju-router.js` 참조를 `gov-router.js`로 정정(이미 2026-08-04/05에 이름이 바뀌었으나 이 문서는 미갱신 상태였음) | 수정(누락 발견) |
| `docs/SP-AUTHOR-AUTOMATION_v1_0.md` | §1에 `1-9. gov_tree_instance_miss` 항목 추가(§4-1 그대로) | 수정 |
| `tools/seed_gov_tree_pocketbase.mjs` | 43개 동 + jachi 16개를 PocketBase로 1회 이관하는 시딩 스크립트 | 신설 |
| `prompts/AC-PRO-CORE_v1_0.txt` | **변경 불필요** — §1 원칙("전용 SP 없다고 호출 불가 아님, kgov가 기본값")과 §GOV_MATCH가 이미 "AC는 세부 계층을 몰라도 된다"는 설계를 보장하고 있음. gov-tree 04/05 계층의 미스 처리는 kgov 내부(gov-router.js)의 책임이지 AC 판단 루프의 책임이 아님 — 이게 애초에 이 계층 분리 설계의 의도. | **무변경** |

**AC-PRO-CORE를 안 고치는 이유를 명확히**: 주피터님 지시문의 "AC 등에 이
논리를 주입해야 합니다"를 문자 그대로 `AC-PRO-CORE_v1_0.txt` 편집으로
받아들이면 오히려 기존 설계 원칙(§1 "당신은 개체를 대신해 직접 답하지
않습니다... 개체의 SP를 호출하는 것이 항상 최종 동작입니다")과 충돌합니다
— AC는 "kgov를 호출한다"까지만 판단하고, kgov 탭 내부에서 무슨 계층
(도/시/구/동)인지, 그 인스턴스가 이미 있는지는 gov-router.js(=kgov의
"AC")가 판단합니다. "AC 등"의 "등"이 바로 이 kgov 내부 로직을 가리키는
것으로 해석했습니다 — 사용자 확인 필요(§8).

---

## 7. 단계적 구현 순서

```
Phase 1 (다음 세션): §3 판정기 + §5-1 컬렉션 스키마 + §6 시딩 스크립트
  → 43개 동 + jachi 16개를 PocketBase로 이관, gov-router.js가 PocketBase도
  조회하도록 최소 배선(아직 실시간 생성은 없음 — 이관 검증만).

Phase 2: worker.js에 _generateGovTreeInstanceSP()/_validateGovTreeInstanceSP()
  신설, /sp-author/queue에 gov_tree_instance 분기 추가. 부산 나머지
  13개 구·군 중 1~2곳으로 실시간 생성 테스트(사람이 결과 검수).

Phase 3: gov-router.js 미스 감지 → 큐잉 자동 트리거 배선(§6 표의
  gov-router.js/call-ai.js 항목). 부산 전체(16/16 city-dept 전 도메인,
  나머지 EMD)로 확대 관찰.

Phase 4: 다른 도(경남·경기·서울 등 이미 city 테이블은 있으나 city-dept
  실사 없는 도)로 확대. JSON 미러 파일 제거 여부 결정.
```

---

## 8. 미결 사항 — 결정됨(2026-08-05, 주피터 확인)

1. **미스 신호를 누가 쏘는가 → gov-router.js가 직접 쏜다.** 근거: 이미 존재하는
   `resolveSigunguDept()`가 정확히 같은 종류의 문제(정적 데이터 미스 → 지연
   조회)를 AC 태그 경유 없이 `worker.js`의 `/gov/sigungu-dept-resolve`를
   직접 fetch하는 방식으로 풀어놨다 — 동일 패턴을 따른다. AC 태그 경유
   방식은 LLM이 태그를 정확히 내는 데 의존하는 추가 실패 지점을 만든다
   (실사례: deepseek-v4-flash가 PROFILE_SUBMIT 태그를 약 70% 확률로
   누락한 전례, `docs/GOV-TREE-EMD-TEAM-SEEDING-RUN_2026-08-03.md` 등에
   기록). STUB/MISSING 판정은 이미 §3의 결정론적 코드로 끝나 있으므로,
   LLM 태그 발화에 다시 의존할 이유가 없다. **§6의 "AC-PRO-CORE 무변경"
   결론이 이걸로 확정된다.**
2. **safety 도메인 risk_tier=high 예외 → 두지 않는다.** city-dept/emd
   계층은 "어느 부서가 담당하는가"라는 라우팅 정보만 만든다. 진짜 응급은
   `§CORE`가 이 흐름 전체를 우회해 `EMERGENCY_RE` 정규식으로 즉시
   kemergency로 간다(gov-router.js `_isEmergency()`) — gov-tree 미스
   처리 로직은 애초에 진짜 응급 경로에 관여하지 않는다. 재난안전 담당
   부서 연락처를 한 번 잘못 안내해도 최악의 경우가 "헛걸음"이지 생명·
   신체 직결 손해가 아니므로, §DRAFT_REQUEST의 (a)(b) 기준을 그대로
   적용하면 여전히 low다. 도메인 이름만으로 예외를 만들지 않는다 — 실전
   테스트(Phase 2)에서 실제 반례가 나오면 그때 재검토한다.
3. **JSON 미러 갱신 → 자동 동기화 안 함, 파일럿 종료 시 폐기.**
   PocketBase→JSON 역방향 export를 만들면 그 자체가 새 실패 지점(동시
   편집 충돌·스케줄러 관리)이 된다. 파일럿 검증은 git diff를 보는 게
   아니라 실제 kgov 탭으로 확인하는 것이 맞다. 43+16개 레코드는 지금
   상태로 스냅샷 동결하고, Phase 3 검증이 끝나면 이 저장소에서 완전히
   제거한다(§7 갱신) — "당분간 유지"로 오래 끌면 다시 정본처럼 취급되기
   시작할 위험이 있다.

## 9. 문서 재검토로 발견한 보강 사항(2026-08-05)

### 9-1. 검증 게이트가 너무 약함 — §4-3에 출처 표기 요건 추가

기존 `_validateGovTreeInstanceSP()`(§4-3)는 "국이름/청사주소 같은 키워드가
본문에 있는가"만 본다 — LLM이 그럴듯하지만 근거 없는 산하과 이름을
지어내도 이 검증은 통과한다. 이번 세션에 43개 동·16개 구·군을 손으로
채우며 지킨 규율(나무위키/공식 홈페이지 구분 표기, 확신 없으면 TBD 명시)을
few-shot으로 "보여주기"만 해서는 LLM이 매번 지킨다는 보장이 없다.
검증 게이트에 아래 조건을 추가한다:

```js
function _validateGovTreeInstanceSP(tier, content) {
  const required = tier === 'emd'
    ? ['청사주소', '대표전화', '관할구역']
    : ['국이름'];
  const missing = required.filter(k => !content.includes(k));

  // ★ 2026-08-05 추가 — 출처 유형 표기 요건. 이번 세션 43개 동+16개
  // 구·군 전부 "나무위키 확인"·"공식 홈페이지 확인"·"TBD — 재검증 필요"
  // 중 하나를 명시했다(신뢰도 등급). 이 표기가 전혀 없으면 사실적
  // 정확성을 스스로 점검한 흔적이 없다는 뜻이므로 통과시키지 않는다 —
  // U2(사실 정확성) 원칙: "그럴듯하지만 미검증"과 "검증됨"을 구분하지
  // 못하는 결과물은 검증됨과 동급으로 취급하면 안 된다.
  const hasSourceAttribution =
    /나무위키|공식\s*홈페이지|\.go\.kr|TBD\s*[—-]\s*재검증/i.test(content);
  if (!hasSourceAttribution) missing.push('출처 유형 표기(나무위키/공식 홈페이지/TBD 중 하나)');

  return { valid: missing.length === 0, missing };
}
```

### 9-2. 비용 상한이 설계에 없음 — §7에 가드레일 추가

전국 규모(읍면동 3,556 + 시군구 226×10여 도메인)로 켜면, 실사용자 트래픽이
몰리는 시간대에 짧은 시간 안에 수백 건의 "5회 왕복 LLM+웹검색 저작"이
동시에 트리거될 수 있다 — Claude API·Serper 비용이 예측 밖으로 튈 위험.
Phase 3(부산 전체 확대) 진입 전에 최소 가드레일을 둔다:

```js
// worker.js — gov-tree instance 실시간 생성 전용 rate limit.
// KV(GOV_DATA_KV, 이미 존재하는 바인딩 재사용)에 시간당 카운터를 둔다 —
// sigungu-dept-resolve의 30일 캐시와 동일한 인프라, 새 바인딩 불필요.
const GOV_TREE_INSTANCE_HOURLY_CAP = 20; // 초기값 — 관찰하며 조정
async function _checkGovTreeInstanceRateLimit(env) {
  if (!env.GOV_DATA_KV) return { allowed: true }; // KV 없으면(로컬 개발 등) 제한 안 함
  const hourKey = `gov-tree-instance-rate:${new Date().toISOString().slice(0, 13)}`; // YYYY-MM-DDTHH
  const current = Number(await env.GOV_DATA_KV.get(hourKey)) || 0;
  if (current >= GOV_TREE_INSTANCE_HOURLY_CAP) return { allowed: false, current };
  await env.GOV_DATA_KV.put(hourKey, String(current + 1), { expirationTtl: 3600 });
  return { allowed: true, current: current + 1 };
}
```

상한 초과 시 실시간 생성을 건너뛰고(사용자 응답은 이미 STUB 즉답으로
끝났으므로 지장 없음) `status='rate_limited'`로 큐에만 남겨 다음 시간대
또는 사람이 수동으로 처리하게 한다 — 요청 자체를 버리지 않는다.

---

## 11. §1 원칙(모든 SP는 독립적 사용자) 미충족 발견·수정(2026-08-05, 주피터 지적)

### 11-1. 무엇이 빠져있었는가

AC-PRO-CORE §1 원칙: "혼디 안의 모든 개체(entity) — 사람, 기관, 부서,
사물, 개념 — 는 profiles에 정체성을 등록한 하나의 guid이며, 그 guid에는
반드시 SP가 할당돼 있습니다." Phase 1~2 구현 직후 주피터님이 지적하기
전까지, 이 원칙이 gov-tree 04/05 계층에 대해 **부분적으로만** 지켜지고
있었다는 걸 놓치고 있었다. 코드 감사 결과:

1. **기존에 이미 확립된 계약이 있었다**: `tools/seed_gov_tree_
   citydept_natagency.py`·`seed_gov_tree_emd_team.py`(2026-08-03)가
   `entity_subtype = "{tier}:{code}"`(예: `city-dept:jejusi-jachi`,
   `emd:애월읍`) 계약으로 이미 profiles 등록을 하고 있었다 — 이 값이
   gov-router.js의 directCode 파서가 이해하는 형식과 정확히 일치해야
   K-Search 검색 결과를 클릭했을 때(`gwp-registry.js`가 여는
   `regional-gov.html?gov_code=...`) 실제로 라우팅된다.
2. **그런데 이 시딩은 제주(jejusi/seogwipo, 43개 읍면동)에만 적용돼
   있었다** — 부산 등 이후 세션들이 만든 city-dept/emd 레코드는
   애초에 이 시딩 대상이 아니었다. 즉 이번 세션 전체(jachi 16개·EMD
   43개)뿐 아니라, 그 이전 부산 파일럿 세션들의 산출물 전부가 K-Search로
   검색되지 않는 상태였다 — 라우팅(정적 키워드 매칭)은 정상 작동해도,
   "이 기관 자체가 혼디의 독립적 사용자로 존재한다"는 §1 원칙은
   충족되지 않고 있었다.
3. **Phase 1~2 구현에서 만든 실시간 생성 경로도 잘못돼 있었다**:
   `entity_subtype`을 `gov-tree-instance:{tier}:{instance_key}` 형식
   (PocketBase 내부 dedup 키 `_govTreeInstanceKey()`와 혼동)으로 등록해,
   기존 계약과 형식이 달라 gov-router.js가 이해할 수 없었다 — K-Search로
   찾아도 클릭 시 라우팅이 깨지는 상태였을 것이다.
4. **부트스트랩 시딩 경로(`handleGovTreeInstanceSeed`)는 profiles 등록
   자체가 아예 없었다** — `sp_gov_tree_instance_realtime`에만 저장하고
   끝났다.
5. **`_handleUnclaimedProfilePost()`는 dedup을 전혀 하지 않는다** —
   매번 새 `guid`(`'unclaimed_'+crypto.randomUUID()`)로 프로필을 만든다.
   Python 시딩 스크립트들은 호출 전 `_gov_seed_common.py`의
   `find_existing_guid()`로 직접 확인하는 방식으로 이 문제를 피해왔는데,
   이번 Phase 1~2의 두 worker.js 경로(실시간 생성·시딩)는 이 확인 없이
   설계돼 재실행 시 중복 프로필이 쌓일 위험이 있었다(`_gov_seed_common.py`
   자체가 문서화한 2026-08-03 ACRC 중복 등록 사고와 동일한 함정).

### 11-2. 수정 내용

- `_govTreeGovCode(govTreeKey)`(신설) — 기존 계약과 정확히 일치하는
  `{tier}:{code}` 형식을 조립하는 단일 함수. `_govTreeInstanceKey()`
  (PocketBase dedup용, 4필드 `:` join)와 명확히 분리 — 두 값을 혼동하지
  않도록 각 함수 주석에 상호 참조 명시.
- `_l1FindProfileByEntitySubtype(env, entitySubtype)`(신설) — PocketBase
  JSON 하위 경로 완전일치 필터(`extra.public.identity.entity_subtype = '...'`)
  로 기존 등록 여부 확인. ⚠ 이 세션은 실제 PocketBase에 접근할 수 없어
  이 필터 문법이 실제로 동작하는지 라이브 검증하지 못했다 — 배포 후
  가장 먼저 확인해야 할 항목(§12 참조).
- `_registerGovTreeProfile(env, govTreeKey, {name, description, tags})`
  (신설) — 위 두 함수를 조합한 dedup-safe 등록 함수. 이미 있으면
  `already_registered`로 스킵, 확인 자체가 실패하면(네트워크 오류 등)
  "없음"으로 잘못 해석해 중복 생성하지 않고 `skipped_dedup_check_failed`
  로 안전하게 후퇴. 실시간 생성 경로·부트스트랩 시딩 경로 양쪽이 이
  함수 하나를 공유(전에는 실시간 경로만 잘못된 형식으로 자체 구현,
  시딩 경로는 아예 없었음 — 이제 단일 함수로 통일해 앞으로 형식이
  다시 어긋날 여지를 구조적으로 줄임).
- `handleGovTreeInstanceSeed`가 `sp_gov_tree_instance_realtime` 저장과
  함께(멱등 — 이미 있으면 스킵) `_registerGovTreeProfile`도 호출하도록
  수정 — 응답 payload에 `profiles_registered`/`profiles_failed` 필드
  추가.

### 11-3. 여전히 남은 것 — 명시적으로 범위 밖

- **제주 43개 읍면동·jejusi/seogwipo city-dept의 기존 profiles 등록은
  그대로 유지**(이미 2026-08-03에 올바른 형식으로 등록돼 있음 —
  재등록·마이그레이션 불필요, `_registerGovTreeProfile`의 dedup 확인이
  이들을 건드리지 않고 그대로 지나감).
- **금정구 16개 EMD·나머지 도의 미래 확장분**은 이번 세션 부트스트랩
  범위(부산만) 밖이므로 이번 시딩에 포함되지 않는다 — 다음 세션에서
  §7 Phase 3로 자연스럽게 실시간 생성 경로를 통해 등록될 것(§4-1).
- 세션 자체 한계로 `_l1FindProfileByEntitySubtype`의 PocketBase 필터
  문법 라이브 검증 못 함 — §12 구현 상태 추적표에 반영.

## 12. 구현 상태(2026-08-05 갱신)

§7 Phase 1~2에 해당하는 코드가 이번 세션에 구현되어 patch로 전달됨.
구현 범위와 파일별 대응은 아래와 같다 — 상세는 각 파일의 코드 주석 참조.

| 항목 | 상태 | 파일 |
|---|---|---|
| §3 판정기(REAL/STUB/MISSING) | ✅ 구현+테스트 | `gov-router.js` `_classifyCityDeptInstance`/`_classifyEmdInstance` |
| §4-1 미스 신호 발신(gov-router.js 직접 fetch, §8-1 결정 반영) | ✅ 구현 | `gov-router.js` `_reportGovTreeInstanceMiss()` |
| §4-2 실시간 저작 함수 | ✅ 구현(미검증 — 실 PocketBase/Claude API 없이는 통합 테스트 불가) | `worker.js` `_generateGovTreeInstanceSP()` |
| §4-3 검증 게이트(§9-1 출처표기 요건 포함) | ✅ 구현+단위테스트 | `worker.js` `_validateGovTreeInstanceSP()` |
| §5-1 PocketBase 컬렉션 | ✅ 스키마 정의 + 헬퍼 함수 | `worker.js` `_l1*GovTreeInstanceRealtime()`, `docs/schema/sp_gov_tree_instance_realtime.schema.json` |
| §5-1 조회 엔드포인트(gov-router.js가 읽을 read-only 경로) | ✅ 구현 | `worker.js` `handleGovTreeInstanceLookup` — `GET /gov-tree-instance/lookup` |
| §5-1 큐잉 엔드포인트 확장 | ✅ 구현 | `worker.js` `handleSPAuthorQueue`의 `request_type==='gov_tree_instance'` 분기 |
| §9-2 비용 상한 | ✅ 구현 | `worker.js` `_checkGovTreeInstanceRateLimit()` — ★ 이것과 별개로, 실사용 중 Cloudflare Workers 플랫폼 자체의 "요청 1건당 하위요청 수" 상한("Too many subrequests by single Worker invocation")이 실제로 걸림을 확인(부트스트랩 시딩 배치 크기 10건에서 재현) — `handleGovTreeInstanceSeed`가 레코드 1건당 최대 4개 하위요청(sp_gov_tree_instance_realtime 조회+생성, profiles 조회+등록)을 만들어서, `/gov-tree-instance/seed`에 한 번에 넘기는 레코드 수(`tools/seed_gov_tree_pocketbase.mjs`의 `BATCH_SIZE`)를 10→4로 낮춰 대응(2026-08-05). `/sp-author/queue`의 `gov_tree_instance` 실시간 생성 분기(§4-1)는 레코드 1건씩만 처리하므로 이 문제와 무관 — 부트스트랩처럼 여러 건을 한 요청에 묶어 보내는 경로에서만 해당. |
| §5-2 gov-router.js 데이터소스 우선순위(PocketBase 우선) | ✅ 구현 | `gov-router.js` `_fetchCityDeptText`/`_loadEmdRecordsForProvince` 앞단에 PocketBase 조회 삽입 |
| §5-2 시딩 스크립트 | ✅ 구현+dry-run 검증(부산 city-dept 11건+emd 43건=54건 수집·렌더링 확인) | `tools/seed_gov_tree_pocketbase.mjs` — `_generateGovDraftSP` 재구현 대신 `assembleGovSystemPrompt()` 자체를 재사용해 실제 렌더링 결과와 100% 동일한 텍스트를 얻음 |
| §5-2 시딩 수신 엔드포인트 | ✅ 구현 | `worker.js` `handleGovTreeInstanceSeed` — `POST /gov-tree-instance/seed`, LLM 생성 없이 직접 삽입, 멱등(기존 있으면 스킵) |
| §11 profiles 등록(§1 원칙, K-Search 검색 가능성) | ✅ 구현(미검증 — PocketBase JSON 필터 문법 라이브 확인 못 함) | `worker.js` `_govTreeGovCode()`·`_l1FindProfileByEntitySubtype()`·`_registerGovTreeProfile()` — 실시간 생성·부트스트랩 시딩 양쪽 경로 모두 배선, 기존 `seed_gov_tree_citydept_natagency.py`/`seed_gov_tree_emd_team.py` 계약(`entity_subtype="{tier}:{code}"`)과 통일 |
| 실 PocketBase/Claude API 대상 통합 테스트 | ❌ 미실행 | 이 세션의 네트워크 접근 범위(GitHub·패키지 레지스트리만 허용)로는 실제 L1 PocketBase·Cloudflare Workers·Anthropic API에 접근 불가 — 배포 후 실환경에서 사람이 확인 필요 |

