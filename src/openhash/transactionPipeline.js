/**
 * @file transactionPipeline.js
 * @description Stage 1~5 거래 처리 파이프라인
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: OpenHash SCI 논문 §4.4
 *   Stage 1: 잔액 확인
 *   Stage 2: 신원 검증 (Ed25519)
 *   Stage 3: 한도 확인 (단일·일일 누적)
 *   Stage 4: 이상 탐지 (Isolation Forest — 시간당 ≥10건 트리거)
 *   Stage 5: 규제 준수 (블랙리스트·국제 제재)
 */

import { verifySignature } from '../pdv/keyManager.js'
import { verify as bivmVerify, createTxPair } from './bivm.js'
import { calculateImportanceScore, selectMode, verify as importanceVerify } from './importanceVerifier.js'

// ── 한도 설정 ─────────────────────────────────────────────────────────────
const LIMITS = Object.freeze({
  SINGLE_TX_MAX:  1_000_000_000,   // 단일 거래 최대 10억 GDC
  DAILY_MAX:      10_000_000_000,  // 일일 누적 최대 100억 GDC
  ANOMALY_WINDOW: 3600,            // 이상 탐지 윈도우 (초)
  ANOMALY_COUNT:  10,              // 시간당 ≥10건 → Isolation Forest 트리거
})

// 일일 누적 추적 (메모리, 재시작 시 초기화됨)
const _dailyAccum = new Map()   // accountId → { amount, date }
const _recentTx   = new Map()   // accountId → [timestamp, ...]

// ── 메인 파이프라인 ───────────────────────────────────────────────────────

/**
 * 거래 처리 파이프라인 (Stage 1~5 순차 실행)
 * @param {Object} tx
 * @param {string} tx.id
 * @param {string} tx.from
 * @param {string} tx.to
 * @param {number} tx.amount
 * @param {number} tx.fromBalance
 * @param {number} tx.toBalance
 * @param {string} tx.signature       - 발신자 서명 (Base64)
 * @param {string} tx.senderPubKeyB64 - 발신자 공개키
 * @param {string} tx.type            - 'message'|'financial'|'legal'|'government'
 * @param {boolean} tx.crossBorder
 * @returns {Promise<{ success: boolean, stage: number, error: string|null, mode: string }>}
 */
export async function processTx(tx) {
  try {
    await stage1_balanceCheck(tx)
    await stage2_identityVerify(tx)
    await stage3_limitCheck(tx)
    await stage4_anomalyDetect(tx)
    await stage5_complianceCheck(tx)

    // 중요도 기반 적응형 검증 (Phase 3: 논문 §4.1 공식)
    // tx.assetType/contractType 없으면 기본값(stable/instant) 폴백
    const score = calculateImportanceScore(tx)
    const mode  = selectMode(score)
    await importanceVerify(tx, mode)

    // BIVM 검증 (Phase 4: 논문 §4.2)
    // toBalance가 있는 경우만 실행 — 상대방 잔액은 서버(worker.js)만 알 수 있음
    // 클라이언트 단독 호출 시 toBalance 없으면 건너뜀 (프라이버시 원칙)
    if (tx.toBalance !== undefined && tx.toBalance !== null) {
      const txPair = createTxPair(tx.id, tx.from, tx.to, tx.amount, tx.fromBalance, tx.toBalance)
      await bivmVerify(txPair)
    }

    // 일일 누적 업데이트
    _updateDailyAccum(tx.from, tx.amount)
    _updateRecentTx(tx.from)

    return { success: true, stage: 5, error: null, mode, score }

  } catch (err) {
    const stage = err._stage ?? 0
    return { success: false, stage, error: err.message, mode: null }
  }
}

// ── Stage 1: 잔액 확인 ───────────────────────────────────────────────────
export async function stage1_balanceCheck(tx) {
  if (tx.fromBalance < tx.amount) {
    const e = new Error(
      `[Stage1] 잔액 부족: 보유 ${tx.fromBalance}, 필요 ${tx.amount}`
    )
    e._stage = 1; throw e
  }
  if (tx.amount <= 0) {
    const e = new Error(`[Stage1] 거래 금액은 양수여야 함: ${tx.amount}`)
    e._stage = 1; throw e
  }
}

// ── Stage 2: 신원 검증 ───────────────────────────────────────────────────
export async function stage2_identityVerify(tx) {
  if (!tx.signature || !tx.senderPubKeyB64) {
    const e = new Error('[Stage2] 서명 또는 공개키 없음')
    e._stage = 2; throw e
  }

  // 서명 대상: id|from|to|amount 조합
  const message = `${tx.id}|${tx.from}|${tx.to}|${tx.amount}`
  const valid   = await verifySignature(message, tx.signature, tx.senderPubKeyB64)

  if (!valid) {
    const e = new Error('[Stage2] 서명 검증 실패 — 신원 확인 불가')
    e._stage = 2; throw e
  }
}

// ── Stage 3: 한도 확인 ───────────────────────────────────────────────────
export async function stage3_limitCheck(tx) {
  if (tx.amount > LIMITS.SINGLE_TX_MAX) {
    const e = new Error(
      `[Stage3] 단일 거래 한도 초과: ${tx.amount} > ${LIMITS.SINGLE_TX_MAX}`
    )
    e._stage = 3; throw e
  }

  const daily = _getDailyAccum(tx.from)
  if (daily + tx.amount > LIMITS.DAILY_MAX) {
    const e = new Error(
      `[Stage3] 일일 누적 한도 초과: 누적 ${daily} + ${tx.amount} > ${LIMITS.DAILY_MAX}`
    )
    e._stage = 3; throw e
  }
}

// ── Stage 4: 이상 탐지 (Isolation Forest 트리거) ─────────────────────────
export async function stage4_anomalyDetect(tx) {
  const recent = _getRecentTxCount(tx.from)

  if (recent >= LIMITS.ANOMALY_COUNT) {
    // Isolation Forest 트리거 (Phase 2B: 기본 구조)
    console.warn(
      `[Stage4] 이상 탐지 트리거: ${tx.from} — 시간당 ${recent}건 (임계: ${LIMITS.ANOMALY_COUNT})`
    )
    // TODO: 실제 Isolation Forest 모델 적용 (Phase 5)
    // 현재: 경고만 발생, 거래는 허용
  }
}

// ── Stage 5: 규제 준수 ───────────────────────────────────────────────────
const _BLACKLIST = new Set()  // 실제: 금감원·국제 제재 목록 연동

export async function stage5_complianceCheck(tx) {
  if (_BLACKLIST.has(tx.from) || _BLACKLIST.has(tx.to)) {
    const e = new Error(
      `[Stage5] 규제 준수 실패: 블랙리스트 계정 (${_BLACKLIST.has(tx.from) ? tx.from : tx.to})`
    )
    e._stage = 5; throw e
  }
}

/** 블랙리스트 추가 (테스트·관리용) */
export function addToBlacklist(accountId) {
  _BLACKLIST.add(accountId)
}

/** 블랙리스트 초기화 (테스트용) */
export function _clearBlacklist() {
  _BLACKLIST.clear()
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────

function _getDailyAccum(accountId) {
  const today  = new Date().toDateString()
  const record = _dailyAccum.get(accountId)
  if (!record || record.date !== today) return 0
  return record.amount
}

function _updateDailyAccum(accountId, amount) {
  const today  = new Date().toDateString()
  const record = _dailyAccum.get(accountId)
  if (!record || record.date !== today) {
    _dailyAccum.set(accountId, { amount, date: today })
  } else {
    record.amount += amount
  }
}

function _getRecentTxCount(accountId) {
  const now = Date.now() / 1000
  const timestamps = _recentTx.get(accountId) ?? []
  return timestamps.filter(ts => now - ts < LIMITS.ANOMALY_WINDOW).length
}

function _updateRecentTx(accountId) {
  const now = Date.now() / 1000
  const timestamps = (_recentTx.get(accountId) ?? [])
    .filter(ts => now - ts < LIMITS.ANOMALY_WINDOW)
  timestamps.push(now)
  _recentTx.set(accountId, timestamps)
}

/** 테스트용 상태 초기화 */
export function _resetPipeline() {
  _dailyAccum.clear()
  _recentTx.clear()
  _BLACKLIST.clear()
}
