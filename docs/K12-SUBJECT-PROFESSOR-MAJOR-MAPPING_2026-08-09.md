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
| 음악 | 초·중·고 공통 | `professor-generalmusic` | 매칭O·동의어O(2026-08-10 리프 신설 — 아래 §완전공백 처리 참고) |
| 기술·가정 | 중·고 | `professor-generalpractical` | 매칭O·동의어O(2026-08-10 리프 신설) |
| 한문 | 중·고(선택) | `professor-classicalchinese` | 매칭O·동의어O(2026-08-10 리프 신설) |
| 진로와 직업 | 고 | `professor-careereducation` | 매칭O·동의어O(2026-08-10 리프 신설 — 정서·심리 상담과는 SP §세부분야 경계에서 명확히 구분) |

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
   포함한다.
   실행: `python3 live_smoketest.py --scenarios scenarios_k12_professor_vs_teacher_20260809.json --system-prompt ../../prompts/AC-PRO-CORE_v1_7.txt --out ../../results/k12-professor-vs-teacher`
   (2026-08-10 — 워크플로가 이 경로를 `v1_6.txt`로 하드코딩해뒀던 걸
   `prompts/sp-catalog.json["AC-PRO-CORE"]`를 직접 읽도록 고쳤다 —
   `.github/workflows/live-smoketest-k12-subject-mapping.yml` 참고.)

2. **STEP-2 (subject-gate, 리프 정밀화)** —
   `scenarios_k12_subject_gate_20260809.json`(2026-08-09 다양화 개정, 30건:
   매칭O·동의어O 7건 + 매칭O·동의어X/근사치 10건 + 완전공백 4건 + 인접쌍
   함정 3건 + 복합요청/강건성/성인맥락 6건). 인접쌍 함정 3건(화학/화학공학,
   생명과학/생명공학, 지구과학/천문학)은 실제 professor 트리에 두 후보가
   모두 존재해 라벨 유사도로 흔들릴 개연성이 구조적으로 있는 지점이다.
   실행: `python3 subject_gate_live_smoketest.py --scenarios scenarios_k12_subject_gate_20260809.json --out ../../results/k12-subject-gate`

## 완전공백 과목 처리 방식의 변천 (2026-08-09 → 2026-08-10)

**1차 시도(2026-08-09, 실패)** — `GATE_SYS_PROMPT_HEAD`에 "확신이 없으면
`{"id": null}`로 응답하라"는 지시를 넣었다. 실사 결과 음악(리코더 운지법)
→`professor-koreanmusic`, 기술·가정(칼질 안전수칙)→`professor-culinaryscience`,
한문(천자문)→`professor-chinese`, 진로와 직업(적성검사)→`professor-psychology`
로 매번 확신도 높은 오답을 냈다(`raw_response`가 `{"id": null}`이 아니라
정상 JSON 정답 형태).

**2차 시도(2026-08-09, 역시 실패)** — 실패한 4건을 그대로 반례 문구로
프롬프트에 추가(`"'리코더 운지법 시험'은 '기악'·'국악' 전공이 아니라..."`
같은 식). 재검증 결과 **4건 전부 토씨 하나 안 틀리고 동일한 오답을
반복**했다 — 프롬프트 문구를 아무리 구체적으로 강화해도 "목록에서 하나
고르기"라는 과제 프레이밍 자체를 못 이겼다고 판단.

**3차 — 구조적 수정(2026-08-10, 채택)** — "예외적으로 null을 내라"는
별도 지시를 없애고, "해당 없음"을 후보 목록 안의 **정식 항목**으로
**3차 — 구조적 수정(2026-08-10, 부분 채택 후 즉시 대체)** — "예외적으로
null을 내라"는 별도 지시를 없애고, "해당 없음"을 후보 목록 안의 정식
항목으로 추가했다(`subject-gate.js._buildGateCandidates`). 이 항목의 id는
일부러 `personaId` 그대로 써서(예: `professor`), 골라도 기존 화이트리스트
검증·폴백 로직을 그대로 통과한다. 실사 재검증 결과 — **이것도 실패했다.**
음악·기술가정·진로 3건은 이전과 정확히 동일한 오답(국악·조리과학·심리학)을
또 냈고, 한문만 고른 오답이 중국어→국어로 바뀌었을 뿐 여전히 오답이었다.
158개 후보 중 맨 끝에 "해당 없음"이 정식 항목으로 있어도 모델이 그걸
진지하게 고려하지 않는다는 뜻 — 프롬프트·메뉴 구성으로 접근하는 3가지
방법(추상 지시 → 반례 명시 → 정식 후보화)이 전부 같은 4개 시나리오에서
동일하게 막혔다.

**4차 — 데이터로 해결(2026-08-10, 채택)** — 3연속 실패는 "어떻게
물어보는가"가 아니라 "애초에 정답이 목록에 없다"는 게 진짜 원인이라는
신호로 보고, `professor` 트리에 4개 리프를 신설했다: `professor-generalmusic`
(교양음악, `professor-music-series` 소속), `professor-classicalchinese`
(한문학, `professor-language-literature` 소속, 현대 중국어와 SP
§세부분야 경계에서 명확히 구분), `professor-generalpractical`(교양
기술·가정), `professor-careereducation`(진로교육, 정서·심리 상담과는
구분 — 둘 다 `professor-misc-series` 소속). 넷 다 `SP_professor-*_v1_0.md`
훅 파일 신설 + `expert-registry-professor.js` 등록 + `prompts/sp-catalog.json`
매니페스트 등록 + `LEAF_SYNONYMS`(초중고 어휘 보강) 추가까지 마쳤고,
`_composeExpertPrompt()` 실사 렌더로 3단 조상 체인(`professor`→중계열→
신규 리프) 조립과 CONTROL-TOWER-PRINCIPLE 포함을 확인했다. 시나리오
파일의 4건도 `expected_leaf_id`를 `professor`(해당없음 폴백) 대신 신규
리프 id로 갱신 — 이제 "안전하게 실패"가 아니라 "정확히 맞는" 게 목표다.

## 남은 것 — 전수조사, 그리고 "해당 없음" 메커니즘 자체의 유효성

**전수조사 미완료** — 이번에 발견한 4과목은 20개 시나리오를 손으로 짜다가
우연히 걸린 것이지, 2022 개정 교육과정 전체(고교 전문교과·진로선택/융합
선택 과목 등)를 professor 161개 리프와 전수 대조한 결과가 아니다. 다음에
또 다른 완전공백 과목이 나올 수 있다.

**"해당 없음" 메커니즘은 여전히 안전망으로 유효** — 3차 구조적 수정은 이
4건에서는 안 통했지만, 메커니즘 자체를 버릴 이유는 없다. k12-sg-22
(복합요청, "수학 숙제도 있고 과학 숙제도 있어서...")에서는 실제로 깔끔하게
"해당 없음"(=`professor`)으로 정확히 떨어졌다 — 정답이 애매하게 여러 개
걸치는 경우엔 작동하고, 정답이 아예 없는데 표면적으로 그럴듯한 후보가
있는 경우엔 안 통한다는 뜻으로 보인다. 다음에 전수조사로 새 공백을
찾으면, 이 메커니즘이 그 공백에서도 뚫리는지부터 확인하고 — 뚫리면
이번처럼 리프를 신설하면 된다.
