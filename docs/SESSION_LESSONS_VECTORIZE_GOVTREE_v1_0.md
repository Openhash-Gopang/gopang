# Vectorize·gov-tree 실전 교훈 매뉴얼 v1.0

> **작성일**: 2026-08-04 · **대상**: 개발자 및 AI 세션(다음에 비슷한 작업할 때
> 참조용) · **메타 매뉴얼**: [`docs/MANUAL_INDEX.html`](./MANUAL_INDEX.html)
> **HTML 버전**: [`docs/SESSION_LESSONS_VECTORIZE_GOVTREE_v1_0.html`](./SESSION_LESSONS_VECTORIZE_GOVTREE_v1_0.html)
> (desktop.html 좌측 사이드바 "🛠 개발자 문서" 섹션에 링크된 것은 이 HTML 버전 —
> 사람이 브라우저로 읽을 땐 그쪽, grep·검색으로 참조할 땐 이 .md 버전)
> **관련 PR**: #213, #215~#219
> **관련 코드**: `src/gopang/gov/gov-router.js`(`_loadGovCommon()`) ·
> `worker.js`(`handleEntitySemanticSearch`·`handleEntityEmbedIndex`·
> `_filterProfileByVisibility`·`_l1UpsertProfile`) · `prompts/gov-tree/`

이 문서는 개별 기능의 사용법 매뉴얼이 아니다. Cloudflare Vectorize를 새로
붙이거나, PocketBase profiles의 필드 공개 정책을 건드리거나, gov-tree SP를
새로 만들거나 감사할 때 **또 밟게 될 게 뻔한 함정들**을 모아뒀다. 전부
2026-08-04 세션에서 실제로 밟은 함정이고, 원인을 확인하는 데 각각 여러 번의
왕복(배포→테스트→로그확인)이 필요했다. 이번 세션은 몇 번이나 "고쳤다·확인됐다"고
생각한 게 다음 단계에서 틀린 것으로 드러났다 — 메타데이터 인덱스 문제인 줄
알았다가 eventual consistency 문제인 줄 알았다가 결국 진짜 원인은 guid 조회
버그였고, "267건 전부 낡은 체인을 쓴다"고 경보를 울렸다가 실제로는 런타임에
전혀 영향 없는 문서 노후화였다.

---

## 이 문서를 읽어야 하는 상황

- 새 Vectorize 인덱스를 붙일 때
- 어떤 API가 "결과 0건"인데 원인을 못 찾을 때
- PocketBase profiles의 어떤 필드가 왜 안 보이는지 이해가 안 될 때
- gov-tree SP 파일을 새로 만들거나 감사할 때
- SP 파일에 적힌 상속 체인 설명을 실제 동작이라고 믿기 전에

---

## ① Cloudflare Vectorize 실전 교훈 3가지

entity-semantic-search 구축(§3-2) 중 전부 실사로 확인.

### 1. 메타데이터 필터링은 벡터를 넣기 *전에* 인덱스를 만들어야 한다

`filter: { entity_type: 'institution' }` 같은 조건으로 쿼리하려면, 그
필드에 대한 메타데이터 인덱스를 먼저 만들어야 한다. 안 만들고 필터를
걸면 **에러 없이 조용히 0건**이 나온다. 이미 upsert된 벡터는 나중에
인덱스를 만들어도 소급 적용 안 되니 재업서트가 필요하다.

```
wrangler vectorize create-metadata-index <index> --property-name=entity_type --type=string
```

### 2. "결과 0건"이 반드시 인덱싱 실패를 뜻하지 않는다

`wrangler vectorize info`로 `vectorCount`가 정상으로 나와도 실제 쿼리가
0건일 수 있다 — 원인이 하나가 아니다(메타데이터 필터 미설정 / eventual
consistency 지연 / 쿼리 이후 단계의 별도 버그 — §②). 원인을 좁히려면
**filter를 완전히 뺀 raw 쿼리**부터 먼저 시도해서 임베딩·인덱스 자체가
문제인지, 필터 단계가 문제인지부터 나눠야 한다.

### 3. 진짜 원인은 로그로만 보인다 — 짐작으로 좁히지 마라

이번 세션에서 메타데이터 인덱스 문제(A안)로 추정했다가, 확인해보니
B안(eventual consistency)이었고, 그것도 아니었고, 결국 `wrangler tail`로
Vectorize 원본 응답을 직접 찍어보고 나서야 진짜 원인(②번 섹션)을 찾았다.
추정 두 개가 연달아 틀렸다 — 셋째 시도부터는 바로 로그부터 봤어야 했다.

> **디버깅 우선순위**: "0건이 나온다" 류 버그는 원인 후보가 3개 이상일
> 때가 많다. 후보를 하나씩 추정해서 순차 검증하는 대신, `console.log`
> 몇 줄 넣고 `wrangler tail`로 실제 값을 한 번에 보는 쪽이 결과적으로
> 더 빠르다.

---

## ② guid ≠ PocketBase 레코드 고유 id

29건 파일럿 전량 NO-MATCH의 진짜 원인(PR #217).

profiles 컬렉션은 **두 개의 서로 다른 식별자**를 갖는다 — PocketBase가
자동 생성하는 내부 `id`(15자 랜덤 문자열)와, 우리 도메인이 쓰는 커스텀
필드 `guid`(예: `unclaimed_xxxx-xxxx...`). 이 둘은 값이 다르다.

`GET /api/collections/profiles/records/{id}`는 **PocketBase 내부 id
전용**이다. Vectorize에는 record id로 `guid`를 넣어뒀는데, 매칭된 결과를
다시 프로필로 조회할 때 이 GET-by-id를 쓰면 **매번 404**가 난다 — 그리고
그 실패를 `continue`로 조용히 삼키면 후보가 전부 사라지고 "결과 없음"으로
보인다.

| 틀린 방법 | 맞는 방법 |
|---|---|
| `GET /records/{guid}`(id 전용 엔드포인트에 guid를 넣음) | `GET /records?filter=guid='...'&perPage=1` |

`_l1SearchEntities`·`handleBenefitSemanticSearch`는 처음부터 filter
검색을 썼다 — 이번에 새로 짠 코드만 지름길로 가려다 이 함정에 빠졌다.
**PocketBase 레코드를 우리 도메인의 커스텀 식별자로 조회할 땐 무조건
filter 검색을 쓸 것, GET-by-id는 절대 쓰지 말 것.**

---

## ③ field_visibility 기본값 함정 — description은 항상 비어있었다

개인정보 보호 기본값이 기관에도 그대로 적용되던 문제.

`_filterProfileByVisibility`는 `field_visibility.description`이
명시적으로 `true`가 아니면 `description`을 항상 지운다. gov-tree 시딩
스크립트는 이 플래그를 안 채웠으므로, **공개 API(`/search`, `/profile`,
`/entity-semantic-search`) 어디를 거치든 description은 항상 빈 값**이었다.

이걸 모르고 description을 임베딩 원문으로 쓰면, 실제로는 이름만
임베딩하는 셈이 된다 — 그 결과 "소통청렴담당관"·"기획조정실"·"대변인"처럼
**이름 자체가 범용적인 기관이 모든 자연어 쿼리의 상위권을 휩쓰는 현상**이
실제로 관측됐다(TOP1 정확도 37.9%, WRONG-MATCH 13.8%).

해결책 두 가지를 같이 적용했다:

- **즉시 우회**: `search_text` 필드를 쓴다 — LIKE 검색용으로 이미
  name+description+occupation+tags를 조합해둔 필드라, 필터링을 안
  거치고 항상 채워져 있다. TOP1 정확도가 75.9%로 뛰었다.
- **근본 수정**: `institution` entity_type은 description 기본값을
  공개로 바꿨다(PR #219) — 기관은 "찾아지는 게 존재 목적"이라 개인정보
  보호 기본값이 안 맞았다.

> **일반화된 교훈**: profiles 스키마에 새 필드를 추가할 때, "기본값이
> 어느 entity_type에 맞는 기본값인가"를 반드시 따져야 한다. person
> 기준으로 정한 기본값을 institution·business·thing·concept에
> 무비판적으로 적용하면 이런 문제가 또 생긴다. `org`·`business`도 같은
> 논리가 적용될 수 있으나 이번엔 institution만 확정 지시받아 범위에
> 안 넣었다.

---

## ④ SP 파일에 적힌 §0(상속 체인)는 문서일 뿐, 실제 조립은 코드가 한다

267건 전부 낡은 체인을 "말하고" 있었지만 실제 동작엔 영향 없었다.

gov-tree SP 파일 267건을 전수 스캔했더니, 전부 §0 섹션에
`JEJU-GOV-COMMON → SP-DO-000 → ...`라는 **2026-07-10에 이미 폐기
선언된 옛 체인**을 그대로 적고 있었다. 처음엔 이걸 심각한 회귀로
보고했는데, 확인해보니 틀렸다.

`src/gopang/gov/gov-router.js`의 `_loadGovCommon()`이 실제 런타임
체인을 **코드 레벨에서 독립적으로 조립**한다 — 개별 SP 파일의 §0
텍스트를 전혀 읽지 않는다.

```js
// 실제 조립 결과 (gov-router.js _loadGovCommon)
kgov(SP-10_kpublic) + expertParityNotice + expertCommonSp
  + HUMAN-AUTHORITY-GATE-SCHEMA + overlay(도별 렌더링)
  + JEJU-TREE-PROTOCOL + AGENCY-AC-COMMON
```

즉 **§0 텍스트 불일치는 순수 문서 노후화**이지 기능 버그가 아니다.
다만 이 SP 파일을 읽는 사람(개발자, 그리고 다음 세션의 AI)을 계속
오도하므로 고쳐야 할 문제인 건 맞다 — 우선순위만 낮을 뿐이다.

> **일반화된 교훈**: SP 파일 안의 "상위 상속" 같은 메타데이터 문구를
> 실제 동작으로 단정하지 마라. **파일에 적힌 것과 코드가 실제로 하는
> 것은 다를 수 있다** — 특히 이 저장소처럼 "SP 자동 렌더링·조립" 로직이
> 별도로 존재하는 구조에서는, 조립을 실제로 담당하는 코드(이 경우
> `gov-router.js`)를 먼저 읽고 나서 SP 파일의 문서화 문구를 판단
> 근거로 삼아야 한다.

---

## ⑤ "제주 모형 → 추상 템플릿 → 지역별 인스턴스" 진행 지도

혼디 3단계 원칙(2026-08-04 재확인) 기준 계층별 현황.

혼디의 전국 확장 원칙은 ①제주 SP 완결 → ②제주 모형에서 추상 템플릿
도출 → ③각 지역 구체 인스턴스 생성이다. 계층마다 진행 상태가 다르므로,
**"2단계 작업"을 시작하기 전에 반드시 이 표부터 확인할 것** — 이미
돼 있는 걸 또 만드는 낭비를 막는다.

| 계층 | 추상 템플릿 상태 | 실제 파일 |
|---|---|---|
| 도청 자체(01-do) | ✅ 완료 | `province-master-data.json` + `SP-PROVINCE-TEMPLATE` |
| 과·팀(division) | ✅ 완료 | `SP-DIV-TEMPLATE` + `division-master-data.json` |
| 읍면동(emd) | ✅ 완료 | `SP-EMD-TEMPLATE` |
| 국(do-dept) 상위 22건 | ⚠️ 부분 완료 | 도메인 템플릿 16개(`SP-DEPT-*-TEMPLATE`, §LEGAL-BASIS 포함) |
| 직속기관(do-agency) 상위 10건 | ❌ 착수 중 | division 템플릿만 있었음 — 2026-08-04부터 도메인 템플릿 신설 시작(`SP-AGY-RESEARCH-TEMPLATE` 등) |
| 출자출연기관(org) 상위 26건 | ❌ 착수 중 | 위와 동일 — `SP-ORG-WELFARE-TEMPLATE`·`SP-ORG-PUBENT-TEMPLATE` 등 |

58건(do-dept+do-agency+org 상위)의 실제 섹션 구조를 스캔해보니
**고유 패턴이 4개뿐**이었다(사실상 §LEGAL-BASIS 유무 차이 하나로
수렴) — 겉보기와 달리 이미 상당히 균질하다는 뜻이라, 도메인별
그룹화(예: 연구기관형·재단형·지방공기업형)로 몇 개의 템플릿만 있으면
전부 커버된다.

---

## ⑥ 기관 유형별 근거법이 다르다 — 셋을 섞으면 안 된다

gov-tree SP의 `§LEGAL-BASIS`를 작성할 때, 기관이 "도청 내부 조직인가,
별도 법인인가, 지방공기업인가"에 따라 근거법 자체가 다르다. 이걸 섞으면
실제로 존재하지 않는 법적 관계를 사용자에게 안내하게 된다.

| 기관 유형 | 1차 근거법 | 대표 예 |
|---|---|---|
| 도청 내부 조직(실·국, 직속기관/사업소) | 지방자치법 제125조 + 행정기구 정원기준 규정 + 도 조례 | do-dept 전체, do-agency 전체 |
| 출자출연기관(재단법인) | 지방자치단체 출자·출연 기관의 운영에 관한 법률(지방출자출연법) | 사회서비스원·문화예술재단 등 |
| 지방공기업(지방공사) | 지방공기업법(제49조·제53조 등, 지방출자출연법보다 우선) | 제주개발공사(JPDC)·제주에너지공사(JEA)·제주관광공사(JTO) |

**이름만으로 분류를 단정하지 말 것** — "OO공사"라는 이름이 자동으로
지방공기업을 뜻하지 않는다. JEA·JTO는 웹서치로 공식 사이트·국가법령정보센터를
확인해서야 지방공기업법 적용을 확정할 수 있었다.

> **제주 고유 패턴 — 전국 템플릿화 시 주의**: 제주 소속 지방공사는
> 지방공기업법 일반 절차 이전에 「제주특별자치도 설치 및 국제자유도시
> 조성을 위한 특별법」의 개별 조항이 먼저 설립 근거를 마련한다(JTO=동법
> 제173조, JEA=동법 제221조의5). 이건 제주만의 요소라, 다른 도에 같은
> 유형 템플릿을 적용할 땐 이 조항을 자리표시자로 분리해서 그 도 고유의
> 근거(있다면)로 교체해야 한다.

---

## ⑦ gov-tree 전용 SP가 있는 기관은 K-Search/PocketBase 프로필 대상이 아니다

2026-08-04 부산 파일럿(부산교통공사) 세션에서 실제로 밟은 함정 — SP-18
K-Search 본문을 먼저 읽지 않고 코드 추적만으로 짐작한 대가.

### 무슨 일이 있었나

부산교통공사(`SP-ORG-BUSANTRANSIT`, 전용 gov-tree SP 이미 존재)를
"K-Search가 찾을 수 있는지" 검증한다며 PocketBase에 별도 프로필을
등록하고, `POST /profile`의 403·타임아웃을 재시도 로직까지 만들어가며
고치고, `entity-semantic-search`·`POST /search` 양쪽으로 색인 여부를
검증했다. 전부 불필요했다 — `gov-router.js`의
`_resolveInstitutionMatch(text, _orgTable(), ...)`(directCode/K-Search와
완전히 독립된 순수 발화-텍스트 매칭 경로)가 `BUSAN_ORG_TABLE`의 `kw`
배열만으로 이미 정상 작동하고 있었다.

### 진짜 근거는 SP-18(K-Search 본문)에 이미 있었다

`prompts/SP-18_ksearch_v1.4.txt` **RULE-07 [7-D]**:

> "대상이 개인이 아니라 정부기관·부서(조직 단위)면... **이미 해당
> 부서를 다루는 전용 SP가 있으면**(예: 제주 행정은 SP-DO-*/SP-EMD-*
> 계층이 이미 자체 DATA_REQUIREMENT-SCHEMA로 data.go.kr을 연동하는
> 중) **K-Search가 별도로 그 조직의 프로필을 다시 만들지 않는다** —
> 검색 위임이 오면 '해당 기관은 이미 전용 창구가 있다'고 안내하고
> `[KSEARCH_HANDOFF_BACK: reason=institution-govtask]`로 되돌린다."

즉 gov-tree(도청·시청·직속기관·출자출연기관 등)에 이미 인스턴스화된
기관은 **PocketBase profiles/K-Search의 관할이 아니다** — 이건
버그가 아니라 SP-18이 명시적으로 규정한 경계다. 라우팅은
`gov-router.js`의 정적 테이블(키워드 매칭 또는 `directCode`)이
전담하고, K-Search는 "전용 SP가 없는" 기관·조직에 한해서만
`RULE-07`(웹검색·data.go.kr 보완, `status=external_info_only`,
**정식 profile로 등록하지 않음**)로 개입한다.

### 세 갈래를 혼동하지 말 것

| 대상 | 올바른 경로 |
|---|---|
| gov-tree 전용 SP가 있는 기관(도청·시청·직속기관·출자출연기관 인스턴스) | `gov-router.js` 정적 테이블(`kw` 텍스트 매칭 또는 `directCode`) — K-Search 관여 안 함 |
| gov-tree 전용 SP가 아직 없는 기관·조직 | K-Search RULE-07 — `unclaimed_dataportal`류 조회, `status=external_info_only`만 반환, **정식 profile로 등록 안 함** |
| 사람·일반 사업체(개인, 식당 등) | 사용자 DB(PocketBase) 등록 + K-Search 검색 — 혼디 대원칙 그대로 |

### 일반화된 교훈

1. **코드를 추적해서 아키텍처를 짐작하기 전에, 그 시스템의 1차 정의
   문서(이 경우 SP 자신의 System Prompt 본문)를 먼저 읽어라.**
   `gov-router.js`만 읽고 "directCode 경로가 진짜 메커니즘"이라고
   판단했는데, SP-18 RULE-07을 먼저 읽었으면 애초에 그 경로를 검증
   대상으로 삼지 않았을 것이다.
2. gov-tree처럼 "이미 자기 완결적인 라우팅 체계를 가진 도메인"에
   K-Search/PocketBase 등록 패턴을 습관적으로 적용하지 마라 — 대원칙
   ("모든 개체는 DB에 등록하고 K-Search로 찾는다")은 gov-tree에는
   RULE-07 7-D로 명시적 예외가 걸려 있다.
3. 새 gov-tree 인스턴스(신규 도·기관)를 만들 때 검증 순서: (1) 정적
   테이블(`kw` 키워드)에 등록됐는지 → 발화 텍스트 매칭 테스트로 확인
   (네트워크 불필요, `node src/tests/*.test.mjs`로 충분). (2) 그걸로
   끝이다 — PocketBase 등록은 **하지 않는다.**

---

## 다음에 비슷한 작업을 할 때 — 체크리스트


**Vectorize/의미검색 인프라를 건드릴 때**
- [ ] 필터링할 메타데이터 필드는 벡터 upsert 전에 인덱스부터 만들었는가
- [ ] 매칭된 벡터 id로 원본 레코드를 다시 조회할 때 filter 검색을 쓰고
      있는가(GET-by-id 아님)
- [ ] "결과 0건"이 나오면 필터 없는 raw 쿼리부터 먼저 시도했는가

**profiles 필드를 새로 추가하거나 노출 정책을 바꿀 때**
- [ ] 그 필드의 기본 공개 여부가 person 기준으로 정해진 건 아닌지,
      institution 등 다른 entity_type에도 그대로 맞는지 확인했는가
- [ ] 실제로 공개 API를 거쳐서 값이 나오는지(코드만 보고 짐작하지 말고)
      직접 조회해봤는가

**gov-tree SP를 새로 만들거나 감사할 때**
- [ ] §5의 진행 지도부터 확인 — 이미 템플릿화된 계층을 또 만들려는
      건 아닌지
- [ ] SP 파일에 적힌 "상위 상속" 문구를 실제 동작이라고 단정하지 말고,
      조립을 실제로 담당하는 코드(`gov-router.js` 등)를 확인했는가
- [ ] §LEGAL-BASIS를 쓸 때 기관이 도청 내부조직/재단/지방공기업 중
      뭔지 먼저 확정했는가(이름만으로 단정 금지)
- [ ] 확인 안 된 법령 인용은 `legal_basis_last_verified`를 비워두고
      정직하게 미검증으로 표시했는가

**새 gov-tree 인스턴스(신규 도·기관)를 검증할 때**
- [ ] 발화 텍스트 매칭(`kw` 키워드)이 되는지부터 확인했는가(§⑦ —
      네트워크 불필요, `node src/tests/*.test.mjs`로 충분)
- [ ] PocketBase 프로필 등록·K-Search 색인을 "당연히 필요한 단계"로
      가정하지 않았는가 — gov-tree 전용 SP가 있는 기관은 SP-18
      RULE-07 7-D에 따라 K-Search/PocketBase 대상이 **아니다**(§⑦)

---

## 관련 문서

- [`docs/GOV_REGIONAL_AC_MANUAL_v1_0.md`](./GOV_REGIONAL_AC_MANUAL_v1_0.md) — gov-tree 라우팅 아키텍처 전반
- [`docs/MANUAL_INDEX.html`](./MANUAL_INDEX.html) — 개발 문서 전체 지도
- 저장소 내 `HANDOFF_2026-08-04.md` — 이 세션의 작업 로그·다음 세션 인계사항
