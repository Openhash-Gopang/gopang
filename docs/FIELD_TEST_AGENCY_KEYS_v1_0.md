# 필드 테스트 기관 키 우회 방안 v1.0 (FIELD_TEST_AGENCY_KEYS)

> **작성일:** 2026-07-14 | **근거:** 주피터님 지시 — "기관들이 실제로
> 참여하기 전, 혼디 성능을 검증하고 버그를 색출하기 위한 필드 테스트
> 기간 동안, 기관 공개키 등록 문제(#18의 잔여분, F)를 우회할 방안"
> **구현 위치:** `src/worker/dept-task-handler.js`
> (`FIELD_TEST_AGENCY_PUBKEY_REGISTRY`·`_fieldTestModeActive`·
> `_isFieldTestOrg`), `worker.js`(`approveAffiliationCore`의
> `verified_by` 태깅)

## 0. 원칙 — 우회하되 검증 로직 자체는 그대로 탄다

목적이 "버그 색출"이므로, 검증을 건너뛰는 목업을 만들면 정작 실제
`_verifyAccessCert`(서명 검증) 경로 자체가 테스트를 안 받는 모순이
생긴다. 그래서 이 방안은 **키 조회 대상만 바꾸고, 서명 검증 로직은
실제 기관이 참여했을 때와 완전히 동일한 코드**를 탄다 — QA 팀이
`gopang-wallet.js`(실사용자와 같은 도구)로 만든 테스트 키쌍의 공개키를
`FIELD_TEST_AGENCY_PUBKEY_REGISTRY`에 커밋해 넣으면, 그 뒤로는
진짜 기관장 키를 쓸 때와 코드 경로가 1도 다르지 않다.

## 1. 안전장치 3중

우회 자체가 #18에서 고친 취약점을 다시 여는 구멍이 되지 않도록,
독립적인 안전장치 세 개를 겹쳤다 — 하나만 살아있어도 위험하지 않게
설계했다:

1. **날짜 만료(`FIELD_TEST_MODE_EXPIRY = '2026-10-01'`)** — 이 날짜가
   지나면 레지스트리 내용과 무관하게 코드가 통째로 무시한다. 실제
   기관 참여 시점에 이 코드를 지우는 걸 깜빡해도, 시간이 지나면
   자동으로 죽는다.
2. **환경변수 게이트(`env.HONDI_FIELD_TEST_MODE === 'true'`)** — git에
   커밋되지 않는 Cloudflare 환경변수다. 실서비스 `wrangler.toml`/
   대시보드 설정에 이 값을 안 넣으면 원천적으로 참조되지 않는다.
   **배포 전 체크리스트에 "HONDI_FIELD_TEST_MODE가 프로덕션에 없는지
   확인"을 반드시 추가할 것.**
3. **감사 태깅(`verified_by: 'FIELD_TEST:...'`)** — 테스트 키로
   검증된 소속 승인은 `verified_by` 필드에 표시가 남는다. 실제 기관
   참여를 앞두고 `verified_by`가 `FIELD_TEST:`로 시작하는 레코드를
   일괄 검색해 정리(철회)할 수 있다.

세 겹 중 하나만 살아있어도(예: 날짜를 깜빡 놔뒀지만 env 변수는 프로덕션에
없음) 실제 프로덕션에서는 작동하지 않는다.

## 2. 사용법 — QA 팀 절차

### 2-1. 테스트 키쌍 생성 (기존 도구 재사용, 새 UI 안 만듦)

브라우저에서 `gopang-wallet.js`를 로드하고 콘솔에서:
```js
const wallet = await window.gopangWallet.generateKeyPair();
console.log('공개키(레지스트리에 등록):', wallet.publicKeyB64u);
console.log('개인키(테스트 스크립트 보관, 절대 커밋 금지):', wallet.privateKeyB64u);
```
또는 Node.js(v20+, WebCrypto Ed25519 지원)에서:
```js
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: 'Ed25519' }, true, ['sign', 'verify']
);
const pubRaw = await crypto.subtle.exportKey('raw', publicKey);
const toB64u = buf => Buffer.from(buf).toString('base64url');
console.log('공개키:', toB64u(pubRaw));
```

### 2-2. 레지스트리에 등록 (git 커밋 — fix.py 아님, 직접 코드 수정 권장)

`src/worker/dept-task-handler.js`의
`FIELD_TEST_AGENCY_PUBKEY_REGISTRY`에 테스트하려는 `org_id`(예:
`city-dept:jeju:health`)와 위에서 생성한 공개키를 추가:
```js
const FIELD_TEST_AGENCY_PUBKEY_REGISTRY = {
  'city-dept:jeju:health': 'AbCd...(공개키)...',
};
```

### 2-3. 배포 환경에 플래그 설정

Cloudflare 대시보드(또는 `wrangler secret put`)로 스테이징/테스트
환경에만 `HONDI_FIELD_TEST_MODE=true`를 설정한다. **프로덕션 환경에는
절대 설정하지 않는다.**

### 2-4. access_cert 발급 (테스트 시나리오 실행)

QA 스크립트가 개인키로 직접 서명해 access_cert를 만들고
`/gov/relay`·`/stats/dept` 등에 실어 보낸다 — 실제 기관장이 하게 될
절차와 완전히 동일하다(§ACCESS-CERT §1 참고).

## 3. KNOWN_LIMITATIONS

1. **레지스트리가 하드코딩(git 커밋) 방식이라 실시간 자율등록이
   아니다** — 의도된 설계다(§0 — 별도 admin API를 새로 만들지 않고
   기존 fix.py/git 커밋 흐름을 그대로 재사용). 테스트 대상 기관을
   바꿀 때마다 코드 수정·재배포가 필요하다.
2. **날짜 만료(2026-10-01)가 지나면 그 시점에 진행 중이던 필드
   테스트도 함께 끊긴다** — 테스트 기간이 길어지면 이 상수를 직접
   갱신해야 한다(자동 연장 없음 — 의도적으로 "잊으면 안전 쪽으로
   닫힌다"를 택함).
3. **`verified_by`의 `FIELD_TEST:` 태그는 승인 시점에만 찍힌다** —
   이미 검증 통과한 `access_cert`로 만든 다른 부작용(예: 이번
   기능에선 다루지 않았지만 향후 추가될 다른 privileged 액션)까지
   자동으로 태깅되진 않는다. 새 privileged 기능을 추가할 때마다
   같은 태깅을 그 기능에도 반복해서 넣어야 한다.

---
*v1.0 (2026-07-14) — 최초 작성. 3중 안전장치(날짜 만료·env 게이트·
감사 태깅)로 필드 테스트용 임시 기관 키를 실제 access_cert 검증
경로 그대로 태우면서도 프로덕션 유출 위험을 최소화.*
