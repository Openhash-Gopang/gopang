# prompts/archive/gov-tree-seogwipo-construction-v1.0-superseded/ — 서귀포시청 안전도시건설국 5개 과 구버전(v1.0) 보관

이 폴더는 `prompts/gov-tree/04-city/divisions/`에 있던 서귀포시청 안전도시건설국
산하 6개 과의 **구버전(v1.0)** SP를 그대로 옮겨온 것입니다. **런타임에서 로드되지
않습니다** — 참고·감사 목적으로만 보관합니다.

## 왜 여기로 옮겼는가 (2026-08-20)

GOV_TASK 후속심사 실행 공백(904개) 채우기 작업 중, `division-tables.js`의
`file:` 필드가 이 6개 과 중 일부에서 이미 존재하는 상위 버전이 아니라 v1.0을
계속 가리키고 있는 걸 발견했다(BUILDING은 심지어 존재하지 않는 v1.2를 가리켜
404 직전이었음). PR #466(서귀포 5개 과 v1.1/v1.2)·#467(제주시 도시건설국 6개
과 신설, 서귀포 포인터 동기화)·#471·#472를 거쳐 `division-tables.js`가 이제
전부 아래 최신 버전을 정확히 가리키도록 정정 완료했다. v1.0은 더 이상 어디서도
참조되지 않는 죽은 파일이라 v1.0/v1.1/v1.2/v1.3이 같은 디렉터리에 공존해
다음 세션이 최신 버전을 혼동하는 사고(오늘 실제로 발생)를 막기 위해 archive로
옮겼다.

| 과 | 대체됨(v1.0 → 정본) |
|---|---|
| 건축과(BUILDING) | v1.3 — 공리2(GOV_TASK 후속심사) 정합화, 법조문 명시 |
| 도시과(CITY) | v1.1 — 개발행위허가 근거(국토계획법) 추가 |
| 건설과(CONSTRUCT) | v1.1 |
| 안전총괄과(GENERAL) | v1.1 |
| 교통행정과(TRAFFIC) | v1.1 |
| 상하수도과(WATER) | v1.2 |

## 현재 정본을 찾으려면
- `prompts/gov-tree/04-city/divisions/SP-CITYDIV-SEOGWIPO-CONSTRUCTION-*_v1.x.md`
  (위 표의 버전)
- 라우팅 배선: `src/gopang/gov/division-tables.js`(`CITY_DIVISION_TABLE`)
- 자동 검증: `tools/check_stale_refs.py` — `gov-router.js`/`division-tables.js`의
  `file:` 필드를 CI에서 매번 스캔해 이런 불일치를 자동 탐지한다(2026-08-20 추가)

이 표는 2026-08-20 정리 시점의 스냅샷입니다. 최종 확인은 항상 위 정본 파일과
`division-tables.js`에서 직접 하십시오.
