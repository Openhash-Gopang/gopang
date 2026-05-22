/**
 * @file phase1_core.test.js
 * @description Phase 1 플랫폼 코어 단위 테스트
 * @테스트항목 C-01 ~ C-08 (계획서 v3.1 기준)
 */

// Node.js ESM 환경에서 실행
// 실행: node --experimental-vm-modules src/tests/core/phase1_core.test.js

import { EventBus, EVENTS } from '../../core/event-bus.js'
import { registry } from '../../core/plugin-registry.js'
import { PluginValidator } from '../../core/plugin-validator.js'
import { GopangDomainPlugin } from '../../core/plugin-interface.js'

// ── 테스트 유틸리티 ──────────────────────────────────────────────────────────

let passed = 0
let failed = 0
const results = []

async function test(id, desc, fn) {
  try {
    await fn()
    console.log(`  ✅ ${id}: ${desc}`)
    results.push({ id, desc, status: 'PASS' })
    passed++
  } catch (err) {
    console.error(`  ❌ ${id}: ${desc}`)
    console.error(`     └─ ${err.message}`)
    results.push({ id, desc, status: 'FAIL', error: err.message })
    failed++
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || '단언 실패')
}

// ── 테스트용 최소 플러그인 팩토리 ────────────────────────────────────────────

function makePlugin(overrides = {}) {
  const base = new GopangDomainPlugin()
  return Object.assign(base, {
    metadata: {
      name: 'k-test',
      displayName: 'K-Test (테스트)',
      version: '1.0.0',
      description: '테스트용 플러그인',
      icon: '🧪',
      author: 'AI City Inc.',
      legalDomains: ['테스트법'],
    },
    legalClassifier: {
      classify: async () => ({ flags: [], scores: {}, details: [] }),
      getFastPathTriggers: () => [],
    },
    riskRules: [],
    uiComponents: { dashboardWidget: null, chatBadge: null, reportPanel: null },
    apiEndpoints: { analyze: null, report: null, verify: null },
    dataSchema: { messageRecord: {}, reportRecord: {} },
    onLoad:   async () => {},
    onUnload: async () => {},
    onUpdate: async () => {},
    eventSubscriptions: [],
    ...overrides,
  })
}

// ── 테스트 실행 ───────────────────────────────────────────────────────────────

console.log('\n=== Phase 1 플랫폼 코어 테스트 ===\n')

// 각 테스트 전 상태 초기화
async function setup() {
  EventBus.clearAll()
  registry.clearAll()
  await registry.init()
}

// C-01: 유효한 플러그인 등록
await setup()
await test('C-01', '유효한 플러그인 등록 성공', async () => {
  const plugin = makePlugin()
  await registry.register(plugin)
  assert(registry.has('k-test'), '등록 후 has() = true 기대')
  assert(registry.count() === 1, '등록 수 1 기대')
})

// C-02: 필수 필드 누락 플러그인 → 등록 거부
await setup()
await test('C-02', '필수 필드 누락 시 등록 거부', async () => {
  const plugin = makePlugin()
  plugin.metadata.name = ''  // name 비움
  let threw = false
  try {
    await registry.register(plugin)
  } catch (e) {
    threw = true
    assert(e.message.includes('필수 필드'), `오류 메시지 확인: ${e.message}`)
  }
  assert(threw, '오류가 발생해야 함')
})

// C-03: 동일 이름 중복 등록 → 오류
await setup()
await test('C-03', '중복 이름 등록 거부', async () => {
  const p1 = makePlugin()
  const p2 = makePlugin()
  await registry.register(p1)
  let threw = false
  try {
    await registry.register(p2)
  } catch (e) {
    threw = true
    assert(e.message.includes('이미 등록됨'), `오류 메시지 확인: ${e.message}`)
  }
  assert(threw, '중복 등록은 오류를 발생시켜야 함')
})

// C-04: major 버전 변경 업데이트 → BREAKING_CHANGE 오류
await setup()
await test('C-04', 'major 버전 변경 업데이트 차단', async () => {
  const p1 = makePlugin({ metadata: { ...makePlugin().metadata, version: '1.0.0' } })
  await registry.register(p1)

  const p2 = makePlugin({ metadata: { ...makePlugin().metadata, version: '2.0.0' } })
  let threw = false
  try {
    await registry.update(p2)
  } catch (e) {
    threw = true
    assert(e.message.includes('BREAKING_CHANGE'), `BREAKING_CHANGE 오류 기대: ${e.message}`)
  }
  assert(threw, 'major 버전 변경은 오류를 발생시켜야 함')
})

// C-05: minor 버전 변경 업데이트 → 성공
await setup()
await test('C-05', 'minor 버전 변경 업데이트 성공', async () => {
  const p1 = makePlugin({ metadata: { ...makePlugin().metadata, version: '1.0.0' } })
  await registry.register(p1)

  const p2 = makePlugin({ metadata: { ...makePlugin().metadata, version: '1.1.0' } })
  await registry.update(p2)

  const current = registry.list().find(m => m.name === 'k-test')
  assert(current.version === '1.1.0', `버전 1.1.0 기대, 실제: ${current.version}`)
})

// C-06: 이벤트 발행·구독 정상 동작
await setup()
await test('C-06', '이벤트 발행·구독 정상 동작', async () => {
  let received = null
  EventBus.on('test:ping', (data) => { received = data }, 'test')
  EventBus.emit('test:ping', { msg: 'hello' }, 'test')
  assert(received !== null, '핸들러가 호출되어야 함')
  assert(received.msg === 'hello', `데이터 일치 기대: ${JSON.stringify(received)}`)
})

// C-07: 핸들러 오류 발생 시 다른 핸들러 정상 실행
await setup()
await test('C-07', '핸들러 오류 격리 — 다른 핸들러 정상 실행', async () => {
  let secondCalled = false

  EventBus.on('test:error-isolation', () => {
    throw new Error('의도적 오류')
  }, 'broken-plugin')

  EventBus.on('test:error-isolation', () => {
    secondCalled = true
  }, 'good-plugin')

  EventBus.emit('test:error-isolation', {}, 'test')
  assert(secondCalled, '두 번째 핸들러는 정상 호출되어야 함')
})

// C-08: event-bus.js가 plugin-registry를 import하지 않음 (순환 참조 방지)
await setup()
await test('C-08', 'event-bus.js가 plugin-registry import하지 않음', async () => {
  // event-bus.js 소스코드에서 'plugin-registry' 문자열 검색
  const fs = await import('fs')
  const path = await import('path')
  const eventBusPath = path.resolve('./src/core/event-bus.js')
  const source = fs.readFileSync(eventBusPath, 'utf8')
  assert(
    !source.includes('plugin-registry'),
    'event-bus.js에 plugin-registry import가 없어야 함'
  )
})

// ── 추가 테스트: getAllFastPathTriggers() ──────────────────────────────────

await setup()
await test('C-09', '복수 플러그인 Fast-Path 트리거 통합', async () => {
  const p1 = makePlugin({
    metadata: { ...makePlugin().metadata, name: 'k-a' },
    legalClassifier: {
      classify: async () => ({ flags: [], scores: {}, details: [] }),
      getFastPathTriggers: () => [{ id: 'A-FP01', pattern: /a/, score: 0.9 }],
    },
  })
  const p2 = makePlugin({
    metadata: { ...makePlugin().metadata, name: 'k-b' },
    legalClassifier: {
      classify: async () => ({ flags: [], scores: {}, details: [] }),
      getFastPathTriggers: () => [
        { id: 'B-FP01', pattern: /b/, score: 0.8 },
        { id: 'B-FP02', pattern: /c/, score: 0.7 },
      ],
    },
  })
  await registry.register(p1)
  await registry.register(p2)
  const triggers = registry.getAllFastPathTriggers()
  assert(triggers.length === 3, `트리거 3개 기대, 실제: ${triggers.length}`)
})

// ── 결과 출력 ────────────────────────────────────────────────────────────────

console.log('\n─────────────────────────────────')
console.log(`결과: ${passed} 통과 / ${failed} 실패 / 총 ${passed + failed}`)
console.log('─────────────────────────────────\n')

if (failed > 0) {
  console.error('❌ 실패한 테스트가 있습니다. Phase 2로 진행하기 전에 수정하세요.\n')
  process.exit(1)
} else {
  console.log('✅ 모든 테스트 통과. Phase 2 진행 가능합니다.\n')
  process.exit(0)
}
