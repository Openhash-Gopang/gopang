# 혼디 정부 수수료 기준표 — PocketBase 연동 시드

## 구성
- `schema/gov_fee_schedule.collection.json` — PocketBase 컬렉션 스키마 (Admin UI > Settings > Import collections 로 가져오기)
- `scripts/gov_fee_calc.mjs` — 순수 계산 함수 (formula_json 기반, 하드코딩 세율표 없음). gov-router.js 등에서 import해서 재사용.
- `scripts/seed_gov_fee_schedule.mjs` — 엑셀(혼디_정부수수료_기준표_초안.xlsx) → PocketBase 레코드 변환/upsert

## 설계 요약
- GDC 청구액은 **혼디 서비스 수수료 전용**입니다 (2026-08-15 결정). 정부에 실제로 납부하는 금액은
  포함하지 않으며, 사용자가 공식 채널로 직접 납부합니다.
- `hondi_service_fee = gov_reference_fee × gdc_multiplier` (기본 배율 2, 과금 원칙 ③).
- `scope: national` (인지세·법원 인지대·송달료)은 지역 무관 전국 공통이며, `formula_json`에 구간표를
  저장해 요율 개정 시 코드 재배포 없이 데이터만 갱신하면 됩니다.
- `scope: regional`(민원사무편람 기반)은 `region_code`별로 분리 저장합니다. 현재는 `cheonan`
  하나만 있고, 다른 지역은 추후 같은 스크립트로 `--region jeju` 등으로 추가합니다.
- `status`
  - `REAL`: 숫자로 확인된 금액 (무료 포함)
  - `NEEDS_REVIEW`: 원문에 금액이 있으나 자동 파싱 실패, 또는 조례/별표 참조라 실제 숫자를 별도 확인해야 함
  - `MISSING`: 원본 편람에 수수료 정보 자체가 없음
  - **NEEDS_REVIEW/MISSING 건은 자동으로 과금하면 안 됩니다** — 사용자에게 "확인 필요"로 안내하고 승인 흐름으로 유도하십시오.

## 사용법
```bash
npm install
# 1) 먼저 dry-run으로 파싱 결과만 확인 (PocketBase 연결 없이)
node scripts/seed_gov_fee_schedule.mjs --file ./혼디_정부수수료_기준표_초안.xlsx --dry-run

# 2) 실제 반영
export POCKETBASE_URL=https://your-l1-node
export POCKETBASE_ADMIN_EMAIL=admin@example.com
export POCKETBASE_ADMIN_PASSWORD=********
node scripts/seed_gov_fee_schedule.mjs --file ./혼디_정부수수료_기준표_초안.xlsx --region cheonan --multiplier 2
```

## 조회 우선순위 (런타임 로직에 적용할 것)
1. 사용자 관할 `region_code`의 `status=REAL` 레코드가 있으면 사용
2. `scope=national`이면 지역 무관하게 바로 사용
3. 둘 다 없으면 다른 지역(예: cheonan)의 REAL 레코드를 BASELINE으로 사용하되,
   "이 지역 정확한 금액은 미확인이며 OO 기준 추정치입니다"를 사용자에게 고지하고 승인 필수
4. `NEEDS_REVIEW`/`MISSING`이면 자동 과금 금지, 사람 확인 큐로 전달

## 알려진 제한
- `exceljs`가 `uuid` 패키지를 통해 moderate severity 취약점을 transitively 포함합니다
  (문서 메타데이터 생성용, 파싱 경로와 무관 — `npm audit` 참고).
- 천안시 편람 원문 중 "9,000원~67,500원(건축물 규모별)"처럼 조건부 범위는 min/max만 잡히고
  조건 로직 자체는 저장하지 않습니다 — 이런 항목은 실제 사용 전 raw_fee_text를 사람이 확인해야 합니다.
