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
추가했다(`subject-gate.js._buildGateCandidates`). 이 항목의 id는 일부러
`personaId` 그대로 써서(예: `professor`), 골라도 기존 화이트리스트
검증·폴백 로직을 그대로 통과한다 — null을 위한 특수 분기를 늘리는 게
아니라 이미 있는 "목록에서 후보 고르기" 메커니즘 자체가 안전한 결과로
이어지게 만든 것이다. `dump_leaves.mjs`도 `_buildGateCandidates`를 그대로
불러 쓰도록 갱신해 하네스가 production과 동일한 158개(리프 157 + 해당없음
1) 후보를 재현한다. 시나리오 파일의 완전공백 4건은 `expected_leaf_id`를
`null` 대신 `root_id`(예: `"professor"`) 그대로 채웠다 — "해당 없음"의
id가 root_id와 같아서 별도 채점 분기 없이 일반 로직(`chosen == expected`)이
그대로 판정해준다.

## 알려진 한계 — 아직 못 채운 것과 앞으로의 방향

**전수조사 미완료** — 지금까지 발견한 완전공백 4과목(음악·기술가정·한문·
진로와 직업)은 20개 시나리오를 손으로 짜다가 우연히 걸린 것이지, 2022
개정 교육과정 전체(고교 전문교과·진로선택/융합선택 과목 등)를 professor
157개 리프와 전수 대조한 결과가 아니다. 3차 구조적 수정(해당 없음 후보화)이
제대로 작동한다면, 지금 못 찾은 공백도 억지매칭 대신 안전하게 상위
`professor`로 폴백할 것으로 기대되지만 — 이건 검증이 더 필요하다.

**리프 신설 여부는 별개 결정** — 구조적 수정으로 "안전하게 실패"하는 것과
"애초에 정답 리프가 있어서 잘 되는 것"은 다르다. 이 4과목(+전수조사로
추가 발견될 과목)에 실제 professor 리프를 신설할지는 이번 세션 범위
밖으로 남겨둔다 — 신설한다 해도 teacher 세분화 안 함(옵션 A) 결정과는
무관하게 professor 트리 내부의 확장 문제다.
