# AC 직종별 self 갱신 메커니즘 사고실험 v2.4 (A·B·C·D 해결)

> **작성일:** 2026-07-14 | **근거:** 주피터님 지시("다양한 직종을
> 상정하여 사고실험") — `AC_SELF_EVOLUTION_THOUGHT_EXPERIMENT_v1_0.md`
> (job_ksco/affiliation을 대화 컨텍스트에 연결한 v1.1 patch) 이후
> 실제 코드를 12개 직종 시나리오로 재추적. **v2.1: "C부터 시작"
> 지시로 구멍 C를 patch — `POST /gov/dept-task/my-assignments`
> 신설. v2.2: "A부터 순차적으로" 지시로 구멍 A를 patch — §0-1-R에
> "직업:"이 자기신고일 뿐이라는 명시 + `SP_common_guardrails` C30
> (user_tier 인증계층)과 혼동되지 않도록 교차참조 추가.**
> **신뢰도:** B급(추론) — 코드는 직접 읽어 확인했지만 실행 로그
> 재구성은 아니다. 단 각 항목은 구체적인 파일·라인 근거를 남긴다.

## 요약 — 7개 구멍 발견, 2개 해결(A·C)

| # | 구멍 | 심각도 | 상태 |
|---|---|---|---|
| A | job_ksco에 검증 절차가 없다 — 누구나 자기 직업을 자칭하면 그대로 사실처럼 취급된다 | 중간 | **해결(2026-07-14)** |
| B | 사업자(entity_type=business)는 job_ksco를 아예 가질 수 없다 — AC-AUTHOR §3-2 "병존" 시나리오가 코드에서 막혀 있다 | 구조적 | **해결(2026-07-14)** |
| C | STAFF_TASK_QUEUE에 배정된 작업을 개인 AC가 실제로 확인하지 않는다 | 구조적 | **해결(2026-07-14)** |
| D | `work_domain.status`(학생·은퇴자·무직 등)가 코드에 전혀 구현되지 않았다 | 구조적 | **해결(2026-07-14)** |
| E | `job_ksco.review_due`가 있지만 아무 코드도 읽지 않는다(만료가 전혀 체크되지 않음) | 경미 | 미해결 |
| F | `AGENCY_PUBKEY_REGISTRY`가 비어 있어, 이 논의의 출발점이었던 "위생과 직원" 시나리오 자체가 지금 실제로는 작동 못 한다 | 확인(기지) | 저장소 밖 |
| G | 민감 직종(AC-AUTHOR §6) `job_ksco.visibility='private'`가 `GET /profile`의 field_visibility 필터에서 실제로 존중되는지 미확인 | 확인 필요 | 미해결 |

## C 해결 내역

`POST /gov/dept-task/my-assignments`(worker.js 신설) — 본인 서명
(기존 `handleStatsSelf`와 동일한 Ed25519 TOFU 체계) 인증 후, (1)
`target_type='staff', target_id=나`로 직접 지목된 게시물과 (2) 내가
검증된 소속인 부서의 `org_staff_pool` 게시물을 모두 조회한다.

`call-ai.js`의 `_loadOwnJobContext()`가 검증된 소속이 하나라도 있을
때만(불필요한 요청 절약) 이 엔드포인트를 불러
`window.__hondiOwnProfileCache.pending_assignments`를 채우고,
`_buildEnhancedUserContent()`가 `[ctx]`에 "배정된업무(N건):..."로
반영한다. AGENT-COMMON §0-1-R에 이 필드를 자연스럽게(대화 흐름과
무관하게 끼워 넣지 않고) 안내하는 지시를 추가했다 — SG3 원칙(초안
까지만 대행)이 여기도 그대로 적용된다는 점도 명시했다.

**여전히 남은 한계**: F(AGENCY_PUBKEY_REGISTRY가 비어 있음)가 풀리기
전까지는 애초에 verified affiliation 자체가 생길 수 없으므로, 이번
patch로 배선한 경로는 "F가 풀리면 바로 작동하는 상태"로 대기 중이다
— 지금 당장 실사용자에게 눈에 보이는 변화는 없다(F가 이 저장소 밖
과제이기 때문).



## 시나리오별 추적

### 1. 내과 의사 — A(검증 부재) 발견 → 해결(2026-07-14)

온보딩에서 "저 내과 의사예요"라고 답하면 job_ksco=24111("내과 전문
의사")이 저장되고, 다음 세션부터 `[ctx]`에 "직업:내과 전문 의사"가
실린다. **문제**: 이 정보는 자기 신고 그대로다 — `affiliation`처럼
기관장 서명으로 검증하는 절차(`approveAffiliationCore`)가 job_ksco엔
없다. AGENT-COMMON §0-1-R은 "그 직종에 맞는 배경지식을 우선 참고"
하라고 지시하는데, 이게 의료 질문에서 **AI가 상대를 전문가로
전제하고 가드레일을 은연중 낮추는 방향으로 작동할 위험**이 있다 —
실제로는 의사가 아닌 사람이 "저 의사예요"라고만 하면 된다. 검증
안 된 자기신고를 "배경지식 참고"에 쓰는 것과 "안전 판단 기준을
바꾸는 것"은 다른데, 이 경계가 §0-1-R에 명시돼 있지 않다.

**→ 해결**: patch하며 확인해보니, 정확히 이 위험을 이미
`SP_common_guardrails` C30(사용자 계층 L0~L3)이 fail-safe로 막아뒀다
— "자기 선언은 신호일 뿐 인증이 아니다, 인증 연동이 안 됐으면
`user_tier`는 항상 L0". AGENT-COMMON §0-1-R에 "직업:" 필드가
`user_tier`가 아니고 이걸 설정하지도 않는다는 명시적 교차참조를
추가했고, `SP_common_guardrails_v3_5.md` C30-2에도 역참조를
남겼다(양방향 문서 정합). "배경지식 참고"(용어 수준 맞추기)와
"안전기준 완화"는 구조적으로 분리된 채 유지된다.

### 2. 변호사 — 대체로 정상

기존 EXPERT 페르소나와 §0-1-R이 서로 다른 층위(전문 라우팅 vs 배경
지식 참고)로 공존한다는 AC-EVOLUTION §6-9(#20 patch) 설계가 그대로
적용된다. 새 구멍 없음.

### 3. 카페 사장 겸 바리스타 — B(구조적 결함) 발견 → 해결(2026-07-14)

`worker.js:8510`을 확인하면 `if (entity_type === 'person' && job_ksco
...)`로 **job_ksco 처리 전체가 `entity_type==='person'`일 때만
동작한다.** AC-AUTHOR §3-2는 "한 사람이 사업자이면서 동시에 직업
정체성을 가질 수 있다(카페 사장이자 바리스타) — job_ksco와
occupation(KSIC)이 독립적으로 병존"이라고 설계했지만, **실제
코드에서는 `entity_type='business'`로 등록한 사람은 job_ksco 자체를
저장할 방법이 없다.** 문서와 구현이 어긋난 사례 — 설계는 있는데
배선이 안 된 또 다른 경우다. 더 흥미로운 건, `personal-assistant`
SP 자체도 이 예시("카페 사장이면서 본인이 바리스타이기도 한 경우")를
들면서 정작 발동 조건은 person으로만 제한해둔 **자체 모순**이
있었다는 것 — 프롬프트 문서 안에서도 설계와 조건문이 어긋나 있었다.

**→ 해결**: `worker.js`의 게이트를 `(entity_type==='person' ||
entity_type==='business')`로 확대, `personal-assistant-v1_12.txt`
[P1-INFER]의 person 제한 문구도 제거했다. 이제 사업자로 등록한
사람도 대화 중 "저도 직접 바리스타로 일해요" 같은 발화에서 job_ksco
가 정상적으로 추정·저장된다.

### 4~5. IT 개발자·초등교사 — 검증 안 된 채로 "될 것"

§0-1-R의 "검색이 필요하면 그 직종 맥락을 검색어에 포함"은 프롬프트
지시일 뿐 별도 코드 배선이 필요 없다(LLM이 지시를 따르면 자연히
동작). 이 부분은 실행해봐야 확실하지만, 최소한 데이터가 `[ctx]`에
도달하는 경로 자체는 살아있다(v1.1 patch 덕분) — 1·4번 구멍과 달리
여기는 "도달은 하는데 잘 쓰는지는 모른다"는 정도.

### 6. 제주시청 위생과 직원 — F(기지 사실 재확인) + C(신규 구멍)

이 시나리오가 전체 논의의 출발점이었다. 다시 추적한 결과:
- `AGENCY_PUBKEY_REGISTRY`가 **비어 있다**(`ACCESS_CERT_v1_0.md` §2에
  이미 명시 — 의도된 안전한 기본값이지만, 즉 **지금 이 순간 어떤
  직원도 `verified:true`가 될 수 없다.** 소속 승인 자체가 막혀
  있으니 STAFF_TASK_QUEUE·업무영역 PDV 요청 전부 실질적으로 비활성
  상태다. (기존에 이미 안 사실을 재확인한 것 — 신규 발견 아님.)
- **발견(C) → 2026-07-14 해결**: 설령 `verified:true`가 되고 부서가
  `target_type='staff'`로 작업을 게시해도, 그 직원의 **개인 AC(평소
  쓰는 채팅)는 그 작업이 배정됐다는 사실 자체를 확인하지 않았다.**
  `_loadOwnJobContext()`(call-ai.js)는 job_ksco/affiliation만 가져올
  뿐, "나에게 배정된 dept_task가 있는가"는 조회하지 않았다.
  AGENT-COMMON §0-1-Q가 "승인대기 안내" 톤은 정의해뒀지만, 애초에
  그 안내를 트리거할 데이터를 가져오는 코드가 없었다.
  **→ `POST /gov/dept-task/my-assignments` 신설로 해결(§요약 참고)**
  — 다만 F(레지스트리 공백)가 안 풀리면 실사용자 눈엔 아직 안 보인다.

### 7. 판사/검사 — G(확인 필요) 발견

job_ksco의 `visibility` 기본값은 always `'private'`이지만
(`worker.js` 구현 확인됨), 이게 `GET /profile`의 `_filterProfileByVisibility`
(field_visibility 시스템)와 실제로 맞물려 타인 조회 시 걸러지는지는
이번 사고실험에서 코드까지 다 확인하지 못했다 — job_ksco는
`extra.public.identity` 안에 있는 **커스텀 중첩 필드**라, 범용
field_visibility 룰이 이 안쪽까지 들여다보는지 별도 검증이 필요하다.

### 8~9. 학생·은퇴자 — D(구조적 결함) 발견 → 해결(2026-07-14)

AC-EVOLUTION §1이 `work_domain.status`("employed_public"|
"employed_private"|"self_employed"|"student"|"retired"|"homemaker"|
"unemployed"|"other")를 KSCO로 커버 안 되는 사람들을 위해 설계했는데,
**`worker.js`/`call-ai.js`/AGENT-COMMON 어디에도 `work_domain`이라는
문자열 자체가 존재하지 않는다.** 즉 학생이 "저 학생이에요"라고
말해도 그게 KSCO 매칭이 안 되니(§0의 "KSCO는 학생을 분류하지 않는다"
원칙 그대로) job_ksco도 안 채워지고, work_domain도 없으니 **아무
데도 안 남는다.** "학습이 업무다"는 설계 문서 안에만 존재한다.

**→ 해결**: `worker.js`에 work_domain 검증 로직 신설(고정 enum,
`status_since` 자동관리 — 같은 status를 재제출해도 날짜가 안 밀림),
`personal-assistant` SP [P1-INFER]에 추정 규칙 추가, `call-ai.js`가
`[ctx]`에 "업무상태:학생"/"업무상태:은퇴(비활성)" 식으로 반영,
AGENT-COMMON §0-1-R에 활용 지시 추가(은퇴자는 "요즘 회사 어떠세요"
같은 질문을 안 하되 과거 경력은 배경지식으로 참고 가능하다는 구분도
명시). job_ksco와 독립적으로 병존 — 재직 중인 사람은 job_ksco만으로
충분해 work_domain을 굳이 안 채워도 된다.

### 10. 프리랜서 디자이너 — 대체로 4·5번과 동일

### 11. 경찰관 — 확인 필요(taxonomy 상태 불명확)

`GOV_AGENCIES`(coarse)에는 'police'가 있지만, `DEPT_TASK_TAXONOMY`
(dept 세부단위)에 경찰 계열 부서가 실제로 등록돼 있는지는 이번
사고실험에서 다 확인 못 했다 — AC-AUTHOR §6이 이미 민감 직종으로
지정한 건 확실하니, L2(소속) 활성화 여부와 무관하게 job_ksco 자체는
`visibility='private'`로 보호된다(단 G번 구멍 참고).

### 12. 군인 — 기존 결론 유지

E번(review_due 미체크)과 별개로, A0 taxonomy 부재(#16)는 여전히
유효 — 새 발견 없음.

## E — job_ksco 자체 만료 체크 부재 (전 직종 공통)

`affiliation`은 `_isAffiliationCurrentlyVerified()`로 `review_due`가
지나면 "미검증" 취급하는 헬퍼가 있는데, **`job_ksco.review_due`는
필드만 있고 그걸 읽어서 "오래된 정보"로 처리하는 코드가 어디에도
없다.** AC-AUTHOR §7이 "재확인 주기"로 설계한 부분이 실제로는
죽은 필드다 — 이직한 지 3년 된 사람이 여전히 옛 직업으로 `[ctx]`에
표시될 수 있다.

## 다음 단계 제안 (우선순위, 구현 안 함)

1. **F(AGENCY_PUBKEY_REGISTRY)**: 이건 이 저장소가 못 푸는 문제 —
   실제 기관 협의 필요, 후속 과제로 계속 열어둠.
2. **C(배정 알림 미연결)**: `_loadOwnJobContext()`에 "나에게 배정된
   `staff`/`org_staff_pool` dept_task 확인"을 추가하면 됨 — 비교적
   작은 patch.
3. **B(사업자 job_ksco 병존 불가)**: `entity_type==='person'` 게이트를
   풀고 business에도 job_ksco 저장을 허용하는 코드 수정.
4. **D(work_domain 미구현)**: 새 필드 + handleProfilePost 처리 로직
   신설 — AC-AUTHOR §3-2급 작업.
5. **A(job_ksco 무검증)**: §0-1-R에 "이 정보는 자기신고이지 검증된
   사실이 아니다"를 명시하는 문구 보강(코드 변경 없이 프롬프트만
   수정 가능) — 가장 저렴한 patch.
6. **E(review_due 미체크)**: `_isJobKscoCurrentlyValid()` 헬퍼 신설,
   affiliation과 동일 패턴.
7. **G(visibility 필터 확인)**: 코드 재검토만 필요, 구멍이 실제로
   있는지부터 확인.

---
*v2.0 (2026-07-14) — 12개 직종 시나리오, 7개 구멍 발견. 가장 심각한
건 B·C·D(구조적 — 설계 문서엔 있는데 코드가 없음)이고, F는 이미 알던
사실의 재확인(제주시청 시나리오가 지금 실제로는 작동 못 함).*
