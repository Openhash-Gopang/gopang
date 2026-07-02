# 고팡 프로필 등록 시스템 인수인계 문서
> 작성일: 2026-06-15
> 버전: profile-register v2.0 (온보딩 단일화 반영)
> 저장소: https://github.com/Openhash-Gopang/gopang
> 배포: https://hondi.net (GitHub Pages)

---

## 1. 작업 목표

`register-profile.html` — 고팡 사용자 프로필 등록 페이지 신규 구현

### 사용자 흐름
```
[첫 접속]
hondi.net/webapp.html
  └─ gopang_user_v4 없음 감지
       └─ 온보딩: 전화번호 입력 → 즉시 GDC 사용자 등록 (게스트 없음)
            └─ hondi.net/webapp.html 진입 (등록 완료)

[프로필 등록 — 선택]
hondi.net/webapp.html
  └─ 설정 → "프로필 등록" 버튼
       └─ register-profile.html 이동
            ├─ 1단계: entity_type 선택
            │    ├─ 개인 (person)
            │    └─ 기관
            │         ├─ 사업자 (business)
            │         ├─ 공공기관 (institution)
            │         ├─ 협회/단체 (org)
            │         └─ 플랫폼 (platform)
            ├─ 2단계: 기본정보 입력 (entity_type별 동적 분기)
            ├─ 3단계: 위치·연락처·공개설정
            └─ 제출 → POST /profile (Ed25519 서명)
```

> **중요**: 전화번호 온보딩 완료 후에는 `gopang_user_v4`에 ipv6가 항상 존재합니다. `register-profile.html`에서 경량 ipv6 생성(`ensureIdentity`) 분기는 불필요합니다.

---

## 2. 기술 스택

| 항목 | 내용 |
|------|------|
| 인증 | `gopang-wallet.js` Ed25519 서명 + TOFU |
| API | CF Worker `/profile` POST (기존 구현 완료) |
| DB | Supabase `user_profiles` 테이블 (기존) |
| 업종 코드 | KSIC (한국표준산업분류) |
| 사업자번호 검증 | 형식 검증만 (10자리, 체크섬) |
| 스타일 | 고팡 통일 디자인 (#16a34a, Pretendard) |

---

## 3. entity_type별 입력 필드

### 공통 (모든 유형)
```
- name          : 이름/상호명
- description   : 소개
- address       : 주소 (Kakao 지오코딩)
- lat, lng      : 좌표
- phone         : 연락처
- website       : 웹사이트
- is_public     : 공개 여부
- tags          : 태그 (최대 5개)
- native_lang   : 주요 언어
```

### person (개인)
```
- 추가 필드 없음
- handle 형식: @{nickname} 또는 @{phone8}
```

### business (사업자)
```
- biz_reg_no    : 사업자등록번호 (10자리, 형식 검증)
- ksic_code     : KSIC 업종코드 (5자리)
- ksic_name     : 업종명 (코드 입력 시 자동 채움)
- ceo_name      : 대표자명
- biz_type      : 법인/개인사업자
- hours         : 영업시간
- gdc_accepted  : GDC 결제 수락 여부
```

### institution (공공기관)
```
- inst_code     : 기관코드
- ministry      : 소관부처
- est_date      : 설립일
- inst_type     : 중앙행정기관/지방자치단체/공기업/준정부기관/기타
```

### org (협회/단체)
```
- org_reg_no    : 단체등록번호 (선택)
- purpose       : 설립목적
- member_count  : 회원 수 (선택)
- est_date      : 설립일
```

### platform (플랫폼)
```
- platform_type : 마켓플레이스/커뮤니티/SaaS/기타
- api_endpoint  : API 엔드포인트 (선택)
```

---

## 4. KSIC 업종코드 체계

한국표준산업분류(KSIC) 10차 개정 기준:

### 대분류 (1자리)
```
A  농업, 임업 및 어업
B  광업
C  제조업
D  전기, 가스, 증기 및 공기 조절 공급업
E  수도, 하수 및 폐기물 처리, 원료 재생업
F  건설업
G  도매 및 소매업
H  운수 및 창고업
I  숙박 및 음식점업
J  정보통신업
K  금융 및 보험업
L  부동산업
M  전문, 과학 및 기술 서비스업
N  사업시설 관리, 사업 지원 및 임대 서비스업
O  공공 행정, 국방 및 사회보장 행정
P  교육 서비스업
Q  보건업 및 사회복지 서비스업
R  예술, 스포츠 및 여가 관련 서비스업
S  협회 및 단체, 수리 및 기타 개인 서비스업
T  가구 내 고용활동 및 달리 분류되지 않은 자가 소비 생산활동
U  국제 및 외국기관
```

### UI 구현 방식
```
1. 대분류 드롭다운 선택 → 중분류 동적 로드
2. 코드 직접 입력 (5자리) → 업종명 자동 표시
3. 검색창 입력 → 실시간 매칭
```

### 주요 업종코드 예시 (초기 하드코딩)
```javascript
const KSIC_MAJOR = {
  'I': '숙박 및 음식점업',
  'J': '정보통신업',
  'G': '도매 및 소매업',
  'Q': '보건업 및 사회복지',
  'P': '교육 서비스업',
  'M': '전문·과학·기술 서비스업',
  'K': '금융 및 보험업',
  'F': '건설업',
  'C': '제조업',
  'R': '예술·스포츠·여가',
  'S': '협회·단체·기타 서비스',
};
// 전체 코드는 /docs/ksic_codes.json 별도 파일로 관리
```

---

## 5. 사업자등록번호 형식 검증

```javascript
function validateBizRegNo(num) {
  // 형식: 000-00-00000 또는 10자리 숫자
  const digits = num.replace(/[^0-9]/g, '');
  if (digits.length !== 10) return false;

  // 체크섬 검증 (국세청 알고리즘)
  const weights = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(digits[i]) * weights[i];
  }
  sum += Math.floor((parseInt(digits[8]) * 5) / 10);
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === parseInt(digits[9]);
}
```

---

## 6. 기존 Worker /profile API

**이미 구현 완료** (worker.js v5.1):

```javascript
// POST /profile
// body: { guid, pubkey, signature, entity_type, name, ... }
// 인증: Ed25519 서명 + TOFU
// 저장: Supabase user_profiles

// GET /profile?guid={ipv6}
// GET /profile/{handle}
// 인증 불필요
```

### user_profiles 스키마 (기존)
```sql
guid, current_ipv6, pubkey_ed25519,
entity_type, name, handle, native_lang,
address, lat, lng, phone, website, is_public,
extra (JSONB) {
  public: {
    identity: { display_name, description, tags, entity_subtype },
    activity: { timezone, hours, holidays },
    contact:  { phone_display, website, sns_public, languages_spoken },
    location: { region, address_short, directions, parking },
    finance:  { gdc_accepted, currencies, price_range },
    industry_fields: { ... }   // 2026-06-22 추가, 아래 §6.1 참조
  }
}
```

> **2026-06-22 갱신**: `entity_type`은 이제 `person`/`business` 두 값만 신규 등록에 쓰입니다. institution/org/platform은 `entity_type:'business'` + `extra.public.identity.entity_subtype`로 흡수됨(`sql/phase2_entity_type_simplify.sql`). 아래 §3의 institution/org/platform 절은 **필드 정의 자체는 여전히 유효**하지만(어떤 정보를 받을지는 그대로), 그 정보가 들어가는 `entity_type` 값만 바뀌었습니다.

### 6.1 industry_fields — 업종/유형별 확장 슬롯 (2026-06-22 신설)
`identity`~`finance` 5개 섹션은 모든 유형 공통이라 구조 변경이 영구 금지된 "봉투"입니다. 업종마다(또는 institution/org/platform 유형마다) 다른 세부 필드는 이 슬롯 하나에 모읍니다 — 최상위에 새 섹션을 추가하지 않는 이유는 `profile_pdv_schema_plan_v1.md` Phase 1 참조.

```javascript
industry_fields: {
  schema_id:      "I56201",  // KSIC 코드(business) 또는 entity_subtype(institution/org/platform)
  schema_version: "1.0",     // AGENT-SUPPLIER-XX 파일의 스키마 버전과 일치
  // ... 그 스키마가 정의한 필드들
}
```
조회 키는 `entity_type='business'`면 `ksic_code`, 그 외(institution/org/platform)면 `entity_subtype`. 정의는 `prompts/AGENT-SUPPLIER-XX_*.txt`(또는 향후 institution/org/platform 전용 스키마 파일)에 있다.

`worker.js`의 `/profile` 핸들러는 `'industry_fields' in body`로 "필드 미전송(보존)"과 "명시적 `null`(비움)"을 구분한다 — 부분 갱신 시 의도치 않게 지워지지 않는다.

### 추가 필요 필드 (extra.public.identity에 추가)
```javascript
// business
biz_reg_no, ksic_code, ksic_name, ceo_name, biz_type

// institution
inst_code, ministry, est_date, inst_type

// org
org_reg_no, purpose, member_count, est_date

// platform
platform_type, api_endpoint
```

---

## 7. register-profile.html 구현 계획

### 파일 위치
```
hondi.net/register-profile.html  (루트)
```

### 의존 파일
```html
<script src="/gopang-wallet.js"></script>   <!-- Ed25519 키페어 자동 생성 -->
<link rel="stylesheet" href="/gopang-style.css">
```

### 3단계 폼 구조
```
[Step 1] entity_type 선택
  ┌─────────────────────────────┐
  │  👤 개인      🏢 사업자      │
  │  🏛 공공기관  🤝 협회/단체   │
  │  💻 플랫폼                  │
  └─────────────────────────────┘

[Step 2] 기본정보 (entity_type별 동적)
  - 공통 필드 + entity_type 전용 필드
  - 사업자: 사업자등록번호 형식 검증
  - 업종코드: 대분류 → 중분류 → 코드

[Step 3] 위치·연락처·공개설정
  - 주소 (Kakao 지오코딩, /geocode Worker 경유)
  - 영업시간 (요일별)
  - GDC 결제 수락 여부
  - is_public 토글
```

### 제출 흐름
```javascript
// 1. 신원 확인 (전화번호 온보딩 완료 후 항상 존재)
const stored = JSON.parse(localStorage.getItem('gopang_user_v4'));
const wallet = window.gopangWallet;
if (!wallet.guid) wallet.setIdentity({ guid: stored.ipv6, handle: stored.handle });

// 2. 페이로드 구성
const payload = { guid: stored.ipv6, pubkey: wallet.publicKeyB64u,
                  entity_type, name, ...formData };

// 3. Ed25519 서명
payload.signature = await wallet.sign(JSON.stringify(payload));

// 4. Worker POST /profile
await fetch('https://gopang-proxy.tensor-city.workers.dev/profile', {
  method: 'POST',
  body: JSON.stringify(payload)
});

// 5. global_profiles도 동시 업데이트 (/p2p/register)
await fetch('https://gopang-proxy.tensor-city.workers.dev/p2p/register', {
  method: 'POST',
  body: JSON.stringify({ guid: stored.ipv6, handle: stored.handle,
                         nickname: name, country_code: stored.country_code, ... })
});
```

---

## 8. 스토리지 키 참고

| 키 | 내용 |
|-----|------|
| `gopang_user_v4` | 현재 인증 사용자 (ipv6, handle, e164, country_code, nickname) |
| `gopang_cfg` | 설정 |

> ⚠️ `gopang_user_v3`는 구버전 — 현재는 `gopang_user_v4`만 사용. 모든 코드에서 v3 참조 제거 필요.
> ⚠️ `e164`가 추가됨 — 전화번호 기반 온보딩으로 guid를 언제든 재계산 가능 (기기 변경 복원용).

---

## 9. CF Worker 상수

```javascript
PROXY = 'https://gopang-proxy.tensor-city.workers.dev'
SUPABASE_URL = 'https://ebbecjfrwaswbdybbgiu.supabase.co'
L1_URL = 'https://l1-hanlim.hondi.net/api/collections/profiles/records'
```

---

## 10. 다음 구현 단계

```
Step 0. gopang-app.js 온보딩 교체
         - 기존 _showRegisterUI() (얼굴/시드/지문) 제거
         - 전화번호 입력 UI → phoneToGuid() → gopangWallet.setIdentity()
         - gopang_user_v4 저장 + POST /p2p/register

Step 1. /docs/ksic_codes.json 생성 (KSIC 전체 코드 데이터)

Step 2. register-profile.html 3단계 폼 구현
         - ensureIdentity() 분기 없음 (v4 항상 존재 보장)
         - 제출 흐름은 §7 참고

Step 3. webapp.html 설정 → "프로필 등록" 버튼 추가

Step 4. 완료 후 /profile/{handle} 프로필 보기 페이지 구현

Step 5. 테스트
         - 전화번호 온보딩 → 프로필 등록 전체 흐름
         - 사업자 프로필 등록 (사업자번호 형식 검증)
         - 검색에서 프로필 카드 표시
         - 기기 변경 복원 (전화번호 재입력)
```

---

## 11. 관련 문서

| 문서 | 경로 |
|------|------|
| ID/인증 통합 가이드 | `docs/gopang-id-auth-guide.md` |
| GDUDA P2P 설계 | `docs/GDUDA_P2P_Design_v1.md` |
| 인수인계 (auth v3.2) | `docs/GOPANG_AUTH_HANDOVER_v3.md` |
| Worker 소스 | `worker.js` (v5.1) |
| 앱 진입점 | `gopang-app.js` (v3.0) |
