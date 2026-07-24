# 전국 지방행정 AC(도청·시청·읍면동·국가기관) 매뉴얼 v1.1

> **작성일**: 2026-07-21 · **v1.1 갱신**: 2026-07-25(별도 세션, 100건 사고실험·
> 파이프라인 완결성 감사 반영) · **대상**: 개발자(유지보수·확장)
> **메타 매뉴얼**: [`docs/MANUAL_INDEX.md`](./MANUAL_INDEX.md)
> **관련 코드**: `src/gopang/gov/gov-router.js`(원형/인스턴스 조립 핵심 로직) ·
> `worker.js`(`/gov/relay`, `/gov/sigungu-dept-resolve`, `/gov/national-agency-resolve`) ·
> `gwp-registry.js`(`kregionalgov` 엔트리) · `prompts/gov-tree/`(SP 템플릿·마스터데이터) ·
> `pages/regional-gov.html`·`gopang-app.js`(v1.1에서 신설된 파이프라인 완결성
> 배선 — §7 참고) · 별도 저장소 `Openhash-Gopang/jeju`(`jeju-router.js`,
> `webapp.html` — 현재 유일한 배포 진입점)
>
> **v1.1 변경 요지**: §5에 100건 사고실험(2026-07-24)에서 발견·수정한 버그
> 8건 추가, §6 한계 목록 갱신(#8 부분 해소), 신설 §7("파이프라인 완결성" —
> 이 문서에 없던 새 주제: 담당자 승인 게이트·요청자 PDV 기록), 신설 §8(관련
> 계획·설계 문서 상호 참조). §1~§4, 기존 §5(1~8번)·부록 PR 목록은 2026-07-21
> 작성 당시 그대로 보존.


이 문서는 지방행정 AI(도청·시군구청·읍면동사무소·국가기관 지역사무소) 상담
기능이 **"제주 전용 파일럿"에서 "전국 원형(클래스)→인스턴스 조립 아키텍처"로
전환된 과정**을 다룹니다. 2026-07-19까지는 제주 하나만 완비된 채 하드코딩돼
있었고, 2026-07-21 하루 동안 클래스/인스턴스 분리, 개명, 실시간 조립(SSE),
PDV 기반 자동 위치 특정까지 전부 재설계됐습니다. 이 과정에서 실사용 재현으로
발견한 버그와 그 원인·해법을 전부 기록해, 다음에 이 구조를 확장할 사람이 같은
시행착오를 반복하지 않도록 하는 것이 목적입니다.

---

## 1. 왜 이 구조가 필요했는가

기존 `jeju-router.js`(약 1,000줄)는 "제주 도청·시청·읍면동사무소" 전용으로
설계돼 있었고, `window.HONDI_PROVINCE_CODE = 'jeju'`가 하드코딩돼 있었습니다.
2026-07-21, 주피터의 지시로 다음 원칙이 확정됐습니다:

> "제주도는 테스트 용도였으며, 이제 jeju 중심 아키텍처를 전국 중심으로
> 전환해야 합니다." / "제주는 전국 광역시도 중 하나일 뿐입니다."

이에 따라 조립 로직 전체가 `gopang` 저장소의 `src/gopang/gov/gov-router.js`로
이전·일반화됐고, jeju 저장소는 그 중앙 모듈을 재수출하는 얇은 진입점(29줄)으로
축소됐습니다. **jeju.hondi.net은 지금도 유일한 실배포 사이트지만, 코드
아키텍처상으로는 더 이상 "제주 전용"이 아니라 "발화·PDV로 전국 어느 도든
판별하는 진입점"입니다.**

---

## 2. 클래스(원형) / 인스턴스 아키텍처

지방행정은 4단계 계층으로 나뉘고, 각각 별도의 "원형 클래스"와 "인스턴스 조립
메커니즘"을 갖습니다.

| # | 클래스 | 자치권 | 원형 데이터 | 인스턴스 조립 방식 |
|---|---|---|---|---|
| 1 | `ProvincialGovernment`(광역시도청) | — | `province-master-data.json` + `SP-PROVINCE-TEMPLATE` | 요청 시 템플릿 동적 렌더링(`_loadDoSp`/`_renderDoSpDynamic`) |
| 2 | `L2Department`(실·국) | — | `L2_CANONICAL_KEYWORDS`(16개 도메인 전국 공통 키워드) | 도별 실사 테이블 우선, 없으면 원형키워드로 즉시 최소 응답 |
| 3 | `MunicipalGovernment`(시군구청) | 있음(제주 제외) | `sigungu-national-list.json`(230개 시군구) | `/gov/sigungu-dept-resolve` — Serper 실시간 검색 조립 |
| 4 | `NationalAgencyRegionalOffice`(국가기관 지역사무소) | — | `NAT_AGENCY_COMMON_PATTERNS`(19개 도메인 명명 패턴) | `/gov/national-agency-resolve` — Serper 실시간 검색 조립 |

부가로 `AdministrativeCity`(행정시 — 자치권 없음, 현재 제주만 해당: 제주시·
서귀포시)는 `MunicipalGovernment`와 명확히 분리된 별도 클래스입니다(제주는
`SPECIAL_AUTONOMOUS`라 기초자치단체가 없고, 도가 시/군 기능을 행정시를 통해
직할합니다).

### 2.1 `PROVINCE_REGISTRY` — 도 실사 현황 단일 소스

```js
PROVINCE_REGISTRY[도코드] = {
  govType: 'SPECIAL_AUTONOMOUS' | 'GENERAL',   // 제주만 전자
  dataStatus: { province, l2, city, national, emd },  // 각 'available' | 'none'
}
```

`PROVINCE_TABLES`/`EMD_PATHS`에서 자동 계산되므로(수기 이중관리 없음), 새 도가
실사되면 이 레지스트리는 손대지 않아도 최신 상태가 됩니다.

### 2.2 도 판별 우선순위

1. `window.HONDI_PROVINCE_CODE`(배포 시점 고정 — 현재 어떤 사이트도 안 씀)
2. 사용자 발화 텍스트(도 이름 → 시군구명 → 읍면동명 순, 뒤로 갈수록 넓은
   범위를 좁혀나감)
3. PDV 위치 힌트(GPS/저장된 주소 — 발화에 지역이 없을 때만)
4. 위 세 가지 모두 실패 → **"지역 미판별"을 정직하게 응답**(과거엔 조용히
   `jeju`로 폴백해 확신에 찬 오답을 내던 버그가 있었음, §6.1 참고)

---

## 3. 원형→인스턴스 실시간 조립 (시군구·국가기관)

`MunicipalGovernment`와 `NationalAgencyRegionalOffice`는 정적 테이블에 없는
지역/기관도 **그 자리에서** 인스턴스를 만들어냅니다. 두 리졸버(`/gov/
sigungu-dept-resolve`, `/gov/national-agency-resolve`)는 동일한 설계 원칙을
공유합니다.

### 3.1 정확도 우선 (2026-07-21 이전엔 반대였음)

> 주피터 지시: "시간보다 중요한 점은 매 초마다 진행 상황을 알려주고, 정확한
> 답을 제출하는 것입니다."

- **이전**: 캐시 미스 시 즉시 추정치(`SIGUNGU_COMMON_DEPT_PATTERNS` 등 명명
  패턴 기반)를 반환하고, 실제 웹검색(Serper)은 `ctx.waitUntil`로 백그라운드에만
  돌려 그 요청엔 반영 안 됨 — 사실상 항상 추정치만 받는 구조였다.
- **현재**: 캐시 미스면 Serper 검색을 **동기적으로 기다린다.** 검증 성공 시
  `verified:true, source:'live_search'`, 실패 시(검색 실패·결과 모호·API 키
  없음)에만 `verified:false, source:'template_fallback'`로 정직하게 폴백.

### 3.2 SSE(Server-Sent Events) 진행상황 스트리밍

검색을 기다리는 몇 초 동안 매초 진행상황을 흘려보낸다:

```
data: {"status":"progress","elapsed":0,"message":"..."}
data: {"status":"progress","elapsed":1,"message":"..."}
data: {"status":"done","text":"...","verified":true,"source":"live_search"}
```

클라이언트(`gov-router.js`)의 `_consumeSigunguSSE()`가 이 스트림을 파싱해
`onProgress` 콜백으로 넘긴다. `onProgress`는 `assembleGovSystemPrompt(userText,
pdvLocationHint, classifyFn, onProgress)`의 4번째 인자로 최상단부터 관통한다.

**UI 연결**(jeju 저장소 `webapp.html`): 새 UI 요소를 만들지 않고, 기존에 이미
있던 `addMob('…', 'ai')` 임시 말풍선(`tid`)을 진행상황 텍스트로 실시간 갱신하는
방식으로 재사용했다 — 최종 답이 오면 그 요소를 지우고 실제 답으로 교체하는
기존 흐름 그대로.

### 3.3 검색 결과 추출 로직 개선(실사용 재현으로 발견한 3가지 문제)

실제 배포(`&debug=1` 모드로 원본 Serper 응답 확보)를 반복 재현해 다음 문제를
발견·수정했다:

1. **레이블 접두어 오염**: "직위건설안전국장" 같은 스니펫에서 "직위건설안전국"과
   "건설안전국"이 같은 부서인데 서로 다른 후보로 이중 카운트돼 인위적 동률
   (1:1)이 나던 버그. → `_sigunguStripLabelPrefix`/`_natAgencyStripLabelPrefix`로
   "직위/이름/전화번호/담당업무" 등 레이블 단어를 후보 앞에서 제거.
2. **후보 풀 5개 제한**: 정답이 상위 5개 밖(예: 10번째)에 있으면 후보에 아예
   못 들어감. → `organic.slice(0, 10)`으로 확장(Serper가 이미 반환한 전체
   결과, 추가 API 비용 없음).
3. **쿼리에 domain 미반영**(시군구만 해당, 국가기관은 애초부터 반영돼 있었음):
   `"OO군 조직도"`만으로는 검색 결과가 무관한 여러 부서로 흩어져 다수결로
   도메인을 특정할 수 없었음. → `"OO군 복지 담당부서"`처럼 도메인 라벨을
   쿼리에 복원(과거 한 번 "타지역·언론기사 섞임"으로 되돌린 이력이 있었으나,
   그 이후 추가된 `.go.kr` 필터 + 지역명 텍스트 포함 필터가 이미 그 문제를
   막아준다고 판단해 재도입 — 재현 테스트로 실제 개선 확인).

### 3.4 국가기관 리졸버 — cityHint (PDV 기반 관할 자동 특정)

> 주피터 지시: "AC는 사용자의 위치나 주소를 이미 알고 있습니다. 사용자는
> '홍천군에 사는데 세무서...'가 아니라 '세무서...'로만 말합니다. AC가 PDV
> 데이터로 관할을 특정해야 합니다."

국가기관은 도 하나에 지역사무소가 여러 개 있는 게 정상입니다(강원도에 세무서
5개 등) — 시/군 특정 없이는 다수결로 정답 하나를 좁힐 수 없습니다. 이를 위해:

1. `_guessSigunguName(text, pdvLocationHint)` — 발화에 시/군 언급이 없으면
   PDV 위치 힌트에서도 찾는다(기존엔 발화만 보고 있던 구멍 — 도 판별·읍면동
   매칭엔 이미 PDV를 쓰면서 시군구명 추출만 빠뜨렸었음).
2. 그렇게 얻은 `cityHint`를 `/gov/national-agency-resolve?...&city=홍천군`으로
   전달.
3. worker.js는 `cityHint`가 있으면 쿼리를 `"강원특별자치도 홍천군 세무
   관할"`처럼 구체화하고, 추출 필터도 두 갈래로 나눈다:
   - `.go.kr` 공식 도메인 → 기존처럼 도 단위 카운트(신뢰도 기준: 도메인)
   - `cityHint` 텍스트까지 일치 → 도메인 불문 카운트(신뢰도 기준: 텍스트
     특정도로 도메인 제약을 대체 — 실제로 정답이 비공식 도메인에만 있던
     사례를 재현으로 확인)
   - city 레벨 후보가 있으면 최우선 채택, 없거나 동률이면 도 단위로 폴백.

**실사용 재현 결과**(2026-07-21, 강원도 홍천군 세무서):

| 단계 | 쿼리 | 결과 |
|---|---|---|
| cityHint 적용 전 | `강원특별자치도 세무 관할` | `null`(강릉·이천·춘천·평택세무서 1:1:1:1 동률) |
| cityHint 적용 후 | `강원특별자치도 홍천군 세무 관할` | `"홍천세무서"` 정확히 채택. 부가로 검색 결과 1위에 국세청 공식 홍천세무서 페이지가 직접 나옴(쿼리 구체화가 검색 정확도 자체도 끌어올림) |

---

## 4. `gov_do`/`gov_national` 개명 (3개 저장소 동시 변경)

`jeju_do`/`jeju_national`이라는 agency 식별자가 제주 전용처럼 보여, 다음으로
개명했다. **PDV 이력이 없는 개발 단계라는 걸 확인하고** 하위호환 부담 없이
바로 개명했다(`gwp-registry.js`의 `id`도 `'jeju'` → `'kregionalgov'`로 함께
정리).

| 저장소 | 파일 | 변경 |
|---|---|---|
| gopang | `src/gopang/gov/gov-router.js` | `resolveGovAgency()`가 `gov_do`/`gov_national` 반환(진짜 발생지) + `resolveProvinceCode()` 신설 |
| gopang | `worker.js` | `GOV_AGENCIES`/`SP_DELEGATION_REGISTRY`/`SP_DELEGATION_ORIGINATORS` 전부 개명 + 제주 정적파일 폴백 제거(도별 동적 렌더링으로 대체) |
| jeju(별도 저장소) | `webapp.html` | `resolveProvinceCode` import + `/gov/relay` 요청에 `provinceCode` 포함(agency 값 자체는 gov-router.js가 이미 새 값을 주므로 이 파일은 손 안 대도 됨) |

세 저장소를 동시에(가까운 시점에) 병합해야 그 사이 `UNKNOWN_AGENCY` 거부 공백이
없다. dev 단계라 짧은 공백은 감수했다.

---

## 5. 발견·수정된 버그 (실행 기반 검증, 두 차례 50개 시나리오 사고실험)

각 시나리오는 **손 시뮬레이션이 아니라 실제 `gov-router.js`를 Node.js에서
import해 `assembleGovSystemPrompt()`를 그대로 실행**시켜 얻은 `trace` 결과로
검증했다.

| # | 버그 | 발견 시나리오 | 수정 |
|---|---|---|---|
| 1 | 광역시 이름("서울시" 등 8개)이 시/군/구로 오매칭돼 정밀 도청 매칭을 가로챔 | "서울시 소상공인 지원 문의" → `SP-DO-ECON` 대신 시군구lazy로 오배정 | `_SIGUNGU_FALSE_POSITIVE_WORDS`에 8개 광역시·특별시 이름 추가 |
| 2 | `window.HONDI_PROVINCE_CODE` 오버라이드가 "-0.5 지역 미판별" 체크에 반영 안 됨 | 도 고정 배포에서도 위치 없는 일반 질문이 전부 "지역 미판별"로 튕겨나감 | `_resolveProvinceCode()`를 직접 검사하도록 수정 |
| 3 | 읍/면/동 단독 언급 시 도 판별 실패 → EMD 매칭까지 못 감 | "한경면 전입신고"(실제 제주 EMD 데이터 있음)조차 실패 | 읍면동명→도코드 역색인 신설, 3순위 판별원으로 추가 |
| 4 | 국가기관 템플릿 fetch 404 시 폴백 없이 전체 응답 실패 | 세무서·병무청 등에서 uncaught 에러 재현 | try/catch 단계적 폴백(static → 정직한 정보없음) 추가 |
| 5 | 국가기관 템플릿 파일명 버전 참조 19건 불일치(v1.0/v1.1 vs 실제 v1.2/v1.3) | 전수조사로 34개 중 19개 확인 | `national-agency-master-data.json`의 `template` 필드 19건 정정 |
| 6 | 국가기관 지연초기화(SP-NATIONAL-LAZY)의 worker.js 엔드포인트는 있었지만 클라이언트 배선이 없었음 | 2차 50개 사고실험에서 9/10 시도조차 안 됨으로 확인 | `resolveNationalAgencyLazy` 등 클라이언트 배선 신설 |
| 7 | `_guessSigunguName`이 발화만 보고 PDV 힌트는 안 봄 | "쓰레기 분리배출 문의"+PDV(경기도 수원시) 조합에서 시군구 매칭 실패 | PDV 힌트도 함께 검사하도록 확장(§3.4에서 국가기관까지 연결) |
| 8 | `province-master-data.json`에 "전남광주" 약칭 없음(정식 명칭만 등록) | "전남광주 임신 출산 지원 문의" → 지역 미판별 | §6 #8 참고(v1.1에서 부분 해소) |

### 5.1 v1.1 추가분 — 100건 사고실험(2026-07-24, 별도 세션) 발견 버그

이 절의 시나리오도 §5 서두와 동일한 원칙(실제 `gov-router.js`를
Node.js에서 import해 `assembleGovSystemPrompt()`를 그대로 실행)으로
검증했다. 시뮬레이션 하네스는 `src/tests/100-scenario-thought-experiment.mjs`
(103건, 저장소에 커밋돼 있어 회귀 자산으로 재사용 가능).

| # | 버그 | 발견 시나리오 | 수정 |
|---|---|---|---|
| 9 | 국가기관 6개(세관·한국은행·통계청·산림청 계열 3개)가 SP 템플릿·마스터데이터는 완비돼 있는데 `JEJU_NATIONAL_TABLE`(키워드 배선)에만 등록이 안 돼 있어 전부 일반 안내로 떨어짐 | "제주세관 통관 절차 문의" → 매칭 실패 | `JEJU_NATIONAL_TABLE`/`ROUTE_DESCRIPTIONS`/`SP_CODE_TO_PDV_SCOPE` 3곳에 6개 기관 동시 등록. "콘텐츠 저작 완료"와 "실제 라우팅됨"은 별개라는 교훈 — 이후 §5.1의 다른 항목들도 이 3곳 동시 확인을 관례화 |
| 10 | PDV 위치 힌트로만 시(市)가 특정되고 시청 국(局) 단위 매칭도 안 되면, 더 구체적인 L2/LLM 분류 매칭을 시도해보기도 전에 즉시 시청 일반 페이지로 확정되던 문제 | "청년 월세 지원 있어요?" + 제주시 PDV 힌트 → WELFARE 매칭 안 되고 시청 일반 안내로 조기 종료 | `_matchCity`가 발화 자체 매칭인지 힌트 전용 매칭인지(`_matchedViaTextItself`) 구분하도록 수정 — 힌트 전용+classifyFn 존재+시청국 미매칭이면 즉시 확정 대신 폴백으로 보류하고 L2/LLM 매칭 기회를 먼저 준 뒤, 전부 실패하면 그 폴백을 최종적으로 사용 |
| 11 | 리(里) 이름이 도(道) 판별 색인에서 누락 — `_matchEmd`는 관할리목록을 인식하는데, 그보다 앞 단계인 도 판별 색인(`_loadEmdNameToProvinceIndex`)은 읍면동명만 색인해서 상위 읍 이름 없이 리 이름만 언급하면 도 판별 자체가 실패 | "한림리 전입신고 하려고 하는데요"(상위 읍 이름·"제주" 언급 전혀 없음) → 지역 미판별로 조기 반환 | 관할리목록도 함께 색인하도록 `_loadEmdNameToProvinceIndex` 수정 |
| 12 | "폐업"이 시군구 도메인 휴리스틱(`_SIGUNGU_DOMAIN_KEYWORDS`)에 없어, LLM이 SP-SIGUNGU-LAZY로 정확히 분류해도 도메인 추출 실패로 최종 안내가 끊김 | "가게 폐업 신고하려고 하는데요" | econ 도메인에 '폐업' 추가 |
| 13 | "여권"이 국가기관·시군구 도메인 어디에도 없음(실제로는 시/군/구 여권과 소관, 출입국청 아님) | "여권 재발급 받으려고요" | jachi 도메인에 '여권' 추가 |
| 14 | "수압"이 상하수도 전문 SP(`SP-EXP-WATER`) 트리거 정규식에 없음 | "노형동 우리집 수압이 너무 약해요" | 정규식에 '수압' 추가 |
| 15 | LLM 분류 폴백의 `candidatesText`가 도(道)를 구분하지 않고 항상 전체 코드를 보여줌 — 국가기관 정적 인스턴스가 제주만 있는 구조에서, 비제주 사용자 질문에 LLM이 제주 전용 코드를 골라도 조용히 실패(`SP-NATIONAL-LAZY`를 골랐어야 정답) | (설계 감사로 발견, 재현 시나리오 없이 코드 분석으로 확인) | `_buildCandidatesText()` 신설 — 현재 도에 실제로 존재하는 코드 + 해당 계층 데이터가 비어있을 때만 LAZY 코드로 필터링. 국가기관은 이후 "싱글턴+지사 디렉터리" 모델로 재해석됨(§8 국가기관 클래스-인스턴스 문서 참고) — 이 필터링 원칙 자체는 유효하나 구현 세부는 그 재해석을 반영해 갱신 필요할 수 있음(v1.1 시점 미확인) |
| 16 | "해운대구"라는 지명에 "대구"가 부분문자열로 포함돼 있어, 도 판별이 부산이 아니라 대구광역시로 오탐(부산 시청 파일럿 착수 중 발견) | "해운대구청 대표번호 알려주세요" → province=daegu로 오판별 | `_PROVINCE_NAME_FALSE_POSITIVE_WORDS`(기존 `_EMERGENCY_FALSE_POSITIVE_WORDS`·`_SIGUNGU_FALSE_POSITIVE_WORDS`와 동일 철학)에 '해운대구' 추가 — 다른 "○○대구/○○광주" 류 지명도 같은 클래스의 문제를 일으킬 수 있어 §6에 일반화된 한계로 별도 기재 |

---

## 6. 알려진 한계 / 후속 과제

1. **["전남광주" 정식 명칭은 등록됨, 짧은 "광주"는 여전히 의도적 배제 — v1.1 부분 해소]**
   "전남광주통합특별시"(정식) + "광주광역시"(실사용자가 흔히 쓰는 현재
   명칭)는 `PROVINCE_NAME_TO_CODE`에 등록됐다. 다만 짧은 "광주"만 단독으로
   쓴 발화는 여전히 안 걸린다 — 경기도 광주시와 충돌 위험이 있어 의도적으로
   배제한 설계 판단이며, 버그가 아니다(2026-07-24 재확인·재정정 결정).
2. **`gwp-registry.js`의 `kregionalgov` triggers가 제주 지명 위주** — 다른
   도의 지명·기관명이 트리거에 부족해 전국 포털에서 인식률이 낮을 수 있다.
3. **`resolveSigunguDept`/`resolveNationalAgencyLazy`의 SSE·정확도 우선
   로직이 실제 브라우저·Cloudflare Workers 런타임에서 최종 검증됨**(2026-07-21,
   `&debug=1` 모드로 실제 organic 결과까지 확인) — 다만 이 작업을 수행한
   샌드박스 환경 자체는 `hondi-proxy.tensor-city.workers.dev`에 대한 직접
   네트워크 접근이 막혀 있어, 모든 검증은 주피터가 브라우저 콘솔에서 직접
   실행한 결과를 공유받아 진행했다. 앞으로 유사한 검증이 필요하면 동일한
   방식(`&debug=1` + 콘솔 fetch)을 권장한다.
4. **`MunicipalGovernment`/`NationalAgencyRegionalOffice`의 실시간 조립은
   캐시 미스 시 매번 Serper API를 호출** — 트래픽이 늘면 비용·지연 재검토
   필요(현재는 KV 30일 캐시로 대부분의 반복 조합은 완화됨).
5. **CORS/503 계열 문제(`l1-hanlim.gopang.net`, P2P 시그널링)** — 오늘 조사
   중 콘솔 로그에서 반복 확인됐으나, 이 지방행정 AC와는 별개 서브시스템이라
   범위 밖으로 남겨뒀다.
6. **[v1.1 신규] "○○대구/○○광주" 류 지명 부분문자열 충돌은 일반화된 위험군이다**
   — §5.1 #16(해운대구)에서 실제로 한 건 확인됐다. `_PROVINCE_NAME_FALSE_
   POSITIVE_WORDS`에 사례가 발견될 때마다 추가하는 대증적 방식이라, 앞으로
   시청 인스턴스가 늘어날수록(전국 롤아웃 계획 §8 참고) 같은 클래스의 버그가
   더 나올 가능성이 있다 — 매 시/군/구 인스턴스 추가 시 그 지명이 다른 도
   이름의 부분문자열을 포함하는지 사전 점검하는 걸 권장.
7. **[v1.1 신규] 파이프라인 완결성 배선(§7)은 자동 테스트로 100% 검증되지
   않는다** — `[STAFF_REVIEW_GATE]` 소비, 요청자 PDV 크로스탭 기록은 새 탭
   열기·`postMessage`·IndexedDB 기록처럼 실제 브라우저 동작에 의존해서,
   `gov-router.test.mjs`/`100-scenario-thought-experiment.mjs`는 로직
   단위(태그 파싱·연락처 조회)만 독립 검증했고 실제 브라우저 왕복은 배포 후
   수동 확인이 필요하다.
8. **[v1.1 신규] `_buildCandidatesText()`의 province-aware 필터링(§5.1 #15)이
   국가기관의 "싱글턴+지사 디렉터리" 재해석(§8 국가기관 클래스-인스턴스
   문서)과 완전히 정합하는지 v1.1 시점에 재확인되지 않았다** — 두 변경이
   비슷한 시기에 각각 다른 세션에서 진행돼, 실제 상호작용은 다음 100건
   사고실험에서 검증 권장.

---

## 7. [v1.1 신설] 파이프라인 완결성 — 위치판별부터 PDV 기록까지

이 절은 §1~§6이 다루는 "어느 기관으로 라우팅되는가"가 아니라, 그 다음
단계 — **라우팅된 뒤 실제로 무슨 일이 일어나는가**를 다룬다.
2026-07-25 별도 세션이 "요청자 위치판별 → 관할기관 선정 → 실제 업무처리
→ 인간 담당자 최종 승인 → 요청자·기관 PDV 기록"이라는 5단계 전체가
실제로 매끄럽게 이어지는지 코드를 직접 추적해 감사했다.

| 단계 | 상태 | 근거 |
|---|---|---|
| ① 위치 판별 | ✅ | §2.2, §5.1 |
| ② 관할기관 선정 | ✅ | §3, §5.1 #15 |
| ③ 실제 업무 수행(`DEPT_TASK_REQUEST`) | ✅(의도된 설계) | `worker.js`의 `handleGovRelay`가 서버측에서 실제로 감지해 `dept_tasks` 컬렉션에 영속 기록. 단 `docs/DEPT-TASK-PROTOCOL_v1_1.md` 원칙4대로 "기록·추적만" — AI가 자동으로 완료 처리하지 않고, 대상 측이 `PATCH /gov/dept-task/:id`를 명시적으로 호출해야 완료된다 |
| ④ 인간 담당자 최종 승인(`[STAFF_REVIEW_GATE]`, G18) | ✅ v1.1에서 배선 | 아래 §7.1 |
| ⑤ 요청자+기관 PDV 기록 | ✅ v1.1에서 배선(요청자 측 신설) | 아래 §7.2 |

### 7.1 `[STAFF_REVIEW_GATE]` — 있었는데 아무도 안 듣고 있던 태그

`HUMAN-AUTHORITY-GATE-SCHEMA_v1_4.md`(G18, 2026-07-19 신설)는
`_loadGovCommon()`을 통해 모든 정부기관 세션의 시스템 프롬프트에 실제로
삽입되고 있었다(이 자체는 `AC-EXPERT-PARITY-THOUGHT-EXPERIMENT_2026-07-19.md`가
이미 확인·수정한 상태). 그런데 LLM이 실제로 `[STAFF_REVIEW_GATE: task_id=...,
handler_code=...]`를 응답에 내보내도, 그걸 소비하는 코드가 서버(`worker.js`
— `AGY_VAULT_STORE`/`META_TABLE_UPDATE`/`DEPT_TASK_REQUEST`는 전부 처리
블록이 있는데 이것만 없었다)에도 클라이언트(`pages/regional-gov.html`이
`gov-router.js`에서 import하던 함수 4개엔 `resolveHandlerCodeFromTrace`·
`findStaffContact`가 없었다 — 두 함수는 정의만 돼 있고 어디서도 호출되지
않는 죽은 코드였다)에도 전혀 없었다. 실질적으로 사용자가 원문 브래킷
문법을 그대로 채팅창에서 볼 위험이 있는 상태였다.

**수정**(`pages/regional-gov.html`): `_consumeStaffReviewGate(replyText, trace)`
신설. `resolveHandlerCodeFromTrace(trace)`로 담당부서 코드를 뽑고(LLM
출력이 아니라 이번 턴 실제 trace에서 — 형식 준수 여부에 기능이 좌우되지
않게), `findStaffContact(handlerCode)`로 실제 연락처(이름·전화·운영시간)를
조회해 사람이 읽을 수 있는 안내문으로 바꾼다. 원문 태그는 제거.

`handler_type=HONDI_STAFF_USER`(담당 직원 GUID로 인앱 알림 승인 — G18이
"장래 활성화"로 문서화해둔 것)는 아직 구현 안 됨 — 현재는 전부
`handler_type=DEPARTMENT_CONTACT`(연락처 안내, 실제 승인은 플랫폼 밖
전화·방문에서 진행)로만 동작한다.

### 7.2 요청자(시민) 측 PDV 기록 — 크로스탭 위임 패턴

기관 측 기록(`AGY_VAULT_STORE` → `owner_pdv`, `worker.js:11719` 부근)은
이미 작동했지만, 요청자 자신의 PDV에 상담 이력이 남는 경로가 없었다.
`pages/regional-gov.html`은 `webapp.html`이 `window.open()`으로 여는
별도 탭이라, `webapp.html` 쪽 `_recordPDV()`(`src/gopang/pdv/record.js`)를
직접 호출할 수 없다 — 그 함수는 `_USER`/`_userLocation` 같은 `webapp.html`
모듈 스코프 상태에 의존한다.

**수정**: 새 프로토콜을 발명하지 않고 이 저장소에 이미 있던 크로스탭
패턴(`gopang-app.js`의 `HONDI_P2P_CONNECT_REQUEST` 리스너, 2026-07-07
신설)을 재사용했다.

```
regional-gov.html → window.opener.postMessage({type:'GOV_CONSULTATION_RECORD', ...})
                                    ↓
gopang-app.js(webapp.html 컨텍스트) → _recordPDV({type:'gov_consultation', serviceId:'kgov', ...})
```

`window.opener`가 없으면(직접 URL 접근 등) 조용히 스킵 — 필수 기능이
아니라 부가 기록이라 실패해도 상담 자체는 막지 않는다.

---

## 8. [v1.1 신설] 관련 계획·설계 문서

이 매뉴얼과 같은 아키텍처(원형 클래스/인스턴스)를 다루지만 각각 별도
문서로 분리된 것들 — 이 문서를 갱신할 때 함께 확인 권장.

| 문서 | 다루는 것 | 작성 세션 |
|---|---|---|
| `prompts/gov-tree/docs/NATIONWIDE-INSTANCE-ROLLOUT-PLAN_v1.0.md` | 제주 외 15개 도의 도청·시청·읍면동·국가기관 인스턴스화 순서·우선순위·검증 방법론 | 2026-07-24(v1.1 작성 세션과 동일) |
| `prompts/gov-tree/docs/LAZY-INSTANCE-ENRICHMENT-DESIGN_v1.0.md` | "처음 호출 시 원형을 복제해 인스턴스 생성 → 대화 중 즉시 반영 → 사람이 추후 검증"이라는 인스턴스 점진적 커스터마이징 메커니즘 설계(구현 전 승인 대기). PocketBase 초안 계층 + git 확정 계층 하이브리드, 기존 `AGY_VAULT_STORE`/`META_TABLE_UPDATE` 패턴 재사용 | 2026-07-24 |
| `prompts/gov-tree/09-national/NATIONAL-AGENCY-CLASS-INSTANCE-ARCHITECTURE_v1.0.md` | 국가기관(09-national) 전용 — "34개 싱글턴 + 도별 지사 디렉터리"라는 재해석. **이 매뉴얼의 §2 표(4번째 행 `NationalAgencyRegionalOffice`)와 서술이 이 재해석 이전 모델을 전제하고 있어, 다음 v1.2에서 §2를 함께 갱신할 필요가 있다**(v1.1 시점엔 상호 참조만 추가하고 §2 본문은 손대지 않음 — 09-national 트리는 별도 세션 작업 범위라 이 문서 작성자가 직접 검증하지 않았다) | 2026-07-24, 별도 세션(`09-national/` 전담) |

---

## 부록 — 관련 PR 목록 (2026-07-21, `gopang` 저장소)

| PR | 제목 |
|---|---|
| #24 | 국가기관 지사 지연초기화 리졸버 신설(worker.js 엔드포인트) |
| #25 | SP-COMMON-02를 정부기관 5개 원형 클래스 상위 SP로 상속 |
| #26 | 도 클래스/인스턴스 레지스트리(`PROVINCE_REGISTRY`) 신설 |
| #27 | govType 기반 세정 라우팅 가드 |
| #28 | L2Department 원형키워드 도입 |
| #29 | AdministrativeCity/MunicipalGovernment 클래스 분리 |
| #30 | jeju 중심 기본값·폴백 제거 |
| #31 | gwp-registry.js jeju → 전국 지방행정(`kregionalgov`) 일반화 |
| #32, #33 | `gov_do`/`gov_national` 개명(gov-router.js, worker.js) |
| #34 | 50개 사고실험 발견 버그 4종 동시 수정 |
| #36 | 국가기관 템플릿 버전 참조 19건 정정 |
| #37 | 국가기관 지연초기화 클라이언트 배선 |
| #38~#40 | 시군구 리졸버 정확도 우선 + SSE + 클라이언트 소비 |
| #42~#43 | 국가기관 리졸버 정확도 우선 + SSE + 클라이언트 소비 |
| #45 | 리졸버 `_debug` 필드 복원 |
| #51 | 국가기관 리졸버 debug 모드 + 추출 로직 개선 |
| #52~#53 | cityHint(PDV 기반 관할 자동 특정) |

(jeju 저장소: #1 provinceCode 전달, #2 도 고정 해제, #3~#4 진행상황 UI 연결)
