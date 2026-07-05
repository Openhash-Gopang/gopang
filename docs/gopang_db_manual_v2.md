# 고팡(Gopang) Supabase DB 완전 매뉴얼 v2.0
**작성일**: 2026-06-12  
**프로젝트**: ebbecjfrwaswbdybbgiu.supabase.co  
**기준**: T01~T10 완료, 실제 Supabase 스키마 검증 완료  
**테이블**: 43개 | **Views**: 14개 | **Functions**: 9개 (사용자 정의)

---

## 목차

1. [DB 객체 전체 목록](#1-db-객체-전체-목록)
2. [테이블 그룹 개요](#2-테이블-그룹-개요)
3. [핵심 테이블 상세](#3-핵심-테이블-상세)
4. [GDC 금융 테이블](#4-gdc-금융-테이블)
5. [GDUDA 분산 네트워크 테이블](#5-gduda-분산-네트워크-테이블)
6. [K-Market 테이블](#6-k-market-테이블)
7. [K-Law 테이블](#7-k-law-테이블)
8. [K-School 테이블](#8-k-school-테이블)
9. [K-Security 테이블](#9-k-security-테이블)
10. [사용자 보조 테이블](#10-사용자-보조-테이블)
11. [공통 인프라 테이블](#11-공통-인프라-테이블)
12. [Views 상세](#12-views-상세)
13. [Functions 상세](#13-functions-상세)
14. [인덱스 전체 목록](#14-인덱스-전체-목록)
15. [CHECK 제약 전체 목록](#15-check-제약-전체-목록)
16. [3계층 동기화 구조](#16-3계층-동기화-구조)
17. [T-시리즈 DB 검증 기준](#17-t-시리즈-db-검증-기준)
18. [즉각 조치 가이드](#18-즉각-조치-가이드)

---

## 1. DB 객체 전체 목록

### 1.1 테이블 (43개)

| 그룹 | 테이블명 | 역할 |
|------|---------|------|
| **핵심** | `user_profiles` | 사용자/기관 마스터 프로필 |
| 핵심 | `fs_ledger` | 거래 원장 (차변/대변) |
| 핵심 | `l1_ledger` | L1 블록체인 미러 + Hash Chain |
| 핵심 | `pdv_log` | PDV 6하원칙 감사 로그 |
| 핵심 | `merkle_anchors` | 머클 루트 앵커링 기록 |
| **GDC** | `gdc_claims` | GDC 청구권 (buyer_claim/seller_claim) |
| GDC | `gdc_deposits` | GDC 예치금/정기예금 |
| **GDUDA** | `gduda_nodes` | 분산 네트워크 노드 |
| GDUDA | `gduda_openid_blocks` | OpenID 블록체인 |
| GDUDA | `gduda_propagation_log` | 노드 간 전파 로그 |
| GDUDA | `gduda_routing_table` | 노드 라우팅 테이블 |
| **K-Market** | `biz_orders` | 주문 레코드 |
| K-Market | `biz_products` | 상품/메뉴 목록 |
| K-Market | `biz_reviews` | 상품 리뷰 (product 단위) |
| K-Market | `reviews` | 거래 리뷰 (tx 단위) |
| K-Market | `review_votes` | 리뷰 유용성 투표 |
| K-Market | `seller_ratings` | 판매자 가중 평점 집계 |
| K-Market | `kmarket_sellers` | K-Market 판매자 (레거시) |
| K-Market | `kmarket_menus` | K-Market 메뉴 (레거시) |
| K-Market | `inventory` | 재고 관리 |
| **K-Law** | `klaw_cases` | K-Law 사건 DB |
| K-Law | `klaw_sessions` | K-Law 세션 기록 |
| K-Law | `klaw_benchmark` | K-Law 벤치마크 평가 |
| **K-School** | `school_student_profiles` | 학생 프로필 + 역량 점수 |
| K-School | `school_subjects` | 수강 과목 |
| K-School | `school_sessions` | 학습 세션 |
| K-School | `school_progress` | 과목별 진도 |
| K-School | `school_assessments` | 평가 기록 |
| K-School | `school_career_log` | 진로 변경 이력 |
| K-School | `school_reports` | 학습 리포트 |
| **K-Security** | `security_log` | 서비스 상태 모니터링 로그 |
| K-Security | `security_event` | 보안 이벤트 |
| K-Security | `security_command` | 보안 명령 |
| **사용자 보조** | `users` | 기기 등록 + GDUDA 전파 상태 |
| 사용자 보조 | `user_attributes` | 사용자 속성 (학력/자격) |
| 사용자 보조 | `user_nicknames` | 닉네임 원문 + 해시 |
| 사용자 보조 | `user_trust_levels` | 신뢰 레벨 (L0~L3) |
| 사용자 보조 | `user_gdc_settings` | GDC 수락 여부 |
| 사용자 보조 | `gopang_sessions` | JWT 세션 토큰 |
| 사용자 보조 | `location_log` | 위치 기록 |
| **공통 인프라** | `nickname_cache` | 닉네임 해시 캐시 (다국어) |
| 공통 인프라 | `lang_node_map` | 언어별 우선 노드 매핑 |
| 공통 인프라 | `region_node_map` | 지역별 노드 매핑 |
| 공통 인프라 | `reports` | 민원/신고 레코드 (공통) |

### 1.2 Views (14개)

| Views명 | 역할 |
|---------|------|
| `pdv_chain_integrity` | PDV ↔ L1 Hash 3계층 무결성 |
| `ktax_balance_anomalies` | 잔액 불일치 탐지 |
| `sigma_delta_by_node` | BIVM Σδ=0 검증 |
| `p1_tx_has_pdv` | P1 감사: 거래별 PDV 존재 |
| `p2_chain_continuity` | P2 감사: chain_height 연속성 |
| `p3_user_hash_unpatched` | P3 감사: user_hash 미교정 |
| `p4_chain_integrity_fail` | P4 감사: chain_local_hash ≠ user_hash |
| `p5_sigma_delta_fail` | P5 감사: Σδ≠0 위반 |
| `p6_balance_anomalies` | P6 감사: 잔액 불일치 |
| `klaw_benchmark_trend` | K-Law 벤치마크 추이 |
| `school_student_dashboard` | K-School 학생 대시보드 |
| `security_open_events` | 미해결 보안 이벤트 |
| `security_status` | 서비스별 최신 상태 |
| `security_uptime_1h` | 최근 1시간 가동률 |

### 1.3 Functions (사용자 정의, 9개)

| Function | 반환 타입 | 역할 |
|----------|---------|------|
| `reconstruct_balances(p_guid)` | RECORD | fs_ledger 집계 → 잔액 재구성 |
| `search_entities(...)` | RECORD | 엔티티 복합 검색 |
| `search_by_attributes(...)` | RECORD | 속성 기반 검색 |
| `market_purchase(...)` | JSONB | fs_ledger 3행 원자 INSERT |
| `payment_atomic(...)` | JSONB | 원자 결제 처리 |
| `gdc_settle_ledger(...)` | JSONB | GDC 정산 → extra.fs 갱신 |
| `validate_review(...)` | JSONB | 리뷰 작성 권한 검증 |
| `recalc_seller_rating(...)` | VOID | 판매자 평점 재계산 |
| `set_updated_at()` | TRIGGER | updated_at 자동 갱신 트리거 |

---

## 2. 테이블 그룹 개요

```
Gopang Supabase DB
│
├── 핵심 (5)          user_profiles, fs_ledger, l1_ledger, pdv_log, merkle_anchors
│
├── GDC 금융 (2)      gdc_claims, gdc_deposits
│
├── GDUDA 네트워크 (4) gduda_nodes, gduda_openid_blocks,
│                     gduda_propagation_log, gduda_routing_table
│
├── K-Market (10)     biz_orders, biz_products, biz_reviews, reviews,
│                     review_votes, seller_ratings,
│                     kmarket_sellers, kmarket_menus, inventory, reports
│
├── K-Law (3)         klaw_cases, klaw_sessions, klaw_benchmark
│
├── K-School (6)      school_student_profiles, school_subjects,
│                     school_sessions, school_progress,
│                     school_assessments, school_career_log, school_reports
│
├── K-Security (3)    security_log, security_event, security_command
│
├── 사용자 보조 (7)    users, user_attributes, user_nicknames,
│                     user_trust_levels, user_gdc_settings,
│                     gopang_sessions, location_log
│
└── 공통 인프라 (4)    nickname_cache, lang_node_map, region_node_map, reports
```

---

## 3. 핵심 테이블 상세

### 3.1 user_profiles — 사용자/기관 마스터 프로필

모든 엔티티(개인/사업자/기관)의 핵심 마스터. 고정 레이어 + `extra` JSONB 유동 레이어.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `guid` | TEXT | **PK** | 사용자 IPv6 주소. 시스템 전체 GUID 기준값 |
| `primary_guid` | TEXT | | 대표 GUID (일반적으로 guid와 동일) |
| `entity_type` | TEXT | | `'individual'` \| `'org'` \| `'institution'` |
| `name` | TEXT | | 이름/업체명. 검색 인덱스 대상 |
| `address` | TEXT | | 주소. 검색 인덱스 대상 |
| `handle` | TEXT | UNIQUE | QR URL 식별자 (`@hallim_geumneung`) |
| `native_lang` | TEXT | DEFAULT `'ko'` | 모국어 코드. 다국어 UI 자동 전환 기준 |
| `is_public` | BOOLEAN | | 검색 노출 여부 |
| `public_key` | TEXT | | **ED25519 공개키 (Base64url). 결제 서명 검증 기준** |
| `current_ipv6` | TEXT | | 현재 기기 IPv6 |
| `l1_node` | TEXT | | 소속 L1 노드 코드 |
| `extra` | **JSONB** | | entity_type별 유동 데이터. **extra.fs = 재무 상태** |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | 생성 시각 |
| `updated_at` | TIMESTAMPTZ | | 최종 수정 시각 |

**extra.fs 구조** (GDC settleLedger 후 갱신):
```json
{
  "bs-cash":     -41000,
  "pl-purchase":  41000,
  "pl-revenue":       0,
  "settled_at": "2026-06-12T..."
}
```

> **주의**: `extra.fs.bs-cash` = `Σcredit - Σdebit` (순변동분, 절대잔액 아님).  
> `reconstruct_balances()`와 반드시 동일 공식 사용.

**extra JSONB — entity_type별 표준 필드**:

| entity_type | 주요 필드 |
|-------------|---------|
| `individual` | `phone`, `gender`, `birthday`, `nationality`, `consumer:true`, `verified_at` |
| `org` | `phone`, `biz_reg_no`, `ceo_name`, `ksic_code`, `business_hours`, `gdc_accepted`, `menu[]`, `ai_active`, `fs` |
| `institution` | `phone`, `org_type`, `parent_org`, `departments[]`, `services[]`, `public_hours`, `ai_active` |

---

### 3.2 fs_ledger — 거래 원장

이중 기입 원장. 동일 거래 = 동일 `tx_id`/`block_hash`로 3행 (buyer debit + seller credit + platform fee credit).

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | BIGINT | **PK AUTO** | 자동증가 |
| `tx_id` | TEXT | | 거래 ID (Worker 생성) |
| `tx_at` | TIMESTAMPTZ | | 거래 시각 |
| `guid` | **TEXT** | | **행의 소유자 GUID** (buyer/seller/platform 각각) |
| `buyer_guid` | TEXT | | 구매자 GUID |
| `seller_guid` | TEXT | | 판매자 GUID |
| `direction` | TEXT | CHECK | **`'debit'`(지출) \| `'credit'`(수입)** |
| `amount` | NUMERIC | CHECK > 0 | 거래 금액. **항상 양수** |
| `fs_account` | TEXT | CHECK | 계정 과목 (아래 허용값 참조) |
| `item_name` | TEXT | | 상품/서비스명 |
| `item_id` | TEXT | | 상품 ID |
| `quantity` | INTEGER | | 수량 |
| `memo` | TEXT | | 거래 메모 |
| `source` | TEXT | **CHECK** | 출처 서비스 (아래 허용값 참조) |
| `block_hash` | TEXT | | **L1 블록 content_hash. l1_ledger JOIN 키** |
| `block_id` | TEXT | | L1 블록 레코드 ID |
| `prev_settle_hash` | TEXT | | 이전 거래 block_hash |

**fs_account CHECK 허용값**:
```
'bs-cash', 'pl-revenue', 'pl-purchase', 'pl-opex',
'pl-platform_fee', 'pl-interest_income', 'pl-interest_expense',
'pl-loan_repayment', 'bs-loan', 'bs-deposit'
```

**source CHECK 허용값**:
```
'market', 'gdc', 'insurance', 'tax', 'health', 'democracy', 'manual'
```
> **주의**: `'kmarket'` 등 prefix 형태 불가. INSERT 시 23514 오류 발생.

**계정 과목 처리 규칙**:

| 계정 | debit 처리 | credit 처리 | 설명 |
|------|-----------|------------|------|
| `bs-cash` | `cur - amount` | `cur + amount` | 현재 잔액 변동분 |
| `pl-purchase` | `cur + amount` (**양수 누적**) | — | 누적 구매액 |
| `pl-revenue` | — | `cur + amount` | 누적 매출액 |

> **주의**: `pl-purchase`를 `cur - amount`로 처리하면 음수 누적 오류 발생 (T08 수정).

---

### 3.3 l1_ledger — L1 블록체인 미러

L1 PocketBase 거래 블록을 Supabase에 미러링. Worker `updateNodeHashChain()`이 INSERT.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | BIGINT | **PK AUTO** | 자동증가 |
| `tx_id` | TEXT | | 거래 ID |
| `buyer_guid` | TEXT | | 구매자 GUID |
| `seller_guid` | TEXT | | 판매자 GUID |
| `block_hash` | **TEXT** | | **L1 content_hash. 핵심 JOIN 키** |
| `user_hash` | **TEXT** | | **IDB local_hash. `_patchL1LedgerUserHash()`로 사후 교정 필수** |
| `node_hash` | TEXT | | Worker H_N 해시. `SHA-256(prev_node_hash ∥ user_hash)` |
| `balance_claimed` | TEXT | | **거래 후 buyer 잔액 (절대값, 양수)**. 부호 없음 |
| `anchored_at` | TIMESTAMPTZ | DEFAULT now() | 앵커링 시각 |

> **주의 1**: `balance_claimed`은 buyer 잔액(절대값). Σδ 계산에 직접 사용 불가.  
> **주의 2**: `user_hash`는 Worker 산출값 ≠ 클라이언트 산출값. `_patchL1LedgerUserHash()` 교정 필수 (설계서 F4).

---

### 3.4 pdv_log — PDV 6하원칙 감사 로그

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | TEXT | **PK** | DEFAULT `gen_random_uuid()::TEXT` |
| `guid` | TEXT | | 사용자 GUID |
| `source` | TEXT | | 기록 출처 서비스 |
| `type` | TEXT | | 레코드 유형 |
| `report_id` | TEXT | | 보고서 ID |
| `summary` | TEXT | | 요약 |
| `summary_6w` | TEXT | | JSON: `{who,when,where,what,how,why}` |
| `session_id` | UUID | **UNIQUE (IS NOT NULL)** | 세션 ID. **중복 INSERT 차단 기준** |
| `chain_height` | INTEGER | | IDB hash_chain 높이. P2 연속성 감사 기준 |
| `chain_local_hash` | TEXT | | IDB local_hash. l1_ledger.user_hash와 일치 필수 |
| `block_hash` | TEXT | | L1 블록 해시 |
| `openhash_anchored` | BOOLEAN | DEFAULT false | **머클 앵커링 완료 여부. Cron이 true로 갱신** |
| `openhash_anchored_at` | TIMESTAMPTZ | | 앵커링 완료 시각 |
| `reporter_svc` | TEXT | | 기록 주체 서비스 |
| `via_worker` | BOOLEAN | DEFAULT false | Worker 경유 여부 |
| `risk_level` | TEXT | | `'low'`\|`'medium'`\|`'high'` |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | 생성 시각 |

**인덱스**:
```sql
-- 핵심: session_id 중복 방지
CREATE UNIQUE INDEX pdv_log_session_id_idx
  ON pdv_log (session_id) WHERE session_id IS NOT NULL;

-- 미앵커링 조회 (Cron 대상)
CREATE INDEX idx_pdv_log_pending_anchor
  ON pdv_log (id) WHERE openhash_anchored=false AND via_worker=true;

-- chain_height 연속성 감사
CREATE INDEX pdv_log_chain_height_idx ON pdv_log (chain_height);
```

> **필수**: `_recordPDV()` INSERT 시 `Prefer: return=minimal,resolution=ignore-duplicates` 헤더 필수.

---

### 3.5 merkle_anchors — 머클 앵커링 기록

Worker `anchorL1MerkleRoot()` Cron (10분)이 미앵커링 pdv_log를 머클 트리로 묶어 기록.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | **PK** | `gen_random_uuid()` |
| `merkle_root` | TEXT | NOT NULL | 머클 루트 해시 (SHA-256) |
| `anchored_at` | TIMESTAMPTZ | DEFAULT now() | 앵커링 시각 |
| `block_count` | INTEGER | NOT NULL | 포함된 pdv_log 건수 |
| `pdv_ids` | JSONB | NOT NULL | 포함된 pdv_log.id 배열 |
| `l1_block_hash` | TEXT | | L1 앵커 블록 해시 |
| `status` | TEXT | CHECK | `'pending'`\|`'confirmed'`\|`'failed'` |
| `created_at` | TIMESTAMPTZ | DEFAULT now() | 생성 시각 |

**머클 트리 알고리즘**:
```
leaf = chain_local_hash || block_hash || id (우선순위 순)
nodes = SHA-256(leaf) for each leaf
while nodes.length > 1:
  홀수 노드 → 마지막 복제
  next = SHA-256(left + right) for each pair
merkle_root = nodes[0]
```

---

## 4. GDC 금융 테이블

### 4.1 gdc_claims — GDC 청구권

거래 완료 시 Worker가 생성하는 buyer/seller 청구권. `expires_at` 내 미사용 시 자동 만료.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `claim_id` | TEXT | **PK** | 청구권 ID |
| `tx_id` | TEXT | NOT NULL | 거래 ID |
| `claimant` | TEXT | NOT NULL | 청구자 GUID |
| `direction` | TEXT | CHECK | `'debit'`\|`'credit'` |
| `amount` | NUMERIC | CHECK > 0 | 청구 금액 |
| `fs_account` | TEXT | CHECK | 계정 과목 |
| `block_id` | TEXT | | L1 블록 ID |
| `block_hash` | TEXT | | L1 블록 해시 |
| `issued_by` | TEXT | NOT NULL | 발급 주체 |
| `issued_at` | TIMESTAMPTZ | DEFAULT now() | 발급 시각 |
| `nonce` | TEXT | | 재사용 방지 nonce |
| `expires_at` | TIMESTAMPTZ | DEFAULT `now()+72h` | **만료 시각. 기본 72시간** |
| `claim_signature` | TEXT | | 청구권 서명 |
| `redeemed` | BOOLEAN | DEFAULT false | 사용 여부 |
| `redeemed_at` | TIMESTAMPTZ | | 사용 시각 |

> **T08 관련**: `gopang-wallet.js redeemClaim()`은 `expires_at < now()`인 청구권을 자동 무시.  
> Worker는 `buyer_claim.expires_at`을 7일로 생성하여 GWP_DONE에 포함.

### 4.2 gdc_deposits — GDC 예치금

GDC 예치/정기예금 상품.

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | BIGINT | **PK AUTO** | |
| `account_id` | TEXT | UNIQUE | `gen_random_uuid()` |
| `user_guid` | TEXT | NOT NULL | 예치자 GUID |
| `product_type` | TEXT | DEFAULT `'demand'` | 상품 유형 (demand/time) |
| `principal` | NUMERIC | DEFAULT 0 | 원금 |
| `interest_rate` | NUMERIC | DEFAULT 0.05 | 이율 (5%) |
| `accrued_interest` | NUMERIC | DEFAULT 0 | 누적 이자 |
| `maturity_date` | DATE | | 만기일 |
| `status` | TEXT | DEFAULT `'active'` | 상태 |
| `opened_at` | TIMESTAMPTZ | DEFAULT now() | 개설 시각 |
| `closed_at` | TIMESTAMPTZ | | 해지 시각 |
| `last_interest_at` | TIMESTAMPTZ | DEFAULT now() | 최종 이자 계산 시각 |

---

## 5. GDUDA 분산 네트워크 테이블

GDUDA(Gopang Distributed User Directory Architecture) — 분산 사용자 디렉토리.

### 5.1 gduda_nodes — 노드 목록

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK | |
| `node_id` | TEXT UNIQUE | 노드 식별자 |
| `node_level` | SMALLINT | 계층 레벨 (1=읍면동, 2=시군구, 3=광역, ...) |
| `node_name` | TEXT | 노드 이름 |
| `parent_node` | TEXT | 상위 노드 ID |
| `endpoint_url` | TEXT | API 엔드포인트 |
| `user_count` | INTEGER DEFAULT 0 | 등록 사용자 수 |
| `is_local` | BOOLEAN DEFAULT true | 로컬 노드 여부 |
| `is_active` | BOOLEAN DEFAULT true | 활성 여부 |
| `lat`, `lng` | DOUBLE PRECISION | 위치 좌표 |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### 5.2 gduda_openid_blocks — OpenID 블록체인

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK | |
| `block_hash` | TEXT UNIQUE | 블록 해시 |
| `prev_hash` | TEXT | 이전 블록 해시 |
| `block_type` | TEXT | 블록 유형 |
| `primary_guid` | TEXT | 소유자 GUID |
| `payload` | JSONB | 블록 페이로드 |
| `signature` | TEXT | ED25519 서명 |
| `is_verified` | BOOLEAN DEFAULT false | 검증 여부 |
| `created_at` | TIMESTAMPTZ | |

### 5.3 gduda_propagation_log — 전파 로그

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK | |
| `primary_guid` | TEXT | 전파 대상 GUID |
| `event_type` | TEXT | 이벤트 유형 |
| `from_level`, `to_level` | SMALLINT | 전파 방향 |
| `status` | TEXT DEFAULT `'pending'` | `pending`\|`done`\|`failed` |
| `payload` | JSONB | 전파 데이터 |
| `scheduled_at` | TIMESTAMPTZ | 예약 시각 |
| `propagated_at` | TIMESTAMPTZ | 완료 시각 |
| `error_msg` | TEXT | 오류 메시지 |

### 5.4 gduda_routing_table — 라우팅 테이블

노드 간 GUID/닉네임 라우팅 경로.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK | |
| `from_node`, `to_node` | TEXT | 라우팅 경로 |
| `primary_guid` | TEXT | 대상 GUID (nullable) |
| `nickname_hash` | TEXT | 대상 닉네임 해시 (nullable) |
| `hop_count` | SMALLINT DEFAULT 1 | 홉 수 |
| `latency_ms` | INTEGER | 지연 시간 |
| `last_verified` | TIMESTAMPTZ | 최종 검증 시각 |
| `ttl_seconds` | INTEGER DEFAULT 86400 | TTL (24시간) |

**조건부 UNIQUE 인덱스 4종** (GUID/닉네임 조합에 따라 다른 유일성 보장):
```sql
uq_routing_guid_only      -- primary_guid IS NOT NULL AND nickname_hash IS NULL
uq_routing_nickname_only  -- nickname_hash IS NOT NULL AND primary_guid IS NULL
uq_routing_node_only      -- 둘 다 NULL
uq_routing_with_guids     -- 둘 다 NOT NULL
```

---

## 6. K-Market 테이블

### 6.1 biz_orders — 주문 레코드

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | **PK** | `gen_random_uuid()` |
| `tx_id` | TEXT | UNIQUE | 거래 ID |
| `tx_signature` | TEXT | NOT NULL | ED25519 서명 |
| `buyer_pubkey` | TEXT | NOT NULL | 구매자 공개키 |
| `buyer_guid`, `seller_guid` | TEXT | NOT NULL | 구매자/판매자 GUID |
| `buyer_handle`, `seller_handle` | TEXT | | 핸들 |
| `product_id` | UUID | NOT NULL | `biz_products.id` |
| `product_name` | TEXT | NOT NULL | 상품명 |
| `quantity` | INTEGER | DEFAULT 1 | 수량 |
| `unit_price_krw`, `total_krw` | INTEGER | DEFAULT 0 | 원화 금액 |
| `unit_price_gdc`, `total_gdc` | NUMERIC | DEFAULT 0 | GDC 금액 |
| `status` | TEXT | CHECK | `'pending'`\|`'paid'`\|`'delivered'`\|`'completed'`\|`'cancelled'`\|`'refunded'` |
| `ledger_entry_id` | UUID | | fs_ledger 연결 ID |
| `l1_node` | TEXT | | L1 노드 |
| `memo` | TEXT | | 메모 |
| `created_at`, `updated_at` | TIMESTAMPTZ | | |

### 6.2 biz_products — 상품/메뉴

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID PK | |
| `seller_guid` | TEXT | 판매자 GUID |
| `seller_handle` | TEXT | 판매자 핸들 |
| `name` | TEXT NOT NULL | 상품명 |
| `description` | TEXT | 설명 |
| `category` | TEXT | 카테고리 |
| `price_gdc` | NUMERIC DEFAULT 0 | GDC 가격 (결제 기준) |
| `price_krw` | NUMERIC DEFAULT 0 | 원화 참고가 |
| `stock` | INTEGER | 재고 (NULL=무제한) |
| `image_urls` | TEXT[] | 이미지 URL 배열 |
| `tags` | TEXT[] | 태그 배열 |
| `sort_order` | INTEGER DEFAULT 0 | 정렬 순서 |
| `is_active` | BOOLEAN DEFAULT true | 노출 여부 |
| `l1_node` | TEXT | 등록 L1 노드 |

**인덱스**:
```sql
idx_biz_products_seller     -- (seller_guid, is_active)
idx_biz_products_l1_node    -- (l1_node, is_active)
idx_biz_products_name_trgm  -- GIN 트라이그램 (유사 검색)
```

### 6.3 biz_reviews — 상품 리뷰 (product 단위)

| 컬럼 | 타입 | 제약 | 설명 |
|------|------|------|------|
| `id` | UUID | PK | |
| `order_id` | TEXT | | validate_review() 반환값 |
| `tx_id` | TEXT | | 거래 tx_id |
| `reviewer_guid` | TEXT | | 작성자 |
| `seller_guid` | TEXT | | 판매자 |
| `product_id` | UUID | | biz_products.id |
| `rating` | SMALLINT | CHECK 1~5 | 별점 |
| `body` | TEXT | | 리뷰 본문 |
| `image_urls` | TEXT[] | | 이미지 URL |
| `is_visible` | BOOLEAN DEFAULT true | | 노출 여부 |
| `created_at` | TIMESTAMPTZ | | |

> UNIQUE: `(reviewer_guid, product_id)` — 상품당 1인 1리뷰.

### 6.4 reviews — 거래 리뷰 (tx 단위)

`biz_reviews`와 별개. 거래(tx_id) 단위 리뷰. `trg_set_review_seq` 트리거가 `buyer_review_seq` 자동 설정.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID PK | |
| `tx_id` | TEXT UNIQUE | 거래 ID (1거래 1리뷰) |
| `seller_guid` | TEXT | 판매자 |
| `buyer_guid` | TEXT | 구매자 |
| `item_id` | UUID | 상품 ID |
| `item_name` | TEXT | 상품명 |
| `stars` | SMALLINT | CHECK 1~5 |
| `comment` | TEXT | 리뷰 내용 |
| `tx_amount` | NUMERIC | 거래 금액 |
| `buyer_review_seq` | INTEGER DEFAULT 1 | 구매자의 n번째 리뷰 |
| `weight` | NUMERIC | 리뷰 가중치 |
| `helpful_count` | INTEGER DEFAULT 0 | 유용 투표 수 |
| `unhelpful_count` | INTEGER DEFAULT 0 | 비유용 투표 수 |
| `reward_paid` | BOOLEAN DEFAULT false | 리뷰 보상 지급 여부 |
| `created_at` | TIMESTAMPTZ | |

### 6.5 review_votes — 리뷰 유용성 투표

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID PK | |
| `review_id` | UUID | reviews.id |
| `voter_guid` | TEXT | 투표자 |
| `is_helpful` | BOOLEAN | true=유용, false=비유용 |
| `created_at` | TIMESTAMPTZ | |

> UNIQUE: `(review_id, voter_guid)` — 리뷰당 1인 1투표.

### 6.6 seller_ratings — 판매자 평점 집계

`trg_recalc_rating` 트리거가 reviews INSERT/UPDATE 시 자동 갱신.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `seller_guid` | TEXT PK | 판매자 GUID |
| `weighted_avg` | NUMERIC DEFAULT 0 | 가중 평균 별점 |
| `review_count` | INTEGER DEFAULT 0 | 리뷰 수 |
| `total_volume` | NUMERIC DEFAULT 0 | 총 거래 금액 |
| `updated_at` | TIMESTAMPTZ | 최종 갱신 |

### 6.7 kmarket_sellers / kmarket_menus — 레거시

초기 K-Market 구조. 현재는 `user_profiles` + `biz_products`로 대체됨. 하위 호환성 유지.

### 6.8 inventory — 재고 관리

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | UUID PK | |
| `owner_guid` | TEXT | 소유자 GUID |
| `name` | TEXT | 품목명 |
| `description` | TEXT | 설명 |
| `category` | TEXT | 분류 |
| `unit` | TEXT DEFAULT `'개'` | 단위 |
| `unit_price` | NUMERIC DEFAULT 0 | 단가 |
| `quantity` | NUMERIC DEFAULT 0 | 재고량 |
| `min_qty` | NUMERIC DEFAULT 0 | 최소 재고 알림 기준 |
| `delivery` | TEXT | 배송 방법 |
| `is_public` | BOOLEAN DEFAULT true | 공개 여부 |

---

## 7. K-Law 테이블

### 7.1 klaw_cases — 사건 DB

K-Law AI 법률 추론 시스템의 사건 레코드.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | TEXT PK | 사건 ID |
| `source` | TEXT DEFAULT `'webapp'` | 입력 출처 |
| `case_type`, `case_type_code` | TEXT | 사건 유형/코드 |
| `case_level` | TEXT | 사건 난이도 |
| `case_detail`, `case_input`, `case_summary` | TEXT | 사건 내용 |
| `plaintiff`, `defendant`, `dispute` | TEXT | 원고/피고/쟁점 |
| `verdict`, `verdict_full`, `verdict_type` | TEXT | 판결 요약/전문/유형 |
| `confidence`, `complexity`, `match_rate` | TEXT | 신뢰도/복잡도/일치율 |
| `llm_model` | TEXT DEFAULT `'deepseek'` | 사용 LLM |
| `klaw_version` | TEXT DEFAULT `'v15.1'` | K-Law 버전 |
| `reporter` | TEXT | 보고자 |
| `location`, `gps` | TEXT | 위치 정보 |
| `status` | TEXT DEFAULT `'completed'` | 상태 |
| `blockchain` | JSONB | 블록체인 앵커링 정보 |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### 7.2 klaw_sessions — 세션 기록

| 컬럼 | 설명 |
|------|------|
| `id` UUID PK | |
| `user_id` | 사용자 ID |
| `klaw_version`, `llm_model` | 버전/모델 |
| `case_type`, `case_level`, `case_summary` | 사건 정보 |
| `verdict`, `confidence`, `case_input` | 판결/신뢰도/입력 |
| `used_at` | 사용 시각 |

### 7.3 klaw_benchmark — 벤치마크 평가

K-Law 성능 평가 레코드. 실제 판결과 AI 판결 비교.

| 컬럼 | 설명 |
|------|------|
| `id` UUID PK | |
| `case_no` | 사건 번호 |
| `case_type`, `case_input` | 사건 유형/입력 |
| `virtual_verdict`, `real_verdict` | AI 판결/실제 판결 |
| `score_conclusion`, `score_law_logic`, `score_detail`, `score_total` | 평가 점수 |
| `grade` | 등급 |
| `eval_raw` | 평가 원문 |
| `klaw_version` DEFAULT `'v15.3'` | K-Law 버전 |
| `llm_model` DEFAULT `'deepseek-v4-pro'` | 사용 모델 |
| `reporter` | 보고자 |
| `summary` | 요약 |
| `created_at` | |

---

## 8. K-School 테이블

AI 기반 개인 맞춤 교육 시스템. 6개 테이블 + 1개 리포트.

### 8.1 school_student_profiles — 학생 프로필

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK AUTO | |
| `user_guid` | TEXT | 사용자 GUID |
| `display_name` | TEXT | 표시 이름 |
| `stage` | TEXT | CHECK: S1~S7 (학습 단계) |
| `age` | SMALLINT | CHECK 0~120 |
| `gender` | TEXT | 성별 |
| `native_language` | TEXT DEFAULT `'ko'` | 모국어 |
| `cultural_region` | TEXT | CHECK: western/east_asian/latin/african/middle_eastern/other |
| `personality` | TEXT[] | 성격 특성 배열 |
| `interests` | TEXT[] | 관심사 배열 |
| `learning_style` | TEXT | CHECK: visual/auditory/kinesthetic/reading |
| `c_score`, `p_score`, `cr_score`, `s_score`, `j_score` | NUMERIC | CHECK 0~100, 역량 점수 (각 50) |
| `ai_replaceability` | NUMERIC | AI 대체 가능성 (0~1) |
| `career_primary`, `career_personal`, `career_balance` | TEXT | 진로 추천 |
| `utility_score` | NUMERIC | CHECK 0~1 |
| `happiness_score` | NUMERIC | CHECK 0~1 |
| `created_at`, `updated_at` | TIMESTAMPTZ | |

### 8.2 school_subjects — 수강 과목

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `user_guid` | 사용자 GUID |
| `subject_id` | 과목 코드 |
| `subject_name_en`, `subject_name_ko` | 과목명 (영/한) |
| `stage` | 학습 단계 |
| `field_code` | 분야 코드 |
| `subject_type` | CHECK: core/HL/SL/major/elective/lab/reskill/optional |
| `oer_primary`, `oer_title`, `oer_url` | OER 자료 정보 |
| `total_hours`, `total_sessions`, `sessions_pw`, `session_minutes`, `duration_months` | 학습 계획 |
| `topic_blocks` | JSONB: 토픽 블록 구조 |
| `status` | CHECK: active/paused/completed/dropped |
| `started_at`, `completed_at` | 시작/완료 시각 |

### 8.3 school_sessions — 학습 세션

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `user_guid`, `subject_id` | 사용자/과목 |
| `session_no` | 세션 번호 |
| `topic_block`, `topic_detail` | 학습 주제 |
| `bloom_level` | CHECK 1~6 (블룸 분류) |
| `session_type` | CHECK: learning/review/assessment/supplementary |
| `session_minutes` | 학습 시간 |
| `comprehension` | CHECK 0~100 |
| `self_rating` | CHECK 0~10 |
| `summary`, `next_session`, `notes` | 세션 요약/다음 세션/메모 |
| `needs_supplement` | 보충 필요 여부 |
| `from_gwp`, `gwp_context` | GWP 연동 여부/컨텍스트 |

### 8.4 school_progress — 진도

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `user_guid`, `subject_id` | 사용자/과목 |
| `completed_sessions`, `total_sessions` | 완료/전체 세션 수 |
| `progress_pct` | 진도율 |
| `current_block`, `current_block_no` | 현재 블록 |
| `avg_comprehension`, `avg_self_rating` | 평균 이해도/자가평가 |
| `total_minutes` | 누적 학습 시간 |
| `bloom_achieved` | CHECK 1~6, 달성 블룸 레벨 |
| `pace_label` | CHECK: fast/normal/slow/very_slow |

### 8.5 school_assessments — 평가

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `user_guid`, `subject_id`, `session_id` | 연결 ID |
| `assessment_type` | CHECK: quiz_5session/self_rating/block_test/mid_term/final/bloom_check |
| `questions` | JSONB: 문항 |
| `score`, `max_score` | 점수/만점 |
| `bloom_level` | CHECK 1~6 |
| `wrong_topics` | TEXT[]: 오답 토픽 |
| `feedback`, `recommendation` | 피드백/추천 |
| `c_delta`, `cr_delta`, `s_delta`, `j_delta` | 역량 점수 변동 |

### 8.6 school_career_log — 진로 변경 이력

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `user_guid` | 사용자 |
| `event_type` | CHECK: initial_assignment/consultation/change_request/change_approved/change_conditional/change_rejected/periodic_review/ai_update |
| `career_before`, `career_after` | 변경 전/후 진로 |
| `career_alternatives` | TEXT[]: 대안 진로 |
| `utility_before`, `utility_after` | 효용 변화 |
| `social_impact_pct` | 사회적 영향도 |
| `happiness_before`, `happiness_after` | 행복도 변화 |
| `c_score`, `p_score`, `cr_score`, `s_score`, `j_score` | 역량 점수 스냅샷 |
| `ai_replaceability` | AI 대체 가능성 |
| `xai_reason`, `xai_uncertainty` | XAI 설명/불확실성 |
| `curriculum_rebuilt` | 커리큘럼 재구성 여부 |
| `processing_minutes` | 처리 시간 |

### 8.7 school_reports — 학습 리포트

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `user_guid` | 사용자 |
| `report_type` | 리포트 유형 |
| `period_start`, `period_end` | DATE: 기간 |
| `report_data` | JSONB DEFAULT `{}` |
| `pdv_entry_id` | pdv_log 연결 ID |
| `report_hash` | 리포트 해시 |
| `sent_to` | TEXT[]: 수신자 목록 |
| `generated_at`, `created_at` | 생성 시각 |

---

## 9. K-Security 테이블

### 9.1 security_log — 서비스 상태 모니터링

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK AUTO | |
| `svc` | TEXT | 서비스 ID |
| `svc_url` | TEXT | 서비스 URL |
| `status` | TEXT | CHECK: ok/warn/error/critical/offline |
| `latency_ms` | INTEGER | 응답 지연 ms |
| `auth_ok` | BOOLEAN DEFAULT true | 인증 정상 여부 |
| `pdv_ok` | BOOLEAN DEFAULT true | PDV 정상 여부 |
| `err_streak` | INTEGER DEFAULT 0 | 연속 오류 횟수 |
| `last_error` | TEXT | 최종 오류 메시지 |
| `uptime_sec` | INTEGER | 가동 시간 |
| `raw` | JSONB | 원시 데이터 |
| `created_at` | TIMESTAMPTZ | |

### 9.2 security_event — 보안 이벤트

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK AUTO | |
| `svc` | TEXT | 서비스 ID |
| `severity` | TEXT | CHECK: S1(긴급)/S2(경고)/S3(정보) |
| `title` | TEXT | 이벤트 제목 |
| `detail` | TEXT | 상세 내용 |
| `status` | TEXT | CHECK: open/investigating/resolved |
| `notified_at` | TIMESTAMPTZ | 알림 시각 |
| `resolved_at` | TIMESTAMPTZ | 해결 시각 |
| `raw` | JSONB | 원시 데이터 |
| `created_at` | TIMESTAMPTZ | |

### 9.3 security_command — 보안 명령

| 컬럼 | 타입 | 설명 |
|------|------|------|
| `id` | BIGINT PK AUTO | |
| `svc` | TEXT | 대상 서비스 |
| `cmd_type` | TEXT | 명령 유형 |
| `cmd_payload` | JSONB | 명령 페이로드 |
| `event_id` | BIGINT | security_event.id 연결 |
| `issued_at` | TIMESTAMPTZ | 발령 시각 |

---

## 10. 사용자 보조 테이블

### 10.1 users — 기기 등록

| 컬럼 | 설명 |
|------|------|
| `guid` TEXT PK | 사용자 GUID |
| `device_fp` | 기기 지문 |
| `phone` | 전화번호 |
| `registered_at`, `last_seen_at` | 등록/최종 접속 |
| `gduda_registered` BOOLEAN | GDUDA 등록 여부 |
| `gduda_registered_at` | GDUDA 등록 시각 |
| `l1_propagated_at`, `l2_propagated_at`, `l3_propagated_at` | 계층별 전파 완료 시각 |

### 10.2 user_attributes — 사용자 속성 (학력/자격)

ZKP 기반 속성 증명 저장.

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `primary_guid` | 사용자 GUID |
| `current_ipv6` | 현재 IPv6 |
| `attr_type` | 속성 유형 (학교, 자격증 등) |
| `attr_value_hash` | 속성값 해시 (원문 비공개) |
| `school_guid` | 학교 GUID |
| `enroll_year`, `graduate_year` | 입학/졸업 연도 |
| `role`, `field` | 역할/분야 |
| `attr_l3_node`, `attr_l2_node` | 속성 발급 노드 |
| `is_public` BOOLEAN DEFAULT true | 공개 여부 |
| `owner_signature` | 소유자 서명 |
| `submitted_at` | 제출 시각 |
| `is_active` BOOLEAN DEFAULT true | 유효 여부 |
| `revoked_at` | 폐지 시각 |

### 10.3 user_nicknames — 닉네임 원문 + 해시

| 컬럼 | 설명 |
|------|------|
| `id` BIGINT PK | |
| `guid` | 사용자 GUID |
| `nickname` | 닉네임 원문 |
| `nickname_hash` | SHA-256 해시 |
| `nickname_hash_v2` | v2 해시 (업데이트된 알고리즘) |
| `status` DEFAULT `'active'` | 상태 |
| `lang_code` DEFAULT `'ko'` | 언어 코드 |
| `script` | 문자 체계 |
| `handle` | 핸들 (`@xxx`) |
| `verified` BOOLEAN | 검증 여부 |
| `issuer_guid` | 발급자 GUID |

### 10.4 user_trust_levels — 신뢰 레벨

| 컬럼 | 설명 |
|------|------|
| `guid` TEXT PK | 사용자 GUID |
| `trust_level` DEFAULT `'L0'` | L0~L3 |
| `verified_at` | 검증 시각 |
| `verifier` | 검증자 |

### 10.5 user_gdc_settings — GDC 수락 여부

| 컬럼 | 설명 |
|------|------|
| `guid` TEXT PK | 사용자 GUID |
| `gdc_accepted` BOOLEAN DEFAULT false | GDC 결제 수락 여부 |
| `updated_at` | 갱신 시각 |

### 10.6 gopang_sessions — JWT 세션 토큰

| 컬럼 | 설명 |
|------|------|
| `token` TEXT PK | JWT 토큰 |
| `guid` | 사용자 GUID |
| `device_fp` | 기기 지문 |
| `created_at` | 생성 시각 |
| `expires_at` DEFAULT `now()+30d` | 만료 시각 |
| `last_used` | 최종 사용 |

### 10.7 location_log — 위치 기록

| 컬럼 | 설명 |
|------|------|
| `id` UUID PK | |
| `user_guid` | 사용자 GUID |
| `lat`, `lng` | 위도/경도 |
| `address` | 주소 (역지오코딩) |
| `recorded_at` | 기록 시각 |

---

## 11. 공통 인프라 테이블

### 11.1 nickname_cache — 닉네임 해시 캐시

GDUDA 노드 간 닉네임 해시 전파 캐시. TTL 기반 자동 만료.

| 컬럼 | 설명 |
|------|------|
| `nickname_hash` + `primary_guid` | **복합 PK** |
| `handle` | UNIQUE (IS NOT NULL AND != '') |
| `lang_code` DEFAULT `'ko'` | 언어 코드 |
| `script` | 문자 체계 |
| `verified` BOOLEAN DEFAULT false | 검증 여부 |
| `issuer_guid` | 발급자 |
| `l1_node`, `l2_node`, `l3_node` | 노드 계층 |
| `ttl` INTEGER DEFAULT 86400 | TTL (초) |
| `updated_at` | 갱신 시각 |

### 11.2 lang_node_map — 언어별 노드 매핑

| 컬럼 | 설명 |
|------|------|
| `lang_code` TEXT PK | 언어 코드 (`ko`, `zh`, `en` 등) |
| `priority_nodes` TEXT[] | 우선 노드 목록 |
| `fallback_global` BOOLEAN DEFAULT false | 글로벌 폴백 여부 |
| `note` | 메모 |
| `updated_at` | 갱신 시각 |

### 11.3 region_node_map — 지역별 노드 매핑

| 컬럼 | 설명 |
|------|------|
| `id` PK | |
| `region_text` TEXT UNIQUE | 지역명 텍스트 (`한림읍` 등) |
| `node_level` | 노드 계층 |
| `country_code` | 국가 코드 |

### 11.4 reports — 민원/신고 (공통)

K-119, K-Police, K-Public 등 공통 신고 레코드.

| 컬럼 | 설명 |
|------|------|
| `id` TEXT PK | 신고 ID |
| `type`, `type_code` | 신고 유형/코드 |
| `location`, `gps` | 위치/GPS |
| `reporter` | 신고자 GUID |
| `reported_at` | 신고 시각 |
| `urgency` | 긴급도 |
| `status` DEFAULT `'접수'` | 처리 상태 |
| `image_url` | 첨부 이미지 |
| `analysis`, `dispatch`, `cost` | JSONB: AI 분석/출동/비용 |
| `blockchain` | JSONB: 블록체인 앵커링 |
| `approved_at`, `approved_by`, `approved_cost` | 승인 정보 |
| `income_before_tax` | 세전 소득 |

---

## 12. Views 상세

### 12.1 감사 Views (P1~P6, T10)

```sql
-- 통합 감사 쿼리
SELECT 'P1' AS principle, COUNT(*) AS fail_count FROM p1_tx_has_pdv
UNION ALL SELECT 'P2', COUNT(*) FROM p2_chain_continuity
UNION ALL SELECT 'P3', COUNT(*) FROM p3_user_hash_unpatched
UNION ALL SELECT 'P4', COUNT(*) FROM p4_chain_integrity_fail
UNION ALL SELECT 'P5', COUNT(*) FROM p5_sigma_delta_fail
UNION ALL SELECT 'P6', COUNT(*) FROM p6_balance_anomalies;
-- 전체 0이면 T10 합격
```

| View | 감사 대상 | 제외 조건 |
|------|---------|---------|
| `p1_tx_has_pdv` | l1_ledger 거래 중 pdv_log 없는 건 | `block_hash NOT LIKE 'bh-%'` |
| `p2_chain_continuity` | chain_height gap≠1 | chain_height IS NOT NULL |
| `p3_user_hash_unpatched` | user_hash NULL/빈값 | `block_hash NOT LIKE 'bh-%'` |
| `p4_chain_integrity_fail` | chain_local_hash ≠ user_hash | |
| `p5_sigma_delta_fail` | sigma_delta_by_node WHERE sigma_delta>1 | |
| `p6_balance_anomalies` | ktax_balance_anomalies 재활용 | |

> **bh- 제외 이유**: t07_setup.py 생성 테스트 데이터는 실제 L1 거래가 아님. 감사 대상 제외.

### 12.2 ktax_balance_anomalies (T07)

`reconstruct_balances()` vs `user_profiles.extra.fs` 비교.

| anomaly_type | 원인 |
|-------------|------|
| `PROFILE_MISSING` | extra.fs가 NULL — settleLedger() 미실행 |
| `BS_CASH_MISMATCH` | bs-cash 공식 불일치 또는 동기화 누락 |
| `PL_PURCHASE_MISMATCH` | pl-purchase 불일치 |
| `PL_REVENUE_MISMATCH` | pl-revenue 불일치 |

### 12.3 sigma_delta_by_node (T07)

BIVM §4.2.1. `ABS(Σdebit - Σcredit) > 1`인 block_hash만 반환.

### 12.4 pdv_chain_integrity

`pdv_log LEFT JOIN l1_ledger ON block_hash`. `pdv_l1_match` = `chain_local_hash = user_hash` 여부.

### 12.5 K-Security Views

| View | 설명 |
|------|------|
| `security_open_events` | status='open' 이벤트 |
| `security_status` | 서비스별 최신 security_log 1건 |
| `security_uptime_1h` | 최근 1시간 가동률 |

### 12.6 klaw_benchmark_trend

K-Law 버전별 벤치마크 추이 집계.

### 12.7 school_student_dashboard

학생별 진도/역량 점수 통합 대시보드.

---

## 13. Functions 상세

### 13.1 reconstruct_balances(p_guid TEXT DEFAULT NULL)

```sql
-- fs_ledger 집계 → 사용자별 잔액 재구성
-- p_guid=NULL이면 전체
SELECT * FROM reconstruct_balances('2601:db80:...');
```

| 반환 | 공식 |
|------|------|
| `bs_cash` | `Σcredit - Σdebit` (순변동분) |
| `pl_purchase` | `Σdebit` (누적 구매, 양수) |
| `pl_revenue` | `Σcredit` (누적 매출) |
| `tx_count`, `last_tx_at` | 거래 수, 최종 시각 |

### 13.2 search_entities(p_keyword, p_occupation, p_address, p_entity_type)

`user_profiles` 복합 검색. GIN 트라이그램 인덱스 활용.

> **2026-07-05 진행 중**: market 검색과 "나만의 AI비서"(PDV 보유)의 역할
> 분담 재정의에 따라, 이 함수에 `p_taste_tags`/`p_budget_max` 등 개인화
> 파라미터를 추가하는 확장이 설계 단계에 있다(이 함수 자체는 여전히
> Supabase에 남는다 — 카탈로그 검색이므로). 개인화 신호를 만드는 쪽(PDV
> 선호 요약)은 별도로 **L1 PocketBase 네이티브**로 신설 중이며 세부는
> `supabase_to_l1_migration_plan.md`의 "2026-07-05 추가 결정" 참조.
> `p_taste_tags` 등의 실제 SQL 마이그레이션은 아직 적용 전이다.

### 13.3 search_by_attributes(...)

`user_attributes` 기반 속성 검색.

### 13.4 market_purchase(...)

fs_ledger 3행 원자 INSERT (buyer debit + seller credit + platform fee credit).

```sql
SELECT market_purchase(
  p_tx_id := 'tx-xxx', p_buyer_guid := '...', p_seller_guid := '...',
  p_item_name := '짜장면', p_quantity := 1,
  p_total := 7000, p_seller_net := 6965, p_fee := 35,
  p_block_hash := 'xxx', p_block_id := 'yyy'
);
```

### 13.5 payment_atomic(...)

원자 결제. 잔액 확인 + fs_ledger INSERT를 트랜잭션으로 처리.

### 13.6 gdc_settle_ledger(...)

`fs_ledger` 집계 → `user_profiles.extra.fs` UPDATE. `reconstruct_balances()`와 동일 공식 필수.

### 13.7 validate_review(p_reviewer_guid, p_product_id, p_tx_id)

리뷰 작성 권한 검증. 미구매 시 `NO_VALID_PURCHASE`, 중복 시 `ALREADY_REVIEWED` 반환.

### 13.8 recalc_seller_rating(seller_guid)

`reviews` 테이블 집계 → `seller_ratings` 갱신. `trg_recalc_rating` 트리거가 자동 호출.

### 13.9 트리거 Functions

| 트리거 | 대상 | 동작 |
|--------|------|------|
| `trg_set_updated_at` | 다수 테이블 | INSERT/UPDATE 시 `updated_at = now()` |
| `trg_recalc_rating` | `reviews` | INSERT/UPDATE/DELETE 시 `seller_ratings` 갱신 |
| `trg_set_review_seq` | `reviews` | INSERT 시 `buyer_review_seq` 자동 설정 |

---

## 14. 인덱스 전체 목록

### 핵심 테이블 인덱스

```sql
-- fs_ledger
idx_fs_ledger_guid_tx_at     (guid, tx_at DESC)
idx_fs_ledger_tx_id          (tx_id)
idx_fs_ledger_block_hash     (block_hash) WHERE NOT NULL
idx_fs_ledger_buyer_guid     (buyer_guid) WHERE NOT NULL
idx_fs_ledger_seller_guid    (seller_guid) WHERE NOT NULL
idx_fs_ledger_source         (source)

-- pdv_log
pdv_log_session_id_idx       UNIQUE (session_id) WHERE NOT NULL  ← 핵심
pdv_log_chain_height_idx     (chain_height)
idx_pdv_log_pending_anchor   (id) WHERE anchored=false AND via_worker=true

-- merkle_anchors
idx_merkle_anchors_status    (status, anchored_at DESC)
idx_merkle_anchors_root      (merkle_root)

-- biz_products
idx_biz_products_seller      (seller_guid, is_active)
idx_biz_products_name_trgm   GIN 트라이그램
```

### 주요 비즈니스 인덱스

```sql
-- biz_orders
idx_biz_orders_buyer    (buyer_guid, status)
idx_biz_orders_seller   (seller_guid, status)
idx_biz_orders_product  (product_id, status)
biz_orders_tx_id_key    UNIQUE (tx_id)

-- biz_reviews
idx_biz_reviews_once    UNIQUE (reviewer_guid, product_id)
idx_biz_reviews_product (product_id, is_visible)

-- reviews
reviews_tx_id_key       UNIQUE (tx_id)

-- gdc_claims
idx_gdc_claims_expires_at     (expires_at)
idx_gdc_claims_claimant_redeemed (claimant, redeemed)

-- gopang_sessions
idx_sessions_guid  (guid)
```

---

## 15. CHECK 제약 전체 목록

| 테이블 | 컬럼 | 허용값 |
|--------|------|--------|
| `fs_ledger` | `direction` | `'debit'`, `'credit'` |
| `fs_ledger` | `amount` | > 0 |
| `fs_ledger` | `source` | market, gdc, insurance, tax, health, democracy, manual |
| `fs_ledger` | `fs_account` | bs-cash, pl-revenue, pl-purchase, pl-opex, pl-platform_fee, pl-interest_income, pl-interest_expense, pl-loan_repayment, bs-loan, bs-deposit |
| `gdc_claims` | `direction` | `'debit'`, `'credit'` |
| `gdc_claims` | `amount` | > 0 |
| `gdc_claims` | `fs_account` | (fs_ledger와 동일) |
| `biz_orders` | `status` | pending, paid, delivered, completed, cancelled, refunded |
| `biz_reviews` | `rating` | 1~5 |
| `reviews` | `stars` | 1~5 |
| `merkle_anchors` | `status` | pending, confirmed, failed |
| `security_log` | `status` | ok, warn, error, critical, offline |
| `security_event` | `severity` | S1, S2, S3 |
| `security_event` | `status` | open, investigating, resolved |
| `school_student_profiles` | `stage` | S1~S7 |
| `school_student_profiles` | `cultural_region` | western, east_asian, latin, african, middle_eastern, other |
| `school_student_profiles` | `learning_style` | visual, auditory, kinesthetic, reading |
| `school_student_profiles` | 역량 점수 | 0~100 |
| `school_student_profiles` | utility_score, happiness_score | 0~1 |
| `school_subjects` | `subject_type` | core, HL, SL, major, elective, lab, reskill, optional |
| `school_subjects` | `status` | active, paused, completed, dropped |
| `school_sessions` | `session_type` | learning, review, assessment, supplementary |
| `school_sessions` | `bloom_level` | 1~6 |
| `school_sessions` | `comprehension` | 0~100 |
| `school_sessions` | `self_rating` | 0~10 |
| `school_progress` | `bloom_achieved` | 1~6 |
| `school_progress` | `pace_label` | fast, normal, slow, very_slow |
| `school_assessments` | `assessment_type` | quiz_5session, self_rating, block_test, mid_term, final, bloom_check |
| `school_assessments` | `bloom_level` | 1~6 |
| `school_career_log` | `event_type` | initial_assignment, consultation, change_request, change_approved, change_conditional, change_rejected, periodic_review, ai_update |

---

## 16. 3계층 동기화 구조

### 16.1 거래 완료 후 데이터 흐름

```
① Worker handleBizOrder
   → fs_ledger 3행 INSERT (market_purchase RPC)
     buyer debit / seller credit / gopang-platform credit

② Worker updateNodeHashChain
   → l1_ledger INSERT (block_hash, user_hash, node_hash, balance_claimed)

③ Worker (T08 신규)
   → buyer_claim 생성 {direction, amount, expires_at:7일}
   → GWP_DONE에 포함하여 클라이언트 전달

④ gopang-app.js redeemClaim
   → IDB financial_state 갱신
     bs-cash 차감, pl-purchase 양수 누적

⑤ gopang-app.js _patchL1LedgerUserHash
   → l1_ledger.user_hash ← IDB local_hash PATCH 교정

⑥ gopang-app.js _recordPDV
   → pdv_log INSERT
   → Prefer: resolution=ignore-duplicates 필수

⑦ GDC gdc_settle_ledger()
   → fs_ledger 집계 → user_profiles.extra.fs UPDATE

⑧ Worker Cron (10분)
   → anchorL1MerkleRoot()
   → pdv_log 배치 앵커링 → merkle_anchors INSERT
```

### 16.2 핵심 불변 조건

**STALE_STATE 방지**:
```
IDB financial_state.block_hash
  = L1 blocks 최신 content_hash
```

**PDV Hash Chain 3계층 일치 (v3.0)**:
```
IDB hash_chain[N].local_hash
  = pdv_log.chain_local_hash  (chain_height = N)
  = l1_ledger.user_hash       (PATCH 후)
```

**BIVM Σδ=0**:
```
Σ(fs_ledger debit) = Σ(fs_ledger credit) per block_hash
buyer debit = seller credit + gopang-platform credit (수수료)
```

---

## 17. T-시리즈 DB 검증 기준

| T | 항목 | 검증 SQL | 상태 |
|---|------|---------|------|
| T01 | 기본 주문 | L1 /api/tx 200 OK | ✅ |
| T02 | AI 검색 | `SELECT * FROM search_entities(p_keyword=>'짜장면',...)` | ✅ |
| T03 | SSO 팝업 | gopang_token URL 파라미터 전달 | ✅ |
| T04 | 반복 주문 | STALE_STATE 없이 연속 주문 | ✅ |
| T05 | 앵커링 | `SELECT COUNT(*) FROM pdv_chain_integrity WHERE pdv_l1_match=FALSE; -- =0` | ✅ |
| T06 | IDB 무결성 | `gopangWallet.verifyChain() → {valid:true}` | ✅ |
| T07 | 잔액 일치 | `SELECT COUNT(*) FROM ktax_balance_anomalies; -- =0` | ✅ |
| T07 | Σδ=0 | `SELECT COUNT(*) FROM sigma_delta_by_node WHERE sigma_delta>1; -- =0` | ✅ |
| T08 | 오프라인 청구권 | buyer_claim expires_at 생성, pl-purchase 양수 | ✅ |
| T09 | 중복 방지 | `SELECT session_id, COUNT(*) FROM pdv_log GROUP BY session_id HAVING COUNT(*)>1; -- 0rows` | ✅ |
| T10 | P1~P6 전체 | 위 통합 감사 쿼리 전체 0 | ✅ |
| T10 | 머클 검증 | `GET /merkle/verify?pdv_id=xxx → {valid:true}` | ✅ |

---

## 18. 즉각 조치 가이드

### ktax_balance_anomalies > 0
```sql
-- 불일치 내용 확인
SELECT guid, anomaly_type, ledger_bs_cash, profile_bs_cash
FROM ktax_balance_anomalies;
```
- `PROFILE_MISSING`: `t07_setup.py` 재실행
- `BS_CASH_MISMATCH`: `gdc_settle_ledger()` 공식 확인 (`Σcredit - Σdebit` 필수)

### 409 STALE_STATE
```javascript
// hondi.net 콘솔
const req = indexedDB.open('gopang-wallet');
req.onsuccess = e => e.target.result.transaction('keys')
  .objectStore('keys').get('financial_state')
  .onsuccess = ev => console.log(ev.target.result?.block_hash);
```

### pdv_l1_match = false
1. `window.gopangWallet.publicKeyB64u` 확인
2. L1 `gdc_keys` 공개키와 비교
3. `_patchL1LedgerUserHash()` 재실행

### 머클 앵커링 안 됨
```
Cloudflare → gopang-proxy → Triggers → Cron: */10 * * * *
Schedule 탭 → Test → [Merkle] 로그 확인
```

### fs_ledger source 오류 (23514)
```sql
-- 허용값 확인
SELECT pg_get_constraintdef(oid)
FROM pg_constraint WHERE conname = 'fs_ledger_source_check';
-- 허용: market, gdc, insurance, tax, health, democracy, manual
```

---

*Gopang Supabase DB 완전 매뉴얼 v2.0*  
*AI City Inc. 팀 주피터 | 2026-06-12*  
*실제 Supabase 스키마 검증 완료 — 테이블 43개, Views 14개, Functions 9개*
