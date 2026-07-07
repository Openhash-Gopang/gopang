# 제주 L1~L3 구현분 — 2026-07-07

jeju-l1-l3-field-test-plan-2026-07-07.md 기준 실제 구현. 5개 파일:

## 1. main.pb.js — 전체 교체
43개 L1 + 2개 L2 + 1개 L3(+기존 L4/L5)가 **전부 이 파일 하나를 공유**하므로,
폴더명(`$app.dataDir().split("/").pop()`)으로 자기 층위를 인식하도록 재작성했다.

- **NODE_ID_SELF 동적화**: 기존엔 `"KR-JEJU-JEJU-HANLIM"`이 여러 곳에 하드코딩돼
  있었다(hanlim 1개 노드 시절 코드). 이제 콜백마다 `NODE_CONFIG[폴더명]`으로
  자기 자신을 찾는다(Goja 콜백 바깥 최상위 선언 제약 — 기존 관례 그대로 유지,
  중복 선언은 안전을 위한 의도적 트레이드오프).
- **`/api/tx` 브릿지 아웃**: Worker가 `seller_home_node`를 넘기면(판매자가
  다른 L1 소속), 판매자 몫 output을 `bridge-out:{target}` sentinel로 리디렉션 +
  `bridge_out` 컬렉션에 outbox 레코드 생성. 로컬 총량 보존식은 sentinel도
  guid로 취급되므로 항상 그대로 유지된다.
- **`POST /api/bridge-in`**: 다른 L1에서 들어오는 크레딧. tx_hash 기준
  멱등. buyer_guid를 `bridge-in:{source}` sentinel로 두어 발행총량을
  안 늘리면서 잔액 보존.
- **`GET /api/bridge-out/pending`**: Worker 크론이 폴링하는 창구(L1은 다른
  L1을 직접 안 부른다 — P1).
- **`POST /api/bridge-out/complete`** / **`/refund`**: 완료 통지 / 유예시간
  초과 시 보상 트랜잭션.
- **`/api/supply/verify` 계층 인식**: L1은 기존 로직 그대로(노드명만 동적화).
  L2/L3는 하위 노드 `/api/supply/verify`를 HTTP로 합산. sentinel 설계 덕에
  "브릿지 진행 중 오탐"(당초 계획서 §6.4 우려)이 **애초에 발생하지 않는다**
  — 별도 유예시간 로직 없이도 항상 정합.
- `/health`, `/push_root`도 48개 전체 NODE_CONFIG로 확장.

**아직 안 한 것**: `/api/mint`, `/api/balance`는 손대지 않음(노드 무관 로직).
PocketBase 마이그레이션 파일화(§2.3)는 스키마를 REST로 직접 만드는
`provision-l1-nodes.py`로 대체했음 — 정식 마이그레이션 파일 버전관리는 후속 작업.

## 2. worker.js — 부분 패치
- `L1_NODE_MAP`에 43개 L1 전체 추가(경로 라우팅, §2.4).
- `_l1AdminToken` → `_l1AdminTokenFor(env, base)`로 일반화(노드별 토큰 캐시 —
  기존엔 hanlim 토큰 하나만 캐싱해서, 다른 노드 호출 시 인증 실패했을 문제).
- `_resolveHomeL1Node` / `_writeHomeL1Node`: L3의 `guid_home_l1` 레지스트리(§4).
- `handleRegisterKey`: `home_l1` 파라미터로 가입 시 소속 L1 지정 + 레지스트리 기록.
- `handleBizOrder`: 판매자 소속 L1을 조회해 구매자와 다르면 크로스-L1로
  표시, L1에 `seller_home_node` 전달, L1이 `bridge:{status:'pending'}`을
  돌려주면 `_relayBridge`로 대상 L1 `/api/bridge-in` 호출 → 소스 L1
  `/api/bridge-out/complete` 통지(ctx.waitUntil, 거래 자체는 안 막음).
- `scheduled()`: 기존 머클 앵커링에 `_sweepBridgeOutbox` 추가 — 43개 L1의
  pending bridge_out을 순회하며 재시도, 1시간 초과분은 환불.

**아직 안 한 것**: cron 주기는 wrangler.toml의 기존 트리거 설정을 그대로
따름(별도 조정 안 함 — 43개 순회라 주기가 너무 짧으면 API 호출량 부담,
Phase 1~2 실측 후 조정 권장). refund 시 buyer_guid 역조회를 `pdv_log`에서
하는데, `reporter_svc`가 있어 Worker가 PDV를 안 남긴 경로에서는 이 역조회가
실패한다 — 그 경로는 브릿지를 안 타는 케이스인지 재확인 필요.

## 3. topology.json
폴더명→{id, layer, port, parentFolder} 전체 48개 매핑. main.pb.js/worker.js/
provision 스크립트가 전부 이 파일에서 생성됐다 — 포트나 노드ID를 바꿀 땐
이 파일을 고치고 세 산출물을 재생성할 것(생성 스크립트는 대화 중 만든
1회성 파이썬이라 별도 첨부 안 함 — 필요하면 재요청).

## 4. provision-l1-nodes.py
42개 신규 L1 PocketBase 인스턴스 기동(systemd) + hanlim 스키마 클론 +
bridge_out/bridge_in/guid_home_l1 신설. `--dry-run`으로 먼저 확인 권장.
**실행 전 §2.2(`free -h`/`df -h`)로 리소스 여유 반드시 확인.**

```powershell
python3 provision-l1-nodes.py --dry-run `
  --admin-email <L1_ADMIN_EMAIL> --admin-password <L1_ADMIN_PASSWORD>
# 확인 후
python3 provision-l1-nodes.py --only l1-aewol `
  --admin-email <L1_ADMIN_EMAIL> --admin-password <L1_ADMIN_PASSWORD>
```

## 5. nginx-l1-routes.conf
`/n/{folder}/` → `127.0.0.1:{port}` 47개 location block(L4/L5 제외, 범위 밖).
기존 `l1-hanlim.hondi.net` server 블록 안에 include 후 `nginx -t && nginx -s reload`.

---

## 권장 순서 (계획서 §7 Phase 1)
1. `free -h`/`df -h` 확인
2. `provision-l1-nodes.py --only l1-aewol` (파일럿 1곳만 먼저)
3. main.pb.js 배포(전체 프로세스 재시작 — 사람 트래픽 적은 시간대)
4. nginx-l1-routes.conf include + reload
5. worker.js 배포
6. 계획서 §9 시나리오 1~5 실행(hanlim↔애월 간 정상 거래, 장애 주입, 중복
   재시도, L2 검증 시점 경합)
