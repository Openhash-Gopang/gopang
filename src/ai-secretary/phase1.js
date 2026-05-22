/**
 * @file phase1.js
 * @description AI 비서 Phase 1 — 형태소 분석·SU 태깅·Fast-Path·Context-Path
 * @version 1.0.0
 * @author AI City Inc.
 *
 * 근거: KL-M-02 Phase 1
 *   - SU 태그 체계: SU_FACT/REQUEST/PROMISE/THREAT/DECEIVE/SOLICIT/LEGAL/NEUTRAL
 *   - Fast-Path: 고위험 즉각 탐지 → Phase 4 직행 (0.81ms 목표)
 *   - Context-Path: Fast-Path 미트리거 시 맥락 종합 평가
 *   - 처리 시간: 단문 0.3ms / 장문 1.0ms / 문서 15ms
 */

import { MSG_TYPE } from './phase0.js'

// ── SU 태그 ──────────────────────────────────────────────────────────────
export const SU_TAG = Object.freeze({
  FACT:    'SU_FACT',     // 사실 진술 ("내일 이체하겠다")
  REQUEST: 'SU_REQUEST',  // 요청·지시 ("계좌번호 보내줘")
  PROMISE: 'SU_PROMISE',  // 약속·합의 ("반드시 드리겠습니다")
  THREAT:  'SU_THREAT',   // 위협·강압 ("안 하면 고소한다")
  DECEIVE: 'SU_DECEIVE',  // 기망·허위 ("금감원에서 나왔다")
  SOLICIT: 'SU_SOLICIT',  // 범죄 권유·공모 ("같이 하면 수익 50%")
  LEGAL:   'SU_LEGAL',    // 법적 효과 진술 ("계약을 해지합니다")
  NEUTRAL: 'SU_NEUTRAL',  // 위험 없는 일반 ("안녕하세요")
})

// ── 기본 Fast-Path 트리거 (플러그인 트리거와 병합됨) ─────────────────────
export const BASE_FAST_PATH = Object.freeze([
  { id:'FP-01', pattern:/금감원|검찰청|경찰청|국세청.*직원|수사관입니다/, score:0.95, tag:SU_TAG.DECEIVE, desc:'기관 사칭' },
  { id:'FP-02', pattern:/계좌번호.*지금당장|지금바로.*송금|즉시.*이체/, score:0.90, tag:SU_TAG.SOLICIT, desc:'긴급 송금 유도' },
  { id:'FP-03', pattern:/보이스피싱|사기전화|스미싱/, score:0.85, tag:SU_TAG.THREAT, desc:'보이스피싱 키워드' },
  { id:'FP-04', pattern:/협박|죽여버리겠|폭행하겠/, score:0.92, tag:SU_TAG.THREAT, desc:'폭력 위협' },
  { id:'FP-05', pattern:/대출.*미끼|투자.*원금보장|수익률.*보장/, score:0.88, tag:SU_TAG.SOLICIT, desc:'불법 금융 권유' },
])

// ── SU 태그 패턴 ─────────────────────────────────────────────────────────
const SU_PATTERNS = [
  { tag: SU_TAG.THREAT,  pattern: /안\s*하면|고소|신고|협박|죽|폭행|해코지/ },
  { tag: SU_TAG.DECEIVE, pattern: /금감원|검찰|경찰|직원|수사관|담당자입니다|나왔습니다/ },
  { tag: SU_TAG.SOLICIT, pattern: /같이.*수익|투자.*권유|함께.*벌|수당|다단계/ },
  { tag: SU_TAG.PROMISE, pattern: /반드시|꼭|드리겠|하겠습니다|약속/ },
  { tag: SU_TAG.REQUEST, pattern: /보내줘|알려줘|계좌번호|주민번호|비밀번호|송금/ },
  { tag: SU_TAG.LEGAL,   pattern: /계약.*해지|해지.*통보|내용증명|소송|고소장/ },
  { tag: SU_TAG.FACT,    pattern: /했습니다|됩니다|입니다|있습니다/ },
]

/**
 * Phase 1: 형태소 분석 + SU 태깅 + Fast-Path/Context-Path
 *
 * @param {string}  content          - 메시지 내용
 * @param {string}  msgType          - Phase 0 결과 MSG_TYPE
 * @param {Array}   pluginTriggers   - 플러그인이 주입한 Fast-Path 트리거
 * @returns {{
 *   suList:          Array,
 *   fastPathResult:  Object|null,
 *   p1Score:         number,
 *   processingMs:    number
 * }}
 */
export function analyzePhase1(content, msgType, pluginTriggers = []) {
  const t0 = performance.now()

  // 전처리: 정규화
  const normalized = _normalize(content)

  // Fast-Path 스캔 (BASE + 플러그인 트리거 병합)
  const allTriggers = [...BASE_FAST_PATH, ...pluginTriggers]
  const fastPathResult = _fastPathScan(normalized, allTriggers)

  if (fastPathResult) {
    // Fast-Path 트리거 → Phase 4 직행
    const processingMs = performance.now() - t0
    return {
      suList:       [{ id:'SU_FP', text: content.slice(0,100), tag: fastPathResult.tag, confidence: fastPathResult.score }],
      fastPathResult,
      p1Score:      fastPathResult.score,
      processingMs: parseFloat(processingMs.toFixed(3)),
    }
  }

  // Context-Path: SU 태깅
  const suList = _tagSU(normalized, content)

  // P1 점수 계산 (위험 SU의 최대 신뢰도)
  const dangerTags = [SU_TAG.THREAT, SU_TAG.DECEIVE, SU_TAG.SOLICIT]
  const p1Score = suList
    .filter(su => dangerTags.includes(su.tag))
    .reduce((max, su) => Math.max(max, su.confidence), 0)

  const processingMs = performance.now() - t0

  return {
    suList,
    fastPathResult: null,
    p1Score:        parseFloat(p1Score.toFixed(4)),
    processingMs:   parseFloat(processingMs.toFixed(3)),
  }
}

// ── Private ───────────────────────────────────────────────────────────────

/** 텍스트 정규화 (은어·축약어 확장, 유니코드 정규화) */
function _normalize(text) {
  return text
    .normalize('NFC')
    .replace(/ㅈㅅ/g,  '죄송합니다')
    .replace(/ㅇㅋ/g,  '알겠습니다')
    .replace(/ㄱㅅ/g,  '감사합니다')
    .trim()
}

/** Fast-Path 스캔 */
function _fastPathScan(text, triggers) {
  for (const trigger of triggers) {
    if (trigger.pattern.test(text)) {
      return { ...trigger, triggered: true }
    }
  }
  return null
}

/** SU 태깅 */
function _tagSU(normalized, original) {
  const sentences = original.split(/(?<=[.!?。])\s+|(?<=\n)/).filter(s => s.trim())
  if (sentences.length === 0) sentences.push(original)

  return sentences.map((sentence, i) => {
    const matched = SU_PATTERNS.find(p => p.pattern.test(sentence))
    return {
      id:         `SU_${String(i + 1).padStart(3, '0')}`,
      text:       sentence.slice(0, 100),
      tag:        matched?.tag ?? SU_TAG.NEUTRAL,
      confidence: matched ? 0.75 : 0.10,
    }
  })
}
