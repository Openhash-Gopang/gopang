# DOCUMENT-TYPE-REGISTRY
# ═══════════════════════════════════════════════════
# 문서명    : 기관 입력·출력 문서유형 공통 레지스트리
# 문서 코드  : DOCUMENT-TYPE-REGISTRY
# 버전      : v1.2
# 근거      : 2026-07-08 주피터님 지시 — "모든 기관은 입력과 출력이 있다.
#             기관 프로필/SP 작성의 첫 단추는 입력·출력 파악"이라는 원칙을
#             기계적으로 매칭 가능한 형태로 구현. 이게 없으면 "기관A의
#             출력이 기관B의 입력과 같은 문서인지"를 시스템이 판단할 방법이
#             없어, 위치기반서비스 사례의 반복입력(10여 회) 같은 문제가
#             구조적으로 반복된다.
#             v1.1(2026-07-08): 사고실험 6·8 결과 반영 — 외국인 신원문서,
#             대리신청 위임문서 대분류 신설(HUMAN-AUTHORITY-GATE-SCHEMA
#             G8과 짝).
#             v1.2(2026-07-08): B-1 검증(GAP-LIST-50) 결과 반영. (1)
#             `HEALTH`·`EVIDENCE` 대분류 신설(#22·#42로 확인). (2) 당초
#             가설이던 `FINANCE` 대분류는 기각 — #30 재검토 결과 계좌정보
#             등은 "문서"가 아니라 원자값(atomic field)이라, 새 대분류가
#             아니라 `doc_type`/`pdv_field` 이원 표기 신설로 해결.
# 적용 대상  : SP-AUTHOR PHASE B-0(신설)이 작성하는 모든 기관 SP의
#             INPUT_SCHEMA/OUTPUT_SCHEMA. `DATA_REQUIREMENT-SCHEMA`·
#             `PDV-TRANSFER-PROTOCOL`의 REQUIRED_USER_FIELDS/
#             ISSUED_DOCUMENTS는 이 레지스트리의 `doc_type` 식별자를
#             그대로 참조한다(자유서술 금지).
# 작성일     : 2026-07-08
# 작성자     : AI City Inc. · 주피터
# ═══════════════════════════════════════════════════
#
# 버전 변경 이력
# ─────────────────────────────────────────────────
# v1.2 (2026-07-08): `HEALTH`·`EVIDENCE` 대분류 신설. `doc_type`/
#                `pdv_field` 이원 표기 신설(원자값은 새 대분류가 아니라
#                이 구분으로 처리).
# v1.1 (2026-07-08): `IDENT-FOREIGN`·`PROXY` 대분류 신설.
# v1.0 (2026-07-08): 최초 제정.
# ─────────────────────────────────────────────────

## 목적 — "출력=입력"을 기계가 판단할 수 있게

기관 SP가 각자 "사업자등록증이 필요합니다"라고 자유서술하면, 사람은 알아도
시스템은 기관A가 발급한 문서와 기관B가 요구하는 문서가 같은 것인지 문자열
비교로는 판단할 수 없다(오타·이명·띄어쓰기 차이만으로도 매칭 실패).
`doc_type`이라는 공통 식별자 하나로 발급 측·요구 측이 항상 같은 값을 쓰게
강제하면, 이 매칭이 기계적으로 성립한다 — SP-AUTHOR가 새 기관 SP를 찍어낼
때마다 자동으로 "이미 갖고 있을 가능성이 있는 문서"를 표시할 수 있게 되는
근거가 이것이다.

## doc_type 명명 규칙

```
DOC-{대분류}-{세부코드}
```

| 대분류 | 의미 | 예시 |
|---|---|---|
| `IDENT` | 신원 증명 | `DOC-IDENT-RESIDENCE`(주민등록등본), `DOC-IDENT-SEALCERT`(인감증명서) |
| `BIZ` | 사업자 관련 | `DOC-BIZ-REG`(사업자등록증), `DOC-BIZ-CORPNO`(법인등록번호증명) |
| `TAX` | 세무 관련 | `DOC-TAX-RECEIPT`(납세증명서), `DOC-TAX-LICENSEFEE-RECEIPT`(등록면허세 영수증) |
| `LICENSE` | 인허가·등록 산출물(절차 고유) | `DOC-LICENSE-{절차슬러그}`, 예: `DOC-LICENSE-LBS-REG`(위치기반서비스 등록증) |
| `FACILITY` | 설비·시설 관련 진술서 | `DOC-FACILITY-SPEC`(주요설비 명세서) |
| `IDENT-FOREIGN` | 외국인 신원 증명(내국인 `IDENT`와 별도 체계) | `DOC-IDENT-FOREIGN-REG`(외국인등록증), `DOC-IDENT-FOREIGN-ARC`(등록번호증명) |
| `PROXY` | 대리신청 자격 증빙(HUMAN-AUTHORITY-GATE-SCHEMA G8 전제조건) | `DOC-PROXY-AUTH`(위임장), `DOC-PROXY-FAMILY`(가족관계증명서, 법정대리인 확인용) |
| `HEALTH` | 의료·건강 관련 입력문서(기본 `min_level: L3`) | `DOC-HEALTH-DIAGNOSIS`(진단서·소견서), `DOC-HEALTH-EXAM`(검사결과서) |
| `EVIDENCE` | 신고·민원의 증빙자료(신고인이 제출하는 자유형식 증거) | `DOC-EVIDENCE-CAPTURE`(스크린샷·통신기록 캡처), `DOC-EVIDENCE-PHOTO`(현장사진), `DOC-EVIDENCE-RECEIPT`(피해 영수증) |

절차 고유 산출물(`LICENSE`류)은 기관마다 새로 발급하는 게 원칙이라 재사용
대상이 아니다 — 매칭의 실익은 대부분 `IDENT`·`BIZ`·`TAX`류처럼 **여러
절차에서 반복 요구되는 입력**에서 나온다(위치기반서비스 사례의 사업자
등록증·법인등록번호가 정확히 이 유형). `IDENT-FOREIGN`·`PROXY`·`HEALTH`는
기본 `min_level: L3`로 등재한다 — 타인 신원·대리자격·건강정보와 직결되는
문서라 매 건 동의 대상에서 예외를 두지 않는다. `EVIDENCE`는 등재 시
건별로 `min_level`을 판단한다 — 단순 현장사진(L1)과 피해 통신기록(L2~L3)
은 민감도가 다르므로 대분류 하나로 일괄 지정하지 않는다.

## doc_type vs pdv_field — "문서"와 "원자값"은 다른 것이다

B-1 검증(#30 부가세 환급 계좌정보) 결과 확인된 것: 모든 입력이 "문서"는
아니다. 계좌번호·생년월일처럼 **발급받은 증서가 아니라 그 자체로 값인
것**은 `doc_type`으로 등재하지 않는다 — Hondi가 이미 갖고 있는 PDV 필드
어휘(`docs/PROFILE_REGISTER_HANDOVER_v2.md`의 `biz_reg_no`·`ksic_code`류)
를 그대로 재사용한다. `INPUT_SCHEMA`는 이제 두 종류의 항목을 명시적으로
구분해 표기한다:

```json
"INPUT_SCHEMA": [
  { "type": "doc_type", "value": "DOC-HEALTH-DIAGNOSIS", "required": true },
  { "type": "pdv_field", "value": "bank_account_no", "min_level": "L2", "required": true }
]
```

`doc_type` 항목만 §승계 후보 판정(발급 이력 재사용)의 대상이다 —
`pdv_field`는 PDV_STORE에서 직접 조회하는 것이지 "발급받아 재사용"하는
성격이 아니므로 별도 취급한다. 새 `doc_type`을 등재하기 전에는 먼저
"이게 발급되는 증서인가, 그냥 값인가"부터 판별한다 — 애매하면 pdv_field
쪽을 기본값으로 한다(불필요한 doc_type 증식 방지).

## 등재 절차

새 `doc_type`이 필요하면 SP-AUTHOR가 임의로 만들지 않고, 기존 레지스트리를
먼저 전수 검색해 동의어가 이미 있는지 확인한다(§등재 예시의 `aliases` 필드
활용). 없을 때만 신규 등재하며, 등재 시 다음을 필수로 채운다:

```json
{
  "doc_type": "DOC-BIZ-REG",
  "label": "사업자등록증",
  "aliases": ["사업자 등록증", "사업자등록증명원"],
  "issuing_agency_pattern": "국세청(세무서)",
  "typical_inputs_required_to_obtain": ["DOC-IDENT-RESIDENCE"],
  "min_level": "L2",
  "registered_by_sp_draft": "{이 doc_type을 처음 등재한 GOV_SP_DRAFT_REQUEST id}"
}
```

`min_level`은 `DATA_REQUIREMENT-SCHEMA`/`PDV-TRANSFER-PROTOCOL`의 L0~L3
어휘를 그대로 재사용한다 — 이 문서가 별도 민감도 체계를 만들지 않는다.

## 기관 SP의 INPUT_SCHEMA / OUTPUT_SCHEMA 표기

```json
"INPUT_SCHEMA": [
  { "doc_type": "DOC-BIZ-REG", "required": true },
  { "doc_type": "DOC-IDENT-RESIDENCE", "required": false, "condition": "법인이 아닌 개인사업자인 경우" }
],
"OUTPUT_SCHEMA": [
  { "doc_type": "DOC-LICENSE-LBS-REG", "format": "PDF 등록증" }
]
```

## 승계 후보 판정 — "가능성 계산"이지 "자동전송"이 아니다

사용자 AI 비서는 새 GOV_TASK를 시작하기 전, 대상 기관 SP의 `INPUT_SCHEMA`
각 `doc_type`에 대해 다음 순서로 이미 보유한 것이 있는지 조회한다:

```
1. PDV_STORE{type:"transfer"} 이력에 같은 doc_type을 이미 다른 기관에
   제출한 기록이 있는가? (재사용 가능한 사본이 있을 수 있음)
2. 다른 기관의 OUTPUT_SCHEMA 중 같은 doc_type을 이미 발급받은 이력이
   `gov_tickets`에 있는가?
```

둘 중 하나라도 있으면 "승계 후보"로 표시하고 사용자에게 확인만 받는다
(재입력·재발급 요청 대신 "지난번 받으신 {doc_type} 그대로 쓸까요?"로
1턴 단축). **이 조회와 확인은 어디까지나 사용자 AI 비서가 수행**하며,
`PDV-TRANSFER-PROTOCOL` §3-A(기관 간 직접 전달 예외 없이 금지)를 우회하지
않는다 — 승계 후보 판정이 "무엇을 갖고 있는지 아는 것"이라면, 실제 전송은
여전히 §1~§3의 화이트리스트·동의 절차를 그대로 거친다.

## SP-AUTHOR와의 관계

`SP-AUTHOR_v1_0.md`의 PHASE C(역할·절차 조사)는 이 문서 제정 이후
PHASE B-0으로 앞당겨지고 범위가 좁혀진다 — "이 기관이 하는 일 전반"을
막연히 조사하는 게 아니라 **INPUT_SCHEMA/OUTPUT_SCHEMA부터 확정**하는
것이 첫 조사 목표가 된다(SP-AUTHOR v1.1 패치로 반영).
