# push 알림이 폰이 아니라 PC로 가는 문제 — 근본 수정 (2026-07-23)

`docs/PUSH_SUBSCRIPTION_HIJACK_2026_07_21.md`의 §4("근본적으로 남는 설계
한계")에 명시돼 있던 후속 작업입니다. 07-21 수정(지갑 키 없는 기기만
자가치유에서 걸러냄)은 부분 수정이었고, PC가 실제로 그 계정의 지갑 키를
정당하게 가진 적이 있는 경우(예: 예전에 이 PC로 device-link를 받은 적이
있음)에는 여전히 재현됐습니다.

## 1. 원인 (07-21 문서와 동일 — 재확인)

`profiles.push_subscription`이 계정(guid)당 필드 하나뿐이라, 여러 기기가
같은 계정으로 각자 구독하면 **마지막에 구독한 기기가 이전 기기의 구독을
그냥 덮어씁니다.** 07-21 수정은 "지갑 키가 아예 없는 기기"라는 한 가지
경우만 막았을 뿐, 정당하게 지갑 키를 가진 기기가 여러 개인 경우의 덮어쓰기
자체는 그대로 남아있었습니다.

## 2. 수정 — 기기별 구독 배열

PocketBase 스키마 변경(마이그레이션) 없이, 기존 `push_subscription` 텍스트
필드 안의 JSON **형태**만 바꿨습니다:

- 이전: 구독 객체 1개 — `{ endpoint, keys, ... }`
- 이후: 기기별 항목 배열 — `[{ deviceId, subscription, sound, updatedAt }, ...]`

`worker.js`에 4개 헬퍼 함수를 추가하고(`_parseDeviceSubscriptions`,
`_serializeDeviceSubscriptions`, `_upsertDeviceSubscription`,
`_removeDeviceSubscription`), 이 필드를 읽고 쓰는 6곳(`handlePushSubscribe`,
`handleDeviceLinkInit`, `handlePdvRelayPush`, `handlePushSend`,
`handlePushBroadcast`, `_sendPushToGuid`)을 전부 이 헬퍼를 거치도록
교체했습니다.

- **쓰기(`handlePushSubscribe`)**: 이제 `deviceId`를 받아서, 그 기기의
  항목만 교체(upsert)하거나 제거(unsubscribe)합니다 — 다른 기기 항목은
  건드리지 않습니다. 계정당 최대 10개 기기까지 보관(오래된 것부터 정리).
- **읽기(device-link 등)**: 등록된 **모든** 기기로 발송합니다. 실제 승인은
  지갑 키를 가진 기기에서만 가능하므로, 다른 기기에 알림이 뜨는 건
  무해합니다 — 오히려 "예전 PC가 자신을 덮어써서 폰에 알림이 안 오는"
  사고를 구조적으로 막습니다(폰의 구독이 살아있는 한 반드시 같이 발송됨).
- **하위호환**: 구버전(배열이 아닌 단일 객체) 데이터도 `endpoint` 필드
  존재 여부로 감지해 1개짜리 배열로 취급합니다. deviceId 없이 보내는
  구버전 클라이언트는 `'legacy'`라는 고정 deviceId로 취급됩니다(구버전
  기기끼리는 여전히 서로 덮어쓸 수 있으나, 이 커밋 이후 배포된 클라이언트는
  서로 침범하지 않습니다).

클라이언트(`services/push.js`)에는 `getOrCreateDeviceId()`를 추가해
브라우저별로 `localStorage`에 안정적인 ID를 한 번만 생성·보존하고, 구독
등록/사운드변경/해지 요청 전부에 이 ID를 실어 보내도록 `webapp.html`의
관련 호출부 2곳도 함께 수정했습니다.

## 3. 검증

`node --test src/tests/network/phase11_push_multidevice.test.js`로
5가지 시나리오를 확인했습니다: 두 기기 동시 구독 시 서로 안 덮어씀,
device-link가 등록된 모든 기기로 발송됨(이번 사고의 핵심 재현·수정
확인), 구독 취소가 그 기기 항목만 제거, 구버전 단일 객체 데이터 하위호환,
같은 deviceId 재구독 시 중복 추가 안 됨. 기존 `phase9_push_broadcast`·
`phase10_push_l1_priority` 테스트도 전부 재통과 확인(`phase10`의 PL-04는
새 배열 형식에 맞춰 갱신).

## 4. 남는 한계

- `sw.js`의 `pushsubscriptionchange` 핸들러(브라우저가 구독을 자체
  무효화했을 때 재구독)는 애초에 `guid`를 안 보내 서버가 항상 400으로
  거부하던 기존 버그가 있습니다(이번 작업 범위 밖 — 별도 확인 필요).
- 계정당 최대 10개 기기라는 상한은 임의값입니다. 실사용 중 이보다 많은
  기기를 등록하는 계정이 나오면 조정이 필요합니다.
