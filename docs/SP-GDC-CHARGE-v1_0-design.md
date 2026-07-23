# SP-GDC-CHARGE-v1_0 — 가입 축하 충전·사용량 차감·저잔액 알림 메커니즘

작성일: 2026-07-23
대상 저장소: Openhash-Gopang/gopang (worker.js), Openhash-Gopang/gdc (참고용 클라이언트)
기준 커밋: 7a6beb6 (2026-07-23 14:25:48 +0900)

## 0. 요약

가입 직후 100원 상당(=0.1 GDC, 교환비 1,000:1) GDC를 사용자 실지갑에
1회 자동 충전하고, 이후 실사용량만큼 그 잔액을 실제로 차감하며, 잔액이
문턱값 이하로 떨어지면 웹푸시로 충전을 권고한다. 새 엔드포인트나
새 인프라를 만들지 않고, worker.js에 이미 구현되어 있던 세 가지 기존
파이프라인(①/api/mint 발행, ②/api/ai-charge 실차감, ③VAPID 웹푸시)을
그대로 재사용하는 방식으로 설계했다 — 신규 코드는 "언제 부를 것인가"와
"저잔액을 어떻게 감지·통지할 것인가"에만 집중되어 있다.

## 1. 기존 코드 실사 결과 (설계 전 확인한 것)

- `EXCHANGE_RATE_KRW_PER_GDC = 1,000` — 요청하신 1,000:1 교환비는 이미
  main.pb.js(정본)와 worker.js(사본)에 존재. 100원 = 0.1 GDC.
- `/api/mint`(main.pb.js) — krw_amount를 받아 gdcAmount = krw_amount/1000로
  환산해 발행하는 엔드포인트가 이미 있음(관리자 입금확인 충전확정
  `handleChargeConfirm`이 이미 이 경로를 씀). **가입 보너스도 이 경로를
  그대로 재사용**했다 — 새 발행 로직을 또 만들지 않음.
- `/api/ai-charge`(main.pb.js) + `_chargeGdcForAiUsage`/`_settleAiUsage`
  (worker.js) — AI 사용량이 발생할 때마다 실제 GDC 잔액에서 차감하는
  파이프라인이 **이미 실사용 중**이었음(단, 지금은 "가입자당 100원
  무료 한도"라는 별도 가상 카운터를 먼저 소진한 뒤에만 동작).
- `_sendPushToGuid` — VAPID 웹푸시 발송 헬�_퍼가 이미 존재(배포 알림,
  긴급알림 등에 사용 중). **저잔액 알림도 이 헬퍼를 그대로 재사용**.
- **중요 발견**: "가입자당 100원 무료 한도"(`FREE_QUOTA_KRW_LIMIT=100`,
  KV `hondi:free_spend:{guid}`)는 **실지갑 GDC 잔액과 무관한 별도의
  가상 카운터**다. 지금 요청하신 "가입 직후 100원 상당 GDC 충전"과는
  다른 메커니즘이며, 현재 `FREE_QUOTA_ENFORCEMENT_ENABLED = false`로
  집행 자체는 개발 기간 동안 꺼져 있는 상태다. 이 두 메커니즘이
  겹치는 지점은 §5에서 설명.

## 2. 신규 구현 — ① 가입 축하 충전

- 위치: `handleRegisterKey`의 "신규 등록" 분기(같은 guid로 재등록하는
  멱등 분기에는 걸리지 않음).
- 함수: `_grantSignupBonus(env, guid)` — `/api/mint`를 `krw_amount:100,
  memo:'signup_bonus:가입 축하 충전'`으로 호출 → 0.1 GDC 발행.
- 멱등성: KV `hondi:signup_bonus_granted:{guid}` 플래그, TTL 없이
  평생 1회. mint가 실패하면 플래그를 세우지 않으므로, 사용자가 기기를
  바꿔 재등록하거나 다음에 다시 로그인해도(같은 guid로 handleRegisterKey가
  다시 불리는 경우) 자동 재시도된다.
- 실패 처리: mint 실패해도 가입/키 등록 자체는 막지 않는다(로그만 남김,
  태그 `SIGNUP_BONUS_MINT_FAILED`). 신규 가입 자체를 GDC 발행 성패에
  의존하게 만들면 안 된다는 원칙.

## 3. 신규 구현 — ② 사용량 차감

**별도로 만들지 않음.** 기존 `_settleAiUsage → _chargeGdcForAiUsage →
POST /api/ai-charge` 파이프라인이 이미 실사용 중이며, 가입 보너스로
채워진 실지갑 잔액이 그 대상이 된다. 이번 패치에서 바꾼 부분은:
`_settleAiUsage`가 `_chargeGdcForAiUsage`의 반환값(`balance_after`)을
그대로 받아 §4의 저잔액 체크로 넘기도록 한 줄 추가한 것뿐이다(잔액
재조회 없음 — 이미 응답에 들어있던 값 재사용).

## 4. 신규 구현 — ③ 저잔액 충전 권고 알림

- 문턱값: `GDC_LOW_BALANCE_THRESHOLD_KRW = 20`원 상당(=0.02 GDC).
  가입 보너스 자체가 100원(0.1 GDC)으로 작기 때문에, 문턱값도 그
  20% 수준으로 잡았다 — 필요시 이 상수 하나만 바꾸면 됨.
- 트리거 시점: 실차감(`_chargeGdcForAiUsage`) 직후 `balance_after`가
  문턱값 이하로 내려간 순간.
- 스팸 방지: KV `hondi:low_balance_notified:{guid}` 플래그로 "이미
  알렸음"을 기록 — 문턱값 아래에서 매 요청마다 재발송하지 않는다.
  잔액이 다시 문턱값 위로 회복되면(충전 등) 플래그를 지워, 다음에
  또 낮아졌을 때 재알림이 가능하게 한다.
- 채널: 기존 VAPID 웹푸시(`_sendPushToGuid`) — push_subscription이
  없는 사용자에게는 조용히 스킵(기존 헬퍼의 기본 동작 그대로).
- 보조 채널: `GET /biz/balance-status?guid=...` 신규 엔드포인트 —
  푸시 구독을 안 한 사용자도 앱을 열었을 때 배너로 저잔액 여부를
  확인할 수 있도록 잔액·문턱값·저잔액 여부를 반환한다. 푸시는
  "안 열어봐도 알림", 이 엔드포인트는 "열었을 때 상태 확인"으로
  서로 보완 관계.

## 5. 설계 결정 사항 — "가입자당 100원 무료 한도"와의 관계

이번 신설분(실지갑 0.1 GDC)과 기존 가상 카운터(KV 100원)는 **서로
다른 예산이라 순서대로 소진**된다: 신규 가입자는 사실상 가상 100원
+ 실지갑 100원 = 총 200원 상당의 무료 사용량을 갖게 된다.

두 가지 대안이 있어 정리해 둔다 — 어느 쪽으로 갈지는 정책 판단이
필요해 이번 패치에서는 더 안전한(기존 로직 무변경) A안으로 뒀다:

- **A안(이번 패치, 채택)**: 기존 가상 100원 한도를 그대로 두고,
  실지갑 0.1 GDC를 그 위에 얹는다. 기존 과금 게이트(`callDeepSeek`
  STEP 0)를 전혀 건드리지 않으므로 회귀 위험이 가장 낮다. 총 무료
  예산이 "100원"이 아니라 "약 200원"이 되는 점만 감안하면 됨.
- **B안(대안)**: "가입 직후 GDC 충전 → 그 GDC만 차감"이라는 문구를
  글자 그대로 맞추려면, `FREE_QUOTA_KRW_LIMIT`를 0으로 낮추거나
  `FREE_QUOTA_ENFORCEMENT_ENABLED` 관련 게이트 자체를 걷어내
  "1턴째부터 실지갑 잔액을 바로 사용"하도록 바꿔야 한다. 이건
  `callDeepSeek`의 STEP 0 게이트(예산 개발 기간 내내 튜닝해 온 로직)를
  건드리는 것이라, 다른 협업자가 최근 손댄 흐름과 충돌할 여지가 A안보다
  크다. 정확히 "100원 하나만" 원하시면 별도로 말씀 주시면 그 부분만
  다시 패치하겠습니다.

## 6. 변경 파일

- `worker.js` — `worker-gdc-charge-patch.diff` 적용 대상. 변경 지점 4곳:
  1) `_settleAiUsage` 안에서 `_chargeGdcForAiUsage` 결과를 저잔액
     체크로 전달(기존 로직 흐름은 그대로, 한 블록 추가)
  2) `_grantSignupBonus` / `_checkLowBalanceAndNotify` /
     `handleBalanceStatus` / `getBalanceGdcForStatus` 함수 4개 신설
     (기존 `_settleAiUsage`와 `handleFreeQuotaStatus` 사이에 삽입 —
     기존 코드는 한 줄도 삭제하지 않음)
  3) `handleRegisterKey`의 "신규 등록" 분기에 `_grantSignupBonus` 호출
     한 줄 추가
  4) 라우팅 테이블에 `GET /biz/balance-status` 한 줄 추가

- 새 PocketBase 마이그레이션: **없음.** 두 플래그(가입 보너스 지급
  여부, 저잔액 알림 발송 여부) 모두 기존에 쓰던 KV
  (`env.AI_SETUP_SEALS_KV`)에 저장 — 스키마 변경 없이 기존 관례 그대로.

## 7. 적용 방법 (요약 — PowerShell 섹션 별도 제공)

1. `git pull --rebase`로 최신 상태 확보(다른 작업자 커밋 보존 확인).
2. `git apply worker-gdc-charge-patch.diff`로 패치 적용 — 컨텍스트가
   어긋나면(다른 협업자가 같은 부분을 이미 고쳤다면) 여기서 실패하며,
   이 경우 자동 병합하지 말고 수동으로 대조해 반영할 것.
3. `node --check worker.js`로 문법 확인(이미 이번 세션에서 통과 확인함).
4. wrangler로 배포.

## 8. 추가 확인 — 사용자용 충전 신청 페이지 (2026-07-23 후속)

실사 중 발견: gdc 저장소에는 `charge-admin.html`(관리자 전용, 입금
확인 후 확정)만 있고, 사용자가 직접 `/biz/charge-request`를 호출해
매칭 코드를 발급받는 **사용자용 페이지가 어디에도 없었다** — 즉
저잔액 알림을 보내도 사용자가 실제로 충전을 신청할 화면이 없는
상태였다. 이번 후속 작업에서 `charge.html`(gdc 저장소 루트, 도메인
`gdc.hondi.net` — CNAME 확인함)을 신설해 이 공백을 메웠다:

- `gopang-wallet.js`를 동일하게 로드해 `window.gopangWallet.guid` 확보
  (webapp.html 등과 동일 관례)
- `POST /biz/charge-request` 호출 → 매칭 코드·계좌정보·안내문 표시
- `GET /biz/charge-status`를 20초 간격 폴링 → 관리자가 charge-admin.html에서
  확정하면 자동으로 "입금 확인 완료" 상태로 전환
- `GET /biz/balance-status`(이번에 신설)로 상단에 현재 잔액 배너 표시

저잔액 알림의 `url`과 `gdc-balance-banner.js`의 기본 `chargeUrl`을
`/pages/gdc-charge.html`(존재하지 않던 가정 경로)에서
`https://gdc.hondi.net/charge.html`(실제 신설 경로)로 정정했다.

## 9. 남은 TODO (이번 범위 밖)

- B안(가상 100원 한도 폐지, 실지갑 잔액만 사용) 전환 여부는 정책
  결정 후 별도 패치.
- 가입 보너스 지급 실패가 누적되는 경우를 위한 관리자용 재시도/조회
  엔드포인트(현재는 로그로만 추적, 재시도는 사용자의 다음 로그인에
  자연히 걸림 — 명시적 배치 재처리는 없음).
- `charge.html`은 새 페이지라 실제 배포 후 gopang-wallet.js 로딩 타이밍
  (5초 타임아웃)이 실사용 환경에서 충분한지 확인 필요.
