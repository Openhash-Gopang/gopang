# prompts/archive/gov-tree-agent-common/ — 기관별 Agent Common 55개 보관

이 폴더는 `prompts/gov-tree/{02-do-dept,03-do-agency,04-city,05-emd,07-org}/agent-common/`
아래 있던 기관별 "Agent Common"(SP-XXX-AGENT-COMMON) 55개를 그대로 옮겨온
것입니다. **런타임에서 로드되지 않습니다** — 참고·감사 목적으로만 보관합니다.

## 왜 여기로 옮겼는가 (2026-08-02 SP-Tree 배선 감사)

이 파일들은 2026-07-13 하루에 일괄 작성된, 기관·부서 산하 과/팀으로의
라우팅을 LLM이 §3 COMPOSE 표를 읽고 직접 판단하게 하려던 설계였습니다.
실제로 코드베이스 전체를 grep한 결과 이 55개 파일을 시스템 프롬프트로
fetch하는 코드는 단 하나도 없었고, JEJU-DO-SP의 현재(v1.5) 공식 상속
체인에도 등장하지 않습니다. 기능별로 나눠 처분을 확정했습니다.

| 기능 | 처분 | 근거 |
|---|---|---|
| §1 정체성("당신은 OO를 대표하는 AI다") | 폐기(대체됨) | 상위 기관 SP 자체(예: `SP-ORG-JEA`)에 이미 더 풍부한 정체성 서술이 있음 — 중복 |
| §2 INTENT·§3 COMPOSE(산하 과/팀 라우팅) | 폐기(대체됨) | 2026-08-02 SP-Tree 감사에서 구축한 `DO_DEPT_DIVISION_TABLE`/`CITY_DIVISION_TABLE`/읍면동 팀 라우팅(키워드 매칭 + 동점 시 LLM 폴백)이 동일 기능을 대체 — `src/gopang/gov/gov-router.js`, `src/gopang/gov/division-tables.js` 참조 |
| §4 NOTICE·§5 REPORT·§6 PDV_RECORDING·§7 META_TABLING(태그 프로토콜) | **정본으로 통합 배선** | `AGY_NOTICE`/`AGY_REPORT`/`AGY_VAULT_STORE`/`META_TABLE_UPDATE` 태그는 `worker.js`의 `handleGovRelay`가 실제로 처리하는 살아있는 프로토콜이었으나, 이 55개 개별 파일에만 지시문이 있고 로드된 적이 없어 제주 기관에서는 한 번도 발행되지 않고 있었다. 개별 파일을 되살리는 대신, 정본 `prompts/AGENCY-AC-COMMON_v1.4.md`를 `_loadGovCommon()`(모든 기관 디스패치가 공유하는 접두사 조립 함수)에 fetch하도록 배선해 도청·실국·직속기관·출자기관·시청·읍면동 전 계층에 동시 적용했다 |

## 현재 정본을 찾으려면
- 산하 과/팀 라우팅 로직: `src/gopang/gov/gov-router.js`(`_matchDoDeptDivision`/`_matchCityDivision`/`_resolveEmdTeam` 등), `src/gopang/gov/division-tables.js`
- 태그 프로토콜 정의: `prompts/AGENCY-AC-COMMON_v1.4.md` (또는 그 이후 최신 버전 — `_loadGovCommon()`이 실제로 fetch하는 버전을 항상 최종 확인 기준으로 삼을 것)
- 기관 정체성·실사 정보: 각 기관의 본체 SP(예: `prompts/gov-tree/07-org/SP-ORG-JEA_v1.0.md`)

이 표는 2026-08-02 정리 시점의 스냅샷입니다. 자동 갱신되지 않으니, 최종
확인은 항상 위 정본 파일들에서 직접 하십시오.
