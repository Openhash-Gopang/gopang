# 고팡 v2 — 개발자 매뉴얼 허브

> **이 문서가 다루는 범위**: 개발자 매뉴얼 6부작(01~05)의 인덱스 — 새 개발자 온보딩 시작점
> **전체 문서 지도**: [../MANUAL_INDEX.md](../MANUAL_INDEX.md)

> **최종 갱신:** 2026-05-22 · **버전:** v1.0 · **대상 repo:** `Openhash-Gopang/gopang`

이 디렉토리는 gopang의 **시스템 이해 → 오류 추적 → 수정**을 위한 단일 참조 허브입니다.  
새 오류가 발생하면 이 문서들을 열고, Claude에게 해당 파일을 첨부해 질문하세요.

---

## 📂 매뉴얼 구성

| 파일 | 내용 | 언제 읽나 |
|------|------|---------|
| **[01-system-map.md](./01-system-map.md)** | 전체 파일 구조 + 의존성 방향 + export 이름 일람 | 오류 발생 시 먼저 열기 |
| **[02-module-roles.md](./02-module-roles.md)** | 각 모듈의 역할·핵심 함수·인터페이스 계약 | 특정 모듈 수정 전 |
| **[03-event-flow.md](./03-event-flow.md)** | 이벤트 흐름도 + EVENTS 키 전체 목록 | 이벤트 미수신·중복 발행 오류 |
| **[04-debug-guide.md](./04-debug-guide.md)** | 오류 유형별 진단 트리 + 실제 버그 사례 | 오류 메시지 보고 즉시 |
| **[05-bug-log.md](./05-bug-log.md)** | BUG-001~011 전체 이력 + 패턴 분석 | 유사 오류 재발 시 |

---

## ⚡ 빠른 진단 (오류 발생 시 30초 체크)

```
오류 메시지 유형 → 해당 매뉴얼

SyntaxError: does not provide an export  →  01-system-map.md  §2 export 이름 일람
TypeError: X is not a function           →  02-module-roles.md §해당 모듈
이벤트 핸들러 미호출                      →  03-event-flow.md  §EVENTS 키 목록
부트스트랩 중간 멈춤                      →  04-debug-guide.md §부트 순서 체크
```

---

## 🤖 Claude에게 질문하는 법

오류 발생 시 **이 3가지를 함께** 첨부하세요:

1. `docs/manual/01-system-map.md` — 구조 컨텍스트
2. `docs/manual/04-debug-guide.md` — 오류 유형 힌트
3. **Console 오류 메시지 스크린샷 또는 텍스트**

그러면 Claude가 파일을 직접 fetch하지 않아도 정확히 진단할 수 있습니다.
