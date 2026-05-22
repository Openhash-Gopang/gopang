/**
 * @file constants.js
 * @description 고팡 플랫폼 전역 상수 — 모든 매직 넘버는 여기서 관리
 * @version 1.0.0
 * @author AI City Inc.
 *
 * ⚠️  이 파일을 수정하면 플랫폼 전체에 영향을 미칩니다.
 *     수치 변경 시 반드시 테스트를 재실행하세요.
 */

// ── OpenHash PLSM 계층 분포 ────────────────────────────────────────────────
// 근거: OpenHash SCI 논문 §4.1 표 1
// mod 1000 버킷 기준 누적 상한값
export const PLSM = Object.freeze({
  L1_UPPER: 600,   // 0~599   → 60%
  L2_UPPER: 800,   // 600~799 → 20%
  L3_UPPER: 900,   // 800~899 → 10%
  L4_UPPER: 960,   // 900~959 → 6%
  L5_UPPER: 1000,  // 960~999 → 4%
  LAYERS: ['L1', 'L2', 'L3', 'L4', 'L5'],
})

// ── AI 비서 위험 등급 임계값 ───────────────────────────────────────────────
// 근거: KL-M-02 Phase 5.1
export const RISK = Object.freeze({
  S0_MAX: 0.30,   // 0.00~0.29 → S0 안전
  S1_MAX: 0.60,   // 0.30~0.59 → S1 주의
  S2_MAX: 0.85,   // 0.60~0.84 → S2 경고
  // 0.85~1.00 → S3 긴급 차단
  HISTORY_WEIGHT: 1.3,   // Q0.8: 30일 내 S2 이상 이력 가중치
})

// ── Phase 4 WS 공식 가중치 ─────────────────────────────────────────────────
// 근거: KL-M-02 Phase 4
export const WS = Object.freeze({
  P1: 0.50,   // 형태소 분석·SU 태깅
  P2: 0.35,   // 법령 분류
  P3: 0.15,   // 문서 분석 (첨부 없으면 0)
})

// ── GDC 스테이킹 임계값 ────────────────────────────────────────────────────
// 근거: GAS v1.6 §10.1
export const STAKING = Object.freeze({
  L2_MIN: 100,    // ≥100 GDC → 신뢰 등급 L2
  L3_MIN: 1000,   // ≥1000 GDC + KYC → 신뢰 등급 L3
})

// ── Stealth Address 태그 비트 ──────────────────────────────────────────────
// 근거: GAS v1.6 §6.2
export const STEALTH = Object.freeze({
  BASE_BITS: 32,   // 소각 0 GDC → 32비트
  MAX_BITS: 40,    // 소각 255 GDC → 40비트
  MAX_BURN_FACTOR: 8,
})

// ── 오프라인 큐 예치금 ─────────────────────────────────────────────────────
// 근거: GAS v1.6 §15.1 / GDC §13
export const QUEUE = Object.freeze({
  RATE: 0.0001,          // GDC/KB/h
  DELAY_WEIGHT: {
    L2: 0.0,
    L1: 0.5,
    L0: 2.0,
  },
  MAX_HOLD_HOURS: 720,   // 최대 30일
})

// ── 성능 목표 (ms 단위) ────────────────────────────────────────────────────
// 근거: KL-S-01 §5 실측값 / OpenHash SCI 논문 §4.4
export const PERF = Object.freeze({
  PHASE1_SHORT_MS:       0.81,   // AI 비서 단문 판정
  PHASE1_LONG_MS:        1.00,   // AI 비서 장문 판정
  PHASE3_DOC_MS:        15.00,   // 문서 분석 A4 1페이지
  PHASE3_COMPLEX_MS:   100.00,   // 복합 문서
  EVIDENCE_PACKAGE_MS: 1200,     // 증거 패키지 생성
  OPENHASH_E2E_MS:        3.09,  // OpenHash E2E 레이턴시
  LPBFT_TARGET_MS:        0.759, // LPBFT L1 4노드
  PLSM_TPS:            4399,     // PLSM 단일 노드 처리량
})

// ── OpenHash BIVM ───────────────────────────────────────────────────────────
// 근거: OpenHash SCI 논문 §4.2
export const BIVM = Object.freeze({
  EPSILON: 1e-9,   // 부동소수점 오차 허용 범위
})

// ── LPBFT 비상 조건 ────────────────────────────────────────────────────────
// 근거: OpenHash SCI 논문 §4.4
export const LPBFT = Object.freeze({
  EMERGENCY_CONDITIONS: Object.freeze([
    'HASH_CHAIN_BREAK',
    'BIVM_VIOLATION',
    'NODE_BYZANTINE',
    'NETWORK_PARTITION',
    'ILMV_THRESHOLD_EXCEEDED',
  ]),
  DEACTIVATION_COUNT: 4,   // 비활성화 조건 충족 수
})

// ── 중요도 기반 적응형 검증 임계값 ────────────────────────────────────────
// 근거: OpenHash SCI 논문 §4.6
export const IMPORTANCE = Object.freeze({
  LIGHTWEIGHT_MAX: 30,   // score < 30 → 경량 모드
  STANDARD_MAX:    60,   // 30 ≤ score < 60 → 표준 모드
  // score ≥ 60 → 강화 모드 (zk-SNARKs + TEE + 슬래싱)
})

// ── GDC 통화 정책 ──────────────────────────────────────────────────────────
// 근거: GDC Whitepaper v1.5 §4.2
export const GDC_POLICY = Object.freeze({
  INFLATION_ALPHA: 0.20,
  INFLATION_BETA:  0.50,
  MAX_INFLATION:   0.02,   // 연 최대 2%
  GENESIS_SUPPLY:  100_000_000,
  MAX_SUPPLY:      200_000_000,
})

// ── ZKP 수수료 ────────────────────────────────────────────────────────────
// 근거: GAS v1.6 §20.4 / GDC §14.3
export const ZKP = Object.freeze({
  VERIFY_FEE_GDC: 0.01,   // 0.01 GDC / 1회 검증
})

// ── KYC 이력 기간 ─────────────────────────────────────────────────────────
// 근거: KL-M-02 Phase 0 Q0.8
export const HISTORY = Object.freeze({
  RISK_LOOKBACK_DAYS: 30,   // S2 이상 이력 조회 기간
})

// ── 표준 이벤트명 ─────────────────────────────────────────────────────────
// 근거: v3.1 계획서 core/event-bus.js
export const EVENTS = Object.freeze({
  // 플러그인 생명주기
  PLUGIN_REGISTERED:    'plugin:registered',
  PLUGIN_UPDATED:       'plugin:updated',
  PLUGIN_ERROR:         'plugin:error',

  // 메시지 파이프라인
  MSG_RECEIVED:         'msg:received',
  MSG_RISK_ASSESSED:    'msg:risk-assessed',
  MSG_BLOCKED:          'msg:blocked',
  MSG_ANCHORED:         'msg:anchored',

  // 도메인 크로스 이벤트
  LEGAL_DISPUTE:        'domain:legal-dispute',
  MEDICAL_ALERT:        'domain:medical-alert',
  FINANCIAL_ALERT:      'domain:financial-alert',

  // GDC
  GDC_ESCROW_CREATED:   'gdc:escrow-created',
  GDC_KLAW_EXECUTED:    'gdc:klaw-executed',
})
