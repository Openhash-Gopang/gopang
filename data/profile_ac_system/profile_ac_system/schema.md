# 데이터 스키마 설계 — 업종별 Profile/AC 템플릿 시스템

기존 PocketBase 컬렉션(org_profiles, atom_rows, procedure_maps)에 추가되는 4개 컬렉션.

## 1. `field_observations` (원본 수집, 정규화 이전)
사용자가 자신의 profile/AC에 필드를 추가할 때마다 1행 적재. 절대 삭제/수정하지 않음(원본 보존).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | string | PK |
| ksic_code | string | 해당 사용자의 업종 코드 (product_classifier 결과) |
| kind | enum | `profile_field` \| `ac_feature` |
| raw_label | string | 사용자가 실제로 입력한 필드/기능 이름 (정규화 안 함) |
| user_id | string | 소유 사용자 |
| created_at | datetime | |

## 2. `standard_fields` (승격된 표준 사전 — 자라나는 산출물)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | string | PK |
| ksic_code | string | 이 표준 필드가 속한 업종 (또는 `*` = 업종 공통) |
| kind | enum | `profile_field` \| `ac_feature` |
| canonical_label | string | 승격된 표준 이름 |
| aliases | string[] | 이 표준으로 묶인 raw_label들 |
| observation_count | int | 누적 관측 횟수 (재계산됨) |
| promoted_at | datetime | 승격 시각 |
| promoted_by | string | `auto` \| 검토자 ID |

## 3. `promotion_queue` (경량 검토 대기열)
임계 빈도를 넘었지만 아직 사람 확인 전인 클러스터.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | string | PK |
| ksic_code | string | |
| kind | enum | |
| cluster_members | string[] | 클러스터로 묶인 raw_label들 |
| suggested_canonical | string | 클러스터 대표 이름(가장 빈도 높은 raw_label) |
| observation_count | int | |
| status | enum | `pending` \| `approved` \| `rejected` \| `split` |
| reviewed_at | datetime\|null | |

## 4. `industry_templates` (신규 사용자에게 제공되는 최종 산출물)
| 컬럼 | 타입 | 설명 |
|---|---|---|
| id | string | PK |
| ksic_code | string | |
| profile_fields | string[] | standard_fields에서 이 업종에 해당하는 canonical_label 목록 (빈도순) |
| ac_features | string[] | 동일, kind=ac_feature |
| generated_at | datetime | |
| based_on_user_count | int | 집계에 쓰인 사용자 수 (신뢰도 판단용) |

## 흐름
```
사용자 행동(필드 추가)
    ↓
field_observations (원본 적재, 무정규화)
    ↓  [주기적 배치 실행]
field_normalizer.py
    ├─ 클러스터링 (임베딩 유사도)
    ├─ 빈도 임계값 필터 → promotion_queue
    └─ 이미 승격된 standard_fields는 정확 매칭으로 스킵(재클러스터링 안 함)
    ↓  [검토자 승인 or K-Compose 자동검증]
standard_fields (누적/성장)
    ↓
template_generator.py
    ↓
industry_templates (신규 사용자 온보딩 시 즉시 제공)
```
