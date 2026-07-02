# 03 — 이벤트 흐름도 & EVENTS 키 목록

> 이벤트 핸들러가 호출되지 않거나, 예상한 배지가 표시되지 않을 때 참조

---

## 1. 메시지 전송 → 결과 표시 전체 흐름

```
[사용자]
  └─ 입력창 입력 후 전송 버튼 클릭
        │
        ▼
[shell-ui.js: sendMessage()]
  └─ EventBus.emit(EVENTS.MSG_RECEIVED, { content, senderId:'user' }, 'shell-ui')
        │
        ▼
[app.js: EventBus.on(MSG_RECEIVED)]
  └─ runPipeline(message, context) 호출
        │
        ├─ Phase 0: identifyCommObject()   소통 객체 식별
        │     └─ immediateS3? → classifyRisk(1.0) → recordAndAnchor → 종료
        │
        ├─ Phase 1: analyzePhase1()        Fast-Path 검사
        │     └─ fastPathResult? → Phase 2 건너뜀
        │
        ├─ Phase 2: classifyPhase2()       플러그인 법령 분류
        │     └─ registry.getAllFastPathTriggers() → 각 플러그인 classify()
        │
        ├─ Phase 3: analyzePhase3()        문서 분석 (첨부 시)
        │
        ├─ Phase 4: calculateScore() + bidirectionalVerify()
        │
        ├─ Phase 5: classifyRisk()         S0~S3 판정
        │
        └─ Phase 6: recordAndAnchor()      PDV 저장 + OpenHash 앵커링
              │
              ├─ storeMessage(record)       vault.js
              └─ anchor(content, sig, id)   hashChain.js
                    └─ selectLayer(seed)    plsm.js
        │
        ▼
[pipeline.js]
  ├─ EventBus.emit(MSG_RISK_ASSESSED, { msgId, riskResult, anchorHash, layer })
  └─ (S3이면) EventBus.emit(MSG_BLOCKED, { msgId, reason })
        │
        ▼
[shell-ui.js: EventBus.on(MSG_RISK_ASSESSED)]
  ├─ _updateRiskBadges(riskResult)    위험 배지 갱신
  ├─ _updateLegalFlags(riskResult)    법령 플래그 패널 갱신
  ├─ hash-ref 표시 (anchorHash)
  └─ (S3이면) 증거 패키지 버튼 표시

[k-law/index.js: EventBus.on(MSG_RISK_ASSESSED)]
  └─ (S3이면) EventBus.emit(LEGAL_DISPUTE, ...)
              EventBus.emit(GDC_ESCROW_CREATED, ...)

[k-health/index.js: EventBus.on(MSG_RISK_ASSESSED)]
  └─ (S2/S3이면) EventBus.emit(MEDICAL_ALERT, ...)
```

---

## 2. EVENTS 키 전체 목록

> `constants.js`에 정의. 오타 하나로 핸들러 미호출 → 배지 미갱신 발생.

| EVENTS 키 | 발행자 | 구독자 | 전달 데이터 |
|-----------|--------|--------|------------|
| `MSG_RECEIVED` | shell-ui | app.js(→pipeline) | `{ content, senderId, activePlugin, file? }` |
| `MSG_RISK_ASSESSED` | pipeline.js | shell-ui, k-law, k-health | `{ msgId, riskResult, anchorHash, layer, activeDomains }` |
| `MSG_BLOCKED` | pipeline.js | shell-ui | `{ msgId, reason }` |
| `PLUGIN_REGISTERED` | plugin-registry | shell-ui | `{ name, version, displayName }` |
| `PLUGIN_UPDATED` | plugin-registry | (필요 시 구독) | `{ name, from, to }` |
| `PLUGIN_ERROR` | event-bus (자동) | (디버깅 용) | `{ pluginName, event, err }` |
| `LEGAL_DISPUTE` | k-law | gdc/escrow (구독 가능) | `{ msgId, legalFlags, score }` |
| `GDC_ESCROW_CREATED` | k-law | gdc/escrow | `{ reason, msgId, legalFlags }` |
| `MEDICAL_ALERT` | k-health | (알림 UI 구독 가능) | `{ msgId, level, legalFlags }` |
| `PLATFORM_READY` | app.js | (초기화 완료 훅) | `{ plugins: [name, ...] }` |

---

## 3. 이벤트 구독 등록 위치

| 구독자 | 구독 위치 | 구독 시점 |
|--------|---------|---------|
| `shell-ui.js` | `_subscribeEvents()` | `ShellUI.render()` 호출 시 |
| `k-law/index.js` | `onLoad()` | `registry.register()` 시 자동 |
| `k-health/index.js` | `onLoad()` | `registry.register()` 시 자동 |
| `app.js` | `bootstrap()` 4단계 | 부트스트랩 중 |

---

## 4. 오류 격리 동작

```
EventBus.emit(MSG_RISK_ASSESSED, data)
  ├─ shell-ui 핸들러 실행 → 오류 발생
  │     └─ console.error 출력 (오류 격리)
  │     └─ EventBus.emit(PLUGIN_ERROR, { pluginName:'shell-ui', ... }) 자동 발행
  │
  ├─ k-law 핸들러 실행  ← shell-ui 오류와 무관하게 정상 실행
  └─ k-health 핸들러 실행 ← 동일
```

**→ 한 플러그인이 죽어도 다른 플러그인은 계속 동작한다.**

---

## 5. 이벤트 디버깅 방법

```javascript
// DevTools Console에서 실행
// 최근 이벤트 이력 조회
import { EventBus } from './src/core/event-bus.js'
EventBus.getHistory(20)

// 특정 이벤트만 조회
EventBus.getHistoryByEvent('ai:msg_risk_assessed')

// 핸들러 수 확인
EventBus.listenerCount('ai:msg_risk_assessed')
```

또는 `index.html` DevTools Console에서:
```javascript
// hondi.net에서 열린 후
window._eventBusDebug = true   // (구현 예정)
```
