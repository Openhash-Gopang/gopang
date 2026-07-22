# device-link 웹푸시가 폰에 조용히 도착하지 않는 문제 (2026-07-22)

PC에서 device-link(기기 간 지갑 이전) 로그인을 시도했는데, 폰에 승인
알림이 전혀 오지 않는 문제를 조사·수정한 기록입니다. 2026-07-20에
VAPID 키 교체로 "고쳤다"고 기록됐던 바로 그 증상이 재발한 케이스입니다.

## 1. 원인

2026-07-20, 분실한 옛 VAPID 개인키 대신 새 키 쌍으로 교체했습니다
(`services/push.js`의 `VAPID_PUBLIC_KEY` 상수도 그때 새 값으로 교체).
그런데 실제 구독 로직(`requestPushSubscription()`)은 다음과 같았습니다:

```js
let sub = await reg.pushManager.getSubscription();
if (!sub) {
  sub = await reg.pushManager.subscribe({ ... applicationServerKey: VAPID_PUBLIC_KEY ... });
}
```

**기존 구독이 "있냐 없냐"만 볼 뿐, 그 구독이 지금 VAPID 키로 만들어진
구독인지는 전혀 검증하지 않았습니다.** 07-20 키 교체 이전에 이미
구독해둔 기기는 `getSubscription()`이 옛 키로 만들어진 죽은 구독을
그대로 반환하고, 코드는 "이미 구독됨"으로 판단해 그걸 그대로 서버에
재등록합니다. 서버는 그 구독으로 계속 푸시를 보내지만 FCM이 키
불일치로 조용히 거부합니다 — 클라이언트로 에러가 올라오지 않으므로
"조용히" 안 오는 것처럼 보입니다.

`gopang-app.js`에는 이미 07-20/07-21에 걸쳐 24시간마다 자동으로
재확인·재구독을 시도하는 자가치유 로직이 들어가 있었지만(이 기기
지갑 키가 서버 등록 키와 실제 일치하는지 `_issueSession()`으로 검증한
뒤에만 진행), 정작 마지막 단계인 `requestPushSubscription()` 자체가
위 이유로 아무 것도 갱신하지 않고 조용히 "성공"을 반환했습니다.

## 2. 수정

`services/push.js`에서 기존 구독의 `applicationServerKey`를 현재
`VAPID_PUBLIC_KEY`와 바이트 단위로 비교해, 안 맞으면 `unsubscribe()`
후 새로 구독하도록 변경했습니다.

```js
if (sub) {
  const currentKey = _urlBase64ToUint8Array(VAPID_PUBLIC_KEY);
  const subKeyBuf  = sub.options?.applicationServerKey || null;
  const subKey     = subKeyBuf ? new Uint8Array(subKeyBuf) : null;
  const matches = !!subKey
    && subKey.length === currentKey.length
    && subKey.every((b, i) => b === currentKey[i]);
  if (!matches) {
    try { await sub.unsubscribe(); } catch (e) { /* 무시 */ }
    sub = null;
  }
}
```

## 3. 이미 죽은 구독을 지금 당장 되돌리려면

이 패치는 **다음 자동 재시도(24시간 쿨다운)부터** 정상 동작합니다.
지금 바로 검증하려면 폰에서:

```
javascript:localStorage.removeItem('gopang_push_last_try');location.reload();
```

리로드 시 `gopang-app.js`의 자가치유 블록이 즉시 재실행되어, 지갑 키
검증을 통과하면 새 구독으로 즉시 교체됩니다.

## 4. 남는 교훈

07-20 당시 "서버 키만 바꾸고 기존 구독은 자동으로 죽는다"는 사실은
주석에 정확히 기록돼 있었지만, 그걸 클라이언트가 스스로 감지해서
재구독하는 로직은 끝내 별도 작업으로 들어가지 않았습니다. "커밋
메시지·주석에 문서화됨" ≠ "재발 방지 코드가 실제로 존재함" — 이번에도
같은 패턴이 반복됐습니다(§L1_ADMIN_AUTH_INCIDENT_2026_07_21.md의
교훈과 동일).
