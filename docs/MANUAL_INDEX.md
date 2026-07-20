# 혼디(Hondi) 문서 인덱스 v1.0 — 메타 매뉴얼

> **작성일**: 2026-07-19
> **목적**: `gopang` 저장소에 흩어진 모든 매뉴얼·가이드·설계문서가 각각 **어떤 분야를 다루는지, 누구를 위한 것인지, 지금도 유효한지**를 한눈에 보여줍니다. 새 문서를 어디에 써야 할지 헷갈리거나, 원하는 정보가 어느 문서에 있는지 찾기 어려울 때 이 문서부터 확인하세요.
> **이 문서 자체의 관리 원칙**: 새 매뉴얼을 추가하거나 기존 매뉴얼을 폐기할 때마다 이 표를 함께 갱신합니다. 이 표가 낡으면 전체 문서 체계가 다시 "뭐가 뭔지 모르는" 상태로 돌아갑니다.

---

## 어떻게 찾을지 모를 때 — 용도별 빠른 안내

| 내가 궁금한 것 | 볼 문서 |
|---|---|
| 혼디가 뭔지, 어떤 철학인지 (일반 소개) | `docs/혼디_완전매뉴얼_v1.0.docx` |
| 앱을 어떻게 쓰는지 (일반 사용자, PC) | `docs/hondi_user_manual.html` (활용·한계) + `docs/user-guide.html` (시작하기) |
| 앱을 어떻게 쓰는지 (모바일 웹앱 내장) | `user-manual.html`(루트) |
| worker.js의 특정 API가 뭘 하는지 | `docs/API_REFERENCE_worker_v1_0.md` |
| L1 PocketBase 컬렉션·배포·훅이 어떻게 동작하는지 | `docs/L1_POCKETBASE_MANUAL_v1_0.md` |
| PC에서 스마트폰과 같은 지갑으로 로그인하는 법(기기 간 지갑 이전) | `docs/DEVICE_LINK_MANUAL_v1_0.md` |
| K-서비스가 소유 전문가 페르소나·상담 이력을 어떻게 기록·총괄하는지(owner_pdv) | `docs/OWNER_PDV_GOVERNANCE_MANUAL_v1_0.md` |
| Supabase→L1 이관이 지금 어디까지 됐는지 | `docs/supabase_to_l1_migration_plan.md` |
| webapp.html의 설계 이력·SP 구조 | `docs/webapp_manual_v4.md` |
| 새 개발자가 코드베이스를 처음 파악할 때 | `docs/manual/01-system-map.md`부터 순서대로 |
| 콘솔 에러가 났을 때 | `docs/manual/04-debug-guide.md` |
| 새 플러그인(K-Law 분류기 등) 추가법 | `docs/plugin-guide.md` |
| 하위 시스템이 PDV 보고서를 어떻게 보내는지 | `docs/gopang-report-manual.md` |

---

## 전체 문서 목록 (분야·상태·대상 독자)

### 🧑‍💻 일반 사용자 대상
| 문서 | 분야 | 최종수정 | 상태 |
|---|---|---|---|
| `docs/hondi_user_manual.html` | 혼디 활용·한계 시나리오, PDV/AC 개념 설명 | 2026-07-16 | 🟢 최신 — desktop.html 좌측 사이드바에 링크됨 |
| `docs/user-guide.html` | 비개발자용 시작하기(가입→AI 활성화) | 2026-07-02 | 🟢 유효 — desktop.html "시작하기" 버튼에 링크됨 |
| `user-manual.html`(루트) | 모바일 웹앱 UI 조작법(스와이프 메뉴 등) | 2026-07-02 | 🟢 유효 — webapp.html iframe + sw.js 오프라인 캐시로 링크됨 |
| `docs/혼디_완전매뉴얼_v1.0.docx` | 혼디 비전·철학 개요(제1장~) | 2026-06-28 | 🟢 유효 |

### 🛠️ 개발자 온보딩
| 문서 | 분야 | 최종수정 | 상태 |
|---|---|---|---|
| `docs/manual/README.md` | 개발자 매뉴얼 6부작 인덱스 | 2026-05-22 | 🟡 저장소명 `gopang_v2`(구명) 정정 필요 |
| `docs/manual/01-system-map.md` | 시스템 구조 맵, Export 이름 일람 | 2026-05-22 | 🟡 저장소명 정정 필요, 그 외 유효 |
| `docs/manual/02-module-roles.md` | 모듈별 역할 | 2026-05-22 | 🟢 유효 |
| `docs/manual/03-event-flow.md` | 이벤트 흐름 | 2026-07-02 | 🟢 유효 |
| `docs/manual/04-debug-guide.md` | 오류 진단(콘솔 메시지별) | 2026-07-02 | 🟢 유효 |
| `docs/manual/05-bug-log.md` | 버그 이력(BUG-001~011) | 2026-07-02 | 🟡 오늘(2026-07-19) 발견된 버그 5건 미기록 |
| `docs/plugin-guide.md` | 새 플러그인(K-Law 분류기 등) 추가 절차 | 2026-05-22 | 🟢 유효 |

### 🔌 API·인프라 레퍼런스
| 문서 | 분야 | 최종수정 | 상태 |
|---|---|---|---|
| `docs/API_REFERENCE_worker_v1_0.md` | `worker.js` 145개 엔드포인트 레퍼런스(요약 전체 + 상세 30개) | 2026-07-19 | 🟢 신설 — 나머지 ~115개 상세화는 후속 작업 필요 |
| `docs/L1_POCKETBASE_MANUAL_v1_0.md` | L1 PocketBase 아키텍처·44개 컬렉션·`pb_hooks`·배포 절차 | 2026-07-19 | 🟢 신설 — Admin UI로 스키마 직접 검증은 아직 안 됨 |
| `docs/DEVICE_LINK_MANUAL_v1_0.md` | 기기 간 지갑 이전(PC 로그인)·웹푸시·고액거래 재인증(WebAuthn)·실사로 발견한 함정 11가지 | 2026-07-20 | 🟢 신설 — 실사 완료(실제 기기 테스트로 end-to-end 검증됨) |
| `docs/OWNER_PDV_GOVERNANCE_MANUAL_v1_0.md` | K-서비스·전문가 페르소나 거버넌스, 기관측 PDV(owner_pdv) 스키마·가명화 해시·C45/C39-5·SSOT 마이그레이션 현황 | 2026-07-20 | 🟢 신설 — 설계·구현 완료, 배포·실사용 테스트는 미완료(§11 체크리스트 참조) |
| `docs/POCKETBASE-STRUCTURE-GUIDE_v1_0.md` + `_v1_1_addendum` | L1~L5 서버 구조, Rule NULL/빈문자열 함정 등 실전 팁 | 2026-07-16 / 07-19 | 🟢 유효 — `L1_POCKETBASE_MANUAL`과 상호보완(겹치는 부분 있음, 통합은 후속 검토) |
| `docs/gopang-report-manual.md` | 하위 시스템 PDV 보고서(6하원칙) 스키마·전송 API | 2026년 5월(v1.0) | 🟢 유효 — **README.md에서 직접 링크됨** |
| `docs/webapp_manual_v4.md` | `webapp.html` 설계 명세(SP-00 v10.0, v4.0) | 2026-06-09 | 🟢 유효(v4.0 — v3.1의 상위호환) |
| `docs/supabase_to_l1_migration_plan.md` | Supabase→L1 이관 현황 트래커 | 2026-06-30(2026-07-19 갱신) | 🟡 진행중 — 2026-07-19 진행분 반영됨, 나머지 테이블 계속 갱신 필요 |
| `docs/SUBSYSTEM_REGISTRY_GUIDE.md` | 하위 시스템 등록 가이드 | 미확인 | ⚪ 이번 조사 범위 밖 |
| `docs/gopang-id-auth-guide.md` | 인증 SSO 구조 | 미확인 | ⚪ 이번 조사 범위 밖 |
| `docs/openhash-l1-l5-provisioning-guide.md` | L1~L5 프로비저닝 | 미확인 | ⚪ 이번 조사 범위 밖 |

### 📦 아카이브 (`docs/archive/`) — 폐기, 이력 보존용
| 문서 | 폐기 사유 |
|---|---|
| `gopang_db_manual_v2.md` / `gopang_db_manual_v2_0.html` | Supabase DB 매뉴얼(테이블 43개) — 인프라 자체가 더 이상 존재하지 않음. `L1_POCKETBASE_MANUAL_v1_0.md`가 후신 |
| `Gopang_Developer_Manual_v2.0.docx` | 표지에 Supabase 프로젝트 URL 하드코딩, 아키텍처 설명 자체가 낡음 |
| `GOPANG_MANUAL.md`(v5.1) | Supabase 9회 언급, 저장소명 `gopang_v2`(구명) — "핵심 원칙" 절만 `혼디_완전매뉴얼`에 이미 반영돼 있어 재활용 완료 |
| `webapp_manual.md`(v3.1) | `webapp_manual_v4.md`가 자기 변경이력에 "이전 버전"이라 명시 — 완전 삭제(archive 아님, 진짜 구버전) |

---

## 문서 작성 시 지켜야 할 최소 규칙 (2026-07-19부터 적용 제안)

1. **모든 새 매뉴얼 파일 맨 위에 이 배너를 넣습니다** (형식은 파일 타입에 맞게 조정):
   ```
   > 이 문서가 다루는 범위: [한 줄 요약]
   > 관련 문서: [MANUAL_INDEX.md](경로) 에서 전체 문서 지도 확인
   ```
2. **버전이 올라가면 구버전은 "폐기" 표시만 하고, 삭제는 이 인덱스에서 archive로 옮긴 뒤에만** 합니다.
3. **Supabase/gopang_v2처럼 아키텍처가 바뀌는 큰 변경이 있으면, 이 인덱스의 "최종수정" 컬럼을 갱신하는 걸 그 변경 작업의 완료 조건에 포함**합니다(오늘처럼 "코드는 바뀌었는데 문서 15개가 안 바뀐" 상태가 반복되지 않도록).
