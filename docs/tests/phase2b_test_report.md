# Phase 2B 테스트 보고서

**작성일:** 2026-05-22  
**Phase:** 2B — OpenHash 레이어  
**결과:** ✅ 13/13 통과 (버그 1건 발생 → 즉시 수정)

---

## 테스트 결과

| ID | 설명 | 결과 |
|----|------|------|
| O-01 | PLSM 10만 회 χ² 검정 (BUG-002 수정 후) — χ²=1.161 | ✅ PASS |
| O-02 | Hash Chain 앵커링 + prevHash 체인 연결 | ✅ PASS |
| O-03 | Merkle Root 생성 + Proof 생성·검증 + 위변조 탐지 | ✅ PASS |
| O-04 | BIVM Σδ≠0 → BIVM_SET_VIOLATION | ✅ PASS |
| O-05 | BIVM BMI 위변조 3/3 탐지 | ✅ PASS |
| O-06 | BIVM 정상 거래 쌍 검증 | ✅ PASS |
| O-07 | LPBFT 비상 조건 발동 + RECOVERY 상태 전이 | ✅ PASS |
| O-08 | LPBFT 4조건 충족 → NORMAL 복귀 | ✅ PASS |
| O-09 | 중요도 점수 → 경량·표준·강화 모드 선택 | ✅ PASS |
| O-10 | 거래 파이프라인 Stage 1~5 정상 흐름 | ✅ PASS |
| O-11 | Stage 1 잔액 부족 차단 | ✅ PASS |
| O-12 | Stage 5 블랙리스트 차단 | ✅ PASS |
| O-13 | 해시 체인 무결성 검증 | ✅ PASS |

---

## 버그 이력

### BUG-002 (즉시 수정 완료)

| 항목 | 내용 |
|------|------|
| **발생** | O-01 최초 실행 시 χ²=51.97 → 실패 |
| **증상** | PLSM 계층 분포 편향 (L1=61.06% 등 불균일) |
| **원인** | `parseInt(hash.slice(-3), 16) % 1000` — hex 3자리 범위(0~4095) % 1000에서 0~95 구간이 더 자주 나타나는 편향 발생 |
| **조치** | 전체 hex 해시를 BigInt로 변환 후 mod 1000: `Number(BigInt('0x' + hash) % 1000n)` |
| **재확인** | χ²=1.161 (임계 9.488 미만) — 균일 분포 통과 |
| **커밋** | `fix: PLSM BigInt mod 편향 수정 (BUG-002)` |

---

## 알려진 한계

| 항목 | 내용 |
|------|------|
| LPBFT 레이턴시 | 로컬 시뮬 3.5ms — 목표 0.759ms는 실제 분산 환경에서 측정 필요 (Phase 4 네트워크 연동 후) |
| 강화 모드 zk-SNARKs | `pending` 상태 — Phase 5에서 실제 구현 예정 |
| Stage 4 Isolation Forest | 경고만 발생, 실제 모델 미적용 — Phase 5 |
| 노드 제출 | dev 환경에서 로컬 성공 처리 — prod 노드 연동은 Phase 4 |
| Merkle Root 메인넷 기록 | TODO 상태 — Phase 4 완료 후 연동 |

---

## 구현된 파일

| 파일 | 역할 |
|------|------|
| `src/openhash/plsm.js` | 이중 SHA-256 → BigInt mod 1000 → 5계층 선택 |
| `src/openhash/hashChain.js` | 앵커링 + Merkle 배치 + 무결성 검증 |
| `src/openhash/bivm.js` | Σδ=0 집합 불변성 + BMI 개별 검증 |
| `src/openhash/ilmv.js` | 하향 감사 6항목 + 상향 모니터링 6임계값 + 교차 검증 |
| `src/openhash/lpbft.js` | 5개 비상 조건 발동 + 4개 비활성화 조건 복귀 |
| `src/openhash/importanceVerifier.js` | 중요도 점수 → 경량·표준·강화 모드 |
| `src/openhash/transactionPipeline.js` | Stage 1~5 거래 파이프라인 |

---

## Phase 2C 진행 전제 조건

- [x] O-01~O-13 전체 통과
- [x] BUG-002 수정 완료
- [x] GitHub 태그: `phase2b-complete`
