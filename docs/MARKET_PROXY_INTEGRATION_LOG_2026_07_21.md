# market-proxy 원장통합 작업기록 (2026-07-21)

이 문서는 `market-proxy`(gopang-worker) 배포 준비, 원장(재무제표) 통합, 그리고
사고실험(코드 추적 검증)으로 발견·수정한 버그들을 시간 순서대로 정리한
작업 기록입니다. "매뉴얼"이 아니라 "무엇을 왜 어떻게 고쳤는지"를 남기는
이력 문서입니다.

---

## 1. market-proxy 배포 준비

### 1.1 이름 충돌 회피
`services/gopang-worker/wrangler.toml`의 `name`이 원래 `gopang-proxy`였는데,
이건 이미 실서비스 중인 Worker(hondi-proxy로 통합·폐지 예정)와 이름이
겹치는 것을 확인해 **`market-proxy`로 정정**했다. 관련 파일(`src/index.js`,
`escrow.js`, `README.md`)의 배치 전제 서술도 함께 수정.

### 1.2 Durable Object SQLite 마이그레이션
Cloudflare가 최근 정책을 바꿔 신규 DO 네임스페이스는 `new_classes`(구
key-value 백엔드)로 생성이 막히고 `new_sqlite_classes`만 허용됨을 실제
배포 시도(에러 코드 10097)로 확인 → `wrangler.toml` 수정.

### 1.3 KV/Secrets 등록
`L1_REGISTRY_KV` 등 10개 KV 네임스페이스, `ESCROW_PRIVATE_KEY`/
`ESCROW_PUBLIC_KEY`(Ed25519, 로컬 서명·검증 실제 확인) 등 시크릿 등록.

**실전에서 겪은 함정 — PowerShell 파이프의 개행 문제**: `"값" | wrangler
secret put NAME` 방식이 문자열 끝에 개행을 붙이는 경우가 실제로 재현됨
(`LEDGER_WRITE_SECRET` 401 오류로 발견). 코드 쪽에서 비교 시 `.trim()`으로
방어 처리.

---

## 2. 원장(fs) 통합 — `ledger_entries`로 일원화

### 2.1 발견
hondi-proxy(`pb_hooks/main.pb.js`)가 이미 `ledger_entries` 컬렉션에 GDC
송금/발행/AI과금 원장을 기록하고 있었음을 확인. gopang-worker가 별도로
설계했던 `fs_ledger`는 스키마 목적이 사실상 같아 **신설하지 않고
`ledger_entries`에 해시체인 필드(entry_hash/prev_entry_hash/seq/anchored/
anchor_batch_id 등)를 추가하는 방식으로 통합**.

### 2.2 market-proxy가 원장 쓰기 전담
`main.pb.js`의 내부 `$app.dao().saveRecord()` 직접 호출은 (1) 해시체인 훅을
건너뛰고 (2) hondi-proxy·market-proxy 동시 쓰기 경합 소지가 있어, 신규
엔드포인트 `POST /internal/ledger-entries`(공유시크릿 `LEDGER_WRITE_SECRET`
인증)를 만들어 `LedgerWriter` DO(guid 단위 직렬화)를 거치도록 변경.

### 2.3 실증 완료
로컬 PocketBase 0.22.14 재현 + hanlim 실서버 실제 호출(`/api/mint`)로
`entry_hash`/`prev_entry_hash`/`seq`가 정확히 이어지는 것까지 확인.

---

## 3. PocketBase 버전 불일치 버그 3건 (실제 재현·수정)

로컬 PocketBase 0.22.14 환경을 만들어 저장소 전체를 v0.23 전용 API 패턴으로
검색해 다음을 찾아 고쳤다:

| 파일 | 버그 | 실질적 영향 |
|---|---|---|
| `fs_ledger.pb.js` | `onRecordUpdateRequest`(Before 없음), `e.next()` | 파일 로드 자체가 실패했을 가능성 — 해시체인 훅 미작동 |
| `reviews.pb.js` | 위와 동일 + **`e.data`가 0.22.x엔 없음(undefined)** | `Object.keys(e.data\|\|{})`가 항상 빈 배열 → "판매자 답글 전용 수정" 분기가 항상 참(vacuous truth)이 되어 **72시간 잠금·필드 화이트리스트가 실질적으로 한 번도 강제된 적이 없었을 가능성** |
| `pb-admin.js` | `/api/collections/_superusers/auth-with-password`(v0.23 전용) | L1 admin 인증이 항상 404 — market-proxy의 모든 PocketBase 쓰기가 실패 |

`e.data` 문제는 `$apis.requestInfo(e.httpContext).data`로 교체, 로컬 검증으로
실제 제출 필드를 정확히 잡아내는 것까지 확인.

---

## 4. 사고실험(시나리오별 코드 추적)

### 시나리오 1 — 정상 GDC 거래 완주
**발견(이중 기장)**: `EscrowSigner`가 릴리즈 시 호출하는 L1 `/api/tx`가
자동으로 buyerClaim/sellerClaim을 원장에 기록하는데, `EscrowSigner` 자신도
별도로 3행(buyer/seller/platform)을 기록해 **판매자 크레딧이 두 번, 구매자는
`gopang-escrow` 시스템 계정으로 잘못 기록**되고 있었다.
**수정**: `EscrowSigner` → `/api/tx` 호출에 `skip_ledger: true` 추가, `main.pb.js`가
이 플래그면 자동 기장을 건너뛰도록 수정.

### 시나리오 2 — PG(토스페이먼츠) 레일
**발견(치명적)**: 토스 공식 문서 확인 결과 `PAYMENT_STATUS_CHANGED`(실제
받는 결제완료 이벤트)엔 서명 헤더가 없음(`payout.changed`/`seller.changed`
전용). 기존 HMAC 서명검증은 항상 실패해 **PG 레일 결제가 실사용에서 단
한 건도 처리되지 않았을 것**. 추가로 웹훅 body의 `metadata`(buyer_guid 등)도
토스가 실제로 보내주지 않는, 존재하지 않는 필드였다.
**수정**: 서명검증 대신 `paymentKey`로 결제조회 API를 재호출해 신뢰
가능한 값 확보. 주문 메타데이터는 `handleCreatePayment` 시점에 신규
`PENDING_PG_ORDER_KV`에 저장해뒀다가 웹훅 처리 시 역조회하도록 재설계.

### 시나리오 3 — 배송미확인 자동릴리즈 크론
이전 세션에서 고친 보호 로직(운송장 미등록 시 자동릴리즈 제외)이 그대로
잘 유지됨을 확인. 경미한 확장성 한계(페이지당 200건 cap, 여러 회 실행되면
자연 해소)만 기록.

### 시나리오 5 — 사기탐지 순환거래 그래프
**발견**: `fraud.js`가 여전히 존재하지 않는 컬렉션 `fs_ledger`를 조회 —
사기탐지 크론이 매번 빈 결과만 받고 있었음. 추가로 `main.pb.js`의 일반
P2P GDC 송금 원장기록에 `counterpart` 필드가 없어, 순수 P2P 송금(에스크로를
안 거치는, 오히려 순환거래 위험이 큰 유형)이 그래프에서 통째로 빠지고
있었음. 둘 다 수정.

---

## 5. 프로비저닝 자동화 — 향후 노드 확장 대비

`provision-l1-nodes.py`의 systemd 유닛 템플릿에 `Environment*` 지시어가
전혀 없어, hanlim 외 신규 노드(l1-aewol 등)에 공유 시크릿(`gopang.env`)이
아예 전달되지 않고 있었음을 실제 확인(빈 값으로 기동). `--env-file` 옵션과
자동 systemd 드롭인 생성 로직을 추가해, 앞으로 노드를 몇 개를 새로
프로비저닝하든 자동으로 반영되도록 함.

---

## 6. 아직 남은 것 (의도적으로 이번 범위 밖)

- `reviews` vs 기존 `trade_ratings`, `business_verifications` vs
  `seller_verifications`, `dispute_cases` vs `transaction_disputes` — 같은
  종류의 중복이 의심되나 미착수
- hanlim의 `pb_migrations/1784200001_created_public_data_usage.js` 관련
  간헐적 마이그레이션 패닉 — 원인 미확정(재현 조건 불명확), 서비스 자체는
  현재 정상 기동 중
- PG 레일 실제 결제(테스트 키)로 끝까지 흘려보내는 실증은 아직 미실행
- 서귀포 호스트(158.180.84.57)의 17개 노드는 자원 제약으로 아직 미기동

---

## 참고 — 관련 커밋

이번 세션에서 병합된 주요 PR(시간 순):
`market-proxy/ledger-takeover`, `market-proxy/do-sqlite-migration`,
`market-proxy/secret-trim-and-status-check`, `market-proxy/l1-admin-path-fix`,
`market-proxy/fix-escrow-double-booking`, `market-proxy/fix-pg-webhook-verification`,
`market-proxy/fix-fraud-graph`, `infra/provision-env-dropin`
