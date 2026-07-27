# 작업기록 2026-07-27 — 프로필 사진저장·결제수단·AC-PA 채널·OSS 피드백 파이프라인

> 이 문서는 **시간순 기록**입니다. "지금 어떻게 동작하는가"는
> [`docs/PROFILE_ASSISTANT_MANUAL_v1_0.md`](./PROFILE_ASSISTANT_MANUAL_v1_0.md)를 보세요.

## 요약

PR #108(`feat/profile-photo-and-image-scan`) 한 브랜치에 하루 종일 누적된
작업. profile-assistant(PA)를 "한 번 완성되면 끝"에서 "AC가 지속적으로
갱신을 제안하는" 시스템으로 확장하는 과정에서, PA가 실제로 실행되는
탭(`pages/profile-assistant.html`)이 2026-07-11 탭 분리 이후 여러
메커니즘의 배선을 놓치고 있었다는 걸 반복적으로 발견·수정했다.

## 순서대로

1. **schema_id 검증 게이트 결함** — `industry_fields`가 non-null이면
   무조건 `schema_id`를 요구하던 게이트가, STEP3B(예약)가 모든 사업자에
   무조건 적용되면서 "업종 특정 불가" 케이스를 전부 400으로 막고 있었음.
   게이트를 `schema_id` 존재 여부로 좁혀 수정.
2. **프로필 사진 저장·갤러리** — R2 신설, `/profile/photo-upload`,
   아바타+갤러리 렌더링. §IMAGE-SCAN을 "이용약관·안전수칙" 문서까지
   처리하도록 확장(`industry_fields.notice_text`).
3. **계좌 이체 결제 원칙 신설(STEP3A)** — 업종별 나열이 아니라 "모든
   사업자 공통" 원칙으로.
4. **§DIGITAL-BRIDGE + HONDI-CAPABILITIES-COMMON** — 아날로그→디지털
   전환 창의적 제안 원칙 신설. 이 과정에서 `[TEMPLATE_LOOKUP]` 태그가
   PA 탭에서 완전히 미작동 상태였음을 발견(2026-07-17 태그 개편 이후
   방치)하고 재배선.
5. **§PROFILE-UPDATE-MODE** — 완성된 프로필 재호출 시 기존 값(계좌·
   사진·예약 설정 등)이 유실되지 않도록 클라이언트(서버 기존값 fetch)
   +서버(is_public/finance 보존 안전망) 이중 방어.
6. **AC-PA 실시간 채널** — `GWP_PROGRESS`(진행상황 실시간 반영),
   완료 시 6하원칙 보고를 AC의 실제 history에 주입.
7. **AC(AGENT-COMMON) 쪽 발동 조건** — §0-1-P[11] "완성된 프로필의
   지속 갱신 제안" 신설. 병렬 세션이 그 사이 v3.47(Flash 티어, §0-1-P
   [9]/[10])을 먼저 머지해, v3.48로 리베이스.
8. **OSS 기여 파이프라인 완성** — 기존에 설계·부분구현만 돼 있던
   `docs/user_feedback_mechanism_proposal_v1.md`(포착→저장→클러스터링)의
   빠진 마지막 단계(실제 패치 초안 작성)를 `/sp-updates/draft-patch`
   (DeepSeek V4 Flash)로 채움 + 스케줄 CI 신설. 이 과정에서 §4의
   `[FEATURE_SUGGESTION]`이 이 기존 파이프라인과 중복임을 발견해 폐기.
9. **CI 실패 2건 정정**(이번 세션과 무관한 기존 드리프트) —
   `check_expert_table_sync.py`(advisor/civil/professor 누락, 이후
   병렬 PR #110에서 더 잘 처리됨을 확인하고 v3.48 리베이스 시 그쪽으로
   정리) · 터미널 페이저 출력이 실수로 커밋된 파일 제거.
10. **브랜치 정리** — 114개 원격 브랜치 중 main에 완전 병합된 22개 +
    이 세션 자체 중복 브랜치 4개 삭제, 완료된 PR 7개(#98/102/105/107/
    109/110/111) squash 머지.

## 참고

- 관련 PR: #108(메인 작업), #101/#103/#104/#106(중복, close 처리)
- 관련 매뉴얼: [`docs/PROFILE_ASSISTANT_MANUAL_v1_0.md`](./PROFILE_ASSISTANT_MANUAL_v1_0.md)
