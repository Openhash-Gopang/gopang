# PROFESSOR_TIER2_AND_MEDICAL_20260810.md

`PROFESSOR_SUBDIVISION_SURVEY_20260810.md`의 Tier 2(3개 채택) + §4(의료
전문과목, 수의학 제외 3개) 구현 완료 기록. `PROFESSOR_TIER1_EXPANSION_20260810.md`
직후 배치.

## §1 Tier 2 — 채택 3개 / 보류 4개

서베이의 7개 후보 중 경계가 뚜렷하고 표준 하위분야가 명확한 3개만 채택:

| 분야 | 신설 중계열 | 신규 소계열 |
|---|---|---|
| 인류학 | `professor-anthropology-series` | 문화인류학·고고인류학·언어인류학 (3) |
| 지리학 | `professor-geography-series` | 자연지리학·인문지리학·GIS (3) |
| 통계학 | `professor-statistics-series` | 수리통계학·응용통계학·생물통계학 (3) |

**보류 유지(서베이 원안 그대로)**: 화학공학·전자공학(반도체공학과 경계
겹침 위험)·건축공학/토목공학(실익 낮음)·개별 외국어(분리 실익 낮음).

## §2 §4 의료 전문과목 — 법정 근거 확인 후 3개 착수, 수의학 제외

착수 전 「전문의의 수련 및 자격 인정 등에 관한 규정」 제3조를 웹검색으로
직접 대조— 의학·치의학·한의학은 법정 전문과목 수가 명확(26/10/8)했지만,
**수의학은 한국에 법정 전문수의사 제도가 아직 확립되지 않은 상태**(2026년
기준 "전문수의사 제도 도입안" 논의 단계, 서울대 수의대가 언급하는
내과·외과·안과 등 9개는 비공식 세부진료 관행일 뿐 법령상 근거 없음)임을
확인 — 이번 배치에서 제외했다.

| 분야 | 신설 중계열 | 신규 소계열 수 | 법적 근거 |
|---|---|---|---|
| 의학 | `professor-medicine-specialty-series` | 26 | 전문의 수련·자격 인정 규정 §3 |
| 치의학 | `professor-dentistry-specialty-series` | 10 | 상동 |
| 한의학 | `professor-koreanmedicine-specialty-series` | 8 | 상동 |
| 수의학 | (미착수) | — | 법정 전문과목 미확립 |

## §3 공통 사항

- 리프 id 네임스페이스 충돌 방지를 위해 의료 3개는 `professor-med-*`
  (의학) / `professor-dent-*`(치의학) / `professor-kmed-*`(한의학)
  접두사를 붙였다 — 예: `professor-med-dermatology`(피부과학)는 기존
  `professor-skincare`(피부미용, 보건 계열)와 id·라벨 모두 명확히 구분.
- 의료 3개 리프는 SP 본문에 "진료 아님" 고지를 공통으로 추가 — 환자
  개인의 증상·진단·처방 문의는 응하지 않고 의료기관 방문을 안내하도록
  명시(학습지도 vs 진료 경계, 기존 `professor-medicine` 설계 원칙 계승).
  `needsMedicalSafety`는 기존 형제 리프와 동일하게 `false` 유지(진료가
  아니므로).
- 기존 리프 6개(`professor-anthropology`·`professor-geography`·
  `professor-statistics`·`professor-medicine`·`professor-dentistry-academic`·
  `professor-koreanmedicine`)는 id 그대로 유지, 새 중계열 소속으로만
  재편입 — 특정 하위분야를 콕 집기 애매한 개론 수준 발화는 계속 이
  리프가 받는다.
- **매니페스트 등록을 이번엔 처음부터 같이 진행** — 직전 배치(Tier 1)에서
  뒤늦게 발견했던 `sp-catalog.json` 누락 결함을 이번엔 생성 직후 바로
  59개 키를 등록해 재발 방지.

## §4 검증

- 리프 총합: 254 → **307개**(전수 카운트 일치, 중복 없음).
- SP 파일 59개 전부 존재, 매니페스트 누락 0건(자동 검증 스크립트로 확인).
- 게이트 규모: `dump_gate_levels.mjs`로 재확인 — 게이트 호출 지점
  42→48개, **최대 후보 수는 여전히 29(루트) 근처**(신설된
  `professor-medicine-specialty-series`가 28로 두 번째로 큼, 26개
  전문과목 + 일반 + 해당없음). 다른 어떤 계열도 30을 넘지 않음.
- `render_expert_prompts.mjs`로 6개 샘플(인류학·지리학·의학·치의학·
  한의학·의학 폴백 리프) 실제 프로덕션 합성 함수 호출 — 전부 정상 렌더,
  manifest 경고 0건.

## §5 남은 일

- 라이브 DeepSeek 실사 검증은 여전히 미실시(네트워크 제약, Tier 1과
  동일한 사유) — 다음 세션에서 307개 리프 전체, 특히 새로 생긴
  대형 게이트(`professor-medicine-specialty-series` 28후보)의 실제
  분류 정확도 확인 필요.
- 수의학 전문과목: 법정 제도 확립 후 재검토 대상으로 남겨둠.
