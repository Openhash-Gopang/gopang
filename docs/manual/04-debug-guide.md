# 04 — 오류 진단 가이드

> **이 문서가 다루는 범위**: Console 오류 메시지 유형별 진단·해결 가이드
> **전체 문서 지도**: [../MANUAL_INDEX.md](../MANUAL_INDEX.md)

> Console 오류 메시지를 보고 해당 섹션으로 바로 이동하세요.

---

## 🔴 유형 1: `SyntaxError: does not provide an export named 'X'`

**원인:** import 이름이 실제 export 이름과 다름.  
**해결:** `01-system-map.md §2 Export 이름 일람` 확인 후 정확한 이름으로 수정.

**자주 틀리는 이름 (BUG-011 사례):**

| 잘못된 이름 (❌) | 올바른 이름 (✅) | 파일 |
|----------------|----------------|------|
| `AIPipeline` | `runPipeline` | `ai-secretary/pipeline.js` |
| `PluginRegistry` | `registry` | `core/plugin-registry.js` |
| `PDVLayer` | 없음 (개별 함수) | `pdv/vault.js` |
| `OpenHashLayer` | 없음 (개별 함수) | `openhash/hashChain.js` |
| `NetworkLayer` | 없음 (개별 함수) | `network/layerClient.js` |
| `GDCLayer` | 없음 (개별 함수) | `gdc/tokenomics.js` |
| `PrivacyLayer` | 없음 (개별 함수) | `privacy/mixnet.js` |
| `{ KLawPlugin }` | `KLawPlugin` (default) | `domains/k-law/index.js` |
| `{ KHealthPlugin }` | `KHealthPlugin` (default) | `domains/k-health/index.js` |

**수정 패턴:**
```javascript
// ❌ 틀린 예
import { AIPipeline }  from './ai-secretary/pipeline.js'
import { KLawPlugin }  from './domains/k-law/index.js'

// ✅ 올바른 예
import { runPipeline } from './ai-secretary/pipeline.js'
import KLawPlugin      from './domains/k-law/index.js'
```

---

## 🔴 유형 2: `TypeError: X is not a function` / `X.init is not a function`

**원인:** 개별 함수 export 모듈에 `.init()` 호출 시도.  
**해결:** `01-system-map.md §4 init() 유무` 확인. init() 없는 모듈은 그냥 함수 호출.

```javascript
// ❌ 틀린 예 — vault.js는 개별 함수 export, PDVLayer 없음
await PDVLayer.init()

// ✅ 올바른 예 — 함수 직접 사용
const msgId = await storeMessage(record)
```

---

## 🔴 유형 3: 위험 배지가 갱신되지 않음 (이벤트 미수신)

**진단 체크리스트:**

```
1. shell-ui.js가 구독하는 이벤트 키가 올바른가?
   → EventBus.on(EVENTS.MSG_RISK_ASSESSED, ...)   ✅
   → EventBus.on(EVENTS.AI_RESULT, ...)           ❌ (이 키 없음)

2. pipeline.js가 발행하는 이벤트 키가 올바른가?
   → EventBus.emit(EVENTS.MSG_RISK_ASSESSED, ...) ✅

3. DevTools Console에서 확인:
   EventBus.getHistoryByEvent('EVENTS.MSG_RISK_ASSESSED 실제값')
   → 발행 이력이 있으면 구독 키 불일치
   → 발행 이력이 없으면 pipeline 미실행

4. app.js에서 MSG_RECEIVED → runPipeline 연결이 되어 있는가?
   EventBus.on(EVENTS.MSG_RECEIVED, ...) 확인
```

---

## 🔴 유형 4: 부트스트랩 중간 멈춤 / `[BOOT] 부트스트랩 실패`

**단계별 진단:**

```
[BOOT] 1/6 코어 초기화... → 이후 멈춤
  → plugin-registry.js 또는 event-bus.js import 오류
  → 01-system-map.md export 이름 확인

[BOOT] 3/6 도메인 플러그인 등록... → 이후 멈춤
  → KLawPlugin 또는 KHealthPlugin 내부 오류
  → k-law/index.js, k-health/index.js의 import 확인
  → plugin-validator.js 유효성 검사 실패 가능 (metadata 누락)

[BOOT] 6/6 Shell UI 렌더링... → 이후 멈춤
  → shell-ui.js import 오류 또는 DOM 마운트 포인트 없음
  → index.html에 id="gopang-shell" 존재 확인
```

**빠른 확인 명령 (DevTools Console):**
```javascript
// 부트 상태 확인
import('./src/app.js').then(m => console.log(m.getBootState()))
// → 'READY' 이면 정상
// → 'ERROR' 이면 오류 발생
// → 'BOOTING' 이면 무한 대기 중
```

---

## 🟡 유형 5: 플러그인 등록 오류 `"이미 등록됨"`

**원인:** `registry.register()`를 두 번 호출.  
**해결:** 페이지 새로고침 또는 registry.clearAll() 후 재등록.

```javascript
// ❌ 오류 발생
await registry.register(new KLawPlugin())  // 1회
await registry.register(new KLawPlugin())  // 2회 → 오류

// ✅ 업데이트 시
await registry.update(new KLawPlugin())    // 기존 것 교체
```

---

## 🟡 유형 6: semver 업데이트 오류 `BREAKING_CHANGE`

**원인:** major 버전 변경 시 `registry.update()` 차단.  
**해결:** minor/patch 버전만 올리거나, 수동 마이그레이션 후 재등록.

```javascript
// ❌ 차단됨
// 기존: v1.0.0 → 신규: v2.0.0 (major 변경)

// ✅ 허용됨
// 기존: v1.0.0 → 신규: v1.1.0 (minor 변경)
```

---

## 🟡 유형 7: `[Vault] 필수 필드 누락: X`

**원인:** `storeMessage()` 호출 시 필수 필드 미포함.  
**해결:** 아래 필수 필드 모두 포함 확인.

```javascript
// 필수 필드 체크리스트
const record = {
  msgId:           '...',   // SHA256(content+ts+senderPubKey)
  content:         '...',   // AES-256-GCM 암호화된 원본
  senderId:        '...',   // 발신자 식별자
  senderPubKeyB64: '...',   // Ed25519 공개키 (Base64)
  signature:       '...',   // 발신자 서명
  timestamp:       '...',   // ISO8601
  riskLevel:       'S0',    // 'S0'|'S1'|'S2'|'S3' 중 하나
  // 선택 필드
  openHashRef:     null,
  legalFlags:      [],
  phaseLog:        {},
  aiWarningLog:    [],
  tripleSign:      null,
  docAnalysis:     null,
}
```

---

## 🟡 유형 8: 순환 참조 오류

**증상:** 모듈 로드 시 `undefined` 반환 또는 무한 루프.  
**원인:** 의존성 방향 위반.

```
금지된 방향:
❌ event-bus.js → plugin-registry.js
❌ network/ → gdc/
❌ 플러그인 A → 플러그인 B (직접 import)

확인 방법:
grep -r "import.*plugin-registry" src/core/event-bus.js
grep -r "import.*gdc" src/network/
```

---

## 🟢 유형 9: hondi.net 흰 화면 (완전 무응답)

**체크리스트:**

```
1. DevTools Network 탭 → 빨간 항목 확인
   → 404: 파일 경로 오류
   → CORS: GitHub Pages 설정 확인

2. DevTools Console 탭 → 첫 번째 오류 메시지 확인
   → "does not provide an export" → 유형 1
   → "Cannot find module" → 경로 오류
   → "ROBOTS_DISALLOWED" → Claude fetch 오류 (개발 중 무관)

3. index.html의 script type="module" 확인
   → <script type="module"> 없으면 ESM 동작 안 함

4. GitHub Pages 캐시
   → 배포 후 2~3분 대기 후 강제 새로고침 (Ctrl+Shift+R)
```

---

## Claude에게 오류 보고하는 표준 양식

오류 발생 시 아래 정보를 모아 질문하면 가장 빠릅니다:

```
1. 오류 발생 파일: (예: src/app.js)
2. Console 오류 전체 메시지: (복사 붙여넣기)
3. 수정하려던 내용: (예: 새 플러그인 추가)
4. 첨부: docs/manual/01-system-map.md
```
