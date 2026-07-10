# GWP-REGISTRY-SCALING_v1_0.md
## gwp-registry 폭증 대응 설계

작성일: 2026-07-11 | 작성자: 주피터 지시, Claude 작성

## 1. 문제

`gwp-registry.js`는 지금 ~21개 서비스를 하드코딩한 JS 배열이며, **매 클라이언트 세션마다
통째로 로드**된다. SP-Author가 이번에 자동화(신호 큐잉+ESCALATE, 이전 패치)되면서, 정부기관·
업종별 SP가 반응형(`kcompose_match_fail`)뿐 아니라 선제적(`gov_data_monitor`) 경로로도
계속 생성된다. 이 속도로 늘어나면:
  - 배열이 수백~수천 개만 돼도 클라이언트 로드 비용이 무의미하게 커진다.
  - 수만~수백만 개(전국 확장·업종별 세분화까지 가면 현실적 상한이 없다) 규모에서는
    "배열 하나에 다 담아 매번 전송" 자체가 성립하지 않는다.
  - `sp-catalog.json`도 같은 문제를 안고 있다 — `tools/build_manifest.py`가 `prompts/`
    디렉터리 전체를 스캔해 하나의 JSON으로 만드는 방식이라, SP 파일 수가 늘어나면 빌드
    시간·매니페스트 크기가 함께 폭증한다(이번 설계에서는 이 부분은 손대지 않음 — SP **파일**
    자체의 저장·버전관리는 여전히 git이 감당할 수 있는 범위이고, 문제는 "그중 무엇이
    존재하는지 클라이언트가 어떻게 아는가"이므로 그 발견(discovery) 레이어만 분리한다).

## 2. 설계 — 계층 분리 (Core vs 확장 레지스트리)

**gwp-registry.js는 그대로 둔다.** 21개는 자주 쓰이고 안정적인 "핵심 K서비스"이며, 이 규모는
브라우저에 계속 실어도 문제없다. 손대는 건 그 **아래**다.

신설한 `gwp_registry` PocketBase 컬렉션(무제한 확장)이 core 21개를 포함해 SP-Author가
승인하는 모든 신규 SP(institutional·business·expert·personal tier)를 담는다. 스키마:

| 필드 | 설명 |
|---|---|
| `gwp_id` | 고유키 — sp-catalog.json 키 또는 org_profiles.org_id와 대응 |
| `tier` | core \| institutional \| business \| expert \| personal |
| `category` | 기존 gwp-registry.js category 값 재사용(GOV/JUS/MED/...) |
| `keywords` | 검색 대상 자유 텍스트(동의어·업무어) |
| `jurisdiction` | 관할 범위(전국 확장 대비) |
| `file_ref` | 실제 SP 파일/레코드 참조 |
| `status` | active \| pending_review \| deprecated |
| `call_count_30d` | 호출 빈도(정렬·정기갱신 tier 계산에 재사용 가능 — SP-AUTHOR-AUTOMATION_v1_0.md와 동일 개념) |

core 21개는 시딩 마이그레이션(`1783500009_seeded_gwp_registry_core.js`)으로 이 테이블에도
동일하게 들어가 있다 — 지금 당장 `gwp-registry.js`를 이 테이블에서 파생하도록 바꾸지는
않지만(클라이언트 코드가 여전히 그 파일을 직접 import), 나중에 "core도 gwp_registry에서
조회"로 전환할 때 데이터가 이미 일치해 있도록 하기 위함이다.

## 3. 조회 방식 — "전부 로드" 대신 "필요한 만큼 검색"

worker.js에 3개 엔드포인트를 신설했다:
  - `GET /gwp-registry/lookup?id=...` — gwp_id를 이미 아는 핫패스(단건, O(1))
  - `GET /gwp-registry/search?q=&category=&tier=&jurisdiction=&limit=` — 모를 때 검색
  - `POST /gwp-registry/register` — 신규/갱신 등록(멱등)

K-Compose(SP-20 v1.2)의 STEP 4-A가 이제 이 흐름을 따른다:

```
후보 탐색(K-Search/search_entities/gwp-registry.js core)
  → 일치도 게이트(match_score < 0.7이면 기각, 반복)
  → 후보 소진
  → [GWP_REGISTRY_SEARCH] 로 확장 레지스트리 재확인   ← 이번에 신설
      → hit: 그 gwp_id로 STEP 4 계속(이미 승인된 SP를 "없다"고
              오판해 중복 SP-Author 요청을 내는 걸 방지)
      → miss: [매칭 실패 처리](GOV_SP_DRAFT_REQUEST 등, 기존 로직)
```

## 4. 검색 방식의 현재 한계와 업그레이드 경로

지금 `_l1SearchGwpRegistry`는 PocketBase(SQLite) `LIKE` 기반 검색이다(`~` 연산자). 이건
**수백~수만 건, 정확한 키워드 일치** 범위에서는 잘 작동하지만, 정직하게 두 가지 한계가 있다:

  1. **재현율**: "축산분뇨 감독기관"을 찾는데 SP에 "가축분뇨 배출시설 관리"라고만 적혀
     있으면 LIKE로는 안 걸린다 — 동의어를 `keywords` 필드에 사람이 미리 채워둬야 한다.
  2. **규모**: 진짜 수백만 레코드에서 LIKE 스캔은 느려진다(인덱스가 있어도 부분일치
     검색은 B-tree 인덱스의 이점을 온전히 못 받는다).

**지금 단계에서 할 일이 아니다** — SP 수가 아직 수십~수백 단위이므로 과잉설계다. 다만
명시적으로 남겨둔다: 이 규모(대략 만 단위 이상, 또는 검색 정확도 불만이 누적되는 시점)에
도달하면 아래 순서로 교체를 검토한다:
  - 1차: PocketBase 자체의 전문검색(FTS5) 확장 — 스키마 변경만으로 가능, 인프라 추가 없음.
  - 2차: 임베딩 기반 의미검색(예: `keywords`+`description`을 벡터화해 pgvector·Typesense
    등에 색인) — 동의어 문제(1번 한계)를 근본적으로 해결하지만 별도 인프라가 필요하다.
  이 결정은 실제 검색 실패 사례가 쌓인 뒤(§SP-AUTHOR-AUTOMATION_v1_0.md의
  `search_miss_pattern` 배치가 그 실패 사례를 모으는 역할도 겸한다)에 내리는 게 맞다 — 지금
  추측만으로 벡터 DB를 들이는 건 과잉이다.

## 5. SP-Author 승인 → 자동 등록

`handleSPAuthorQueueStatus`(SP-Author 자동화 패치에서 신설)가 `status=approved`로 전이될
때 자동으로 `gwp_registry`에 등록(또는 갱신)한다 — 사람이 "승인"과 "레지스트리 등재"를
별도 두 단계로 각각 해야 한다면, 승인 건수가 늘어날수록 등재 누락이 반드시 생긴다. 이제는
승인 = 등재다(등록 실패가 승인 자체를 실패시키지는 않음 — 등록 실패 시 로그만 남기고
수동 보완을 유도).

## 6. 이번에 안 한 것 (범위 밖, 정직하게 표시)

  - `gwp-registry.js` 파일 자체를 `gwp_registry` 테이블에서 동적으로 읽어오도록 클라이언트를
    바꾸는 것 — core 21개는 아직 그 규모 문제가 없으므로 당장 급하지 않다.
  - `sp-catalog.json`/`build_manifest.py`의 "전체 스캔" 방식 자체를 바꾸는 것 — SP **파일**
    저장은 git이 감당하는 한 문제없고, 이번 설계는 "무엇이 존재하는지 찾는" 발견 레이어만
    분리했다. 파일 수 자체가 수백만이 되는 시나리오(예: 개인별 맞춤 SP까지 전부 파일화)는
    별도 검토가 필요하다.
  - 실제 검색 엔진 교체(§4 업그레이드 경로) — 필요 시점이 아직 아니다.
