# ORG_PROFILES_GOVTREE_RECONCILIATION_v1_0.md
## org_profiles(K-Compose 오케스트레이션 레지스트리)와 gov-tree(지방행정 SP)
## 신원 조정 — 발견·설계·구현 기록

작성일: 2026-08-05 | 작성자: 주피터 지시, Claude 작성 | 관련 대화: "1번부터
시작" 세션(§CORE 5단계 재구성 논의 중 발견)

## 0. 이 문서의 목적

"오케스트레이션(조율) SP 역할을 현재 설계에서 누가 수행하는지 검색해
보라"는 지시에서 출발해, K-Compose(`SP-20`)가 그 역할을 맡도록 설계돼
있다는 걸 확인하는 과정에서 **더 시급한 구조적 결함**을 발견했다. 이
문서는 그 발견 경위와 이번 세션에 실제로 구현한 수정 내용을 기록한다.
다음 세션이 §CORE 5단계 재구성으로 넘어가기 전에 반드시 먼저 읽을 것.

## 1. 발견 — 같은 기관이 두 개의 다른 신원으로 등록돼 있었다

`org_profiles`(K-Compose가 조회하는 오케스트레이션 레지스트리)의
admin_local(지방행정) 레코드 246건(중복 제거) 중 상당수가, gov-tree
(`gov-router.js`/`kregionalgov`가 실제로 서빙하는 지방행정 SP)에 이미
완결된 콘텐츠로 존재하는 기관과 **이름은 같지만 완전히 다른 ID**로
등록돼 있었다. 예:

```json
// org_profiles (1786400001_seeded_benefit_catalog_orgs_full.js)
{"org_id": "gov24-org:3330000", "org_name": "부산광역시 해운대구",
 "branch": "admin_local", "connected": false, "status": "pending_review",
 "unavailable_reason": "혜택 카탈로그 전수 적재 — 검토 전"}
```

같은 기관이 gov-tree에서는 `시코드: busan_haeundae`로 완결된 SP
(`SP-CITY-BUSAN_HAEUNDAE`)를 갖고 있는데, `org_profiles`는 그 사실을
전혀 모른 채 "연결 안 됨" 상태로 등록돼 있었다. K-Compose가 오케스트레이션
계획을 짤 때 이 기관을 조회하면 틀린 정보(미연결)만 얻는 구조였다.

원인은 "혜택 카탈로그 전수 적재"(`procedure_maps`에 정부24 복지 서비스
10,289건 시딩) 작업이 `gov24-org:NNNN`이라는 정부24 자체 번호 체계를
그대로 org_id로 써서 org_profiles를 일괄 생성했기 때문이다 — gov-tree가
이미 다른 시코드 체계로 같은 기관을 갖고 있다는 걸 그 작업이 몰랐다(또는
확인하지 않았다). 이 저장소가 이미 몇 차례 반복해온 "같은 개념을 매번
새 신원 체계로 재발명하는" 패턴의 세 번째 사례다.

## 2. 실측 — 얼마나 겹치는가

`org_profiles`의 admin_local 246건을 gov-tree의 `city-master-data.json`
(234건)·`province-master-data.json`(16건)과 이름(도이름+시이름, 공백
제거 후 완전일치)으로 대조했다.

| 구분 | 건수 |
|---|---|
| gov-tree와 이름 매칭됨(시·군·구) | 199 |
| gov-tree와 이름 매칭됨(도청) | 13 |
| 매칭 자체가 안 됨(gov-tree에 아직 없음) | 34 |
| 매칭됐지만 **gov-tree 쪽도 스텁**("정식 확인 중") | 184 |
| 매칭됐고 **gov-tree 쪽이 실제 콘텐츠(REAL)** | **28** (시·군·구 15 + 도청 13) |

스텁 여부는 `city-master-data.json`의 `행정구역구성_문구` 필드에
"정식 확인 중" 문자열이 있는지로 기계적으로 판별했다(수작업 눈짐작
아님 — 재현 가능).

**REAL 28건만 고쳤다.** 나머지(스텁 매칭 184건 + 미매칭 34건)는
"연결 안 됨"이 지금도 사실이므로 건드리지 않았다 — gov-tree 실사가
진행될 때마다 이 조정 스크립트를 다시 돌려야 한다(§6 참조).

## 3. 설계 — resolution_strategy=gov_tree_delegate

`org_profiles`의 admin_local 레코드가 gov-tree 콘텐츠를 중복 보유하지
않고, gov-tree의 기존 라우팅 코드를 가리키는 **얇은 포인터**가 되도록
스키마를 확장했다.

- `resolution_strategy` select 필드에 `"gov_tree_delegate"` 값 추가
- 신규 필드 `gov_tree_ref`(text) — 형식은 `gov-router.js` directCode
  규약과 동일한 `"{tier}:{code}"`:
  - `province:{도코드}` (예: `province:gyeonggi`)
  - `city:{SP코드}` (예: `city:SP-CITY-BUSAN_HAEUNDAE`)

이 형식을 채택한 이유는 gov-router.js의 directCode 파서가 이미 이
규약을 소비하도록 설계돼 있어서다 — 새 파서를 만들 필요가 없다.

### 3-1. 발견한 부수 공백 — province tier directCode 진입점 없음

이 설계를 실제로 검증하려다가, `gov-router.js`의 directCode 처리부에
`do-dept`/`do-agency`/`org`/`city`/`city-dept`/`emd` tier는 다 있는데
그 상위 계층인 **도청 자체(province)를 직접 호출할 진입점이 없다**는
걸 발견했다. `province:{도코드}` 형식의 `gov_tree_ref`를 13개 도청에
붙이려 해도 받아줄 코드가 없었다는 뜻이다. 그래서 `tier === 'province'`
분기를 새로 추가했다(`_loadProvinceMasterData()`로 도코드 존재 확인 →
`_currentResolvedProvinceCode` 설정 → `_loadDoSp()` 렌더링, 다른
tier들과 동일한 패턴).

## 4. 설계 — CALL_GOVTREE 실행 경로

`org_profiles.gov_tree_ref`가 붙어도, K-Compose/K-Execute의 기존
실행 경로(`CALL_GOVSYS` → `/orchestration/execute-atom`)는 그걸 쓸 수
없다 — `CALL_GOVSYS`는 `atom_id` 기반 순수 API 자동화(정부24 증명서
발급 등)만 상정한 설계이기 때문이다. 지방행정 기관은 API가 아니라
**그 자체가 완결된 대화형 SP**(예: `SP-CITY-BUSAN_HAEUNDAE`)라서, 다른
실행 경로가 필요했다.

```
[CALL_GOVTREE: gov_tree_ref={org_profiles.gov_tree_ref}, task="{용건}",
 caller=kexecute]
  → worker.js handleGovTreeStepExecute
    1. gov_tree_ref를 gov-router.js assembleGovSystemPrompt()의
       directCode로 그대로 전달 → 그 기관의 실제 SP 텍스트 획득
    2. trace에 "directCode"가 없으면(조용히 일반 안내로 폴백된 경우)
       → gov_tree_ref가 더 이상 유효하지 않다는 뜻(gov-tree 쪽 데이터가
       바뀌었거나 org_profiles가 낡음) → status: gov_tree_ref_stale로
       정직하게 실패 보고(가짜 기관 응답을 만들어내지 않음 — U2 원칙)
    3. 유효하면 그 SP를 system prompt로 삼아 task 하나를 Claude에게
       한 턴 처리시켜 institution_response를 얻음
  → K-Execute가 institution_response를 그 기관의 실제 응답으로 취급해
    다음 step으로 진행. stale이면 CALL_GOVTREE를 재시도하지 않고
    [KSEARCH_HANDOFF]로 대체 경로 시도(근본 원인이 org_profiles
    자체이므로 재시도해도 같은 결과)
```

`gov-router.js`는 `window` 전역에도 붙지만 `export async function`으로도
선언돼 있어(dual-mode), Cloudflare Workers 런타임에서도 순수 ES 모듈
import로 그대로 쓸 수 있다는 걸 확인했다 — 별도 포팅 없이
`worker.js`가 직접 import한다.

## 5. 구현 상태

| 항목 | 상태 | 파일 |
|---|---|---|
| province tier directCode 진입점 | ✅ 구현+테스트 | `gov-router.js`(tier==='province' 분기), `metro-districts-phase1.test.mjs` 3건 |
| org_profiles 스키마 확장(gov_tree_delegate·gov_tree_ref) | ✅ 구현(라이브 미검증) | `pb_migrations/1786500001_altered_org_profiles_gov_tree_delegate.js` |
| org_profiles 28건 조정 | ✅ 구현(라이브 미검증) | `pb_migrations/1786500002_reconciled_org_profiles_with_govtree.js` |
| CALL_GOVTREE 실행 엔드포인트 | ✅ 구현(Claude API 호출부는 라이브 미검증) | `worker.js` `handleGovTreeStepExecute` |
| CALL_GOVTREE 태그 파싱·재주입 | ✅ 구현+단위테스트(정규식) | `call-ai.js` govtreeMatch 블록 |
| K-Execute 문서화(언제 CALL_GOVTREE를 쓰는지) | ✅ 완료 | `SP-22_kexecute_v1.5.txt` |
| K-Compose(SP-20) 수정 필요 여부 | 검토 결과 **불필요** — steps에 org_id가 이미 있고, 분기 판단은 실행 시점(K-Execute)의 책임이라 계획 수립 단계(K-Compose)는 그대로 둬도 됨 | — |

## 6. 검증한 것 / 못한 것

**검증함**(이 세션 로컬 환경에서):
- province directCode: 정상 도코드 3건(경기·제주·존재하지 않는 코드)
  각각 기대대로 동작(정상 라우팅/회귀 없음/안전 폴백)
- CALL_GOVTREE 정규식: 콤마 포함 자연어 task도 정확히 파싱
- `handleGovTreeStepExecute`의 핵심 로직(Anthropic 호출 제외)을
  실제 gov-router.js로 시뮬레이션 — 정상 참조(해운대구·경기도)는
  `status:'ok'`, 존재하지 않는 참조는 `status:'gov_tree_ref_stale'`로
  정확히 갈림
- 전체 테스트 197건 중 193 통과(기존 4건 pre-existing 실패와 동일,
  회귀 없음)
- org_profiles 마이그레이션 로직은 경량 PocketBase 목(mock)으로
  스키마 확장·레코드 갱신·존재하지 않는 org_id 처리 경로를 시뮬레이션

**검증 못함**(이 세션은 실제 PocketBase·Cloudflare Workers·Anthropic
API에 접근 불가 — 이 저장소의 여러 세션이 반복해온 동일한 한계):
- 두 마이그레이션의 실제 PocketBase 적용
- `worker.js`가 실제 Workers 배포 환경에서 `gov-router.js`를 import할
  때 번들링이 정상적으로 되는지(로컬 `node --check` 문법 검사만 통과)
- `handleGovTreeStepExecute`의 실제 Anthropic API 호출 경로

## 7. 다음 세션 우선순위

1. **§6 미검증 항목 실환경 확인** — 배포 후 가장 먼저 확인해야 함
2. **184건(gov-tree도 스텁) 처리 방침 결정** — gov-tree 실사가 끝나는
   대로 이 조정 스크립트를 재실행하는 루틴으로 만들지, 아니면 별도
   트리거(예: 실사 완료 커밋마다 자동 재계산)를 만들지
3. **34건(미매칭) 처리 방침 결정** — gov-tree에 해당 기관이 아예
   없는 경우들 — gov-tree 확장 대상 후보 목록으로 쓸 수 있음
4. AC-PRO-CORE §CORE를 5단계(정부서비스 판별 → 입법/사법/행정·중앙/
   지방 조합 판단 → 오케스트레이션 계획 → 취합·전달 → PDV 기록)로
   재구성 — 이 문서의 §1에서 시작된 논의의 원래 목적. §CORE 2단계
   판단(입법/사법/행정 조합)은 `org_profiles.branch` 필드를 K-Compose의
   기존 로직 안에서 읽는 정도로 충분하다는 게 이전 세션 결론(새 SP
   불필요) — 다만 그 판단이 의미 있으려면 이번 문서의 조정 작업이
   먼저 정확해야 한다.

## 8. 관련 파일

- `pb_migrations/1786500001_altered_org_profiles_gov_tree_delegate.js`
- `pb_migrations/1786500002_reconciled_org_profiles_with_govtree.js`
- `src/gopang/gov/gov-router.js` — province tier directCode
- `worker.js` — `handleGovTreeStepExecute`, `/orchestration/execute-govtree-step`
- `src/gopang/ai/call-ai.js` — CALL_GOVTREE 태그 배선
- `prompts/SP-22_kexecute_v1.5.txt` — CALL_GOVTREE 사용 시점 문서화
- `src/tests/metro-districts-phase1.test.mjs` — province directCode 테스트 3건
- `docs/worker_orchestration_registry_patch_2026-07-08.md` — org_profiles/
  procedure_maps/atom_rows 원 설계 문서(이번 작업의 전제가 된 배경)
