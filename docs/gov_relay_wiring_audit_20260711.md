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

## ★ 2026-07-11 후속 — school/stock 실제 수정 완료

재검토 결과 수정이 **필요했습니다**(단순 엔드포인트 교체보다 조금 더 손이 갔습니다).
`school_fix.diff`, `stock_fix.diff`로 제공합니다. 수정하면서 초안 자체에 있던 버그
2개를 미리 잡았습니다 — 그대로 적용했으면 오히려 서비스가 깨졌을 것입니다:

1. **`system` 필드 유실 문제**: `callDeepSeek`는 `messages`가 배열이면 주입 텍스트를
   `messages` 맨 앞에만 붙이고, 별도 `system` 최상위 필드는 건드리지 않습니다. K-School/
   K-Stock 고유 지시문을 `system` 필드로 보내면 실제 DeepSeek API가 그 필드를 아예
   안 읽어서 **조용히 유실**됩니다. → `sp`를 `messages` 배열 맨 앞 `system` role
   메시지로 옮겨서 해결(이미 정상 동작 중인 `market` 저장소와 동일 패턴 — 실사 대조 확인).
2. **응답 파싱 불일치**: `/ai/chat`(`handleAIChat`)은 응답을 `{content, provider, model}`로
   재가공해 주지만, `/deepseek`(`callDeepSeek`)는 재가공 없이 OpenAI 호환 원본
   (`{choices:[{message:{content}}], usage:{...}}`)을 그대로 돌려줍니다. 클라이언트가
   기존처럼 `d.content`를 읽으면 항상 `undefined`가 되어 매번 "잠시 후 다시 시도해
   주세요" 문구만 뜨게 됩니다 → `d.choices?.[0]?.message?.content`로 수정.

### 부작용 — 무료 한도 적용됨(의도된 변화)
`/ai/chat`은 `guid`/사용량 개념이 아예 없어 무료 한도 체크를 안 했습니다. `/deepseek`로
바꾸면 다른 서비스와 똑같이 `FREE_QUOTA_KRW_LIMIT` 적용을 받습니다 — 로그인 안 한
사용자는 `guid='anonymous'`로 잡혀 익명 사용자 전체가 같은 한도를 공유합니다. 이건
"고쳐서 생긴 부작용"이 아니라 다른 K서비스들과 동일한 정책으로 맞춰지는 것이라 의도된
변화로 봅니다 — 다만 배포 후 익명 트래픽이 많다면 한도 소진 민원이 생길 수 있어
모니터링 권장.

### ⚠ 실환경 라이브 검증 못 함
이번 세션의 네트워크 샌드박스가 `hondi-proxy.tensor-city.workers.dev`를 허용 도메인
목록에 안 갖고 있어 실제 배포 서버로 직접 요청을 못 보내봤습니다. `worker.js`의
`callDeepSeek` 실제 소스 대조로 정적 검증만 했습니다 — **배포 후 K-School/K-Stock
웹앱에서 실제 대화 1건씩 직접 확인 필요합니다.**

## jejudo 저장소 archive + 삭제

이 세션에 GitHub 쓰기 권한(토큰)이 없어 API로 직접 처리할 수 없습니다. 주피터님이
직접 하시는 방법:

**웹 UI**: `https://github.com/Openhash-Gopang/jejudo/settings` → 맨 아래
"Danger Zone" → "Archive this repository" 먼저 실행 → 확인 후 필요하면 같은 화면에서
"Delete this repository"로 삭제(archive는 되돌릴 수 있지만 delete는 되돌릴 수 없습니다
— archive만 하고 삭제는 몇 주 지켜본 뒤 해도 늦지 않습니다).

**GitHub CLI(`gh`)로 한 번에**:
```bash
gh api -X PATCH repos/Openhash-Gopang/jejudo -f archived=true
# 삭제까지 원하면(되돌릴 수 없음):
gh repo delete Openhash-Gopang/jejudo --yes
```


```bash
python3 tools/check_gov_relay_wiring.py
```
네트워크로 각 저장소를 얕은 클론해 임시 디렉터리에서 검사 후 자동 삭제합니다.
종료 코드 1은 "LEGACY 또는 NO_RELAY가 하나 이상 있다"는 뜻일 뿐, 위 표처럼 사람이
해석해야 진짜 결함(school/stock)과 정상 설계(market/gdc/security)를 구분할 수
있습니다 — CI에 그대로 게이트로 걸지 말고 참고 리포트로만 쓸 것을 권장합니다.
