/**
 * @file phase6_khealth.test.js
 * @description Phase 6 K-Health 플러그인 테스트
 * @테스트항목 H-01 ~ H-10
 *
 * 핵심 검증:
 *   - 2호 플러그인 추가 시 코어 변경 0줄
 *   - K-Law + K-Health 동시 활성화 + 오류 격리
 *   - MED-01~05 법령 분류 정확성
 */

import KHealthPlugin from '../../domains/k-health/index.js'
import KLawPlugin    from '../../domains/k-law/index.js'
import { classifier, MEDICAL_CATEGORIES } from '../../domains/k-health/classifier.js'
import { registry } from '../../core/plugin-registry.js'
import { EventBus, EVENTS } from '../../core/event-bus.js'
import { runPipeline } from '../../ai-secretary/pipeline.js'
import { _resetChain } from '../../openhash/hashChain.js'
import { readFileSync } from 'fs'

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

function makeMsg(c, ov = {}) {
  return { content: c, senderId: 'alice', receiverId: 'bob', encrypted: true, ...ov }
}
function makeCtx(ov = {}) {
  return { senderType: 'person', receiverType: 'person',
           contextType: 'new', riskHistory: [], aiVerified: true, ...ov }
}
async function setup() {
  EventBus.clearAll(); registry.clearAll(); await registry.init(); _resetChain()
}

console.log('\n=== Phase 6 K-Health 플러그인 테스트 ===\n')

// H-01: K-Health 플러그인 등록 — 코어 변경 없음
await setup()
await test('H-01', 'K-Health 플러그인 등록 성공 (코어 변경 0줄)', async () => {
  await registry.register(new KHealthPlugin())
  assert(registry.has('k-health'), '등록됨')
  assert(registry.list()[0].icon === '🏥', '아이콘 확인')

  // 코어 import에 k-health 참조 없음
  const coreFiles = [
    'src/core/event-bus.js',
    'src/core/plugin-registry.js',
    'src/core/plugin-interface.js',
    'src/core/plugin-validator.js',
  ]
  for (const f of coreFiles) {
    const imports = readFileSync(f, 'utf8').split('\n')
      .filter(l => l.trim().startsWith('import'))
    assert(!imports.some(l => l.includes('k-health')), `${f} import에 k-health 없음`)
  }
})

// H-02: 무허가 의료행위 → MED-01 + S3
await setup()
await test('H-02', '무허가 의료행위 → MED-01 + S3', async () => {
  await registry.register(new KHealthPlugin())
  const r = await runPipeline(
    makeMsg('의사 자격 없이 진료를 하고 있습니다. 싸게 해드릴게요.'),
    makeCtx()
  )
  assert(r.riskResult.level === 'S3', `등급: ${r.riskResult.level}`)
  assert(r.riskResult.action === 'BLOCK_AND_ALERT', `조치: ${r.riskResult.action}`)
})

// H-03: 처방전 없는 의약품 요청 → MED-02 Fast-Path
await setup()
await test('H-03', '처방전 없이 구매 → KH-FP01 Fast-Path', async () => {
  await registry.register(new KHealthPlugin())
  const r = await runPipeline(
    makeMsg('처방전 없이 구매할 수 있는 항생제 있나요?'),
    makeCtx()
  )
  assert(r.riskResult.score >= 0.85, `점수: ${r.riskResult.score}`)
})

// H-04: 의료 개인정보 침해 → MED-03
await setup()
await test('H-04', '진료기록 무단 유출 → MED-03 플래그', async () => {
  const suList = [{ id:'SU_001', text:'진료기록을 무단으로 외부에 유출하겠다고 협박합니다.', tag:'SU_THREAT', confidence:0.85 }]
  const r = await classifier.classify(suList)
  assert(r.flags.includes('MED-03'), `MED-03: ${r.flags}`)
  assert(r.scores['MED-03'] >= 0.70, `점수: ${r.scores['MED-03']}`)
})

// H-05: 의료 광고 위반 → MED-04
await setup()
await test('H-05', '100% 완치 보장 광고 → MED-04 플래그', async () => {
  const suList = [{ id:'SU_001', text:'암 100% 완치 보장 광고 중입니다.', tag:'SU_FACT', confidence:0.7 }]
  const r = await classifier.classify(suList)
  assert(r.flags.includes('MED-04'), `MED-04: ${r.flags}`)
})

// H-06: 정상 의료 문의 → 플래그 없음
await setup()
await test('H-06', '정상 의료 문의 → 플래그 없음', async () => {
  const suList = [{ id:'SU_001', text:'감기 증상으로 내과에 가야 할까요?', tag:'SU_NEUTRAL', confidence:0.1 }]
  const r = await classifier.classify(suList)
  assert(r.flags.length === 0, `플래그 없음: ${r.flags}`)
})

// H-07: MEDICAL_ALERT 이벤트 발행 확인
await setup()
await test('H-07', 'S2 이상 의료 위험 → MEDICAL_ALERT 이벤트', async () => {
  await registry.register(new KHealthPlugin())

  let alertFired = false
  EventBus.on(EVENTS.MEDICAL_ALERT, () => { alertFired = true }, 'test')

  await runPipeline(
    makeMsg('의사 자격 없이 진료를 받을 수 있습니다.'),
    makeCtx()
  )
  assert(alertFired, 'MEDICAL_ALERT 발행됨')
})

// H-08: K-Law + K-Health 동시 활성화 — 독립 동작
await setup()
await test('H-08', 'K-Law + K-Health 동시 활성화 — 독립 동작', async () => {
  await registry.register(new KLawPlugin())
  await registry.register(new KHealthPlugin())
  assert(registry.count() === 2, `2개 등록: ${registry.count()}`)

  // K-Health 의료 메시지
  const r1 = await runPipeline(
    makeMsg('처방전 없이 구매 부탁드립니다.'),
    makeCtx()
  )
  assert(r1.riskResult.level !== 'S0', `K-Health 감지: ${r1.riskResult.level}`)

  // K-Law 법률 메시지
  const r2 = await runPipeline(
    makeMsg('보증금 반환을 거부하고 있습니다.'),
    makeCtx()
  )
  assert(r2.riskResult.level !== 'S0', `K-Law 감지: ${r2.riskResult.level}`)

  // 두 파이프라인 모두 msgId 반환 확인
  assert(r1.msgId?.length === 64, 'K-Health msgId')
  assert(r2.msgId?.length === 64, 'K-Law msgId')
})

// H-09: K-Health 오류 발생 시 K-Law 정상 동작 (오류 격리)
await setup()
await test('H-09', 'K-Health 오류 → K-Law 정상 동작 (오류 격리)', async () => {
  await registry.register(new KLawPlugin())

  // 오류 발생 k-health 플러그인
  const { GopangDomainPlugin } = await import('../../core/plugin-interface.js')
  const badHealth = Object.assign(new GopangDomainPlugin(), {
    metadata: { name:'k-health', displayName:'K-Health(broken)', version:'1.0.0',
                description:'', icon:'🏥', author:'AI City Inc.', legalDomains:[] },
    legalClassifier: {
      classify: async () => { throw new Error('K-Health 의도적 오류') },
      getFastPathTriggers: () => [],
    },
    riskRules:[],
    uiComponents:{ dashboardWidget:null, chatBadge:null, reportPanel:null },
    apiEndpoints:{ analyze:null, report:null, verify:null },
    dataSchema:{ messageRecord:{}, reportRecord:{} },
    onLoad:async()=>{}, onUnload:async()=>{}, onUpdate:async()=>{}, eventSubscriptions:[],
  })
  await registry.register(badHealth)

  // 오류 플러그인에도 불구하고 파이프라인 완료
  const r = await runPipeline(
    makeMsg('보증금 반환을 거부합니다.'),
    makeCtx()
  )
  assert(r.msgId?.length === 64, '파이프라인 완료')
  assert(r.riskResult.level !== undefined, '위험 등급 존재')
})

// H-10: MEDICAL_CATEGORIES 5개 항목 무결성
await setup()
await test('H-10', 'MEDICAL_CATEGORIES 5개 항목 구조 무결성', async () => {
  const keys = Object.keys(MEDICAL_CATEGORIES)
  assert(keys.length === 5, `항목 수: ${keys.length}`)
  for (const [code, cat] of Object.entries(MEDICAL_CATEGORIES)) {
    assert(cat.name,     `${code} name 존재`)
    assert(cat.law,      `${code} law 존재`)
    assert(cat.severity >= 0.5 && cat.severity <= 1.0,
      `${code} severity 범위: ${cat.severity}`)
  }
  // Fast-Path 트리거 3개
  const triggers = classifier.getFastPathTriggers()
  assert(triggers.length === 3, `트리거 수: ${triggers.length}`)
})

// ── 결과 ─────────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}\n`)
if (failed > 0) process.exit(1); else process.exit(0)
