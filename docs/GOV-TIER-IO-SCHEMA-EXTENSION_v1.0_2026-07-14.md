# GOV-TIER-IO-SCHEMA 확장 — PDV 조회 결과 필드 추가 (v1.0)

작성일: 2026-07-14
목적: 혼디-공무원직무보조-시스템갱신계획_v1.0 §5 레이어 C 구현
적용 대상: 515개 SP 전체가 참조하는 기존 `GOV-TIER-IO-SCHEMA` 문서

> 이 문서는 기존 GOV-TIER-IO-SCHEMA 원본 파일 위치를 확인하지 못한 상태에서
> 작성한 **패치 스펙**입니다. 원본 파일의 `§OUTPUT_SCHEMA` 섹션 안에 아래 두
> 필드 정의를 그대로 삽입하면 됩니다. 원본 파일 경로를 알려주시면 다음 턴에
> str_replace로 직접 병합하겠습니다.

---

## 추가 필드 1: `정부24_조회_결과`

트랙1/2(58건)에서 PDV 동의 기반 정부24 API 조회가 발생한 SP 응답에 표준 포함되는 필드.

> **2026-07-15 정정(발견③):** 아래 `required_if`가 참조하는 `pdv-consent.js`의
> `requestPDVConsent()`는 실재하지 않는다 — 실제 파일은 `pdv-history-client.js`이고
> 노출 함수는 `interceptPdvTags`/`checkPdvConsentReturn`/`queryPdvScope` 셋뿐이다
> (사고실험 발견③, 원본 갱신계획 §5 레이어A도 동일 오류). 공무원이 시민을 대신해
> 조회하는 경우(트랙1/2 대부분)는 `queryPdvScope`가 아니라 `PERSONAL-AC-CALL-
> PROTOCOL_v1_0`의 `[PERSONAL_AC_CALL]`이 실제 호출 경로다 — 아래 `required_if`는
> 그 프로토콜 기준으로 다시 읽는다.

```yaml
정부24_조회_결과:
  type: object
  required_if: "SP가 PERSONAL-AC-CALL-PROTOCOL의 [PERSONAL_AC_CALL]을 발화하여
    [PERSONAL_AC_RESPONSE: status=granted]를 회신받은 경우"
  properties:
    조회됨: boolean
    scope: string          # pdv-consent.js의 PDV_SCOPES 값 중 하나
    token_id: string       # 발급된 동의 토큰 ID (감사 추적용)
    조회_시각: string       # ISO8601
    원본_데이터: object      # 정부24 API 응답을 SP 표준 포맷으로 매핑한 결과 (레이어 B, GOV24_API_MAP 참조)
    조회_실패_사유:
      type: string
      nullable: true        # 시민이 동의 거부한 경우 등
```

## 추가 필드 2: `담당자_확인_필요`

트랙2(조건부 해결 23건 — §3 매핑표에서 "비고"란에 담당자 개입 사유가 명시된 항목: 5,11,13,18,20,47,51,52,55,66-69,71,73,75,76,77,81,82,84,87)에서 SP가 정부24 조회만으로 처리를 완결할 수 없을 때 명시적으로 세워야 하는 플래그.

```yaml
담당자_확인_필요:
  type: object
  required_if: "정부24_조회_결과만으로 처리 완결 불가능한 경우"
  properties:
    필요: boolean
    사유:
      type: string
      enum:
        - 원본_대조_필요          # 예: 11번 급여명세·통장 대조
        - 전문_심사_필요          # 예: 47번 설계도서 검토
        - 현장_판단_필요          # 예: 51번 주정차 이의신청 과실 판단
        - 별도_기관_연동_필요      # 예: 18번 의료기관 시스템, 52번 은행 예치금
        - 옵트인_등록_선행_필요    # 예: 76·77·81·82·84번 재난지원 옵트인
        - 익명화_파이프라인_필요   # 예: 66-69,71,73,75번 지역단위 통계
    담당_결재선: string        # 기존 결재선 시스템 연동 ID (Phase 3에서 확정)
    상태:
      type: string
      enum: [대기, 확인중, 완료, 반려]
```

## 스키마 변경 영향 검토

- 515개 SP 중 트랙1/2(58건)에 해당하지 않는 SP는 두 필드 모두 `null` 또는 미포함 상태 유지 — **하위 호환 유지, 기존 SP 동작에 영향 없음**
- CI stale-reference checker(check_stale_refs.py)로 필드 추가 후 전수 SP의 스키마 참조 무결성 검증 필요 (Phase 0 체크리스트 항목)
