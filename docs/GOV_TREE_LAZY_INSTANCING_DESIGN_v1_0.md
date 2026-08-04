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

1. **부트스트랩 시드**: 지금 이 저장소의 43개 동 + jachi 16개 레코드를
   1회성 시딩 스크립트(`tools/seed_gov_tree_pocketbase.py`, 신설 제안)로
   PocketBase `sp_gov_tree_instance_realtime`에 `status='active'`(사람
   검토 완료 취급 — 이미 이번 세션에서 신뢰도 표기와 함께 사람이 검토한
   내용이므로)로 이관합니다. 이후 gov-router.js의 2단계 판정에서 이
   레코드들은 즉시 REAL로 인식됩니다.
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
| `tools/seed_gov_tree_pocketbase.py` | 43개 동 + jachi 16개를 PocketBase로 1회 이관하는 시딩 스크립트 | 신설 |
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

## 8. 미결 사항 — 사용자 확인 필요

1. **미스 신호를 누가 쏘는가**: gov-router.js는 브라우저(클라이언트)에서
   실행되는 코드입니다(`_fetchText`가 GitHub raw를 직접 fetch) —
   `/sp-author/queue`를 클라이언트가 직접 호출해도 되는지(비밀키 노출
   없음, POST 바디만 있으면 되므로 가능해 보임), 아니면 기존 A 부품처럼
   AC가 태그를 내고 call-ai.js가 서버 프록시 경유로 쏘는 경로를 그대로
   따라야 하는지 — 후자면 AC-PRO-CORE에 최소한 "kgov 내부에서 미스가
   나면 이 태그를 대신 내라"는 위임 규칙이 필요할 수 있어 §6의
   "AC-PRO-CORE 무변경" 결론이 바뀔 수 있습니다.
2. **risk_tier=high 예외**: §4-1에서 city-dept/emd는 거의 항상 low라고
   했으나, safety(재난안전) 도메인처럼 오안내가 실제 위험으로 이어질 수
   있는 도메인은 예외로 둘지 — 두면 그 도메인만 사전승인 큐(기존
   `sp_draft_requests`)로 보내야 합니다.
3. **JSON 미러 갱신 주체**: PocketBase에 새로 쌓이는 레코드를 이 저장소
   JSON에 주기적으로 되반영(export)할지, 아니면 파일럿 기간에는
   손대지 않고 43+16만 스냅샷으로 남길지.
