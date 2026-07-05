# Supabase → L1 PocketBase 이전 로드맵
(2026-06-30 작성 — "Supabase 의존을 줄이고 L1로 최대한 이전" 요청에 따른 현황 정리)

## 이번에 이미 옮긴 것

- `agent_internal_sp`(기관 그림자의 운영자 전용 system_prompt) — 신규 기능이라
  마이그레이션 리스크 없이 처음부터 L1 PocketBase로 작성함.
- `GET /profile/my-sp`의 TOFU pubkey 대조 — Supabase `user_profiles` 대신
  L1 `profiles`(`_l1FindProfileByGuid`)로 전환. 기존 설계 원칙
  ("X25519/Ed25519 등 보안 필드는 L1이 소스") 과 일관성을 맞춤.

## ⚠️ 전제와 한계 — 솔직히 밝힙니다

저는 운영 중인 L1 PocketBase 인스턴스의 실제 컬렉션 스키마를 직접 들여다볼
방법이 없습니다(Admin 콘솔 접근 불가). 위에서 `_l1FindProfileByGuid`가
반환하는 레코드에 `pubkey_ed25519` 필드가 있다고 가정하고 코드를 짰는데,
이건 `worker.js`의 다른 코드(`_l1FindProfileByGuid` 자체, `_l1AdminToken`
주석)에 근거한 추정이지 직접 확인한 사실은 아닙니다. **배포 전에 L1 Admin
UI에서 `profiles` 컬렉션 필드명을 한 번 확인해 주세요.** 다르면
`_l1FindProfileByGuid(env, guid)?.pubkey_ed25519` 부분의 필드명만
바꾸면 됩니다.

이런 이유로, 아래 나머지 테이블들은 **이번에 코드를 건드리지 않고
우선순위만 정리**했습니다 — 스키마를 모르는 상태에서 87곳에 달하는
Supabase 호출을 한 번에 바꾸면, 겉보기엔 그럴듯해도 실제로는 전부
조용히 실패하는 코드를 만들 위험이 더 큽니다.

## 테이블별 현황 (worker.js 기준, 호출 빈도순)

| 테이블 | 호출 수 | 이전 난이도 | 권장 우선순위 |
|---|---|---|---|
| `user_profiles` | 27 | 높음 — 본인/그림자 프로필의 핵심 원장. `extra`(JSON) 컬럼 전체를 L1 `profiles`가 이미 갖고 있는지부터 확인 필요(현재 `handleP2PRegister`가 L1에 쓰는 필드는 guid/handle/nickname 등 일부뿐 — `extra` 포함 여부 미확인) | L1 스키마 확인 후 진행. 가장 가치 크지만 가장 위험 |
| `pdv_log` | 10 | 중간 — PDV는 원래도 "본인만 보는 로컬 우선" 철학과 맞아서 L1 이전 명분이 강함 | 2순위 — `agent_internal_sp`와 비슷한 패턴(Admin 전용 컬렉션)으로 비교적 안전하게 이전 가능 |
| `webrtc_signals` | 7 | 낮음 — 이미 L1에 `webrtc_signals` 컬렉션이 존재함(코드에 `L1_SIGNAL_URL` 상수 있음). 실제로는 **이미 L1 우선이고 Supabase는 보조/폴백**일 가능성 — 코드 재확인 권장 | 빠른 확인만 하면 됨 |
| `biz_products` / `biz_reviews` | 5+4 | 중간 — K-Market 거래 데이터, 정합성 중요 | 3순위 |
| `webauthn_credentials` | 4 | 높음 — 인증 핵심 데이터, 잘못 옮기면 로그인 자체가 깨짐 | 보수적으로 — 충분한 테스트 환경 없이는 보류 권장 |
| `user_llm_keys` | 4 | 높음 — 사용자 API 키(민감정보) | 보류 권장 — 암호화 방식이 Supabase 컬럼 암호화에 묶여있을 가능성 |
| `push_subscriptions` | 4 | 낮음 | 이전 용이 |
| `pdv_consent_requests` | 3 | 중간 | PDV 계열과 함께 |
| `feedback` | 3 | 낮음 | 이전 용이 |
| `merkle_anchors` | 2 | 낮음(다만 OpenHash 무결성 증빙과 직결 — 신중히) | 검토 필요 |
| `svc_registry` | 1 | 낮음 | 이전 용이 |

## 2026-07-05 추가 결정 — PDV 선호 요약(preference-summary)은 클라이언트 사이드 중계로 확정

market의 상품/서비스 검색이 "나만의 AI비서"가 가진 PDV(나이·주소·성향·취향·
구매 이력)와 협업하도록 역할을 재정의하는 작업(같은 날짜, 별도 논의)에서,
처음에는 이 요약을 L1 PocketBase 훅으로 만들려 했으나(아래 취소선 처리된
초기 결정 참고), **실사 결과 전제 자체가 틀렸다는 게 확인됨**:

> ~~L1 PocketBase Admin에 `pdv_records`/`profiles` 컬렉션이 실재함을
> 확인했으나(hanlim 노드, `/opt/gopang/pb/hanlim/`), 이걸 preference-summary
> 소스로 쓰려던 계획~~ → **PDV 원본은 서버(L1도 Supabase도)에 없고
> 로컬(브라우저 IndexedDB `gopang_pdv_store`, `pdv-store.js`)에만 있다**는
> 것이 사용자 확인으로 밝혀짐. 서버의 `pdv_log`(Supabase)/`pdv_records`(L1)는
> 원본이 아니라 **접근 감사 로그의 요약/해시**(6하원칙 `summary_6w`, `risk_level`
> 등 이미 축약된 값)일 뿐이다 — `gopang_db_manual_v2.md` §3.4의 "PDV 6하원칙
> 감사 로그"라는 이름 자체가 이미 이 사실을 담고 있었는데, 처음 설계 시
> 놓쳤다.

**확정된 방향**: preference-summary는 서버 DB 조회가 아니라, **hondi.net
origin에서 실행되는 클라이언트 사이드 계산**이다 — `pdv-store.js`의
`GopangPDV.listByCategory()`로 이 기기의 로컬 IndexedDB를 읽어 카테고리
한정 요약 텍스트를 만들고, market이 iframe으로 여는 `auth/silent-pref.html`
(신설, `silent-sign.html`의 서명 없는 자매 페이지)을 통해 그 요약 문장만
postMessage로 넘긴다. 서버 쪽(Supabase/L1 어느 쪽도) 코드 변경이 필요 없다
— 이 항목은 애초에 "Supabase → L1 이전" 대상이 아니었다.

1. **L1 PocketBase Admin UI에서 현재 컬렉션 목록·스키마를 캡처해서 공유해
   주세요.** 이게 있어야 나머지를 안전하게 옮길 수 있습니다 — 특히
   `profiles` 컬렉션에 `extra`(JSON) 필드가 있는지가 가장 중요합니다.
2. `webrtc_signals`부터 확인 — 이미 L1 우선일 가능성이 높아 빠르게
   끝날 수 있는 항목입니다.
3. `pdv_log` + `pdv_consent_requests` — PDV 철학과 가장 잘 맞고,
   `agent_internal_sp`와 같은 패턴(Admin 전용 컬렉션 + `_l1AdminToken`)을
   재사용할 수 있어 다음으로 안전합니다.
4. `user_profiles`(가장 가치 크지만 가장 위험) — 스키마 확인 후 별도
   세션으로 진행 권장. `handleProfilePost`/`handleProfileGet`/
   `_createAgentForPrincipal`/`_mergeIndividualSP` 등 이번에 손댄
   함수들이 전부 여기 걸려있어, 회귀 테스트 없이 한 번에 바꾸는 건
   위험합니다.
5. `webauthn_credentials`, `user_llm_keys`는 인증·민감정보라 가장 마지막,
   혹은 테스트 환경이 갖춰진 뒤로 미루는 걸 권장합니다.
