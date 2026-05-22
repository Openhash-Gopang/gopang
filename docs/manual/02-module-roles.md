# 02 — 모듈 역할 & 핵심 인터페이스

---

## Core 레이어 (`src/core/`) ⚠️ 절대 변경 금지

### `constants.js`
**역할:** 시스템 전체 매직 넘버 일원화. 이 파일만 수정하면 전체 동작이 바뀐다.

```javascript
EVENTS.MSG_RECEIVED          // 메시지 수신
EVENTS.MSG_RISK_ASSESSED     // AI 위험 평가 완료
EVENTS.MSG_BLOCKED           // S3 차단
EVENTS.PLUGIN_REGISTERED     // 플러그인 등록
EVENTS.PLUGIN_UPDATED        // 플러그인 업데이트
EVENTS.PLUGIN_ERROR          // 플러그인 오류 (격리)
EVENTS.LEGAL_DISPUTE         // K-Law S3 감지
EVENTS.GDC_ESCROW_CREATED    // 에스크로 생성
EVENTS.MEDICAL_ALERT         // K-Health S2/S3 감지
EVENTS.PLATFORM_READY        // 부트스트랩 완료

PLSM   = { L1:600, L2:200, L3:100, L4:60, L5:40 }   // 계층 선택 확률
RISK   = { S0:0.30, S1:0.60, S2:0.85 }               // 위험 등급 임계값
GDC_POLICY.INFLATION_ALPHA = 0.20
GDC_POLICY.INFLATION_BETA  = 0.50
GDC_POLICY.MAX_INFLATION   = 0.05
GDC_POLICY.MAX_SUPPLY      = 21_000_000_000
```

---

### `event-bus.js`
**역할:** 플러그인 간 유일한 소통 채널. 한 핸들러 오류가 다른 핸들러에 전파되지 않는다.

```javascript
// 싱글톤
import { EventBus, EVENTS } from './core/event-bus.js'

EventBus.on(EVENTS.MSG_RECEIVED, handler, 'pluginName')   // 구독
EventBus.off(EVENTS.MSG_RECEIVED, handler)                // 구독 해제
EventBus.emit(EVENTS.MSG_RECEIVED, data, 'emitterName')   // 발행
EventBus.getHistory(50)                                    // 최근 50개 이력
EventBus.clearAll()                                        // 테스트용 초기화
```

**⚠️ 주의:** `emit()` 3번째 인수(emitterName)는 디버깅용 필수 기재 권장

---

### `plugin-registry.js`
**역할:** 플러그인 등록·업데이트·조회 싱글톤. `new` 하지 않고 `registry` 그대로 사용.

```javascript
import { registry } from './core/plugin-registry.js'

await registry.init()                        // 최초 1회
await registry.register(new KLawPlugin())    // 등록 (내부에서 validate → onLoad 자동)
await registry.update(newPlugin)             // 업데이트 (major 버전 변경 차단)
registry.get('k-law')                        // 플러그인 인스턴스 조회
registry.list()                              // 전체 메타데이터 배열
registry.has('k-law')                        // 등록 여부
registry.getAllFastPathTriggers()             // 전체 Fast-Path 트리거 목록
```

**`list()` 반환 형태:**
```javascript
[{ name, displayName, version, icon, description, legalDomains, ... }]
```

---

### `plugin-interface.js`
**역할:** 모든 플러그인이 반드시 구현해야 하는 계약(Contract) 기반 클래스.

```javascript
class MyPlugin extends GopangDomainPlugin {
  metadata = {
    name:        'k-market',     // 고유 식별자 (필수)
    displayName: 'K-Market',     // UI 표시명 (필수)
    version:     '1.0.0',        // semver (필수)
    description: '...',
    icon:        '🛒',
    author:      '...',
    legalDomains: ['전자상거래법'],
  }

  legalClassifier = myClassifier   // getFastPathTriggers(), classify() 구현체
  eventSubscriptions = [{ event, handler }]  // 구독할 이벤트 목록

  async onLoad()              {}   // 등록 시 자동 호출
  async onUnload()            {}   // 언로드 시 자동 호출
  async onUpdate(prevVersion) {}   // 업데이트 시 자동 호출
}
```

---

## PDV 레이어 (`src/pdv/`)

### `keyManager.js`
**역할:** 암호화 기반 — Ed25519 서명, AES-256-GCM 암호화, SHA-256.

```javascript
import { sha256, signMessage, verifySignature, generateTripleSignature } from './pdv/keyManager.js'

const hash = await sha256('content')            // 16진수 문자열
const sig  = await signMessage(msg, privKey)
const ok   = await verifySignature(msg, sig, pubKey)
const triple = generateTripleSignature(userSig, agentSig, openHashRef)
// → { userSig, agentSig, openHashRef, ts, valid:true }
```

---

### `vault.js`
**역할:** IndexedDB 기반 PDV 저장소. 브라우저에서만 동작. `init()` 불필요 (자동).

```javascript
import { storeMessage, getMessage, updateOpenHashRef } from './pdv/vault.js'

// 저장 (필수 필드: msgId, content, senderId, senderPubKeyB64, signature, timestamp, riskLevel)
const msgId = await storeMessage(record)

// 조회
const record = await getMessage(msgId)

// OpenHash ref 사후 업데이트 (Phase 6에서 호출)
await updateOpenHashRef(msgId, entryHash)
```

---

## OpenHash 레이어 (`src/openhash/`)

### `hashChain.js`
**역할:** 메시지를 OpenHash 해시 체인에 앵커링. 위변조 불가능한 증거 생성.

```javascript
import { anchor, getEntry, verifyChainIntegrity } from './openhash/hashChain.js'

const result = await anchor(content, senderSig, msgId)
// → { entryHash, msgHash, prevHash, layer, timestamp, blockHeight }

const entry = getEntry(entryHash)
const { valid, brokenAt } = await verifyChainIntegrity()
```

### `plsm.js`
**역할:** 이중 SHA-256 + BigInt mod → L1~L5 계층 확률적 선택.

```javascript
import { selectLayer } from './openhash/plsm.js'
const layer = await selectLayer(seed)   // 'L1'~'L5'
```

---

## AI 비서 레이어 (`src/ai-secretary/`)

### `pipeline.js`
**역할:** Phase 0~6 전체 오케스트레이터. 단일 진입점.

```javascript
import { runPipeline } from './ai-secretary/pipeline.js'

const result = await runPipeline(message, context, incoming?)
// message  = { content, senderId, attachment? }
// context  = { activePlugin, historyWeight? }
// incoming = null 또는 상대방 메시지 (쌍방향 검증용)

// 반환값:
// { msgId, anchorHash, layer, riskResult, phaseScores, processingMs, historyWeight }
```

**`riskResult` 구조:**
```javascript
{
  level:      'S0'|'S1'|'S2'|'S3',
  score:      0.0~1.0,
  legalFlags: ['CR-3', 'CV-2', ...],
  message:    '차단 이유 설명',
}
```

**이벤트 흐름 (pipeline.js 내부):**
```
emit(MSG_RECEIVED)
  → Phase 0~6 실행
  → emit(MSG_RISK_ASSESSED, { msgId, riskResult, anchorHash, layer })
  → (S3이면) emit(MSG_BLOCKED, { msgId, reason })
```

---

## 도메인 플러그인 (`src/domains/`)

### `k-law/index.js` / `k-health/index.js`
**역할:** 법령 분류 플러그인. `GopangDomainPlugin` 상속.

```javascript
// import 방법 (default export)
import KLawPlugin    from './domains/k-law/index.js'
import KHealthPlugin from './domains/k-health/index.js'

// 사용 방법 (app.js에서)
await registry.register(new KLawPlugin())
```

**플러그인이 발행하는 이벤트:**

| 플러그인 | 조건 | 발행 이벤트 |
|---------|------|------------|
| K-Law | S3 감지 | `LEGAL_DISPUTE`, `GDC_ESCROW_CREATED` |
| K-Health | S2/S3 감지 | `MEDICAL_ALERT` |

**플러그인 `legalClassifier` 인터페이스:**
```javascript
classifier.getFastPathTriggers()   // Fast-Path 패턴 배열 반환
classifier.classify(text)          // 법령 플래그 배열 반환 (['CR-3', ...])
```

---

## 부트스트랩 (`src/app.js`)

**역할:** 6단계 순서로 전체 시스템 조립.

```
1. registry.init()
2. (PDV/OpenHash: init 불필요, 자동)
3. registry.register(new KLawPlugin())
   registry.register(new KHealthPlugin())
4. (runPipeline: 함수, init 불필요)
   EventBus.on(MSG_RECEIVED, runPipeline 연결)
5. (Network/GDC/Privacy: init 불필요, 자동)
6. ShellUI.render(registry.list())
```

**`registry.list()` → `ShellUI.render()` 전달 형태:**
```javascript
// list()가 반환하는 객체의 키
{ name, displayName, version, icon, description, legalDomains }
// shell-ui.js는 name, displayName, icon만 사용
```
