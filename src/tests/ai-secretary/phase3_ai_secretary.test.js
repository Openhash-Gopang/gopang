/**
 * @file phase3_ai_secretary.test.js
 * @description Phase 3 AI 비서 파이프라인 단위 테스트
 * @테스트항목 A-01 ~ A-11
 */

import { identifyCommObject, SENDER_TYPE, CONTEXT_TYPE } from '../../ai-secretary/phase0.js'
import { analyzePhase1, SU_TAG } from '../../ai-secretary/phase1.js'
import { analyzePhase3 } from '../../ai-secretary/phase3.js'
import { calculateScore, bidirectionalVerify } from '../../ai-secretary/phase4.js'
import { classifyRisk } from '../../ai-secretary/phase5.js'
import { recordAndAnchor } from '../../ai-secretary/phase6.js'
import { runPipeline } from '../../ai-secretary/pipeline.js'
import { registry } from '../../core/plugin-registry.js'
import { EventBus } from '../../core/event-bus.js'
import { _resetChain } from '../../openhash/hashChain.js'

let passed = 0, failed = 0

async function test(id, desc, fn) {
  try {
    await fn()
    console.log(`  ✅ ${id}: ${desc}`)
    passed++
  } catch (err) {
    console.error(`  ❌ ${id}: ${desc}\n     └─ ${err.message}`)
    failed++
  }
}

function assert(c, m) { if (!c) throw new Error(m || '단언 실패') }

function makeMsg(content, overrides = {}) {
  return { content, senderId: 'alice', receiverId: 'bob', encrypted: true, ...overrides }
}

function makeCtx(overrides = {}) {
  return { senderType: SENDER_TYPE.PERSON, receiverType: SENDER_TYPE.PERSON,
           contextType: CONTEXT_TYPE.NEW, riskHistory: [], aiVerified: true, ...overrides }
}

async function setup() {
  EventBus.clearAll(); registry.clearAll(); await registry.init(); _resetChain()
}

console.log('\n=== Phase 3 AI 비서 파이프라인 테스트 ===\n')

// A-01: Phase 0 정상 흐름
await setup()
await test('A-01', 'Phase 0 정상 소통 객체 식별', async () => {
  const result = identifyCommObject(makeMsg('안녕하세요. 잘 지내세요?'), makeCtx())
  assert(result.Q0.Q0_1 !== undefined, 'Q0.1 식별됨')
  assert(result.immediateS3 === false, 'S3 즉시 조건 없음')
  assert(result.historyWeight === 1.0, '기본 가중치 1.0')
  assert(result.hasAttachment === false, '첨부 없음')
})

// A-02: Phase 0 암호화 이상 → 즉시 S3
await setup()
await test('A-02', 'Phase 0 암호화 이상 → immediateS3=true', async () => {
  const result = identifyCommObject(
    makeMsg('메시지', { encrypted: false }),
    makeCtx()
  )
  assert(result.immediateS3 === true, 'immediateS3=true')
  assert(result.immediateS3Reason === 'ENCRYPTION_ABNORMAL', `이유: ${result.immediateS3Reason}`)
})

// A-03: Phase 0 Q0.8 이력 가중치 1.3
await setup()
await test('A-03', 'Phase 0 Q0.8 30일 내 S2 이력 → 가중치 1.3', async () => {
  const recentDate = new Date(Date.now() - 5 * 86400 * 1000).toISOString()
  const ctx = makeCtx({ riskHistory: [{ level: 'S2', date: recentDate }] })
  const result = identifyCommObject(makeMsg('테스트'), ctx)
  assert(result.historyWeight === 1.3, `가중치: ${result.historyWeight}`)
})

// A-04: Phase 1 Fast-Path 보이스피싱 탐지
await setup()
await test('A-04', 'Phase 1 Fast-Path 보이스피싱 즉각 탐지', async () => {
  const t0 = performance.now()
  const result = analyzePhase1('금감원 직원입니다. 지금 당장 계좌번호를 알려주세요.', 'text_short', [])
  const elapsed = performance.now() - t0

  assert(result.fastPathResult !== null, 'Fast-Path 트리거됨')
  assert(result.fastPathResult.id === 'FP-01' || result.fastPathResult.id === 'FP-02',
    `트리거 ID: ${result.fastPathResult.id}`)
  assert(result.p1Score >= 0.90, `점수 ≥0.90: ${result.p1Score}`)
  console.log(`     처리 시간: ${elapsed.toFixed(3)}ms`)
})

// A-05: Phase 1 Context-Path SU 태깅
await setup()
await test('A-05', 'Phase 1 Context-Path SU 태깅', async () => {
  const result = analyzePhase1('안녕하세요. 계약을 해지합니다. 잘 부탁드립니다.', 'text_short', [])
  assert(result.fastPathResult === null, 'Fast-Path 미트리거')
  assert(result.suList.length > 0, 'SU 목록 존재')
  const legalSU = result.suList.find(su => su.tag === SU_TAG.LEGAL)
  assert(legalSU !== undefined, 'SU_LEGAL 태그 감지')
})

// A-06: Phase 3 DOC-4 실행 파일 탐지
await setup()
await test('A-06', 'Phase 3 DOC-4 실행 파일 탐지', async () => {
  const attachment = { name: 'invoice.exe', text: '' }
  const result = await analyzePhase3(attachment, {})
  assert(result.p3Score >= 0.80, `점수 ${result.p3Score}`)
  assert(result.flags.includes('DOC4-실행파일'), `플래그: ${result.flags}`)
})

// A-07: Phase 4 WS 공식 검증
await setup()
await test('A-07', 'Phase 4 WS 공식 (P1×0.5 + P2×0.35 + P3×0.15)', async () => {
  const { wsScore, finalScore } = calculateScore(0.8, 0.6, 0.4, 1.0, null)
  const expected = 0.8 * 0.50 + 0.6 * 0.35 + 0.4 * 0.15
  assert(Math.abs(wsScore - expected) < 0.001, `WS 공식: ${wsScore} vs ${expected.toFixed(4)}`)
  assert(finalScore === wsScore, '가중치 1.0이므로 finalScore=wsScore')
})

// A-08: Phase 4 이력 가중치 1.3 적용
await setup()
await test('A-08', 'Phase 4 이력 가중치 1.3 적용 → 1.0 캡', async () => {
  const { finalScore } = calculateScore(0.8, 0.7, 0.5, 1.3, null)
  assert(finalScore <= 1.0, `finalScore ≤ 1.0: ${finalScore}`)
})

// A-09: Phase 4 쌍방향 검증 maxScore
await setup()
await test('A-09', 'Phase 4 쌍방향 검증 maxScore', async () => {
  const result = bidirectionalVerify(
    { p1Score:0.3, p2Score:0.2, p3Score:0, historyWeight:1.0, fastPathResult:null },
    { p1Score:0.7, p2Score:0.6, p3Score:0, historyWeight:1.0, fastPathResult:null }
  )
  assert(result.maxScore >= result.outScore, 'maxScore ≥ outScore')
  assert(result.maxScore >= result.inScore,  'maxScore ≥ inScore')
  assert(result.inScore > result.outScore,   '수신 위험이 더 높음')
})

// A-10: Phase 5 S0~S3 판정
await setup()
await test('A-10', 'Phase 5 S0~S3 판정 경계값', async () => {
  assert(classifyRisk(0.10).level === 'S0', '0.10 → S0')
  assert(classifyRisk(0.30).level === 'S1', '0.30 → S1')
  assert(classifyRisk(0.60).level === 'S2', '0.60 → S2')
  assert(classifyRisk(0.85).level === 'S3', '0.85 → S3')
  assert(classifyRisk(0.85).resources !== null, 'S3 관련 기관 제공')
})

// A-11: 전체 파이프라인 — 일반 메시지 (플러그인 없이)
await setup()
await test('A-11', '전체 파이프라인 일반 메시지 (S0)', async () => {
  const t0 = performance.now()
  const result = await runPipeline(
    makeMsg('안녕하세요. 오늘 회의 몇 시인가요?'),
    makeCtx()
  )
  const elapsed = performance.now() - t0

  assert(result.msgId?.length === 64, `msgId 길이 64: ${result.msgId?.length}`)
  assert(result.anchorHash?.length === 64, 'anchorHash 길이 64')
  assert(result.riskResult.level === 'S0', `위험 등급: ${result.riskResult.level}`)
  assert(result.phaseScores.final < 0.30, `finalScore: ${result.phaseScores.final}`)
  console.log(`     처리 시간: ${elapsed.toFixed(3)}ms`)
})

// A-12: 전체 파이프라인 — 보이스피싱 (S3)
await setup()
await test('A-12', '전체 파이프라인 보이스피싱 → S3 차단', async () => {
  const result = await runPipeline(
    makeMsg('검찰청 수사관입니다. 지금 당장 계좌번호를 알려주세요.'),
    makeCtx()
  )
  assert(result.riskResult.level === 'S3', `위험 등급: ${result.riskResult.level}`)
  assert(result.riskResult.action === 'BLOCK_AND_ALERT', `조치: ${result.riskResult.action}`)
  assert(result.riskResult.resources !== null, 'S3 관련 기관 제공')
})

// A-13: Phase 6 전체 기록 항목 확인
await setup()
await test('A-13', 'Phase 6 전체 기록 항목 포함 확인', async () => {
  const msg = makeMsg('테스트 메시지')
  const riskResult = classifyRisk(0.45)
  const recorded = await recordAndAnchor(msg, riskResult, { p1:0.4, p2:0.5, p3:0, ws:0.45, final:0.45 })

  assert(recorded.msgId?.length === 64, 'msgId 존재')
  assert(recorded.anchorHash?.length === 64, 'anchorHash 존재')
  assert(recorded.record.riskLevel === 'S1', `riskLevel: ${recorded.record.riskLevel}`)
  assert(Array.isArray(recorded.record.legalFlags), 'legalFlags 배열')
  assert(recorded.record.phaseLog?.p1 !== undefined, 'phaseLog 존재')
  assert(recorded.record.openHashRef?.length === 64, 'openHashRef 존재')
})

// ── 결과 ─────────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}\n`)
if (failed > 0) process.exit(1); else process.exit(0)
