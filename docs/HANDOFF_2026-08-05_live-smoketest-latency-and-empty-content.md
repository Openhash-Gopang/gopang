# HANDOFF_2026-08-05_live-smoketest-latency-and-empty-content.md
## 라이브 스모크테스트 진단 + 응답 지연/빈 응답 해법 — 세션 인수인계

작성일: 2026-08-05 | 선행 문서: `docs/HANDOFF_2026-08-05_orchestration-integration-followup.md`,
`docs/ORG_PROFILES_GOVTREE_RECONCILIATION_v1_0.md` | 이번 세션 성격: 오전~오후는
org_profiles/gov-tree §4-2 라이브 검증 이어받기, 저녁은 hondi.net 실제 사용자
계정으로 개인파산·안심상속 시나리오 라이브 스모크테스트 진행 중 완전히 다른
층위의 버그(빈 응답·응답 지연)를 발견·진단

## 이 문서를 받았다면

주피터님이 이 문서를 새 대화창에 올리고 "이어서 진행하십시오"라고 하면,
**§4(다음 작업 지시)를 순서 3→1→2 그대로** 진행하면 됩니다. §0·§3은 먼저
읽으세요. 이번 세션은 라이브 계정(GDC 잔액 0)으로 실제 hondi.net을 테스트하며
진행됐다는 점이 이전 세션들과 다릅니다 — §2에 그 과정에서 나온 원시 증거를
남겨뒀습니다.

---

## 0. 작업 방식 (변경 없음, 이전 세션들과 동일)

1. `git fetch origin` → `git checkout -b <브랜치> origin/main`로 항상 최신
   기준 새 브랜치.
2. 커밋 후 `git format-patch origin/main..HEAD` → **별도 클론에 `git am`으로
   미리 검증** → `node --test src/tests/*.mjs`로 회귀 확인 → patch 전달.
3. 사용자는 Windows PowerShell. `Copy-Item "$HOME\Downloads\<파일>"
   -Destination "C:\Users\주피터\Downloads\gopang\"`로 다운로드 폴더에서
   저장소 폴더로 옮긴 뒤 `git am`.
4. `git push origin HEAD:main` — 이 저장소는 브랜치 보호 규칙이 있지만
   주피터님 권한으로 "Bypassed rule violations" 처리되어 직접 push 가능함을
   이번 세션에서 반복 확인(PR 경유 없이 즉시 반영됨).
5. **이번 세션 특이사항**: 여러 세션이 동시에 병행 작업 중이다(오늘 하루
   동안만 origin/main이 예고 없이 6~7회 앞서 있었음 — `SP-COMMON-02` 시리즈,
   `AC-PRO-CORE §CATALOG-EXPERT` 등 무관한 변경들이 계속 들어옴). patch
   생성 직전 `git fetch`는 예외 없이 실행할 것.

---

## 1. 이번 세션에 완료·병합된 것 (origin/main 반영 완료)

| 커밋 | 내용 |
|---|---|
| `7d6366e` | `sp_gov_tree_instance_realtime` 마이그레이션의 `instance_key` 유니크 인덱스 중복 선언 제거(`feat/gov-tree-pb-migration` 브랜치 검토 중 발견) |
| `9c84bd8` | 34건 미매칭 org_profiles↔gov-tree 방침 결정 — 강원도(18건, gov-tree 확장 대상 유지) / 교육청(16건, gov-tree 대상 제외, `unmatched_out_of_scope`로 분리) — `tools/reconcile_org_profiles_govtree.mjs` 수정 + 회귀 테스트 추가 |
| `4ecdb1c` | `SP-20_kcompose_v2.1.txt` STEP 1에 `status:draft` procedure_map 처리 갈래 명시(기존엔 `hit(active)`/`hit_pending_review`/`miss` 세 갈래만 정의돼 있어 draft 상태가 미정의 상태로 방치돼 있었음) |

**§4-2(org_profiles/gov-tree 마이그레이션 라이브 검증)**: hanlim PocketBase
인스턴스가 org_profiles 유일 실데이터 보유(406건, gov_tree_delegate 28건
정확히 일치) 확인 완료. 나머지 6개 인스턴스는 스키마만 있고 데이터 0건 —
이는 정상(중앙화 구조로 추정).

---

## 2. ★★★ 오늘 저녁 라이브 스모크테스트에서 발견한 것 — 가장 중요 ★★★

### 2-1. 배경

`4ecdb1c`(STEP 1 draft 처리 수정)가 실제로 작동하는지 검증하려고 hondi.net에
"안심상속" 관련 발화를 여러 번 입력. 응답이 5분+ 지연되거나 아예 안 오는
현상을 목격 → `wrangler tail`·브라우저 Network/Console·PocketBase SQL 조회를
번갈아 가며 원인 추적. **결과: 저희가 고치려던 STEP 1 버그와는 전혀 다른,
더 근본적인 두 가지 문제를 발견했다.**

### 2-2. 발견 1 — reasoning이 completion 토큰 예산을 전부 잠식해 content가 0건

`src/gopang/core/token-policy.js`에 **이미 알려진 동일 클래스 버그**가
기록돼 있었다(#180, profile-assistant.html에서 먼저 발견됨): hondi-pro는
`thinking: enabled`가 기본값이라(Flash만 명시적으로 disabled), 최종 답
생성 전에 reasoning에 토큰을 먼저 쓴다. 이미 `CHAT_REPLY_PRO`를
800→4000으로 올려 완화했었는데, 이번 세션에서 실측한 안심상속 재확인
케이스는 reasoning이 그보다 더 길어서(모델이 "status-check용 표준 태그가
없다"는 걸 스스로 고민하는 등 장문의 reasoning_content 생성) **4000토큰
예산 전체를 reasoning이 다 쓰고 content가 완전히 빈 문자열**로 나왔다
(`finish_reason:"stop"`으로 정상 종료 처리 — 에러도 경고도 없음).

**실측 증거**(콘솔 fetch 가로채기로 확인):
```
=== FINAL CONTENT ===
(공백)
=== HAS CALL_KINTENT? === true   (reasoning 안에는 있었음)
=== HAS PROCEDURE_MAP_LOOKUP? === false
```

즉 AC가 `[CALL_KINTENT]`를 낼지 말지까지는 reasoning 안에서 판단했지만,
**그 판단을 실제 태그로 출력할 토큰이 남지 않아서 그냥 끊겼다.** 사용자
화면엔 아무것도 안 뜨고, 시스템은 이걸 실패로 인식조차 못 한다(정상
`stop` 처리).

### 2-3. 발견 2 — 오케스트레이션 체인 전체가 순차·전부 hondi-pro라 지연이 곱해짐

`_handleOrchestrationTags`(`call-ai.js`)는 태그 하나(`PROCEDURE_MAP_LOOKUP`,
`PROCEDURE_MAP_UPDATE` 등)를 감지할 때마다 `sendFn`(기본값 `callAI`)으로
**새 deepseek 호출을 만든다.** 이 재호출에 모델을 명시적으로 지정하는
override가 없어서, **오케스트레이션 체인의 모든 홉(AC 판단 → K-Intent →
PROCEDURE_MAP_LOOKUP 재주입 → K-Compose → K-Execute → K-Deliver)이 전부
hondi-pro(thinking 켜짐)로, 그것도 순차(sequential)로 실행된다.**

무거운 호출 하나가 수십 초 걸리는데 그게 4~6단계 이어지면 수 분이 걸리는
게 당연하다 — 실측 5분+ 지연이 정확히 이 구조로 설명된다.

### 2-4. 부수 발견 — GDC 잔액 0으로 인한 과금 실패(별도 이슈, 응답 자체는 안 막음)

`wrangler tail`에서 `AI_CHARGE_FAILED`(`GDC 잔액 부족: 보유 0T`)가 반복
관찰됐다. `worker.js`의 `_chargeGdcForAiUsage()` 주석에 "실패해도 응답
자체는 막지 않는다"고 명시돼 있어 **이번 지연·빈 응답의 원인은 아님**을
코드로 확인했다. 다만 이건 별도로 진짜 문제다 — 이 테스트 계정 기준으로
과금이 계속 안 걷히고 있다(무료로 새는 중). 이번 세션 범위 밖으로 남김.

### 2-5. 관련 없는 것으로 배제한 가설들(디버깅 경로 기록)

- ~~브라우저 백그라운드 탭 스로틀링이 원인~~ → 부분적으로 지연을 과장했을
  순 있지만(콘솔 로그에 `[PWA] 포그라운드 복귀` 여러 번 확인됨), 근본
  원인은 아님.
- ~~STEP 1의 draft 상태 미처리가 원인~~ → §2-2·§2-3 때문에 애초에 STEP 1
  로직 자체가 실행될 기회조차 못 가진 시도가 섞여 있어서, `4ecdb1c` 수정이
  틀렸다거나 검증됐다고 결론 내릴 수 없다(**미해결로 남음** — §4-4 참고).
- ~~SP-Author 큐(`sp_draft_requests`) 경유~~ → 조회 결과 0건, 이 경로도
  안 탐.
- ~~"수천 번 deepseek 호출"(초기 우려)~~ → 오인이었음. 실제 호출 횟수는
  적었고(수 회), Network 패널에 보인 "1000여 줄"은 SSE 스트리밍 청크
  수(토큰 하나당 한 줄)였을 뿐 — 폭주가 아니었다.

---

## 3. 함정 목록 (다음 세션이 반복하지 말아야 할 것)

1. **Network 패널의 "요청 개수가 많다"를 곧바로 "호출이 폭주한다"로
   해석하지 말 것.** SSE 스트리밍은 토큰 단위로 별도 줄을 찍어서 응답
   하나가 수백~수천 줄처럼 보인다. 실제 호출 횟수는 `wrangler tail`(서버
   진입점 기준)로 세는 게 정확하다.
2. **`wrangler tail`(서버 로그)과 브라우저 Console(클라이언트 로그)은
   완전히 다른 프로세스의 로그다.** `_handleOrchestrationTags`의
   `console.log`는 브라우저에서 실행되는 `call-ai.js` 안에 있어 **절대
   `wrangler tail`에 안 잡힌다.** 이번 세션 초반에 이걸 착각해서 여러
   턴을 낭비했다.
3. **Network 탭 URL 필터(`Orchestration` 등)로 콘솔 로그 문구를 찾으려
   하지 말 것.** URL 필터는 요청 이름/주소만 걸러내지, 응답 본문이나
   콘솔 로그 내용을 검색하지 않는다. 응답 본문 전체를 검색하려면
   DevTools의 "네트워크 응답 본문 검색"(돋보기) 기능을 쓰거나, 아예
   `fetch`를 가로채는 스크립트를 Console에 심는 게 훨씬 빠르다(이번
   세션에서 실제로 이 방법이 결정적 증거를 냈다 — §5 참고 스크립트).
4. **`finish_reason:"stop"`이 나왔다고 "정상 완료"로 단정하지 말 것.**
   reasoning만 채우고 content가 빈 채로도 API는 정상 `stop`을 반환한다.
   content가 비었는지 별도로 확인해야 진짜 실패를 잡을 수 있다.
5. **가설을 세우면 바로 코드로 검증할 것 — 짐작을 쌓지 말 것.**
   `SESSION_LESSONS_VECTORIZE_GOVTREE_v1_0.md`가 이미 경고한 교훈("추정
   두 개가 연달아 틀렸다 — 셋째 시도부터는 로그부터 봤어야 했다")을
   이번 세션도 그대로 반복할 뻔했다(AI_CHARGE_FAILED를 원인으로
   짐작했다가 코드 확인 후 스스로 정정한 사례 — §2-4).

---

## 4. 다음 작업 지시 — 순서 **3 → 1 → 2** (주피터 확정)

### 4-1. (1순위 실행 — 문서상 "3번") `[ORCHESTRATION_PROGRESS]`를 매 홉마다 의무화

**현재**: K-Compose(SP-20)가 STEP4에서 "선택적으로" 진행상황 태그를 낸다.
**목표**: 오케스트레이션 체인의 매 LLM 홉(AC 판단 이후 모든 재주입 턴)마다
`[ORCHESTRATION_PROGRESS: step=n/total, doing=...]`을 **의무적으로** 내도록
SP-20(그리고 관련되면 SP-19/SP-21/SP-22)에 RULE 추가.

**손댈 파일**: `prompts/SP-20_kcompose_v2.1.txt`(STEP4 근처, "선택적"이라는
뉘앙스를 "필수"로), 필요시 `prompts/SP-22_kexecute_v1.5.txt`도 각 atom
실행 직전 progress 태그를 내도록. 코드 쪽은 이미 배선 완료
(`_handleOrchestrationTags`의 `ORCHESTRATION_PROGRESS` 처리부, §968-990행
근처) — **프롬프트만 고치면 되는 작업**이라 빠르게 끝날 것으로 예상.

**검증 방법**: 라이브가 아니어도, 프롬프트 문구 변경 후 §2의 시나리오
("안심상속 확인해줘")를 다시 라이브로 돌려서 중간에 진행 표시가 뜨는지
직접 확인 필요(자동 테스트로 검증 불가능한 종류의 변경).

### 4-2. (2순위 실행 — 문서상 "1번") 파이프라인 홉별 모델 분리

**현재**: `_handleOrchestrationTags`의 모든 `sendFn` 호출이 override 없이
`callAI`를 그대로 써서 `CFG.model`(hondi-pro 고정)을 물려받는다.

**목표**: "단순 분기·재주입 소비" 성격의 홉(`PROCEDURE_MAP_LOOKUP` 결과
재주입, `PROCEDURE_MAP_UPDATE` 결과 재주입 등)은 `hondi-flash`로, "진짜
판단"이 필요한 홉(K-Compose의 신규 계획 수립, K-Deliver의 최종 답 합성)만
`hondi-pro`로 분리.

**손댈 파일**: `src/gopang/ai/call-ai.js`의 `_handleOrchestrationTags` 내
각 `sendFn(...)` 호출부(§1032-1044행 근처가 대표 사례,
`PROCEDURE_MAP_LOOKUP` 재주입). `sendFn`이 두 번째 인자로 모델 override를
받을 수 있는지 시그니처부터 확인(`sendFn = callAI`의 실제 시그니처 확인
필요 — 지금 문서 작성 시점엔 그 확인을 안 마쳤음, 다음 세션 첫 작업으로
`callAI` 함수 시그니처 확인부터 시작할 것).

`src/gopang/core/token-policy.js`의 원칙("판단은 한 곳") 그대로, 새 모델
분기 판단도 이 파일에 함수로 추가하는 걸 권장(예: `resolveOrchestrationModel(tagType)`
같은 형태로, 호출부에 삼항연산자를 흩뿌리지 않기).

**주의**: token-policy.js 주석에 이미 "분류·요약·감시처럼 사용자가 직접
평가 안 하는 보조 작업은 FAST_MODEL을 쓴다"는 원칙이 있다 — 이번 작업은
그 원칙을 오케스트레이션 재주입 턴에도 적용하는 것뿐, 새 원칙을 만드는
게 아니다.

### 4-3. (3순위 실행 — 문서상 "2번") 기계적 분기는 LLM 호출 자체를 없애기

**현재**: `PROCEDURE_MAP_LOOKUP` 결과가 `status:active`(또는 이번에 고친
`draft`)면 다음에 뭘 할지가 사실상 **결정론적 if문**인데, 이것도 매번
LLM 재호출로 처리한다.

**목표**: `_handleOrchestrationTags`에서 `PROCEDURE_MAP_LOOKUP` 결과를
받은 직후, `status`가 `active`/`pending_review`/`draft`/`miss` 중
어느 것인지에 따라 **다음 행동이 이미 결정돼 있는 경우**(예: `miss`면
무조건 STEP 1-B로) 코드가 직접 다음 단계로 분기하고, LLM은 "이 절차가
이 사용자에게 정말 맞는지"(STEP 2) 같은 **진짜 자연어 판단이 필요한
지점에만** 부른다.

**주의 — 이건 가장 큰 설계 변경**: STEP 1~STEP 4 전체를 다시 감사해서
"이건 코드가 할 일" vs "이건 LLM이 할 일"을 새로 나눠야 한다. 한 세션에
끝내려 하지 말 것 — §4-1·§4-2를 먼저 끝내고 효과를 실측한 뒤, 그래도
지연이 남으면 이 작업의 ROI를 재평가하고 시작하는 걸 권장.

### 4-4. 미해결로 남은 것 — §4-2(구) draft 상태 수정의 라이브 검증

`4ecdb1c`가 실제로 의도대로 동작하는지는 **이번 세션에서 확정하지
못했다**(§2-5의 이유로) — §4-1·§4-2(이 문서의) 작업 이후, content가
실제로 나오는 상태에서 "안심상속" 시나리오를 다시 돌려 STEP 1-B 진입
여부를 재확인할 것.

---

## 5. 참고 — 이번 세션에서 유용했던 디버깅 도구

**콘솔 fetch 가로채기 스크립트**(브라우저 Console에 붙여넣기 — deepseek
응답의 reasoning/content를 분리해서 보여줌, 다음에 비슷한 진단 필요할 때
재사용):

```js
(function(){
  const orig = window.fetch;
  window.fetch = async function(...args) {
    const res = await orig.apply(this, args);
    if (String(args[0]).includes('deepseek')) {
      const clone = res.clone();
      clone.text().then(t => {
        const lines = t.split('\n').filter(l => l.startsWith('data: ') && !l.includes('[DONE]'));
        let reasoning = '', content = '';
        for (const line of lines) {
          try {
            const j = JSON.parse(line.slice(6));
            const d = j.choices?.[0]?.delta;
            if (d?.reasoning_content) reasoning += d.reasoning_content;
            if (d?.content) content += d.content;
          } catch(e) {}
        }
        console.log('=== REASONING ===\n' + reasoning);
        console.log('=== FINAL CONTENT ===\n' + content);
      });
    }
    return res;
  };
})();
```

## 6. 관련 파일 목록

- `src/gopang/core/token-policy.js` — `TOKEN_BUDGET`, `resolveChatBudget()`, §4-2 대상
- `src/gopang/ai/call-ai.js` — `_handleOrchestrationTags()`(§968~), §4-1·4-2·4-3 전부 이 함수 대상
- `prompts/SP-20_kcompose_v2.1.txt` — STEP 1(오늘 수정), STEP 4(§4-1 대상)
- `prompts/SP-22_kexecute_v1.5.txt` — §4-1 대상(atom 실행 진행상황)
- `worker.js` — `callDeepSeek()`(§13360~), `_chargeGdcForAiUsage()`(§1225~, §2-4 관련)
- `tools/reconcile_org_profiles_govtree.mjs`, `src/tests/reconcile-org-profiles-govtree.test.mjs` — 이번 세션 34건 방침 작업
- `docs/ORG_PROFILES_GOVTREE_RECONCILIATION_v1_0.md` §7 — org_profiles/gov-tree 작업 전체 이력
- `docs/HANDOFF_2026-08-05_orchestration-integration-followup.md` — 선행 인수인계 문서
