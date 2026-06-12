# T06 테스트 보고서
**테스트명**: IndexedDB hash_chain 무결성 — `verifyChain()` 자기완결 검증  
**실행일**: 2026-06-12  
**기준 문서**: PDV-HASHCHAIN-DESIGN-v3.0-FINAL §9.1 · handover_v4.md  
**결과**: ✅ 합격

---

## 1. 구현 완료 목록

| 모듈 | 작업 | 파일 | 상태 |
|------|------|------|------|
| Module 3 (A-3) | `verifyChain()` — `prev_local_hash` 연속성 확인 + `SHA-256(h_{i-1}∥tx_hash∥block_hash∥height)` 해시 재계산 검증 추가, `reason: 'chain_break'` / `reason: 'hash_mismatch'` 구분 반환 | gopang-wallet.js | ✅ |

---

## 2. 검증 결과

### 2.1 배포 확인

```javascript
window.gopangWallet.verifyChain.toString().includes('hash_mismatch')
// true
```

### 2.2 T06 합격 기준 실행

```javascript
window.gopangWallet.verifyChain().then(r => console.log(r));
// { valid: true, broken_at: null }
```

| 항목 | 기대값 | 실제값 | 상태 |
|------|--------|--------|------|
| `valid` | `true` | `true` | ✅ |
| `broken_at` | `null` | `null` | ✅ |

### 2.3 검증 대상 체인

IDB `hash_chain` height 0~5 (총 6개 레코드) 전체 통과.

| height | 비고 |
|--------|------|
| 0~3 | v3.0 이전 거래 — `pdv_session_id: null` |
| 4~5 | v3.0 거래 — `pdv_session_id` 정상 |

---

## 3. verifyChain() 검증 로직

```
for i = 1 → chain.length - 1:
  1) prev_local_hash 연속성:
     chain[i].prev_local_hash === chain[i-1].local_hash
     → 실패 시 { valid: false, broken_at: height, reason: 'chain_break' }

  2) 해시 재계산:
     recomputed = SHA-256(chain[i-1].local_hash
                        ∥ chain[i].tx_hash
                        ∥ chain[i].block_hash
                        ∥ String(chain[i].height))
     recomputed === chain[i].local_hash
     → 실패 시 { valid: false, broken_at: height, reason: 'hash_mismatch' }

통과 시: { valid: true, broken_at: null }
```

---

## 4. 트러블슈팅

| # | 증상 | 원인 | 해결 |
|---|------|------|------|
| T1 | `verifyChain()` 결과 `undefined` | GitHub Pages 캐시로 구버전 코드 서빙 | `git commit --allow-empty` 강제 재배포 + `Ctrl+Shift+R` |

---

## 5. 미결 항목 (다음 단계)

| 항목 | 모듈 | 테스트 |
|------|------|--------|
| Worker `/biz/order` → `l1_ledger` `user_hash`/`node_hash`/`balance_claimed` 기록 | Module 5.5 | T05 최종 / T07 |
| `verifyOutputConsistency()` + `verifyDeltaZero()` Worker 삽입 | Module 5.5 | T07 |
| `reconstruct_balances()` + K-Tax Views 생성 | Module 7 | T07 |

---

*T06_report.md*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*gopang v0.4.0 · PDV-HASHCHAIN-DESIGN-v3.0-FINAL*
