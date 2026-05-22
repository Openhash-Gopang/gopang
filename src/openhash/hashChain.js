/**
 * @file hashChain.js
 * @description OpenHash 해시 체인 앵커링 + 1시간 주기 Merkle 배치
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거:
 *   - GDC §2.2: h_i = SHA-256(h_{i-1} ∥ data_i ∥ block_height)
 *   - GDC §14.4: 즉시 앵커링 + 1시간 배치 → Merkle Root → 메인넷 블록
 *   - GAS v1.6 §20.5: 모든 메시지 발송 즉시 OpenHash 등록 (기본 동작)
 */

import { sha256 } from '../pdv/keyManager.js'
import { selectLayer } from './plsm.js'
import { config } from '../core/config.js'

// ── 내부 상태 ────────────────────────────────────────────────────────────

/** 현재 체인의 마지막 해시 (메모리) */
let _prevHash = '0'.repeat(64)

/** 배치 대기 엔트리 목록 */
let _batchQueue = []

/** 배치 타이머 ID */
let _batchTimer = null

/** 체인 엔트리 인메모리 저장소 (Phase 2B: 실제 노드 연동 전 임시) */
const _chainStore = new Map()   // entryHash → entry

// ── 앵커링 ───────────────────────────────────────────────────────────────

/**
 * 메시지를 OpenHash 해시 체인에 앵커링
 *
 * @param {string} content      - 메시지 원문 (해시 대상)
 * @param {string} senderSig    - 발신자 서명 (Base64)
 * @param {string} msgId        - 메시지 식별자
 * @returns {Promise<{
 *   entryHash: string,
 *   msgHash: string,
 *   prevHash: string,
 *   layer: string,
 *   timestamp: string,
 *   blockHeight: number
 * }>}
 */
export async function anchor(content, senderSig, msgId) {
  const timestamp  = new Date().toISOString()
  const blockHeight = _getBlockHeight()

  // 메시지 해시
  const msgHash = await sha256(content)

  // 체인 엔트리 구성
  // h_i = SHA-256(h_{i-1} ∥ data_i ∥ block_height)
  const chainInput = `${_prevHash}|${msgHash}|${senderSig}|${blockHeight}|${timestamp}`
  const entryHash  = await sha256(chainInput)

  // 계층 선택 (PLSM)
  const layer = await selectLayer(`${msgId}|${timestamp}`)

  const entry = {
    entryHash,
    msgHash,
    msgId,
    senderSig,
    prevHash:    _prevHash,
    blockHeight,
    timestamp,
    layer,
    anchored:    false,   // 실제 노드 제출 전
  }

  // 체인 상태 업데이트
  _prevHash = entryHash
  _chainStore.set(entryHash, entry)

  // 배치 큐에 추가 → Merkle 배치 처리
  _batchQueue.push(entry)
  _scheduleBatch()

  // 계층 노드에 즉시 제출 시도
  await _submitToLayer(layer, entry)

  return {
    entryHash,
    msgHash,
    prevHash: entry.prevHash,
    layer,
    timestamp,
    blockHeight,
  }
}

/**
 * 엔트리 해시로 체인 조회
 * @param {string} entryHash
 * @returns {Object|null}
 */
export function getEntry(entryHash) {
  return _chainStore.get(entryHash) ?? null
}

/**
 * msgId로 엔트리 조회
 * @param {string} msgId
 * @returns {Object|null}
 */
export function getEntryByMsgId(msgId) {
  for (const entry of _chainStore.values()) {
    if (entry.msgId === msgId) return entry
  }
  return null
}

/**
 * 현재 prevHash 반환 (체인 연결 상태 확인용)
 * @returns {string}
 */
export function getCurrentPrevHash() {
  return _prevHash
}

// ── Merkle 트리 ──────────────────────────────────────────────────────────

/**
 * 해시 배열로 Merkle Root 계산
 * @param {string[]} hashes
 * @returns {Promise<string>}
 */
export async function buildMerkleRoot(hashes) {
  if (hashes.length === 0) throw new Error('[HashChain] Merkle: 해시 목록이 비어있음')
  if (hashes.length === 1) return hashes[0]

  const layer = [...hashes]

  // 홀수이면 마지막 복제
  if (layer.length % 2 !== 0) layer.push(layer[layer.length - 1])

  const nextLayer = []
  for (let i = 0; i < layer.length; i += 2) {
    nextLayer.push(await sha256(layer[i] + layer[i + 1]))
  }

  return buildMerkleRoot(nextLayer)
}

/**
 * 특정 해시의 Merkle Proof 생성
 * @param {string[]} hashes  - 전체 해시 배열
 * @param {number}   index   - 대상 해시 인덱스
 * @returns {Promise<Array<{hash: string, position: 'left'|'right'}>>}
 */
export async function buildMerkleProof(hashes, index) {
  const proof = []
  let layer = [...hashes]
  let idx   = index

  while (layer.length > 1) {
    if (layer.length % 2 !== 0) layer.push(layer[layer.length - 1])

    const isRight = idx % 2 === 1
    const sibIdx  = isRight ? idx - 1 : idx + 1
    const sibling = layer[sibIdx] ?? layer[idx]

    proof.push({ hash: sibling, position: isRight ? 'left' : 'right' })

    const nextLayer = []
    for (let i = 0; i < layer.length; i += 2) {
      nextLayer.push(await sha256(layer[i] + layer[i + 1]))
    }

    layer = nextLayer
    idx   = Math.floor(idx / 2)
  }

  return proof
}

/**
 * Merkle Proof 검증
 * @param {string} targetHash
 * @param {Array}  proof
 * @param {string} merkleRoot
 * @returns {Promise<boolean>}
 */
export async function verifyMerkleProof(targetHash, proof, merkleRoot) {
  let current = targetHash

  for (const { hash, position } of proof) {
    current = position === 'left'
      ? await sha256(hash + current)
      : await sha256(current + hash)
  }

  return current === merkleRoot
}

// ── 체인 무결성 검증 ─────────────────────────────────────────────────────

/**
 * 체인 무결성 검증 (저장된 엔트리 전체 순회)
 * @returns {Promise<{ valid: boolean, brokenAt: string|null }>}
 */
export async function verifyChainIntegrity() {
  const entries = [..._chainStore.values()]
    .sort((a, b) => a.blockHeight - b.blockHeight)

  let prevHash = '0'.repeat(64)

  for (const entry of entries) {
    if (entry.prevHash !== prevHash) {
      return { valid: false, brokenAt: entry.entryHash }
    }

    // 엔트리 해시 재계산 검증
    const chainInput = `${entry.prevHash}|${entry.msgHash}|${entry.senderSig}|${entry.blockHeight}|${entry.timestamp}`
    const recomputed = await sha256(chainInput)

    if (recomputed !== entry.entryHash) {
      return { valid: false, brokenAt: entry.entryHash }
    }

    prevHash = entry.entryHash
  }

  return { valid: true, brokenAt: null }
}

// ── 내부 헬퍼 ────────────────────────────────────────────────────────────

/** 단조 증가 블록 높이 (타임스탬프 기반 정수) */
function _getBlockHeight() {
  return Math.floor(Date.now() / 1000)
}

/** 배치 타이머 스케줄 */
function _scheduleBatch() {
  if (_batchTimer) return
  _batchTimer = setTimeout(async () => {
    _batchTimer = null
    await _processBatch()
  }, config.MERKLE_BATCH_INTERVAL_MS)
}

/** 배치 처리 — Merkle Root 계산 */
async function _processBatch() {
  if (_batchQueue.length === 0) return

  const batch     = [..._batchQueue]
  _batchQueue     = []
  const hashes    = batch.map(e => e.entryHash)
  const merkleRoot = await buildMerkleRoot(hashes)

  console.log(`[HashChain] Merkle 배치 처리: ${batch.length}건, Root: ${merkleRoot.slice(0, 8)}...`)

  // TODO: Phase 2B 완료 후 실제 메인넷 블록에 기록
  // await submitMerkleRoot(merkleRoot)
}

/** 계층 노드에 엔트리 제출 */
async function _submitToLayer(layer, entry) {
  const endpoint = config.LAYER_ENDPOINTS[layer]
  if (!endpoint) return

  try {
    // dev 환경: 로컬 노드가 없으므로 성공으로 처리
    if (config.ENV === 'dev') {
      entry.anchored = true
      return
    }

    const res = await fetch(`${endpoint}/anchor`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(entry),
    })

    if (res.ok) {
      entry.anchored = true
      console.log(`[HashChain] ✅ ${layer} 앵커링 완료: ${entry.entryHash.slice(0, 8)}...`)
    }
  } catch (_) {
    // 네트워크 오류 — 배치로 재시도
    entry.anchored = false
  }
}

/** 테스트용: 체인 상태 초기화 */
export function _resetChain() {
  _prevHash   = '0'.repeat(64)
  _batchQueue = []
  _chainStore.clear()
  if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null }
}
