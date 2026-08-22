# 제안(피드백) 공개/비공개 + 투표 기능 — 배포 전 필수 작업

이 기능은 코드 배포만으로는 동작하지 않습니다. **PocketBase(L1) 스키마 변경이 먼저 필요**합니다.
`docs/` 안내에 따라 GitHub Actions 마이그레이션 파이프라인을 통해 반영해주세요 (직접 프로덕션 PocketBase 관리자 UI에서 임시로 손대지 말 것 — 노드 크래시 루프 재발 이력 있음).

## 1. `feedback` 컬렉션에 필드 2개 추가

| 필드명 | 타입 | 옵션 | 기본값 |
|---|---|---|---|
| `visibility` | select | `public`, `private` | `public` |
| `vote_count` | number | — | `0` |

기존 레코드는 마이그레이션 시 `visibility='public'`, `vote_count=0`으로 일괄 채워야 기존 데이터와 호환됩니다(하위호환 목적으로 백엔드 코드도 `visibility` 누락 시 `public`으로 처리하도록 작성했습니다).

## 2. 신규 컬렉션 `feedback_votes` 생성

| 필드명 | 타입 | 옵션 |
|---|---|---|
| `feedback_id` | text | — |
| `voter_guid` | text | — |

**`(feedback_id, voter_guid)` 조합에 UNIQUE 인덱스 필수.** 이게 1인 1표를 보장하는 최종 방어선입니다. 백엔드 코드(`handleFeedbackVote`)는 사전 조회로 중복 여부를 먼저 확인하지만, 동시 요청(같은 사람이 두 번 빠르게 클릭) 상황에서는 이 유니크 인덱스가 없으면 중복 지급이 발생할 수 있습니다.

## 3. 확인된 사항

- **GDC 보상**: 투표 1회당 100 GDC. 베타 기간 환율(`EXCHANGE_RATE_KRW_PER_GDC = 1`, worker.js 1212행)을 그대로 사용하므로 `krw_amount: 100`으로 `/api/mint`를 호출합니다. 정식 환율로 복귀하면 코드 수정 없이 자동으로 그 환율을 따릅니다.
- **비공개 열람 범위**: 작성자 본인 + 관리자만. `GET /feedback`에 `requester_guid`(본인 guid) 또는 `is_admin=1`을 함께 보내야 비공개 글이 섞여 나옵니다.
- **자기 투표 금지**: 본인 제안에는 투표 버튼이 비활성화됩니다(서버에서도 `SELF_VOTE_FORBIDDEN`으로 재차 차단).

## 4. 배포 순서

1. 이 문서의 스키마 변경을 먼저 마이그레이션 파이프라인으로 반영
2. `feedback.html`, `worker.js` 배포
3. 배포 후 기존 제안 목록이 정상적으로 뜨는지, 새 글쓰기·투표가 정상 동작하는지 스모크 테스트
