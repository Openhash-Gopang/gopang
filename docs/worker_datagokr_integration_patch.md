# worker.js — data.go.kr 연동 패치 가이드 (2026-07-08)

> SP-DO-TOURISM v1.2(및 향후 다른 SP-DO-*/SP-EMD-*/SP-NAT-*)의
> DATA_REQUIREMENT `source_type: api`/`source_ref: data.go.kr ...` 선언을
> 실제로 동작시키려면 서버측(worker.js 또는 jeju 전용 워커) 코드가
> 필요하다. 검토용 패치 가이드이며, 직접 커밋하지 않았다.

## 1. 환경변수 등록 (Cloudflare Worker Secret)

```
wrangler secret put DATA_GO_KR_SERVICE_KEY
```

주피터님이 제공하는 공공데이터포털 인증키를 여기에 등록한다. `_l1AdminToken()`이
L1 관리자 토큰을 서버에서만 다루는 것과 동일한 원칙 — 이 키는 절대 클라이언트
(webapp.html/jeju-router.js 프론트엔드)로 내려보내지 않는다.

## 2. 공통 헬퍼 함수 (worker.js에 신설)

```js
// ── data.go.kr 공공데이터 연동 (2026-07-08, SP-DO-TOURISM v1.2 최초 사용) ──
// 주피터님 지시: 공공기관 업무 안내 목적의 원자료 그대로 표시(가공·변형 없음)
// 이므로 공공누리 라이선스 유형별 이용조건은 별도 검토하지 않는다. 실시간성
// 여부도 별도로 캐싱 정책을 두지 않는다(데이터셋 자체의 갱신 주기를 그대로
// 신뢰). 다만 서비스키는 서버에서만 사용한다(TourAPI 등 대부분 공공데이터
// API가 서비스키를 쿼리 파라미터로 요구하므로, 클라이언트가 직접 호출하면
// 키가 그대로 노출된다).
//
// ★ TODO(배포 전 필수) ★ 아래 BASE_URL·오퍼레이션 경로·파라미터명은
// 이 세션이 data.go.kr에 접근할 수 없어 실시간 검증하지 못한 값이다.
// 실제 배포 전 담당 개발자가 data.go.kr 포털에서 해당 데이터셋 상세
//페이지의 "활용신청 완료 후 제공되는 API 문서"를 직접 열어 정확한
// BASE_URL·오퍼레이션명·요청/응답 파라미터로 교체해야 한다.
const DATA_GO_KR_BASE = 'https://apis.data.go.kr'; // TODO: 실제 base 확인

async function _dataGoKrFetch(env, datasetPath, params = {}) {
  const key = env.DATA_GO_KR_SERVICE_KEY;
  if (!key) throw new Error('DATA_GO_KR_SERVICE_KEY 미설정');
  const qs = new URLSearchParams({
    serviceKey: key,       // 디코딩된 키 사용 여부는 데이터셋마다 다름(TODO 확인)
    numOfRows: '10',
    pageNo: '1',
    MobileOS: 'ETC',
    MobileApp: 'Hondi',
    _type: 'json',
    ...params,
  });
  const url = `${DATA_GO_KR_BASE}${datasetPath}?${qs.toString()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`data.go.kr 호출 실패 (HTTP ${res.status})`);
  return res.json();
}

// SP-DO-TOURISM §3 "관광지_기본정보" 전용 래퍼 — TourAPI areaBasedList2
// TODO: 실제 오퍼레이션 경로("/B551011/KorService2/areaBasedList2" 등)와
// 응답 스키마(response.body.items.item[] 구조 등)를 실사 후 맞출 것.
async function fetchJejuTourismBasicInfo(env, { keyword, contentTypeId } = {}) {
  return _dataGoKrFetch(env, '/B551011/KorService2/areaBasedList2', {
    areaCode: '39', // 제주특별자치도
    ...(keyword ? { keyword } : {}),
    ...(contentTypeId ? { contentTypeId } : {}),
  });
}
```

## 3. 라우팅 엔드포인트 신설 (jeju-router.js 또는 worker.js)

```js
// GET /gov-data/tourism/basic-info?keyword=성산일출봉
if (pathname === '/gov-data/tourism/basic-info' && request.method === 'GET') {
  const { searchParams } = new URL(request.url);
  const data = await fetchJejuTourismBasicInfo(env, {
    keyword: searchParams.get('keyword') || undefined,
  });
  return new Response(JSON.stringify(data), { headers: corsHeaders });
}
```

SP-DO-TOURISM(jeju-router.js가 조립하는 시스템 프롬프트 실행 컨텍스트)이
이 엔드포인트를 호출해 결과를 받고, SP 텍스트의 지시대로 "한국관광공사
관광정보서비스 기준"이라는 출처만 붙여 답한다.

## 4. 확장 시 체크리스트 (다음 필드 연동할 때 반복)

새 DATA_REQUIREMENT 필드를 `connected:true`로 전환할 때마다:

- [ ] data.go.kr 포털에서 해당 데이터셋의 정확한 API 문서 확인(활용신청 →
      승인 후 문서 제공되는 경우도 있음 — 신청~승인 소요 시간 고려)
- [ ] `_dataGoKrFetch()` 재사용 + 데이터셋 전용 래퍼 함수 1개 추가
- [ ] 라우팅 엔드포인트 1개 추가(`/gov-data/{도메인}/{필드}` 패턴 유지)
- [ ] 해당 SP-DO-*/SP-EMD-* 문서의 DATA_REQUIREMENT 표에서 그 필드를
      `connected:true, source_type:api, source_ref:{데이터셋명+엔드포인트}`
      로 갱신
- [ ] `08-schema/DATA_REQUIREMENT-SCHEMA_v1_1.md` 자체는 수정 불필요(이미
      이 확장을 염두에 둔 범용 스키마이므로) — 개별 SP 문서만 갱신하면 됨
