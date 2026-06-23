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

// ── IndexedDB 영속성 (gopang-wallet / anchor_chain store) ───────────────
// gopang-wallet.js v3.0과 동일한 DB + store 공유
// keyPath: 'entryHash' — 모든 이벤트(가입/대화/거래) 단일 체인
const _IDB_NAME  = 'gopang-wallet'
const _IDB_STORE = 'anchor_chain'
const _IDB_VER   = 3   // gopang-wallet.js와 동일 버전

async function _idbOpen() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(_IDB_NAME, _IDB_VER)
    req.onsuccess = e => resolve(e.target.result)
    req.onerror   = e => reject(e.target.error)
    req.onupgradeneeded = e => {
      const db     = e.target.result
      const oldVer = e.oldVersion
      if (oldVer < 1) db.createObjectStore('keys')
      if (oldVer < 2) db.createObjectStore('hash_chain', { keyPath: 'height' })
      if (oldVer < 3) {
        if (db.objectStoreNames.contains('hash_chain')) db.deleteObjectStore('hash_chain')
        db.createObjectStore(_IDB_STORE, { keyPath: 'entryHash' })
      }
    }
  })
}

async function _idbPut(entry) {
  try {
    const db = await _idbOpen()
    const tx = db.transaction(_IDB_STORE, 'readwrite')
    tx.objectStore(_IDB_STORE).put(entry)
    await new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = rej; })
  } catch(e) { console.warn('[HashChain] IDB 저장 실패:', e.message) }
}

async function _idbGetAll() {
  try {
    const db = await _idbOpen()
    const tx = db.transaction(_IDB_STORE, 'readonly')
    return await new Promise((res, rej) => {
      const req = tx.objectStore(_IDB_STORE).getAll()
      req.onsuccess = e => res(e.target.result)
      req.onerror   = e => rej(e.target.error)
    })
  } catch(e) { console.warn('[HashChain] IDB 로드 실패:', e.message); return [] }
}

/**
 * 앱 시작 시 IDB에서 체인 복원
 * anchor() 첫 호출 전에 실행 — prevHash 연속성 보장
 */
export async function loadChainFromIDB() {
  const entries = await _idbGetAll()
  if (!entries.length) return

  // timestamp 순 정렬 → 마지막 entryHash = prevHash
  entries.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
  for (const e of entries) {
    _chainStore.set(e.entryHash, e)
  }
  _prevHash = entries[entries.length - 1].entryHash
  console.info('[HashChain] IDB 복원 완료',
    '| 엔트리:', entries.length,
    '| prevHash:', _prevHash.slice(0, 16) + '...')
}

// ── 앵커링 ───────────────────────────────────────────────────────────────

/**
 * 데이터를 OpenHash 해시 체인에 앵커링
 *
 * 설계 원칙:
 *   - contentHash = SHA-256(원본 데이터) — 원본은 호출자가 보관 (vault / L1 노드)
 *   - signatures  = Ed25519 서명 배열 — 신원 증명 레이어
 *       대화: [userSig]             — 사용자 단방향 서명
 *       거래: [buyerSig, sellerSig] — 양방 서명 (seller는 상품 등록 시 사전 서명)
 *       가입: [userSig]             — 사용자 단방향 서명
 *   - prevHash가 위변조 방지 핵심 — 체인 재계산 없이 변조 불가
 *
 * @param {string}   contentHash  - SHA-256(원본 데이터) — 원본은 호출자 보관
 * @param {string[]} signatures   - Ed25519 서명 배열 (Base64)
 * @param {string}   msgId        - 이벤트 식별자
 * @returns {Promise<{
 *   entryHash: string,
 *   contentHash: string,
 *   prevHash: string,
 *   layer: string,
 *   timestamp: string,
 *   blockHeight: number
 * }>}
 */
export async function anchor(contentHash, signatures, msgId, lcat, score) {
  if (typeof contentHash !== 'string' || contentHash.length !== 64)
    throw new Error('[HashChain] contentHash는 SHA-256 hex(64자)여야 합니다.')
  if (!Array.isArray(signatures) || signatures.length === 0)
    throw new Error('[HashChain] signatures는 비어있지 않은 배열이어야 합니다.')

  const timestamp   = new Date().toISOString()
  const blockHeight = _getBlockHeight()

  const sigConcat  = signatures.join('|')
  const chainInput = `${_prevHash}|${contentHash}|${sigConcat}|${blockHeight}|${timestamp}`
  const entryHash  = await sha256(chainInput)

  // 계층 선택 (PLSM v2.0 — lcat/score 전달 시 표1 비대칭 분포, 미전달 시 폴백)
  const layer = await selectLayer(`${msgId}|${timestamp}`, lcat, score)

  const entry = {
    entryHash,
    contentHash,
    signatures,
    msgId,
    prevHash:    _prevHash,
    blockHeight,
    timestamp,
    layer,
    lcat:        lcat  ?? null,
    score:       score ?? null,
    anchored:    false,
  }

  // 체인 상태 업데이트 + IDB 영속화
  _prevHash = entryHash
  _chainStore.set(entryHash, entry)
  _idbPut(entry)   // fire-and-forget — 체인 흐름 차단 안 함

  // 배치 큐에 추가 → Merkle 배치 처리
  _batchQueue.push(entry)
  _scheduleBatch()

  // 계층 노드에 즉시 제출 시도
  await _submitToLayer(layer, entry)

  return {
    entryHash,
    contentHash,
    prevHash: entry.prevHash,
    layer,
    timestamp,
    blockHeight,
    submitted:  entry.submitted  ?? false,   // dispatch 수락 여부
    confirmed:  entry.confirmed  ?? false,   // 블록 생성 확정 여부 (비동기)
    anchored:   entry.anchored   ?? false,   // confirmed와 동기화 (하위 호환)
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
    const sigConcat2 = (entry.signatures || [entry.senderSig || '']).join('|')
    const chainInput = `${entry.prevHash}|${entry.contentHash || entry.msgHash}|${sigConcat2}|${entry.blockHeight}|${entry.timestamp}`
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

/** 계층 노드에 엔트리 제출 (worker.js 프록시 경유)
 *
 * buildout_plan_v2 Phase 1:
 *   구 방식: 클라이언트 → GitHub Pages POST /anchor (정적 서버라 수신 불가)
 *   신 방식: 클라이언트 → POST {PROXY_BASE}/openhash/anchor → worker.js → repository_dispatch
 *
 * 앵커링 2단계 상태:
 *   submitted  : worker.js가 dispatch 수락(202) → 블록 생성 비동기 진행 중
 *   confirmed  : chain_status.json 재조회로 블록 생성 확인 (수 초~수십 초 후)
 *
 * dev 환경(PROXY_BASE=null): 네트워크 호출 없이 submitted=true로 즉시 처리
 */
async function _submitToLayer(layer, entry) {
  const proxyBase = config.PROXY_BASE

  // dev 환경: 로컬 Worker 없음 → submitted=true 즉시 처리
  if (!proxyBase) {
    entry.anchored   = false   // 실제 L1 도달 안 됨
    entry.submitted  = true    // dev 환경 시뮬레이션
    entry.confirmed  = false
    return
  }

  try {
    const res = await fetch(`${proxyBase}/openhash/anchor`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        entry_hash:   entry.entryHash,
        content_hash: entry.contentHash,
        msg_id:       entry.msgId,
        signatures:   entry.signatures,
        layer,
        score:        entry.score        ?? 0,
        lcat:         entry.lcat         || 'B',
        block_height: entry.blockHeight,
        submitted_at: new Date().toISOString(),
      }),
    })

    const result = await res.json().catch(() => ({ ok: false }))

    if (result.ok && result.status === 'submitted') {
      entry.submitted = true
      entry.confirmed = false   // 블록 생성은 비동기 — confirmed는 폴링으로 확인
      entry.anchored  = false   // 확정 전까지 false 유지
      console.log(`[HashChain] ✅ ${layer} dispatch 수락 | entry=${entry.entryHash.slice(0,16)}...`)
    } else {
      entry.submitted = false
      entry.confirmed = false
      entry.anchored  = false
      console.warn(`[HashChain] ⚠️ ${layer} dispatch 실패:`, result.reason || result.dispatch_status)
    }
  } catch (e) {
    entry.submitted = false
    entry.confirmed = false
    entry.anchored  = false
    console.warn(`[HashChain] ⚠️ proxy 연결 실패:`, e.message)
  }
}

/** 테스트용: 체인 상태 초기화 */
export async function _resetChain() {
  _prevHash   = '0'.repeat(64)
  _batchQueue = []
  _chainStore.clear()
  if (_batchTimer) { clearTimeout(_batchTimer); _batchTimer = null }
  // IDB도 초기화
  try {
    const db = await _idbOpen()
    const tx = db.transaction(_IDB_STORE, 'readwrite')
    await new Promise((res, rej) => {
      const req = tx.objectStore(_IDB_STORE).clear()
      req.onsuccess = res; req.onerror = rej
    })
  } catch(e) { console.warn('[HashChain] IDB 초기화 실패:', e.message) }
}

// ── 탈중앙화 이관 ②: OpenHash 상태 직접 조회 (2026-06-23) ──────────────
// 이전: 단말 → Worker GET /openhash/status → Worker가 GitHub Pages fetch 대리
// 이후: 단말이 GitHub Pages URL 직접 fetch (공개 URL, 인증 불필요)
// Worker 엔드포인트 호출 불필요.

const LAYER_STATUS_URLS = {
  L1: 'https://openhash-gopang.github.io/openhash-L1-ido1/chain_status.json',
  L2: 'https://openhash-gopang.github.io/openhash-L2-jeju-city/chain_status.json',
  L3: 'https://openhash-gopang.github.io/openhash-L3-jeju/chain_status.json',
  L4: 'https://openhash-gopang.github.io/openhash-L4-kr/chain_status.json',
  L5: 'https://openhash-gopang.github.io/openhash-L5-global/chain_status.json',
}

const STALENESS_THRESHOLDS_SEC = {
  L1:  5 * 60,   // 300초 — 실시간 스트리밍
  L2: 15 * 60,   // 900초
  L3: 45 * 60,   // 2700초
  L4: 90 * 60,   // 5400초
  L5: 90 * 60,
}

/**
 * OpenHash L1~L5 체인 상태 직접 조회.
 * Worker 없이 GitHub Pages에서 직접 fetch.
 * @param {string|null} layer - 특정 계층만 ('L1'~'L5'), null이면 전체
 * @returns {Promise<{ok, layers, summary}>}
 */
export async function fetchChainStatus(layer = null) {
  async function fetchOne(l) {
    const url = LAYER_STATUS_URLS[l]
    try {
      const res = await fetch(url, { cache: 'no-store' })
      if (!res.ok) return { layer: l, fetched: false, error: `HTTP ${res.status}` }
      const raw = await res.json()
      const now = Date.now()
      const lastMs = raw.last_verified ? new Date(raw.last_verified).getTime() : 0
      const staleMs = now - lastMs
      const threshold = (STALENESS_THRESHOLDS_SEC[l] ?? 300) * 1000
      const isStale = lastMs > 0 && staleMs > threshold
      return {
        layer,
        fetched:         true,
        node_id:         raw.node_id,
        total_blocks:    raw.total_blocks,
        latest_hash:     raw.latest_hash,
        chain_valid:     raw.chain_valid,
        ilmv_status:     raw.ilmv_status,
        last_verified:   raw.last_verified,
        staleness_sec:   Math.round(staleMs / 1000),
        timestamp_stale: isStale,
        audit: {
          hashChainBreak:   raw.chain_valid === false,
          bivmViolation:    raw.ilmv_status === 'VIOLATION',
          timestampStale:   isStale,
          signatureFailure: raw.ilmv_status === 'SIGNATURE_FAILURE',
        },
      }
    } catch (e) {
      return { layer: l, fetched: false, error: e.message }
    }
  }

  const targets = layer ? [layer] : Object.keys(LAYER_STATUS_URLS)
  const settled = await Promise.allSettled(targets.map(l => fetchOne(l)))
  const layers  = {}
  settled.forEach((r, i) => {
    const l = targets[i]
    layers[l] = r.status === 'fulfilled' ? r.value : { layer: l, fetched: false }
  })

  const all = Object.values(layers).filter(r => r.fetched)
  const critical = all.some(r =>
    r.audit?.hashChainBreak || r.audit?.bivmViolation || r.audit?.signatureFailure
  )
  const stale = all.some(r => r.audit?.timestampStale)

  return {
    ok: true,
    layers,
    summary: {
      total:        targets.length,
      fetched:      all.length,
      critical_issue: critical,
      stale_warning:  stale,
      overall: critical ? 'CRITICAL' : stale ? 'WARNING' : 'OK',
    },
  }
}
