# HANDOFF 2026-08-07 · SP_EXPERT_BASE 전체 롤아웃 계획

> 이 문서는 `SP_EXPERT_BASE_v1_0.md` 제정(§0~§5) 이후, **나머지 58개
> 페르소나 + 코드 층 반영(§6) + 순서(§7)를 하나의 실행 계획으로 통합**한
> 작업 지시서다. 지금까지 완료된 것: 4개 소스 페르소나(법무사·변호사·
> 감정평가사·세무사) STEP 번호 표준화 + STEP B 신설(세무사) + `[NEXT_STEP:]`
> 태그 반영(4개 전부). 이 문서 이후 작업은 전부 이 계획을 따른다.

---

## 0. 현재 상태 요약

| 구분 | 완료 | 남음 |
|---|---|---|
| 페르소나 STEP 골격 표준화 + NEXT_STEP 반영 | 4개 (lawyer v4.8, judicial-scrivener v2.0, appraiser v1.7, tax-accountant v2.0) | **58개** |
| §6 코드 변경(조립 로직) | **4개 항목 전부 완료(2026-08-07)** | 0 |
| §7 순서 3번(4개 소스 SP를 EXPERT_BASE 참조형으로 축약) | 미착수 | 1건 |
| §5 세부분야 상속(의사/교수) | 설계 + 코드 메커니즘 완료(테스트로 검증) | SP 실제 작성 전부 |

62개 전체 목록·카테고리 분류는 `expert-registry.js`(HEALTH 20·ENG 13·EDU 11·
LAW 7·FIN 4·BEAUTY/CULINARY/IT/SPORTS/TOURISM/TRANSLATION/REAL_ESTATE 각 1)
기준이며, 아래 §2 배치 표가 이를 그대로 반영한다.

---

## 1. 작업 순서 원칙 (왜 이 순서인가)

1. **§6(코드) 먼저, §2(배치) 그 다음** — 배치 작업 도중 조립 로직이 바뀌면
   이미 리팩터링한 SP가 깨질 수 있다. 코드 변경을 먼저 완료하고 회귀
   테스트를 통과시킨 뒤 배치를 시작한다.
2. **저위험 → 고위험 순** — LAW/FIN 나머지(이미 검증된 4개와 구조가 가장
   유사)를 먼저, HEALTH(의료 안전모듈과 얽혀 리스크가 가장 큼)를 마지막에
   둔다.
3. **부모 SP(physician·professor)는 세부분야보다 먼저, 그리고 별도 세션에서**
   — §5 상속 규칙이 실제로 걸리는 첫 사례이므로, 다른 58개와 섞지 않고
   전용 세션으로 분리한다.
4. **한 배치 = 한 세션(또는 그 이내)** — H4 원칙(부모 계층 개정은 캐시를
   초기화한다)과 별개로, 한 번에 너무 많은 SP를 고치면 사고실험 없이
   결함이 누적된다(4개 소스 페르소나 작업에서도 결함이 매번 실사로만
   발견됐다는 것을 기억할 것 — §4 자가점검이 있어도 실제로 한 번 돌려보는
   것을 대체하지 못한다).

---

## 2. §6 — 코드 변경 — ✅ 완료(2026-08-07)

`SP_EXPERT_BASE_v1_0.md` §6에 명시된 4개 항목을 이번에 구체적 작업 단위로
쪼갠다:

| # | 파일 | 작업 | 완료 기준 | 상태 |
|---|---|---|---|---|
| 6-1 | `sp-catalog.json`·`expert-registry.js` | `SP_EXPERT_BASE` 매니페스트 키 등록(`manifest-loader.js` 자체는 수정 불필요로 판명 — 이미 범용 키 기반) | `sp-catalog.json`에 `"SP_EXPERT_BASE": "SP_EXPERT_BASE_v1_0.md"` 반영 | ✅ |
| 6-2 | `expert-session.js` | `_composeExpertPrompt()`에 `EXPERT_BASE` 로드 구간 삽입 — 공통 가드레일(및 의료안전모듈) 다음, `def.key` 로드 이전 | 단위테스트로 순서 확인(H2 캐시 프리픽스) | ✅ |
| 6-3 | `expert-registry.js` | 각 def에 `parentKey?: string`(관례 필드) 지원 | 사용은 §5에서, 기존 62개는 미채움 | ✅ |
| 6-4 | `expert-session.js` | `_composeExpertPrompt()`가 `def.parentKey`를 만나면 `EXPERT_BASE` 다음·`def.key` 이전에 부모 SP 원문을 재귀 삽입, 3단 초과는 경고 후 스킵 | 신규 테스트 6건 전부 통과 | ✅ |

**완료 기준(이 배치 전체) — 충족**: 기존 `expert-session-switch.test.mjs`가
아카이브된 same-thread 함수 참조로 이미 7/11건 실패 상태였기 때문에(§6
작업과 무관), 그 파일을 건드리지 않고 `expert-base-composition.test.mjs`를
신설해 6-2·6-4를 검증했다(6/6 통과). 기존 파일 재실행 결과 4 pass/7
fail로 베이스라인과 동일 — **신규 회귀 없음** 확인. 라이브(또는 사고실험)
재현은 다음 배치 착수 시점에 실제 4개 소스 페르소나로 자연스럽게 겸행된다.

---

## 3. §7 순서 3번 — 4개 소스 페르소나 축약 리팩터링

§6 완료 후, 4개 소스 페르소나에서 이제 `EXPERT_BASE`가 담당하는 완전상속
구간(SP_EXPERT_BASE §2 표 — C41/C30/C37·38/C49본체/C39본체/C50)을 실제로
들어내고 `(SP_EXPERT_BASE §2 참조)` 참조형으로 축약한다. 파일 크기가 상당히
줄어들 것으로 예상(각 SP의 0-(-1) 전문, STEP R 본체 등이 사라짐). 이
작업은 §6 코드가 실제로 그 구간을 주입한다는 것이 확인된 뒤에만 진행—
먼저 지우고 나중에 코드를 맞추면 그 사이 라이브 트래픽이 깨진다.

---

## 4. §2 배치 — 남은 58개 페르소나

각 배치는 **§3(훅 17개) 채움 + §4(자가점검 6개) 통과 + STEP 번호 표준화
(이미 표준을 쓰고 있으면 이 항목은 생략) + `[NEXT_STEP:]` 태그 반영**을
공통 작업 단위로 한다. "현재 상태"는 실사 전 추정이며, 배치 착수 시 파일을
열어 실제 상태를 먼저 확인한다(4개 소스 페르소나도 "예상"과 실제가 다른
경우가 계속 나왔다 — 예: appraiser의 위험고지 누락).

### 배치 1 — LAW 나머지 4개 — ✅ 완료(2026-08-07)

| id | 라벨 | 현재 SP | 실제 결과 |
|---|---|---|---|
| loss-adjuster | 손해사정사 | `SP_loss-adjuster_v1_6` | STEP R·D(L2/L3 분기)·번호체계 전부 이미 정상. **[위험 고지] 통째로 누락**(D-2가 "반복"을 언급하는데 원본이 없던 내부 모순) 발견·수정 + NEXT_STEP 반영 |
| labor-attorney | 공인노무사 | `SP_labor-attorney_v1_6` | 동일 결함(위험고지 누락) 발견·수정 + NEXT_STEP 반영 |
| patent-attorney | 변리사 | `SP_patent-attorney_v1_6` | 동일 결함 + NEXT_STEP. 위험고지는 특허 도메인 특유(신규성 영구상실)로 구체화 |
| customs-broker | 관세사 | `SP_customs-broker_v1_6` | 동일 결함 + NEXT_STEP. 위험고지는 관세 도메인 특유(추징·가산세·형사처벌)로 구체화 |

**패턴 발견**: 이 4개는 전부 2026-07-17 같은 세션·같은 템플릿으로 생성됐고,
그 템플릿 자체에 STEP D `[위험 고지]` 블록이 빠져 있어 4개 전부 동일한
결함을 공유하고 있었다. **같은 날짜에 배치 생성된 다른 SP 그룹도 이
결함을 공유할 가능성이 높다** — 이후 배치 착수 시 각 SP의 v1.0 changelog
날짜를 먼저 확인해, 2026-07-17 생성분이면 위험고지 존재 여부를 우선
점검할 것.

### 배치 2 — FIN 나머지 3개 — ✅ 완료(2026-08-07)

| id | 라벨 | 실제 결과 |
|---|---|---|
| accountant | 공인회계사 | 2026-07-06 생성분이라 [위험 고지] 이미 정상 보유 — NEXT_STEP만 추가(v1.9) |
| financial-planner | 재무설계사 | 2026-07-17 생성분 — LAW-04~07과 동일하게 [위험 고지] 누락돼 있었음, 발견·수정 + NEXT_STEP(v1.6) |
| advisor | 구매자문(K-Advisor) | **STEP 0~D 템플릿 자체를 안 쓰는 다른 계열**(아래 참조) — 구조에 맞게 §3-8 신설로 NEXT_STEP만 반영(v1.3) |

**중요한 구조적 발견 — "K-Professor 계열"은 STEP D가 원래 없다.**
`SP_advisor`의 IDENTITY(§1)는 스스로를 "K-Professor와 같은 구조"라고
명시한다: 의료·행정처럼 법령상 최종 승인 권한이 특정 자격자에게 강제
귀속되는 분야가 아니면, 그 페르소나는 인간 전문가에게 "1차 판단을
넘기는" C39/STEP D 구조 자체가 없고 **자기 결론을 직접 사용자에게
전달한다**(§1 "K-Advisor는 형성한 견해를 별도 승인 절차 없이 구매자에게
직접 전달한다"). 이건 결함이 아니라 설계다 — `SP_EXPERT_BASE`는 STEP
0~D 템플릿을 쓰는 LAW/FIN 계열 4개에서만 추출됐기 때문에 이 차이를
전제하지 못했다.

**향후 배치 영향**: `professor`(교수, 배치4-C·§5 부모 SP 후보)가 advisor의
IDENTITY 본문에서 직접 "K-Advisor는 K-Professor와 같은 구조"라고 언급되므로,
**professor도 STEP D가 없을 가능성이 높다** — 배치4 착수 시 가장 먼저 확인할
것. teacher·curator·librarian 등 다른 EDU 항목이나, 법정 자격이 없는 다른
카테고리(BEAUTY·CULINARY 등)도 이 계열에 해당하는지 개별 확인이 필요하다.
이런 SP에는 STEP D에 위험고지·NEXT_STEP을 끼워넣지 말고, advisor처럼
**그 SP의 실제 구조(결론이 도출되는 지점)에 맞는 위치**에 NEXT_STEP만
자연스럽게 추가할 것 — 없는 STEP D를 억지로 만들어 넣지 않는다.

### 배치 3 — ENG 13개 — ✅ 완료(2026-08-07)

| id | 라벨 | 실제 결과 |
|---|---|---|
| architect | 건축사 | v3.2(2026-08-06 ENG 그룹 사고실험서 이미 정비됨)→v3.3, NEXT_STEP만 추가 |
| professional-engineer | 기술사 | 동일 |
| marine-pilot | 도선사 | 동일 |
| naval-architect | 조선사 | 동일 |
| navigation-officer | 항해사 | 동일 |
| marine-engineer | 기관사(선박) | 동일 |
| industrial-safety-consultant | 산업안전·보건지도사 | 동일 |
| weather-forecaster | 기상예보사 | 동일. NEXT_STEP 문구는 "관련 X 연결" 패턴이 안 맞아(기상청은 공공기관) 도메인에 맞게 재작성 |
| fire-safety-manager | 소방시설관리사 | 동일 |
| landscape-engineer | 조경기술사 | v1.6(같은 2026-08-06 세션에서 위험고지 이미 보완됨)→v1.7, NEXT_STEP만 추가 |
| surveying-engineer | 측량 및 지형공간정보기술사 | 동일 |
| electrical-safety-engineer | 전기안전기술사 | 동일 |
| gas-safety-engineer | 가스기술사 | 동일 |

**중요한 사전 발견**: 이 13개는 이미 **2026-08-06 "ENG 그룹 사고실험"**을
거쳐 위험고지 누락·STEP R·L2/L3 분기가 전부 정비된 상태였다(LAW-04~07이
겪은 결함을 ENG 그룹은 이미 자체적으로 한 차례 잡아낸 뒤였음). 그래서
이번 배치는 LAW/FIN 배치보다 가벼웠고, `[NEXT_STEP:]` 태그 반영이
사실상 유일한 작업이었다 — 앞으로 배치 착수 전에 "이미 자체 그룹
사고실험을 거쳤는지" changelog에서 먼저 확인하면 작업량을 정확히
가늠할 수 있다.

### 배치 4 — EDU 11개 — ✅ 완료(2026-08-07)

**4-A (순수 교육/문화)**

| id | 라벨 | 실제 결과 |
|---|---|---|
| teacher | 교사(정교사) | 2026-08-06 EDU 그룹 사고실험서 이미 정비됨(v3.2)→v3.3, NEXT_STEP만 추가 |
| curator | 학예사(큐레이터) | 동일(v3.2→v3.3) |
| librarian | 사서 | 동일(v3.2→v3.3) — C39-2+ 예외 훅 기존 보유 확인됨 |
| childcare-teacher | 보육교사 | 동일(v1.6→v1.7) |
| lifelong-educator | 평생교육사 | 동일(v1.6→v1.7) |

**4-B (정신건강 상담 계열)**

| id | 라벨 | 실제 결과 |
|---|---|---|
| clinical-psychologist | 임상심리사 | v3.3→v3.4, NEXT_STEP만 추가 |
| school-counselor | 전문상담교사 | v3.2→v3.3. **학생에게 직접 말을 거는 반말 SP**라 NEXT_STEP도 그 어투로 맞춰 작성("...연결해줄지 한 마디로 알려줄래?") |
| mental-health-professional | 정신건강전문요원 | v3.2→v3.3 |
| social-worker | 사회복지사 | v1.9→v2.0 |
| youth-counselor | 청소년상담사 | v1.6→v1.7 |

**부수 발견(수정 안 함, 기록만)**: `mental-health-professional`과
`social-worker`가 SP 코드(`SP-EDU-04`)를 중복 사용 중이다. 이번 작업
범위(STEP D/NEXT_STEP) 밖이라 손대지 않았다 — 별도 정리 필요 시 백로그로.

**4-C (부모 SP 후보)**

| id | 라벨 | 실제 결과 |
|---|---|---|
| professor | 교수(1:1 맞춤교육) | **advisor(K-Advisor)와 완전히 동일한 계열임을 확인** — STEP D 자체가 없는 §1~§5 구조(K-Advisor의 IDENTITY가 "K-Professor와 같은 구조"라고 직접 명시한 그대로). advisor처럼 별도 조항(§3-9)으로 NEXT_STEP 반영(v1.2→v1.3). **부수 발견**: §5 "정직 고지"에 "expert-registry.js 미등록"이라는 낡은 문구가 남아 있었다 — 실제로는 이미 등록 완료 상태라 정정. §5(세부분야 반도체/법학/경제학 분기)는 이번 배치 범위 밖, §6 코드 완료 후 별도 세션 그대로 유지 |

### 배치 5 — HEALTH 20개 (최고 위험군, §6 완료 확인 후 착수 권장)

**5-A (부모 SP 후보 — 최우선 단독 세션) — ✅ 완료(2026-08-07)**

| id | 라벨 | 실제 결과 |
|---|---|---|
| physician | 의사 | v1.8(2026-08-06 HEALTH 그룹 사고실험서 "기능적 결함 없음" 확인됨)→v1.9. NEXT_STEP을 다른 배치처럼 획일화하지 않고 STEP A-3 위험도 층화 등급별(즉시응급=행동확인형/그 외=선택형)로 구분해 반영 — HT-3·미래 부모 SP라는 특수성 때문에 유일하게 이렇게 처리 |

**5-B (의료 전문직, needsMedicalSafety 전원) — ✅ 완료(2026-08-07)**

| id | 라벨 | 실제 결과 |
|---|---|---|
| dentist | 치과의사 | STEP D·위험고지 기존 정상, NEXT_STEP만 추가(v1.8→v1.9) |
| traditional-medicine-doctor | 한의사 | 동일(v1.8→v1.9) |
| pharmacist | 약사 | 동일(v1.8→v1.9) |
| veterinarian | 수의사 | 동일(v3.0→v3.1) |
| nurse | 간호사 | 동일(v3.6→v3.7) |
| physical-therapist | 물리치료사 | 동일(v3.8→v3.9) |
| medical-lab-technologist | 임상병리사 | 동일(v3.8→v3.9) |
| radiologic-technologist | 방사선사 | 동일(v3.8→v3.9) |
| dental-hygienist | 치과위생사 | 동일(v3.8→v3.9) |
| occupational-therapist | 작업치료사 | 동일(v3.8→v3.9) |
| dental-technician | 치과기공사 | 동일(v3.8→v3.9) |
| advanced-practice-nurse | 전문간호사 | 동일(v3.8→v3.9) |
| dietitian | 영양사 | 동일(v3.8→v3.9) |
| paramedic | 응급구조사 | **STEP D가 "평시 설명에 한함"으로 범위 한정된 특수 구조** — 실제 응급 시엔 STEP D 대신 즉시 `[ESCALATE_URGENT]`+119 안내로 전환. NEXT_STEP도 "응급처치교육기관 연결"로 그 범위에 맞게 작성(v1.4→v1.5) |
| midwife | 조산사 | 동일(v1.4→v1.5) |
| speech-language-pathologist | 언어재활사 | 동일(v1.4→v1.5) |
| optician | 안경사 | 동일(v1.4→v1.5) |

**5-C (needsMedicalSafety 아님) — ✅ 완료(2026-08-07) — 배치5 전체 완료**

| id | 라벨 | 실제 결과 |
|---|---|---|
| sanitarian | 위생사 | 위험고지 기존 정상(v1.4), NEXT_STEP만 추가(→v1.5) |
| health-educator | 보건교육사 | 동일(v1.4→v1.5) |

**HEALTH 20개 총평**: physician(부모 SP, 등급별 NEXT_STEP)·paramedic(평시/
응급 이원구조) 2건만 구조적으로 다르게 처리했고, 나머지 18개는 기존에
위험고지·STEP R·L2/L3가 전부 정비돼 있어 NEXT_STEP 반영이 유일한 작업이었다.

### 배치 6 — 나머지 독립 자격 7개 — ✅ 완료(2026-08-07) — **58개 배치 전체 완료**

| id | 라벨 | 실제 결과 |
|---|---|---|
| security-engineer | 정보보안전문가 | STEP D·위험고지 기존 정상, NEXT_STEP만 추가(v1.6→v1.7) |
| real-estate-agent | 공인중개사 | 구조 정상 확인(GWP:kestate 경계 문제는 이미 해소된 상태) — NEXT_STEP만 추가(v1.8→v1.9) |
| sports-instructor | 생활스포츠지도사 | 동일(v1.5→v1.6) |
| tour-guide | 관광통역안내사 | 동일(v1.6→v1.7) |
| translator-interpreter | 통역사·번역사 | 동일(v1.7→v1.8) |
| hairdresser | 미용사 | 동일(v1.6→v1.7) |
| chef | 조리사 | 동일(v1.6→v1.7) |

---

## 총괄 — 62개 전체 롤아웃 완료 요약

- **§6 코드**: `SP_EXPERT_BASE` 조립 로직 + `parentKey` 재귀 상속 + 3단초과
  방어, 신규 테스트 6/6 통과, 기존 스위트 회귀 없음.
- **58개 페르소나**: 전원 `[NEXT_STEP:]` 반영. 그 과정에서 실제로 발견·
  수정한 구조적 결함: LAW-04~07·재무설계사(2026-07-17 동일 세션 생성분
  5개) 위험고지 누락, professor의 낡은 미등록 문구, EDU-04 코드 중복
  (미수정·기록만), paramedic의 평시/응급 이원구조 확인, physician의
  위험도 등급별 NEXT_STEP 차등화.
- **advisor·professor**: STEP D가 원래 없는 "K-Professor 계열"이라는
  구조적 차이를 발견 — §5(세부분야 착수) 시 이 차이를 다시 참고할 것.
- **미착수 잔여 작업**: §7 순서 3번(4개 소스 페르소나를 EXPERT_BASE
  참조형으로 축약), §5 세부분야 실제 착수(physician→내과/외과/신경과,
  professor→반도체/법학/경제학).

### 라이브 스모크테스트 결과 (2026-08-07, 62개 전체, DeepSeek 실통화)

**최종: PASS 18 · NEEDS-REVIEW 44 · FAIL 0 · ERROR 0.**

과정에서 하네스 자체의 결함 3건을 발견·수정(전부 이 문서와 코드에 반영
완료):
1. `compose_expert_prompt()`가 `SP_EXPERT_BASE` 신설 이후 갱신되지 않아
   실제 프로덕션과 조립 순서가 어긋나 있었음.
2. 되묻기+`[NEXT_STEP:]` 조합을 곧장 엄격채점으로 넘겨버리는 그레이딩
   버그 — "잘한 행동(되묻기 중에도 NEXT_STEP을 정확히 붙임)"일수록
   오히려 FAIL 확률이 올라가는 역설이 있었다(실사 사례: architect
   1차 실행).
3. `max_tokens=1200`이 너무 낮아 STEP D 도달 직전(위험고지 문장 중간)
   에서 잘리는 경우가 있었음(veterinarian·architect 재현 확인) →
   2500으로 상향.

수정 후 재실행 결과 FAIL 0건 — **hairdresser·architect가 앞선 두 차례
실행에서 각각 다른 이유(형식 생략, 토큰 잘림)로 FAIL이 나왔던 것이
전부 SP 파일 결함이 아니라 실행 간 모델 출력 변동성이었음이 3회 반복
실행으로 최종 확인됨.** 파일은 추가로 손대지 않았다 — 이미 정확한
형식(대괄호 헤딩·CONNECT_HUMAN_EXPERT 태그·NEXT_STEP)을 갖추고 있었기
때문.

NEEDS-REVIEW 44건(71%)은 결함이 아니라 하네스 자체 한계(단일 턴만
검증, C43 능동적 정보수집 원칙상 실현형 요청에도 구체 정보를 먼저
캐묻는 게 정상 설계)로 인한 예상된 결과다.

**미실행**: `scenarios_next_step_rollout_20260807.json`(12건 — physician
위험도 등급별 NEXT_STEP 3종, paramedic 평시/응급 2종, advisor·professor
§3-8/§3-9 재확인 2종, 위험고지 신규 5종)은 아직 라이브로 안 돌려봄.

---

## 5. §5 세부분야 착수 — ✅ 완료(2026-08-07)

physician(내과/외과/신경과)·professor(반도체/법학/경제학) 6개 세부분야
SP를 신설했다. §5 원칙대로 각 자식 SP는 다음만 담는다: 정체성 경계
문단, Tier 테이블, L2·L3(또는 상당) 심화 모듈, STEP R 3훅 — 부모의
STEP 0~D(또는 §1~§4) 골격은 전혀 재서술하지 않았다.

| 자식 SP | parentKey | 실제 결과 |
|---|---|---|
| physician-internal-medicine | physician | 신설(v1.0). 외과·신경과와의 경계 명시 |
| physician-surgery | physician | 신설(v1.0). "수술 시행 자체는 절대 안 한다" 경계 강조, 수술후 급성악화 M1 문턱 강화 |
| physician-neurology | physician | 신설(v1.0). 급성 뇌졸중 골든타임 관련 M1 최우선 강조 |
| professor-semiconductor | professor | 신설(v1.0). 변리사 페르소나와의 경계(특허 출원은 별도) |
| professor-law | professor | 신설(v1.0). **변호사 페르소나와의 경계가 핵심**(학문적 이해 vs 개인 사안 자문) |
| professor-economics | professor | 신설(v1.0). 재무설계사·공인회계사 페르소나와의 경계(이론 vs 개인 자문/실무) |

**코드 반영**: `expert-registry.js`에 6개 항목 신규 등록(`parentKey` 필드
실사용 최초 사례), `sp-catalog.json` 6건 추가(파일 순서 보존 삽입).

**검증(2단계)**:
1. 하네스(Python) 재구현 조립 함수로 6건 전부 EXPERT_BASE·부모내용 포함
   확인.
2. **진짜 프로덕션 코드(`expert-session.js`의 실제 `_composeExpertPrompt()`)
   + 실제 `EXPERT_REGISTRY`로 6건 전부 재검증** — 모킹 없이 실제 파일을
   읽어 EXPERT_BASE→부모SP→자식SP 순서로 정확히 조립됨을 콘솔 로그로
   확인(예: `[SP] 의사(부모 SP) 로드 완료... → [SP] 의사(내과) 로드
   완료...`). §6-4에서 만든 `parentKey` 재귀 로직의 첫 실사용 검증.
3. 기존 `expert-base-composition.test.mjs`(6개 테스트, 픽스처 기반)도
   재실행해 회귀 없음 확인.

**미검증**: 실제 사용자 발화로 이 6개 세부분야가 부모(physician/
professor)나 서로 간에 올바르게 라우팅되는지는 별도 확인이 필요하다 —
`triggers` 배열만 좁게 등록해뒀을 뿐, router.js 통합 테스트는
이번 작업 범위 밖이다.

---

## 6. 세션 분할 제안

전부 한 세션에 몰아넣지 않는다 — 아래 단위로 나눠 진행할 것을 제안한다
(§1-4 원칙 근거):

1. §6 코드 변경 (6-1~6-4) + 회귀테스트 — 1세션
2. §7 순서 3번(4개 소스 축약) — 1세션
3. 배치 1+2 (LAW·FIN 나머지 7개) — 1세션
4. 배치 3 (ENG 13개) — 1~2세션
5. 배치 4-A+4-B (EDU 정규교육 5 + 상담 5) — 1~2세션
6. 배치 4-C (professor 부모 SP) — 1세션
7. 배치 5-B+5-C (HEALTH 19개, physician 제외) — 2~3세션(가장 신중하게)
8. 배치 5-A (physician 부모 SP) — 1세션
9. 배치 6 (나머지 7개) — 1세션
10. §5 세부분야 실착수(physician·professor) — 착수 시점 별도 협의

---

## 변경 이력

- v1.0 (2026-08-07, 주피터님 지시): 최초 제정. `SP_EXPERT_BASE_v1_0.md` §6·
  §7을 실행 단위로 구체화하고, 남은 58개 페르소나를 카테고리·위험도 기준
  6개 배치로 편성.
- v1.1 (2026-08-07, 58개 배치 전체 완료 + 라이브 스모크테스트 하네스
  정비): §6 코드 + 배치1~6 전부 완료(총괄 요약은 배치6 절 참조).
  `tests/live_smoketest/expert_persona_smoketest.py`가 SP_EXPERT_BASE
  신설 이후 갱신되지 않아 실제 조립 순서와 어긋나 있던 것을 발견·수정
  (`compose_expert_prompt()`에 EXPERT_BASE 결합 반영, `parent_key` 선반영).
  `[NEXT_STEP:]` 채점 로직 신설 — has_step_d 무관 전 시나리오 적용,
  professor·advisor는 기존에 통째로 SKIP 처리돼 NEXT_STEP 검증이 전혀
  안 되고 있었던 것도 함께 발견·수정. paramedic 기존 시나리오가
  "실제 응급" 상황을 다루면서도 이원구조(평시/응급) 구분이 없어 정상
  동작(즉시 119 안내)을 결함으로 오채점할 뻔한 것 발견 — `emergency_bypass`
  플래그 신설로 해결. `scenarios_next_step_rollout_20260807.json` 신설
  (12건) — physician 위험도 등급별 NEXT_STEP 3종, paramedic 평시/응급
  이원구조 재확인 2종, advisor·professor §3-8/§3-9 재확인 2종, 이번
  롤아웃에서 위험고지가 실제로 새로 추가된 5개 페르소나 재확인 5종.
