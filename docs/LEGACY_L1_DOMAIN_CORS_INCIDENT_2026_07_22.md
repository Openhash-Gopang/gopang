# 등록 화면 "네트워크 오류" — 폐기된 구 브랜드 도메인이 남아있던 문제 (2026-07-22)

가입/로그인 화면에서 "네트워크 오류. 다시 시도해 주세요"가 뜨는 문제를
조사·수정한 기록입니다.

## 1. 증상

콘솔에 반복적으로 다음이 찍힘:

- `Access to fetch at 'https://l1-hanlim.gopang.net/api/realtime' from
  origin 'https://hondi.net' has been blocked by CORS policy`
- `l1-hanlim.gopang.net`에 대한 다수의 `503`

이미 `profiles` 컬렉션에 정상 등록된 계정(handle 존재 확인됨)인데도
프로필 조회 자체가 계속 실패했습니다.

## 2. 원인

`src/gopang/core/state.js`의 L1 관련 상수 5개(`L1_URL`,
`L1_SIGNAL_BASE`, `L1_PDV_URL`, `L1_ANCHOR_URL`,
`L1_P2P_INVITES_URL`)와 `src/gopang/ui/p2p-chat.js`의 `_L1_BASE`가
전부 **폐기된 구 브랜드 도메인 `l1-hanlim.gopang.net`**을 가리키고
있었습니다(주피터 확인: 더 이상 사용하지 않는 레거시 도메인).

저장소 전체를 훑어보면 `worker.js`, `webrtc-realtime.js`,
`gov-data-resolve-log.js`, 테스트 파일들은 전부 이미
`l1-hanlim.hondi.net`을 쓰고 있었고, 클라이언트에서 L1을 직접 호출하는
이 두 파일만 브랜드 전환(gopang → hondi) 당시 안 바뀌고 남아 있었던
것으로 보입니다. 그 결과 이 옛 도메인의 PocketBase는 `hondi.net`
오리진을 CORS로 허용하지 않는 상태였고, 반복되는 실패한 realtime
재연결 시도가 서버에 부하를 줘 503까지 유발한 것으로 추정됩니다.

## 3. 수정

`state.js`, `p2p-chat.js`의 `l1-hanlim.gopang.net`을
`l1-hanlim.hondi.net`으로 전체 치환했습니다.

## 4. 남는 과제

`l1-hanlim.gopang.net`이 실제로 완전히 방치된 도메인인지, 아니면
누군가 여전히 참조하고 있는지 서버 쪽(DNS/CORS 설정)까지는 이번에
확인하지 못했습니다. 코드에서의 참조는 이번 수정으로 전부 제거됐지만,
혹시 다른 저장소(K-서비스 18개 등)에도 같은 구 도메인이 남아있는지는
별도로 훑어볼 필요가 있습니다.
