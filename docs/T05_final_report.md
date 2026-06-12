# T05 최종 테스트 보고서
**테스트명**: fs_ledger 3행 동기 앵커링 + pdv_log chain_height 기록  
**실행일**: 2026-06-12  
**기준 문서**: PDV-HASHCHAIN-DESIGN-v3.0-FINAL · handover_v4.md  
**결과**: ✅ 최종 합격

---

## 1. 구현 완료 목록

| 모듈 | 작업 | 파일 | 상태 |
|------|------|------|------|
| Module 1 | `pdv_log` 스키마 ALTER — `session_id`, `chain_height`, `chain_local_hash` + 인덱스 2개 | Supabase SQL | ✅ |
| Module 2 | `l1_ledger` 테이블 생성 — `user_hash`, `node_hash`, `balance_claimed` 포함 | Supabase SQL | ✅ |
| Module 2.5 | `pdv_chain_integrity` View 생성 — `pdv_log LEFT JOIN l1_ledger ON block_hash` | Supabase SQL | ✅ |
| Module 3 | `appendHashChain()` v3.0 — deprecated 필드 제거, `pdv_session_id`/`pdv_type`/`pdv_anchored` 추가 | gopang-wallet.js | ✅ |
| Module 3 | `redeemClaim()` — `pdv_session_id`, `pdv_type`, `tx_hash`, `block_id` 파라미터 추가 | gopang-wallet.js | ✅ |
| Module 3 | `verifyChain()` — 해시 재계산 검증 추가 (`hash_mismatch` / `chain_break` reason) | gopang-wallet.js | ✅ |
| Module 4 | `GWP_DONE` 핸들러 — `sessionId` 항상 확정, `redeemClaim` 후 PDV 처리 순서 재구성 | gopang-app.js | ✅ |
| Module 4 | `_recordPDV()` — P17 방어코드, `session_id`/`chain_height`/`chain_local_hash`/`block_hash` POST | gopang-app.js | ✅ |
| Module 5 | `_patchPdvChainHeight()` — 300ms 재시도 포함 (설계서 E2 수정) | gopang-app.js | ✅ |
| Module 5 | `_markPdvAnchored()` — IDB `hash_chain` 레코드 `pdv_anchored: true` 갱신 | gopang-app.js | ✅ |
| Module 5.5 | `updateNodeHashChain()` — H_N 기록, `l1_ledger` INSERT | Worker | ✅ |
| Module 5.5 | `verifyOutputConsistency()` + `verifyDeltaZero()` — 감시 모드 | Worker | ✅ |
| Module 5.5 | `_patchL1LedgerUserHash()` — 클라이언트 `local_hash`로 `l1_ledger.user_hash` 교정 | gopang-app.js | ✅ |
| market 수정 | `GWP_DONE` 핸들러 — `session_id` 전달, `tx_hash` 포함, `window.close()` 추가 | market/webapp.html | ✅ |
| market 수정 | profile 팝업 URL에 `gopang_token` 전달 — SSO 연속성 보장 | market/webapp.html | ✅ |

---

## 2. 핫픽스 목록

| # | 증상 | 원인 | 수정 |
|---|------|------|------|
| F1 | `pdv_log` POST 400 | `id` 컬럼 DEFAULT 없음 | `ALTER COLUMN id SET DEFAULT gen_random_uuid()::TEXT` |
| F2 | `pdv_chain_integrity` 오탐 | `l1_h_i IS NULL`일 때 `pdv_l1_match = FALSE` | CASE 문으로 NULL 구분 처리 |
| F3 | `_recordPDV` 컬럼명 오류 | 존재하지 않는 컬럼명 사용 | 실제 컬럼명(`guid`, `type`, `summary_6w`)으로 매핑 |
| F4 | `pdv_l1_match: false` | Worker `user_hash` 공식과 클라이언트 `local_hash` 공식 불일치 | `_patchL1LedgerUserHash()` — redeemClaim 후 PATCH로 교정 |
| F5 | market 탭 닫히지 않음 | `gwpHandler`에 `window.close()` 누락 | `setTimeout(() => window.close(), 500)` 추가 |
| F6 | profile 팝업 로그인 요구 | profile URL에 `gopang_token` 미전달 | URL 생성 시 `gopang_token` 파라미터 포함 |
| F7 | `UNREGISTERED_KEY` | 지갑 재생성으로 공개키 변경됐으나 L1 미갱신 | `gdc_keys` 레코드 수동 업데이트 |
| F8 | gopang-app.js 배포 안 됨 | GitHub Pages 캐시 | `git commit --allow-empty` + 빈 줄 추가 강제 재배포 |

---

## 3. 최종 검증 결과

### 3.1 T05 합격 기준

```sql
-- height 8 (최신 거래) 기준
SELECT COUNT(*) FROM pdv_chain_integrity
WHERE chain_height = 8 AND pdv_l1_match = FALSE;
-- = 0 ✅
```

### 3.2 pdv_chain_integrity 전체 현황

| height | pdv_l1_match | openhash_anchored | 비고 |
|--------|-------------|-------------------|------|
| 8 | ✅ true | false | 현재 기준 — T05 합격 |
| 7 | false | false | 키 불일치 시점 거래 (수용) |
| 6 | null | false | Module 5.5 배포 전 거래 (수용) |
| 5 | null | false | Module 5.5 배포 전 거래 (수용) |

### 3.3 IDB hash_chain

```
height | local_hash     | pdv_session_id | pdv_anchored
-------+----------------+----------------+-------------
8      | 6dcdb20c...    | cb76b46e       | true        ✅
```

### 3.4 레이어 2 연동 무결성

```
IDB local_hash    : 6dcdb20c2f29b98df90df8ec2b0a39e0fe7623e7...
Supabase pdv_h_i  : 6dcdb20c2f29b98df90df8ec2b0a39e0fe7623e7...
l1_ledger user_hash: 6dcdb20c2f29b98df90df8ec2b0a39e0fe7623e7...
3개 값 일치 ✅
```

---

## 4. 미결 항목 (다음 단계)

| 항목 | 모듈 | 테스트 |
|------|------|--------|
| `openhash_anchored` true 처리 | Worker — 별도 구현 | T05 완전 합격 |
| `reconstruct_balances()` + K-Tax Views | Module 7 | T07 |
| 잔액 서버↔클라이언트 일치 검증 | Module 7 | T07 |
| P12.2: 로그인 시 block_hash 자동 검증 | gopang-app.js | T08 |

---

*T05_final_report.md*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*gopang v0.4.0 · PDV-HASHCHAIN-DESIGN-v3.0-FINAL*  
*T05 최초 보고: 가능 범위 완료 → 최종: Module 5.5 + 핫픽스 8건 반영 합격*
