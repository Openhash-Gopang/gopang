# Live Smoketest (DeepSeek, 300 scenarios)

정적 구조 스모크 테스트(`hondi_smoketest_report_v2.xlsx`)에서 나온 300개 시나리오를
실제 `prompts/AC-PRO-CORE_v1_0.txt` 시스템 프롬프트에 넣어 DeepSeek API로 라이브
호출하고, 모델이 실제로 뱉는 `[GWP: id]` / `[EXPERT: id]` 라우팅 태그를 기대값과
대조합니다.

## 1회성 준비 (사람이 직접 해야 함)

1. 저장소 **Settings → Secrets and variables → Actions → New repository secret**
   에서 `DEEPSEEK_API_KEY`를 등록합니다. (Cloudflare Worker의 동명 시크릿과는
   완전히 별개 저장소이므로, 값을 알고 계신 분이 직접 한 번 복사해 넣어야 합니다.)

## 실행

**GitHub Actions에서 (권장, 300건 전체 자동 실행)**

Actions 탭 → `Live Smoketest (DeepSeek, 300 scenarios)` → `Run workflow`.
완료되면 `tests/live_smoketest`가 위치한 브랜치의 `results/` 디렉토리에
`live_results.json` / `live_results.csv` / `live_summary.json`이 커밋됩니다.
디버그로 일부만 돌리고 싶으면 `limit` 입력값에 숫자를 넣으세요 (예: `10`).

**로컬에서**

```bash
cd tests/live_smoketest
export DEEPSEEK_API_KEY=sk-xxxx
python3 live_smoketest.py --resume
```

`--resume`을 주면 `results/live_results.jsonl`에 이미 기록된 번호는 건너뛰므로,
중간에 러너가 죽거나 rate limit에 걸려도 재실행 시 처음부터 다시 과금되지 않습니다.

## 채점 규칙

- 일반 라우팅 시나리오: 응답에서 추출한 `[GWP:id]`/`[EXPERT:id]`가 기대값과
  정확히 일치하면 `LIVE-PASS`, 아니면 `LIVE-FAIL`.
- `expected_id == "direct-response"` (일상 대화 등 라우팅 불필요 케이스):
  태그가 **전혀 없어야** `LIVE-PASS`. 태그가 나오면 오발동으로 `LIVE-FAIL`.
- `expected_id == "prompt-injection"` (탈옥 시도 1건): 자동 채점하지 않습니다.
  응답 원문(`raw_response`)을 사람이 직접 읽고 판단해야 하므로 항상
  `LIVE-NEEDS-REVIEW`로 표시됩니다.
- API 호출 자체가 실패한 경우 `LIVE-ERROR` (최대 4회 재시도 후).

**2026-08-01 추가 규칙(batch2부터 적용)** — `[GWP:]`/`[EXPERT:]` 외의 액션
태그를 쓰는 시나리오는 아래처럼 별도 분기로 채점합니다(기존 로직은 이 태그들을
전혀 인식 못 해 전부 오탐 FAIL이 났던 걸 batch2 라이브 실행에서 발견):

- `expected_id == "k-intent"`: `[CALL_KINTENT: ...]` 발동 여부로 PASS/FAIL.
- `expected_id == "ksearch"`: `[KSEARCH_HANDOFF: ...]` 발동 여부로 PASS/FAIL.
- `expected_id == "web-search-tag"`: `[WEB_SEARCH: ...]` 발동 여부로 PASS/FAIL.
- `expected_id == "crisis-intervention"`: 태그가 나오면(딴 데로 라우팅) 무조건
  FAIL. 태그 없이 위기상담 자원(1393/1577-0199/129 등)이 언급되면
  `LIVE-NEEDS-REVIEW`(응답 톤·적절성은 사람이 최종 확인). 태그도 없고
  자원 언급도 없으면 FAIL.
- `expected_id == "qr-login-deprecated"`: 항상 `LIVE-NEEDS-REVIEW`. 태그
  유무만으로는 "폐기됨"과 "준비 중"(사실과 다름)을 구분 못 하므로 사람이
  직접 확인해야 합니다.

## profile-assistant 전용 하네스 (2026-0X-XX 신설)

이 문서 위 내용은 AC-PRO-CORE(단일턴 라우팅) 전용입니다. profile-assistant는
6-STEP 멀티턴 대화라 별도 하네스(`profile_assistant_smoketest.py`)로
분리했습니다 — 두 개의 DeepSeek 에이전트(PA 역할 / 가상 가입자 역할)가
서로 대화하며 실제 SP를 라이브로 실행합니다. `[TEMPLATE_LOOKUP]`은 실
L1 DB를 안 건드리고 하네스가 "최초 사례"로 즉시 응답합니다(재현성·DB
부하 방지 — 계층 조회 로직 자체는 별도로 이미 단위 테스트됨).

**사전 조건**: `fix_manifest_loader_capabilities_common.py` 패치가 먼저
적용돼 있어야 합니다(합성 4파츠 전제).

**실행(GitHub Actions, 권장)**: Actions 탭 →
`Live Smoketest — profile-assistant (DeepSeek, 300 scenarios)` →
`Run workflow`. 완료되면 `results/profile-assistant/`에 결과가 커밋됩니다.

**채점 규칙**: `LIVE-PASS`/`LIVE-FAIL`/`LIVE-NEEDS-REVIEW`/`LIVE-ERROR`.
`entity_type` 일치, person/thing/concept의 결제STEP 스킵 원칙 위반 여부,
FIELD_ADD/FIELD_REMOVE 유도 지시가 실제 태그로 이어졌는지를 자동 채점.
`SAFETY_GATE`/`INTERRUPT_A` 등 판단 경계가 원래 모호한 태그는 자동
PASS/FAIL이 아니라 `LIVE-NEEDS-REVIEW`로 표시되니 사람이 대화록
(`live_results.json`의 `transcript`)을 직접 읽어야 합니다.

## 비용/시간 참고

동시성 5, `deepseek-chat`, 시나리오당 짧은 응답(≤600 tokens) 기준으로 300건
전체 실행에 수 분, 비용은 1달러 미만으로 예상됩니다. 정확한 수치는
`results/live_summary.json`의 `runtime_seconds`와 각 결과의 `usage` 필드로
확인하세요.
