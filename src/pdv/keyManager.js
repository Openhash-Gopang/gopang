/**
 * @file keyManager.js
 * @description Ed25519 키쌍 생성·서명·검증·AES-256-GCM 암호화·삼중 서명
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거:
 *   - GAS v1.6 §20.2 발신자 디지털 서명 (자기완결 증거 구조 ② 요소)
 *   - KL-S-01 §3.5 삼중 서명 (사용자AI + 기관AI + OpenHash 노드)
 *   - GDC §14.3 ZKP 소유권 인증
 *
 * ⚠️  개인키(privateKey)는 non-extractable로 생성된다.
 *     기기 밖으로 절대 이탈하지 않는다.
 */

// ── 환경 감지 ─────────────────────────────────────────────────────────────
// 브라우저: window.crypto / Node.js: globalThis.crypto (v19+)
const subtle = globalThis.crypto?.subtle
if (!subtle) throw new Error('[keyManager] Web Crypto API를 사용할 수 없습니다.')

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────

/** ArrayBuffer → Base64 문자열 */
function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
}

/** Base64 문자열 → Uint8Array */
function b64ToBuf(b64) {
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0))
}

/** 문자열 → ArrayBuffer (UTF-8) */
function strToBuf(str) {
  return new TextEncoder().encode(str)
}

/** ArrayBuffer → 문자열 (UTF-8) */
function bufToStr(buf) {
  return new TextDecoder().decode(buf)
}

// ── 키쌍 생성 ─────────────────────────────────────────────────────────────

/**
 * Ed25519 키쌍 생성
 * @returns {{ publicKey: CryptoKey, privateKey: CryptoKey, publicKeyB64: string }}
 *
 * privateKey는 non-extractable — 기기 밖으로 이탈 불가
 */
export async function generateKeyPair() {
  const keyPair = await subtle.generateKey(
    { name: 'Ed25519' },
    false,          // extractable = false (개인키 보호)
    ['sign', 'verify']
  )

  // 공개키는 Base64로 직렬화 (DHT 등록, 상대방 전달용)
  const pubKeyRaw = await subtle.exportKey('raw', keyPair.publicKey)
  const publicKeyB64 = bufToB64(pubKeyRaw)

  return {
    publicKey:    keyPair.publicKey,
    privateKey:   keyPair.privateKey,
    publicKeyB64,
  }
}

/**
 * Base64 공개키 문자열 → CryptoKey 복원
 * @param {string} publicKeyB64
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(publicKeyB64) {
  return subtle.importKey(
    'raw',
    b64ToBuf(publicKeyB64),
    { name: 'Ed25519' },
    true,
    ['verify']
  )
}

// ── 서명 · 검증 ───────────────────────────────────────────────────────────

/**
 * 메시지 서명
 * @param {string}     message    - 서명할 문자열
 * @param {CryptoKey}  privateKey - Ed25519 개인키
 * @returns {Promise<string>}      Base64 서명값
 */
export async function signMessage(message, privateKey) {
  const sig = await subtle.sign(
    { name: 'Ed25519' },
    privateKey,
    strToBuf(message)
  )
  return bufToB64(sig)
}

/**
 * 서명 검증
 * @param {string}          message      - 원본 메시지
 * @param {string}          signatureB64 - Base64 서명값
 * @param {CryptoKey|string} publicKey   - CryptoKey 또는 Base64 공개키
 * @returns {Promise<boolean>}
 */
export async function verifySignature(message, signatureB64, publicKey) {
  const pubKey = typeof publicKey === 'string'
    ? await importPublicKey(publicKey)
    : publicKey

  return subtle.verify(
    { name: 'Ed25519' },
    pubKey,
    b64ToBuf(signatureB64),
    strToBuf(message)
  )
}

// ── AES-256-GCM 암호화 · 복호화 ──────────────────────────────────────────

/**
 * ECDH 키 파생 (X25519) → AES-256-GCM 암호화
 *
 * 실제 구현에서는 X25519 ECDH를 사용해야 하나,
 * 현재 Web Crypto API 지원 범위 내에서 ECDH P-256으로 구현.
 * (Post-Quantum 전환 시 CRYSTALS-Kyber로 교체 예정 — GAS v1.6 §26)
 *
 * @param {string}    plaintext      - 암호화할 문자열
 * @param {CryptoKey} recipientPubKey - 수신자 ECDH 공개키
 * @returns {Promise<{ ciphertext: string, iv: string, ephemeralPubKey: string }>}
 */
export async function encryptMessage(plaintext, recipientPubKey) {
  // 1. 발신자 임시 ECDH 키쌍 생성
  const ephemeral = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveKey']
  )

  // 2. ECDH → AES-256-GCM 파생
  const aesKey = await subtle.deriveKey(
    { name: 'ECDH', public: recipientPubKey },
    ephemeral.privateKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt']
  )

  // 3. 암호화
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ciphertextBuf = await subtle.encrypt(
    { name: 'AES-GCM', iv },
    aesKey,
    strToBuf(plaintext)
  )

  // 4. 임시 공개키 직렬화
  const ephPubRaw = await subtle.exportKey('raw', ephemeral.publicKey)

  return {
    ciphertext:    bufToB64(ciphertextBuf),
    iv:            bufToB64(iv),
    ephemeralPubKey: bufToB64(ephPubRaw),
  }
}

/**
 * AES-256-GCM 복호화
 * @param {{ ciphertext: string, iv: string, ephemeralPubKey: string }} encrypted
 * @param {CryptoKey} recipientPrivKey - 수신자 ECDH 개인키
 * @returns {Promise<string>}
 */
export async function decryptMessage(encrypted, recipientPrivKey) {
  const { ciphertext, iv, ephemeralPubKey } = encrypted

  // 1. 임시 공개키 복원
  const ephPubKey = await subtle.importKey(
    'raw',
    b64ToBuf(ephemeralPubKey),
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    []
  )

  // 2. ECDH → AES-256-GCM 파생
  const aesKey = await subtle.deriveKey(
    { name: 'ECDH', public: ephPubKey },
    recipientPrivKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt']
  )

  // 3. 복호화
  const plaintextBuf = await subtle.decrypt(
    { name: 'AES-GCM', iv: b64ToBuf(iv) },
    aesKey,
    b64ToBuf(ciphertext)
  )

  return bufToStr(plaintextBuf)
}

/**
 * ECDH 키쌍 생성 (암호화 전용)
 * @returns {{ publicKey: CryptoKey, privateKey: CryptoKey, publicKeyB64: string }}
 */
export async function generateEncryptionKeyPair() {
  const keyPair = await subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    false,   // privateKey non-extractable
    ['deriveKey']
  )
  const pubRaw = await subtle.exportKey('raw', keyPair.publicKey)
  return {
    publicKey:    keyPair.publicKey,
    privateKey:   keyPair.privateKey,
    publicKeyB64: bufToB64(pubRaw),
  }
}

// ── 삼중 서명 ─────────────────────────────────────────────────────────────
// 근거: KL-S-01 §3.5 — 재무·기관 AI 협업 분쟁 원천 차단

/**
 * 삼중 서명 객체 생성
 * @param {string} userSignature      - 사용자 AI 서명 (Base64)
 * @param {string} agentSignature     - 기관 AI 서명 (Base64)
 * @param {string} openHashRef        - OpenHash 앵커 해시
 * @returns {Object} tripleSignature
 */
export function createTripleSignature(userSignature, agentSignature, openHashRef) {
  return {
    userSignature,
    agentSignature,
    openHashRef,
    createdAt: new Date().toISOString(),
    version:   '1.0',
  }
}

/**
 * 삼중 서명 검증
 * @param {Object} triple          - createTripleSignature() 결과
 * @param {string} message         - 원본 메시지
 * @param {string} userPubKeyB64   - 사용자 공개키 (Base64)
 * @param {string} agentPubKeyB64  - 기관 AI 공개키 (Base64)
 * @returns {Promise<{ user: boolean, agent: boolean, openHash: boolean, all: boolean }>}
 */
export async function verifyTripleSignature(triple, message, userPubKeyB64, agentPubKeyB64) {
  const [user, agent] = await Promise.all([
    verifySignature(message, triple.userSignature,  userPubKeyB64),
    verifySignature(message, triple.agentSignature, agentPubKeyB64),
  ])

  // OpenHash 검증은 Phase 2B 완료 후 실제 연동
  // 현재는 openHashRef 존재 여부로 확인
  const openHash = typeof triple.openHashRef === 'string' && triple.openHashRef.length > 0

  return { user, agent, openHash, all: user && agent && openHash }
}

// ── SHA-256 헬퍼 (OpenHash PLSM 등에서 사용) ─────────────────────────────

/**
 * 문자열 → SHA-256 해시 (Hex 문자열)
 * @param {string} input
 * @returns {Promise<string>}
 */
export async function sha256(input) {
  const hashBuf = await subtle.digest('SHA-256', strToBuf(input))
  return Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

/**
 * 이중 SHA-256 (PLSM 전용)
 * @param {string} input
 * @returns {Promise<string>}
 */
export async function doubleSha256(input) {
  return sha256(await sha256(input))
}
