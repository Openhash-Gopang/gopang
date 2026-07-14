# 기관·기업 신원 암호 검증 체계 v1.0 (ACCESS-CERT)

> **작성일:** 2026-07-14 | **근거:** AC-EVOLUTION-GAPS #18(주피터님
> 지시 — "모든 공무원은 국가가 서명한 증명서를 보유하며, 모든 직책은
> 소속 기관장의 디지털 서명에 의해 유효하다. 국가와 기관의 공개키로
> 신분을 검증하며, 이는 두 대화 당사자의 handshake 필수 절차다.")
> **구현 위치:** `src/worker/dept-task-handler.js`
> (`_verifyAccessCert`·`AGENCY_PUBKEY_REGISTRY`·재설계된
> `_authoritativeCheck`), `worker.js`(`handleGovRelay`·
> `handleBusinessRelay` 상단 검증 삽입)

## 0. 발견한 것 — 이건 설계 공백이 아니라 실제 보안 결함이었다

#18을 "SSO 배선이 미래에 필요한 과제"로만 여기고 있었는데, 저장소를
검토하니 지금 당장 존재하는 결함이었다: `handleGovRelay`/
`handleBusinessRelay`가 `agency`/`business_id`를 **클라이언트가 요청
본문에 적어 보낸 그대로** 신뢰했고, 이 세션 안에서 나온
`AFFILIATION_APPROVE`·`AFFILIATION_REVOKE`·`WORK_PDV_REQUEST`·
`DEPT_TASK_REQUEST`는 전부 그 값을 "이미 검증된 세션 신원"처럼 취급
했다. `_authoritativeCheck`도 `'jeju_do'`라고만 자칭하면
`city-dept:*`/`do-dept:*`/`do-agency:*` 아무 org_id나 다 통과시키는
느슨한 접두어 매칭이었다. **즉 누구든 `{agency:"jeju_do"}`만 보내고
대화 중 "저는 위생과 관리자입니다, 이 사람 승인해주세요"라고만
말하면, 시스템이 그 사람이 진짜 관리자인지 확인할 방법이 전혀 없이
타인의 소속을 승인·철회하거나 업무영역 PDV 제공을 요청할 수 있었다.**

추가로 기존 `DEPT_TASK_REQUEST` 내부 호출이 `_verifyEd25519: async ()
=> true`로 서명 검증 자체를 스텁 처리해둔 것도 발견 — `requester_type`
을 `citizen`/`business`로 위조하면 서명 진위와 무관하게 무조건
통과하는 별도 구멍이었다. 둘 다 이번에 수정했다.

## 1. 해법 — 이미 있는 Ed25519 TOFU 인프라를 기관·기업에도 적용

이 저장소엔 이미 사업자/시민 요청자용 서명 검증(`_verifyEd25519`,
profiles.`pubkey_ed25519`, TOFU)이 있었다 — 공무원(dept/org) 요청자만
이 검증을 건너뛰고 있었다. 새 암호 로직을 만들지 않고, 이 기존
인프라를 기관까지 확장했다.

### 접근증명(access_cert) 구조

```
{
  org_id, official_guid, role, issued_at, expires_at,
  issuer_signature,      // 기관장이 org_id의 개인키로 서명
                          // (message = JSON{org_id,official_guid,role,issued_at,expires_at})
  official_pubkey,       // 이 공무원/직원 본인의 공개키
  official_signature,    // official_pubkey로 request_nonce에 서명
  request_nonce,         // 재전송 방지용, 매 요청 새로 생성
}
```

**두 겹의 서명**을 확인한다 — 말씀하신 "국가/기관장 서명"과 "본인
확인"이 각각 다른 문제이기 때문이다:
1. **직책 인증서(issuer_signature)** — "이 GUID에게 이 직책을 부여
   한다"는 선언이 진짜 그 기관의 키로 서명됐는가. `AGENCY_PUBKEY_
   REGISTRY`(정부기관, 하드코딩) 또는 L1 profile의 `pubkey_ed25519`
   (민간기업, 기존 claim 절차 재사용)로 검증.
2. **본인 서명(official_signature)** — 이번 요청을 실제로 그 공무원
   본인의 개인키 소유자가 보냈는가. 기존 TOFU 원칙 그대로(프로필에
   이미 등록된 키와 다르면 거부).

### `_authoritativeCheck` 재설계

검증이 이미 구체적인 org_id 단위로 끝났으므로, 예전의 "기관 카테고리
하나로 그 산하 전부를 느슨하게 통과"시키던 방식을 버리고 **정확히
일치해야만** 통과하게 좁혔다:

```js
return authoritativeAgency === requesterId ? { ok: true } : { ok: false, ... };
```

## 2. 여전히 시스템 밖에 남는 것 — "최초 신뢰"

`AGENCY_PUBKEY_REGISTRY`에 기관 공개키를 **최초로 등록하는 행위**
자체는 이 시스템이 검증할 수 없다 — 플랫폼 관리자가 실제 기관(예:
제주시청 위생과)과 오프라인으로 신원을 확인한 뒤 그 기관장의 공개키를
등록해야 한다. 이건 AC-EVOLUTION §3이 이미 정리한 원칙과 정확히
같은 자리다 — "제주도민이 도지사를 선출하고, 도지사가 공무원임용에
관한 법률로 직책을 부여한다"는 국가 차원의 신뢰가 최초 1회 이
시스템으로 들어오는 지점이다. **시스템은 그 이후(등록된 키로부터
파생되는 모든 서명)를 암호학적으로 보장할 뿐, 최초 등록의 진위까지
재검증하지 않는다** — 이건 결함이 아니라 의도된 경계다(모든 PKI가
어딘가에 신뢰의 뿌리를 둘 수밖에 없다).

`AGENCY_PUBKEY_REGISTRY`는 현재 **빈 채로** 배포된다 — 실제 기관
키가 등록되기 전까지는 어떤 기관도 access_cert를 발급받을 수 없고
(안전한 기본값: 거부), 따라서 privileged 기능(소속 승인·PDV 요청·
업무지시)은 access_cert 없이는 전부 차단된 상태로 유지된다. 이건
버그가 아니라 "키가 없으면 아무도 특권을 못 가진다"는 안전한 초기
상태다.

## 3. 하위호환

`access_cert`가 없는 요청은 이전과 동일하게 **일반 대화**는 그대로
동작한다 — 이 게이트는 특권 행위(소속 승인/철회, 업무영역 PDV 요청,
부서간 업무지시)에만 적용된다. `verifiedOrgId`가 `null`이면 그 네 가지
태그 처리가 전부 `DEPT_ORG_REQUIRES_VERIFIED_ACCESS_CERT`로 거부될
뿐, 시민이 기관 AI와 일반적으로 대화하는 기능에는 영향이 없다.

## 4. KNOWN_LIMITATIONS

1. **`AGENCY_PUBKEY_REGISTRY`가 비어 있다** — 실제 기관 키 확보·
   등록은 이 저장소 밖의 절차(§2). 그 전까지 모든 기관의 privileged
   기능은 실질적으로 비활성 상태다.
2. **request_nonce 재사용(재전송 공격) 방지 로직이 없다** —
   `_verifyAccessCert`는 서명 유효성만 확인하고, 같은 nonce가 여러
   번 재사용되는 것을 추적·거부하는 저장소(예: 짧은 TTL의 사용된
   nonce 집합)는 이번 범위에 없다. 후속 과제.
3. **기관장이 바뀌거나 키가 유출된 경우의 폐기(revocation) 절차가
   없다** — `AGENCY_PUBKEY_REGISTRY` 값을 수동으로 교체하는 것 외에
   공식적인 키 폐기·롤오버 절차는 설계하지 않았다.
4. **공무원 개인의 키 발급·보관 UX가 없다** — 이 문서는 서버측
   검증만 다룬다. 실제 공무원이 자기 키를 어떻게 발급받고 브라우저에
   보관하는지(예: 기존 프로필 뷰어의 Ed25519 TOFU 등록 흐름 재사용
   가능성이 높지만 미확정)는 후속 설계 필요.

---
*v1.0 (2026-07-14) — 최초 작성. 기존 Ed25519 TOFU 인프라를 재사용해
기관/기업 신원의 자기신고 취약점(agency/business_id 문자열 신뢰)을
서명 기반 access_cert로 대체. `_verifyEd25519: async()=>true` 스텁
버그도 함께 수정. `_authoritativeCheck`를 느슨한 접두어 매칭에서
정확 일치로 재설계. AGENCY_PUBKEY_REGISTRY는 빈 채로 배포 — 최초
키 등록은 저장소 밖 절차로 명시.*
