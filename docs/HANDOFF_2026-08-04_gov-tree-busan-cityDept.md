# HANDOFF_2026-08-04_gov-tree-busan-cityDept.md
## gov-tree 부산 파일럿 — 04-city-dept 확대 세션 인수인계

작성일: 2026-08-04 | 이전 세션: 부산 파일럿·전국 확대(제주 267건 추상화, SP-EMD-TEMPLATE v1.3, gov-router 폴백 버그 수정)

## 이 문서를 받았다면 (다음 세션 Claude에게)

주피터님이 이 문서를 새 대화창에 올리고 "이어서 진행하십시오"라고 하면, §4(다음 작업
지시)부터 바로 진행하면 됩니다. 배경 설명 없이도 이해할 수 있도록 이 문서 하나로
충분하게 작성했습니다. **§0(작업 방식)과 §3(함정 목록)은 반드시 먼저 읽으세요** — 이전
세션에서 같은 실수를 여러 번 반복했습니다.

---

## 0. 작업 방식 (매우 중요 — 이전 세션에서 여러 번 실수한 부분)

이 세션은 `bash_tool` 샌드박스에서 `github.com`/`raw.githubusercontent.com`/
`codeload.github.com`은 접근 가능하지만 **git push 인증 정보가 없다.**

1. `git clone https://github.com/Openhash-Gopang/gopang.git`로 로컬에 저장소를 받는다.
2. 코드를 수정·커밋한다(`git config user.name "Do Young Min"`,
   `git config user.email "mobile.linkr@gmail.com"`).
3. **작업 시작 전 반드시 `git fetch origin`으로 최신 `origin/main`부터 확인할 것** — 이번
   세션 내내 다른 세션(jejuro님)이 병행 작업 중이었고, 여러 번 최신 상태를 놓쳐서
   patch가 깨졌다.
4. `git checkout -b <새브랜치명> origin/main`으로 **항상 최신 origin/main 기준**의 새
   브랜치에서 작업한다. 예전 브랜치를 재사용하려다 로컬-원격 불일치로 여러 번 실패했다.
5. `git format-patch origin/main..HEAD -o <디렉터리>`로 patch 생성 후 `present_files`로
   전달하기 **전에, 별도 클론에 `git am`으로 미리 적용해 충돌 없는지 검증**할 것.
6. 사용자는 Windows PowerShell을 쓴다. `PS C:\...>` 프롬프트 문자열은 빼고 명령어만
   복사하도록 안내할 것.
7. **PowerShell은 `"*.patch"` 같은 와일드카드를 자동으로 안 펼친다** — `git am "*.patch"`는
   실패한다. 반드시 `Get-ChildItem`으로 파일 목록을 만들어 넘길 것:
   ```powershell
   $patches = Get-ChildItem "$HOME\Downloads\<폴더명>\*.patch" | Sort-Object Name
   git am $patches.FullName
   ```
8. 저장소 로컬 경로: `C:\Users\주피터\Downloads\gopang` (사용자 PC 기준).
9. `git am` 실패 시 **항상 `git am --abort`로 먼저 원상복구**하고, `git branch -a`·
   `git log --oneline -3`으로 **현재 어느 브랜치에 있는지부터 재확인**할 것 — 이번
   세션에서 엉뚱한 브랜치(`docs/nationwide-gov-routing-design`)에서 `git am`을 시도해
   실패한 적이 있다.

---

## 1. 지금까지 뭘 했는지 (요약)

`docs/GOVTREE_NATIONWIDE_EXPANSION_LESSONS_v1_0.md`(+`.html`)가 이번 세션 전체의 교훈
정리 문서다 — **반드시 먼저 읽을 것.** desktop.html "🛠 개발자 문서" 섹션과
`docs/MANUAL_INDEX.html`에 링크됨.

**병합 완료된 것** (main에 이미 반영):
- 제주 gov-tree 267개 기관·부서 전수 추상화 검증 — do-dept 22/22, do-agency 10/10,
  org 26/26 전부 클래스 템플릿 참조 완료 확인(중간에 검증 방법 오류로 세 번 오판했다가
  정정한 경위는 레슨 문서 §1 참조)
- `SP-EMD-TEMPLATE` v1.3 — 제주 행정시(제주시/서귀포시) 이원구조 하드코딩 제거,
  `{상위기관구분}` enum(행정시\|자치구\|자치군\|일반시\|일반군)으로 전국 일반화.
  `gov-router.js`의 `_renderEmdTemplate()`·템플릿 파일명 참조 3곳까지 함께 갱신
- 부산 01-do(광역시청 자체), 02-do-dept(16개 실·국, jejuro님 실사), 04-city(16개
  구·군 자체 — 주소·전화·행정동 개수) 완료
- 부산 04-city-dept: **해운대구만** 4개 도메인(jachi/econ/welfare/housing) 완료
- 부산 07-org 1호(부산교통공사, jejuro님 저작) — `BUSAN_ORG_TABLE` 신설
- `gov-router.js` 버그 수정 2건: directCode 도(道) 하드코딩(jejuro님),
  **org/agency 기관 매칭 완전 실패 시 LLM 폴백 구제 경로 신설**(이번 세션, 아래 §2 참고)

**아직 브랜치 상태로만 있고 main 미병합**: `docs/govtree-lessons-manual-v2` — 사용자가
GitHub에서 PR 병합 절차를 진행 중일 수 있음. 작업 시작 전 `git log origin/main -3`으로
이게 병합됐는지부터 확인할 것.

## 2. 이번 세션에 발견한 핵심 버그 (실측 기반, 이미 수정·검증 완료)

**증상**: gov-tree 전용 SP가 있는 기관(도청·시청·직속기관·출자출연기관)은 SP-18
RULE-07 [7-D]에 따라 K-Search/PocketBase가 아니라 `gov-router.js`의 정적 키워드 매칭
(`_resolveInstitutionMatch`)으로만 라우팅된다. 그런데 이 함수는 kw 배열에 리터럴로
안 걸리면(`topScore===0`) **그 자리에서 즉시 `null`을 반환**했다 — "지하철 타다가
물건 놓고 내렸는데 어디다 물어봐요"처럼 kw에 없는 자연어 패러프레이즈는 do-agency
10개·org 26개(+타 도 확장분) 전체에서 완전히 새는 사각지대였다.

**수정**: `topScore===0`이어도 즉시 포기하지 않고, `table` 전체(desc 필드 보유)를
후보로 기존 `_classifyDivisionFallback`(LLM 분류)을 재사용해 한 번 더 시도하도록
변경. 새 헬퍼 없이 기존 함수 재사용으로 해결. `directcode-province-resolution.test.mjs`에
mock classifyFn 테스트 2건 추가(10/10 통과).

**같은 패턴이 다른 곳에도 있는지 전수 점검 완료** — division(과·팀) 단위 매칭 5곳은
전부 "세부 매칭 실패해도 상위 기관 단위로 안전 강등"하는 의도된 설계라 문제없음
확인. **더 고칠 곳 없음.**

## 3. 함정 목록 (다음 세션이 반복하지 말아야 할 것)

레슨 문서 §1-2·§2에 상세 있음. 요약:

1. **추상화 커버리지 판단**: 계층마다 클래스 참조 문구가 다르다
   ("클래스 템플릿" ≠ "클래스 상속"). 검색 전에 정확한 문구부터 확인할 것.
2. **B방식 계층**(01-do·04-city·05-emd)은 `file: null` 스텁만 보고 "콘텐츠 없음"
   단정하지 말 것 — 실제 렌더링 경로(마스터데이터 JSON)를 먼저 확인.
3. **gov-tree 전용 SP가 있는 기관은 PocketBase/K-Search에 등록하지 않는다**
   (SP-18 RULE-07 [7-D]). 신규 기관 검증은 `kw` 배열 큐레이션 +
   `node src/tests/*.test.mjs` 발화 텍스트 매칭 테스트로 충분(네트워크 불필요).
4. 검색/라우팅 코드가 "버그처럼 보인다"고 바로 고치기 전에, 그 분기가 왜 그
   순서인지 하위 함수까지 끝까지 추적할 것(예: `_nationalTable()`이 도 코드에
   의존하는 건 지사형 기관 특성상 의도된 설계였다).
5. 브랜치 관리는 §0 참조 — 항상 최신 `origin/main` 기준으로 새 브랜치.

## 4. 다음 작업 지시 — 04-city-dept 나머지 15개 구·군 실사

**목표**: 부산 16개 구·군 중 해운대구를 제외한 15개(강서구·금정구·기장군·남구·동구·
동래구·부산진구·북구·사상구·사하구·서구·수영구·연제구·영도구·중구)의 내부 부서
(city-dept) 데이터를 `04-city/templates/city-dept-master-data.json`에 채운다.

**방법**(해운대구 때 검증된 패턴 그대로):
1. 각 구청 공식 홈페이지에서 조직도(실·국 구성) 웹서치로 확인
2. 16개 도메인 템플릿(`04-city/templates/SP-CITYDEPT-*-TEMPLATE_v1.0.md`) 중 해당
   구가 실제로 갖는 국(局)만 골라 레코드 작성 — **구마다 조직 편제가 다를 수 있음**
   (해운대구는 econ/tourism이 "문화관광경제국" 하나로 통합돼 있었다). 표준 조직도를
   가정하지 말고 매번 실사할 것.
3. 레코드 스키마는 `city-dept-master-data.json`의 해운대구 4건을 그대로 참고
   (시코드·국코드·도이름·시이름·국이름·산하과목록·입력_문구·출력_문구·처분성_문구·
   template·`_비고`·콜센터 3필드·결재핸들러)
4. `_비고`에 출처(어느 홈페이지, 확인 날짜)와 특이사항(다른 도/구와 다른 조직
   배치)을 정직하게 남길 것 — TBD 항목은 TBD로 명시, 추측 금지
5. 15개 전부를 한 세션에 끝내려 하지 말 것 — 이전 세션도 해운대구 하나에 여러
   번의 웹서치가 필요했다. 몇 개씩 나눠 진행하고 중간중간 JSON 검증
   (`python3 -c "import json; json.load(open(...))"`)과 커밋을 반복할 것.
6. 커밋 단위는 구 1~3개씩 묶어서, 커밋 메시지에 실사 근거(홈페이지명·확인일)를 남길 것.

**완료 기준**: 최소한 각 구·군의 자치행정(jachi) 국 하나는 채워서 "부서 안내가
전혀 안 되는 구"가 없게 하는 걸 1차 목표로 삼는다. 그 이후 econ/welfare/housing
등으로 확대.

**작업 후**: `docs/GOV_TREE_ABSTRACTION_LAYER_STATUS_v1_0.md`와
`docs/NATIONWIDE_GOV_ROUTING_EXPANSION_DESIGN_v1_0.md`의 부산 진행상황 표를 갱신할 것.

## 5. 참고 파일 목록

- `docs/GOVTREE_NATIONWIDE_EXPANSION_LESSONS_v1_0.md`(+html) — 이번 세션 전체 교훈
- `docs/GOV_TREE_ABSTRACTION_LAYER_STATUS_v1_0.md` — 계층별 추상화 현황 표
- `docs/NATIONWIDE_GOV_ROUTING_EXPANSION_DESIGN_v1_0.md` — 전국 확대 설계·체크리스트
- `04-city/templates/city-dept-master-data.json` — 이번 작업 대상 파일
- `04-city/templates/SP-CITYDEPT-*-TEMPLATE_v1.0.md` — 16개 도메인 템플릿
- `src/tests/directcode-province-resolution.test.mjs` — 부산 파일럿 회귀 테스트
- `prompts/SP-18_ksearch_v1.4.txt` RULE-07 [7-D] — K-Search/gov-tree 관할 경계 근거
