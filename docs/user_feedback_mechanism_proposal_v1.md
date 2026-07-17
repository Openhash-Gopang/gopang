# 사용자 개선 제안 획득·반영 메커니즘 — 설계 제안 v1.0
**작성** Claude | 2026-07-17

## 0. 현재 상태 확인

코드 전체를 뒤져봤는데 "사용자가 혼디 시스템 자체에 대해 낸 개선
제안"을 잡아내는 경로가 **전혀 없다.** `RULE-03`(자기 갱신 제안)이
있지만 이건 SP가 자기 지침의 한계를 스스로 눈치챘을 때만 발동한다 —
사용자가 "이거 좀 불편하네", "이런 기능 있으면 좋겠다"라고 말해도
그 발화는 그냥 대화로 흘러가고 끝난다.

## 1. 설계 원칙 — RULE-03과 통합, 별도 시스템 안 만듦

두 창구(SP 자기반성 / 사용자 제안)를 따로 만들면 주피터님이 검토할
곳이 두 군데로 늘어난다. 대신 **같은 `sp_update_proposals` 컬렉션에
`source` 필드만 추가**해서 한 곳에서 같이 본다 — RULE-03이 이미
`status=pending_review`로 쌓고 사람이 직접 검토·승인하는 흐름을 그대로
재사용한다(자동 반영 없음 원칙도 동일하게 적용).

```
sp_update_proposals {
  ...(기존 필드 그대로)
  source: "sp_self_reflection" | "user_feedback"   ← 신설
  user_guid: (source=user_feedback일 때만, 익명 가능)
  raw_quote: (source=user_feedback일 때만, 사용자 발화 원문 — 지어내지 않고 그대로)
}
```

## 2. 능동 획득 — 어디서, 언제 묻는가

**어디서**: AGENT-COMMON(모든 대화의 진입점)에 경량 신호 하나만
추가한다. 사용자 발화가 **자기 사건이 아니라 혼디 시스템 자체**를
향한 게 뚜렷하면(예: "이거 왜 이렇게 오래 걸려", "이런 것도 되면
좋겠다", "이 부분 헷갈려") `[USER_FEEDBACK: raw="...", context_sp={그
순간 활성 SP}]`를 내고, **원래 하려던 처리는 막지 않는다**(RULE-03과
동일한 "사이드이펙트일 뿐" 원칙).

**언제 능동적으로 묻는가**: 과유불급이 제일 중요하다. 아래 원칙만
지킨다:
- 작업이 자연스럽게 끝나는 지점(K-Report의 `ORCHESTRATION_COMPLETE`,
  PA의 `PROFILE_SUBMIT` 직후)에서만 묻는다 — 작업 중간에 끼어들지
  않는다.
- **빈도 제한**: 같은 사용자에게 최근 N일 이내 이미 물어봤으면 다시
  안 묻는다(PDV에 `last_feedback_prompted_at` 한 줄만 기록하면 됨).
  N은 실제 사용 패턴 보고 정하는 게 맞아 지금 숫자로 못박지 않는다.
- **거절을 존중**: "혹시 불편한 거나 있었으면 하는 기능 있으세요?
  (없으면 그냥 넘어가셔도 돼요)" 한 번만 묻고, 대답이 없거나
  "괜찮아요"류면 그걸로 끝 — 다시 캐묻지 않는다.

## 3. 저장 — 새 PocketBase 컬렉션 `user_feedback`

`sp_update_proposals`는 "SP 텍스트를 어떻게 고칠지"에 특화된 스키마라
사용자 발화 원문·문맥까지 다 담기엔 안 맞는다. 원문은 별도
컬렉션(`user_feedback`)에 전부 보존하고, 그중 명확히 특정 SP 하나로
귀결되는 것만 `sp_update_proposals`에 `source=user_feedback`로
브릿지한다(모든 피드백이 다 SP 수정 제안으로 이어지는 건 아니다 —
"화면이 이쁘면 좋겠다" 같은 건 브릿지 안 함).

```
user_feedback {
  guid,            // 익명 가능
  raw_text,        // 사용자 발화 원문 그대로
  context_sp,      // 그 순간 활성 SP(AC/PA/K-Intent 등)
  context_summary, // 무슨 상황이었는지 한두 문장(포착한 SP가 채움)
  category,        // bug|feature_request|complaint|praise|question — 포착 시점 LLM 판단, 나중에 사람이 재분류 가능
  status,          // new|clustered|bridged|done|rejected|duplicate
  created_at
}
```

## 4. 주기적 취합 — `tools/triage_feedback.py` (신설 제안)

`renew_identity_templates.py`와 같은 자리(배치 도구)에 신설한다.
**이번 세션에 이미 만든 임베딩 인프라(bge-m3 + Vectorize, benefit-
semantic-search용)를 그대로 재사용**한다 — 새 NLP 파이프라인을 또
만들지 않는다:

1. `status=new`인 피드백 전부를 bge-m3로 임베딩
2. 유사도로 클러스터링 — "N명이 비슷한 요청을 했다"를 자동으로 뽑아냄
3. 사람이 읽을 요약 리포트 생성(클러스터별 대표 인용 몇 개 + 빈도)
4. 클러스터가 명확히 특정 SP 행동으로 귀결되면 `sp_update_proposals`에
   `source=user_feedback`로 초안만 올림(RULE-03과 동일하게 **자동
   승인 없음** — 초안일 뿐, 사람이 검토해야 다음 버전에 반영)

## 5. (2단계, 지금은 안 함) 반영 후 알림

나중에 그 제안이 실제로 반영되면, 다음에 그 사용자가 돌아왔을 때
"말씀하신 기능 반영했어요"라고 알려주는 것도 좋아 보이는데, 이건
`user_feedback.guid` ↔ 실제 배포 버전을 추적하는 별도 장치가 필요해
지금 범위엔 안 넣었다 — 1~4번이 자리 잡은 뒤에 볼 문제로 남긴다.

## 6. 확인하고 싶은 것

1~4번을 실제로 구현해도 될까요? 다만 **AGENT-COMMON은 공용 진입점이라
저 혼자 판단으로 건드리기보다 확인부터 구하는 게 맞다고 봐서** 여쭙는
겁니다 — `[USER_FEEDBACK: ...]` 신호 추가가 AC 쪽 몫이라면, 제가 설계
문서만 이대로 넘겨드리고 실제 AC 수정은 그쪽에서 하는 게 나을지, 아니면
이 참에 제가 바로 작성해서 검토받는 게 나을지도 같이 알려주시면
좋겠습니다. `user_feedback` 컬렉션·`triage_feedback.py`는 제 작업
영역(PA/RENEWALING과 같은 성격)이라 확인만 주시면 바로 만들겠습니다.
