# /gov/relay 배선 전수 점검 결과 (2026-07-11)

`tools/check_gov_relay_wiring.py` 실행 결과(17개 저장소, `openhash-L*`/`.github`/`gopang`/
`gopang-test`/`users`/`qna`는 이번 점검 범위 밖)를 실제 코드로 재확인·해석한 기록입니다.
스크립트의 자동 판정(OK/LEGACY/NO_RELAY/EMPTY)은 1차 스크리닝일 뿐이며, 아래처럼
사람이 맥락을 확인해야 정확한 결론이 나옵니다 — 스크립트 출력 그대로를 결함 목록으로
쓰면 안 됩니다(특히 NO_RELAY는 대부분 정상 설계).

## 결론 요약

| 저장소 | 자동판정 | 실제 상태 | 조치 필요 |
|---|---|---|---|
| tax/health/public/jeju/insurance/democracy/police/911/logistics | OK | 정상 — `/gov/relay` + BYOK | 없음 |
| market/gdc/security | NO_RELAY | **정상(설계상 당연)** — `GOV_AGENCIES` 소속이 아닌 서비스라 `/deepseek` 직접 호출이 맞는 구조 | 없음 |
| **school(kedu)** | LEGACY | **실제 결함** — `/ai/chat`(순수 패스스루) 호출, 서버측 강제 주입 전혀 안 됨 | ★ 필요 |
| **stock(kfinance)** | LEGACY | **실제 결함** — school과 동일 패턴 | ★ 필요 |
| traffic | LEGACY(desktop.html만) | webapp.html(시민용)은 정상 `/gov/relay`. `desktop.html`(내부 관리자 도구)만 `/ai/chat` 직접 호출 | 우선순위 낮음 |
| klaw | LEGACY(benchmark.html만) | 프로덕션 `webapp.html`은 전용 `/klaw/relay` 사용(정상 추정). `benchmark.html`(공개 판결예측 데모)만 `/ai/chat` 직접 호출 | 우선순위 낮음 |
| jejudo | EMPTY | `LICENSE` 파일만 있는 빈 저장소 | 정리 대상(삭제/archive 여부는 주피터님 판단) |

## ★ 핵심 결함 — school(kedu), stock(kfinance)

`worker.js`의 `UNIVERSAL_FORCED_K_SERVICES` 집합(3952행)에 `'kedu'`, `'kfinance'`가
**이미 등록돼 있습니다** — 즉 이 두 서비스는 `/deepseek` 엔드포인트(`callDeepSeek`)로
`service_id: 'kedu'` 또는 `'kfinance'`를 실어 보내기만 하면 서버가 UNIVERSAL-INTEGRITY +
UNIVERSAL-common을 자동으로 강제 주입해 줍니다. 그런데 `school`/`stock` 저장소의
`webapp.html`은 이 메커니즘이 있는 `/deepseek`가 아니라 **아무 강제 주입도 없는
`/ai/chat`(`handleAIChat`)을 직접 호출**하고 있어, 이미 서버에 구현된 안전장치의
혜택을 전혀 못 받고 있습니다 — "설계는 있는데 배선이 안 된" 전형적인 사례(인수인계
문서가 `gwp_registry.call_count_30d` 계측 부재를 이 표현으로 부른 것과 같은 유형).

### 권고 조치
`school/webapp.html`과 `stock/webapp.html`의 API 호출부(각각 404행, 428행 부근)를
```js
fetch(`${PROXY}/ai/chat`, { body: JSON.stringify({ provider:'deepseek', model:'deepseek-chat', system:sp, messages, max_tokens:2000 }) })
```
에서
```js
fetch(`${PROXY}/deepseek`, { body: JSON.stringify({ model:'deepseek-chat', service_id:'kedu', system:sp, messages, max_tokens:2000 }) })
```
(stock은 `service_id:'kfinance'`)로 교체 — `callDeepSeek`가 `service_id`를 보고
`UNIVERSAL_FORCED_K_SERVICES`에 있으면 자동으로 공통 규칙을 최상단에 붙입니다.
**단, 이건 school/stock 저장소 자체를 수정해야 하는 작업이라 이번 세션(gopang
모노레포) 범위 밖입니다 — 다음 세션에서 해당 저장소를 별도로 열어 처리 필요.**

## 낮은 우선순위 항목

- `traffic/desktop.html`, `klaw/benchmark.html`은 시민이 직접 쓰는 메인 서비스가
  아니라 내부 관리자 도구/공개 데모 기능이라 상대적으로 리스크가 낮습니다. 그래도
  같은 패턴(강제 주입 우회)이므로 여유 있을 때 함께 정리 권장.

## 스크립트 사용법

```bash
python3 tools/check_gov_relay_wiring.py
```
네트워크로 각 저장소를 얕은 클론해 임시 디렉터리에서 검사 후 자동 삭제합니다.
종료 코드 1은 "LEGACY 또는 NO_RELAY가 하나 이상 있다"는 뜻일 뿐, 위 표처럼 사람이
해석해야 진짜 결함(school/stock)과 정상 설계(market/gdc/security)를 구분할 수
있습니다 — CI에 그대로 게이트로 걸지 말고 참고 리포트로만 쓸 것을 권장합니다.
