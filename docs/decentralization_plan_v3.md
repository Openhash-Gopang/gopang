# 혼디 탈중앙화 이관 계획서 v3
**작성** Claude Sonnet 4.6 | 2026-06-23  
**v2 대비** 완료 항목 확정, 잔여 작업 순서 명확화

---

## 1. 완료된 작업

### 클라이언트(단말) 코드 이관 — 11개 파일, 11개 엔드포인트

| # | 파일 | 이전 경로 | 이후 경로 | 커밋 |
|---|---|---|---|---|
| ① | `push.js` | Worker `/push/vapid-public-key` | VAPID 공개키 상수 하드코딩 | 961a865 |
| ② | `hashChain.js` | Worker `/openhash/status` | GitHub Pages 직접 fetch (`fetchChainStatus`) | 961a865 |
| ③ | `state.js` | — | `L1_SIGNAL_BASE` 상수 추가 | 961a865 |
| ③ | `p2p-chat.js` | Worker `/signal/send,poll,delete` (6곳) | L1 직접 (`_signalSendDirect` 등) | 961a865 |
| ④ | `auth.js` | Worker `/p2p/register` | L1 profiles 직접 POST | 961a865 |
| ⑦⑧ | `settings.js` | Worker `/profile?guid=` (3곳) | L1 profiles 직접 GET | 8957a3d |
| ⑨ | `p2p-search.js` | Worker `/p2p/search` | L1 profiles 직접 검색 | 575b505 |
| ⑩ | `webrtc.js` | Worker `/profile?guid=` | L1 profiles 직접 GET | 575b505 |
| ⑪ | `config.js` | Worker `/profile/@handle_ai` | L1 profiles 직접 GET | 575b505 |
| — | `run_tests.mjs` | M-01~M-14 이관 검증 테스트 추가 | — | 575b505 |
| — | `tc_pdv_l1_migration.md` | T-C 설계서 신규 | — | 575b505 |

### 기타 완료
- `decentralization_plan_v1.md` — 이관 계획서 초안
- `decentralization_plan_v2.md` — 사고실험 오류 12건 반영

---

## 2. 잔여 작업 (순서대로)

### Step 1: T-A — L1 PocketBase 스키마 확장
**작업 위치**: L1 Admin UI (https://l1-hanlim.gopang.net/_/)  
**근거 문서**: `docs/tc_pdv_l1_migration.md`

**신설 컬렉션 2개**:

**① `pdv_records`**
```
Fields:
  guid          Text (required)
  report_id     Text (required, unique)
  reporter_svc  Text (required)
  svc           Text (required)
  type          Text (required)
  summary       Text
  summary_6w    JSON
  block_hash    Text
  risk_level    Text (default: "low")
  source        Text
  openhash_anchored  Bool (default: false)
```
Before Create Hook (중복 방지):
```javascript
onRecordBeforeCreate('pdv_records', (e) => {
  const reportId = e.record.get('report_id')
  if (reportId) {
    const existing = $app.dao().findFirstRecordByData('pdv_records', 'report_id', reportId)
    if (existing) throw new BadRequestError('DUPLICATE_SESSION')
  }
})
```

**② `anchor_records`**
```
Fields:
  entry_hash    Text (required)
  content_hash  Text (required)
  msg_id        Text
  source        Text
  prev_hash     Text
```
Before Create Hook (체인 검증):
```javascript
onRecordBeforeCreate('anchor_records', (e) => {
  // prev_hash 정합성 검증 (verify.yml 대체)
  const records = $app.dao().findRecordsByExpr('anchor_records',
    $dbx.exp('1=1'), $dbx.desc('created'))
  if (records.length > 0) {
    const last = records[0]
    // 이전 블록 해시 검증 로직
  }
})
```
After Save Hook (pdv_records → 자동 앵커링):
```javascript
onRecordAfterCreate('pdv_records', async (e) => {
  const blockHash = e.record.get('block_hash')
  if (!blockHash) return
  // anchor_records에 자동 기록
})
```

---

### Step 2: T-C — PDV report 3곳 L1 직접 이관
**Step 1 완료 후 착수**  
**대상 파일**: `p2p-chat.js:736`, `auth.js:1757`, `session.js:141`

현재: `PROXY /pdv/report` → Worker → Supabase pdv_log  
이후: L1 `pdv_records` 직접 POST

단말 호출 형식:
```javascript
const L1_PDV = 'https://l1-hanlim.gopang.net/api/collections/pdv_records/records'
await fetch(L1_PDV, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    guid:         report.who?.ipv6,
    report_id:    `${report.session_id}:${report.reporter_svc}`,
    reporter_svc: report.reporter_svc,
    svc:          report.svc,
    type:         report.type,
    summary:      report.what?.summary,
    summary_6w:   JSON.stringify({...}),
    block_hash:   report.block_hash,
    openhash_anchored: !!report.block_hash,
  })
})
```

---

### Step 3: 브라우저/폰 테스트
**Step 2 완료 후 착수**

테스트 항목:
- [ ] P2P 채팅 시작 → 시그널링이 L1 webrtc_signals에 기록되는지
- [ ] 대화 종료 → PDV가 L1 pdv_records에 기록되는지
- [ ] 신규 가입 → L1 profiles에 등록되는지
- [ ] 그림자 SP 로드 → L1 profiles/@handle_ai 조회 성공하는지
- [ ] OpenHash status → GitHub Pages 직접 조회 성공하는지

---

### Step 4: worker.js — 이관 완료 엔드포인트 7개 제거
**Step 3(테스트) 완료 후 착수**

제거 대상 (현재 worker.js 3,782줄 → 약 3,439줄):

| 엔드포인트 | 함수 | 줄수 |
|---|---|---|
| `GET /push/vapid-public-key` | `handlePushVapidKey` | ~9줄 |
| `GET /openhash/status` | `handleOpenhashStatus` | ~117줄 |
| `POST /signal/send` | `handleSignalSend` | ~47줄 |
| `GET /signal/poll` | `handleSignalPoll` | ~23줄 |
| `POST /signal/delete` | `handleSignalDelete` | ~34줄 |
| `POST /p2p/register` | `handleP2PRegister` | ~57줄 |
| `GET /p2p/search` | `handleP2PSearch` | ~56줄 |

---

## 3. 이관 불가 확정 (worker.js 영구 잔류)

| 기능 | 이유 | 해소 조건 |
|---|---|---|
| AI API 프록시 | API 키 보호 | 온디바이스 LLM 또는 DAO 공동 구매 (T-7) |
| 지오코딩 | 카카오 키 | OpenStreetMap 전환 시 |
| TURN 자격증명 | coturn 공유 비밀 | — |
| Web Push 발송 | VAPID 서버 서명 필수 | 네이티브 앱 전환 시 |
| 검색 `/search` | PostgreSQL tsvector | MeiliSearch 도입 후 |
| 프로필 POST(쓰기) | 그림자 생성 Webhook | T-3 완료 후 |
| PDV query | Supabase pdv_log 의존 | T-1 완료 후 |

---

## 4. 중장기 (T-B, T-3~T-7)

| Phase | 내용 | 선행 조건 |
|---|---|---|
| T-B | Ed25519 자기서명 인증 + 폐기 메커니즘 | T-A |
| T-3 | 프로필 POST(쓰기) L1 직접 + 그림자 Webhook 분리 | T-B |
| T-4 | 그림자 서명 하이브리드 (온라인 시 단말 직접) | T-B, T-3 |
| T-5 | 거래 검증 L1 (LPBFT 실구현 선행) | T-3 + LPBFT |
| MeiliSearch | L2 노드에 배포, 검색 이관 | T-A 이후 독립 진행 |
| T-7 | 온디바이스 LLM, OSM, 네이티브 앱 | 장기 |

---

## 5. 현재 worker.js 상태 요약

```
잔류 이유별 분류:

[제거 대기 — Step 4에서 제거]
  /push/vapid-public-key  /openhash/status
  /signal/*  /p2p/register  /p2p/search

[Step 2 완료 후 제거 가능]
  /pdv/report

[영구 잔류]
  /chat/completions  /ai/chat  /geocode  /turn/credential
  /push/subscribe,send,broadcast  /search  /profile(POST)
  /biz/order  /auth/*  /wallet/x25519  /account/full-reset
  /admin/*  /prompt  /feedback  /push/vapid-public-key(발송용)
```
