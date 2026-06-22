# 고팡 PDV 기록을 위한 하위 시스템(서비스)를 위한 규칙

> **문서 버전:** v1.0  
> **최종 수정:** 2026-05-31  
> **작성 기반:** K-School 구현 및 테스트 경험  
> **적용 대상:** school, klaw, market, health, tax, gdc 등 모든 gopang 하위 서비스  
> **문의:** tensor.city@gmail.com

---

## 목차

1. [개요 — PDV란 무엇인가](#1-개요--pdv란-무엇인가)
2. [전체 소통 흐름](#2-전체-소통-흐름)
3. [report.js — 하위 서비스 보고서 엔진](#3-reportjs--하위-서비스-보고서-엔진)
4. [worker.js — gopang-proxy 게이트웨이](#4-workerjs--gopang-proxy-게이트웨이)
5. [소통 프로토콜 — /pdv/report 상세 규격](#5-소통-프로토콜--pdvreport-상세-규격)
6. [필드 타입 규칙 — 반드시 지켜야 할 것들](#6-필드-타입-규칙--반드시-지켜야-할-것들)
7. [오류 코드 및 대응](#7-오류-코드-및-대응)
8. [sbFetch vs 직접 fetch — 선택 기준](#8-sbfetch-vs-직접-fetch--선택-기준)
9. [CORS 및 Origin 규칙](#9-cors-및-origin-규칙)
10. [하위 서비스 등록 절차](#10-하위-서비스-등록-절차)
11. [신규 서비스 구현 체크리스트](#11-신규-서비스-구현-체크리스트)
12. [K-School 구현 사례 — 실제 오류와 해결](#12-k-school-구현-사례--실제-오류와-해결)

---

## 1. 개요 — PDV란 무엇인가

**PDV(Personal Data Vault, 개인 데이터 금고)**는 고팡 생태계에서 개인의 활동 기록을 6하원칙으로 요약하여 보관하는 중앙 저장소입니다.

### 핵심 원칙

| 원칙 | 설명 |
|------|------|
| **요약만 기록** | PDV에는 6하원칙 요약만 기록. 원본 데이터는 하위 서비스 DB에 보관 |
| **위변조 불가** | OpenHash 기술로 기록 후 수정 불가 |
| **본인만 접근** | 학습자/사용자 본인만 PDV 데이터에 접근 가능 |
| **서비스 연결** | pdv_entry_id로 PDV 기록과 원본을 연결 |
| **원본 분리** | what.details(보고서 전체)를 PDV에 포함하면 안 됨 |

### 데이터 흐름 요약

```
하위 서비스 (school, klaw 등)
    │
    ├─ 원본 데이터 → 자체 DB (school_reports, klaw_cases 등)
    │
    └─ 6하원칙 요약 → POST /pdv/report → gopang-proxy Worker
                                              │
                                              └─ pdv_log 테이블 INSERT
                                                 (Supabase — gopang 공용)
```

---

## 2. 전체 소통 흐름

### 보고서 생성부터 PDV 기록까지 8단계

```
1. 하위 서비스 UI/스케줄러
   └─ generateWeeklyReport(userGuid, recipients) 호출

2. report.js: buildWeeklyReport(userGuid)
   └─ Supabase REST API로 데이터 조회
      ├─ fetchStudentProfile()   → {서비스}_student_profiles
      ├─ fetchSessionsInPeriod() → {서비스}_sessions
      ├─ fetchSubjects()         → {서비스}_subjects
      ├─ fetchProgressAll()      → {서비스}_progress
      └─ fetchAssessmentsInPeriod() → {서비스}_assessments

3. report.js: generateComment(prompt)
   └─ POST /deepseek → Worker → DeepSeek API
      └─ AI 교수 코멘트 생성 (한국어)

4. report.js: hashReport(reportObj)
   └─ SHA-256 해시 생성 → report_hash (중복 방지)

5. report.js: sendToPDV(report)
   └─ POST /pdv/report → Worker
      Body: { report: { svc, type, id, content_hash, who, when, where, what, how, why } }

6. worker.js: handlePdvReport(request, env, corsHeaders)
   ├─ CORS 검증 (Origin → ALLOWED_ORIGINS)
   ├─ 서비스 등록 확인 (_getSvcRegistration)
   ├─ 필수 필드 검증 (who.ipv6)
   ├─ 6하원칙 요약 생성 (summary6w)
   └─ pdv_log INSERT (직접 fetch + Prefer: return=minimal)

7. Worker → report.js: ACK 반환
   { ok: true, pdv_entry: "PDV-...", report_id: "...", recorded_at: "..." }

8. report.js: saveReportToSupabase(report, ackId)
   └─ {서비스}_reports INSERT (원본 전체 + pdv_entry_id)
```

---

## 3. report.js — 하위 서비스 보고서 엔진

### 3.1 역할

`report.js`는 각 하위 서비스가 독립적으로 보유하는 보고서 생성·전송 모듈입니다. worker.js와 달리 **서비스별로 별도 파일**을 유지합니다.

### 3.2 파일 상수 — 반드시 서비스별로 수정

```javascript
const PROXY  = 'https://gopang-proxy.tensor-city.workers.dev';
const SVC_ID = 'school';   // ← 반드시 본인 서비스 ID로 변경
```

`SVC_ID`는 `REGISTERED_SERVICES`의 키와 정확히 일치해야 합니다.

### 3.3 함수 목록 및 역할

| 함수 | 역할 | 주의사항 |
|------|------|---------|
| `fetchStudentProfile(guid)` | Supabase에서 학생 프로파일 조회 | anon key 사용 — RLS 정책 확인 필요 |
| `fetchSessionsInPeriod(guid, start, end)` | 기간별 세션 조회 | started_at 컬럼으로 필터 |
| `fetchProgressAll(guid)` | 전체 진도 조회 | progress_pct는 GENERATED 컬럼 |
| `fetchSubjects(guid)` | 활성 과목 조회 | status=active 필터 적용 |
| `fetchAssessmentsInPeriod(guid, start, end)` | 기간별 평가 조회 | — |
| `generateComment(prompt, maxTokens)` | DeepSeek AI 코멘트 생성 | 실패 시 빈 문자열 반환 |
| `hashReport(obj)` | SHA-256 해시 생성 | 중복 방지용 — report_hash UNIQUE 제약 |
| `buildWeeklyReport(guid)` | 주간 보고서 객체 조립 | pdv_6w 필드 포함 |
| `buildMonthlyReport(guid)` | 월간 보고서 객체 조립 | 평가 데이터 포함 |
| **`sendToPDV(report)`** | PDV 전송 핵심 함수 | 아래 §3.4 상세 참조 |
| `saveReportToSupabase(report, ackId)` | 원본 보고서 DB 저장 | Prefer: return=minimal 사용 |
| `notifyRecipients(report, recipients)` | 수취자 알림 (미구현) | TODO: /notify 엔드포인트 |
| `generateWeeklyReport(guid, recipients)` | 주간 보고서 전체 파이프라인 | 공개 API |
| `generateMonthlyReport(guid, recipients)` | 월간 보고서 전체 파이프라인 | 공개 API |
| `initReportScheduler(guid)` | 자동 스케줄러 초기화 | 주간/월간 자동 발송 |

### 3.4 sendToPDV() — 핵심 규칙

```javascript
async function sendToPDV(report) {
  try {
    const res = await fetch(`${PROXY}/pdv/report`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      // Origin 헤더는 브라우저가 자동 설정 — 수동 설정 금지
      body: JSON.stringify({
        report: {                          // ← 반드시 report: {} 중첩 구조
          svc:          SVC_ID,
          type:         report.report_type,
          id:           report.report_id,
          content_hash: report.metadata.report_hash,
          who: {
            ipv6:       report.student.user_guid,  // users.guid FK
            role:       'student',
            recipients: /* 반드시 배열 */ typeof who === 'string' ? [who] : (who || []),
          },
          when: /* 반드시 객체 */ {
            period_start: report.period?.start,
            period_end:   report.period?.end,
          },
          where: /* 반드시 객체 */ {
            svc_url: 'https://{서비스}.gopang.net',
          },
          what: {
            summary:  report.pdv_6w.what,   // 요약문만
            subjects: [...],                 // 경량화된 과목 목록
            // details: report 포함 금지 ← payload 과부하 → Worker 500
          },
          how:  { method: report.pdv_6w.how },
          why:  { goal: report.pdv_6w.why, triggered: report.report_type },
        },
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error || `PDV HTTP ${res.status}`);
    }

    const ack = await res.json();
    return ack;  // { ok, pdv_entry, report_id, recorded_at, ... }

  } catch(e) {
    console.warn('[Report] PDV 전송 실패:', e.message);
    return null;  // PDV 실패해도 보고서 생성은 계속 진행
  }
}
```

### 3.5 saveReportToSupabase() — 원본 저장 규칙

```javascript
async function saveReportToSupabase(report, ackId) {
  await fetch(`${SUPA_URL}/rest/v1/{서비스}_reports`, {
    method:  'POST',
    headers: {
      ...HDR,
      'Content-Type': 'application/json',
      'Prefer':       'return=minimal',    // ← 반드시 return=minimal
      // merge-duplicates 사용 금지 → 503 유발
    },
    body: JSON.stringify({
      user_guid:    report.student.user_guid,
      report_type:  report.report_type,
      period_start: report.period.start,
      period_end:   report.period.end,
      report_data:  report,                // 원본 전체는 여기에 저장
      pdv_entry_id: ackId,                 // PDV 연결 고리
      report_hash:  report.metadata.report_hash,  // UNIQUE 제약
      generated_at: report.metadata.generated_at,
    }),
  });
}
```

### 3.6 pdv_6w 필드 — 타입 주의

`buildWeeklyReport()`가 생성하는 `pdv_6w` 객체의 각 필드가 **문자열**로 생성될 수 있습니다. `sendToPDV()`에서 반드시 객체로 변환해야 합니다.

```javascript
// pdv_6w 실제 값 예시 (buildWeeklyReport 출력)
pdv_6w: {
  who:   '2601:db80:...',           // 문자열 → 배열로 변환 필요
  when:  '2026-05-31T10:56:13Z',    // 문자열 → 객체로 변환 필요
  where: 'school.gopang.net',       // 문자열 → 객체로 변환 필요
  what:  '주간 학습: 6세션 / 285분', // 문자열 → 그대로 사용 가능
  how:   'AI 교수 튜터링 + OER',     // 문자열 → 그대로 사용 가능
  why:   '개인 역량 강화',           // 문자열 → 그대로 사용 가능
}

// sendToPDV 내에서 변환
when: typeof report.pdv_6w.when === 'object' && report.pdv_6w.when !== null
  ? report.pdv_6w.when
  : { generated_at: report.pdv_6w.when,
      period_start:  report.period?.start,
      period_end:    report.period?.end },

where: {
  svc_url: 'https://school.gopang.net',
  ...(typeof report.pdv_6w.where === 'object' && report.pdv_6w.where !== null
    ? report.pdv_6w.where
    : { label: report.pdv_6w.where }),
},
```

---

## 4. worker.js — gopang-proxy 게이트웨이

### 4.1 역할

`worker.js`는 **gopang 전체 서비스의 공용 게이트웨이**입니다. 모든 하위 서비스가 공유하므로 수정 시 전체 서비스에 영향을 줍니다.

```
⚠️ worker.js 수정 시 영향 범위:
   school, klaw, market, health, tax, gdc, gopang 본체 전체
```

### 4.2 라우팅 구조

```javascript
// 라우팅 순서 (위에서 아래로 매칭)
/auth/issue            → handleIssue()          // SSO 토큰 발급
/auth/verify           → handleVerify()         // SSO 토큰 검증
/auth/refresh          → handleRefresh()        // SSO 토큰 갱신
/auth/webauthn/*       → handleWA*()            // 생체인증
/pdv/report            → handlePdvReport()      // PDV 보고서 수신 ← 핵심
/svc/register          → handleSvcRegister()    // 서비스 등록
/svc/verify            → handleSvcVerify()      // 서비스 검증
/geocode               → handleGeocode()        // 카카오 역지오코딩
/deepseek              → callDeepSeek()         // DeepSeek AI 중계
/gemini/*              → callOpenAIFromGeminiBody() // OpenAI 중계
```

### 4.3 handlePdvReport() — 처리 흐름

```
요청 수신
  │
  ├─ 1. HTTP 메서드 확인 (POST만 허용)
  │
  ├─ 2. try-catch 시작 ← 반드시 전체 감싸야 CORS 헤더 보존
  │
  ├─ 3. Origin 헤더 추출
  │
  ├─ 4. Body 파싱 → report.report 중첩 구조 확인
  │      └─ 없으면 400 SCHEMA_ERROR
  │
  ├─ 5. _getSvcRegistration(origin, svcId) 호출
  │      ├─ REGISTERED_SERVICES에서 svcId 조회
  │      ├─ origin.includes(svc.domain) 매칭
  │      └─ 없으면 403 SERVICE_NOT_REGISTERED
  │
  ├─ 6. Level 및 PDV 권한 확인
  │      └─ level < 2 && !pdv → 403 PDV_NOT_ALLOWED
  │
  ├─ 7. who.ipv6 확인
  │      └─ 없으면 404 USER_NOT_FOUND
  │
  ├─ 8. 6하원칙 요약(summary6w) 생성
  │
  ├─ 9. pdv_log INSERT (직접 fetch, Prefer: return=minimal)
  │      └─ 실패 시 503 PDV_LOCKED
  │
  ├─ 10. ACK 반환 200
  │       { ok, report_id, pdv_entry, recorded_at, svc_level, message }
  │
  └─ catch(e) → 500 INTERNAL_ERROR + corsHeaders 포함
```

### 4.4 sbFetch() — 내부 헬퍼

```javascript
async function sbFetch(env, path, method = 'GET', body = null) {
  // Prefer: resolution=merge-duplicates 고정
  // → upsert 동작 (webauthn_credentials, svc_registry 등에 사용)
  // → 단순 INSERT에 사용하면 503 유발
}
```

**sbFetch는 upsert 전용입니다.** pdv_log처럼 단순 INSERT가 필요한 경우 직접 fetch를 작성해야 합니다.

### 4.5 _getSvcRegistration() — 서비스 인증 로직

```javascript
function _getSvcRegistration(origin, svcId) {
  const svc = REGISTERED_SERVICES[svcId];

  // Level 3/2: 명시적 등록 서비스 — origin이 domain을 포함해야 함
  if (svc && origin.includes(svc.domain)) return { ...svc, svcId };

  // Level 1: *.gopang.net 자동 — PDV 전송 불가
  if (/^https:\/\/[a-z0-9-]+\.gopang\.net$/.test(origin)) {
    return { level: 1, domain: origin, minAuth: 'L0', pdv: false, svcId };
  }

  return null;  // 미등록 서비스 → 403
}
```

---

## 5. 소통 프로토콜 — /pdv/report 상세 규격

### 5.1 요청 규격

```
POST https://gopang-proxy.tensor-city.workers.dev/pdv/report
```

**Headers:**
```
Content-Type: application/json
Origin: https://{서비스}.gopang.net   (브라우저가 자동 설정, 수동 금지)
```

**Body 전체 구조:**
```json
{
  "report": {
    "svc":          "school",
    "type":         "school_weekly_progress",
    "id":           "05fb5a36-1159-4edf-98b7-a9624f511ab9",
    "content_hash": "207e57e6bd9e9ced069b932af08c16f5...",
    "who": {
      "ipv6":       "2601:db80:test:0001:0002:0003:0004:0005",
      "role":       "student",
      "recipients": ["parent", "teacher"]
    },
    "when": {
      "period_start": "2026-05-24",
      "period_end":   "2026-05-31"
    },
    "where": {
      "svc_url": "https://school.gopang.net"
    },
    "what": {
      "summary": "주간 학습: 6세션 / 285분 / 이해도 78.5%",
      "subjects": [
        { "subject_id": "math_s5", "progress_pct": 25.0, "sessions": 2 }
      ]
    },
    "how":  { "method": "AI 교수 튜터링 + OER 교재" },
    "why":  { "goal": "개인 역량 강화", "triggered": "school_weekly_progress" }
  }
}
```

### 5.2 응답 규격

**성공 (200):**
```json
{
  "ok": true,
  "report_id": "05fb5a36-1159-4edf-98b7-a9624f511ab9",
  "pdv_entry": "PDV-2601db80test-1780224973587",
  "recorded_at": "2026-05-31T10:56:13.834Z",
  "recipients_notified": [],
  "svc_level": 3,
  "message": "PDV 기록 완료. school (Level 3)"
}
```

**오류 응답:**
```json
{ "ok": false, "error": "오류코드", "detail": "상세 설명" }
```

### 5.3 pdv_entry 활용

ACK로 받은 `pdv_entry` 값을 반드시 하위 서비스 DB에 저장합니다.

```javascript
const ack = await sendToPDV(report);
const ackId = ack?.pdv_entry || null;  // "PDV-2601db80test-..."
await saveReportToSupabase(report, ackId);
// school_reports.pdv_entry_id = "PDV-2601db80test-..."
```

---

## 6. 필드 타입 규칙 — 반드시 지켜야 할 것들

Worker는 `report.report` 중첩 구조 내부의 각 필드를 특정 방식으로 처리합니다. 타입이 맞지 않으면 TypeError가 발생하고, try-catch가 없으면 CORS 헤더 없이 500이 반환됩니다.

### 6.1 필수 타입 규칙

| 필드 | 필수 타입 | 잘못된 예 | 올바른 예 |
|------|----------|---------|---------|
| `report` | object (중첩) | `{ svc: ... }` (flat) | `{ report: { svc: ... } }` |
| `who.ipv6` | string | 없으면 404 | `"2601:db80:..."` |
| `who.recipients` | array | `"parent"` | `["parent"]` |
| `when` | object | `"2026-05-31T..."` | `{ period_start: "2026-05-24" }` |
| `where` | object | `"school.gopang.net"` | `{ svc_url: "https://school.gopang.net" }` |
| `what` | object | `"요약문"` | `{ summary: "요약문" }` |
| `what.details` | 포함 금지 | 보고서 전체 포함 | subjects 배열만 (경량화) |

### 6.2 스프레드 연산자 주의

```javascript
// ❌ 잘못된 패턴 — where가 문자열이면 TypeError
where: {
  svc_url: 'https://school.gopang.net',
  ...report.pdv_6w.where,  // "school.gopang.net" 문자열 스프레드 → 오류
},

// ✅ 올바른 패턴 — 타입 검사 후 처리
where: {
  svc_url: 'https://school.gopang.net',
  ...(typeof report.pdv_6w.where === 'object' && report.pdv_6w.where !== null
    ? report.pdv_6w.where
    : { label: report.pdv_6w.where }),
},
```

### 6.3 payload 크기 제한

`what.details`에 보고서 전체 객체를 포함하면 Cloudflare Worker 메모리 한도 또는 Supabase 응답 크기 제한을 초과하여 500이 발생합니다.

```javascript
// ❌ 금지 — 보고서 전체 포함
what: { summary: "...", details: report }

// ✅ 권장 — 핵심 요약만 포함
what: {
  summary: report.pdv_6w.what,
  subjects: report.subjects.map(s => ({
    subject_id:   s.subject_id,
    progress_pct: s.progress_pct,
    sessions:     s.sessions_this_period,
  })),
}
```

### 6.4 업종/유형별 세부 데이터는 PDV가 아니라 Profile에 (2026-06-22 추가)

`profile_pdv_schema_plan_v1.md`(95개 업종 스키마 작업) 진행 중 확인한 원칙: **PDV는 업종별 구조화 데이터를 위한 슬롯을 따로 두지 않는다.** `what`에 무엇을 넣어도 `handlePdvReport`는 `what.summary` 문자열과 `content_hash`만 영구 저장하고 나머지는 버린다(§1의 "요약만 기록" 원칙이 코드로 강제돼 있음) — 그러니 업종별 구조화 필드(예: 한의원의 진료과목, 음식점의 메뉴)는 다음 중 하나로 처리한다:

1. **Profile에 저장** — `user_profiles.extra.public.industry_fields`(공개·반복조회용 데이터, 예: 메뉴·영업시간 같은 "지금 상태")
2. **하위 서비스 자체 DB에 저장** — PDV는 그 사실에 대한 짧은 요약(`what.summary`)과 무결성 증빙(`content_hash`)만 받는다(예: "한약 처방 1건, 환자동의 확인됨" + 처방전 원본의 해시)

PDV에 업종별 구조를 직접 넣으려는 시도는 십중팔구 의도와 다르게 조용히 버려지니, 새 하위 서비스를 등록하기 전에 "이 데이터가 반복 조회되는 현재 상태인가(Profile), 한 번 발생한 사건의 기록인가(PDV 요약 + 자체 DB)"부터 구분할 것.

---

## 7. 오류 코드 및 대응

### 7.1 Worker 오류 코드

| HTTP | error 코드 | 원인 | 대응 |
|------|-----------|------|------|
| 400 | `SCHEMA_ERROR` | `report.report` 중첩 구조 없음 | flat 구조 → 중첩으로 변경 |
| 403 | `SERVICE_NOT_REGISTERED` | origin이 REGISTERED_SERVICES 미등록 | Worker에 서비스 등록 요청 |
| 403 | `PDV_NOT_ALLOWED` | Level 1 서비스 (자동 등록) | Level 3으로 명시적 등록 필요 |
| 404 | `USER_NOT_FOUND` | `who.ipv6` 필드 없음 | `report.student.user_guid` 전달 확인 |
| 500 | `INTERNAL_ERROR` | Worker 내부 예외 | `detail` 메시지로 원인 파악 |
| 503 | `PDV_LOCKED` | pdv_log INSERT 실패 | pdv_log 스키마/FK 확인 |

### 7.2 브라우저 CORS 오류처럼 보이지만 실제로는 Worker 500

```
Access to fetch at 'https://gopang-proxy...' from origin 'https://school.gopang.net'
has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header
```

**이 메시지는 CORS 설정 오류가 아닙니다.** Worker가 500을 반환하면서 CORS 헤더를 포함하지 못한 결과입니다.

**원인과 해결:**

```
증상: CORS 오류 + net::ERR_FAILED 500
실제 원인 1: Worker 핸들러에 try-catch 없음 → 예외 발생 시 CORS 헤더 없이 500 반환
해결 1: 모든 핸들러를 try-catch로 감싸고 catch에서 corsHeaders 전달

실제 원인 2: sbFetch로 단순 INSERT → Supabase 503
해결 2: Prefer: return=minimal 직접 fetch 사용

실제 원인 3: pdv_log 스키마와 INSERT 필드 불일치
해결 3: information_schema로 컬럼 확인 후 수정
```

### 7.3 Supabase 오류 코드

| 코드 | 의미 | 발생 상황 | 해결 |
|------|------|---------|------|
| 23503 | FK 위반 | users에 없는 guid INSERT | users 테이블 선 INSERT |
| 23502 | NOT NULL 위반 | 필수 컬럼 누락 | information_schema로 컬럼 확인 |
| 23514 | CHECK 제약 위반 | 허용되지 않는 enum 값 | pg_constraint로 허용값 확인 |
| 42703 | 컬럼 없음 | 잘못된 컬럼명 사용 | 실제 컬럼명 확인 |
| 428C9 | GENERATED 컬럼 | INSERT 시 값 직접 지정 | INSERT에서 해당 컬럼 제외 |
| 23505 | UNIQUE 위반 | report_hash 중복 | 기존 레코드 DELETE 후 재실행 |

### 7.4 CHECK 제약 확인 쿼리

```sql
SELECT pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conname = '테이블명_컬럼명_check';

-- 예시
WHERE conname = 'school_sessions_session_type_check';
-- 결과: CHECK ((session_type = ANY (ARRAY['learning', 'review', 'assessment', 'supplementary'])))
```

### 7.5 GENERATED 컬럼 확인 쿼리

```sql
SELECT column_name, is_generated, generation_expression
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '테이블명'
  AND is_generated = 'ALWAYS';
```

---

## 8. sbFetch vs 직접 fetch — 선택 기준

### 핵심 원칙

> **sbFetch = upsert 전용. 단순 INSERT에 사용하면 Supabase가 503을 반환합니다.**

Worker 내부의 `sbFetch()`는 `Prefer: resolution=merge-duplicates` 헤더를 고정으로 사용합니다. 이 헤더는 중복 레코드 발생 시 병합(upsert)하는 동작을 지시합니다. 중복이 없는 단순 INSERT 테이블에 이 헤더를 사용하면 Supabase가 503을 반환합니다.

### 선택 기준표

| 상황 | 사용할 방법 | Prefer 헤더 |
|------|-----------|------------|
| 기존 레코드 있으면 업데이트 (upsert) | `sbFetch()` | `resolution=merge-duplicates` |
| 처음 한 번만 INSERT (중복 없음) | 직접 fetch | `return=minimal` |
| SELECT 조회 | `sbFetch()` 또는 직접 fetch | 무관 |
| PATCH 수정 | `sbFetch()` | 무관 |

### 직접 fetch 패턴

```javascript
// Worker 내부에서 단순 INSERT가 필요한 경우
const key = env.SUPABASE_KEY || '{fallback_anon_key}';
const res = await fetch(SUPABASE_URL + '/rest/v1/테이블명', {
  method: 'POST',
  headers: {
    'apikey':        key,
    'Authorization': 'Bearer ' + key,
    'Content-Type':  'application/json',
    'Prefer':        'return=minimal',   // ← 핵심
  },
  body: JSON.stringify(data),
});
const ok = res.ok ? {} : null;
// 204 No Content가 정상 응답 (return=minimal 사용 시)
```

---

## 9. CORS 및 Origin 규칙

### 9.1 ALLOWED_ORIGINS

Worker는 요청의 `Origin` 헤더를 `ALLOWED_ORIGINS` 배열과 `startsWith`로 비교합니다.

```javascript
const ALLOWED_ORIGINS = [
  'https://gopang.net',
  'https://www.gopang.net',
  'https://school.gopang.net',
  'https://klaw.gopang.net',
  'https://market.gopang.net',
  // ... 모든 하위 서비스 도메인
  'http://localhost',           // 개발 환경
  'http://127.0.0.1',
];
```

**신규 서비스 추가 시 반드시 목록에 추가 + GitHub push 필요.**

### 9.2 Origin 헤더 — 브라우저 자동 설정

브라우저 환경에서 `fetch()`를 호출할 때 `Origin` 헤더는 브라우저가 자동으로 현재 페이지의 origin으로 설정합니다. **수동으로 설정하면 브라우저가 무시합니다.**

```javascript
// ❌ 수동 설정 — 브라우저가 무시
headers: {
  'Origin': 'https://school.gopang.net',  // 브라우저가 덮어씀
}

// ✅ 올바른 방법 — school.gopang.net 페이지에서 fetch 호출
// 브라우저가 자동으로 Origin: https://school.gopang.net 설정
fetch('https://gopang-proxy.../pdv/report', { ... })
```

### 9.3 CORS 오류 디버깅 순서

```
1. Network 탭에서 실제 HTTP 상태 코드 확인
   - 403 → Origin이 허용 목록에 없음
   - 500 → Worker 내부 오류 (CORS 헤더 없이 반환)

2. Worker Edit code의 HTTP 탭에서 직접 테스트
   - Header: Origin: https://{서비스}.gopang.net 추가
   - Body: 테스트 payload 전송
   - 200이 나와야 정상

3. 브라우저 콘솔에서 직접 fetch 테스트
   - school.gopang.net 페이지에서 실행
   - res.status와 await res.text() 확인
```

---

## 10. 하위 서비스 등록 절차

### 10.1 Worker에 서비스 등록

```javascript
// worker.js의 REGISTERED_SERVICES에 추가
const REGISTERED_SERVICES = {
  'school':    { level: 3, domain: 'school.gopang.net',    minAuth: 'L0', pdv: true },
  'klaw':      { level: 3, domain: 'klaw.gopang.net',      minAuth: 'L0', pdv: true },
  // 신규 서비스 추가:
  'myservice': { level: 3, domain: 'myservice.gopang.net', minAuth: 'L0', pdv: true },
};
```

**필드 설명:**

| 필드 | 값 | 설명 |
|------|-----|------|
| `level` | 3 | Level 3: 공식 파트너 (PDV 가능) |
| `domain` | `서비스.gopang.net` | origin 매칭에 사용 |
| `minAuth` | `L0` / `L1` | 최소 인증 레벨 |
| `pdv` | `true` | PDV 전송 권한 여부 |

### 10.2 ALLOWED_ORIGINS에 추가

```javascript
const ALLOWED_ORIGINS = [
  // 기존 목록 ...
  'https://myservice.gopang.net',  // 추가
];
```

### 10.3 배포 절차

```powershell
cd C:\Users\주피터\Downloads\gopang_v2

git add worker.js
git commit -m "feat: {서비스명} 서비스 등록 — REGISTERED_SERVICES + ALLOWED_ORIGINS"
git push origin main
```

> **주의:** GitHub push만으로는 Cloudflare가 자동 동기화되지 않을 수 있습니다. Cloudflare Dashboard → gopang-proxy → Deployments에서 최신 버전 배포를 확인하세요.

---

## 11. 신규 서비스 구현 체크리스트

### 11.1 report.js 작성

```
□ SVC_ID = '본인 서비스 ID' 설정
□ PROXY = 'https://gopang-proxy.tensor-city.workers.dev' 확인
□ fetch* 함수들이 올바른 Supabase 테이블명 사용 확인
□ buildWeeklyReport() — pdv_6w 객체 포함
□ buildMonthlyReport() — pdv_6w 객체 포함
□ sendToPDV() — 중첩 구조 + 타입 안전 처리
□ saveReportToSupabase() — Prefer: return=minimal 사용
□ generateWeeklyReport() — try-catch + PDV 실패 무시 패턴
□ initReportScheduler() — 자동 발송 스케줄 설정
```

### 11.2 Supabase 테이블 설계

```
□ 테이블명 접두사: {서비스명}_ 사용
□ user_guid → users.guid FK 설정
□ GENERATED 컬럼 목록 문서화 (INSERT 시 제외)
□ CHECK 제약 허용값 문서화
□ report_hash TEXT UNIQUE NOT NULL 컬럼 추가
□ pdv_entry_id TEXT NULL 컬럼 추가
□ INSERT 의존 순서 확인:
    users → profiles → subjects → sessions → progress → assessments → reports
```

### 11.3 Worker 등록

```
□ ALLOWED_ORIGINS에 도메인 추가
□ REGISTERED_SERVICES에 서비스 정보 추가
□ 새 라우트 추가 시 /pdv/report 이전 위치 확인
□ 새 핸들러 함수에 try-catch + corsHeaders 추가
□ GitHub push → Cloudflare Deployments 확인
```

### 11.4 테스트 순서

```
□ T1: Cloudflare HTTP 탭에서 Origin 헤더 포함 직접 테스트 → 200 확인
□ T2: 브라우저 콘솔에서 직접 fetch 테스트 → 200 확인
□ T3: users 테이블에 테스트 사용자 INSERT
□ T4: profiles → subjects → sessions → progress → assessments 순서대로 INSERT
□ T5: 브라우저 콘솔에서 generateWeeklyReport() 호출
□ T6: Supabase {서비스}_reports 테이블에 레코드 확인
□ T7: pdv_log 테이블에 PDV 기록 확인
□ T8: school_reports.pdv_entry_id와 pdv_log.id 연결 확인
```

---

## 12. K-School 구현 사례 — 실제 오류와 해결

K-School(school.gopang.net) 구현 과정에서 발생한 오류와 해결책을 정리합니다. 동일한 오류를 반복하지 않기 위해 상세히 기록합니다.

### 12.1 PDV 전송 관련 오류 (핵심)

#### [오류 1] 400 SCHEMA_ERROR — flat 구조 전송

```javascript
// ❌ 잘못된 구조 (report.js 초기 버전)
body: JSON.stringify({
  svc: 'school', type: '...', ipv6: '...', who: '...', when: '...', ...
})

// 오류: SCHEMA_ERROR "report.report 필드 필수"

// ✅ 올바른 구조
body: JSON.stringify({
  report: {  // ← 반드시 중첩
    svc: 'school', type: '...', ...
  }
})
```

#### [오류 2] 503 PDV_LOCKED — sbFetch 사용

```javascript
// ❌ worker.js에서 sbFetch로 pdv_log INSERT
const pdvRes = await sbFetch(env, '/rest/v1/pdv_log', 'POST', { ... });
// 오류: Supabase 503 — resolution=merge-duplicates가 단순 INSERT에 적용됨

// ✅ 직접 fetch로 분리
const _pdvFetch = await fetch(SUPABASE_URL + '/rest/v1/pdv_log', {
  method: 'POST',
  headers: { ..., 'Prefer': 'return=minimal' },
  body: JSON.stringify({ ... }),
});
const pdvRes = _pdvFetch.ok ? {} : null;
```

#### [오류 3] 500 TypeError — 문자열 스프레드

```javascript
// ❌ pdv_6w.where가 "school.gopang.net" 문자열일 때
where: {
  svc_url: 'https://school.gopang.net',
  ...report.pdv_6w.where,  // TypeError: 문자열 스프레드
}

// ✅ 타입 검사 후 처리
where: {
  svc_url: 'https://school.gopang.net',
  ...(typeof report.pdv_6w.where === 'object' && report.pdv_6w.where !== null
    ? report.pdv_6w.where
    : { label: report.pdv_6w.where }),
},
```

#### [오류 4] CORS처럼 보이는 Worker 500 — try-catch 없음

```
브라우저 메시지:
"has been blocked by CORS policy: No 'Access-Control-Allow-Origin' header"

실제 원인: Worker 핸들러 내부 예외 → CORS 헤더 없이 500 반환
```

```javascript
// ❌ try-catch 없는 핸들러
async function handlePdvReport(request, env, corsHeaders) {
  // 여기서 예외 발생 시 CORS 헤더 없이 500 반환
}

// ✅ try-catch로 감싸기
async function handlePdvReport(request, env, corsHeaders) {
  if (request.method !== 'POST') return new Response('...', { status: 405 });
  try {
    // ... 로직 ...
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: corsHeaders });
  } catch(e) {
    return new Response(
      JSON.stringify({ ok: false, error: 'INTERNAL_ERROR', detail: e.message }),
      { status: 500, headers: corsHeaders }  // ← corsHeaders 반드시 포함
    );
  }
}
```

### 12.2 Supabase 스키마 관련 오류

| 오류 | 상황 | 해결 |
|------|------|------|
| 23503 FK | users에 없는 guid로 INSERT | users 테이블 선 INSERT |
| 23502 NOT NULL | school_subjects.stage, field_code 누락 | 컬럼 추가 후 재실행 |
| 42703 컬럼 없음 | topic → 실제는 topic_block | information_schema 확인 |
| 23514 CHECK | session_type에 "regular" 사용 | "learning"으로 수정 |
| 428C9 GENERATED | progress_pct INSERT 시도 | INSERT에서 제외 |
| 23505 UNIQUE | 동일 기간 보고서 재생성 | school_reports DELETE 후 재실행 |

### 12.3 배포 관련 오류

| 상황 | 원인 | 해결 |
|------|------|------|
| push했는데 404 계속 | Worker 구버전 서빙 | Cloudflare Deployments 확인 |
| Edit code와 GitHub 불일치 | Cloudflare는 독립 저장소 | Edit code에서 직접 수정 또는 재push |
| 캐시로 인한 구버전 로드 | GitHub Pages CDN 캐시 | Ctrl+Shift+R / JS URL에 ?v=타임스탬프 |
| SUPABASE_KEY 추가 후 미반영 | Secret 추가 시 자동 재배포 | Deployments 탭 확인 |

---

## 부록 A — pdv_log 테이블 스키마

```sql
CREATE TABLE public.pdv_log (
  id          text PRIMARY KEY,          -- PDV-{guid12}-{timestamp}
  guid        text NOT NULL REFERENCES public.users(guid),
  source      text,                      -- 서비스 ID (school, klaw 등)
  type        text NOT NULL,             -- report, event 등
  report_id   text,                      -- 원본 보고서 ID
  summary     text,                      -- what 요약문
  summary_6w  text,                      -- 6하원칙 전체 JSON 문자열
  risk_level  text DEFAULT 'low',        -- low / medium / high
  period      jsonb,                     -- 기간 객체
  raw_hash    text,                      -- SHA-256 원본 해시
  created_at  timestamptz DEFAULT now()
);
```

## 부록 B — school_reports 테이블 스키마

```sql
CREATE TABLE public.school_reports (
  id            bigserial PRIMARY KEY,
  user_guid     text NOT NULL REFERENCES public.users(guid),
  report_type   text NOT NULL,
  period_start  date NOT NULL,
  period_end    date NOT NULL,
  report_data   jsonb NOT NULL DEFAULT '{}',  -- 원본 보고서 전체
  pdv_entry_id  text,                          -- pdv_log.id 참조
  report_hash   text NOT NULL UNIQUE,          -- 중복 방지
  sent_to       text[],
  generated_at  timestamptz NOT NULL DEFAULT now(),
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX ON public.school_reports (user_guid, generated_at DESC);
```

## 부록 C — 진단용 SQL

```sql
-- 1. 테이블 컬럼 전체 확인
SELECT column_name, data_type, is_nullable, is_generated
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = '테이블명'
ORDER BY ordinal_position;

-- 2. CHECK 제약 확인
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = '테이블명'::regclass AND contype = 'c';

-- 3. FK 제약 확인
SELECT conname, pg_get_constraintdef(oid)
FROM pg_constraint
WHERE conrelid = '테이블명'::regclass AND contype = 'f';

-- 4. pdv_log 최근 기록 확인
SELECT id, guid, source, type, summary, created_at
FROM public.pdv_log
ORDER BY created_at DESC LIMIT 10;

-- 5. school_reports와 pdv_log 연결 확인
SELECT r.id, r.report_hash, r.pdv_entry_id, p.id AS pdv_id, p.source
FROM public.school_reports r
LEFT JOIN public.pdv_log p ON p.id = r.pdv_entry_id
WHERE r.user_guid = '{guid}'
ORDER BY r.generated_at DESC;
```

---

*AI City Inc. | team-jupeter | 2026-05-31*  
*school.gopang.net 구현 경험 기반 — 동일한 실수를 반복하지 말 것*
