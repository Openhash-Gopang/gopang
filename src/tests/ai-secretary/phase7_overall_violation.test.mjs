// phase7_overall_violation.test.mjs
// 실행: node --test src/tests/ai-secretary/phase7_overall_violation.test.mjs
//
// (B) 종합 위법 가능성 판단(2단계, LLM) — 2026-07-17 세션 논의(E-2 아키텍처
// 갭)에서 나온 설계: "개별 위법 탐지"(Phase 1~5, 규칙기반, 비용 0)가
// "전반적 위법 가능성 판단"(Phase 7, LLM, 비용 발생)의 게이트 역할을 해서,
// 일상 대화·잡담엔 LLM을 전혀 안 쓰고 이미 뭔가 신호가 있었던 대화에만
// 토큰을 쓴다. 이 파일은 그 게이팅이 실제로 지켜지는지와, LLM 응답 파싱이
// 정확한지를 검증한다.

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { assessOverallViolation } from '../../ai-secretary/phase7.js'
import { registry } from '../../core/plugin-registry.js'
import KLawPlugin from '../../domains/k-law/index.js'
import { runPipeline } from '../../ai-secretary/pipeline.js'
import { _resetChain } from '../../openhash/hashChain.js'

describe('Phase 7 단위 — assessOverallViolation 게이팅', () => {
  test('P7-01: S0(안전) 판정이면 llmCaller를 아예 호출하지 않음(핵심 비용 절감 지점)', async () => {
    let called = false
    const llmCaller = async () => { called = true; return '{}' }
    const result = await assessOverallViolation('[발신자] 안녕하세요', { level: 'S0' }, llmCaller)
    assert.equal(called, false, 'S0인데 LLM이 호출됨 — 토큰 낭비')
    assert.deepEqual(result, { skipped: true, reason: 'rule_based_s0' })
  })

  test('P7-02: llmCaller 미주입 시 S1이어도 skip(운영 미설정 환경 안전장치)', async () => {
    const result = await assessOverallViolation('[발신자] 보증금 반환을 거부', { level: 'S1' }, null)
    assert.deepEqual(result, { skipped: true, reason: 'llm_caller_not_configured' })
  })

  test('P7-03: transcript가 비어있으면 llmCaller 상태와 무관하게 null', async () => {
    let called = false
    const llmCaller = async () => { called = true; return '{}' }
    const result = await assessOverallViolation('', { level: 'S2' }, llmCaller)
    assert.equal(result, null)
    assert.equal(called, false)
  })

  test('P7-04: S1 이상 + llmCaller 주입 시 실제로 호출되고 응답을 정확히 파싱', async () => {
    let capturedArgs = null
    const llmCaller = async (args) => {
      capturedArgs = args
      return '```json\n{"likelihood":0.62,"reasoning":"임대차 분쟁 맥락 확인됨","categories":["CV-2","임대차"],"recommend_review":true}\n```'
    }
    const result = await assessOverallViolation('[발신자] 보증금을 안 돌려줍니다', { level: 'S1' }, llmCaller)

    assert.ok(capturedArgs.systemPrompt.length > 0)
    assert.equal(capturedArgs.userMessage, '[발신자] 보증금을 안 돌려줍니다')

    assert.equal(result.skipped, false)
    assert.equal(result.overallLikelihood, 0.62)
    assert.equal(result.reasoning, '임대차 분쟁 맥락 확인됨')
    assert.deepEqual(result.suggestedCategories, ['CV-2', '임대차'])
    assert.equal(result.recommendReview, true)
  })

  test('P7-05: likelihood 범위 밖 값(예: 1.5)이 와도 0~1로 clamp됨', async () => {
    const llmCaller = async () => '{"likelihood": 1.5, "reasoning":"x", "categories":[], "recommend_review":false}'
    const result = await assessOverallViolation('[발신자] 테스트', { level: 'S2' }, llmCaller)
    assert.equal(result.overallLikelihood, 1)
  })

  test('P7-06: LLM 호출/파싱 실패 시 예외 없이 skipped로 처리(규칙기반 결과만 사용)', async () => {
    const llmCaller = async () => { throw new Error('네트워크 오류') }
    const result = await assessOverallViolation('[발신자] 테스트', { level: 'S1' }, llmCaller)
    assert.equal(result.skipped, true)
    assert.equal(result.reason, 'llm_error')

    const llmCallerBadJson = async () => '이건 JSON이 아님'
    const result2 = await assessOverallViolation('[발신자] 테스트', { level: 'S1' }, llmCallerBadJson)
    assert.equal(result2.skipped, true)
    assert.equal(result2.reason, 'llm_error')
  })

  test('P7-07: 등급이 자동으로 낮아지거나 높아지지 않음(원칙 확인 — recommendReview만 기록)', async () => {
    // Phase 7은 riskResult.level을 직접 바꾸지 않는다 — 반환값에 level 필드가
    // 아예 없다는 것 자체가 "규칙기반 결과를 덮어쓰지 않는다"는 설계 원칙의 증거.
    const llmCaller = async () => '{"likelihood":0.95,"reasoning":"매우 의심됨","categories":[],"recommend_review":true}'
    const result = await assessOverallViolation('[발신자] 테스트', { level: 'S1' }, llmCaller)
    assert.equal('level' in result, false, 'Phase 7 결과에 level 필드가 있으면 안 됨(등급을 직접 바꾸지 않는다는 원칙 위반)')
  })
})

describe('Phase 7 통합 — runPipeline 연동', () => {
  test('P7-08: llmCaller 미주입 시 runPipeline 기존 호출부(3-arg)가 그대로 동작(하위 호환)', async () => {
    await registry.init()
    _resetChain()
    const msg = { content: '안녕하세요', senderId: 'a', receiverId: 'b', encrypted: true }
    const ctx = { senderType: 'person', receiverType: 'person', contextType: 'new', riskHistory: [], aiVerified: true }
    const result = await runPipeline(msg, ctx)  // llmCaller 없이 호출 — 기존 코드와 동일
    assert.deepEqual(result.overallAssessment, { skipped: true, reason: 'rule_based_s0' },
      '평범한 인사말은 S0라 Phase 7이 rule_based_s0로 skip돼야 함')
  })

  test('P7-09: S1 이상을 유발하는 메시지 + llmCaller 주입 시 실제로 Phase 7이 실행됨', async () => {
    registry.clearAll()
    await registry.init()
    await registry.register(new KLawPlugin())
    _resetChain()

    let llmCalled = false
    const llmCaller = async () => {
      llmCalled = true
      return '{"likelihood":0.5,"reasoning":"확인 필요","categories":["CV-2"],"recommend_review":false}'
    }
    const msg = { content: '보증금 반환을 거부하고 있습니다.', senderId: 'a', receiverId: 'b', encrypted: true }
    const ctx = { senderType: 'person', receiverType: 'person', contextType: 'new', riskHistory: [], aiVerified: true }
    const result = await runPipeline(msg, ctx, null, llmCaller)

    assert.notEqual(result.riskResult.level, 'S0', '픽스처 전제 붕괴: 이 메시지가 더 이상 S1을 안 넘음(Phase2/4 수정 회귀 확인 필요)')
    assert.equal(llmCalled, true, 'S0가 아닌데 Phase 7이 호출 안 됨')
    assert.equal(result.overallAssessment.skipped, false)
    assert.equal(result.overallAssessment.overallLikelihood, 0.5)
  })
})
