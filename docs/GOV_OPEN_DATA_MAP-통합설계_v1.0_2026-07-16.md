# GOV_OPEN_DATA_MAP 통합 설계 — AC 레이어 확장 + K-Public 연동

작성일: 2026-07-16
선행 문서: `혼디-공무원직무보조-시스템갱신계획_v1.0_2026-07-14.md`(레이어 A/B), `KOSIS-API-활용계획-사고실험_v1.0_2026-07-16.md`
결정 사항: 신규 페르소나·신규 K-서비스를 만들지 않고, **AC 레이어 통합 + 기존 K-Public(`public` 레포) 확장**으로 진행

---

## 1. 배경 — 왜 통합하는가

`GOV24_API_MAP`(정부24, PDV 동의 필요)과 `KOSIS_API_MAP`(국가데이터처, 동의 불필요)은 인증 방식과 조회 구조가 달라 별도 매퍼로 설계됐다(`PDV-4항목-KOSIS연동갱신` §3). 이 결정은 유지하되, **호출부(공무원 SP, K-Public, 향후 개인 비서)가 두 매퍼를 서로 다른 인터페이스로 다루게 하지 않기 위해**, 두 매퍼를 감싸는 단일 진입점 `GOV_OPEN_DATA_MAP` + `resolveGovData()`를 AC 레이어에 둔다. 개별 매퍼의 내부 스키마는 그대로 두고, 그 위에 라우팅 레이어만 하나 얹는 구조다.

---

## 2. 통합 스키마

```javascript
GOV_OPEN_DATA_MAP = {
  entry_id,           // 내부 통합 식별자 (예: 'welfare-recipient-lookup', 'vacant-house-ratio')
  source_type,        // 'gov24' | 'kosis'
  consent_required,   // gov24 → true, kosis → false (source_type로부터 파생되지만 명시적으로 저장 — 라우팅 실수 방지)
  scope_hint,         // 매칭되는 업무 (예: '트랙4-71', '57건-11번')
  status,             // 'confirmed' | 'not_found' | 'pending_verification'

  // source_type === 'gov24'일 때만 사용
  gov24: { cert_name, endpoint, required_scope, response_schema },

  // source_type === 'kosis'일 때만 사용
  kosis: { org_id, tbl_id, item_ids, update_cycle, publish_lag },
}
```

`gov24`/`kosis` 서브객체로 분리한 이유: 두 소스의 필드가 겹치지 않아 평평한 구조로 두면 어느 필드가 어느 소스 전용인지 코드에서 매번 조건 분기로 확인해야 한다. 서브객체로 나누면 `entry.kosis`가 `undefined`인 것 자체가 "이 항목은 gov24"라는 신호가 되어 실수를 줄인다.

---

## 3. hondi-proxy 라우팅

`KOSIS-API-활용계획-사고실험` ISSUE-8(라우팅 미분리 시 동의 체크 오적용 위험)을 그대로 반영한다.

```javascript
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const entryId = url.searchParams.get('entry_id');
    const entry = GOV_OPEN_DATA_MAP[entryId];
    if (!entry) return new Response('Unknown entry_id', { status: 404 });

    // 동의 필요 여부는 entry.consent_required만 본다 — source_type을 다시 안 본다.
    // (source_type 오기입만으로 동의 체크가 빠지는 사고를 막기 위해 이중 필드로 둔 것)
    if (entry.consent_required) {
      const token = await checkPDVConsent(request, entry.gov24.required_scope, env);
      if (!token) return new Response('PDV consent required', { status: 403 });
    }

    return resolveGovData(entry, env);
  }
};

async function resolveGovData(entry, env) {
  const cacheKey = `gov-data:${entry.entry_id}`;
  const cached = await env.HONDI_KV.get(cacheKey, 'json');
  if (cached && !isExpired(cached, entry)) return Response.json(cached.data);

  const data = entry.source_type === 'kosis'
    ? await fetchFromKosis(entry.kosis, env.KOSIS_API_KEY)
    : await fetchFromGov24(entry.gov24, env.GOV24_API_KEY);

  const ttl = computeTTL(entry); // §4 참조 — update_cycle + publish_lag 기반
  await env.HONDI_KV.put(cacheKey, JSON.stringify({ data, cachedAt: Date.now() }), { expirationTtl: ttl });
  return Response.json(data);
}
```

이 구조로 `KOSIS-API-활용계획-사고실험`의 ISSUE-1(캐시 stampede)·ISSUE-2(장애 폴백)·ISSUE-7(URL 로깅)은 `resolveGovData` 한 곳에서만 처리하면 되고, 소스가 늘어나도(예: 향후 공공데이터포털 일반 API) `source_type`에 분기 하나만 추가하면 된다.

## 4. TTL 계산 — ISSUE-3 반영

```javascript
function computeTTL(entry) {
  if (entry.source_type !== 'kosis') return 60 * 60; // gov24는 개인정보라 짧게, 1시간
  // KOSIS는 "다음 예상 공표일까지"를 TTL로 잡는다 — 단순 고정 기간이 아니다.
  // update_cycle: '1년', publish_lag: '익년 7월' 같은 표현을 파싱해 다음 공표일 추정
  const nextPublishDate = estimateNextPublishDate(entry.kosis.update_cycle, entry.kosis.publish_lag);
  return Math.max(60 * 60 * 24, (nextPublishDate - Date.now()) / 1000); // 최소 하루는 보장
}
```

`estimateNextPublishDate`는 파일럿 단계에서는 문자열 몇 가지 패턴(`"익년 N월"`, `"분기별"`, `"1년"`)만 처리하는 단순 구현으로 시작하고, 트랙4 6건 확정되는 대로 실제 패턴을 보고 확장한다.

---

## 5. K-Public(`public` 레포) 확장

### 5-1. 배치 위치

`prompts/public.md` §2-3(실시간 정보 조회)에 추가한다. §2-1(절차 파악 방법)에 이미 있는 "공공 데이터 포털 연동"은 **행정 절차 조회용**이라 통계 조회와 목적이 다르므로 그대로 두고, 통계는 §2-3에만 추가한다.

### 5-2. 실제 patch (텍스트로 제공 — `public` 레포 로컬 경로에서 직접 적용)

**`### 2-3. 실시간 정보 조회` 아래 첫 문단**을 다음으로 교체:

```
기존:
웹 검색과 공공 데이터 포털을 통해 최신 정보를 실시간으로 제공합니다.

변경:
웹 검색, 공공 데이터 포털, 국가데이터처(KOSIS)를 통해 최신 정보를 실시간으로
제공합니다. 행정 사업·예산 등 개별 기관 정보는 공공 데이터 포털에서, 인구·가구·
고용·주거 등 지역 단위 통계는 국가데이터처(KOSIS)에서 조회합니다.
```

**`주요 조회 대상`** 목록에 아래 항목 추가:

```
- 지역별 인구·가구 구조 통계 (1인가구 비율, 고령인구 비율 등)
- 지역별 고용·실업 통계 (청년실업률 등)
- 지역별 주거 통계 (빈집 비율, 노후주택 비율 등)
```

**`정보 제공 형식`** 아래에 통계 조회 전용 포맷 하나를 별도로 추가 (기존 행정사업 포맷과 혼동되지 않도록):

```
📈 [지역명] [통계명] ([기준연도])

수치: [값]
전년 대비: [증감]
전국 평균: [참고값, 있는 경우]

출처: 국가데이터처(KOSIS)
기준: [자료 갱신 주기 — 예: 매년 O월 갱신]
※ 이 수치는 이미 공표된 지역 단위 집계이며, 개인 식별 정보를 포함하지 않습니다.
```

마지막 문구("개인 식별 정보를 포함하지 않습니다")를 넣은 이유: K-Public은 §2-2에서 PDV 개인정보를 다루는 서비스로 이미 인식돼 있어서, 통계 조회 결과도 개인정보처럼 오인될 수 있다. 성격이 다르다는 걸 답변 형식 자체에 명시해 혼동을 막는다.

---

## 6. 다음 단계

- [ ] `GOV_OPEN_DATA_MAP`에 트랙4 6건(66,67,68,69,71,73,75) + 57건 매핑표 항목을 실제 `entry_id`로 등록
- [ ] `estimateNextPublishDate` 함수 구현 (파일럿: 문자열 패턴 3종만)
- [ ] `public.md` patch를 실제 레포에 반영 (아래 git 명령)
- [ ] 공무원 SP(트랙4 리포트용)와 K-Public이 같은 `entry_id`를 참조하는지 교차 확인 — 동일 통계를 두 곳에서 서로 다른 `entry_id`로 중복 등록하지 않도록
