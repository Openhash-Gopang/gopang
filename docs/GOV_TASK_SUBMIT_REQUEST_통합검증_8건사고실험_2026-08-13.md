# GOV_TASK_SUBMIT_REQUEST 통합 검증 — 8건 사고실험

> 작성일: 2026-08-13 | 방법론: `docs/5단계오케스트레이션_100건_사고실험_2026-07-16.md`와
> 동일 — 실행 가능한 배포본이 없어 코드 시뮬레이션이 아니라 **SP 문서 텍스트 자체를
> 가상 대화 시나리오에 대입해 논리적으로 추적**하는 방식이다. "SP 문서 안에 모순·누락·
> 끊긴 참조가 있는가"를 검증하는 것이지, 실제 모델(deepseek 등)이 이 지시를 얼마나 잘
> 따르는지는 검증하지 못한다 — 그건 실 배포 후 대화 로그로만 확인 가능하다.
>
> 대상: `SP-22_kexecute_v1.5.txt` STEP1에 2026-08-13 신설한 "GOV_TASK_SUBMIT_REQUEST
> 우선 위임" 분기(`gov_task_agency`/`gov_task_key` 신설 필드 기반, gopang
> `feat/gov-task-execute-integration` 브랜치). 범위가 좁아 100건이 아니라 이 분기가
> 실제로 거치는 경로를 8건으로 추렸다.

## 사전 점검에서 이미 발견·수정한 결함 2건

8건을 설계하며 신설 분기 텍스트를 다시 읽다가 아래 2건을 발견해 고쳤다(이 문서가
완성되기 전에 이미 SP-22에 반영 예정):

1. **batch_id/fanout_mode 누락(중요)** — STEP 1-P가 이미 "그룹에 속한 각
   `[CALL_GOVSYS]`/GOV_TASK 제출 호출에 이 `batch_id`와 `fanout_mode`를 동일하게
   실어 보낸다"고 명시하고 있는데(신설 이전부터 있던 문구 — "GOV_TASK 제출"이라는
   표현 자체가 이미 이 상황을 염두에 뒀던 것으로 보인다), 신설한 `GOV_TASK_SUBMIT_
   REQUEST` 예시 JSON 바디엔 `batch_id`/`fanout_mode` 필드가 없었다. 병렬 그룹
   안에서 이 태그를 쓰면 `/gov/task/batch-status` 집계 조회가 이 제출들을 그룹으로
   못 묶는다 — 시나리오 E에서 발견.
2. **재개 시 중복 제출 위험(치명적)** — 인간전속 구간에서 멈추기 전에 이미
   `GOV_TASK_SUBMIT_REQUEST`가 `accepted`로 성공했더라도, `paused_at_seq`가 그
   step의 seq를 그대로 가리키면 `remaining_steps`에 이 step이 다시 포함될 수
   있다. 재개(`RESUME_KEXECUTE`) 시 이 step을 처음부터 다시 실행하면
   `GOV_TASK_SUBMIT_REQUEST`를 또 낼 위험이 있다 — 신설 분기에 "이미 접수했는지"
   확인하는 가드가 전혀 없었다. 시나리오 F에서 발견.

두 수정 모두 이 문서 뒤에 정리된 최종 diff에 반영했다.

## 시나리오 8건

### A. REPORT형, 매핑 있음, automation_sp 없음(인간전속)

**가상 발화**: "우리 회사 위치기반서비스 등록하고 싶어요"

- K-Intent: goal="위치기반서비스 등록"
- K-Compose: STEP1 캐시 조회 — `procedure_maps`에 이 goal이 없으면 STEP1-B 최초조사.
  steps에 `atom_id: location-service-report`(가정, 실제 atom_rows엔 아직 이 atom
  자체가 없다 — ★ 발견 1: kcc 매핑은 `REQUIRED_DOCUMENTS_REGISTRY`엔 있지만
  대응하는 `atom_rows` 레코드가 없다. procedure_maps가 이 목표를 캐싱하려면
  atom_rows에도 먼저 시드가 필요하다는 뜻 — "남은 작업"(PATHFINDER_design.md 2.3)에
  이미 적어둔 매핑 공백과 같은 종류의 문제가 여기서도 나타남
- K-Execute: `gov_task_agency='kcc'`, `gov_task_key='location_service_registration'`이
  둘 다 채워져 있다고 가정하면 → `GOV_TASK_SUBMIT_REQUEST` 먼저 발행,
  `status:'accepted'` 수신 → `automation_sp` 없으면 인간전속 안내로 이어짐(신청
  자체는 접수됐지만 실제 처리는 기관 담당자 몫)

**결과**: 논리적 결함 없음(atom_rows 시드 공백은 이 SP 로직의 결함이 아니라 데이터
공백). 접수와 실행의 분리가 의도대로 작동.

### B. DECISION형, 매핑 있음 + automation_sp 있음

**가상 발화**: "이 건축 허가 신청 자동으로 처리되나요?"

- 가정: `atom_id: building-permit`에 `gov_task_agency`/`gov_task_key`와
  `automation_sp`가 모두 설정된 경우(현재 실제로는 없지만, 신설 분기가 이 조합을
  어떻게 다루는지 확인하는 게 목적)
- K-Execute: `GOV_TASK_SUBMIT_REQUEST` 먼저 발행 → `accepted` → 이어서
  `automation_sp` 있으므로 `[CALL_GOVSYS]`로 실제 자동화 실행

**결과**: 신설 지침 문구("접수와 실행은 별개 — 접수됐다고 자동 실행되는 게 아니다")가
정확히 이 조합을 위해 쓰인 문장이라 모순 없음. 다만 `CALL_GOVSYS` 결과가
`status:'automated'`가 아니라 실패하면, 이미 `accepted`된 `dept_task`는 어떻게
되는가? SP-22엔 이 실패를 `dept_task`에 반영(예: `rejected`로 되돌리기)하라는
지침이 없다 — ★ 발견 2(경미): 접수는 됐는데 실제 자동화가 실패하면 `dept_task`가
`acknowledged`/`in_progress`에 그대로 머무를 수 있다. 심각도는 낮음(담당 부서가
결국 사람이 처리하며 상태를 정리할 것으로 기대되는 절차이므로) — 다음 개선 후보로
남김, 이번 커밋 범위에는 포함하지 않음.

### C. QUERY형, 매핑 없음(회귀 확인)

**가상 발화**: "제 가족관계증명서 발급해줘"

- `atom_id: gov24-family-cert` — `gov_task_agency`/`gov_task_key` 둘 다 미설정
- K-Execute: 신설 분기 조건("둘 다 있는 경우만")이 거짓 → 전체 단락을 건너뛰고
  기존 로직 그대로("지금 connected:true인 조회형 atom은 아직 없다" → 결국
  `requires_user_action`)

**결과**: 결함 없음 — 기존 동작 완전히 보존(회귀 없음).

### D. ADJUDICATE형(court-filing), 실제 매핑 사례

**가상 발화**: "개인파산 신청하고 싶어요, 서류는 다 있어요"

- `atom_id: court-filing` — 마이그레이션으로 실제 시드된 `gov_task_agency:'court'`,
  `gov_task_key:'personal_bankruptcy_filing'`
- K-Execute: `GOV_TASK_SUBMIT_REQUEST` 발행({agency:court, task_key:
  personal_bankruptcy_filing, documents:[...]}) → `REQUIRED_DOCUMENTS_REGISTRY.
  court.personal_bankruptcy_filing`의 요건과 대조 → 서류 5종(파산·면책신청서 등,
  `court-filing.required_docs`와 동일) 충족 시 `accepted` → 이어서
  `_execAdjudicate`가 항상 `requires_user_action`(본인인증 필수)이므로 인간전속
  안내로 종료

**결과**: 결함 없음 — 이게 이번 통합이 의도한 정확한 사용례. 접수·추적은 되지만
실제 법원 절차는 본인이 진행해야 한다는 게 이용자에게 정확히 전달됨.

### E. parallel_group(notify)에 매핑 있는 atom 포함 → 결함 1 발견

**가상 발화**: "폐업 신고하고 관련 기관에 전부 알려주세요"

- K-Compose가 `parallel_group:'A', fanout_mode:'notify'`로 묶은 step들 중 하나가
  `gov_task_agency`/`gov_task_key`가 설정된 atom이라고 가정
- STEP 1-P가 `batch_id`를 생성해 "그룹에 속한 각 CALL_GOVSYS/GOV_TASK 제출 호출"에
  실어 보내라고 하는데, 신설 `GOV_TASK_SUBMIT_REQUEST` 예시엔 이 필드가 없어 실제로
  실을 수 없었다 — **사전 점검 결함 1과 동일**. 이 상태로 배포됐다면 그룹 안의
  `GOV_TASK_SUBMIT_REQUEST` 제출들이 `batch_id` 없이 나가 `/gov/task/batch-status`
  집계에서 누락됐을 것.

**결과**: 결함 발견 → 수정(아래 diff).

### F. 인간전속 구간 도달 후 재개 → 결함 2 발견

**가상 발화**(1턴): "개인파산 신청 시작해줘" → (court-filing에서 `GOV_TASK_SUBMIT_
REQUEST` `accepted` 후 본인인증 필요해 멈춤, `PROJECT_STATE_SAVE` 발행)
**가상 발화**(다음 턴): "본인인증 완료했어요, 계속해줘"

- AC가 재개로 판별 → `RESUME_KEXECUTE`로 K-Execute 재호출, `remaining_steps`에
  `paused_at_seq`가 가리키는 step(court-filing)이 포함된 채로 넘어옴(멈춘 지점
  자체가 아직 "완료"는 아니었으므로 seq 포함 여부가 SP 문서상 명확하지 않음)
- 재개된 K-Execute가 이 step을 처음부터 다시 실행하면, 신설 분기가 "이미 접수했는지"
  확인 없이 `GOV_TASK_SUBMIT_REQUEST`를 **또** 낼 수 있다 — 같은 파산 신청이
  중복 접수될 위험. `dept_task`가 같은 시민의 같은 요청에 대해 2건 생성되면
  Pathfinder 집계에도 중복 이벤트가 섞인다.

**결과**: 결함 발견(치명적) → 수정(아래 diff) — `results_so_far`/`PROJECT_STATE_SAVE`에
"이미 접수 완료(receipt_no 포함)" 여부를 남기고, 재개 시 그 step은 접수를 건너뛰고
바로 인간전속 확인 단계로 가도록 명시.

### G. automation_level_changed로 K-Compose 재계획 요청 시 재실행 여부

**가상 발화**: (실행 도중 기관 연동 상태가 바뀌어 K-Compose가 재계획)

- STEP1 문서에 이미 있는 지침: `atom_rows.automation.level`이 계획 시점과
  달라지면 `[HANDOFF_TO_KCOMPOSE: reason=automation_level_changed,
  completed_steps=...]`로 알린다
- `completed_steps`에 이미 실행 완료한 step들이 포함되므로, K-Compose가 새 계획을
  짤 때 이미 `GOV_TASK_SUBMIT_REQUEST`가 `accepted`된 step을 다시 넣을 위험은
  기존 `completed_steps` 메커니즘으로 이미 방어되고 있다(시나리오 F와 달리 이
  경로는 "일시정지"가 아니라 "완료 후 재계획"이라 remaining_steps 방식과 다르다)

**결과**: 결함 없음 — 기존 `completed_steps` 메커니즘이 이미 이 케이스를 커버.

### H. gov_task_agency만 설정되고 gov_task_key는 비어있는 잘못된 데이터

**가상 발화**: (데이터 오류 상황 — 실제 발화라기보다 방어적 케이스)

- 마이그레이션·수기 입력 실수로 `gov_task_agency`만 채워지고 `gov_task_key`가
  빈 값인 atom_rows 레코드가 있다고 가정
- 신설 지침이 "둘 다 있는 경우만"이라고 명시했으므로 이 경우 전체 단락을
  건너뛰고 기존 `CALL_GOVSYS`/인간전속 로직으로 감

**결과**: 결함 없음 — 조건문이 이미 이 엣지케이스를 안전하게 처리.

## 발견 결함 요약

| # | 시나리오 | 심각도 | 상태 |
|---|---|---|---|
| 1 | 병렬 그룹에서 batch_id/fanout_mode 누락 | 중요 | ✅ 수정 완료(SP-22 반영) |
| 2 | 재개 시 GOV_TASK_SUBMIT_REQUEST 중복 발행 위험 | 치명적 | ✅ 수정 완료(SP-22 반영) |
| 3 | CALL_GOVSYS 실패 시 이미 accepted된 dept_task 상태 미정리 | 경미 | 다음 개선 후보로 보류 |
| 4 | kcc/court 외 atom_rows에 대응 매핑 자체가 아직 비어있음 | — | 기존에 이미 인지된 데이터 공백(신규 아님) |
