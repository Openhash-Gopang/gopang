# gopang-worker — K-Market 신뢰 인프라 구현 (9·7·10번 항목)

마스터 아키텍처 문서(`K-Market_Architecture_Master_v1.0.md`) 7절에서 권장한 순서대로
**공용모듈 → 9번(재무제표 위변조 방지) → 7번(에스크로) → 10번(리뷰)**을 구현했습니다.
이 저장소는 독립 Cloudflare Worker(`market-proxy`)로 배포됩니다. [2026-07 정정]
최초 설계 시 기존 `gopang-proxy` Worker에 병합하는 것을 전제로 했으나, `gopang-proxy`가
`hondi-proxy`(루트 worker.js)로 통합·폐지 중임을 확인해 이름 충돌을 피하고자 별도
Worker로 배치를 확정했습니다. `services/gopang-worker/wrangler.toml`이 `hondi-proxy`의
루트 `wrangler.toml`과 완전히 분리되어 있으므로 서로의 배포에 영향을 주지 않습니다.

## 사고실험 검토 후 수정 이력 (이번 커밋)

배포 전 사고실험(thought experiment)으로 발견된 6건을 모두 반영했습니다.

| # | 문제 | 수정 내용 |
|---|---|---|
| 🔴 | buyer/platform 원장 미기록 | `EscrowSigner`/`escrow.js releaseHold` 모두 buyer(debit·purchase) / seller(credit·revenue) / platform(credit·platform_fee) **3행 구조**로 통일. 11번 `buildTxGraph`가 buyer→seller 엣지를 그릴 수 있도록 전제조건을 채움 |
| 🔴 | 배송미확인 상태에서 자동릴리즈 | `scheduledEscrowAutoRelease`가 `condition_type==='delivery_confirmation'`이면서 `tracking_no`가 없는 건은 자동릴리즈 대상에서 제외, 대신 판매자에게 운송장 등록 리마인드만 발송(14번 구현 전까지의 안전장치) |
| 🟡 | 에스크로↔원장 교차정합성 미검증 | 원장쓰기 3건 각각 try/catch로 감싸고, 실패 시 `flagOpsAlert('ledger-reconcile-gap:...')`로 반드시 사람이 보게 함(자금이동 자체는 되돌리지 않음 — L1 tx가 이미 진실의 원천이므로) |
| 🟡 | 구매자 KYC/SSO 필드 혼용 | `reviews.js`의 `getBuyerKycLevel`(사업자용 `kyc_status` 오조회)을 `getBuyerSsoLevel`(구매자용 `extra.sso_level` 조회)로 정정. 스키마 필드도 `reviewer_sso_level`로 정정 |
| 🟡 | 사기체크 전노드 순회 성능 | `lib/velocity.js`/`lib/dispute-history.js` 신설 — 홀드 생성/이의제기 시점에 KV로 누적해두고, 실시간 체크는 O(1) KV 조회만 하도록 전환(GDC·PG 레일 모두 적용) |
| ⚪ | PG 레일 실시간 사기체크 누락 | `handlePgWebhook`도 `realtimeFraudCheck` 호출 후 `fraud_review_required`/유예기간 연장 로직 적용 — GDC와 동일한 보호 수준으로 통일 |

### 여전히 남아있는 한계 (사고실험에서 인지했으나 이번 커밋 범위 밖)

- **사전 차단(S3) 자체는 여전히 불가능**: `afterOrderConfirmed`/`handlePgWebhook`는 자금이 이미 에스크로로 들어온 "이후" 호출되므로, `hold_for_review` 판정이 나와도 거래 자체를 막지는 못하고 플래그만 남긴다. 진짜 사전 차단은 `/biz/order` 핸들러(이 저장소 밖)가 L1 `/api/tx` 호출 전에 `realtimeFraudCheck`를 호출해야 완성된다.
- PG 차지백 웹훅 미구현 (8번 설계 문서 5.2절 — 다음 커밋 과제로 명시)
- `../openhash/hashChain.js` 앵커 모듈 실제 경로 연결 필요
- 리뷰 보상 `gdcTransfer()` 실제 서명 로직 (RewardSigner DO) 미구현

## 디렉토리 구조 (1·8·11번 포함 전체)

```
src/
  lib/
    l1-registry.js       L1 노드 레지스트리 (선행종속 A절 공용모듈)
    pb-filter.js          PocketBase 안전 필터 빌더 (P12 회피)
    pb-admin.js            L1 admin 토큰 캐싱 + pbFetch 공용 래퍼
    ops-alerts.js           "플래그만, 최종조치는 사람" 원칙 공용 큐
    notify-owner.js          18번 알림 허브 (여러 항목이 공유)
    http.js                    jsonResponse 헬퍼
    shared-attr-index.js       11번: 대표자명/디바이스/계좌 → 공유계정 KV 역색인
    fraud-signals.js            11번: 신호강도→위험등급 판정, 신호 영속화
    account-risk.js              11번: account_risk_score 조회/갱신
    velocity.js                   11번: 홀드생성 시점 KV 누적 → O(1) 속도체크
    dispute-history.js             11번: 이의제기 KV 누적 → O(1) 분쟁남용체크
  do/
    ledger-writer.js      LedgerWriter DO (9번 — guid 단위 원장쓰기 직렬화)
    escrow-signer.js        EscrowSigner DO (7번 — l1_node 단위 에스크로 서명 직렬화,
                             buyer/seller/platform 3행 원장 기록 포함)
  routes/
    ledger.js             9번: 정정전표 / 자가검증 / 앵커링크론 / 무결성감사크론
    escrow.js               7번: 홀드생성(11번 체크 포함) / 구매확정 / 이의제기(11번 연동)
                            / 분쟁해결 / 자동릴리즈크론(배송미확인 제외 로직 포함)
    payment-adapter.js       8번: Toss 어댑터(createOrder/verifyWebhook/release/refund)
    payment.js                8번: 결제생성 / PG웹훅(11번 체크 포함) / 정산대사크론
    reviews.js                 10번: 작성(SSO레벨 반영) / 도움돼요 / 판매자답글 / 신고 / 이상탐지
    kyc.js                      1번: 국세청 진위검증 / 재검증크론
    l1-resolve.js                선행종속 B절: 주소→l1_node (1번의 전제조건)
    fraud.js                      11번: 실시간체크 / 분쟁남용 / 순환거래그래프 / 클러스터링 / 이의신청
  index.js                라우팅 + scheduled 핸들러 진입점
pb_hooks/
  fs_ledger.pb.js       9번: append-only 강제 + 해시체인 자동계산 (L1 PocketBase 훅)
  reviews.pb.js          10번: 작성자격 검증 + 수정잠금 + 삭제금지 (L1 PocketBase 훅)
migrations/
  collections.json     1·7·8·9·10·11번 관련 PocketBase 컬렉션 15종 일괄 정의
wrangler.toml           KV/DO 바인딩, 크론 트리거
```

## 배포 순서

1. **KV 네임스페이스 생성**
   ```
   wrangler kv namespace create L1_REGISTRY_KV
   wrangler kv namespace create PENDING_REGION_KV
   wrangler kv namespace create OPS_ALERTS_KV
   wrangler kv namespace create SHARED_ATTR_INDEX
   wrangler kv namespace create REWARD_COUNTER_KV
   wrangler kv namespace create PUSH_SUBSCRIPTIONS_KV
   wrangler kv namespace create CONFIG_KV
   wrangler kv namespace create PG_PROVIDER_CONFIG_KV
   wrangler kv namespace create VELOCITY_KV
   wrangler kv namespace create DISPUTE_ABUSE_KV
   ```
   생성된 id를 `wrangler.toml`의 `REPLACE_ME`에 채워 넣습니다.

2. **L1 PocketBase에 훅·컬렉션 배포**
   - `pb_hooks/fs_ledger.pb.js`, `pb_hooks/reviews.pb.js`를 각 L1 노드(예: `l1-hanlim.gopang.net`)의
     `pb_hooks/` 디렉토리에 배치 (기존 `main.pb.js`와 나란히)
   - PocketBase 관리자 UI → **Import collections**로 `migrations/collections.json` 일괄 등록
   - 이미 존재하는 `profiles`, `search_index` 컬렉션에 다음 필드가 있는지 확인(없으면 수동 추가):
     `profiles.extra.kyc_status`(판매자용), `profiles.extra.sso_level`(구매자/판매자 공통 SSO 레벨),
     `search_index.rating_avg`/`review_count`/`kyc_status`

3. **Worker Secrets 등록**
   ```
   wrangler secret put L1_ADMIN_EMAIL
   wrangler secret put L1_ADMIN_PASSWORD
   wrangler secret put ESCROW_PRIVATE_KEY
   wrangler secret put ESCROW_PUBLIC_KEY
   wrangler secret put TOSS_CLIENT_KEY
   wrangler secret put TOSS_SECRET_KEY
   wrangler secret put TOSS_WEBHOOK_SECRET
   wrangler secret put PUSH_GATEWAY_URL
   wrangler secret put NTS_SERVICE_KEY
   wrangler secret put KAKAO_REST_KEY
   wrangler secret put APP_BASE_URL
   ```

4. **PG 제공사 설정 등록** (8번 — 배포 없이 갱신 가능한 KV)
   ```
   wrangler kv key put --binding=PG_PROVIDER_CONFIG_KV "toss" '{
     "status": "active",
     "escrow_supported": true,
     "fee_rate_card": 0.028,
     "fee_rate_transfer": 0.012,
     "webhook_secret_ref": "TOSS_WEBHOOK_SECRET"
   }'
   ```

5. **L1 레지스트리 초기값 등록** (파일럿 노드 1개)
   ```
   wrangler kv key put --binding=L1_REGISTRY_KV "KR-JEJU-JEJU-HANLIM" '{
     "base_url": "https://l1-hanlim.gopang.net",
     "region_name": "제주특별자치도 제주시 한림읍",
     "status": "active",
     "node_type": "regional",
     "center": { "lat": 33.4106, "lng": 126.2697 },
     "service_radius_km": 8,
     "admin_region_keys": ["제주특별자치도|제주시|한림읍"],
     "record_count": 0,
     "search_backend": "like",
     "created_at": "2026-07-20T00:00:00Z"
   }'
   ```

6. **배포**
   ```
   wrangler deploy
   ```

## 아직 이 저장소에 포함되지 않은 것 (명시적 후속 작업)

- **PG 차지백 웹훅** — 8번 설계 문서 5.2절의 `handleChargebackWebhook`이 미구현. 현재
  `payment.js`는 결제완료 이벤트만 처리한다.
- **사전(pre-execution) 사기 차단** — `realtimeFraudCheck`가 S3를 반환해도 이 저장소
  범위 내에서는 이미 자금이 에스크로로 들어온 뒤라 거래 자체를 막지 못한다. 진짜 차단은
  `/biz/order` 핸들러(이 저장소 밖, hondi-proxy 루트 worker.js — 2026-07 확인: gopang-proxy는
  hondi-proxy로 통합·폐지 중이므로 실제 위치를 정정함)가 L1 `/api/tx` 호출 전에
  `realtimeFraudCheck`를 호출하도록 통합해야 완성된다.
- `escrow-signer.js`의 `../openhash/hashChain.js` — 기존 `gopang-wallet.js`가 쓰던 앵커 모듈을
  실제 배포 환경 경로에 맞게 연결 필요 (인터페이스만 고정해둠)
- `gdcTransfer()` (reviews.js) — 리뷰 보상 GDC 이체의 실제 서명 로직. `EscrowSigner`와
  동일한 패턴(전용 시스템 계정 + Worker Secret 서명)으로 별도 `RewardSigner` DO를
  만드는 것을 권장하며, 이번 커밋 범위에는 포함하지 않았습니다.
- 프론트엔드(`desktop.html`/`webapp.html`/`kmarket_seller_template.html`) 연동 코드는
  이번 커밋에 포함하지 않았습니다 — 대화 세션에서 제시한 스니펫을 실제 파일에 반영하는
  작업이 별도로 필요합니다.
- 14번(실시간 배송사 연동)이 구현되면 `escrow.js`의 "운송장 미등록 시 자동릴리즈 제외"
  로직을 실제 배송완료 확인 기반으로 고도화할 수 있습니다.

## 2026-07-21 — 원장 통합 (fs_ledger → ledger_entries)

배포 준비 중 hondi-proxy(`pb_hooks/main.pb.js`)가 이미 `ledger_entries` 컬렉션에
GDC 송금/발행/AI과금 시 buyer/seller 2행 부기를 기록하고 있다는 걸 확인했다.
`fs_ledger`(이 저장소가 원래 설계했던 것)와 스키마 목적이 사실상 같아서(둘 다
`guid, direction, amount, fs_account, tx_id`), 병존시키지 않고 **`ledger_entries`에
해시체인 필드를 추가하는 방식으로 통합**했다:

- `pb_hooks/fs_ledger.pb.js` — 해시체인 강제 규칙(append-only, seq/entry_hash 계산)의
  대상 컬렉션을 `fs_ledger` → `ledger_entries`로 변경 (파일명은 유지)
- `do/ledger-writer.js` — INSERT 대상을 `ledger_entries`로 변경
- `migrations/collections.json`에서 `fs_ledger` 항목 제거
- `migrations/ledger_entries_extension.json` — 한림읍(`KR-JEJU-JEJU-HANLIM`)에 실제
  적용한 11개 신규 필드 정의. **나머지 42개 L1 노드에도 동일 확장이 아직 필요함**
  (worker.js의 `L1_NODE_MAP` 참조)

**⚠️ 미검증 사항**: `main.pb.js`는 `$app.dao().saveRecord()`(내부 DAO 직접 호출)로
쓰는데, 해시체인 훅은 `onRecordBeforeCreateRequest`(HTTP 요청 훅)에 걸려있다. 내부
DAO 호출도 이 요청 훅을 타는지 이 PocketBase 버전(0.22.x)에서 아직 실증 확인 못 함 —
확인 전까지는 `main.pb.js`가 쓰는 레코드의 `seq`/`entry_hash`가 비어있을 수 있다.
실제 GDC 송금을 하나 발생시켜서 결과 레코드를 조회해보는 방식으로 검증 필요.

**아직 통합 안 한 것 (같은 종류의 중복이지만 이번 범위 밖으로 보류)**:
- `reviews`(이 저장소) vs 기존 `trade_ratings` — 후자가 다국어 번역까지 이미 구현되어 더 성숙
- `business_verifications`(이 저장소) vs 기존 `seller_verifications`
- `dispute_cases`(이 저장소) vs 기존 `transaction_disputes`

세 쌍 모두 필드 구성이 겹치는 것으로 보이나, `fs_ledger`처럼 "지금 당장 안 고치면
배포 자체가 위험한" 수준은 아니라고 판단해 후속 작업으로 미뤘다. 착수 전 반드시
기존 컬렉션을 실제로 쓰는 코드(worker.js, pb_hooks/main.pb.js)를 먼저 확인할 것.

## 2026-07-21 — 원장(fs) 쓰기를 market-proxy로 완전 이관

로컬 PocketBase 0.22.14 재현 실험으로 두 가지를 실증했다:
1. `hondi-proxy`(`pb_hooks/main.pb.js`)의 내부 `$app.dao().saveRecord()` 직접
   쓰기는 `fs_ledger.pb.js`의 `onRecordBeforeCreateRequest` 훅을 **타지 않는다**
   (HTTP 요청 경로에만 걸리는 훅이라 내부 DAO 호출은 우회함) — `entry_hash`/
   `seq`가 계산되지 않은 채 저장됨.
2. 위와 별개로, `fs_ledger.pb.js` 자체가 v0.23+ 전용 훅 이름
   (`onRecordUpdateRequest`/`onRecordDeleteRequest`, Before 없이)을 쓰고 있어
   실제 0.22.14 서버에서 파일 로드 자체가 `ReferenceError`로 실패했을 가능성이
   높다(→ Before 포함 이름으로 수정 완료, 별도 커밋).

이 두 문제와, 애초에 우려했던 "hondi-proxy·market-proxy가 동시에 같은 guid에
쓸 때의 경합" 문제를 한번에 해결하기 위해, **원장(fs, financial statement)
관련 쓰기를 market-proxy가 전담**하도록 이관했다:

- **신규 엔드포인트**: `POST /internal/ledger-entries` (`src/routes/internal.js`)
  — `pb_hooks/main.pb.js`의 3개 지점(TX 정산·MINT·AI과금)이 이제 이 엔드포인트를
  HTTP로 호출한다. 호출은 `LedgerWriter` DO(guid 단위 직렬화)를 거치므로 경합이
  사라지고, HTTP 요청 경로이므로 해시체인 훅도 정상적으로 발동한다.
- **인증**: Cloudflare Service Binding은 호출자가 Cloudflare 밖의 일반 서버
  (PocketBase VM)라 적용할 수 없음을 확인 — 기존 코드베이스 관례
  (`BRIDGE_SECRET`/`MINT_SECRET`/`AI_CHARGE_SECRET`, body 필드로 공유 시크릿
  전달)를 그대로 따라 `LEDGER_WRITE_SECRET`을 도입했다.
- **필요한 서버 측(PocketBase VM) 설정**: `main.pb.js`가 `$os.getenv()`로
  읽는 두 값을 **43개 L1 노드 프로세스 전부**의 OS 환경변수로 설정해야 한다:
  - `MARKET_PROXY_URL` — 예: `https://market-proxy.tensor-city.workers.dev`
  - `LEDGER_WRITE_SECRET` — market-proxy의 `wrangler secret put LEDGER_WRITE_SECRET`과
    **반드시 동일한 값**
- **알려진 트레이드오프**: PocketBase(로컬) → market-proxy(Cloudflare) →
  다시 같은 PocketBase 서버로 돌아오는 왕복 네트워크 홉이 생긴다. 원장 기록은
  이미 "실패해도 정산 자체는 안 막는다"는 비동기·관용적 설계(각 지점 try/catch)라
  이 지연이 정산 응답 자체를 늦추지는 않지만, 원장 반영에는 약간의 지연이 생긴다.
- **아직 안 한 것**: `main.pb.js`에 `NODE_CONFIG`가 (핸들러별 격리 컨텍스트
  때문에) 5번 중복 정의되어 있던 기존 관례를 그대로 따라, 이번에 추가한 2곳
  (MINT/AI-CHARGE)에도 동일 객체를 복제했다 — 이 중복 자체를 줄이는 리팩터링은
  이번 범위 밖.
