# 고팡 PDV 조회 프로토콜 명세
## `/pdv/query` — PDV Read Interface Specification

> **문서 코드:** PROTO-PDV-QUERY  
> **버전:** v1.0  
> **작성일:** 2026-06-05  
> **작성자:** AI City Inc. (팀 주피터)  
> **관련 문서:** `gopang_pdv_rules.md` · `gopang-auth-whitepaper.md` · `Gopang_Developer_Manual_v2_0.docx`  
> **적용 대상:** K-Insurance (insurance.gopang.net) 및 PDV 데이터를 읽어야 하는 모든 하위 서비스  
> **문의:** dev@gopang.net

---

## 배경 및 설계 원칙

### 왜 새 엔드포인트가 필요한가

기존 `/pdv/report`는 **쓰기(write) 전용**입니다. 하위 서비스가 사용자의 활동을 PDV에 기록할 때 사용합니다.

K-Insurance는 사용자의 PDV에 **이미 축적된** K-Traffic · K-Health · 일반 생활 기록을 LLM에 전달하여 보험료를 산출해야 합니다. 이를 위해 **읽기(read) 전용** 엔드포인트 `/pdv/query`가 필요합니다.

### 설계 원칙 (백서 §2, §3 준수)

```
원칙 1: 사용자 AI 비서만 PDV에 직접 접근한다
  하위 서비스는 gopang-proxy를 통해 간접 조회만 허용된다.
  직접 pdv_log SELECT 쿼리 절대 금지.

원칙 2: 사용자 명시적 동의가 선행되어야 한다
  하위 서비스의 PDV 조회 요청은 반드시 사용자 동의를 거친다.
  동의 없는 조회 요청은 Worker가 거부한다.

원칙 3: 조회 범위(scope)를 최소화한다
  하위 서비스는 필요한 데이터 유형만 명시하여 요청한다.
  Worker는 scope 외 데이터를 절대 반환하지 않는다.

원칙 4: 반환 데이터는 6하원칙 요약만이다
  원본 기록(원문, 이미지, 상세 로그)은 반환하지 않는다.
  pdv_log의 summary, summary_6w, risk_level만 반환한다.

원칙 5: 조회 행위 자체를 PDV에 기록한다
  누가 언제 어떤 서비스에 PDV 조회 동의를 했는지
  pdv_log에 consent_event로 기록한다.
```

---

## 전체 소통 흐름

```
K-Insurance (insurance.gopang.net)
      │
      │  ① POST /pdv/query  (consent_token 없이 — 동의 요청 단계)
      ▼
gopang-proxy Worker
      │
      │  ② 사용자 고팡 앱에 동의 팝업 요청
      │     (postMessage 또는 gopang.net/consent UI)
      ▼
사용자 고팡 AI 비서 (gopang.net)
      │
      │  ③ 사용자가 동의 확인 → consent_token 발급
      │     (HMAC-SHA256, TTL 300초)
      ▼
gopang-proxy Worker
      │
      │  ④ POST /pdv/query  (consent_token 포함 — 실제 조회 단계)
      │     pdv_log에서 scope에 해당하는 6w 요약 반환
      │     조회 행위를 pdv_log에 consent_event로 기록
      ▼
K-Insurance
      │
      │  ⑤ PDV 요약 + user.ipv6 + auth_token을 페이로드로
      │     POST /deepseek → DeepSeek V4 Pro 호출
      │     (system_prompt: SP-KINSURANCE-v1_0.txt)
      ▼
보험료 산출 결과 (위험 종류별)
      │
      │  ⑥ POST /pdv/report  (산출 결과를 PDV에 기록)
      ▼
insurance_reports 테이블 저장 + pdv_log 기록
```

---

## 엔드포인트 명세

### `POST /pdv/query`

```
URL:     https://gopang-proxy.tensor-city.workers.dev/pdv/query
Method:  POST
Origin:  https://insurance.gopang.net  (CORS 검증 필수)
```

---

## 요청 페이로드

### 단계 A — 동의 요청 (consent_token 없음)

하위 서비스가 사용자에게 PDV 조회 동의를 요청하는 첫 번째 호출입니다.

```json
{
  "query": {
    "svc":     "kinsurance",
    "ipv6":    "2601:db80:a3f8:...",
    "purpose": "월별 보험료 자동 산출을 위한 위험도 분석",
    "scope": [
      "ktraffic",
      "khealth",
      "pdv_general"
    ],
    "period": {
      "start": "2026-05-01",
      "end":   "2026-05-31"
    },
    "auth_token": {
      "level":  "L1",
      "exp":    1749100000
    }
  }
}
```

**Worker 응답 — 동의 대기 (202 Accepted):**

```json
{
  "ok":      false,
  "status":  "CONSENT_REQUIRED",
  "consent": {
    "request_id":   "CNSREQ-a3f8b2c1-1749012345",
    "expires_at":   1749012645,
    "consent_url":  "https://gopang.net/consent?req=CNSREQ-a3f8b2c1-...",
    "message":      "사용자가 고팡 앱에서 PDV 조회에 동의해야 합니다."
  }
}
```

---

### 단계 B — 실제 조회 (consent_token 포함)

사용자가 동의 후 발급된 `consent_token`을 포함하여 재호출합니다.

```json
{
  "query": {
    "svc":     "kinsurance",
    "ipv6":    "2601:db80:a3f8:...",
    "purpose": "월별 보험료 자동 산출을 위한 위험도 분석",
    "scope": [
      "ktraffic",
      "khealth",
      "pdv_general"
    ],
    "period": {
      "start": "2026-05-01",
      "end":   "2026-05-31"
    },
    "auth_token": {
      "level":  "L1",
      "exp":    1749100000
    },
    "consent_token": "HMAC-SHA256-BASE64URL...",
    "request_id":    "CNSREQ-a3f8b2c1-1749012345"
  }
}
```

---

## 필드 상세

### `query` 객체

| 필드 | 타입 | 필수 | 설명 |
|------|------|------|------|
| `svc` | string | ✅ | `REGISTERED_SERVICES` 키. K-Insurance: `"kinsurance"` |
| `ipv6` | string | ✅ | 사용자 IPv6 GUID. `subsystem-auth.js`의 `user.ipv6` |
| `purpose` | string | ✅ | 조회 목적 (사용자에게 동의 팝업에 표시됨) |
| `scope` | string[] | ✅ | 조회할 데이터 소스 목록. 아래 scope 코드 참조 |
| `period` | object | ✅ | 조회 기간. `start`, `end` 모두 `YYYY-MM-DD` |
| `auth_token` | object | ✅ | `subsystem-auth.js` 발급 토큰. `level`, `exp` 포함 |
| `consent_token` | string | 단계B만 | 사용자 동의 후 gopang.net이 발급한 HMAC 토큰 |
| `request_id` | string | 단계B만 | 단계A 응답에서 수신한 동의 요청 ID |

### `scope` 코드

| 코드 | 데이터 소스 | 반환 내용 | 필요 인증 레벨 |
|------|------------|----------|--------------|
| `ktraffic` | K-Traffic PDV | 운행 이력 6w 요약, 사고 횟수, 위험 운전 빈도, 무사고 기간 | L1 |
| `khealth` | K-Health PDV | 진료 이력 6w 요약, 만성질환 여부, 입원 횟수, 최근 진료일 | L1 |
| `pdv_general` | 일반 PDV | 생활 패턴 6w 요약, 심야 외출 빈도, 위험 직종 여부 | L1 |
| `kmarket` | K-Market PDV | 배달 주문 이력 (배달 보험 산출용) | L0 |
| `k119` | K-119 PDV | 응급 출동 이력 (응급 보험 산출용) | L1 |

---

## 응답 페이로드

### 성공 응답 (200 OK)

```json
{
  "ok":        true,
  "query_id":  "PDVQ-a3f8b2c1-1749012400",
  "ipv6":      "2601:db80:a3f8:...",
  "period": {
    "start": "2026-05-01",
    "end":   "2026-05-31"
  },
  "pdv_summary": {
    "ktraffic": {
      "available":   true,
      "entry_count": 42,
      "risk_level":  "low",
      "summary_6w": {
        "who":   "운전자 본인",
        "when":  "2026-05-01 ~ 2026-05-31",
        "where": "제주시 일원",
        "what":  "총 42회 운행, 1,280km. 무사고. 과속 0회.",
        "how":   "K-Traffic 자동 기록",
        "why":   "일상 이동"
      },
      "risk_factors": {
        "accident_count":       0,
        "speeding_count":       0,
        "night_driving_ratio":  0.08,
        "accident_free_months": 36
      }
    },
    "khealth": {
      "available":   true,
      "entry_count": 3,
      "risk_level":  "low",
      "summary_6w": {
        "who":   "본인",
        "when":  "2026-05-01 ~ 2026-05-31",
        "where": "제주시 내 의료기관",
        "what":  "외래 진료 2회 (감기, 물리치료). 입원 없음.",
        "how":   "K-Health 자동 기록",
        "why":   "건강 관리"
      },
      "risk_factors": {
        "chronic_disease":     false,
        "hospitalization_count": 0,
        "last_checkup_days":   180,
        "prescription_count":  2
      }
    },
    "pdv_general": {
      "available":   true,
      "entry_count": 124,
      "risk_level":  "low",
      "summary_6w": {
        "who":   "본인",
        "when":  "2026-05-01 ~ 2026-05-31",
        "where": "제주시 노형동 중심",
        "what":  "규칙적 생활 패턴. 심야 외출 월 2회. 위험 직종 아님.",
        "how":   "PDV 자동 기록",
        "why":   "일상 기록"
      },
      "risk_factors": {
        "night_outing_count": 2,
        "hazardous_job":      false,
        "irregular_pattern":  false
      }
    }
  },
  "consent": {
    "granted_at":  "2026-06-05T10:30:00Z",
    "expires_at":  "2026-06-05T10:35:00Z",
    "pdv_entry_id": "PDV-a3f8b2c1-1749012400"
  }
}
```

---

## 오류 코드

| HTTP | 코드 | 원인 | 조치 |
|------|------|------|------|
| 202 | `CONSENT_REQUIRED` | 동의 토큰 없음 (정상 — 단계A 응답) | `consent_url`로 사용자 유도 |
| 400 | `SCHEMA_ERROR` | 필수 필드 누락 또는 타입 오류 | 요청 페이로드 검토 |
| 400 | `SCOPE_INVALID` | 허용되지 않은 scope 코드 | scope 목록 확인 |
| 400 | `PERIOD_TOO_LONG` | 조회 기간이 12개월 초과 | period 단축 |
| 401 | `AUTH_EXPIRED` | `auth_token.exp` 만료 | `gopangAuth.require()` 재호출 |
| 401 | `CONSENT_EXPIRED` | `consent_token` TTL(300초) 초과 | 단계A부터 재시작 |
| 401 | `CONSENT_INVALID` | HMAC 서명 불일치 | 단계A부터 재시작 |
| 403 | `SVC_NOT_REGISTERED` | `REGISTERED_SERVICES`에 미등록 | `dev@gopang.net` 등록 요청 |
| 403 | `LEVEL_INSUFFICIENT` | scope 대비 인증 레벨 부족 | `gopangAuth.require('L1')` 호출 |
| 403 | `ORIGIN_DENIED` | CORS Origin 불일치 | `ALLOWED_ORIGINS` 등록 확인 |
| 404 | `NO_PDV_DATA` | 해당 scope · 기간 데이터 없음 | 기간 또는 scope 조정 |
| 429 | `RATE_LIMITED` | 동일 사용자 5분 내 3회 초과 | 5분 후 재시도 |
| 500 | `INTERNAL_ERROR` | Worker 내부 오류 | `detail` 필드 확인 후 신고 |

---

## Worker 구현 명세

### `worker.js`에 추가할 핸들러

```javascript
// ── 라우팅 (기존 /pdv/report 라우트 이전에 위치) ──────────
// if (path === '/pdv/query')  → handlePdvQuery(request, env, corsHeaders)
// if (path === '/pdv/report') → handlePdvReport(...)   // 기존 유지

async function handlePdvQuery(request, env, corsHeaders) {
  if (request.method !== 'POST')
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });

  try {
    const body  = await request.json();
    const query = body?.query;

    // ── 1. 스키마 검증 ─────────────────────────────────────
    if (!query?.svc || !query?.ipv6 || !query?.scope || !query?.period)
      return _err(400, 'SCHEMA_ERROR', '필수 필드 누락: svc, ipv6, scope, period', corsHeaders);

    if (!Array.isArray(query.scope) || query.scope.length === 0)
      return _err(400, 'SCOPE_INVALID', 'scope는 비어있지 않은 배열이어야 합니다', corsHeaders);

    const VALID_SCOPES = ['ktraffic','khealth','pdv_general','kmarket','k119'];
    const invalidScope = query.scope.find(s => !VALID_SCOPES.includes(s));
    if (invalidScope)
      return _err(400, 'SCOPE_INVALID', `허용되지 않은 scope: ${invalidScope}`, corsHeaders);

    // ── 2. 서비스 등록 확인 ───────────────────────────────
    const svcReg = _getSvcRegistration(query.svc, request);
    if (!svcReg)
      return _err(403, 'SVC_NOT_REGISTERED', `미등록 서비스: ${query.svc}`, corsHeaders);

    // ── 3. 인증 레벨 확인 ─────────────────────────────────
    const authToken = query.auth_token;
    if (!authToken?.exp || Date.now() / 1000 > authToken.exp)
      return _err(401, 'AUTH_EXPIRED', '인증 토큰이 만료되었습니다', corsHeaders);

    const LEVEL_ORDER = { L0:0, L1:1, L2:2, L3:3 };
    // khealth, ktraffic, pdv_general은 L1 필요
    const needsL1 = query.scope.some(s => ['ktraffic','khealth','pdv_general','k119'].includes(s));
    if (needsL1 && LEVEL_ORDER[authToken.level] < 1)
      return _err(403, 'LEVEL_INSUFFICIENT', 'PDV 조회는 L1 이상 필요합니다', corsHeaders);

    // ── 4. 동의 토큰 확인 ─────────────────────────────────
    if (!query.consent_token || !query.request_id) {
      // 단계A: 동의 요청 생성
      const reqId      = `CNSREQ-${query.ipv6.slice(-8)}-${Date.now()}`;
      const expiresAt  = Math.floor(Date.now() / 1000) + 300;
      const consentUrl = `https://gopang.net/consent?req=${reqId}&svc=${query.svc}`
                       + `&ipv6=${encodeURIComponent(query.ipv6)}`
                       + `&scope=${query.scope.join(',')}`
                       + `&purpose=${encodeURIComponent(query.purpose || '')}`;

      // 동의 요청 임시 저장 (KV 또는 Supabase)
      await _storeConsentRequest(env, reqId, query, expiresAt);

      return new Response(JSON.stringify({
        ok:     false,
        status: 'CONSENT_REQUIRED',
        consent: { request_id: reqId, expires_at: expiresAt, consent_url: consentUrl,
                   message: '사용자가 고팡 앱에서 PDV 조회에 동의해야 합니다.' },
      }), { status: 202, headers: corsHeaders });
    }

    // ── 5. 동의 토큰 검증 ─────────────────────────────────
    const consentOk = await _verifyConsentToken(
      env, query.consent_token, query.request_id, query.ipv6
    );
    if (!consentOk)
      return _err(401, 'CONSENT_INVALID', '동의 토큰이 유효하지 않거나 만료되었습니다', corsHeaders);

    // ── 6. Rate Limiting (사용자당 5분 3회) ───────────────
    const rateLimitOk = await _checkRateLimit(env, query.ipv6, 'pdv_query');
    if (!rateLimitOk)
      return _err(429, 'RATE_LIMITED', 'PDV 조회 한도 초과. 5분 후 재시도하세요', corsHeaders);

    // ── 7. PDV 조회 (scope별 pdv_log SELECT) ──────────────
    const pdvSummary = await _fetchPdvByScope(env, query.ipv6, query.scope, query.period);

    // ── 8. 조회 행위를 PDV에 기록 (consent_event) ─────────
    const queryId = `PDVQ-${query.ipv6.slice(-8)}-${Date.now()}`;
    const pdvEntryId = await _recordConsentEvent(env, query, queryId);

    return new Response(JSON.stringify({
      ok:          true,
      query_id:    queryId,
      ipv6:        query.ipv6,
      period:      query.period,
      pdv_summary: pdvSummary,
      consent: {
        granted_at:   new Date().toISOString(),
        expires_at:   new Date(query.auth_token.exp * 1000).toISOString(),
        pdv_entry_id: pdvEntryId,
      },
    }), { status: 200, headers: corsHeaders });

  } catch(e) {
    return _err(500, 'INTERNAL_ERROR', e.message, corsHeaders);
  }
}

// ── 내부 유틸 ────────────────────────────────────────────
function _err(status, code, detail, corsHeaders) {
  return new Response(
    JSON.stringify({ ok: false, error: code, detail }),
    { status, headers: corsHeaders }
  );
}
```

---

## Supabase 스키마 추가

### `pdv_consent_requests` 테이블 (신규)

```sql
-- 동의 요청 임시 저장 (TTL 300초, Supabase pg_cron으로 정리)
CREATE TABLE public.pdv_consent_requests (
  id          text PRIMARY KEY,             -- CNSREQ-{guid8}-{timestamp}
  ipv6        text NOT NULL REFERENCES public.users(guid),
  svc         text NOT NULL,                -- 요청 서비스 ID
  scope       text[] NOT NULL,             -- 조회 범위
  purpose     text,                        -- 조회 목적
  period      jsonb NOT NULL,              -- 조회 기간
  status      text DEFAULT 'pending',      -- pending / granted / denied / expired
  consent_token text,                      -- 동의 후 발급 토큰 (HMAC)
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz DEFAULT now()
);

CREATE INDEX ON public.pdv_consent_requests (ipv6, status);
```

### `pdv_log` 테이블 추가 레코드 타입

```sql
-- type = 'consent_event' : PDV 조회 동의 기록
-- 기존 pdv_log 테이블 스키마 변경 없이 새 type 값으로 구분
-- summary_6w 예시:
-- {
--   "who":   "kinsurance",
--   "when":  "2026-06-05T10:30:00Z",
--   "where": "insurance.gopang.net",
--   "what":  "PDV 조회 동의: scope=[ktraffic,khealth] / 보험료 산출 목적",
--   "how":   "사용자 명시적 동의 (고팡 앱 팝업)",
--   "why":   "월별 보험료 자동 산출"
-- }
```

---

## K-Insurance `report.js` 호출 패턴

```javascript
// insurance/js/report.js (핵심 흐름만)

const PROXY  = 'https://gopang-proxy.tensor-city.workers.dev';
const SVC_ID = 'kinsurance';

/**
 * 단계A: 동의 요청 → consent_url 수신
 */
async function requestPdvConsent(user, period) {
  const res = await fetch(`${PROXY}/pdv/query`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        svc:        SVC_ID,
        ipv6:       user.ipv6,
        purpose:    '월별 보험료 자동 산출을 위한 위험도 분석',
        scope:      ['ktraffic', 'khealth', 'pdv_general'],
        period,
        auth_token: { level: user.level, exp: user.exp },
      }
    }),
  });
  const data = await res.json();
  // status === 202, data.status === 'CONSENT_REQUIRED'
  return data.consent;  // { request_id, expires_at, consent_url }
}

/**
 * 단계B: 동의 완료 후 PDV 조회
 * consent_token은 고팡 앱이 postMessage로 전달
 */
async function fetchPdvSummary(user, period, consentToken, requestId) {
  const res = await fetch(`${PROXY}/pdv/query`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: {
        svc:           SVC_ID,
        ipv6:          user.ipv6,
        purpose:       '월별 보험료 자동 산출을 위한 위험도 분석',
        scope:         ['ktraffic', 'khealth', 'pdv_general'],
        period,
        auth_token:    { level: user.level, exp: user.exp },
        consent_token: consentToken,
        request_id:    requestId,
      }
    }),
  });
  if (!res.ok) throw new Error(`PDV 조회 실패: ${res.status}`);
  return await res.json();  // pdv_summary 포함
}

/**
 * 보험료 산출 (DeepSeek V4 Pro 호출)
 */
async function calcPremium(user, pdvSummary) {
  const systemPrompt = await fetch('/prompts/SP-KINSURANCE-v1_0.txt').then(r => r.text());

  const res = await fetch(`${PROXY}/deepseek`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model:       'deepseek-v4-pro',
      max_tokens:  1200,
      temperature: 0.3,       // 보험료 산출은 낮은 temperature
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user',   content: JSON.stringify({
            ipv6:       user.ipv6,
            period:     pdvSummary.period,
            pdv:        pdvSummary.pdv_summary,
          })
        },
      ],
    }),
  });
  const data  = await res.json();
  return data.choices?.[0]?.message?.content;
}
```

---

## 동의 UX 흐름

```
K-Insurance webapp.html
        │
        │  사용자: "내 보험료 계산해줘"
        │
        ▼
requestPdvConsent() 호출
        │
        ▼
Worker → 202 CONSENT_REQUIRED
  consent_url: https://gopang.net/consent?req=CNSREQ-...
        │
        ▼
[방법 1 — 팝업]
  window.open(consent_url, 'gopang_consent', 'width=480,height=600')
  window.addEventListener('message', onConsentResult)
        │
        ▼
  사용자가 고팡 앱에서 확인 클릭
  → postMessage({ type: 'GOPANG_CONSENT_RESULT', consent_token, request_id })
        │
        ▼
[방법 2 — GWP iframe, 모바일]
  <iframe src={consent_url} />
  window.addEventListener('message', onConsentResult)
        │
        ▼
  consent_token 수신 → fetchPdvSummary() 호출
```

---

## worker.js 등록 체크리스트

```
□ ALLOWED_ORIGINS에 'https://insurance.gopang.net' 추가 확인
□ REGISTERED_SERVICES에 'kinsurance' 등록 확인
□ /pdv/query 라우트를 /pdv/report 이전에 추가
□ handlePdvQuery() 함수에 try-catch + corsHeaders 적용
□ _storeConsentRequest() → Supabase pdv_consent_requests INSERT
□ _verifyConsentToken()  → HMAC-SHA256 검증
□ _fetchPdvByScope()     → pdv_log SELECT (scope 필터)
□ _recordConsentEvent()  → pdv_log INSERT (type='consent_event')
□ _checkRateLimit()      → KV 또는 Supabase로 5분/3회 제한
□ GitHub push → Cloudflare Deployments 배포 확인
```

---

## 다음 단계

이 명세를 기반으로 다음 세 가지를 순서대로 구현합니다.

| 순서 | 파일 | 내용 |
|------|------|------|
| 1 | `worker.js` | `handlePdvQuery()` + 보조 함수 5개 추가 |
| 2 | `SP-KINSURANCE-v1_0.txt` | 위험 분류 + 보험료 산출 규칙 시스템 프롬프트 |
| 3 | `insurance/js/report.js` | PDV 조회 → LLM 호출 → 보험료 산출 → PDV 기록 전체 파이프라인 |

---

*AI City Inc. · team-jupeter · 2026-06-05*  
*`/pdv/report` 쓰기 프로토콜(gopang_pdv_rules.md)과 쌍을 이루는 읽기 프로토콜*
