# 2026-07-22 작업기록 — device-link 안정화, GWP 채팅 UI 공용화, 지갑 배포 구조 개편

하루 동안 진행된 작업을 나중에 참고할 수 있도록 정리한 매뉴얼입니다.
가장 큰 줄기 세 가지입니다: **(1) PC↔폰 device-link 로그인이 실제로
끝까지 되게 만들기**, **(2) K-서비스·전문가 AI·공공기관 등 GWP 채팅
탭들의 UI를 하나로 통합하기**, **(3) `gopang-wallet.js` 배포 구조를
"18곳에 매번 복사"에서 "허브 하나만 고치면 끝"으로 바꾸기**.

---

## 1. device-link(PC 로그인) — 겹겹이 쌓여있던 원인 4개

증상: 폰에서 "제주도청 불러 줘"를 실행하면 응답은 오지만 탭이 안
열리고, PC에서 폰으로 로그인 요청을 보내도 알림이 안 오거나, 승인해도
"Failed to fetch"로 끝났습니다. 하나씩 벗겨보니 서로 무관한 버그
4개가 겹쳐 있었습니다.

### 1-1. 모바일에서 GWP 탭 자체가 안 열림
`send-message.js`가 GPS 권한을 `window.open()`(GWP 새 탭 예약)보다
먼저 요청하고 있어서, 모바일 브라우저가 그 사이에 낀 네이티브 권한
다이얼로그를 이유로 팝업을 차단했습니다. GPS 요청을 `setTimeout(0)`로
한 틱 미뤄 해결했습니다. → `docs/MOBILE_GWP_POPUP_GEO_RACE_2026_07_22.md`

### 1-2. 등록 화면 "네트워크 오류"
`state.js`/`p2p-chat.js`가 폐기된 구 브랜드 도메인
`l1-hanlim.gopang.net`을 그대로 참조하고 있어 CORS가 막혀 있었습니다.
`l1-hanlim.hondi.net`으로 통일. → `docs/LEGACY_L1_DOMAIN_CORS_INCIDENT_2026_07_22.md`

### 1-3. "제주도청" 탭이 응답은 오는데 안 열림 — 진짜 원인
`gwp-registry.js`의 `SVC_ID_ALIAS`(모델이 `[GWP: jeju]`처럼 부정확한
id를 냈을 때 실제 서비스 id `kregionalgov`로 되돌리는 안전망)가, 같은
날 있었던 다른 커밋(jeju.hondi.net → hondi.net 오리진 이전 작업)에서
실수로 통째로 삭제돼 있었습니다. 별칭을 복원. →
`docs/JEJU_SVC_ID_ALIAS_REGRESSION_2026_07_22.md`

### 1-4. push 알림이 안 오거나(410) deliver가 매번 실패
- `requestPushSubscription()`을 부르는 두 경로(가입 직후 / 24시간
  자가치유)가 동시에 실행되며 구독을 서로 덮어써 죽은 구독이 저장되는
  경쟁 상태 → in-flight 락 추가.
- device-link `deliver` 단계가 `expirationTtl: 30`으로 KV에 쓰려다
  Cloudflare KV 최소값(60초) 미달로 **매번 100% 확정적으로** 실패 →
  60초로 수정. `wrangler tail`로 서버 로그를 직접 보고서야 "네트워크
  문제"가 아니라 서버 예외였다는 게 드러났습니다.
- → `docs/PUSH_SUBSCRIBE_RACE_CONDITION_2026_07_22.md`,
  `docs/DEVICELINK_KV_TTL_MINIMUM_2026_07_22.md`,
  `docs/STALE_VAPID_PUSH_SUBSCRIPTION_2026_07_22.md`

### 사용자 편의 기능 (부수적으로 추가)
- 설정 화면 "앱 관리" 섹션 맨 아래 **"푸시 알림 재구독"** 버튼
- URL에 `?resetpush=1`을 붙이면 24시간 쿨다운 없이 즉시 재구독 시도
  (콘솔이 없어도 화면 말풍선으로 결과 확인 가능)
- URL에 `?debug=1`을 붙이면 Eruda(모바일 인페이지 devtools)가 떠서,
  USB 디버깅 없이도 폰 화면에서 직접 콘솔을 볼 수 있음

### 재발한 버그 — 교훈
`gov-router.js`의 `guessProvinceCode` 중복 선언(ES 모듈 SyntaxError로
전체 스크립트가 죽는 버그)이 이 대화 안에서 **두 번** 발견됐습니다 —
한 번은 훨씬 이전 세션에서 이미 고쳤다고 기록됐는데, 그 수정이
`origin/main`에 push된 적이 없었습니다(`git log`에 해당 커밋 없음).
**"고쳤다"는 기록과 "실제로 저장소에 반영됐다"는 별개**라는 게 오늘
하루 여러 번 확인된 패턴입니다 — 배포 후 `git log`로 직접 확인하는
습관이 필요합니다.

---

## 2. GWP 채팅 탭 UI 공용화 — `chat-shell.css` / `chat-shell.js`

`pages/regional-gov.html`, `pages/expert-chat.html`,
`pages/profile-assistant.html` 3곳이 상단바·말풍선·입력창·
`escHtml`/`appendBubble`/`appendTyping`을 각자 처음부터 새로 만들고
있던 걸 발견하고 공용 모듈로 통합했습니다.

### 새 파일
- **`assets/chat-shell.css`** — 공용 레이아웃(상단바, 말풍선, 하단
  입력 독). 페이지별로 `--gov`/`--pri`/`--pri-bg` 색상 3개만
  `:root`에서 오버라이드하면 됨.
- **`src/gopang/ui/chat-shell.js`** — `escHtml`, `appendBubble`,
  `appendTyping`, `wireBackButton`, `wireInputBar`, `wireMic`,
  `wireAttachAndCamera`, `initChatShell` 등. **AI 호출 로직(스트리밍,
  태그 파싱, GWP_DONE 보고 등)은 이 모듈이 전혀 모릅니다** — 각
  페이지가 `onSubmit(text, imageDataUrl)` 콜백 안에서 직접 처리합니다.
  이미 검증된 페이지별 로직(특히 `expert-chat.html`의 오케스트레이션
  태그 처리)을 다시 쓰지 않고 보존하기 위한 의도적 설계입니다.

### 입력창은 "진짜" 메인 채팅창 것을 그대로 이식
처음엔 새로 만든 입력창 스타일을 공용화했는데, "메인 채팅창과 완전히
동일해야 한다"는 요구사항에 따라 `webapp.html`을 다시 뒤져보니 —
현재 화면엔 `#ai-panel-input-row`에 가려 안 보이지만, **정확히 이
용도로 이미 보존돼 있던 컴포넌트(`.input-dock`)**를 발견했습니다.
코드 주석에 "요소·JS는 그대로 두어 별도 탭 대화창에서 재사용할 수
있게 한다"고 명시돼 있었습니다. 이걸 그대로 이식해서, 입력창에 글자가
있으면 좌측 아이콘(첨부·카메라·마이크)이 접히며 입력창이 넓어지는
동작까지 메인 앱과 동일합니다.

### 신규 GWP 탭을 만들 때 (앞으로의 사용법)
```html
<link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css">
<link rel="stylesheet" href="/assets/chat-shell.css">
<style>:root{ --gov:#원하는색; --pri:#원하는색; --pri-bg:#연한배경색; }</style>
```
HTML 구조는 `src/gopang/ui/chat-shell.js` 파일 맨 위 주석에 그대로
붙여넣기 가능한 형태로 정리돼 있습니다. AI 호출부만 페이지가 직접
작성하고, `initChatShell({ returnUrl, onSubmit })`을 호출하면 나머지
(뒤로가기, 입력창, 첨부/카메라/마이크, 전송)는 전부 자동 배선됩니다.

### 시뮬레이션 중 발견한 실제 버그
마이크로 받아쓰는 도중 텍스트가 채워지면 "글자가 있으면 아이콘 숨김"
규칙 때문에 **마이크 정지 버튼 자체도 같이 숨겨져 끌 수 없는** 막다른
상황이 실제로 재현됐습니다. "마이크 활성 중엔 숨기지 않는다"는 예외를
추가하고, 이 시나리오를 그대로 재현하는 회귀 테스트(Playwright +
headless Chromium)를 남겼습니다. 코드 리뷰만으론 못 잡았을, 실제
브라우저로 클릭·타이핑까지 재현해야 잡히는 종류의 버그였습니다.
→ `docs/CHAT_SHELL_UNIFICATION_2026_07_22.md`

---

## 3. `gopang-wallet.js` 배포 구조 개편 — 18곳 사본에서 CDN 단일화로

`gopang-wallet.js`는 허브(gopang) 하나에서 관리되지만 실제로는 18개
위성 저장소(K-서비스별)에 파일 사본으로 흩어져 있었습니다. 이번에
`tools/check_wallet_sync.py`로 실측해보니 **18곳 전부 허브보다 9,133
바이트 뒤처져 있었고**, 빠진 부분은 하필 2026-07-21에 고친 지갑 보안
버그(`WALLET_DECRYPT_FAILED`를 "레코드 없음"과 구분 못 해 기존 지갑을
못 열면 조용히 새 지갑을 자동 생성해버리던 문제)의 수정분 전체였습니다.
"동기화 완료"로 기록됐던 커밋이 실제로는 그 파일을 반영하지 않았던
것으로 보입니다.

### 해결: jsdelivr CDN으로 단일 소스화
18개 위성 저장소, 42개 HTML 파일의 `<script src="...gopang-wallet.js">`
를 전부 `https://cdn.jsdelivr.net/gh/Openhash-Gopang/gopang@main/gopang-wallet.js`
하나로 통일했습니다(jeju/klaw/market은 시범 적용, 나머지 14곳 순차
적용, qna는 애초에 지갑을 안 써서 해당 없음). 지갑 코드는 각 페이지의
**자기 오리진**에서 실행되므로(스크립트 태그의 표준 동작), 도메인이
달라도 지갑 데이터가 섞이는 문제는 없습니다.

허브에 **`.github/workflows/purge-wallet-cdn.yml`**을 신설해,
`gopang-wallet.js`가 바뀔 때마다 jsdelivr 캐시를 자동으로
무효화합니다(안 하면 브랜치 참조 캐시가 최대 7일 갈 수 있음).

**앞으로 지갑 코드를 고칠 때는 `gopang` 허브의 `gopang-wallet.js`
하나만 수정하면 됩니다.** 위성 저장소 18곳을 다시 건드릴 일이
없습니다. 새 위성 저장소를 추가할 때만, 그 저장소의 `<script src>`를
처음부터 CDN URL로 작성하면 됩니다(로컬 사본을 만들 필요 없음).

### 남은 구조적 위험
`gopang-wallet.js` 외의 공용 파일(`webapp.html`, `worker.js`,
`gopang-app.js`, `gwp-registry.js`, `gopang-style.css`, `sw.js` 등)은
여전히 위성 저장소마다 사본으로 존재하고, 이번에 CDN화하지
않았습니다 — 브랜드 로고/서비스명 등 페이지별로 실제 달라야 하는
내용이 섞여 있어 이번 정리 범위 밖으로 뒀습니다. 이 파일들도 같은
드리프트 위험을 안고 있으므로, 필요 시 `tools/check_wallet_sync.py`
패턴을 확장해 정기 점검하는 것을 권합니다.

---

## 4. 오늘 만들어진 참고 문서 전체 목록

| 문서 | 내용 |
|---|---|
| `docs/MOBILE_GWP_POPUP_GEO_RACE_2026_07_22.md` | GPS 권한이 팝업을 가로채던 문제 |
| `docs/LEGACY_L1_DOMAIN_CORS_INCIDENT_2026_07_22.md` | 폐기된 구 도메인 CORS 문제 |
| `docs/STALE_VAPID_PUSH_SUBSCRIPTION_2026_07_22.md` | VAPID 키 교체 후 재구독 미검증 문제 |
| `docs/JEJU_SVC_ID_ALIAS_REGRESSION_2026_07_22.md` | GWP 탭 안 열리던 진짜 원인(별칭 삭제) |
| `docs/PUSH_SUBSCRIBE_RACE_CONDITION_2026_07_22.md` | 재가입 직후 push 구독 경쟁 상태 |
| `docs/DEVICELINK_KV_TTL_MINIMUM_2026_07_22.md` | KV TTL 30초 미만 확정적 실패 |
| `docs/CHAT_SHELL_UNIFICATION_2026_07_22.md` | GWP 채팅 탭 UI 공용화 상세 |
| 이 문서 | 오늘 전체 작업 총정리 매뉴얼 |

좌측 메뉴의 "⚠ 주의" 섹션에는 위 문서들이 개별 항목으로도 링크돼
있습니다 — 이 매뉴얼은 그걸 하나의 흐름으로 다시 정리한 것입니다.
