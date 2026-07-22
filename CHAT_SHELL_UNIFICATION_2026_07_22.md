# GWP 채팅 탭 3곳이 입력창/레이아웃을 각자 새로 만들고 있던 문제 (2026-07-22)

`pages/regional-gov.html`, `pages/expert-chat.html`, `pages/profile-assistant.html`
3곳이 `:root`/`#top-bar`/`#input-bar`/`escHtml`/`appendBubble`/`appendTyping`을
처음부터 각자 새로 만들고 있었다는 걸 발견하고(regional-gov.html을 새로
만들면서 발견), 공용 모듈로 통합한 기록이다.

## 1. 발견 경위

`pages/regional-gov.html`(전국 지방행정 AI, jeju.hondi.net을 hondi.net
오리진으로 옮기며 새로 작성)에 첨부/카메라/마이크를 실제로 구현하고
나서, "이 레이아웃은 모든 새 탭(K-서비스, 전문가 AI 페르소나, 공공기관
등)이 공유해야 한다"는 지시에 따라 다른 페이지들을 확인해보니
`pages/expert-chat.html`, `pages/profile-assistant.html`도 거의 동일한
~90줄짜리 CSS와 UI 헬퍼 함수를 각자 복사해 갖고 있었다.

## 2. 공용화한 것

- `assets/chat-shell.css` — 상단바·말풍선·하단 입력 독 공용 스타일
- `src/gopang/ui/chat-shell.js` — `escHtml`, `appendBubble`, `appendTyping`,
  `wireBackButton`, `wireInputBar`, `wireAttachAndCamera`, `wireMic`,
  `initChatShell` 등 공용 유틸

**AI 호출 로직(스트리밍, 태그 파싱, GWP_DONE 보고, PDV 요청 등 페이지마다
완전히 다른 부분)은 공용 모듈이 전혀 모른다** — 페이지가 `onSubmit`
콜백 안에서 직접 처리한다. `expert-chat.html`의 이미 정교하게 구현돼
있던 첨부/마이크(무음 자동정지·자동전송 등)는 그대로 보존하고, 구조와
CSS만 통일했다.

## 3. 입력창을 "진짜" 메인 채팅창과 동일하게 — 중요한 재발견

처음엔 새로 만든 간단한 입력창 스타일을 공용화했는데, "메인 채팅창과
완전히 동일해야 한다"는 지시를 받고 `webapp.html`을 다시 확인하니,
**정확히 이 용도로 이미 준비돼 있던 컴포넌트**를 찾았다: `.input-dock`
(현재 화면엔 `#ai-panel-input-row`에 가려 `display:none`이지만, 코드
주석에 "요소·JS는 그대로 두어 별도 탭 대화창에서 재사용할 수 있게
한다"고 명시돼 있었음). 이걸 그대로 이식했다 — 입력창에 글자가 있으면
좌측 아이콘(첨부·카메라·마이크) 그룹이 `max-width`/`opacity` 트랜지션
으로 접히며 입력창이 넓어지는 동작까지 동일하다.

## 4. 시뮬레이션(Playwright + headless Chromium)으로 발견한 실제 버그

마이크로 받아쓰는 도중 텍스트가 입력창에 채워지면, "글자가 있으면
아이콘 숨김" 규칙 때문에 **마이크 정지 버튼 자체도 같이 숨겨져 끌 수
없는** 막다른 상황이 실제로 재현됐다. "마이크가 활성 상태인 동안은
아이콘 그룹을 숨기지 않는다"는 예외를 3개 페이지 전부에 추가하고,
이 시나리오를 그대로 재현하는 회귀 테스트를 남겼다.

## 5. 검증 결과

- regional-gov.html: 24/24 통과
- profile-assistant.html: 12개 중 11개 통과(나머지 1개는 헤드리스
  Chromium이 X25519 WebCrypto를 지원 안 해서 나는, 리팩터링과 무관한
  기존 이슈 — 원본 파일에도 동일하게 있었음을 대조 확인)
- expert-chat.html: 13/13 통과(기존 첨부/마이크 기능이 그대로 보존
  됐는지, 레이아웃 버그가 실제로 고쳐졌는지 클릭 가능 여부로 재확인)

## 6. 교훈

- 페이지를 새로 만들기 전에 "이미 비슷한 게 있는지"부터 확인하는 게
  빨랐을 것 — 이번엔 세 번째 복사본을 만들면서야 중복을 알아챘다.
- 화면에 안 보이는 코드라고 죽은 코드가 아니다 — `.input-dock`처럼
  "재사용을 위해 의도적으로 보존"된 컴포넌트가 있을 수 있으니, 지우기
  전에 주석을 읽는 습관이 여기서도 유효했다.
- 시뮬레이션(실제 헤드리스 브라우저로 클릭·타이핑까지 재현)이 아니면
  못 잡았을 버그(마이크 자기 자신을 숨기는 문제)가 있었다 — 코드
  리뷰만으로는 발견하기 어려운 종류의 상호작용 버그였다.
