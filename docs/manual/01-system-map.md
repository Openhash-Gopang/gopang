# 01 — 시스템 맵 (파일 구조 + Export 이름 일람)

> **이 문서가 다루는 범위**: 파일 구조 및 Export 이름 일람 — import 오류 예방용 레퍼런스
> **전체 문서 지도**: [../MANUAL_INDEX.md](../MANUAL_INDEX.md)

> 오류 `does not provide an export named 'X'` 발생 시 이 파일을 먼저 확인하세요.

---

## 1. 전체 디렉토리 구조

> ⚠️ **2026-07-19 확인**: 아래 트리의 저장소명(`gopang_v2`→`gopang`)만 정정했습니다. 트리 내용 자체는 부분적으로 낡았을 수 있습니다(예: `src/core/config.js`로 표기돼 있으나 실제로는 `src/gopang/core/config.js`에 위치 — 언제 `src/gopang/` 서브폴더가 생겼는지 이번 조사에선 추적 못 함). 전체 재검증은 후속 작업 필요.

```
gopang/
├── index.html                          ← Shell UI 진입점 (브라우저 로드)
│
└── src/
    ├── app.js                          ← 부트스트랩 진입점 (6단계 순서)
    ├── shell-ui.js                     ← Shell UI 렌더링 엔진
    │
    ├── core/                           ⚠️ 절대 변경 금지
    │   ├── constants.js                ← EVENTS, PLSM, RISK, PERF 상수
    │   ├── config.js                   ← dev/prod 환경 설정
    │   ├── plugin-interface.js         ← GopangDomainPlugin 기반 클래스
    │   ├── plugin-validator.js         ← 플러그인 유효성 검사
    │   ├── plugin-registry.js          ← 싱글톤 registry
    │   └── event-bus.js                ← 싱글톤 EventBus
    │
    ├── pdv/
    │   ├── keyManager.js               ← Ed25519 서명·sha256
    │   ├── vault.js                    ← IndexedDB CRUD (개별 함수)
    │   └── evidencePackage.js          ← 증거 패키지 생성
    │
    ├── openhash/
    │   ├── plsm.js                     ← 계층 선택 (selectLayer)
    │   ├── hashChain.js                ← 앵커링 (anchor, getEntry)
    │   ├── bivm.js                     ← 잔액 불변성 검증
    │   ├── ilmv.js                     ← 양방향 감사
    │   ├── lpbft.js                    ← 경량 합의
    │   ├── importanceVerifier.js       ← 검증 모드 선택
    │   └── transactionPipeline.js      ← Stage 1~5 처리
    │
    ├── ai-secretary/
    │   ├── pipeline.js                 ← runPipeline() 오케스트레이터
    │   ├── phase0.js ~ phase6.js       ← 각 단계 처리 함수
    │   └── agentProtocol.js            ← AI 간 협업
    │
    ├── network/
    │   ├── layerClient.js              ← submitToLayer, getLayerStatus
    │   ├── gasAddress.js               ← GUID·Stealth·Sybil
    │   └── dht.js                      ← 가중 DHT
    │
    ├── gdc/
    │   ├── tokenomics.js               ← calcInflationRate, burn
    │   ├── smartVault.js               ← 4개 바스켓
    │   ├── currencyPool.js             ← 193개국 풀
    │   ├── escrow.js                   ← K-Law 연동 자동 집행
    │   ├── dao.js                      ← DAWN 비영리 거버넌스
    │   └── offlineQueue.js             ← 예치금 큐
    │
    ├── privacy/
    │   ├── mixnet.js                   ← registerMixnode, selectPath
    │   ├── pir.js                      ← Private Information Retrieval
    │   ├── kAnonymity.js               ← K-익명성 그룹
    │   ├── adaptivePow.js              ← 적응형 PoW
    │   ├── salt.js                     ← Shamir 4-of-7
    │   └── socialRecovery.js           ← 개인키 복구
    │
    ├── domains/
    │   ├── _template/                  ← 새 플러그인 복사 기준
    │   ├── k-law/                      ← 사법 플러그인 (1호)
    │   │   └── index.js                ← export default KLawPlugin
    │   └── k-health/                   ← 의료 플러그인 (2호)
    │       └── index.js                ← export default KHealthPlugin
    │
    └── tests/
        ├── core/
        ├── pdv/
        ├── openhash/
        ├── ai-secretary/
        ├── domains/
        └── integration/
```

---

## 2. Export 이름 일람 ⚠️ 가장 중요

> `import { X } from '...'` 시 X가 이 표와 다르면 즉시 `SyntaxError` 발생

### Core

| 파일 | export 형태 | 정확한 이름 | 비고 |
|------|------------|------------|------|
| `core/constants.js` | named | `EVENTS`, `PLSM`, `RISK`, `STAKING`, `PERF`, `QUEUE`, `GDC_POLICY` | |
| `core/config.js` | named | `config` | 싱글톤 객체 |
| `core/plugin-interface.js` | named class | `GopangDomainPlugin` | 기반 클래스 |
| `core/plugin-validator.js` | named | `PluginValidator` | |
| `core/plugin-registry.js` | named | `registry` | **싱글톤 인스턴스** (new 불필요) |
| `core/event-bus.js` | named | `EventBus`, `EVENTS` | **싱글톤 인스턴스** + EVENTS 재내보내기 |

### PDV

| 파일 | export 형태 | 정확한 이름 |
|------|------------|------------|
| `pdv/keyManager.js` | named 함수 | `sha256`, `generateKeyPair`, `signMessage`, `verifySignature`, `encryptMessage`, `decryptMessage`, `generateTripleSignature` |
| `pdv/vault.js` | named 함수 | `storeMessage`, `getMessage`, `updateOpenHashRef`, `deleteMessage`, `getMessagesByRange`, `getMessagesByRisk`, `countMessages`, `storePublicKeys`, `getPublicKeys`, `_clearAll`, `_resetConnection` |
| `pdv/evidencePackage.js` | named 함수 | `createEvidencePackage`, `verifyEvidencePackage` |

### OpenHash

| 파일 | export 형태 | 정확한 이름 |
|------|------------|------------|
| `openhash/plsm.js` | named 함수 | `selectLayer` |
| `openhash/hashChain.js` | named 함수 | `anchor`, `getEntry`, `getEntryByMsgId`, `getCurrentPrevHash`, `buildMerkleRoot`, `buildMerkleProof`, `verifyMerkleProof`, `verifyChainIntegrity`, `_resetChain` |
| `openhash/bivm.js` | named 함수 | `verifyBalance`, `detectTampering` |
| `openhash/ilmv.js` | named 함수 | `auditDownward`, `monitorUpward`, `crossVerify` |
| `openhash/lpbft.js` | named 함수 | `runConsensus`, `checkEmergency` |
| `openhash/importanceVerifier.js` | named 함수 | `selectMode`, `verify` |
| `openhash/transactionPipeline.js` | named 함수 | `processTransaction` |

### AI Secretary

| 파일 | export 형태 | 정확한 이름 |
|------|------------|------------|
| `ai-secretary/pipeline.js` | named **함수** | `runPipeline` ← ⚠️ `AIPipeline` 아님 |
| `ai-secretary/phase0.js` | named 함수 | `identifyCommObject` |
| `ai-secretary/phase1.js` | named 함수 | `analyzePhase1` |
| `ai-secretary/phase2.js` | named 함수 | `classifyPhase2` |
| `ai-secretary/phase3.js` | named 함수 | `analyzePhase3` |
| `ai-secretary/phase4.js` | named 함수 | `calculateScore`, `bidirectionalVerify` |
| `ai-secretary/phase5.js` | named 함수 | `classifyRisk` |
| `ai-secretary/phase6.js` | named 함수 | `recordAndAnchor` |
| `ai-secretary/agentProtocol.js` | named 함수 | `runAgentProtocol` |

### Network

| 파일 | export 형태 | 정확한 이름 |
|------|------------|------------|
| `network/layerClient.js` | named 함수 | `submitToLayer`, `getLayerStatus`, `getLayerTPS`, `_resetStatus` |
| `network/gasAddress.js` | named 함수 | `generateGUID`, `assignTrustLevel`, `createStealthTag`, `detectSybil` |
| `network/dht.js` | named 함수 | `findNode`, `registerNickname`, `resolveNickname` |

### GDC

| 파일 | export 형태 | 정확한 이름 |
|------|------------|------------|
| `gdc/tokenomics.js` | named 함수+상수 | `calcInflationRate`, `calcNewIssuance`, `BURN_PATH`, `burn`, `getTotalBurned`, `getBurnLog`, `calcGEI`, `_resetBurnLog` |
| `gdc/smartVault.js` | named 함수 | `allocate`, `rebalance`, `calcExpectedVolatility` |
| `gdc/currencyPool.js` | named 함수 | `exchange`, `getPoolShare`, `rebalancePool` |
| `gdc/escrow.js` | named 함수 | `createEscrow`, `executeEscrow`, `refundEscrow` |
| `gdc/dao.js` | named 함수 | `submitProposal`, `vote`, `executeProposal` |
| `gdc/offlineQueue.js` | named 함수 | `enqueue`, `dequeue`, `calcDeposit` |

### Privacy

| 파일 | export 형태 | 정확한 이름 |
|------|------------|------------|
| `privacy/mixnet.js` | named 함수 | `registerMixnode`, `selectPath`, `rewardRelay`, `slashNode`, `getMixnode`, `_resetMixnet` |
| `privacy/pir.js` | named 함수 | `pirQuery`, `pirResponse` |
| `privacy/kAnonymity.js` | named 함수 | `groupByKAnonymity`, `checkKAnonymity` |
| `privacy/adaptivePow.js` | named 함수 | `computePow`, `verifyPow`, `updateReputation` |
| `privacy/salt.js` | named 함수 | `generateSalt`, `shamirSplit`, `shamirRecombine` |
| `privacy/socialRecovery.js` | named 함수 | `initRecovery`, `submitShard`, `recoverKey` |

### Domains (플러그인)

| 파일 | export 형태 | 정확한 이름 | 비고 |
|------|------------|------------|------|
| `domains/k-law/index.js` | **default** | `KLawPlugin` | `import KLawPlugin from '...'` |
| `domains/k-health/index.js` | **default** | `KHealthPlugin` | `import KHealthPlugin from '...'` |

---

## 3. 의존성 방향 (단방향 강제)

```
constants.js  ◄─────────────────────────── 모든 모듈이 참조
config.js     ◄─────────────────────────── 모든 모듈이 참조

core/          ← 의존성 없음
pdv/           ← core
openhash/      ← core, pdv/keyManager
ai-secretary/  ← core, pdv, openhash
network/       ← core, openhash
gdc/           ← core, network (단방향)
privacy/       ← core
domains/       ← core, pdv, openhash, ai-secretary
app.js         ← 전체 조립
```

**금지 규칙 (위반 시 순환 참조 → 런타임 오류)**

```
❌ event-bus.js    → plugin-registry.js
❌ network/        → gdc/  (gdc 상태는 EventBus로만 수신)
❌ 플러그인 간 직접 import (EventBus 경유만 허용)
```

---

## 4. 모듈별 init() 유무

> `await X.init()` 호출 전에 이 표 확인 필수

| 모듈 | init() 있음 | 방식 |
|------|------------|------|
| `registry` | ✅ | `await registry.init()` |
| `vault.js` | ❌ | IndexedDB 최초 접근 시 자동 초기화 |
| `hashChain.js` | ❌ | 즉시 사용 가능 |
| `layerClient.js` | ❌ | 즉시 사용 가능 |
| `tokenomics.js` | ❌ | 즉시 사용 가능 |
| `mixnet.js` | ❌ | 즉시 사용 가능 |
| `runPipeline` | ❌ | 함수, 직접 호출 |
| `KLawPlugin` | ✅ | `registry.register(new KLawPlugin())` 시 내부 `onLoad()` 자동 호출 |
| `KHealthPlugin` | ✅ | 동일 |
