# 재가입 직후 push 구독이 곧바로 죽어있던 문제 (2026-07-22)

계정을 PocketBase에서 지운 뒤 재가입하면, 저장된 `push_subscription`이
FCM에서 곧바로 410(unsubscribed or expired)이 되는 문제를 `wrangler tail`로
실측하고 수정한 기록입니다. §STALE_VAPID_PUSH_SUBSCRIPTION_2026_07_22.md의
VAPID 키 불일치 수정 이후에도 재발해서 다시 조사했습니다.

## 1. 원인

`requestPushSubscription()`을 부르는 경로가 두 곳입니다:

1. `auth.js` — 가입 완료 직후 `resolve(user)` 바로 다음 줄에서
   fire-and-forget으로 호출
2. `gopang-app.js` — 페이지 로드마다(24시간 쿨다운) 실행되는 자가치유
   IIFE에서도 호출. 신규 계정은 `gopang_push_last_try`가 없어 쿨다운도
   안 걸림

가입 완료 시점을 보면: `resolve(user)`가 (1)번을 백그라운드로 던지자마자
`while (!_isRegistered())` 루프가 즉시 빠져나가고, 곧바로 (2)번 자가치유
블록이 실행됩니다. **결과: 같은 순간에 `pushManager.subscribe()`/
`unsubscribe()`가 두 번 동시에 실행**됩니다. 하나가 구독을 만드는 도중
다른 하나가(VAPID 키 불일치 검사 로직 때문에) 그걸 곧바로
`unsubscribe()`해버리거나, 서로 다른 타이밍에 만든 두 엔드포인트 중 이미
무효화된 쪽이 서버에 마지막으로 저장되는 경쟁이 실제로 발생했습니다.

## 2. 수정

`services/push.js`에 in-flight 락을 추가해, 동시 호출을 하나의 실행으로
합쳤습니다 — 먼저 온 호출이 실제로 진행하고, 뒤이어 온 호출은 새로
subscribe/unsubscribe를 또 트리거하지 않고 같은 결과를 기다립니다.

```js
let _inFlight = null;
export function requestPushSubscription(guid) {
  if (_inFlight) return _inFlight;
  _inFlight = _requestPushSubscriptionImpl(guid).finally(() => { _inFlight = null; });
  return _inFlight;
}
```

## 3. 진단에 쓴 방법

폰을 USB로 디버깅할 수 없는 상황이라, PC에서 `npx wrangler tail
hondi-proxy`로 Worker 로그를 실시간으로 보면서 device-link 로그인을
시도해 `_sendWebPush()`가 실제로 남기는 FCM 응답 코드(410)를 직접
확인했습니다 — 모바일 실기기 디버깅이 막힌 상황에서 서버 로그 실시간
스트리밍이 유용한 대안이 될 수 있습니다.

## 4. 함께 추가한 사용자 편의 기능

- 설정 화면 "앱 관리" 섹션 맨 아래에 "푸시 알림 재구독" 버튼 추가
- `?resetpush=1` URL 파라미터로 24시간 쿨다운 없이 즉시 재구독 트리거
  (`javascript:` 북마클릿을 모바일 주소창에 입력하기 어렵다는 실사용
  피드백 반영)
