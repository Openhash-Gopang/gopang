# gopang_v2: 확장 가능한 고팡 인프라 플랫폼
## 단계별 코드 작성 계획서 v3.0

> 근거 문서: GAS v1.6 / GDC Whitepaper v1.5 / KL-S-01 v2.1 / KL-M-02 v1.0 / OpenHash SCI 논문 v2.2  
> 대상 repo: github.com/openhash-gopang/gopang_v2  
> 작성일: 2026-05-22  
> **핵심 변경:** 단일 앱 설계 → 확장 가능한 플랫폼 설계로 전환

---

## 0. 설계 철학: 왜 확장성이 핵심인가

고팡은 K-Law(사법)에서 시작했지만, 최종 목표는 193개국의 **모든 사회 인프라를 AI 쌍둥이로 구현**하는 것이다.

```
현재:  K-Law (사법)
계획:  + K-Health (의료)
       + K-Edu (교육)
       + K-Market (시장)
       + K-Finance (금융)
       + K-Gov (행정)
       + K-Tax (세무)
       + K-Labor (노동)
       + ... (무제한 확장)
```

이것은 단순한 기능 추가가 아니다. 각 인프라 도메인은:
- 독자적인 법령 체계를 가진다
- 독자적인 AI 모델이 필요하다
- 독자적인 UI/UX를 요구한다
- 독자적인 데이터 스키마를 가진다

따라서 gopang_v2는 **"앱"이 아니라 "플랫폼"으로 설계**되어야 한다.

---

## 1. 핵심 설계 원칙 3가지

### 원칙 1: Plugin Architecture (플러그인 아키텍처)
모든 도메인 인프라(K-Law, K-Health 등)는 **플러그인**으로 구현한다.
- 플랫폼 코어는 절대 변경하지 않는다
- 새 도메인 추가 = 새 플러그인 파일 1개 작성
- 기존 도메인 수정 = 해당 플러그인 파일만 수정
- 버그는 플러그인 단위로 격리된다

### 원칙 2: Interface Contract (인터페이스 계약)
모든 플러그인은 동일한 인터페이스를 구현해야 한다.
```javascript
// 모든 도메인 플러그인이 반드시 구현해야 하는 인터페이스
interface GopangDomainPlugin {
  metadata: DomainMetadata       // 도메인 식별 정보
  legalClassifier: Classifier    // 법령 분류기
  riskRules: RiskRule[]          // 위험 판정 규칙
  uiComponents: ComponentMap     // UI 컴포넌트
  apiEndpoints: EndpointMap      // API 엔드포인트
  dataSchema: Schema             // 데이터 스키마
  version: string                // 버전 (semver)
  changelog: string[]            // 변경 이력
}
```

### 원칙 3: Event-Driven Communication (이벤트 기반 통신)
플러그인 간 직접 참조를 금지한다. 모든 통신은 중앙 이벤트 버스를 통한다.
```
K-Law ──→ EventBus ──→ K-Finance  (직접 참조 금지)
K-Health ──→ EventBus ──→ K-Gov
```
이로써 플러그인 간 결합도가 0이 되어, 하나의 플러그인 버그가 다른 플러그인에 영향을 주지 않는다.

---

## 2. 최종 디렉토리 구조

```
gopang_v2/
│
├── src/
│   │
│   ├── core/                          ← 절대 변경하지 않는 플랫폼 코어
│   │   ├── plugin-registry.js         ← 플러그인 등록·로딩·버전 관리
│   │   ├── event-bus.js               ← 플러그인 간 이벤트 통신
│   │   ├── plugin-interface.js        ← 플러그인 인터페이스 계약 정의
│   │   └── plugin-validator.js        ← 플러그인 유효성 검사
│   │
│   ├── pdv/                           ← PDV 레이어 (코어급, 불변)
│   │   ├── keyManager.js
│   │   ├── vault.js
│   │   └── evidencePackage.js
│   │
│   ├── openhash/                      ← OpenHash 레이어 (코어급, 불변)
│   │   ├── plsm.js
│   │   ├── hashChain.js
│   │   ├── bivm.js
│   │   ├── ilmv.js
│   │   ├── lpbft.js
│   │   ├── importanceVerifier.js
│   │   └── transactionPipeline.js
│   │
│   ├── ai-secretary/                  ← AI 비서 코어 (Phase 0~6, 도메인 무관)
│   │   ├── pipeline.js                ← Phase 0~6 오케스트레이터
│   │   ├── phase0.js
│   │   ├── phase1.js
│   │   ├── phase2.js                  ← 법령 분류 (플러그인에서 주입)
│   │   ├── phase3.js
│   │   ├── phase4.js
│   │   ├── phase5.js
│   │   ├── phase6.js
│   │   └── agentProtocol.js
│   │
│   ├── network/                       ← 네트워크 레이어 (코어급, 불변)
│   │   ├── layerClient.js
│   │   ├── gasAddress.js
│   │   └── dht.js
│   │
│   ├── gdc/                           ← GDC 경제 레이어
│   │   ├── tokenomics.js
│   │   ├── smartVault.js
│   │   ├── currencyPool.js
│   │   ├── escrow.js
│   │   ├── dao.js
│   │   └── offlineQueue.js
│   │
│   ├── privacy/                       ← 프라이버시 레이어
│   │   ├── mixnet.js
│   │   ├── pir.js
│   │   ├── kAnonymity.js
│   │   ├── adaptivePow.js
│   │   ├── salt.js
│   │   └── socialRecovery.js
│   │
│   └── domains/                       ← 도메인 플러그인 (무제한 확장)
│       │
│       ├── _template/                 ← 새 도메인 추가 시 복사해서 사용
│       │   ├── index.js               ← 플러그인 진입점
│       │   ├── classifier.js          ← 법령/규칙 분류기
│       │   ├── risk-rules.js          ← 위험 판정 규칙
│       │   ├── ui.js                  ← UI 컴포넌트
│       │   ├── api.js                 ← API 엔드포인트
│       │   ├── schema.js              ← 데이터 스키마
│       │   ├── CHANGELOG.md           ← 변경 이력
│       │   └── README.md              ← 도메인 문서
│       │
│       ├── k-law/                     ← 사법 (1호 플러그인, 기준)
│       │   ├── index.js
│       │   ├── classifier.js          ← CR-1~5, CV-1~4, LB-1~2, CC-1~2
│       │   ├── risk-rules.js
│       │   ├── ui.js
│       │   ├── api.js
│       │   ├── schema.js
│       │   ├── CHANGELOG.md
│       │   └── README.md
│       │
│       ├── k-health/                  ← 의료 (2호 플러그인)
│       │   ├── index.js
│       │   ├── classifier.js          ← 의료법, 개인정보보호법(의료), 약사법
│       │   ├── risk-rules.js          ← 의료분쟁, 처방 위법, 개인정보 침해
│       │   ├── ui.js
│       │   ├── api.js
│       │   ├── schema.js
│       │   ├── CHANGELOG.md
│       │   └── README.md
│       │
│       ├── k-edu/                     ← 교육
│       │   └── ...
│       │
│       ├── k-market/                  ← 시장·전자상거래
│       │   └── ...
│       │
│       ├── k-finance/                 ← 금융
│       │   └── ...
│       │
│       └── k-gov/                     ← 정부행정
│           └── ...
│
├── index.html                         ← 플랫폼 Shell UI
├── build.py                           ← 빌드 스크립트
├── gopang/prompts/
├── klaw/prompts/
└── docs/
```

---

## 3. 플랫폼 코어 설계

### 3-1. 플러그인 레지스트리 (`src/core/plugin-registry.js`)

플랫폼의 심장. 모든 도메인 플러그인을 관리한다.

```javascript
class PluginRegistry {

  constructor() {
    this.plugins = new Map()    // name → plugin
    this.versions = new Map()   // name → semver
  }

  // 플러그인 등록 (자동 유효성 검사 포함)
  async register(plugin) {
    await PluginValidator.validate(plugin)       // 인터페이스 계약 확인
    this.plugins.set(plugin.metadata.name, plugin)
    this.versions.set(plugin.metadata.name, plugin.version)
    EventBus.emit('plugin:registered', plugin.metadata)
    console.log(`[Registry] ${plugin.metadata.name} v${plugin.version} 등록 완료`)
  }

  // 플러그인 업데이트 (기존 버전 대체, 하위 호환성 검사)
  async update(plugin) {
    const prev = this.versions.get(plugin.metadata.name)
    if (!this.isCompatible(prev, plugin.version)) {
      throw new Error(`BREAKING_CHANGE: ${prev} → ${plugin.version}`)
    }
    await this.register(plugin)
    EventBus.emit('plugin:updated', { name: plugin.metadata.name, from: prev, to: plugin.version })
  }

  // 특정 플러그인 조회
  get(name) { return this.plugins.get(name) }

  // 등록된 모든 플러그인 목록
  list() { return [...this.plugins.values()].map(p => p.metadata) }

  // semver 하위 호환성 확인 (major 버전 변경 = breaking change)
  isCompatible(prev, next) {
    return semverMajor(prev) === semverMajor(next)
  }
}

export const registry = new PluginRegistry()
```

### 3-2. 이벤트 버스 (`src/core/event-bus.js`)

플러그인 간 직접 참조를 없애는 핵심 메커니즘.

```javascript
class EventBus {

  constructor() {
    this.listeners = new Map()  // event → handler[]
    this.history   = []         // 디버깅용 이벤트 로그
  }

  on(event, handler, pluginName) {
    if (!this.listeners.has(event)) this.listeners.set(event, [])
    this.listeners.get(event).push({ handler, pluginName })
  }

  emit(event, data) {
    const entry = { event, data, ts: Date.now() }
    this.history.push(entry)                        // 디버깅 로그

    const handlers = this.listeners.get(event) ?? []
    for (const { handler, pluginName } of handlers) {
      try {
        handler(data)
      } catch (err) {
        // 핵심: 한 플러그인의 오류가 다른 플러그인에 전파되지 않음
        console.error(`[EventBus] ${pluginName} 핸들러 오류:`, err)
        this.emit('plugin:error', { pluginName, event, err })
      }
    }
  }

  // 디버깅: 최근 N개 이벤트 조회
  getHistory(n = 50) { return this.history.slice(-n) }
}

export const EventBus = new EventBus()

// 표준 이벤트 목록 (플러그인 간 공통 언어)
export const EVENTS = {
  // 플러그인 생명주기
  PLUGIN_REGISTERED:   'plugin:registered',
  PLUGIN_UPDATED:      'plugin:updated',
  PLUGIN_ERROR:        'plugin:error',

  // 메시지 파이프라인
  MSG_RECEIVED:        'msg:received',
  MSG_RISK_ASSESSED:   'msg:risk-assessed',    // AI 비서 판정 완료
  MSG_BLOCKED:         'msg:blocked',
  MSG_ANCHORED:        'msg:anchored',         // OpenHash 앵커링 완료

  // 도메인 크로스 이벤트
  LEGAL_DISPUTE:       'domain:legal-dispute', // K-Law 분쟁 감지
  MEDICAL_ALERT:       'domain:medical-alert', // K-Health 이상 감지
  FINANCIAL_ALERT:     'domain:financial-alert',

  // GDC
  GDC_ESCROW_CREATED:  'gdc:escrow-created',
  GDC_KLAW_EXECUTED:   'gdc:klaw-executed',   // K-Law 판결 → 에스크로 자동 집행
}
```

### 3-3. 플러그인 인터페이스 계약 (`src/core/plugin-interface.js`)

모든 플러그인이 반드시 구현해야 하는 계약.

```javascript
// 모든 도메인 플러그인의 기준 인터페이스
// 이것을 구현하지 않으면 registry.register() 시 오류 발생

export class GopangDomainPlugin {

  // ── 필수: 메타데이터 ──────────────────────────────────
  metadata = {
    name:        '',      // 'k-law' | 'k-health' | 'k-edu' | ...
    displayName: '',      // 'K-Law (사법)' | 'K-Health (의료)' | ...
    version:     '0.0.0', // semver
    description: '',
    icon:        '',      // emoji or SVG
    author:      'AI City Inc.',
    legalDomains: [],     // 관할 법령 도메인 목록
  }

  // ── 필수: AI 비서 Phase 2 주입 (법령 분류기) ──────────
  // AI 비서 Phase 2는 이 분류기를 동적으로 로딩한다
  // K-Law: CR-1~5, CV-1~4, LB-1~2, CC-1~2
  // K-Health: 의료법, 약사법, 의료분쟁조정법 ...
  legalClassifier = {
    categories: [],       // 법령 카테고리 정의
    classify(message) {}, // 메시지 → 법령 카테고리 매핑
    getFastPathTriggers(), // Fast-Path 트리거 목록 반환
  }

  // ── 필수: 위험 판정 규칙 ──────────────────────────────
  riskRules = []
  // 예: [{ id:'MED-01', pattern:/무허가.*처방/, score:0.90, desc:'무허가 의료행위' }]

  // ── 필수: UI 컴포넌트 ─────────────────────────────────
  uiComponents = {
    dashboardWidget: null,  // 메인 대시보드 위젯
    chatBadge: null,        // 채팅 위험 배지
    reportPanel: null,      // 상세 보고 패널
  }

  // ── 필수: API 엔드포인트 ──────────────────────────────
  apiEndpoints = {
    analyze:  null,  // POST /domain/{name}/analyze
    report:   null,  // GET  /domain/{name}/report/{id}
    verify:   null,  // POST /domain/{name}/verify
  }

  // ── 필수: 데이터 스키마 ───────────────────────────────
  dataSchema = {
    messageRecord: {},    // vault.js MessageStore 확장 필드
    reportRecord:  {},    // 도메인별 보고서 스키마
  }

  // ── 필수: 생명주기 훅 ─────────────────────────────────
  async onLoad()   {}    // 플러그인 로드 시
  async onUnload() {}    // 플러그인 언로드 시
  async onUpdate(prevVersion) {}  // 버전 업데이트 시

  // ── 선택: 이벤트 구독 ─────────────────────────────────
  eventSubscriptions = []
  // 예: [{ event: EVENTS.MSG_RISK_ASSESSED, handler: this.onRiskAssessed }]
}
```

### 3-4. 플러그인 유효성 검사 (`src/core/plugin-validator.js`)

```javascript
export class PluginValidator {
  static REQUIRED_FIELDS = [
    'metadata.name', 'metadata.version', 'metadata.displayName',
    'legalClassifier', 'riskRules', 'uiComponents',
    'apiEndpoints', 'dataSchema',
    'onLoad', 'onUnload', 'onUpdate'
  ]

  static async validate(plugin) {
    // 1. 필수 필드 존재 확인
    for (const field of this.REQUIRED_FIELDS) {
      if (!getNestedValue(plugin, field)) {
        throw new Error(`Plugin ${plugin.metadata?.name}: 필수 필드 누락 — ${field}`)
      }
    }

    // 2. semver 형식 확인
    if (!isSemver(plugin.version)) {
      throw new Error(`Plugin ${plugin.metadata.name}: 잘못된 버전 형식 — ${plugin.version}`)
    }

    // 3. 법령 분류기 동작 확인
    const testMsg = { content: 'test', context: {} }
    await plugin.legalClassifier.classify(testMsg)

    // 4. 이름 중복 확인 (업데이트 시 제외)
    // registry.register() 에서 처리

    return true
  }
}
```

---

## 4. AI 비서 파이프라인 — 도메인 동적 주입

AI 비서 코어는 도메인을 모른다. 플러그인이 법령 분류기를 주입한다.

### `src/ai-secretary/pipeline.js` — Phase 0~6 오케스트레이터

```javascript
import { registry } from '../core/plugin-registry.js'
import { EventBus, EVENTS } from '../core/event-bus.js'

class AISeniorPipeline {

  // 메시지 수신 → Phase 0~6 순차 실행
  async process(message, context) {

    EventBus.emit(EVENTS.MSG_RECEIVED, { message, context })

    // Phase 0: 소통 객체 식별 (도메인 무관)
    const commObject = await phase0.identify(message, context)

    // Phase 1: SU 태깅 + Fast-Path
    // ★ 활성화된 모든 플러그인의 Fast-Path 트리거를 통합
    const allFastPathTriggers = registry.list()
      .flatMap(p => registry.get(p.name).legalClassifier.getFastPathTriggers())

    const { suList, fastPathResult } = await phase1.analyze(message, allFastPathTriggers)

    if (fastPathResult) {
      // Fast-Path 트리거 → Phase 4 직행
      return await this.finalize(message, fastPathResult, commObject)
    }

    // Phase 2: 법령 분류
    // ★ 핵심: 활성화된 플러그인의 분류기를 동적으로 조합
    const activeDomains = registry.list().map(p => p.name)
    const legalResults = await phase2.classify(suList, activeDomains)
    // legalResults = { 'k-law': [...], 'k-health': [...], 'k-market': [...] }

    // Phase 3: 문서 분석 (첨부 파일 있을 때)
    const docResult = commObject.hasAttachment
      ? await phase3.analyze(message.attachment, legalResults)
      : null

    // Phase 4: WS 공식 쌍방향 점수 산출
    const scoreResult = await phase4.calculateScore(suList, legalResults, docResult, commObject)

    // Phase 5: 위험 등급 판정
    const riskResult = await phase5.classify(scoreResult)

    // Phase 6: PDV 기록 + OpenHash 앵커링
    const { msgId, anchorHash } = await phase6.recordAndAnchor(message, riskResult)

    EventBus.emit(EVENTS.MSG_RISK_ASSESSED, { msgId, riskResult, activeDomains })

    return { msgId, anchorHash, riskResult }
  }
}
```

### `src/ai-secretary/phase2.js` — 플러그인 주입 법령 분류

```javascript
// Phase 2는 플러그인 레지스트리에서 분류기를 동적으로 로딩
async function classify(suList, activeDomainNames) {
  const results = {}

  for (const name of activeDomainNames) {
    const plugin = registry.get(name)
    try {
      // 각 플러그인의 독자적 법령 분류기 실행
      results[name] = await plugin.legalClassifier.classify(suList)
    } catch (err) {
      // 하나의 플러그인 오류가 다른 분류에 영향 없음
      console.error(`[Phase2] ${name} 분류기 오류:`, err)
      results[name] = { error: err.message, flags: [] }
    }
  }

  return results
}
```

---

## 5. 도메인 플러그인 구현

### 5-1. 플러그인 템플릿 (`src/domains/_template/index.js`)

새 도메인 추가 시 이 파일을 복사한다. **이것이 전부다.**

```javascript
import { GopangDomainPlugin } from '../../core/plugin-interface.js'
import { classifier } from './classifier.js'
import { riskRules } from './risk-rules.js'
import { uiComponents } from './ui.js'
import { apiEndpoints } from './api.js'
import { dataSchema } from './schema.js'

export default class TemplateDomainPlugin extends GopangDomainPlugin {

  metadata = {
    name:        'k-template',         // ← 변경
    displayName: 'K-Template (설명)', // ← 변경
    version:     '1.0.0',
    description: '도메인 설명',       // ← 변경
    icon:        '🏛️',               // ← 변경
    author:      'AI City Inc.',
    legalDomains: ['관할법령1', '관할법령2'],  // ← 변경
  }

  legalClassifier = classifier
  riskRules        = riskRules
  uiComponents     = uiComponents
  apiEndpoints     = apiEndpoints
  dataSchema       = dataSchema

  async onLoad() {
    console.log(`[${this.metadata.name}] 플러그인 로드`)
    // 이벤트 구독 등록
    for (const { event, handler } of this.eventSubscriptions) {
      EventBus.on(event, handler, this.metadata.name)
    }
  }

  async onUnload() {
    console.log(`[${this.metadata.name}] 플러그인 언로드`)
  }

  async onUpdate(prevVersion) {
    console.log(`[${this.metadata.name}] ${prevVersion} → ${this.version} 업데이트`)
    // 마이그레이션 로직 (필요 시)
  }
}
```

### 5-2. K-Law 플러그인 (`src/domains/k-law/index.js`)

1호 플러그인. 다른 플러그인의 기준이 된다.

```javascript
export default class KLawPlugin extends GopangDomainPlugin {

  metadata = {
    name:        'k-law',
    displayName: 'K-Law (사법)',
    version:     '1.0.0',
    icon:        '⚖️',
    legalDomains: ['형법', '민법', '근로기준법', '소비자보호법', '개인정보보호법'],
  }

  // classifier.js: CR-1~5, CV-1~4, LB-1~2, CC-1~2
  // risk-rules.js: KL-M-02 Fast-Path 트리거 FP-01~n
  // Phase 6 이후 K-Law 전용 에스크로 연동

  eventSubscriptions = [
    {
      event:   EVENTS.MSG_RISK_ASSESSED,
      handler: (data) => {
        if (data.riskResult['k-law']?.level === 'S3') {
          EventBus.emit(EVENTS.LEGAL_DISPUTE, data)
          // GDC 에스크로 자동 생성 제안
          EventBus.emit(EVENTS.GDC_ESCROW_CREATED, {
            reason: 'S3_LEGAL_RISK',
            msgId: data.msgId
          })
        }
      }
    }
  ]
}
```

### 5-3. K-Health 플러그인 (`src/domains/k-health/index.js`)

```javascript
export default class KHealthPlugin extends GopangDomainPlugin {

  metadata = {
    name:        'k-health',
    displayName: 'K-Health (의료)',
    version:     '1.0.0',
    icon:        '🏥',
    legalDomains: ['의료법', '약사법', '의료분쟁조정법', '개인정보보호법(의료)'],
  }

  // classifier.js 법령 분류 예시:
  // MED-01: 무허가 의료행위 (의료법 §27)
  // MED-02: 처방전 위조 (약사법 §23)
  // MED-03: 환자 개인정보 침해 (개인정보보호법 §23)
  // MED-04: 의료 광고 위반 (의료법 §56)
  // MED-05: 불법 의약품 거래

  // risk-rules.js Fast-Path 예시:
  // { id:'HFPA-01', pattern:/처방전.*없이.*구매/, score:0.92 }
  // { id:'HFPA-02', pattern:/의사.*자격.*없이.*진료/, score:0.95 }

  eventSubscriptions = [
    {
      event: EVENTS.MSG_RISK_ASSESSED,
      handler: (data) => {
        if (data.riskResult['k-health']?.level === 'S2') {
          EventBus.emit(EVENTS.MEDICAL_ALERT, data)
        }
      }
    }
  ]
}
```

### 5-4. K-Finance 플러그인 (`src/domains/k-finance/`)

```javascript
// classifier.js 법령 분류 예시:
// FIN-01: 무허가 금융업 (자본시장법 §11)
// FIN-02: 다단계 금융 (방문판매법 §2)
// FIN-03: 내부자 거래 (자본시장법 §174)
// FIN-04: 불법 대출 (대부업법 §11)
// FIN-05: AML 위반 (특정금융거래정보보고법)
// FIN-06: 보이스피싱 (→ K-Law CR-3과 크로스 도메인)

// K-Law CR-3(보이스피싱)과 FIN-06(금융사기)이 동시 감지될 때
// EventBus를 통해 두 플러그인이 협력
```

### 5-5. K-Gov 플러그인 (`src/domains/k-gov/`)

```javascript
// classifier.js 법령 분류 예시:
// GOV-01: 공문서 위조 (형법 §225)
// GOV-02: 뇌물 (형법 §129)
// GOV-03: 행정정보 무단 접근 (전자정부법)
// GOV-04: 허위 민원 신청
// GOV-05: 개인정보 행정목적 외 이용

// 기관 AI 협업 (KL-S-01 §3.4) 7단계 프로토콜 — K-Gov에서 주로 발동
// 국세청AI, 병원AI, 금융기관AI와의 자율 처리
```

---

## 6. 버전 관리 및 변경 이력

각 플러그인은 독립적인 semver와 CHANGELOG를 가진다.

### `src/domains/k-law/CHANGELOG.md` 예시

```markdown
# K-Law Plugin Changelog

## [1.2.0] - 2026-06-15
### Added
- CV-5: 전세 사기 특별법 분류기 추가
- Fast-Path FP-07: 보증금 편취 패턴

## [1.1.0] - 2026-06-01
### Changed
- CV-2 임대차 위법성 탐지율 93.3% → 96.1% (모델 개선)

## [1.0.0] - 2026-05-22
### Initial Release
- CR-1~5, CV-1~4, LB-1~2, CC-1~2 구현
```

### 플러그인 업데이트 명령어 (코드 2줄)

```javascript
// 새 버전 플러그인 배포 — 기존 코드 변경 없음
import KLawPluginV2 from './domains/k-law/index.v2.js'
await registry.update(KLawPluginV2)
// 끝. 다른 모든 도메인은 영향 없음.
```

### 새 도메인 추가 명령어 (코드 2줄)

```javascript
// 새 도메인 플러그인 추가 — 기존 코드 변경 없음
import KHealthPlugin from './domains/k-health/index.js'
await registry.register(KHealthPlugin)
// 끝. AI 비서가 자동으로 K-Health 법령 분류기를 통합.
```

---

## 7. 단계별 구현 계획

### PHASE 1: 플랫폼 코어 구현 (1주)
**파일:** `src/core/`

| 모듈 | 설명 | 완료 기준 |
|------|------|---------|
| `plugin-registry.js` | 플러그인 등록·업데이트·조회 | 등록→조회→업데이트 동작 |
| `event-bus.js` | 이벤트 발행·구독·오류 격리 | 오류 전파 차단 확인 |
| `plugin-interface.js` | 인터페이스 계약 정의 | 문서화 완료 |
| `plugin-validator.js` | 필수 필드·semver 검사 | 누락 필드 오류 발생 확인 |
| `_template/` | 플러그인 템플릿 7개 파일 | 복사 후 즉시 등록 가능 |

### PHASE 2: PDV + OpenHash 레이어 (1.5주)
**파일:** `src/pdv/` `src/openhash/`

v2.0 계획서 내용 그대로 유지 (코어 레이어, 도메인 무관).

| 모듈 | 완료 기준 |
|------|---------|
| `keyManager.js` | Ed25519 서명·삼중 서명 동작 |
| `vault.js` | IndexedDB 암호화 저장·조회 |
| `evidencePackage.js` | 1.2초 이내 생성 |
| `plsm.js` | χ² p>0.99 균일 분포 |
| `hashChain.js` | 즉시 앵커링 + Merkle 배치 |
| `bivm.js` | BMI 위변조 3/3 탐지 |
| `ilmv.js` | 하향·상향 감사 동작 |
| `lpbft.js` | 0.759ms 목표 로컬 시뮬 |
| `importanceVerifier.js` | 경량·표준·강화 모드 선택 |
| `transactionPipeline.js` | Stage 1~5 전체 동작 |

### PHASE 3: AI 비서 파이프라인 (1.5주)
**파일:** `src/ai-secretary/`

| 모듈 | 핵심 변경 (v2.0 대비) | 완료 기준 |
|------|---------------------|---------|
| `pipeline.js` | 플러그인 동적 주입 오케스트레이터 신규 | 2개 플러그인 동시 처리 확인 |
| `phase0.js` | 동일 | — |
| `phase1.js` | Fast-Path 트리거 플러그인에서 통합 로딩 | 플러그인별 트리거 병합 동작 |
| `phase2.js` | 플러그인 분류기 동적 로딩 | 도메인별 독립 분류 결과 반환 |
| `phase3.js` | 동일 (DOC-1~4) | — |
| `phase4.js` | 도메인별 점수 통합 WS 공식 | 다중 도메인 점수 합산 |
| `phase5.js` | 동일 (S0~S3) | — |
| `phase6.js` | 도메인별 기록 필드 확장 저장 | 다중 도메인 플래그 저장 |
| `agentProtocol.js` | 동일 (AI 간 협업 7단계) | — |

### PHASE 4: K-Law 플러그인 구현 (0.5주)
**파일:** `src/domains/k-law/`

1호 플러그인. 템플릿을 검증하고 다른 플러그인의 기준이 된다.

| 파일 | 내용 |
|------|------|
| `index.js` | 플러그인 진입점 + 이벤트 구독 |
| `classifier.js` | CR-1~5, CV-1~4, LB-1~2, CC-1~2 |
| `risk-rules.js` | KL-M-02 Fast-Path FP-01~n |
| `ui.js` | K-Law 전용 UI 컴포넌트 |
| `api.js` | `/verify/signature`, `/evidence-report` |
| `schema.js` | K-Law 전용 데이터 스키마 |
| `CHANGELOG.md` | v1.0.0 초기 릴리스 |

### PHASE 5: Network + GDC + Privacy 레이어 (1.5주)
**파일:** `src/network/` `src/gdc/` `src/privacy/`

v2.0 계획서 내용 그대로 유지.

### PHASE 6: K-Health 플러그인 구현 (0.5주)
**파일:** `src/domains/k-health/`

2호 플러그인. 플러그인 아키텍처의 확장성을 실증한다.
- `_template/` 복사 → 의료 법령 분류기 작성
- 코어 코드 변경 없이 K-Health AI 비서 통합 확인

### PHASE 7: index.html Shell UI 통합 (0.5주)

```
플랫폼 Shell UI:
  ┌─────────────────────────────────┐
  │  도메인 선택 탭                  │
  │  [⚖️ K-Law] [🏥 K-Health] [+]  │
  ├─────────────────────────────────┤
  │  메신저 + AI 비서 (도메인 공통)  │
  │  위험 배지: [S0 안전 · K-Law]   │
  │             [S1 주의 · K-Health]│
  ├─────────────────────────────────┤
  │  PDV 상태 / GDC 지갑            │
  └─────────────────────────────────┘
```

### PHASE 8: 테스트 + 성능 검증 (0.5주)

| 테스트 | 기대 결과 |
|--------|---------|
| K-Law + K-Health 동시 활성화 | 두 도메인 독립 판정, 오류 미전파 |
| K-Health 플러그인 오류 주입 | K-Law 정상 동작 유지 |
| K-Law v1.1.0 업데이트 | 다른 플러그인 영향 없음 |
| 새 플러그인 hot-register | 앱 재시작 없이 즉시 활성화 |
| 보이스피싱 (K-Law + K-Finance 동시) | 두 도메인 동시 S3 감지 |

---

## 8. 확장 로드맵

### 단기 (2026년 내)
```
k-law      v1.0.0  ← Phase 4에서 구현
k-health   v1.0.0  ← Phase 6에서 구현
k-market   v1.0.0  ← 추후 (템플릿 복사, 2~3일)
k-finance  v1.0.0  ← 추후 (템플릿 복사, 2~3일)
```

### 중기 (2027년)
```
k-gov      v1.0.0  ← 정부행정
k-edu      v1.0.0  ← 교육
k-labor    v1.0.0  ← 노동
k-tax      v1.0.0  ← 세무
```

### 장기 (2028년~)
```
k-env      v1.0.0  ← 환경
k-ip       v1.0.0  ← 지식재산
k-trade    v1.0.0  ← 무역·통관
k-criminal v1.0.0  ← 형사
... (193개국 각 도메인 현지화)
```

**새 도메인 추가 소요 시간 (플러그인 아키텍처 덕분에):**
- 템플릿 복사: 5분
- 법령 분류기 작성: 1~3일
- UI 컴포넌트: 0.5~1일
- 테스트: 0.5일
- **총합: 약 2~5일 (코어 수정 없음)**

---

## 9. v2.0 대비 핵심 변경 요약

| 항목 | v2.0 | v3.0 |
|------|------|------|
| 설계 방식 | 단일 앱 | 플러그인 플랫폼 |
| 도메인 추가 방법 | 코어 수정 필요 | 플러그인 파일 1개 추가 |
| 버그 격리 | 전체 영향 가능 | 플러그인 단위 격리 |
| 버전 관리 | 앱 전체 단일 버전 | 플러그인별 독립 semver |
| 도메인 간 통신 | 직접 참조 | EventBus 경유 |
| Phase 2 법령 분류 | K-Law 고정 | 플러그인 동적 주입 |
| 확장 비용 | 높음 (코어 수정) | 낮음 (템플릿 복사) |
| 총 모듈 수 | 33개 | 코어 37개 + 도메인 무제한 |
| 코어 Phase 수 | 6 | 8 |

---

*© 2026 AI City Inc. — gopang_v2 구현 계획서 v3.0*
*플러그인 아키텍처 도입: 모든 사회 인프라의 AI 쌍둥이를 향한 확장 가능한 플랫폼*
