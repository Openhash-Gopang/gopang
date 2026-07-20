/**
 * @file bivm.js
 * @description BIVM — 잔액 불변성 검증 모듈 (Balance Invariant Verification Module)
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: OpenHash SCI 논문 §4.2 (C2 기여)
 *   - 집합 잔액 불변성 (Σδ_k = 0): 합계 보전 검증
 *   - 잔액 매핑 무결성 (BMI): 총량 보존을 위장한 내부 위변조 탐지
 *   - 위변조 탐지 정리 형식 증명: 논문 부록 A
 */

import { BIVM as BIVM_CONST } from '../core/constants.js'
import { buildMerkleRoot } from './hashChain.js'
import { sha256 } from '../pdv/keyManager.js'

// ── 타입 정의 ────────────────────────────────────────────────────────────
/**
 * @typedef {Object} Transaction
 * @property {string} id         - 거래 식별자
 * @property {string} from       - 발신 계정
 * @property {string} to         - 수신 계정
 * @property {number} amount     - 거래 금액 (양수)
 * @property {number} delta      - 잔액 변동 (발신: -amount, 수신: +amount)
 * @property {number} balanceBefore - 거래 전 발신 계정 잔액
 * @property {number} balanceAfter  - 거래 후 발신 계정 잔액
 */

// ── 집합 잔액 불변성 (Σδ_k = 0) ──────────────────────────────────────────

/**
 * 거래 목록의 집합 잔액 불변성 검증
 * 모든 delta 합계가 0이어야 함 (발신 -amount + 수신 +amount = 0)
 *
 * @param {Transaction[]} transactions
 * @throws {Error} BIVM_SET_VIOLATION
 * @returns {true}
 */
export function verifySetInvariant(transactions) {
  if (!Array.isArray(transactions) || transactions.length === 0) {
    throw new Error('[BIVM] 거래 목록이 비어있음')
  }

  const delta = transactions.reduce((sum, tx) => {
    if (typeof tx.delta !== 'number') {
      throw new Error(`[BIVM] 거래 ${tx.id}: delta가 숫자가 아님`)
    }
    return sum + tx.delta
  }, 0)

  if (Math.abs(delta) > BIVM_CONST.EPSILON) {
    throw new Error(
      `[BIVM] BIVM_SET_VIOLATION: Σδ = ${delta.toFixed(10)} (허용: ±${BIVM_CONST.EPSILON})`
    )
  }

  return true
}

// ── 잔액 매핑 무결성 (BMI) ───────────────────────────────────────────────

/**
 * 개별 잔액 매핑 무결성 검증
 * balanceBefore + delta = balanceAfter 를 각 거래마다 확인
 * → 총량 보존을 위장한 내부 자금 이전 위변조 탐지 (논문 신규 기여)
 *
 * @param {Transaction[]} transactions
 * @throws {Error} BIVM_BMI_VIOLATION
 * @returns {true}
 */
export function verifyBMI(transactions) {
  for (const tx of transactions) {
    const computed = tx.balanceBefore + tx.delta

    if (Math.abs(computed - tx.balanceAfter) > BIVM_CONST.EPSILON) {
      throw new Error(
        `[BIVM] BIVM_BMI_VIOLATION: 거래 ${tx.id} — ` +
        `balanceBefore(${tx.balanceBefore}) + delta(${tx.delta}) = ${computed}, ` +
        `balanceAfter(${tx.balanceAfter}) 불일치`
      )
    }

    if (tx.balanceAfter < 0) {
      throw new Error(
        `[BIVM] BIVM_BMI_VIOLATION: 거래 ${tx.id} — 잔액 음수 불가 (${tx.balanceAfter})`
      )
    }

    if (tx.amount <= 0) {
      throw new Error(
        `[BIVM] BIVM_BMI_VIOLATION: 거래 ${tx.id} — 거래 금액은 양수여야 함 (${tx.amount})`
      )
    }
  }

  return true
}

/**
 * 집합 불변성 + BMI 통합 검증 (일반 호출용)
 * @param {Transaction[]} transactions
 * @returns {{ setValid: boolean, bmiValid: boolean, errors: string[] }}
 */
export function verify(transactions) {
  const errors = []
  let setValid = false
  let bmiValid = false

  try {
    verifySetInvariant(transactions)
    setValid = true
  } catch (e) {
    errors.push(e.message)
  }

  try {
    verifyBMI(transactions)
    bmiValid = true
  } catch (e) {
    errors.push(e.message)
  }

  return { setValid, bmiValid, valid: setValid && bmiValid, errors }
}

// ── 거래 객체 생성 헬퍼 ──────────────────────────────────────────────────

/**
 * 거래 쌍 생성 (발신 + 수신 delta 쌍)
 * @param {string} id
 * @param {string} from
 * @param {string} to
 * @param {number} amount
 * @param {number} fromBalance - 발신 계정 현재 잔액
 * @param {number} toBalance   - 수신 계정 현재 잔액
 * @returns {Transaction[]} [발신 TX, 수신 TX]
 */
export function createTxPair(id, from, to, amount, fromBalance, toBalance) {
  return [
    {
      id:            `${id}-out`,
      from, to,
      amount,
      delta:         -amount,
      balanceBefore: fromBalance,
      balanceAfter:  fromBalance - amount,
    },
    {
      id:            `${id}-in`,
      from, to,
      amount,
      delta:         +amount,
      balanceBefore: toBalance,
      balanceAfter:  toBalance + amount,
    },
  ]
}

// ── 계층 간 잔액 매핑 무결성 (BMI Merkle 루트) ──────────────────────────
// [2026-07 통합 추가]
// 근거: 논문 §4.2.2 BMI_k(T) = MerkleRoot({ balance_u(T) : u ∈ tier_k })
//
// 기존 verifyBMI()는 "거래 1건의 산술(balanceBefore+delta=balanceAfter)"만
// 확인한다 — 이는 논문이 막으려던 "계층 간 무단 재배분 위변조"(계정 A→B로
// 은밀히 재배분하면서 양쪽 balanceBefore/After를 함께 조작하는 경우)는
// 탐지하지 못한다. 아래 두 함수가 논문이 말하는 실제 BMI 메커니즘 —
// 계층 소속 전체 계정의 잔액 스냅샷에 대한 Merkle 루트를 계산해 상위
// 계층이 보유한 값과 대조하는 방식 — 을 채운다.
//
// Merkle 트리 계산은 신규 구현하지 않고 hashChain.js의 buildMerkleRoot()를
// 그대로 재사용한다(통합 원칙: 같은 암호 연산을 두 곳에 두지 않는다).

/**
 * tier_k 소속 전체 계정의 잔액 스냅샷으로 BMI Merkle 루트를 계산한다.
 * @param {Array<{guid: string, balance: number}>} tierBalances - tier_k 소속 전체 계정
 * @returns {Promise<string>} Merkle 루트 해시(hex)
 * @throws {Error} tierBalances가 비어있으면 buildMerkleRoot가 예외를 던짐
 */
export async function computeBmiRoot(tierBalances) {
  if (!Array.isArray(tierBalances) || tierBalances.length === 0) {
    throw new Error('[BIVM] computeBmiRoot: tierBalances가 비어있음')
  }

  // guid 정렬 — 계산 순서가 달라도 항상 같은 루트가 나오도록(결정론성 보장)
  const sorted = [...tierBalances].sort((a, b) => a.guid.localeCompare(b.guid))
  const leaves = await Promise.all(
    sorted.map(({ guid, balance }) => sha256(`${guid}:${balance}`))
  )
  return buildMerkleRoot(leaves)
}

/**
 * 상위 계층이 이전 루트에 "합법적 거래만" 반영해 재계산한 값(recomputedRoot)과
 * 하위 계층이 보고한 루트(reportedRoot)를 대조한다.
 * 불일치 시 무단 잔액 변경(위변조)으로 판정 — 호출자가 LPBFT 발동 여부를 결정한다.
 *
 * @param {string} reportedRoot   - 하위 계층이 보고한 BMI 루트
 * @param {string} recomputedRoot - 상위 계층이 독립적으로 재계산한 BMI 루트
 * @returns {boolean} true면 일치(정상), false면 불일치(위변조 의심)
 */
export function verifyBmiRoot(reportedRoot, recomputedRoot) {
  return reportedRoot === recomputedRoot
}
