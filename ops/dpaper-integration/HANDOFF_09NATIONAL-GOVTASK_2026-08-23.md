# 인수인계서 — 09-national GOV_TASK 개별 등록 (2026-08-23 세션 종료 시점)

**작성일**: 2026-08-23 · **작성자**: Claude(이 세션) · **대상 독자**: 다음 세션의 Claude

---

## 0. 이 문서를 여는 사람에게

이번 세션은 원래 GOV-TASK-904-GAP의 09-national 카테고리 작업을 이어받아
시작했는데, 착수하자마자 **훨씬 근본적인 구조적 결함**을 발견해서 방향이
바뀌었다 — enterprises·qgov·other(337개 파일)가 `gov-router.js` 어디에도
배선돼 있지 않아, 콘텐츠는 있지만 어떤 사용자에게도 절대 도달할 수 없는
완전한 죽은 콘텐츠였다. 그래서 이번 세션 대부분은 **라우팅 인프라를
새로 까는 일**이었고, GOV_TASK(REQUIRED_DOCUMENTS_REGISTRY) 개별 등록은
막판에 딱 2건(KOSAF·TS)만 했다.

**즉 지금부터는 라우팅 걱정 없이, HUG/KOSAF/TS 3건이 확립한 절차를 그대로
반복하면 되는 상태다.** 아래 §2(표준 절차)부터 바로 실무에 들어갈 수
있다.

**추적표**: `ops/dpaper-integration/GOV-TASK-GAP-TRACKER_2026-08-20.csv` +
`GOV-TASK-GAP-TRACKER_README.md`. 이 두 파일을 먼저 열 것 — 특히 README
맨 아래 두 개 섹션("2026-08-23 세션 (계속) — other 라우팅"과 "qgov
GOV_TASK 개별 등록 착수")에 이번 세션 전체 경위가 상세히 기록돼 있다.

---

## 1. 현재 상태 (2026-08-23 세션 종료 시점)

CSV 기준(09-national 카테고리): **완료 3(HUG·KOSAF·TS) · 재정의 9 · 미착수 425**

이번 세션에 병합된 PR 4개(시간순):

| PR | 내용 |
|---|---|
| #599 | enterprises(29) 라우팅 인프라 신설 + HUG GOV_TASK 첫 등록 |
| #600 | KAC/IIAC 충돌가드 보강 + NIS 사전 버그 수정 + qgov(58) 라우팅 신설 |
| #601 | other(254개 중 243개) 라우팅 신설 |
| #602 | qgov GOV_TASK 2건 등록(KOSAF·TS) |

**09-national 5개 하위 폴더 전부 라우팅 가능**:

| 폴더 | 전체 | 라우팅 상태 | GOV_TASK 등록 |
|---|---|---|---|
| agencies | 28 | 원래부터 배선됨(national-agency-master-data.json) | 기존 다수 |
| policy-bodies | 70 | 원래부터 배선됨(_POLICY_BODY_DOMAIN_KEYWORDS) | 기존 다수 |
| enterprises | 29 | ✅ 이번 세션 신설 | HUG 1건만 |
| qgov | 58 | ✅ 이번 세션 신설 | KOSAF·TS 2건만 |
| other | 254(11개 제외, 243 등록) | ✅ 이번 세션 신설 | 0건 |

**남은 GOV_TASK 미등록**: enterprises 28 + qgov 56 + other 243 = **327건**

---

## 2. 표준 작업 절차 (확립됨, 그대로 따를 것)

HUG·KOSAF·TS 3건 모두 이 순서로 진행했고 전부 잘 맞았다:

1. **정부24(gov.kr) 검색으로 1차 확인** — "{기관명} {업무}"로 검색해
   정부24에 서비스로 등록돼 있는지 본다. 등록돼 있으면:
   - 절차·구비서류·접수기관·법적근거가 이미 정리돼 있어 조사가 빠르다.
   - 등록 안 돼 있으면(예: 순수 온라인 자체 시스템 안내형) 재정의
     후보일 가능성이 높다 — 무리해서 서류형으로 우기지 말 것(§4 참조).
2. **기관 공식 홈페이지에서 교차검증** — 정부24 정보가 오래됐거나
   부실할 수 있어, 기관 자체의 "이용절차 및 제출서류" 류 페이지를
   찾아 서류 목록·법조문을 재확인한다.
3. **REQUIRED_DOCUMENTS_REGISTRY 등록**(`worker.js`) — 키는
   `{agency코드소문자}:{task_key}` 형식. `agency`·`agency_name`·
   `task_name`·`legal_basis`·`documents`(각 항목 `id`/`name`/`required`/
   `acquisition`) 필드. `acquisition`은 `user_authored`(신청서·본인
   작성 서류)/`government_issued`(관공서 발급 서류, `max_age_days`
   가능)/`gov24`(정부24로 특정된 경우)/`external_insurer`(보험사 등
   외부기관 발급) 4종만 쓴다. `note` 필드에 "정직하게 밝힘" 문구로
   한계·조건부 서류·최종 결정권자를 명시할 것.
4. **AGENCY_TO_DEPT_TARGET 등록**(`worker.js`) — HUG/KOSAF/TS 전부
   `{ target_type: 'national', target_id: 'national:{agency코드}' }`
   패턴을 그대로 썼다. qgov·enterprises·other 구분 없이 이 패턴
   재사용하면 된다(별도 네임스페이스 불필요).
5. **DEPT_TASK_TAXONOMY.national에 코드 추가**(`src/worker/dept-task-
   handler.js`) — `'national:{agency코드}'` 한 줄 추가.
6. **SP 본문에 §1-2 섹션 삽입** — 대상 파일은
   `prompts/gov-tree/09-national/{enterprises|qgov|other}/SP-NAT-
   {ENT|QGOV|OTHER}-{코드}_v1.{1|2}.md`(폴더별로 버전 숫자가 다름 —
   enterprises·other는 `_v1.1.md`, qgov는 `_v1.2.md`, 파일명 그대로
   유지할 것, 아래 §3 참조). 위치는 `§1. 정체성 및 조직 개요` 바로
   뒤, `§INPUT_SCHEMA` 앞. HUG/KOSAF/TS의 §1-2 섹션 텍스트를 템플릿
   삼아 그대로 패턴 복사(구조: 공식 채널과의 관계 정직 고지 → 접수
   단계 → task_key 등록 사실과 근거 → 심사 단계 → 최종 결정권자는
   해당 기관이라는 고지).
7. **§CAPABILITIES 표 갱신** — "실제 계약·신청 처리: 안내만 수행"
   행을 "OO서류 준비·접수: 직접 수행(날짜, §1-2 참조) — 실제 최종
   결정은 기관이 확정" 행으로 교체(기존 안내형 행은 다른 업무가
   남아있으면 유지, 전부 흡수됐으면 삭제).
8. **검증**:
   ```powershell
   Get-Content worker.js -Raw | node --input-type=module --check
   Get-Content src\worker\dept-task-handler.js -Raw | node --input-type=module --check
   python tools\check_stale_refs.py
   ```
   (Windows PowerShell은 `<` 리다이렉션을 지원하지 않으므로 반드시
   `Get-Content ... -Raw | node --input-type=module --check` 형태로
   쓸 것 — `node --check < file.js` 방식은 PowerShell에서 파싱 에러남.)
9. **GOV-TASK-GAP-TRACKER_2026-08-20.csv 갱신** — 해당 행 찾아 `상태`를
   `완료`로, `비고`에 등록한 task_key와 근거 요약, `완료일` 기입.
10. **README에 세션 기록 추가** — 파일 맨 끝에 새 `## 날짜 세션` 섹션
    추가(기존 섹션들과 동일 형식) — 그날 뭘 했는지, 뭘 발견했는지,
    다음에 뭘 할지.

---

## 3. 반드시 알아야 할 함정 (이번 세션에 실제로 겪은 것들)

**① 파일명·헤더 버전이 고정돼 있다 — 절대 rename하지 말 것.**
enterprises·qgov·other 전부 지연 fetch 함수(`resolveEnterpriseLazy`·
`resolveQgovLazy`·`resolveOtherLazy`, `src/gopang/gov/gov-router.js`)가
파일 경로를 **템플릿 리터럴에 버전 숫자를 하드코딩**해서 만든다
(`SP-NAT-ENT-${code}_v1.1.md` 등). SP 본문을 갱신해도 파일명과 헤더의
`# 버전` 필드는 그대로 두고, 대신 "2026-08-23 갱신:" 같은 갱신 이력
줄만 헤더 주석에 추가한다. HUG 파일 헤더에 예시가 있다.

**② agencies에 이미 지사가 있는 기관은 qgov/enterprises SP가 사실상
도달 불가능하다.** 확인된 사례: NHIS(국민건강보험공단)·NPS(국민연금
공단)·KCOMWEL(근로복지공단) — 이 셋은 `09-national/agencies`에 이미
동일 기관의 "지사"형 SP가 등록돼 있고, 라우팅 우선순위상 agencies가
항상 먼저 걸린다(`_natAgencyHit` 가드). **이 기관들의 qgov SP에
GOV_TASK를 등록해봐야 사용자가 절대 도달 못 한다** — 만약 이 기관들
업무를 GOV_TASK로 배선하고 싶으면, `09-national/agencies/templates/
SP-NAT-{도메인}-TEMPLATE_*.md` 쪽에 작업해야 한다(qgov 쪽이 아니라).
작업 전에 항상 `grep -n "'{키워드}'" src/gopang/gov/gov-router.js`로
`_NAT_AGENCY_DOMAIN_KEYWORDS`·`_POLICY_BODY_DOMAIN_KEYWORDS`에 같은
기관명이 이미 있는지 확인할 것.

**③ 모기업 키워드를 포함하는 자회사는 등록해도 죽은 코드가 된다.**
확인된 사례: 코레일 계열사 5개(코레일유통·로지스·네트웍스·관광개발·
테크)는 전부 "코레일"을 이름에 포함해서 KORAIL(enterprises) 매칭이
항상 먼저 걸린다. 한전 계열사(한전MCS·한전원자력연료)도 "한전"
포함으로 동일. 이런 자회사에 GOV_TASK를 걸고 싶으면 먼저 모기업
키워드와 겹치지 않는 방법을 고민해야 한다(현재는 미해결 — 이번
세션은 아예 라우팅 등록을 보류했다, `_OTHER_DOMAIN_KEYWORDS`에서
검색해도 안 나옴).

**④ 키워드 사전이 5개나 된다 — 새 키워드 추가 전에 전수 대조 필수.**
`L2_CANONICAL_KEYWORDS`·`_POLICY_BODY_DOMAIN_KEYWORDS`·
`_NAT_AGENCY_DOMAIN_KEYWORDS`·`_ENTERPRISE_DOMAIN_KEYWORDS`·
`_QGOV_DOMAIN_KEYWORDS`(+ 이번에 안 만들었지만 `_OTHER_DOMAIN_KEYWORDS`
까지 총 6개) 전부 `src/gopang/gov/gov-router.js`에 있다. 이번 세션에
실제로 두 번 사고를 냈다 — KAC/IIAC가 agencies의 '공항공사'와,
KEIT2/KEITI/KIAT2가 policy-bodies의 bare '산업기술'과 부분 문자열로
충돌했는데 **최초 등록 시점엔 놓쳤다가 나중에 발견해서 수정**했다.
새 GOV_TASK 등록 자체는 기존 라우팅에 영향 없지만(REQUIRED_DOCUMENTS_
REGISTRY는 라우팅과 별개), **혹시 새 기관 SP를 아예 새로 라우팅에
추가해야 하는 상황이면** 반드시 아래처럼 파이썬으로 전수 대조부터
할 것(README의 "2026-08-23 세션 (계속)" 섹션에 실제 스크립트 예시 있음):
```python
import re
with open('src/gopang/gov/gov-router.js', encoding='utf-8') as f:
    content = f.read()
def extract_seg(marker):
    s = content.find(marker)
    seg = content[s:s+10000]
    return seg[:seg.find('\n};')+3]
# 6개 사전 전부 추출해 re.findall(r"'([^']+)'", seg)로 키워드 집합 만든 뒤
# 신규 키워드와 kw in name or name in kw로 부분 문자열 대조
```

**⑤ CSV의 09-national/other 행 수(250)가 실제 파일 수(254)와 다르다
— 정상이다.** CSV는 원본 904건 감사(2026-08-20, xlsx 스냅샷)에서 걸린
것만 추적하는 표라, 그 이후 새로 발견되거나 감사 범위 밖이던 파일은
CSV에 아예 없을 수 있다. 당황하지 말고 넘어갈 것.

---

## 4. "재정의" 판단 기준 — 무리해서 서류형으로 우기지 말 것

LH(한국토지주택공사)를 검토하다가 발견한 패턴: §CAPABILITIES에
"실제 계약·공급·신청 처리: 안내만 수행 (LH청약플러스로 연결)"이라고
이미 명시된 기관들은, 실제 신청이 **그 기관 자체의 온라인 시스템**을
통해서만 이루어지는 구조일 가능성이 높다(청약 신청 자체가 서류
제출이 아니라 시스템 입력형). 이런 경우:
- 무리하게 REQUIRED_DOCUMENTS_REGISTRY로 등록하려 하지 말 것 —
  07-org에서 "공모형·자체 심사 시스템" 기관들을 "재정의"로 분류했던
  전례와 동일한 판단 기준 적용.
- 반대로 정부24에 정식 등록된 서비스가 있으면(HUG·KOSAF·TS처럼)
  서류형 GOV_TASK로 등록 가능 — 정부24 등록 여부가 가장 빠른
  1차 판별 기준이다.

---

## 5. 다음 세션이 할 일 (우선순위 제안, 강제 아님)

327건(enterprises 28·qgov 56·other 243) 규모가 크므로, 배치를 나눠서
진행하는 게 자연스럽다.

1. **qgov 나머지 56건부터 이어가기를 권장** — enterprises보다 시민
   대상 서류기반 접수 밀도가 높아 보인다(HIRA·근로복지공단류·한국
   소비자원 등). 단 KCOMWEL은 위 §3-②에 따라 agencies 쪽에서 작업할
   것. 정부24에서 기관명 하나씩 검색하며 진행.
2. **other 243건** — 국립대병원(SNUH·PNUH·CNUH 등)은 진료 예약·
   진단서 발급 등 정형화된 병원 행정 서비스가 많을 수 있어 조사
   밀도가 괜찮을 것으로 보이나, 확인 안 됨 — 실제로 열어봐야 안다.
   박물관·과학관류(예술의전당·국립중앙과학관 등)는 대관·관람 예약형이
   많아 §4의 재정의 판단이 자주 나올 수 있다.
3. **enterprises 나머지 28건** — 발전공사 5개(EWP·KOEN·KOMIPO·KOSPO·
   WP)는 B2B 성격이 강해 재정의 후보 가능성이 높다는 게 이번 세션의
   1차 판단(미확인, 실제로 정부24 검색해서 확인할 것). LH는 위 §4
   참조.
4. **07-org(241건 미착수)**·**benefit-categories(13건, 재정의 필요)**
   는 09-national과 별개 트랙 — 09-national이 지겨워지면 이쪽으로
   넘어가도 됨.

매 배치마다 §2의 10단계를 빠짐없이 수행하고, CSV·README를 그때그때
갱신할 것(몰아서 하지 말 것 — 다음 세션이 또 같은 곳을 조사하지
않도록).

---

**이 문서 자체가 낡으면 갱신하거나 새로 쓸 것 — 다음 세션도 이 문서를
맹신하지 말고 GOV-TASK-GAP-TRACKER_README.md의 최신 섹션들을 직접
확인하는 것으로 시작할 것.**
