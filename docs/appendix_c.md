## 부록 C. 고팡 메시징 시스템의 구성과 작동 방식

> 본 부록은 2026년 6월 고팡 P2P 채팅(WebRTC 시그널링 + DataChannel) 기능의 실시간성 결함을 진단하고 수정하는 과정에서 확인된 아키텍처, 발견된 구조적 결함, 진단 방법론을 정리한 것입니다. 설계 문서가 아니라 실전 디버깅을 통해 확인된 사실의 기록이며, 같은 실수를 반복하지 않고 향후 유사한 증상을 더 빠르게 진단하기 위한 참고 자료로 작성합니다. 부록 A·B와 마찬가지로 사례 중심으로 서술하되, 메시징 시스템은 단일 기능 영역이므로 사례에 앞서 아키텍처를 먼저 설명합니다.

---

### C-1. 전체 아키텍처 개관 — 시그널링과 데이터 전송의 분리

고팡 P2P 채팅을 이해하는 데 가장 중요한 전제는, **연결을 맺기까지의 협상(시그널링)** 과 **맺어진 뒤의 실제 대화(데이터 전송)** 가 완전히 다른 두 경로를 쓴다는 점이다. 이 둘을 구분하지 못하면 이후 모든 결함 사례가 헷갈린다.

```
[시그널링 단계]                          [데이터 전송 단계]
발신자 ──offer──► Worker ──► L1/Supabase   발신자 ◄──DataChannel(직접)──► 수신자
수신자 ◄──poll/Realtime── Worker ◄────┘    (서버 경유 없음, 순수 P2P)
수신자 ──answer/ICE──► Worker ──► L1/Supabase
```

시그널링 단계는 `RTCPeerConnection`이 서로의 SDP(offer/answer)와 ICE candidate를 교환해야 하는데, 두 기기가 아직 직접 연결돼 있지 않으므로 이 교환 자체는 반드시 서버를 거쳐야 한다. 고팡에서는 이 중계 역할을 Cloudflare Worker(`gopang-proxy`)의 `/signal/send`·`/signal/poll`·`/signal/delete` 세 엔드포인트가 맡는다.

협상이 끝나 `RTCPeerConnection`의 `connectionState`가 `connected`로 바뀌고 `DataChannel`의 `onopen`이 발생하면, 그 이후의 실제 채팅 메시지(`_rtcChannel.send()` / `channel.onmessage`)는 **서버를 전혀 거치지 않고 두 기기가 직접 주고받는다.** 이 책임 분리는 `src/gopang/ui/p2p-chat.js`(발신측 `startP2PCall`, 수신측 `handleIncomingOffer`, 공통 `_setupConn`/`_setupChannel`)와 `src/gopang/p2p/webrtc.js`(현재는 `setPeer()`가 `p2p-chat.js`로 위임하는 얇은 진입점)에 구현되어 있다.

**교훈:** 새로운 결함을 의심할 때 가장 먼저 "이게 시그널링 문제인가, 데이터 전송 문제인가"를 구분해야 한다. 입력창이 안 열리면 거의 항상 시그널링(연결 수립) 문제이고, 연결은 됐는데 메시지가 한쪽으로만 가면 DataChannel 자체의 문제다. 오늘 발견된 결함은 전부 전자였다.

---

### C-2. 시그널 전달 경로 — L1 PocketBase 우선, Supabase 폴백

Worker는 offer/answer/ICE 시그널을 저장할 때 L1(PocketBase, `l1-hanlim.gopang.net`)을 1차 저장소로, Supabase를 장애 시 폴백으로 쓴다.

```js
// worker.js — handleSignalSend (개념 요약)
let savedTo = 'l1';
try {
  await _l1SignalSend(from_guid, to_guid, type, payload, expires_at);
} catch (l1Err) {
  savedTo = 'supabase';
  await fetch(`${SUPABASE_URL}/rest/v1/webrtc_signals`, { ...POST... });
}
```

저장 스키마(PocketBase `webrtc_signals` 컬렉션)는 다음 다섯 필드다.

| 필드 | 타입 | 비고 |
|---|---|---|
| `from_guid` | Text | 발신자 IPv6 GUID |
| `to_guid` | Text | 수신자 IPv6 GUID |
| `type` | Text | `offer` / `answer` / `ice` |
| `payload` | JSON | 타입별로 구조가 다름(C-11 참고) |
| `expires_at` | Text(ISO) | 생성 시점 + 60초 |

TTL은 60초로 설계되어 있다(`worker.js`: `new Date(Date.now() + 60_000).toISOString()`). 조회(`_l1SignalPoll`)는 PocketBase 필터 쿼리(`to_guid='...'`)로 가져온 뒤, `expires_at`이 지난 항목을 클라이언트 측에서 한 번 더 걸러낸다 — PocketBase 필터 표현식만으로는 "지금 시각보다 이전"이라는 동적 비교를 걸기 까다롭기 때문이다.

**교훈:** TTL 60초는 진단 작업 중 큰 함정이 됐다(C-12 참고). 스크린샷을 주고받으며 분석하는 사이 매번 60초가 지나버려, "버그로 안 옴"과 "이미 만료돼서 사라짐"을 구분하기 어려웠다. 시그널처럼 휘발성 데이터의 TTL을 설계할 때는 그 시스템을 디버깅할 사람의 작업 사이클(스크린샷 캡처, 코드 수정, 재배포에 걸리는 시간)도 고려 대상에 넣어야 한다.

---

### C-3. NAT 통과 구성 — STUN과 자체 호스팅 TURN(coturn)

WebRTC는 두 기기가 같은 공인 IP거나 STUN만으로 직접 연결 가능한 환경(대략 60~70%)에서는 문제없이 붙지만, 이동통신망·기업 NAT·대학 네트워크처럼 엄격한 NAT 뒤에 있으면 STUN만으로는 연결이 실패한다. 이를 보완하는 게 TURN(중계) 서버다.

처음에는 Cloudflare Calls의 무료 TURN을 시도했으나, 계정에서 Calls 기능 자체가 활성화되지 않아 `/calls/turn_keys` API가 403(Authorization Failure)을 반환했다. Cloudflare 대시보드의 "Realtime(SFU)" 구독 화면과 TURN 전용 기능이 서로 다른 제품이라는 점도 혼동 요소였다 — TURN은 SFU 구독과 무관하게 별도로 활성화돼야 하는데, 신용카드 입력 화면까지 갔다가 잘못된 제품임을 확인하고 멈췄다.

최종적으로는 이미 L1 PocketBase를 운영 중이던 Oracle Cloud VM(`l1-hanlim`)에 오픈소스 `coturn`을 추가 설치하는 방향으로 선회했다. 절차는 다음과 같다.

1. VM에 `coturn` 설치, `openssl rand -hex 32`로 공유 비밀(`TURN_SECRET`) 생성
2. `/etc/turnserver.conf`에 `use-auth-secret`, `static-auth-secret=<비밀>`, `external-ip=<공인IP>` 설정
3. Oracle Cloud Security List에 4개 인그레스 규칙 추가: UDP/TCP 3478(STUN/TURN), TCP 5349(TURNS), UDP 49152-65535(릴레이 미디어)
4. VM 내부 `ufw`에도 동일 포트를 별도로 열어야 함 — 클라우드 보안 그룹과 OS 방화벽은 독립적인 두 계층이라 하나만 열면 차단된다
5. Worker에 `/turn/credential` 엔드포인트 추가 — RFC 8489 방식의 시간 제한 임시 자격증명(`username = "{만료시각}:{guid}"`, `credential = base64(HMAC-SHA1(TURN_SECRET, username))`)을 발급

클라이언트는 `fetchRtcConfig()`로 이 credential을 받아 `RTC_CONFIG.iceServers`에 STUN과 함께 TURN 서버를 추가한다. `TURN_SECRET`이 설정되지 않은 환경에서는 자동으로 STUN 전용으로 폴백하도록 설계해, 이 기능이 없던 이전 배포와도 호환되게 했다.

**교훈:** 클라우드 매니지드 서비스(Cloudflare Calls)가 계정 단위로 비활성화돼 있을 수 있다는 점을 먼저 확인하지 않고 진행하면 시간을 허비한다. 또한 클라우드 보안 그룹과 OS 방화벽은 별개의 계층이므로, 포트 개방은 항상 두 곳 다 확인해야 한다.

---

### C-4. 연결 수립 시퀀스 — 발신측/수신측 단계별 흐름

**발신측(`startP2PCall`)**

1. `RTCPeerConnection` 생성, `DataChannel('chat')` 생성
2. `_setupChannel`/`_setupConn` 등록(ICE candidate 발생 시 `/signal/send`로 전송하는 핸들러 포함)
3. `createOffer()` → `setLocalDescription()`
4. ICE 후보 수집을 최대 2초(`_waitForIce`) 대기
5. `type: 'offer'` 시그널 전송 — payload는 `{ sdp, from_handle, callId }`
6. `_watchAnswerRealtime()` 시작 — Supabase Realtime WS 구독(보조) + 1.5초 폴링(주력)으로 answer/ICE 수신 대기

**수신측(`handleIncomingOffer`)**

1. `startIncomingWatch()`가 부팅 시점부터 항상 떠 있다가, `type: 'offer'` 시그널을 WS 또는 3초 폴링으로 감지
2. 네이티브 `confirm()` 다이얼로그로 수락 여부 확인 — 거절 시 함수 종료, 시그널은 호출부에서 삭제됨
3. `RTCPeerConnection` 생성, `setRemoteDescription(offer)`
4. `createAnswer()` → `setLocalDescription()` → ICE 수집 대기
5. `type: 'answer'` 시그널 전송 — payload는 `{ sdp, from_handle, callId }`
6. 자체 ICE 폴링(`_startPoll`) 시작

**공통 — 연결 완료**

`conn.onconnectionstatechange`가 `connected`로 바뀌면 양쪽 폴링을 정지(`_stopPoll()`). 곧이어 `DataChannel.onopen`이 발생하면 입력창(`_p2p-input`)의 `disabled`를 해제한다. **이 시점부터 채팅은 서버를 거치지 않는다.**

---

### C-5. 발견된 결함 ① — 이중 처리 경로의 충돌(레거시 폴러 vs 신규 핸들러)

오늘 작업 초반, P2P 모듈을 `webrtc.js`(레거시) → `p2p-chat.js`(신규) 중심으로 통합했지만, `gopang-app.js`의 부팅 시퀀스가 **둘 다** 호출하고 있었다.

```js
// gopang-app.js (수정 전)
if (_isRegistered()) {
  _startSignalPoll();                       // 레거시 — webrtc.js, 1.5초 폴링
  if (_USER?.ipv6) startIncomingWatch(_USER.ipv6);  // 신규 — p2p-chat.js
}
```

레거시 `_handleOffer`/`_handleSignal`(`webrtc.js`)은 `JSON.parse(sig.payload)`로 SDP를 파싱하는데, 신규 코드는 `payload`를 **이미 객체**로 보낸다(`{ sdp, from_handle, callId }`). 객체에 `JSON.parse`를 호출하면 `SyntaxError`가 발생한다.

- `offer`/`answer` 분기는 자체 try/catch가 없어, 예외가 `_handleSignal` 끝의 `_deleteSignal()` 호출까지 막아버린다. **시그널이 영원히 삭제되지 않고**, 1.5초마다 같은 자리에서 똑같이 크래시한다.
- `ice` 분기는 자체 try/catch가 있어 예외는 삼켜지지만, 그 뒤의 `_deleteSignal()`은 정상 실행된다. **파싱은 실패한 채로 시그널이 삭제**된다 — 진짜 ICE candidate가 적용되기 전에 증발한다.

게다가 `webrtc.js`와 `p2p-chat.js`는 `core/state.js`의 `_rtcConn`/`_rtcChannel`을 공유하는 모듈 싱글턴이라, 레거시 코드가 신규 코드가 만든 연결 객체를 잘못 건드릴 위험도 있었다.

**수정:** `gopang-app.js`에서 `_startSignalPoll()` 호출을 제거하고, 모든 시그널 처리를 `startIncomingWatch`(p2p-chat.js) 단일 경로로 통일했다.

**교훈:** 모듈을 통합·교체할 때는 "새 코드를 추가했다"가 아니라 "옛 코드를 호출하는 모든 지점을 제거했다"까지 확인해야 한다. 두 핸들러가 같은 데이터 포맷을 다르게 가정한 채 동시에 살아있으면, 한쪽의 실패가 다른 쪽의 정상 동작까지 막을 수 있다(특히 "읽었지만 처리 못함 → 삭제도 안 함" 패턴은 데이터를 영구히 막힌 상태로 남긴다).

---

### C-6. 발견된 결함 ② — "구독 성공"과 "데이터 수신"의 혼동(wsOk 오설정)

`startIncomingWatch`/`_watchAnswerRealtime`은 Supabase Realtime WebSocket을 보조 경로로, 폴링을 주력 폴백으로 쓰도록 설계되어 있었다. 그런데 폴백을 끄는 조건이 잘못돼 있었다.

```js
// 수정 전
ws.onmessage = ({ data }) => {
  if (msg.event === 'phx_reply' && msg.payload?.status === 'ok') {
    wsOk = true;   // ← 구독 핸드셰이크 "성공"만으로 true가 됨
  }
  ...
};
setInterval(() => {
  if (wsOk) return;   // ← wsOk가 true면 폴백 폴링이 영구 정지
  ...폴백 폴링...
}, 3000);
```

문제는 시그널이 **L1 PocketBase**에 저장되는데 이 WS는 **Supabase**의 `postgres_changes` 이벤트를 구독한다는 점이다. 구독 핸드셰이크(`phx_reply`)는 항상 성공하지만, Supabase 테이블에는 애초에 INSERT가 일어나지 않으므로 실제 데이터는 **영원히 오지 않는다.** 그런데 핸드셰이크 성공 시점에 이미 `wsOk = true`가 되어, 정상적으로 시그널을 가져올 수 있는 유일한 경로(폴백 폴링)가 영구히 꺼져버린다.

이 버그는 흥미로운 비대칭을 만들었다 — 같은 PC 안 두 브라우저(유선/와이파이, WS 핸드셰이크가 거의 항상 1초 이내 완료)는 거의 항상 실패하고, 진짜 스마트폰(이동통신망, 핸드셰이크가 가끔 3초보다 느림)은 가끔 폴백 폴링이 먼저 실행되어 운 좋게 성공했다. **방향성이나 기기 종류의 문제가 아니라, 수신측 네트워크가 빠를수록 이 함정에 더 확실하게 걸리는 구조였다.**

**수정:** `wsOk`를 핸드셰이크 성공 시점이 아니라, **실제로 매칭되는 시그널 row를 수신한 시점**에만 `true`로 설정하도록 변경했다. 이렇게 하면 Realtime이 실제로 작동하지 않는 한 폴백 폴링은 영원히 활성 상태로 남는다.

**교훈:** "구독에 성공했다"와 "그 구독으로 실제 데이터가 온다"는 서로 다른 사실이다. 전자만 확인하고 안전망(폴백)을 끄는 로직은, 구독 대상 자체가 잘못됐을 때(이번처럼 다른 데이터베이스를 보고 있을 때) 조용히 전체 기능을 무력화한다. 폴백을 끄는 조건은 항상 "실제로 그 경로가 작동했다는 증거"를 기준으로 삼아야 한다.

---

### C-7. 발견된 결함 ③ — 통화 시도 식별자 부재로 인한 재연결 충돌(callId)

초기 구현에는 통화 시도를 구분하는 고유 ID가 없었다. `offer`/`answer`/`ice` 시그널은 `from_guid`/`to_guid`로만 매칭됐다. 재연결을 시도하면:

1. 새 `RTCPeerConnection`과 새 `_watchAnswerRealtime` watcher가 생성된다.
2. **이전 시도의 watcher는 정리되지 않고 그대로 살아있다** — 둘 다 같은 `peerGuid` 필터로 듣는다.
3. answer가 도착하면 두 watcher가 동시에 잡아 각자의(한쪽은 이미 의미 없는) `conn`에 `setRemoteDescription`을 시도한다.

동시에 수신측에서는, 재시도마다 **새 `offer`가 도착**한다. 상대가 "나가기"를 눌러 `_chatOverlay`가 `null`이 되는 순간 그 게이트가 다시 열리고, 누적되어 있던(혹은 거의 동시에 도착한) offer가 처리되어 **`confirm()` 팝업이 반복해서 뜨는** 현상으로 나타났다.

**수정:** 매 `startP2PCall()` 호출마다 `crypto.randomUUID()`로 `callId`를 생성해 offer/answer/ICE payload에 항상 포함시켰다. 모듈 전역 `_activeCallId`를 두어, 새 시도가 시작되면 즉시 갱신한다. 각 watcher는 메시지를 받을 때마다 자신의 `callId`가 `_activeCallId`와 일치하는지 확인하고, 불일치하면(더 새로운 시도로 대체됐다는 뜻) 스스로 종료한다. 수신측은 동일 `callId`의 offer가 중복 도착하면(`_seenOfferIds` Set) 두 번째부터 `confirm()`을 다시 띄우지 않는다. 추가로 `startP2PCall()` 시작 시 이전 `_rtcConn`/`_rtcChannel`이 남아있으면 로컬에서 먼저 정리한다.

**교훈:** 같은 두 당사자 사이에 여러 번의 "시도"가 발생할 수 있는 프로토콜이라면, 당사자 식별자(`from_guid`/`to_guid`)만으로는 부족하다. 시도 단위의 고유 식별자가 없으면, 오래된 시도와 새 시도를 구분할 방법이 없어 둘 다 살아남아 서로 간섭한다.

---

### C-8. 발견된 결함 ④ — 데이터 누적과 정렬 순서의 상호작용

위의 C-5 결함(레거시 폴러가 크래시하며 삭제를 막음)과 반복된 테스트가 겹쳐, 같은 `to_guid`에 **100건이 넘는 시그널이 누적**된 상태였다. 그런데 조회 쿼리는 다음과 같았다.

```js
// 수정 전
`${L1_SIGNAL_URL}?filter=${filter}&sort=created&perPage=20`
```

PocketBase의 `sort=created`(접두사 없음)는 **오름차순**, 즉 **가장 오래된 것부터** 반환한다. 누적된 100건 중 막 보낸 가장 최신 시그널은 90번째 즈음에 있는데, `perPage=20`으로 1페이지만 가져오니 **최신 시그널은 절대 그 안에 들어오지 못한다.** 발신은 분명히 성공해 L1에 정확히 저장됐는데, 수신측 poll은 그 시그널을 영원히 보지 못하는 정확한 이유였다.

진단 과정에서 별도로 "Cloudflare Worker의 `fetch()`가 GET 요청을 엣지에서 캐싱할 수 있다"는 가능성도 발견해 `cache: 'no-store'`와 cache-buster 쿼리파라미터(`&_ts=${Date.now()}`)를 선제적으로 추가했다. 이 패치 자체는 무해하지만, 실제 증상의 결정적 원인은 캐싱이 아니라 정렬 순서였다 — PocketBase Admin에서 레코드를 직접 확인하고, 워커를 거치지 않은 직접 REST 질의로 동일 필터가 109건을 정확히 반환함을 확인해서 캐싱 가설을 기각하고 정렬 가설로 좁혔다.

**수정:** 정렬을 `-created`(내림차순, 최신 것부터)로 변경하고 `perPage`를 20→40으로 늘렸다. 막 도착한 시그널이 항상 결과의 맨 앞에 오도록 보장해, 누적된 잔재의 양과 무관하게 즉시 보이게 했다.

**교훈:** "정상적으로 저장됐는데 조회가 안 된다"는 증상은 저장/조회 경로 자체의 버그가 아니라, **정렬 + 페이지 제한 + 데이터 누적**의 조합에서도 똑같이 나타날 수 있다. TTL이 있는 휘발성 데이터라도, 그 TTL을 보장하는 별도의 청소(GC) 절차가 없으면 만료된 레코드가 물리적으로는 계속 쌓여 페이지네이션을 어지럽힌다(C-10 참고).

---

### C-9. 발견된 결함 ⑤ — PWA 자동 업데이트와 배포 스크립트의 상호작용

진단 도중 "로그인 후 약 10초 간격으로 전체 부팅 로그가 반복된다"는 별개의 증상이 나타났다. 원인은 두 기능이 서로의 존재를 모른 채 상호작용한 결과였다.

`deploy.ps1`은 배포할 때마다 `sw.js`의 `CACHE_NAME`을 현재 시각으로 자동 갱신한다.

```powershell
$date = Get-Date -Format "yyyyMMdd-HHmm"
$swContent = $swContent -replace "const CACHE_NAME\s+=\s+'gopang-[\w-]+'", "const CACHE_NAME    = 'gopang-$date'"
```

오늘 수십 차례 배포했으니 `sw.js` 바이트는 매번 실제로 달라졌다. 그런데 `gopang.net`은 GitHub Pages(origin)를 Cloudflare가 앞단에서 CDN으로 감싸는 구조라, push 후 GitHub Pages 자체 CDN(Fastly)에 전체 전파되는 데 30~90초가 걸린다. 이 전파 기간 동안 `/sw.js` 요청은 어느 edge가 응답하느냐에 따라 신/구 버전이 섞여서 돌아올 수 있다.

한편 `gopang-pwa.js`의 자동 업데이트 로직(`_autoApplyUpdate`)은 새 버전을 감지하면 무조건 5초 후 `SKIP_WAITING` → `controllerchange` → `location.reload()`를 실행하며, **직전에 이미 자동 재시작했는지 확인하는 안전장치가 없었다.** 전파 지연 동안 캐시 플래핑이 "새 버전"으로 거듭 오인되면서, 5초 대기 + 재초기화 오버헤드로 약 10초 주기의 자동 새로고침 루프가 자체적으로 지속됐다.

**수정:** `sessionStorage` 기반 회로차단기를 추가했다 — 최근 20초 내에 이미 자동 재시작한 적이 있으면, 이번엔 자동 재시작을 건너뛰고 카운트다운 없는 수동 배너만 띄운다. `sessionStorage`는 `reload()`에도 유지되므로 루프 전체를 추적해 차단할 수 있다.

**교훈:** "배포 스크립트가 캐시 버스팅을 위해 파일을 매번 바꾼다"와 "클라이언트의 자동 업데이트 로직이 새 버전을 감지하면 무조건 재시작한다"는 각각은 합리적인 설계지만, **CDN 전파 지연이라는 제3의 변수**가 둘을 자기증식 루프로 만들 수 있다. 자동으로 스스로를 재시작하는 모든 클라이언트 로직에는 반드시 "최근에 이미 했다면 건너뛴다"는 회로차단기가 있어야 한다.

---

### C-10. 시스템 자동 점검 — 헬스체크 엔드포인트와 주기적 자동 실행

오늘 발견된 결함들(C-5의 미삭제 누적, C-8의 정렬 누락, C-9의 재시작 루프)에는 공통점이 있다 — **누군가 우연히 눈치채기 전까지 조용히 쌓이거나 반복되는 유형**이라는 점이다. 사용자가 직접 PocketBase Admin에 들어가 레코드 수를 세어보기 전까지는 109건이 쌓여있다는 사실 자체를 아무도 몰랐다.

이런 유형의 결함은 사후 디버깅보다 **사전 점검**으로 잡는 게 훨씬 싸다. 제안하는 구조는 다음과 같다.

1. **헬스체크 엔드포인트**(`/health/signals`) — 특정 guid 없이 `webrtc_signals` 컬렉션 전체를 대상으로, 만료되지 않은 레코드 수와 가장 오래된 레코드의 생성 시각을 반환. 두 값이 임계치(예: 미만료 50건 초과, 또는 최고령이 5분 초과)를 넘으면 비정상으로 간주.
2. **Cloudflare Worker Cron Trigger** — `wrangler.jsonc`에 `triggers.crons`를 추가해 5~10분 간격으로 1번을 자동 호출. 임계치 초과 시 Push 알림이나 관리자 이메일로 통보.
3. **만료분 청소(GC) 배치** — 같은 Cron에서 `expires_at`이 지난 레코드를 실제로 `DELETE`하는 일괄 작업을 함께 수행. C-8 결함의 재발 자체를 구조적으로 막는 조치다 — 정렬 순서를 고쳐도, 만료된 레코드가 영원히 테이블에 남아있으면 같은 종류의 문제가 다른 형태로 다시 나타날 수 있다.

**교훈:** "정상 동작 중인 것처럼 보이는 시스템"과 "실제로 정상인 시스템"은 다르다. TTL이나 자동 정리에 의존하는 설계는, 그 TTL/정리가 실제로 의도대로 동작하고 있는지 주기적으로 확인하는 별도의 감시 체계 없이는 결국 누적 결함으로 이어진다.

---

### C-11. 미해결·잔존 이슈

이번 디버깅 범위 밖에 있었거나, 우회했을 뿐 근본 수정은 안 된 항목을 기록한다.

- **`push/vapid-public-key` 500 오류** — 오늘 로그에 거의 매번 등장했지만(`requestPushSubscription`/`_register` 경로), P2P 채팅 자체와는 무관해 보여 우선순위에서 제외하고 그대로 방치했다. 별도로 원인 조사가 필요하다.
- **`_startPoll`의 모듈 싱글턴 구조** — `p2p-chat.js`의 `_pollInterval`은 모듈 전역 변수 하나뿐이라, `_watchAnswerRealtime`(발신측 answer 대기)과 `handleIncomingOffer`(수신측 ICE 대기)가 동시에 `_startPoll`을 호출하면 나중 호출이 이전 인터벌을 덮어쓴다. callId 도입으로 재연결 시나리오의 직접적 증상은 가려졌지만, 한 브라우저가 발신과 수신 역할을 짧은 시간 안에 동시에 수행하는 경우(예: 거의 동시에 양방향 통화 시도)는 검증되지 않았다.
- **시그널 payload 스키마 비표준화** — `offer`/`answer`는 `{ sdp, from_handle, callId }`, `ice`는 `{ candidate, callId }`, 종료 신호는 `{ bye: true }`로 타입마다 구조가 제각각이다. 새 시그널 타입을 추가할 때마다 양쪽(발신 파싱/수신 파싱)을 따로 맞춰야 하는 구조라, C-5와 같은 종류의 파싱 불일치가 다시 발생할 위험이 있다. 모든 타입에 공통 봉투(`{ callId, type, data }`)를 두는 구조로 정리하는 게 장기적으로 안전하다.

---

### C-12. 진단 방법론에 대한 교훈

이번 디버깅에서 가장 비효율적이었던 구간은 "브라우저 콘솔 캡처 → 분석 → 다음 지시 → 다시 캡처"를 반복한 단계였다. GUID 불일치, 공개키 문제, TTL 만료, 엣지 캐싱 등 여러 가설을 순서대로 세우고 화면 캡처로 하나씩 검증했지만, 매번 다음 가설로 넘어갈 때마다 또 다른 변수(스크롤 위치, 콘솔 필터, 시간 경과로 인한 TTL 만료)가 끼어들어 결론이 계속 미뤄졌다.

전환점은 화면 캡처를 그만두고, PowerShell로 **워커를 거치지 않고 PocketBase REST API에 직접 질의**한 순간이었다. 발신 직후 수신측 guid로 직접 조회했을 때 데이터가 보이는지 여부 하나로, "클라이언트 코드 문제"와 "서버/저장소 문제"가 즉시 갈렸다. 이후 정렬 순서를 의심하고 같은 방식으로 검증하는 데도 1분이 채 걸리지 않았다.

**교훈:** 클라이언트에서 관찰되는 증상이 여러 가설을 동시에 설명할 수 있을 때(이번처럼), 클라이언트 쪽 변수를 하나씩 통제하며 화면을 다시 캡처하는 방식은 매 시도마다 새로운 잡음(스크롤, 필터, 타이밍)이 끼어들 여지를 남긴다. 가능하다면 **백엔드 저장소에 직접, 클라이언트와 무관한 방법으로 질의**하는 쪽이 훨씬 적은 단계로 가설을 좁힌다. PowerShell의 `Invoke-RestMethod`처럼 가벼운 도구 하나면 충분하다.

---

### C-13. 향후 과제

- **표준 P2P 프로필 교환 절차와의 정합성** — 부록 B(B-6)에서 이미 지적된 대로, 현재 채팅 연결의 시그널링 인프라는 완성돼 있으나 `profile_request` 같은 새 메시지 타입이 없어 사용자 검색이 여전히 Supabase 직접 조회로 대체되고 있다. WebRTC 채널이 안정화된 지금이 이 격차를 메울 적절한 시점이다.
- **다중 기기 키 동기화와 메시징의 교차 영향** — 부록 A(A-1)에서 지적된 "기기마다 다른 Ed25519 키" 문제는 현재 채팅 연결 자체에는 영향이 없지만(연결은 GUID 기준), 향후 메시지에 종단간 암호화나 서명을 추가하면 동일한 구조적 한계가 메시징 시스템에도 그대로 전이된다. 그 작업을 시작하기 전에 A-1의 해결(백업 내보내기/가져오기 절차)이 선행돼야 한다.
- **TURN 트래픽 비용 모니터링** — 자체 호스팅 coturn은 무료지만 Oracle VM의 아웃바운드 트래픽 한도 안에서 운영되고 있다. 제주 파일럿 규모가 커지면 TURN 중계 트래픽이 늘어날 수 있으므로, 사용량을 별도로 측정하는 절차가 필요하다.
