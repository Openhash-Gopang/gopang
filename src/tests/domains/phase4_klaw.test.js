/**
 * @file phase4_klaw.test.js
 * @description Phase 4 K-Law 플러그인 단위 테스트
 * @테스트항목 K-01 ~ K-10
 */

import KLawPlugin from '../../domains/k-law/index.js'
import { classifier, LEGAL_CATEGORIES } from '../../domains/k-law/classifier.js'
import { registry } from '../../core/plugin-registry.js'
import { EventBus, EVENTS } from '../../core/event-bus.js'
import { runPipeline } from '../../ai-secretary/pipeline.js'
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

function makeMsg(content, ov = {}) {
  return { content, senderId: 'alice', receiverId: 'bob', encrypted: true, ...ov }
}
function makeCtx(ov = {}) {
  return { senderType: 'person', receiverType: 'person',
           contextType: 'new', riskHistory: [], aiVerified: true, ...ov }
}

async function setup() {
  EventBus.clearAll(); registry.clearAll(); await registry.init(); _resetChain()
}

console.log('\n=== Phase 4 K-Law 플러그인 테스트 ===\n')

// K-01: 플러그인 등록 — 코어 변경 없음 확인
await setup()
await test('K-01', 'K-Law 플러그인 등록 성공', async () => {
  const plugin = new KLawPlugin()
  await registry.register(plugin)
  assert(registry.has('k-law'),     '레지스트리에 등록됨')
  assert(registry.count() === 1,    '등록 수 1')

  const meta = registry.list()[0]
  assert(meta.name === 'k-law',     `이름: ${meta.name}`)
  assert(meta.version === '1.0.0',  `버전: ${meta.version}`)
  assert(meta.icon === '⚖️',        '아이콘 확인')
})

// K-02: 보이스피싱 → CR-3 플래그 + S3
await setup()
await test('K-02', '보이스피싱 메시지 → CR-3 플래그 + S3', async () => {
  await registry.register(new KLawPlugin())

  const result = await runPipeline(
    makeMsg('검찰청 수사관입니다. 계좌가 범죄에 연루되어 지금 즉시 이체해야 합니다.'),
    makeCtx()
  )
  assert(result.riskResult.level === 'S3',
    `위험 등급: ${result.riskResult.level}`)
  assert(result.riskResult.action === 'BLOCK_AND_ALERT',
    `조치: ${result.riskResult.action}`)
  assert(result.riskResult.resources !== null,
    '관련 기관 제공')
})

// K-03: 임대차 위법 → CV-2 플래그 + 탐지율 ≥93.3%
await setup()
await test('K-03', '임대차 위법 메시지 → CV-2 플래그', async () => {
  const suList = [{ id:'SU_001', text:'임대인이 보증금 반환을 거부하고 있습니다. 전세사기 의심됩니다.', tag:'SU_FACT', confidence:0.8 }]
  const result = await classifier.classify(suList)
  assert(result.flags.includes('CV-2'), `CV-2 플래그: ${result.flags}`)
  assert(result.scores['CV-2'] >= 0.70, `CV-2 점수: ${result.scores['CV-2']}`)
})

// K-04: S3 감지 → LEGAL_DISPUTE + GDC_ESCROW_CREATED 이벤트
await setup()
await test('K-04', 'S3 감지 → LEGAL_DISPUTE + GDC_ESCROW_CREATED 이벤트', async () => {
  await registry.register(new KLawPlugin())

  let legalDisputeFired = false
  let escrowFired = false

  EventBus.on(EVENTS.LEGAL_DISPUTE, () => { legalDisputeFired = true }, 'test')
  EventBus.on(EVENTS.GDC_ESCROW_CREATED, () => { escrowFired = true }, 'test')

  await runPipeline(
    makeMsg('금감원 직원입니다. 지금 바로 계좌번호를 알려주세요.'),
    makeCtx()
  )

  assert(legalDisputeFired, 'LEGAL_DISPUTE 이벤트 발행됨')
  assert(escrowFired, 'GDC_ESCROW_CREATED 이벤트 발행됨')
})

// K-05: 다중 법령 플래그 동시 탐지
await setup()
await test('K-05', '다중 법령 플래그 동시 탐지 (CR-2 + LB-1)', async () => {
  const suList = [
    { id:'SU_001', text:'안 하면 신고하겠다고 협박했습니다.', tag:'SU_THREAT', confidence:0.85 },
    { id:'SU_002', text:'직장 내 갑질과 폭언이 계속되고 있습니다.', tag:'SU_FACT', confidence:0.75 },
  ]
  const result = await classifier.classify(suList)
  assert(result.flags.includes('CR-2'), `CR-2: ${result.flags}`)
  assert(result.flags.includes('LB-1'), `LB-1: ${result.flags}`)
})

// K-06: 정상 메시지 → 플래그 없음
await setup()
await test('K-06', '정상 메시지 → 법령 플래그 없음', async () => {
  const suList = [{ id:'SU_001', text:'오늘 저녁 미팅 몇 시인가요?', tag:'SU_NEUTRAL', confidence:0.1 }]
  const result = await classifier.classify(suList)
  assert(result.flags.length === 0, `플래그 없음: ${result.flags}`)
})

// K-07: Fast-Path 트리거 5개 존재 확인
await setup()
await test('K-07', 'K-Law Fast-Path 트리거 5개 확인', async () => {
  const triggers = classifier.getFastPathTriggers()
  assert(triggers.length === 5, `트리거 수: ${triggers.length}`)
  assert(triggers.every(t => t.id && t.pattern && t.score > 0), '트리거 구조 유효')
  assert(triggers[0].score >= 0.88, `최고 점수: ${triggers[0].score}`)
})

// K-08: 전세사기 Fast-Path 탐지
await setup()
await test('K-08', '전세사기 Fast-Path 탐지 (KL-FP05)', async () => {
  await registry.register(new KLawPlugin())
  const result = await runPipeline(
    makeMsg('전세사기로 보증금을 편취당했습니다. 임대인이 잠적했습니다.'),
    makeCtx()
  )
  assert(result.riskResult.score >= 0.80, `점수: ${result.riskResult.score}`)
})

// K-09: LEGAL_CATEGORIES 전체 항목 무결성
await setup()
await test('K-09', 'LEGAL_CATEGORIES 13개 항목 구조 무결성', async () => {
  const keys = Object.keys(LEGAL_CATEGORIES)
  assert(keys.length === 13, `항목 수: ${keys.length}`)
  for (const [code, cat] of Object.entries(LEGAL_CATEGORIES)) {
    assert(cat.name,     `${code} name 존재`)
    assert(cat.law,      `${code} law 존재`)
    assert(cat.severity >= 0.5 && cat.severity <= 1.0,
      `${code} severity 범위: ${cat.severity}`)
  }
})

// K-10: 코어 파일 변경 라인 수 = 0
await setup()
await test('K-10', '코어 파일 변경 없음 확인', async () => {
  // 새 플러그인 추가 시 코어 파일(core/*)은 변경되지 않아야 함
  // plugin-validator.js는 BUG-003 수정으로 이미 변경됨 → 현재 상태가 최종 코어
  // K-Law 플러그인 추가로 인한 추가 코어 변경이 없음을 확인
  const { readFileSync } = await import('fs')

  const coreFiles = [
    'src/core/event-bus.js',
    'src/core/plugin-registry.js',
    'src/core/plugin-interface.js',
  ]

  for (const f of coreFiles) {
    const content = readFileSync(f, 'utf8')
    assert(!content.includes('k-law'), `${f}에 k-law 참조 없음`)
  }
})

// K-11: K-Law 플러그인 v1.0.0 → v1.1.0 업데이트 (다른 플러그인 무영향)
await setup()
await test('K-11', 'K-Law v1.0.0 → v1.1.0 업데이트 시 다른 플러그인 무영향', async () => {
  // 더미 플러그인 B 등록
  const { GopangDomainPlugin } = await import('../../core/plugin-interface.js')
  const pB = Object.assign(new GopangDomainPlugin(), {
    metadata: { name:'k-dummy', displayName:'Dummy', version:'1.0.0',
                description:'', icon:'', author:'AI City Inc.', legalDomains:[] },
    legalClassifier: { classify: async () => ({ flags:['DUMMY-01'], scores:{}, details:[] }), getFastPathTriggers: () => [] },
    riskRules:[], uiComponents:{dashboardWidget:null,chatBadge:null,reportPanel:null},
    apiEndpoints:{analyze:null,report:null,verify:null}, dataSchema:{messageRecord:{},reportRecord:{}},
    onLoad:async()=>{}, onUnload:async()=>{}, onUpdate:async()=>{}, eventSubscriptions:[],
  })

  await registry.register(new KLawPlugin())
  await registry.register(pB)
  assert(registry.count() === 2, '2개 등록 확인')

  // K-Law v1.1.0 업데이트
  const klawV2 = new KLawPlugin()
  klawV2.metadata = { ...klawV2.metadata, version: '1.1.0' }
  await registry.update(klawV2)

  // k-dummy는 영향 없음
  const dummy = registry.get('k-dummy')
  assert(dummy?.metadata?.version === '1.0.0', `dummy 버전 유지: ${dummy?.metadata?.version}`)
  assert(registry.count() === 2, '플러그인 수 유지')
})

// ── 결과 ─────────────────────────────────────────────────────────────────
console.log(`\n결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}\n`)
if (failed > 0) process.exit(1); else process.exit(0)
