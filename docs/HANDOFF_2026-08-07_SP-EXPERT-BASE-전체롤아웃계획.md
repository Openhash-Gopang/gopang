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

### 배치 3 — ENG 13개 (물리적 안전 관련 항목 주의)

| id | 라벨 | 비고 |
|---|---|---|
| architect | 건축사 | |
| professional-engineer | 기술사 | |
| marine-pilot | 도선사 | |
| naval-architect | 조선사 | |
| navigation-officer | 항해사 | |
| marine-engineer | 기관사(선박) | |
| industrial-safety-consultant | 산업안전·보건지도사 | HT-2(물리적 안전) 가능성 — §3-⑯ Tier표에 신체 위해 반영 |
| weather-forecaster | 기상예보사 | 응급 상황(기상특보) 연계, C6 확인 |
| fire-safety-manager | 소방시설관리사 | HT-2 — STEP -1급 응급 트리아지 유무 확인(C41 v3.7 changelog에서 이미 예시로 언급된 SP) |
| landscape-engineer | 조경기술사 | |
| surveying-engineer | 측량 및 지형공간정보기술사 | |
| electrical-safety-engineer | 전기안전기술사 | HT-2 |
| gas-safety-engineer | 가스기술사 | HT-2, 응급(가스누출) 연계 확인 |

### 배치 4 — EDU 11개 (정신건강 계열 6개는 세분화 주의)

**4-A (순수 교육/문화, 리스크 낮음)**

| id | 라벨 | 비고 |
|---|---|---|
| teacher | 교사(정교사) | |
| curator | 학예사(큐레이터) | |
| librarian | 사서 | C39-2+ 예외 훅을 이미 보유한 것으로 실사 언급됨(v3.27 changelog) — 재확인만 |
| childcare-teacher | 보육교사 | |
| lifelong-educator | 평생교육사 | |

**4-B (정신건강 상담 계열, C6 응급상황 원칙과 밀접)**

| id | 라벨 | 비고 |
|---|---|---|
| clinical-psychologist | 임상심리사 | needsMedicalSafety |
| school-counselor | 전문상담교사 | needsMedicalSafety |
| mental-health-professional | 정신건강전문요원 | needsMedicalSafety |
| social-worker | 사회복지사 | needsMedicalSafety, C43 최초 적용 대상으로 앞서 언급된 바 있음(4개 소스 다음으로 검증도가 높을 가능성) |
| youth-counselor | 청소년상담사 | needsMedicalSafety |

**4-C (부모 SP 후보 — 별도 취급)**

| id | 라벨 | 비고 |
|---|---|---|
| professor | 교수(1:1 맞춤교육) | **§5 세부분야(반도체/법학/경제학) 부모 SP** — 이 배치에서는 §3 훅 17개를 "완결된 일반 교수 SP"로 채우기만 하고, 세부분야 분기는 §6 코드 완료 후 별도 세션(§6 참조) |

### 배치 5 — HEALTH 20개 (최고 위험군, §6 완료 확인 후 착수 권장)

**5-A (부모 SP 후보 — 최우선 단독 세션)**

| id | 라벨 | 비고 |
|---|---|---|
| physician | 의사 | **§5 세부분야(내과/외과/신경과) 부모 SP**. needsMedicalSafety. HT-3(최고 위해강도) — C30~C34 완전 유지 대상(v3.18 C46 changelog 참조). 이 배치는 단독 세션 권장 |

**5-B (의료 전문직, needsMedicalSafety 전원)**

| id | 라벨 |
|---|---|
| dentist | 치과의사 |
| traditional-medicine-doctor | 한의사 |
| pharmacist | 약사 |
| veterinarian | 수의사 |
| nurse | 간호사 (v1.6 changelog에서 C44 두 번째 반영 사례로 이미 언급 — 검증도 확인) |
| physical-therapist | 물리치료사 |
| medical-lab-technologist | 임상병리사 |
| radiologic-technologist | 방사선사 |
| dental-hygienist | 치과위생사 |
| occupational-therapist | 작업치료사 |
| dental-technician | 치과기공사 |
| advanced-practice-nurse | 전문간호사 |
| dietitian | 영양사 |
| paramedic | 응급구조사 — 응급 트리아지 게이트 유무 최우선 확인(C41 v3.7 changelog에서 예시로 이미 physician과 함께 언급됨) |
| midwife | 조산사 |
| speech-language-pathologist | 언어재활사 |
| optician | 안경사 |

**5-C (needsMedicalSafety 아님)**

| id | 라벨 |
|---|---|
| sanitarian | 위생사 |
| health-educator | 보건교육사 |

### 배치 6 — 나머지 독립 자격 7개 (그룹핑은 편의상, 서로 무관)

| id | 라벨 | 카테고리 |
|---|---|---|
| security-engineer | 정보보안전문가 | IT |
| real-estate-agent | 공인중개사 | REAL_ESTATE — v1.x 이력에서 GWP:kestate와의 경계 문제로 트리거 재조정 이력 있음, 그 문맥 먼저 확인 |
| sports-instructor | 생활스포츠지도사 | SPORTS, needsMedicalSafety |
| tour-guide | 관광통역안내사 | TOURISM |
| translator-interpreter | 통역사·번역사 | TRANSLATION |
| hairdresser | 미용사 | BEAUTY |
| chef | 조리사 | CULINARY |

---

## 5. §5 세부분야 착수 (전체 배치 완료 후 또는 §6 완료 직후 별도 트랙)

physician(내과/외과/신경과)·professor(반도체/법학/경제학) 세부분야는 부모
SP(배치 4-C, 5-A)가 완결되고 §6 코드가 실제로 3단 조립을 처리하는 것이
회귀 테스트로 확인된 뒤에만 착수한다. 각 세부분야 1개당 최소 신설 기준
(§5 H5 — "형제가 2개 이상 실제로 필요한가")을 먼저 재확인.

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
