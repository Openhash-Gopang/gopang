# 초중고 교과목 ↔ 교수(professor) 전공 리프 매칭 테이블 (2026-08-09)

## 배경 — 이 문서가 왜 필요한가

`teacher`(정교사) 페르소나를 과목별로 세분화할지 검토하는 과정에서, 이미
확정돼 있던 구조를 재확인했다:

- `expert-registry-core.js`의 `teacher` 항목은 애초에 **생활지도·담임
  관점**으로 의도적으로 좁게 설계돼 있다("과외 선생님은 안 넣음 — teacher는
  학교 정교사이지 사교육 과외교사가 아니다").
- 교과 지도(학습 콘텐츠)는 `professor` 트리가 담당한다. `subject-gate.js`가
  이미 "초등 산수와 대학 수학을 별도 페르소나로 안 쪼갠다 — professor-math
  하나가 초등학생부터 대학원생까지 다 받는다"는 원칙으로 설계돼 있고, 국어·
  수학·영어·과학·사회·체육·미술 7과목은 `LEAF_SYNONYMS`로 초등 어휘까지
  이미 매핑돼 있다.

**결론(2026-08-09 확정): teacher는 세분화하지 않는다(옵션 A).** 교과 지도는
계속 professor가 전담한다. 이 문서는 그 결정의 실제 커버리지를 검증하기
위해 2022 개정 교육과정 교과(군) 편제 기준으로 professor 리프와 매칭하고,
빠진 부분을 표시한다.

## 매칭 테이블

범례 — **매칭O·동의어O**: 리프가 있고 `LEAF_SYNONYMS`에 초중고 어휘까지
등록됨(subject-gate 2단계에서 유리). **매칭O·동의어X**: 리프는 있지만
`LEAF_SYNONYMS` 미등록(교과서 수준 어휘가 아니면 놓칠 위험). **매칭 근사치**:
리프는 있으나 대학 전공과 초중고 교과가 개념적으로 다소 다름. **완전공백**:
대응하는 리프가 레지스트리에 아예 없음.

| 교과(군) | 학교급 | professor 리프 | 상태 |
|---|---|---|---|
| 국어 | 초·중·고 공통 | `professor-korean` | 매칭O·동의어O |
| 수학 | 초·중·고 공통 | `professor-math` | 매칭O·동의어O |
| 영어 | 초·중·고 공통 | `professor-english` | 매칭O·동의어O |
| 사회(통합) | 초등 | `professor-generalsocialscience` | 매칭O·동의어O |
| 과학(통합) | 초등 | `professor-generalscience` | 매칭O·동의어O |
| 체육 | 초·중·고 공통 | `professor-physicaleducation` | 매칭O·동의어O |
| 미술 | 초·중·고 공통 | `professor-finearts` | 매칭O·동의어O |
| 역사 | 중·고 | `professor-history` | 매칭O·동의어X |
| 물리학 | 고(선택) | `professor-physics` | 매칭O·동의어X |
| 화학 | 고(선택) | `professor-chemistry` | 매칭O·동의어X |
| 생명과학 | 고(선택) | `professor-biology` | 매칭O·동의어X |
| 지구과학 | 고(선택) | `professor-earthscience` | 매칭O·동의어X |
| 제2외국어(일본어 등 개별 언어) | 고(선택) | `professor-japanese`/`chinese`/`french`/`german`/`spanish`/`russian` 등 | 매칭O·동의어X |
| 도덕 | 초·중·고 | `professor-ethics`(철학·윤리학) | 매칭 근사치·동의어X |
| 정보 | 초·중·고(필수교양) | `professor-computerscience`(전산학·컴퓨터공학) | 매칭 근사치·동의어X |
| 음악 | 초·중·고 공통 | 없음 | **완전공백** — `professor-music-series` 하위가 성악·작곡·기악·국악·현대음악·음악학으로만 세분화, "일반 음악 교과" 캐치올 리프 자체가 없음 |
| 기술·가정 | 중·고 | 없음 | **완전공백** — `consumerscience`/`childfamilystudies`/`craft`/`housingstudies`로 파편화, 교과 자체를 대표하는 리프 없음 |
| 한문 | 중·고(선택) | 없음 | **완전공백** — 한문 전용 리프가 레지스트리에 없음 |
| 교양(진로와 직업 등 고교 선택) | 고 | 과목별 상이 | 이번 검증 범위 밖(과목이 아니라 다양한 진로 교양 묶음이라 1:1 매칭 곤란) |

## 검증 방법 및 대상 파일

전공-교과 "매칭"이 있다는 것과 실제 라우팅이 거기로 "연결된다"는 것은
별개다 — 아래 2단계 파이프라인 전체가 실사로 확인돼야 한다.

1. **STEP-1 (AC-PRO-CORE, `[EXPERT: professor]` 태깅)** —
   `scenarios_k12_professor_vs_teacher_20260809.json`(2026-08-09 다양화 개정,
   20건). 안전군(교사 트리거 단어 없는 자연스러운 K-12 발화), 위험군(발화에
   "선생님"·"담임"·"정교사"·"쌤" 같은 teacher 트리거 문자열/은어가 섞여
   있지만 의미상 professor가 정답인 함정 케이스), 그리고 **부정대조군
   2건**(no=18 "수업 설계를 도와주세요"[교사 본인 시점 → 정답은 teacher],
   no=20 "시험 일정이 언제인지"[제도 정보 질문 → 정답은 kedu(K-School)])을
   포함한다 — professor가 항상 이기는 게 아니라는 걸 함께 확인해야 진짜
   정밀도(precision) 검증이 된다. no=6("학교 다녀와서 국어 받아쓰기를 봐줄
   선생님을 구하고 있어요")은 teacher의 트리거 `'학교 선생님'`과 표면
   문자열이 거의 겹쳐 오분류 위험이 가장 크다.
   실행: `python3 live_smoketest.py --scenarios scenarios_k12_professor_vs_teacher_20260809.json --system-prompt ../../prompts/AC-PRO-CORE_v1_6.txt --out ../../results/k12-professor-vs-teacher`

2. **STEP-2 (subject-gate, 리프 정밀화)** —
   `scenarios_k12_subject_gate_20260809.json`(2026-08-09 다양화 개정, 30건:
   매칭O·동의어O 7건 + 매칭O·동의어X/근사치 10건 + 완전공백 4건 + 인접쌍
   함정 3건 + 복합요청/강건성/성인맥락 6건). 완전공백 4건은
   `expected_leaf_id: null`로 표시했다 — 이 경우 모델이 억지로 리프 하나를
   고르지 않고 `id:null`을 내는 것 자체가 정답이다(그래야 production
   `subject-gate.js`가 상위 `professor`로 안전 폴백한다). 이 케이스를
   `LIVE-PASS`로 정확히 채점하도록 `subject_gate_live_smoketest.py`의
   `grade()`도 함께 손봤다(과거엔 `chosen is None`이면 `expected`와 무관하게
   무조건 FAIL — null-기대 시나리오를 표현할 수 없었음). 인접쌍 함정 3건
   (화학/화학공학, 생명과학/생명공학, 지구과학/천문학)은 실제 professor
   트리에 두 후보가 모두 존재해 라벨 유사도로 흔들릴 개연성이 구조적으로
   있는 지점이다.
   실행: `python3 subject_gate_live_smoketest.py --scenarios scenarios_k12_subject_gate_20260809.json --out ../../results/k12-subject-gate`
   실행: `python3 subject_gate_live_smoketest.py --scenarios scenarios_k12_subject_gate_20260809.json --out ../../results/k12-subject-gate`

   실행 전 `dump_leaves.mjs`도 이번에 수정했다 — 기존 버전은
   `subject-gate.js._leafMenuLine()`(LEAF_SYNONYMS 보강)을 재구현하지 않고
   `id: label`만 재조립해, production보다 빈약한 메뉴로 채점하고 있었다.
   이제 `_leafMenuLine`을 export해서 그대로 가져다 쓴다 — production과
   완전히 동일한 메뉴 텍스트로 검증한다.

## 남는 판단 — 완전공백 3과목(음악·기술가정·한문)을 어떻게 할지

이번 세션 범위는 "현재 상태가 무엇인지 확인"까지다. 공백을 메우려면
(a) 각 교과를 대표하는 신규 리프를 professor 트리에 추가하거나(예: 음악은
`professor-music-series`에 "일반음악교육" 소계열 신설), (b) teacher 쪽에
극히 제한된 예외로 편입하는 방법이 있는데, (b)는 옵션 A(교사 세분화 안 함)
결정과 정면으로 배치되므로 (a) 쪽이 일관성 있다. 다만 이건 검증 결과를 보고
결정할 일이라 이번 문서에서는 확정하지 않는다.
