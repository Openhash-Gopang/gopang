# dpaper.kr API 승인 시 활성화 체크리스트

> **이 문서 하나만 보면 승인 즉시 무엇을 켜야 하는지 전부 파악되도록 유지한다.**
> 항목이 늘어나면 이 문서에 추가하고, 다른 곳에 분산 기록하지 않는다.

## 선행 조건 (dpaper.kr 승인과 별개로 필요)

- [ ] **R2(또는 동등 파일 저장소) 바인딩 추가** — 현재 worker.js는 파일
      바이너리를 전혀 받지 않고 SHA-256 해시만 받는다(`handleGovTaskSubmit`
      상단 주석, 2026-07-12 설계 제약으로 명시됨). dpaper.kr에 실제 서류
      원본을 제출하려면 이 제약부터 해소해야 한다 — **API 키만으로는
      기능이 켜지지 않는다.**
      - wrangler.toml에 R2 bucket 바인딩 추가 (가칭 `DOCS_BUCKET`)
      - 클라이언트(webapp.html 등)의 서류 업로드 흐름을 "해시만 전송"에서
        "파일 자체 업로드"로 변경 필요 — 별도 작업량 있음, 지금 산정 안 됨

## dpaper.kr 승인 후 켤 스위치

- [ ] **`wrangler secret put DPAPER_API_KEY`** — 승인 시 발급받는 인증키
      등록. 이것만 등록되면 `submitToDpaper()`가 `dpaper_not_configured`
      상태에서 벗어나 실제 호출을 시도한다(파일: `worker.js`,
      `submitToDpaper()` 함수, 관례: `SOLAPI_API_KEY`/`KOSIS_API_KEY`와
      동일 — `env.DPAPER_API_KEY` 존재 여부 자체가 스위치, 별도 ENABLED
      플래그 없음).
- [ ] **`submitToDpaper()` 함수 내 잠정값 확정** (`dpaper-integration-patch.js`
      또는 병합 후 worker.js 내 위치):
      - [ ] 엔드포인트 URL (`https://dpaper.kr/api/v1/documents/submit`은
            잠정 — 실제 개발 명세서 확인 후 교체)
      - [ ] 인증 방식 — API 키 Bearer 토큰인지, 서버인증서 기반 mTLS인지
            (§dpaper.kr 문의 결과에 따라 결정, 2026-08-20 기준 미확정)
      - [ ] 요청/응답 필드명 (`documents` 배열 구조, `storage_ref`/
            `document_id` 등 응답 필드명 실제 스펙으로 교체)
- [ ] **`submitToDpaper()`를 `handleGovTaskSubmit()`에 실제로 배선** —
      지금은 별도 패치 파일(`dpaper-integration-patch.js`)로만 존재,
      worker.js 본체에 아직 병합 안 됨. 삽입 지점: `receiptNo` 확정 직후,
      `pdv_records` 저장 직전 (patch 파일의 "── 삽입 지점" 주석 참조).
- [ ] **춘천 리전(ap-chuncheon-1) 서버에 상용 서버인증서 설치** — dpaper.kr
      요구사항(국내 서버 보유). l1-hanlim.hondi.net과 별도 서브도메인
      권장(예: dpaper-api.hondi.net, Cloudflare 프록시 OFF/DNS only).
      [관련 대화: 2026-08-20 서버인증서 스펙 확인 작업]

## 확인만 하고 넘어간 것 (이미 준비돼 있어 손댈 필요 없음)

- ✅ 서류 요구사항 스키마(`REQUIRED_DOCUMENTS_REGISTRY`) — 이미 gov24
     acquisition 경로와 IDV 볼트 우선조회 원리가 구현돼 있음. 건축
     인허가·사용승인 task_key를 이 레지스트리에 추가하는 작업은 별도.
- ✅ 접수/보완 상태 머신(`accepted`/`pending_documents`) — 이미
     `handleGovTaskSubmit`이 구현. U12가 새로 만들 필요 없음.
- ✅ 정부 수수료 조회·GDC 청구(승인 게이트 포함) — 이미 배선됨
     (`resolveGovFee`, `_chargeGdcForAiUsage`, `gov_fee_charges`).

## 관련 별도 체크리스트

**GOV_TASK 접수 이후(심사·보완·의견제출) 구현 갭은 이 문서 범위가
아니다** — dpaper.kr API 승인과 무관하게 필요한 작업이므로
`IMPLEMENTATION-GAPS_gov-task-post-acceptance.md`에 별도 기록한다
(receipt_no 재사용 분기, review_state 스키마, call-ai.js 3개 태그
파싱, `/gov/task/officer-decision` 엔드포인트). 두 문서는 서로 다른
선행조건을 갖는 독립 작업이며, 착수 순서를 섞지 않는다.

## 이 문서 자체의 갱신 규칙

새로운 dpaper.kr 관련 스위치가 생기면 이 문서에 체크박스로 추가한다.
별도 문서를 새로 만들지 않는다 — 스위치 위치가 여러 문서에 흩어지면
"승인 즉시 파악"이라는 이 문서의 존재 이유가 무너진다.

최종 갱신: 2026-08-20
