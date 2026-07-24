# 05 — 버그 이력 & 패턴 분석

> **이 문서가 다루는 범위**: 실제 발생한 버그 이력과 패턴 분석(BUG-001~)
> **전체 문서 지도**: [../MANUAL_INDEX.md](../MANUAL_INDEX.md)

> 새 버그 발생 시 이 파일에 BUG-012부터 추가하세요.

---

## 버그 이력

| ID | Phase | 파일 | 유형 | 상태 |
|----|-------|------|------|------|
| BUG-001 | 1 | core/event-bus.js | 텍스트 검색 오탐 | ✅ 수정 |
| BUG-002 | 2B | openhash/plsm.js | 로직 오류 (BigInt) | ✅ 수정 |
| BUG-003 | 3 | core/plugin-validator.js | 로직 오류 | ✅ 수정 |
| BUG-004 | 4 | tests/domains/k-law.test.js | 텍스트 검색 오탐 | ✅ 수정 |
| BUG-005 | 5 | gdc/tokenomics.js | 테스트 조건 오류 | ✅ 수정 |
| BUG-006 | 5 | gdc/smartVault.js | 테스트 경계값 오류 | ✅ 수정 |
| BUG-007 | 5 | gdc/currencyPool.js | 부동소수점 허용오차 | ✅ 수정 |
| BUG-008 | 6 | domains/k-health/index.js | 로직 오류 (hasMedFlag) | ✅ 수정 |
| BUG-009 | 7 | tests/phase7_bootstrap.test.js | 경로 오류 | ✅ 수정 |
| BUG-010 | 8 | tests/integration/test-harness.js | Regex + 격리 누락 | ✅ 수정 |
| BUG-011 | 배포 | src/app.js, src/shell-ui.js | Import 이름 불일치 | ✅ 수정 |
| BUG-012 | 지방행정AC | src/gopang/gov/gov-router.js | 콘텐츠는 있는데 라우팅 배선 누락(국가기관 6개) | ✅ 수정 |
| BUG-013 | 지방행정AC | src/gopang/gov/gov-router.js | 도 판별 색인 누락(EMD 리 단위) | ✅ 수정 |
| BUG-014 | 지방행정AC | src/gopang/gov/gov-router.js | 로직 오류(PDV 힌트 조기확정) | ✅ 수정 |
| BUG-015 | 지방행정AC | src/gopang/gov/gov-router.js | 도메인 키워드 누락("폐업") | ✅ 수정 |
| BUG-016 | 지방행정AC | src/gopang/gov/gov-router.js | 도메인 키워드 누락("여권") | ✅ 수정 |
| BUG-017 | 지방행정AC | src/gopang/gov/gov-router.js | 트리거 정규식 누락("수압") | ✅ 수정 |
| BUG-018 | 지방행정AC | src/gopang/gov/gov-router.js | 후보 목록 미필터링(candidatesText province-aware 아님) | ✅ 수정 |
| BUG-019 | 지방행정AC | src/gopang/gov/gov-router.js | 텍스트 검색 오탐(지명 부분문자열 — "해운대구"⊃"대구") | ✅ 수정 |
| BUG-020 | 지방행정AC | pages/regional-gov.html | 배선 누락(승인 게이트 태그 소비 코드 부재, 죽은 함수 방치) | ✅ 수정 |
| BUG-021 | 지방행정AC | pages/regional-gov.html, gopang-app.js | 기능 누락(요청자 측 PDV 기록 경로 부재) | ✅ 수정 |

---

### BUG-001
- **증상:** C-08 테스트 실패 — event-bus.js에 'plugin-registry' 문자열 포함
- **원인:** 주석 예시 코드에 'plugin-registry' 포함 → 텍스트 검색 오탐
- **조치:** 주석에서 해당 문자열 제거
- **교훈:** 텍스트 검색 시 항상 `import` 구문 한정 검사

### BUG-002
- **증상:** O-01 실패 — χ²=51.97, L1 분포 편향
- **원인:** hex 3자리(0~4095)를 1000으로 mod 시 BigInt 미사용
- **조치:** `parseInt` → `Number(BigInt(hash) % 1000n)`
- **교훈:** 대용량 정수 mod 연산은 반드시 BigInt 사용

### BUG-003
- **증상:** A-14 실패 — 오류 플러그인이 등록 거부됨
- **원인:** PluginValidator가 `classify()` 실행 오류를 등록 거부 조건으로 처리
- **조치:** validator에서 classify 실행 검사 제거

### BUG-004
- **증상:** K-10 실패 — 코어 파일에 'k-law' 포함 오탐
- **원인:** event-bus.js 주석에 'k-law' 포함 (BUG-001 동일 패턴)
- **조치:** import 구문 한정 검사로 변경

### BUG-005~007
- **증상:** G-01, G-05, G-06 실패
- **원인:** 테스트 조건 오류 (클램핑, 경계값 `<` vs `<=`, 부동소수점 오차)
- **교훈:** 부동소수점 비교 시 `Math.abs(a - b) < epsilon` 사용

### BUG-008
- **증상:** H-07 실패 — MEDICAL_ALERT 미발행
- **원인:** `hasMedFlag` 조건이 Fast-Path S3 시 legalFlags=[] 이라 발행 차단
- **조치:** `hasMedFlag` 조건 제거, riskLevel === 'S3' 조건만 사용

### BUG-009
- **증상:** B-01~B-09 전체 실패 — 파일 없음
- **원인:** ROOT = `join(__dirname, '../../..')` → `/home/claude` 오계산
- **조치:** `join(__dirname, '../..')` 로 수정

### BUG-010
- **증상:** I-02, I-08 실패 — MED 플래그 미반환
- **원인 1:** fastPath S3 후 classify() 미실행 (break로 루프 종료)
- **원인 2:** MED-01 regex `무허가.*의료|무면허.*진료` → `무허가 병원` 미매칭
- **조치 1:** break → Set으로 변경, 모든 플러그인 classify 실행 보장
- **조치 2:** regex `무허가.*(의료|병원)|무면허.*(진료|수술)` 로 확장

### BUG-011 ⭐ 가장 중요 (배포 오류)
- **증상:** `SyntaxError: does not provide an export named 'AIPipeline'`
- **발생:** hondi.net 최초 배포 시 흰 화면
- **원인:** `app.js`가 존재하지 않는 export 이름으로 static import
  - `AIPipeline` → 실제: `runPipeline` (함수)
  - `PluginRegistry` → 실제: `registry` (싱글톤)
  - `PDVLayer`, `OpenHashLayer`, `NetworkLayer`, `GDCLayer`, `PrivacyLayer` → 존재하지 않음
  - `{ KLawPlugin }` → 실제: default export
- **조치:** `app.js` 실제 export 이름에 맞게 전면 재작성
- **재발 방지:** `01-system-map.md §2 Export 이름 일람` 항상 먼저 확인

---

## 지방행정 AC(전국 도청·시청·읍면동·국가기관) 버그 — 2026-07-24~25

> 이 구간(BUG-012~021)은 이전 항목들과 코드베이스가 다르다(Phase 1~8
> 구조가 아니라 `src/gopang/gov/gov-router.js` 및 그 클라이언트). 발견
> 방법도 다르다 — **손 시뮬레이션이 아니라 `src/tests/100-scenario-
> thought-experiment.mjs`로 실제 `gov-router.js`를 Node.js에서 import해
> `assembleGovSystemPrompt()`를 그대로 실행**시켜 얻은 결과로 검증했다.
> 상세 배경은 [`GOV_REGIONAL_AC_MANUAL_v1_0.md` §5.1·§7](../GOV_REGIONAL_AC_MANUAL_v1_0.md)
> 참고 — 여기는 이 로그의 기존 형식(발생일/원인/조치/교훈)에 맞춰 압축
> 재정리한 것이다.

### BUG-012
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
- **증상:** "제주세관 통관 절차 문의" 등 6개 국가기관 질의가 전부 일반
  안내로 떨어짐
- **원인:** SP 템플릿·마스터데이터(콘텐츠)는 이미 완비돼 있었는데,
  `JEJU_NATIONAL_TABLE`(키워드 라우팅 배선)에만 등록이 안 돼 있었음 —
  "콘텐츠 저작 완료"와 "실제 라우팅됨"은 별개라는 걸 놓친 사례
- **조치:** `JEJU_NATIONAL_TABLE`/`ROUTE_DESCRIPTIONS`/`SP_CODE_TO_PDV_SCOPE`
  3곳에 6개 기관(세관·한국은행·통계청·산림청 계열 3개) 동시 등록
- **교훈:** 새 인스턴스·기관을 추가할 땐 콘텐츠 파일과 라우팅 배선을
  항상 쌍으로 확인 — 하나만 하면 조용히 실패해서 발견이 늦어진다
- **커밋:** `100건 사고실험 — 국가기관 6개 배선 누락 + 도메인 키워드 4건 + PDV 힌트 조기확정 버그 수정`

### BUG-013
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
  (`_loadEmdNameToProvinceIndex`)
- **증상:** "한림리 전입신고 하려고 하는데요"(상위 읍 이름·"제주" 언급
  전혀 없음)가 지역 미판별로 조기 반환됨
- **원인:** `_matchEmd`는 관할리(里)목록을 인식하는데, 그보다 앞 단계인
  도(道) 판별 색인은 읍면동명만 색인하고 리 이름은 안 넣었음
- **조치:** 관할리목록도 함께 색인하도록 수정
- **교훈:** 같은 데이터의 하위 필드(리)를 인식하는 함수가 있다고 해서,
  그 앞단(도 판별)도 자동으로 같은 필드를 보는 게 아니다 — 파이프라인
  각 단계가 보는 필드 범위를 따로 확인해야 함
- **커밋:** 위와 동일

### BUG-014
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
  (`_matchCity`)
- **증상:** "청년 월세 지원 있어요?" + 제주시 PDV 힌트 → WELFARE 매칭
  기회를 얻기도 전에 시청 일반 안내로 조기 확정
- **원인:** PDV 힌트로만 시(市)가 특정되고 시청 국(局) 매칭도 안 되면,
  더 구체적인 L2/LLM 분류를 시도해보기도 전에 즉시 확정하던 로직
- **조치:** `_matchedViaTextItself` 플래그로 "발화 자체 매칭"과 "힌트
  전용 매칭"을 구분 — 힌트 전용+분류 가능하면 즉시 확정 대신 폴백으로
  보류하고 더 구체적인 매칭을 먼저 시도
- **교훈:** 위치 정보를 안다고 해서 그게 항상 최선의 응답 경로는
  아니다 — "안다"와 "그걸로 확정한다"는 별개 판단이어야 함
- **커밋:** 위와 동일

### BUG-015
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
  (`_SIGUNGU_DOMAIN_KEYWORDS`)
- **증상:** "가게 폐업 신고하려고 하는데요" — LLM이 시군구 소관으로
  정확히 분류해도 최종 안내가 끊김
- **원인:** "폐업"이 시군구 도메인 키워드 사전 어디에도 없어 도메인
  추출 실패
- **조치:** econ 도메인에 '폐업' 추가
- **교훈:** LLM 분류 성공 이후에도 후속 키워드 추출 단계가 있으면,
  분류 성공만으로 끝까지 성공한다고 가정하면 안 됨
- **커밋:** 위와 동일

### BUG-016
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
  (`_SIGUNGU_DOMAIN_KEYWORDS`)
- **증상:** "여권 재발급 받으려고요" — 국가기관·시군구 도메인 어디에도
  없어 실패
- **원인:** 한국 여권은 실제로 시/군/구 여권과 소관(출입국청 아님)인데
  이 사실 자체가 키워드 사전에 반영 안 돼 있었음
- **조치:** jachi 도메인에 '여권' 추가
- **교훈:** 도메인 키워드는 "그럴듯한 소관 부처"가 아니라 실제 행정
  관할 사실을 반영해야 함(worker.js `kforeign` scope 신설 이력과
  독립적으로 같은 사실이 두 번 발견됨 — 크로스체크 가치 확인)
- **커밋:** 위와 동일

### BUG-017
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
  (`isWaterQuery` 정규식)
- **증상:** "노형동 우리집 수압이 너무 약해요" — 정당한 상하수도 민원인데
  전문 SP(`SP-EXP-WATER`)가 안 걸림
- **원인:** 상하수도 트리거 정규식에 '수압'이 빠져 있었음(누수·수돗물
  등만 있었음)
- **조치:** 정규식에 '수압' 추가
- **교훈:** 도메인 트리거 키워드 목록은 "떠오르는 대로"가 아니라
  실제 민원 표현 다양성(사고실험)으로 검증해야 빠짐을 줄일 수 있음
- **커밋:** 위와 동일

### BUG-018
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
  (`_classifyFallback`)
- **증상:** (재현 시나리오 없이 설계 감사로 발견) 국가기관 정적
  인스턴스가 제주만 있는 구조에서, 비제주 사용자 질문에 LLM이 제주
  전용 코드를 골라도 조용히 실패
- **원인:** LLM 분류 폴백의 후보 목록(`candidatesText`)이 도(道)를
  구분하지 않고 항상 전체 코드를 다 보여줌
- **조치:** `_buildCandidatesText()` 신설 — 현재 도에 실제로 존재하는
  코드 + 해당 계층 데이터가 비어있을 때만 LAZY 코드로 필터링
- **교훈:** LLM에게 주는 "선택지"도 실행 가능한 것만 줘야 한다 —
  선택 가능해 보이지만 실제로는 실패할 선택지를 섞어주면 조용한 실패로
  이어진다
- **커밋:** `전국 인스턴스 롤아웃 계획 0단계 — candidatesText province-aware 필터링 + 계획서`

### BUG-019
- **발생일:** 2026-07-24
- **Phase/위치:** 지방행정AC / `src/gopang/gov/gov-router.js`
  (`_guessProvinceFromText`)
- **증상:** "해운대구청 대표번호 알려주세요" → 부산이 아니라
  대구광역시로 도(道) 오판별(부산 시청 파일럿 착수 중 발견)
- **원인:** "해운대구"라는 지명에 "대구"가 그대로 부분문자열로 포함돼
  있어, 짧은 도 이름 키워드 매칭이 오탐
- **조치:** `_PROVINCE_NAME_FALSE_POSITIVE_WORDS`(BUG-001·기존
  `_EMERGENCY_FALSE_POSITIVE_WORDS`/`_SIGUNGU_FALSE_POSITIVE_WORDS`와
  동일 철학)에 '해운대구' 추가
- **교훈:** BUG-001(텍스트 검색 오탐)과 본질적으로 같은 패턴이 다른
  코드베이스(지방행정AC)에서 재발 — "○○대구/○○광주" 류 지명은 같은
  클래스의 위험군이라, 새 시/군/구 인스턴스를 추가할 때마다 다른 도
  이름의 부분문자열을 포함하는지 사전 점검 필요(재발 방지책이 아직
  자동화 안 됨 — 수동 점검에 의존)
- **커밋:** `전국 인스턴스 롤아웃 1단계 — 해운대구 시청 파일럿(Research 검증) + 대구/해운대구 지명 충돌 버그 수정`

### BUG-020
- **발생일:** 2026-07-25
- **Phase/위치:** 지방행정AC / `pages/regional-gov.html`
- **증상:** 담당부서 확인이 필요한 상담 응답에 `[STAFF_REVIEW_GATE:
  task_id=..., handler_code=...]`라는 원문 브래킷 문법이 그대로 노출될
  위험(시스템 프롬프트엔 이미 삽입되고 있었으나 그 태그를 소비하는
  코드가 없었음)
- **원인:** `resolveHandlerCodeFromTrace`·`findStaffContact`
  (`gov-router.js`)가 정의만 돼 있고 어디서도 호출되지 않는 죽은
  코드였음 — 서버(`worker.js`)에도 클라이언트(`regional-gov.html`)에도
  이 태그를 처리하는 코드가 전혀 없었음
- **조치:** `regional-gov.html`에 `_consumeStaffReviewGate()` 신설 —
  두 죽은 함수를 실제로 배선해서 담당부서 연락처 안내문으로 변환, 원문
  태그는 제거
- **교훈:** "정의는 돼 있다"가 "실제로 쓰이고 있다"를 보장하지 않는다
  — 함수가 export돼 있어도 실제 호출부(grep으로 호출 지점 자체를
  확인)가 있는지 별도로 검증해야 함
- **커밋:** `pipeline stage 4-5 wiring: STAFF_REVIEW_GATE consumption + requester PDV recording`

### BUG-021
- **발생일:** 2026-07-25
- **Phase/위치:** 지방행정AC / `pages/regional-gov.html`,
  `gopang-app.js`
- **증상:** 정부기관 상담이 기관 측 PDV(`owner_pdv`)엔 기록되는데,
  요청자(시민) 자신의 PDV엔 상담 이력이 전혀 안 남음
- **원인:** `regional-gov.html`이 `webapp.html`의 별도 탭(`window.open`)
  이라, `webapp.html` 쪽 `_recordPDV()`(모듈 스코프 상태 `_USER`/
  `_userLocation`에 의존)를 직접 호출할 수 없었음
- **조치:** 새 프로토콜을 만들지 않고 기존 크로스탭 패턴
  (`HONDI_P2P_CONNECT_REQUEST`, `gopang-app.js`)을 재사용 —
  `regional-gov.html`이 `window.opener.postMessage()`로 발신,
  `gopang-app.js`가 수신해 자기 컨텍스트 안에서 `_recordPDV()` 호출
- **교훈:** 별도 탭에서 상위 탭의 모듈 상태에 의존하는 함수를 호출해야
  할 땐, 그 함수를 이 탭으로 복제하지 말고 이미 검증된 크로스탭 위임
  패턴이 있는지 먼저 찾는다(새 프로토콜을 늘리지 않음)
- **커밋:** 위와 동일

---

## 버그 패턴 분석

> BUG-001~011은 옛 코드베이스(Phase 1~8), BUG-012~021은 지방행정AC
> (`gov-router.js` 등)에서 발견된 것 — 서로 다른 코드베이스지만 패턴은
> 상당 부분 겹친다(특히 텍스트 검색 오탐 계열, BUG-001↔BUG-019).

| 패턴 | 건수 | 예방법 |
|------|------|-------|
| **텍스트 검색 오탐** | 3건 (001, 004, 019) | import 구문만 검색 / 지명·키워드 부분문자열 충돌은 새 지명 추가 시 사전 점검 |
| **테스트 조건 오류** | 4건 (005~007, 009) | 경계값 `<=`, 부동소수점 epsilon, 경로 계산 double-check |
| **Export 이름 불일치** | 1건 (011) | 신규 파일 작성 전 `01-system-map.md` 확인 필수 |
| **로직 오류** | 5건 (002, 003, 008, 010, 014) | 단위 테스트로 조기 발견 |
| **콘텐츠-배선 분리 누락**(v1.1 신규) | 1건 (012) | 새 인스턴스·기관 추가 시 데이터 레코드와 라우팅 배선을 항상 쌍으로 확인 |
| **도 판별 색인 범위 불일치**(v1.1 신규) | 1건 (013) | 파이프라인 각 단계가 보는 데이터 필드 범위를 별도 확인 |
| **도메인 키워드 사전 공백**(v1.1 신규) | 2건 (015, 016) | 사고실험(다양한 표현으로 실제 코드 실행)으로 빠짐 발견 |
| **트리거 정규식 공백**(v1.1 신규) | 1건 (017) | 위와 동일 |
| **후보 목록 미필터링**(v1.1 신규) | 1건 (018) | LLM에게 주는 선택지는 항상 "실행 가능한 것만"인지 검증 |
| **죽은 코드(정의만 되고 미호출)**(v1.1 신규) | 1건 (020) | export된 함수도 실제 호출부가 있는지 grep으로 별도 확인 |
| **크로스탭/모듈 스코프 기능 누락**(v1.1 신규) | 1건 (021) | 새 프로토콜 대신 기존 크로스탭 위임 패턴 재사용 여부 먼저 확인 |

---

## 새 버그 기록 양식

```markdown
### BUG-012
- **발생일:** YYYY-MM-DD
- **Phase/위치:** 배포 / src/XXX.js
- **증상:** Console에 표시된 정확한 오류 메시지
- **원인:** 근본 원인
- **조치:** 수정 내용
- **교훈:** 재발 방지 방법
- **커밋:** fix: 설명 (BUG-012)
```
