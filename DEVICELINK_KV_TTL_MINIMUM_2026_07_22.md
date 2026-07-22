# device-link 승인이 매번 "Failed to fetch"로 끝나던 진짜 원인 (2026-07-22)

push 알림이 정상 도착하고, PC 코드 확인(`verify`)까지 성공한 뒤에도
마지막 단계(`deliver` — 암호화된 지갑 봉투 전달)가 재시도해도 매번
100% "Failed to fetch"로 실패하던 문제를 `wrangler tail`로 실측하고
수정한 기록입니다. 오늘 하루 있었던 모든 device-link 관련 수정
(push 구독, GWP 라우팅 등) 이후에도 이 한 가지만 남아있었습니다.

## 1. 원인

`wrangler tail`로 실시간 로그를 보며 재현하자 정확한 예외가 잡혔습니다:

```
POST .../auth/device-link/deliver - Exception Thrown
✘ [ERROR] Error: KV PUT failed: 400 Invalid expiration_ttl of 30.
  Expiration TTL must be at least 60.
    at async handleDeviceLinkDeliver (worker.js:1598:3)
```

`handleDeviceLinkDeliver()`가 전달 완료된 세션 레코드를 `expirationTtl:
30`(초)으로 KV에 다시 쓰려 했는데, **Cloudflare Workers KV는 60초 미만
TTL을 아예 거부합니다.** KV PUT이 400으로 예외를 던졌고, 이 처리되지
않은 예외가 `deliver` 핸들러 전체를 깨뜨려 정상적인 HTTP 응답(+CORS
헤더)이 나가지 못했습니다. 브라우저 쪽에서는 이게 응답 없는 네트워크
레벨 실패, 즉 "Failed to fetch"로만 보였습니다.

이전까지는 이걸 "그 순간의 일시적 연결 끊김"으로 추정하고 재시도
횟수·간격만 늘렸는데(§3회→5회 강화, "전달 다시 시도" 버튼 추가 등),
실제로는 **네트워크와 전혀 무관한, 매번 100% 확정적으로 재현되는 서버
버그**였습니다. 재시도를 아무리 강화해도 근본적으로 성공할 수 없는
구조였던 것입니다.

## 2. 수정

`expirationTtl`을 30 → 60(KV 최소 허용값)으로 변경했습니다.

## 3. 교훈

"Failed to fetch"는 브라우저 콘솔만 봐서는 원인을 특정할 수 없는
대표적인 에러입니다 — CORS 차단, 실제 네트워크 끊김, 서버가 예외로
죽어 응답 자체가 안 나간 경우가 전부 클라이언트에는 똑같이 보입니다.
이번처럼 **서버 쪽 실시간 로그(`wrangler tail`)를 함께 보는 것**이
클라이언트 재시도 로직을 아무리 정교하게 만드는 것보다 원인 규명에
훨씬 빨랐습니다. 재시도/타임아웃을 강화하기 전에, 가능하면 먼저 서버
로그로 "진짜 네트워크 문제가 맞는지"부터 확인하는 편이 낫습니다.
