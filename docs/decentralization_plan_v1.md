# 혼디 탈중앙화 이관 계획서 v1
**작성** Claude Sonnet 4.6 | 2026-06-23  
**근거** MASTER_PLAN_v1.md §0 핵심 원칙 — "Supabase/Cloudflare는 시뮬레이션·테스트 단계. 장기적으로 OpenHash L1~L5와 사용자 단말로 이관"  
**분석 대상** `gopang-proxy.tensor-city.workers.dev` (worker.js, 3,782줄, 52개 엔드포인트)

---

## 0. 분류 원칙

기능을 이관 가능 여부로 나누는 기준은 단 두 가지다.

**로컬(단말) 이관 가능**: 비밀 키가 없어도 되거나, 비밀 키가 이미 단말에 있거나, L1~L5 저장소로 검증 책임을 넘길 수 있는 것.

**서버 잔류 필요**: ① 제3자 API 키 보호(AI, 카카오, TURN), ② 크로스-유저 조회(검색, P2P 탐색), ③ 글로벌 정렬/집계, ④ 브라우저 Push 발송(서버 필수).

---

## 1. 현재 Cloudflare Worker 기능 전체 목록

### 1-A. AI 프록시 (3개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /chat/completions`, `/deepseek` | DeepSeek API 프록시 (API 키 은닉) | ❌ 서버 잔류 |
| `GET /gemini/*` | OpenAI 포맷→Gemini 변환 프록시 | ❌ 서버 잔류 |
| `POST /ai/chat` | 멀티 프로바이더 라우팅 + 스트리밍 | ❌ 서버 잔류 |

**이관 불가 이유**: API 키(DEEPSEEK_API_KEY, OpenAI)를 단말에 두면 디컴파일 즉시 노출됨. 단, 사용자 자신의 BYOK(Bring Your Own Key)는 단말에서 직접 호출 가능 — 이 경우 Worker 불필요.

---

### 1-B. 인증 (6개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /auth/issue` | HMAC-SHA256 세션 토큰 발급 | ⚠️ 조건부 |
| `GET /auth/verify` | 세션 토큰 검증 | ✅ 단말 이관 가능 |
| `POST /auth/refresh` | 세션 토큰 갱신 | ✅ 단말 이관 가능 |
| `POST /auth/webauthn/challenge` | WebAuthn 챌린지 발급 | ⚠️ 조건부 |
| `POST /auth/webauthn/register` | 패스키 등록 | ⚠️ 조건부 |
| `POST /auth/webauthn/verify` | 패스키 검증 | ✅ 단말 이관 가능 |

**이관 방향**: 세션 토큰(HMAC-SHA256, GOPANG_MASTER_KEY)을 Ed25519 자기서명 토큰으로 교체하면 서버 불필요. 본인 개인키로 `{ipv6}:{exp}:{nonce}`에 서명 → 상대방이 공개키로 직접 검증. 중앙 HMAC 키가 없어짐. WebAuthn 챌린지는 L1이 발급하고 검증하는 구조로.

---

### 1-C. PDV (Personal Data Vault) (3개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /pdv/report` | PDV 기록 + OpenHash 앵커링 | ✅ **완전 이관 가능** |
| `POST /pdv/query` | PDV 조회 + 동의 흐름 | ✅ **완전 이관 가능** |
| `GET /pdv/page/:hash` | PDV 페이지 조회 | ✅ 단말 직접 조회 |

**이관 방향**: PDV의 핵심 원칙이 이미 "로컬 IndexedDB가 주, Supabase는 백업"이다(gopang_pdv_rules.md §2). Cloudflare Worker가 Supabase에 대신 기록하는 구조 자체가 불필요하다. 단말이 직접 L1에 기록하고, L1이 상위 계층으로 전파. Worker는 현재 이 경로에서 비밀 키 보호 역할이 없음 — 가장 먼저 이관해야 할 대상.

---

### 1-D. 그림자(Agent) 키 관리 (2개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /agent/keypair` (signer) | 그림자 키쌍 생성 + 암호화 저장 | ⚠️ 단계적 이관 |
| `POST /agent/sign` (signer) | 그림자 키 복호화 후 서명 | ⚠️ 단계적 이관 |

**이관 방향**: 그림자가 오프라인일 때 응대를 위해 현재는 서버 커스터디. 장기적으로는 단말이 온라인일 때 직접 서명(`_signerSign` 인터페이스는 이미 이를 위해 추상화돼 있음). 완전 이관보다 "온라인이면 단말, 오프라인이면 서버 폴백" 하이브리드가 현실적.

---

### 1-E. 프로필 (Profile) (3개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `GET/POST /profile` | 프로필 조회·등록·수정 | ✅ L1 직접 이관 가능 |
| `POST /profile/delegate` | 위임 인증서 등록 | ✅ L1 직접 이관 가능 |

**이관 방향**: 프로필은 user_profiles(Supabase) → L1 PocketBase로 이전 예정. Worker는 현재 단순 Supabase 프록시. L1이 직접 CRUD를 받으면 Worker 불필요. industry_fields 서버 검증(schema_id 화이트리스트)만 L1 Rule로 이전.

---

### 1-F. 거래/정산 (4개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /biz/order` | 구매자 서명 검증 + 가격 검증 + L1 기록 | ⚠️ 부분 이관 |
| `GET/POST /biz/profile/:handle` | 판매자 프로필 조회 | ✅ L1 직접 이관 |
| `POST /biz/review` | 거래 후기 기록 | ✅ L1 직접 이관 |
| `POST /biz/product` | 상품 등록·수정 | ✅ L1 직접 이관 |

**이관 방향**: `/biz/order`는 현재 Worker가 ① 구매자 서명 검증, ② 카탈로그 가격 대조, ③ 중요도 점수 계산, ④ L1 기록의 4단계를 수행한다. ①③은 단말 또는 L1이 할 수 있고, ②는 L1이 판매자 카탈로그를 들고 있으면 L1에서 직접 검증 가능. Worker가 "중간 검증자"로 남을 이유가 사라진다.

---

### 1-G. 검색 (2개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /search` | Supabase RPC search_entities | ❌ 서버 잔류 (단기) |
| `GET /search/users` | 유저 검색 | ❌ 서버 잔류 (단기) |

**이관 방향**: 검색은 전체 유저 데이터를 가로지르므로 단일 단말에서 불가. 단기적으로는 L2/L3가 분산 인덱스를 들고 있는 구조로. 하지만 제주 시범(100k 엔티티) 단계에서는 L1~L2 단위 검색으로 충분 — Supabase RPC를 L1 PocketBase View로 교체하면 Worker 불필요.

---

### 1-H. P2P 통신 (5개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /signal/send`, `/poll`, `/delete` | WebRTC 시그널링 릴레이 | ✅ L1 직접 이관 가능 |
| `GET /turn/credential` | TURN 자격증명 발급 | ❌ TURN_SECRET 보호 필요 |
| `POST /p2p/register`, `GET /p2p/search` | P2P 피어 등록·검색 | ✅ L1 직접 이관 가능 |

**이관 방향**: 시그널링은 이미 L1 PocketBase(webrtc_signals 컬렉션)로 부분 이전됐다. Worker는 L1 실패 시 Supabase 폴백 역할만. L1이 안정화되면 Supabase 폴백을 제거해 Worker 불필요. TURN은 coturn 서버(Oracle VM)의 공유 비밀을 단말에 두면 안 되므로 서버 잔류.

---

### 1-I. 지오코딩 (2개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `GET /geocode` | 카카오 좌표→주소 변환 | ❌ KAKAO_REST_KEY 보호 |
| `GET /kakao/appkey` | 카카오 JS 키 전달 | ❌ 키 보호 |

**이관 방향**: 카카오 API 키를 오픈소스 대안(Nominatim, Overpass)으로 교체하면 서버 불필요. 제주 시범 기간에는 카카오 유지, 전국 확장 단계에서 키 없는 대안으로 전환 검토.

---

### 1-J. OpenHash 앵커링 (2개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /openhash/anchor` | GitHub repository_dispatch 중계 | ✅ **완전 이관 가능** |
| `GET /openhash/status` | L1~L5 상태 조회 | ✅ 단말 직접 조회 |

**이관 방향**: 현재 Worker가 OPENHASH_TOKEN(GitHub PAT)을 들고 repository_dispatch를 대신 전송. 단말이 PAT 없이 L1 HTTP API로 직접 블록을 제출하면(PocketBase REST) Worker 불필요. 이것이 "Supabase/Cloudflare → L1~L5" 이관의 가장 선행 단계.

---

### 1-K. 알림·피드백 (5개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /push/subscribe` | Web Push 구독 저장 | ❌ VAPID 키 보호 |
| `POST /push/send`, `/broadcast` | Push 메시지 발송 | ❌ 서버 필수 (스펙) |
| `GET /push/vapid-public-key` | VAPID 공개키 전달 | ✅ 하드코딩 가능 |
| `POST/GET/PATCH /feedback` | 피드백 CRUD | ✅ L1 직접 이관 |

**이관 방향**: Web Push는 RFC 8291 스펙상 서버가 VAPID 개인키로 서명해야 한다 — 구조적으로 서버 필수. 단, 네이티브 앱(PWA → 혼디 앱 전환 시)은 FCM/APNs 푸시를 단말에서 직접 수신 가능하여 서버 Push 불필요해짐.

---

### 1-L. 기타 관리 (5개 엔드포인트)

| 엔드포인트 | 역할 | 이관 가능? |
|---|---|---|
| `POST /account/full-reset` | 계정 전체 삭제 | ✅ L1 직접 이관 |
| `POST /ai-setup/seal`, `GET /ai-setup` | AI 설정 봉인/해제 (KV) | ⚠️ 조건부 |
| `POST /wallet/x25519` | X25519 공개키 등록 | ✅ L1 직접 이관 |
| `GET/POST /admin/*`, `/prompt` | 관리자 프롬프트 편집 | ❌ 서버 잔류 |
| `GET /merkle/verify` | Merkle 증명 검증 | ✅ 단말 직접 계산 |

---

## 2. 이관 가능 기능 요약

| 범주 | 이관 대상 기능 | 이관 목적지 |
|---|---|---|
| **PDV 기록/조회** | `/pdv/report`, `/pdv/query`, `/pdv/page/*` | 단말 IndexedDB + L1 직접 |
| **OpenHash 앵커링** | `/openhash/anchor`, `/openhash/status` | L1 HTTP API 직접 |
| **프로필 CRUD** | `GET/POST /profile`, `/profile/delegate` | L1 PocketBase 직접 |
| **거래 기록** | `/biz/profile`, `/biz/review`, `/biz/product` | L1 직접 |
| **시그널링/P2P 탐색** | `/signal/*`, `/p2p/register`, `/p2p/search` | L1 직접 (이미 부분 이전) |
| **인증(세션 토큰)** | `/auth/verify`, `/auth/refresh`, `/auth/webauthn/verify` | Ed25519 자기서명으로 대체 |
| **Merkle 검증** | `/merkle/verify` | 단말 직접 계산 |
| **피드백** | `/feedback` CRUD | L1 직접 |
| **계정 삭제** | `/account/full-reset` | 단말→L1 직접 |
| **그림자 서명(온라인 시)** | `/agent/sign` (하이브리드) | 단말 직접 + 서버 폴백 |

**서버 잔류 확정 기능** (이관 불가):

| 기능 | 이유 |
|---|---|
| AI API 프록시 | API 키 보호 (단 BYOK는 단말 직접 가능) |
| 지오코딩 | 카카오 키 보호 (오픈소스 대안 전환 시 해소) |
| TURN 자격증명 | coturn 공유 비밀 보호 |
| Web Push 발송 | RFC 8291 스펙상 서버 VAPID 서명 필수 (네이티브 앱 전환 시 해소) |
| 관리자 프롬프트 편집 | 의도적 중앙화 (거버넌스 기능) |
| 검색 집계 | 전체 데이터 크로스-쿼리 (L2/L3 분산 인덱스로 장기 해소) |

---

## 3. 단계별 이관 계획

### Phase T-0: 선행 조건 (지금 진행 중)
- L1~L5 저장소 인프라 안정화 ✅ (완료)
- agent_keys 분리, signer Worker 격리 ✅ (완료)
- industry_fields 렌더러, SP 합성 ✅ (완료)

---

### Phase T-1: PDV 로컬 우선화 (난이도 ★☆☆☆☆ | 기간: 1~2주)

**목표**: `/pdv/report`를 Worker 없이 단말 → L1 직접으로.

**현황**: `handlePdvReport`는 ① 중복 체크, ② 6하원칙 보완, ③ 중요도 점수, ④ Supabase pdv_log INSERT, ⑤ OpenHash 앵커링 5단계를 수행. 비밀 키 보호 역할 없음 — 순수 로직.

**변경 내용**:
```
Before: 단말 → POST /pdv/report → Worker → Supabase pdv_log
After:  단말 → IndexedDB (이미 있음) + 단말 → L1 HTTP POST /pdv_records
```

**단말 구현 (gopang-app.js / pdv/record.js)**:
- `recordPDV()` 함수가 Worker 호출 대신 L1 PocketBase REST API 직접 POST
- 오프라인 시: IndexedDB에 큐잉 → 온라인 복귀 시 자동 동기화
- OpenHash 앵커링: 단말이 L1 HTTP로 직접 제출 (OPENHASH_TOKEN 불필요, L1이 내부적으로 처리)

**필요한 L1 변경**:
- `pdv_records` 컬렉션 신설 (PocketBase Admin UI)
- 인증: Ed25519 서명으로 소유자 검증 (SUPABASE_KEY 불필요)

**검증**: 가입 → 대화 → PDV 기록이 Supabase pdv_log가 아닌 L1 pdv_records에 들어가는지 확인.

---

### Phase T-2: OpenHash 직접 앵커링 (난이도 ★★☆☆☆ | 기간: 1주)

**목표**: `/openhash/anchor` Worker 프록시 제거.

**현황**: 단말 → Worker → GitHub repository_dispatch. OPENHASH_TOKEN이 Worker에 있어서 필요한 구조.

**변경 내용**:
```
Before: 단말 → POST /openhash/anchor → Worker → GitHub repository_dispatch
After:  단말 → L1 HTTP POST /anchor_requests → L1이 GitHub dispatch
```

**단말 구현 (hashChain.js)**:
- `_submitToLayer()` 함수의 목적지를 Worker URL에서 L1 PocketBase URL로 변경
- L1 → GitHub dispatch 로직은 L1 쪽 GitHub Actions Hook으로 이전 (이미 anchor.yml 있음)
- 또는 L1이 직접 PocketBase hook으로 chain에 기록 (GitHub 우회)

**장기 방향**: GitHub 저장소 기반 GDUDA를 L1 PocketBase 자체 저장으로 이전하면 GitHub PAT도 불필요.

---

### Phase T-3: 인증 Ed25519 자기서명 전환 (난이도 ★★★☆☆ | 기간: 2~3주)

**목표**: HMAC-SHA256 세션 토큰(GOPANG_MASTER_KEY) → Ed25519 자기서명 토큰.

**현황**: Worker가 GOPANG_MASTER_KEY로 세션 토큰을 서명·검증. 서버를 신뢰하는 중앙 인증 구조.

**변경 내용**:
```
Before: 단말 → POST /auth/issue → Worker(HMAC 서명) → 세션 쿠키
After:  단말이 {ipv6:nonce:exp}에 자기 Ed25519 개인키로 서명 → Bearer 토큰
        수신자(L1 또는 상대방)가 user_profiles의 pubkey_ed25519로 검증
```

**단말 구현 (gopang-wallet.js)**:
- `signPayload(msg)` 이미 존재 → 인증 토큰 생성에 재사용
- `issueAuthToken(exp_seconds)` 신규 함수: `{ipv6, nonce, exp, sig}` 생성

**호환성**: WebAuthn(패스키)은 자기서명 방식과 자연스럽게 결합. passkey → Ed25519 토큰 발급 체인.

**검증**: Supabase RLS 정책을 Ed25519 토큰 기반으로 교체 또는 L1 접근 레이어로 이전.

---

### Phase T-4: 프로필·거래·P2P를 L1 직접으로 (난이도 ★★★☆☆ | 기간: 3~4주)

**목표**: Supabase user_profiles, biz_products, webrtc_signals → L1 PocketBase.

**현황**: Worker가 Supabase의 HTTP 프록시 역할. SUPABASE_SERVICE_KEY 필요.

**변경 내용**:
- L1 PocketBase에 동일 스키마 컬렉션 생성 (profiles, biz_products, webrtc_signals)
- 단말이 L1 API 직접 호출 (Ed25519 인증, Phase T-3 선행 필요)
- Worker의 `/profile`, `/biz/*`, `/signal/*` 핸들러 제거
- 검색(search_entities): L1 Full-Text Search 또는 L2 집계로 이전

**데이터 마이그레이션**: Supabase → L1 일괄 이전 스크립트 (Python, pg_dump → PocketBase import)

---

### Phase T-5: 거래 검증 단말화 (난이도 ★★★★☆ | 기간: 4~6주)

**목표**: `/biz/order` 검증 로직을 단말 + L1으로 분산.

**현황 (Worker가 하는 일)**:
1. 구매자 Ed25519 서명 검증
2. 판매자 카탈로그 가격 대조 (`_validateOrderAgainstMenu`)
3. 중요도 점수 계산 (`_computeImportanceScore`)
4. PLSM 계층 선택
5. L1 기록

**이관 방향**:
- **①③④⑤**: 단말이 서명 후 L1에 직접 제출, L1이 내부에서 ③④ 실행
- **②**: L1이 판매자 카탈로그를 보유하면 L1에서 직접 검증 가능
- Worker 역할: 소멸 (L1이 직접 수행)

---

### Phase T-6: 그림자 서명 하이브리드 (난이도 ★★★☆☆ | 기간: 2주)

**목표**: 단말 온라인 시 그림자가 직접 서명, 오프라인 시 signer Worker 폴백.

**현황**: signer Worker가 항상 서명 (`AGENT_SIGNER` Service Binding, §3.3에서 구현됨).

**변경 내용 (signer.js 내부만)**:
```javascript
// handleSign 내부:
// 1) 단말 WebSocket/HTTP로 "온라인인지" 확인
//    온라인 → 단말에 서명 요청 위임 (단말이 개인키 직접 보유)
//    오프라인 → 기존 커스터디 방식 (AGENT_KEK 복호화)
```

`_signerSign()` 인터페이스는 이미 추상화되어 있어 메인 worker.js 변경 없음.

---

### Phase T-7: 장기 — 완전 탈중앙 (1~2년, 전국 확장 단계)

| 기능 | 현재 서버 의존 이유 | 해소 방법 |
|---|---|---|
| AI API 키 | 상용 API 비용·키 보호 | 로컬 LLM(온디바이스) or DAO 공동 구매 모델 |
| 지오코딩 | 카카오 키 | OpenStreetMap/Nominatim (키 없음) 전환 |
| TURN 서버 | coturn 공유 비밀 | 사용자 자체 TURN 운영 또는 WebRTC TURN 없이 L1 릴레이 |
| Web Push | VAPID 서버 서명 | 네이티브 앱 전환 → FCM/APNs 직접 |
| 검색 집계 | 전체 DB 크로스-쿼리 | L2/L3 분산 Merkle 인덱스 |
| 관리자 편집 | 의도적 중앙화 | DAO 거버넌스 (OpenHash §7.4) |

---

## 4. 완료 후 Worker 잔류 기능 (최소화 목표)

Phase T-1~T-6 완료 시 Worker에 남는 것:

```
gopang-proxy (최소화 버전)
├── /chat/completions, /ai/chat   — AI API 키 보호 (BYOK 사용자는 불필요)
├── /geocode                      — 카카오 키 보호 (오픈소스 대안 시 삭제)
├── /turn/credential              — TURN 비밀 보호
├── /push/*                       — VAPID 서명 (네이티브 앱 전환 시 삭제)
└── /admin/*, /prompt             — 거버넌스 도구 (DAO 전환 시 이전)
```

현재 3,782줄 → 약 400줄 수준으로 축소. **"Cloudflare = 제3자 API 키 보관함"** 으로만 역할 축소.

---

## 5. 의존성 그래프 (이관 순서 시각화)

```
T-1 (PDV 직접)
  └── T-2 (OpenHash 직접)
        └── T-3 (Ed25519 인증)  ← 선행 없음, 독립 가능
              └── T-4 (프로필·P2P L1)
                    └── T-5 (거래 검증)
T-6 (그림자 하이브리드) ← T-3 선행 필요
```

T-1과 T-2는 독립적으로 시작 가능. T-3은 나머지 전체의 전제가 되는 핵심 선행 작업.

---

## 6. 이관 원칙 (개발 지침)

1. **인터페이스 먼저**: 단말의 호출 코드는 URL만 바꾸면 되도록 함수 경계를 유지한다. Worker 제거가 아니라 URL 교체로 이관이 완성돼야 한다.
2. **동시 운영 기간**: 이관 단계마다 Worker와 L1 직접 경로를 병렬 운영. 신뢰가 쌓이면 Worker 경로 삭제.
3. **오프라인 우선**: 단말이 오프라인일 때 IndexedDB 큐 → 온라인 시 자동 동기화. Worker 의존을 잃어도 앱이 작동해야 한다.
4. **검증은 L1으로**: "서버가 검증한다"에서 "L1이 검증한다"로. 비즈니스 룰은 L1 컬렉션 Rules/Hooks로.
5. **비밀 키 최소화**: Worker에 남는 비밀은 "제3자 API 키"뿐. 혼디 자체 비밀(GOPANG_MASTER_KEY, AGENT_KEK 등)은 전부 이관 또는 폐기.

---

*다음 작업: Phase T-1 구현 (PDV 로컬 직접 기록) — 가장 빠르고 안전하게 시작할 수 있는 이관 대상.*
