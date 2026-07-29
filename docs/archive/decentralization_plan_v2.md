# 혼디 탈중앙화 이관 계획서 v2
**작성** Claude Sonnet 4.6 | 2026-06-23  
**v1 대비** 사고실험으로 발견한 오류 12건 반영. 의존성 순서 재정렬, 난이도 재평가, 구조적 결함 수정.

---

## 0. v1에서 발견된 오류 목록

| ID | Phase | 유형 | 심각도 |
|---|---|---|---|
| E-01 | T-1/T-2 | 의존성 순서 오류 — PDV가 앵커링을 내부 호출하므로 T-2가 T-1 선행 필요 | 🔴 높음 |
| E-02 | T-1 | 난이도 과소평가 — ★☆☆☆☆ → 실제 ★★★☆☆ | 🟡 중간 |
| E-03 | T-2 | 검증 파이프라인 누락 — verify.yml 대체 방안 미정의 | 🟡 중간 |
| E-04 | T-3 | 토큰 폐기(revocation) 불가 — 단말 분실 시 대응 방법 누락 | 🔴 높음 |
| E-05 | T-3 | WebAuthn-Ed25519 연결 미검증 — iOS Safari 지원 여부 불확실 | 🟡 중간 |
| E-06 | T-4 | "단순 Supabase 프록시" 오류 — /profile POST는 6단계 수행 | 🔴 높음 |
| E-07 | T-4 | 검색 tsvector/GIN 이관 불가 — PocketBase 미지원, 대안 미정의 | 🔴 높음 |
| E-08 | T-4 | 그림자 생성 분리 전략 누락 — L1 이관 시 AGENT_SIGNER 호출 불가 | 🔴 높음 |
| E-09 | T-5 | 이중지불 방지 선행조건 누락 — LPBFT 실제 구현 필요 | 🔴 높음 |
| E-10 | T-5 | 카탈로그 검증 주체 오류 — 구매자가 직접 검증 시 조작 가능 | 🔴 높음 |
| E-11 | T-6 | 구현 방법 부재 — Workers 역방향 연결 불가 | 🟡 중간 |
| E-12 | 전체 | P2P 시그널링 "이미 부분 이전" 사실 오류 | 🟡 중간 |

---

## 1. 이관 불가 확정 기능 (변경 없음)

| 기능 | 이유 | 해소 조건 |
|---|---|---|
| AI API 프록시 | API 키 보호 | 온디바이스 LLM 성숙 또는 DAO 공동 구매 (T-7) |
| 지오코딩 | 카카오 키 보호 | OpenStreetMap/Nominatim 전환 시 |
| TURN 자격증명 | coturn 공유 비밀 | 사용자 자체 TURN 또는 L1 릴레이 |
| Web Push 발송 | RFC 8291 VAPID 서버 서명 필수 | 네이티브 앱 전환 시 (FCM/APNs) |
| 관리자 도구 | 의도적 중앙화 | DAO 거버넌스 전환 시 |
| 검색 집계 | PostgreSQL tsvector/GIN (E-07) | 전용 검색 엔진 또는 L2/L3 분산 인덱스 |

**추가 확인 (v1 수정)**: 검색은 v1에서 "L1 PocketBase View로 교체 가능"이라 했으나, PocketBase는 tsvector·GIN을 지원하지 않아 불가. 전용 검색 솔루션(MeiliSearch, Typesense, Elasticsearch) 또는 L2/L3 집계 레이어가 필요하다.

---

## 2. 수정된 의존성 그래프

```
v1의 오류 순서:
  T-1(PDV) → T-2(앵커링) → T-3(인증) → T-4(프로필) → T-5(거래)

v2 수정 순서 (E-01 반영):

[병렬 가능]
  T-A: L1 PocketBase 스키마 확장          ← 모든 Phase의 선행 인프라
  T-B: Ed25519 자기서명 인증 + 폐기 메커니즘  ← T-3 재정의, 나머지 전체 선행
  T-C: OpenHash 직접 앵커링               ← T-1의 선행 조건

[T-A, T-B, T-C 완료 후]
  T-1: PDV 로컬 우선화                    ← T-C 선행 필수
  T-2: P2P 시그널링 L1 직접              ← T-B 선행 필수

[T-1, T-2 완료 후]
  T-3: 프로필·피드백 L1 직접             ← 그림자 분리 전략 포함
  T-4: 그림자 서명 하이브리드            ← Durable Objects 방식으로 재설계

[T-3 완료 + LPBFT 실구현 후]
  T-5: 거래 검증 (L1 + Market Agent 역할 유지)

[장기]
  T-7: 온디바이스 LLM, OSM, 네이티브 앱
```

---

## 3. 수정된 Phase별 계획

### Phase T-A: L1 인프라 확장 (선행 조건 | 난이도 ★★☆☆☆ | 기간: 1~2주)

**목적**: 이후 모든 Phase가 쓸 L1 PocketBase 컬렉션을 미리 정의한다.

**신설 컬렉션**:

| 컬렉션 | 역할 | 대응 Supabase 테이블 |
|---|---|---|
| `pdv_records` | PDV 기록 | `pdv_log` |
| `anchor_records` | 해시 앵커 | GitHub dispatch 결과 |
| `webrtc_signals` | P2P 시그널 | `webrtc_signals` |
| `profiles` | 사용자 프로필 | `user_profiles` |
| `agent_keys` | 그림자 암호키 | `agent_keys` |
| `biz_products` | 상품 카탈로그 | `biz_products` |

**인증 방식**: 모든 컬렉션에 Ed25519 서명 기반 Rule 적용 (T-B 완료 후 활성화).

---

### Phase T-B: Ed25519 자기서명 인증 (선행 조건 | 난이도 ★★★★☆ | 기간: 3~4주)

**v1 대비 변경**: E-04(폐기 불가), E-05(WebAuthn 호환) 해결 추가.

**토큰 구조**:
```json
{
  "ipv6":    "사용자 guid",
  "nonce":   "무작위 32바이트 (재사용 방지)",
  "exp":     1234567890,
  "revoked": false,
  "sig":     "Ed25519 서명"
}
```

**E-04 해결 — 폐기 메커니즘**:

자기서명 토큰은 원칙상 폐기 불가이므로, **L1에 nonce 블랙리스트 컬렉션**(`revoked_nonces`)을 둔다.

```
단말 분실 시:
1. 사용자가 다른 기기에서 복구 키로 로그인
2. POST /auth/revoke {nonce: "탈취된 토큰의 nonce"}
3. L1의 revoked_nonces에 등록 → 이후 해당 nonce를 가진 토큰 거부
4. 새 키쌍 생성 → 구 공개키를 user_profiles에서 교체
```

**tradeoff**: nonce 블랙리스트 자체가 중앙 의존 지점. 그러나 "평상시에는 분산, 비상시에만 L1 조회"로 타협 가능. L1이 다운되면 폐기가 지연되나 정상 인증도 지연됨 — 동일 조건.

**E-05 해결 — WebAuthn 호환성**:

iOS Safari(16.4+)는 Ed25519(`cose: -8`) WebAuthn을 지원하나 P-256(`cose: -7`)이 기본값이다. 등록 시 알고리즘을 명시해야 한다:

```javascript
// register-profile.html의 WebAuthn 등록 옵션에 추가
pubKeyCredParams: [
  { type: 'public-key', alg: -8 },   // Ed25519 (우선)
  { type: 'public-key', alg: -7 },   // P-256 (폴백)
]
```

P-256 폴백 시 gopang-wallet과 키 타입이 다름 → 별도 처리 필요. 단기적으로 Ed25519 지원 기기에서만 WebAuthn 연동 활성화하고, 미지원 기기는 기존 전화번호 인증 유지.

---

### Phase T-C: OpenHash 직접 앵커링 (선행 조건 | 난이도 ★★☆☆☆ | 기간: 1~2주)

**v1 대비 변경**: E-03(verify.yml 대체) 해결 추가. T-1의 선행 조건으로 명시.

**앵커링 흐름 변경**:
```
Before: 단말 → Worker(/openhash/anchor) → GitHub repository_dispatch
After:  단말 → L1 PocketBase POST /anchor_records → L1 내부에서 해시체인 append
```

**E-03 해결 — verify.yml 대체**:

GitHub Actions verify.yml이 하던 일(prev_hash 검증)을 L1 PocketBase의 **Before Save Hook**으로 이전:

```javascript
// L1 PocketBase, anchor_records Before Save Hook
onRecordBeforeCreate('anchor_records', (e) => {
  const prev = $app.dao().findLastRecord('anchor_records', ...)
  const expectedPrevHash = sha256(prev.contentHash + prev.ts)
  if (e.record.get('prev_hash') !== expectedPrevHash) {
    throw new Error('CHAIN_BROKEN: prev_hash 불일치')
  }
})
```

이 방식의 장점: 매시간 Actions 실행 없이 실시간 검증. 단점: PocketBase가 단일 노드이면 검증 주체도 단일 → L2/L3 ILMV 감사가 보완.

---

### Phase T-1: PDV 로컬 우선화 (난이도 ★★★☆☆ → 수정 | 기간: 2~3주)

**선행 조건**: T-A(L1 pdv_records), T-B(Ed25519 인증), **T-C(앵커링)** ← v1에 없던 선행 조건

**v1 대비 변경**: E-01(순서 오류), E-02(난이도 재평가) 수정.

**단말 → L1 직접 흐름**:
```
1. 단말 IndexedDB에 우선 기록 (오프라인 지원)
2. 온라인 시: L1 POST /pdv_records (Ed25519 Bearer)
3. L1 Before Save Hook: 6하원칙 보완 검사 + 중복(session_id) 체크
4. L1 After Save Hook: anchor_records에 자동 앵커링 트리거
```

**Worker에서 단말 SDK로 이전할 로직**:
- `_compute6W()`: 6하원칙 보완 → L1 Hook 또는 단말 SDK
- `_computeImportanceScore()`: 순수 함수 → 단말 SDK로 복사 (src/openhash/importanceVerifier.js 재사용)
- 중복 체크: Supabase `session_id unique constraint` → L1 컬렉션 unique index

---

### Phase T-2: P2P 시그널링 L1 직접 (난이도 ★★☆☆☆ | 기간: 1~2주)

**선행 조건**: T-A(L1 webrtc_signals), T-B(Ed25519 인증)

**v1 대비 변경**: E-12(사실 오류 수정) — P2P 시그널링은 "이미 부분 이전"이 아니라 아직 Supabase 전용.

**변경 내용**:
```
Before: 단말 → Worker(/signal/send) → Supabase webrtc_signals
After:  단말 → L1 PocketBase /webrtc_signals (Ed25519 Bearer)
```

L1에 이미 `webrtc_signals` 컬렉션이 있음(Oracle VM, 168.110.123.175). Worker의 `L1_SIGNAL_URL` 상수가 이미 L1을 가리키고 있으므로, Worker 경유를 건너뛰고 단말이 직접 호출로 전환.

---

### Phase T-3: 프로필·피드백 L1 직접 (난이도 ★★★★☆ → 수정 | 기간: 4~6주)

**선행 조건**: T-A, T-B, T-1 완료

**v1 대비 변경**: E-06("단순 프록시" 오류), E-08(그림자 분리) 해결.

**/profile POST의 실제 6단계와 이관 전략**:

| 단계 | 현재 위치 | 이관 전략 |
|---|---|---|
| ① Ed25519 서명 검증 | Worker | L1 Auth Rule (Ed25519) |
| ② industry_fields 화이트리스트 | Worker | L1 Before Save Hook |
| ③ LCAT 계산 | Worker | L1 After Save Hook |
| ④ search_text/tsvector 생성 | Worker + Supabase | 🔴 MeiliSearch 또는 별도 인덱서 |
| ⑤ 그림자 자동 생성 | Worker → AGENT_SIGNER | 별도 이벤트 트리거 (아래) |
| ⑥ OpenHash 앵커링 | Worker → GitHub | L1 After Save Hook (T-C 방식) |

**E-08 해결 — 그림자 생성 분리 전략**:

L1이 직접 Cloudflare Service Binding을 호출할 수 없으므로, 그림자 생성을 **이벤트 기반**으로 분리:

```
프로필 등록 완료 이벤트(L1 After Save) 
  → L1이 Cloudflare Worker에 Webhook POST
  → Worker의 신규 엔드포인트 /agent/create-for-profile이 AGENT_SIGNER 호출
  → 그림자 키 생성 + agent_keys에 저장
```

이 구조에서 Worker는 "그림자 키 커스터디 + Webhook 수신자"로만 역할 축소. 프로필 CRUD 자체는 L1 직접.

**E-07 해결 — 검색 tsvector 대안**:

단기: Worker의 `/search` 엔드포인트는 유지 (Supabase tsvector 그대로). Supabase → L1 전환 시 별도 검색 인덱서 필요.

장기 옵션:
- MeiliSearch (제주 L2 노드에 사이드카 배포, 오픈소스)
- Typesense (경량, 한국어 형태소 플러그인 지원)
- L1 PocketBase FTS (기본 내장, 한국어 성능 제한 있음)

---

### Phase T-4: 그림자 서명 하이브리드 (난이도 ★★★★☆ → 수정 | 기간: 3~4주)

**선행 조건**: T-B(Ed25519 인증), T-3(프로필 L1)

**v1 대비 변경**: E-11(구현 방법 부재) 해결 — Cloudflare Durable Objects 방식으로 재설계.

**문제**: Worker는 단말에 역방향 연결 개시 불가. 단말 온라인 여부를 능동적으로 확인할 수 없다.

**해결 방안 — Presence Durable Object**:

```
단말이 온라인 될 때:
  단말 → POST /agent/presence {agent_guid, online: true, ws_token}
  → Durable Object가 WebSocket 유지 (단말과 연결 유지)

서명 요청 시:
  AGENT_SIGNER → Presence DO 확인 → 단말 온라인이면 WS로 서명 위임
                                    단말 오프라인이면 AGENT_KEK 커스터디 폴백
```

**tradeoff**: Durable Objects는 Cloudflare 유료 플랜 필요. 혼디 운영 비용에 반영 필요. 또는 단순화: 단말 온라인 시 단말이 직접 `/agent/sign` 대신 자체 서명 후 결과만 전달 — 더 단순하고 Durable Objects 불필요.

**단순화 방안**:
```
단말이 온라인: 단말이 gopangWallet.sign()으로 직접 서명 → 결과를 요청자에게 반환
단말 오프라인: signer Worker가 AGENT_KEK로 복호화 후 서명
라우팅 결정: 요청자(상대방)가 단말에 먼저 시도, timeout이면 signer로 폴백
```

이 방식은 Durable Objects 없이 구현 가능하나, 단말 오프라인 감지 타임아웃(~5초) 지연 발생.

---

### Phase T-5: 거래 검증 재설계 (난이도 ★★★★★ | 기간: 6~8주)

**선행 조건**: T-3 완료 + **LPBFT 실제 구현 완료** (E-09) + T-A~T-C

**v1 대비 변경**: E-09(LPBFT 선행), E-10(카탈로그 검증 주체) 수정.

**E-10 수정 — 카탈로그 검증 주체**:

구매자 단말이 직접 검증하면 조작 가능하므로, **Market Agent(KSIC 46, 독립 L1 노드)**가 검증 주체가 된다:

```
구매자 → Market Agent L1: "한림국수 고기국수 2그릇 주문"
Market Agent L1 → 한림국수 L1: 카탈로그 조회 (가격, 재고)
Market Agent L1: 가격 검증 + [TRADE] 블록 조립
Market Agent L1 → 구매자: 서명 요청
구매자: gopangWallet.sign() → 결제
```

Market Agent가 중립 검증자 역할을 유지하되, Cloudflare Worker가 아닌 L1 PocketBase Hook으로 구현.

**E-09 수정 — LPBFT 선행 조건**:

이중지불 방지를 위한 LPBFT 실제 구현이 선행돼야 한다:

1. L1~L5 실제 쿼럼(제주 5개 기관) 참여 협의 완료
2. lpbft.js의 "로컬 시뮬레이션" → 실제 네트워크 메시지 전송으로 교체
3. 잔액 원자적 업데이트를 LPBFT 합의 후에만 허용

이 조건 미충족 시 T-5는 착수하지 않는다.

---

### Phase T-7: 장기 완전 탈중앙 (1~3년 | 수정)

**v1 대비 변경**: E-11 반영 — 온디바이스 LLM의 현실적 한계 명시.

| 기능 | 해소 경로 | 현실적 시기 |
|---|---|---|
| AI API 키 | 2~3B 온디바이스 모델(의도 분류·요약). 복잡 추론은 공동 서버 풀 | 2027~2028 |
| 지오코딩 | OpenStreetMap/Nominatim (키 없음) | 즉시 가능, 정확도 tradeoff |
| TURN 서버 | L1 릴레이 또는 사용자 자체 TURN | L1 안정화 후 |
| Web Push | PWA → 네이티브 앱 (FCM/APNs) | 앱 출시 시 |
| 검색 | MeiliSearch on L2, 또는 L3 집계 | T-3 이후 |
| 관리자 도구 | OpenHash DAO 거버넌스 (§7.4) | 전국 확장 후 |

**단말 LLM 현실적 범위 (2026~2027)**:
- 가능: 의도 분류(SP-00-ROUTER 역할), 짧은 응답 생성, 감정 분석 (2~3B 모델, <2GB RAM)
- 불가: 법률·의료·세금 복잡 추론, 긴 문서 처리 (서버 LLM 유지 필요)

---

## 4. 수정된 Phase 요약표

| Phase | 내용 | 난이도 v1→v2 | 기간 v1→v2 | 주요 선행 조건 |
|---|---|---|---|---|
| **T-A** | L1 스키마 확장 (신설) | — | 1~2주 | 없음 |
| **T-B** | Ed25519 자기서명 인증 + 폐기 메커니즘 (T-3 재정의) | ★★★☆☆ → ★★★★☆ | 2~3주 → 3~4주 | T-A |
| **T-C** | OpenHash 직접 앵커링 (T-2 → T-C로 승격) | ★★☆☆☆ → ★★☆☆☆ | 1주 → 1~2주 | T-A |
| **T-1** | PDV 로컬 우선화 | ★☆☆☆☆ → **★★★☆☆** | 1~2주 → **2~3주** | T-A, T-B, **T-C** |
| **T-2** | P2P 시그널링 L1 직접 (신규) | — | 1~2주 | T-A, T-B |
| **T-3** | 프로필·피드백 L1 직접 | ★★★☆☆ → **★★★★☆** | 3~4주 → **4~6주** | T-A, T-B, T-1 |
| **T-4** | 그림자 서명 하이브리드 | ★★★☆☆ → **★★★★☆** | 2주 → **3~4주** | T-B, T-3 |
| **T-5** | 거래 검증 (Market Agent L1) | ★★★★☆ → **★★★★★** | 4~6주 → **6~8주** | T-3 + **LPBFT 실구현** |
| **T-7** | 장기 완전 탈중앙 | — | 1~3년 | — |

---

## 5. Worker 잔류 기능 (수정)

Phase T-A~T-4 완료 시 Worker에 남는 것 (v1과 달라진 부분 **굵게**):

```
gopang-proxy (최소화 버전)
├── /chat/completions, /ai/chat   — AI API 키 보호 (변경 없음)
├── /geocode                      — 카카오 키 보호 (변경 없음)
├── /turn/credential              — TURN 비밀 보호 (변경 없음)
├── /push/*                       — VAPID 서명 (변경 없음)
├── /search                       — tsvector 검색 (T-7까지 유지, E-07)
├── /agent/create-for-profile     — 그림자 생성 Webhook 수신 (신규, E-08)
└── /admin/*, /prompt             — 거버넌스 도구 (변경 없음)
```

v1 예상 "400줄"에서 실제 약 **600~700줄** 수준으로 수정. 검색과 그림자 Webhook이 남기 때문.

---

## 6. 개발 원칙 (v1 유지 + 1개 추가)

기존 5개 원칙 유지. 추가:

6. **검증 주체 불변 원칙**: 거래 관련 검증(가격, 잔액)은 반드시 중립적인 제3자(L1 또는 Market Agent)가 수행한다. 구매자 단말이 자신에게 유리한 검증 결과를 제출하는 구조는 금지.

---

*다음 작업 권장 순서: T-A(L1 스키마 확장) → T-B(Ed25519 인증) 병렬 시작. T-B가 가장 복잡하고 모든 이후 Phase의 전제이므로 가장 먼저 설계를 확정해야 한다.*
