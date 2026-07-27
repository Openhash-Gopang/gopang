/**
 * ai/expert-registry.js — 전문가 AI 정적 레지스트리
 *
 * 전문 분야(기관) AI(K-Law·K-Tax 등)는 별도 URL을 가진 새 탭 서비스이지만,
 * 전문가 AI(변호사·간호사 등 개별 자격직)는 별도 서비스가 없는 "순수 System
 * Prompt" 페르소나다. 따라서 GWP_REGISTRY(새 탭 방식)에 넣지 않고, 이 레지스트리를
 * 통해 "같은 스레드 내 System Prompt 교체" 방식(expert-session.js)으로 호출한다.
 *
 * 분류(LAW/HEALTH/EDU/ENG/FIN/REAL_ESTATE/IT/TRANSLATION/TOURISM/SPORTS/BEAUTY/
 * CULINARY)는 각 SP 파일 1행에 적힌 코드(SP-LAW-01 등)를 그대로 따른다. 임상심리사·
 * 정신건강전문요원·전문상담교사는 SP-EDU 코드를 부여받아 category는 EDU를
 * 유지하지만, needsMedicalSafety는 true다 — 2026-07-04에 위기개입 프로토콜
 * (SP-COMMON-03 M5, 자살·자해 대응)을 상속받도록 수정됐다(카테고리 분류와
 * 안전모듈 상속은 별개 기준).
 *
 * ownerAgency (2026-07-20 신설): 이 페르소나의 세션 데이터·상담 이력이
 * 귀속되는 소유 K-서비스(GWP_REGISTRY의 agency id)다. 원칙적으로 category와
 * 1:1이지만 두 종류의 예외가 있다:
 *   (1) FIN 카테고리 안에서도 자격별 업무 실질이 달라 개별 override가 있다
 *       — tax-accountant는 카테고리 기본값(ktax) 그대로, accountant는
 *       kfinance(회계감사·재무제표·기업가치평가가 K-Tax보다 K-Stock 쪽 실질에
 *       가까움), financial-planner는 kbank(개인 자산관리) — 각 override는
 *       해당 엔트리 옆 주석 참조.
 *   (2) 대응하는 K-서비스 저장소가 아직 없는 카테고리(ENG/TRANSLATION/
 *       TOURISM/SPORTS/BEAUTY/CULINARY)는 총괄 저장소인 gopang으로 폴백한다
 *       — 수요가 확인되면 그때 전용 K-서비스로 분리한다(의도된 폴백이지
 *       누락이 아님).
 * 세션 종료 시 이 필드를 기준으로 소유 K-서비스의 PDV(가명화 해시 상담기록)에
 * 6하원칙 레코드가 기록된다 — 자세한 스키마는 SP_PDV 문서 참조.
 */

export const UNIVERSAL_INTEGRITY_KEY   = 'UNIVERSAL-INTEGRITY'; // 2026-07-09: 하드코딩 경로 -> manifest 키로 전환
// 2026-07-09: v3.3 → v3.6 갱신. v3.4~v3.6이 실제로는 이 상수가 안 바뀌어서
// 한 번도 로드된 적이 없었다(실사로 확인 — expert-session.js가 이 URL을
// fetch()로 직접 읽고, sp-catalog.json을 거치지 않는 별도 체계이기 때문).
// C40(공익·사익 재분류 게이트)·C41(오케스트레이션 하위 판단 요청)이 이제야
// 실제로 로드된다.
export const COMMON_GUARDRAILS_KEY     = 'SP_common_guardrails'; // 2026-07-09: 하드코딩 경로 -> manifest 키로 전환
export const COMMON_MEDICAL_SAFETY_KEY = 'SP_common_medical_safety'; // 2026-07-09: 상동

export const EXPERT_REGISTRY = {
  // ── 법률 ──────────────────────────────────────────────
  lawyer: {
    // 2026-07-09: v3.2 → v4.1 갱신. v4.0(STEP R 오케스트레이션)·v4.1(C41
    // scope=orchestration_subtask 대응)이 이 줄이 안 바뀌어서 한 번도
    // 실제로 로드된 적이 없었다(실사로 확인).
    label: '변호사', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영(2026-07-25) — 'GWP 기본값, EXPERT는 위임의도 명시 시만
    // 우선' 원칙. 예전엔 klaw와 완전 동일한 '변호사·소송·고소·고발'을 그대로 썼는데, 이건 klaw(가상판결 시뮬레이션)와
    // lawyer(실제 변호사 자문) 둘 다에 해당하는 일반어라 어느 쪽이 이길지 불확정이었다. '소송·고소·고발'은 klaw가
    // 담당하는 게 맞으므로 빼고, 위임 의도가 명확한 구(phrase)만 남겨 klaw의 단일어 트리거보다 항상 더 길게(=매칭 로직상
    // 우선) 만든다.
    triggers: ['변호사 선임', '변호사에게 맡기고 싶어', '변호사 상담', '법적 조치', '억울한 일'],
  },
  // 2026-07-06 신설(전문가 페르소나 누락 감사 결과) — 변호사와 다른 자격.
  // 업무범위(등기·경매·소액사건 등) 초과 시 lawyer로 안내하도록 SP 본문에 명시.
  'judicial-scrivener': {
    label: '법무사', icon: '📜', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_judicial-scrivener', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(변호사↔법무사) 구분 키워드 그대로 사용 — GWP와 겹치는 게 없어 정책 조정
    // 불필요
    triggers: ['법무사', '등기', '경매', '소액사건'],
  },

  // ── 재무·세무 (SP-FIN-01, 2026-07-04 신설) ────────────
  'tax-accountant': {
    label: '세무사', icon: '🧾', category: 'FIN', ownerAgency: 'ktax',
    key: 'SP_tax-accountant', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '절세' 단독은 kfinance(K-Stock)와 동일 문자열이라
    // 삭제하고 '세무사에게 상담'류 위임의도 구로 교체. 일반적인 절세 문의는 kfinance/ktax가 담당.
    triggers: ['세무사에게 상담', '세무사 자문', '개인 절세 전략'],
  },
  // 2026-07-06 신설 — 세무사와 다른 자격(회계감사·재무제표 중심). 사고실험
  // #40에서 세무사로 오매핑될 위험이 확인된 항목.
  accountant: {
    // ownerAgency override: FIN 기본값(ktax)이 아니라 kfinance(K-Stock) —
    // 세무사(ktax)와 달리 회계감사·재무제표·기업가치평가·M&A 실사가
    // 중심이라 K-Tax보다 K-Finance 업무 범위에 더 가깝다(2026-07-20).
    label: '공인회계사', icon: '📊', category: 'FIN', ownerAgency: 'kfinance',
    key: 'SP_accountant', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '재무제표'는 kbusiness와 동일 문자열이라 삭제.
    // '회계감사를 의뢰하고 싶어'는 위임의도가 명확해 유지, 뒤에 '검토' 단독 대신 '의뢰'로 구체화
    triggers: ['공인회계사에게 의뢰', '공인회계사 상담', '회계감사를 의뢰'],
  },
  // 2026-07-17 신설(전문가 페르소나 누락 감사 후속) — 개별 금융상품 추천은
  // 하지 않음(자본시장법). kbank/kfinance/kinsurance와 격치는 실행
  // 영역은 해당 GWP로 안내.
  'financial-planner': {
    // ownerAgency override: FIN 기본값(ktax)이 아니라 kbank —
    // 개인 자산관리·금융상품 상담이 중심이라 개인 뱅킹 서비스(K-Bank)
    // 소관이 세무(K-Tax)보다 적합하다(2026-07-20).
    label: '재무설계사', icon: '📈', category: 'FIN', ownerAgency: 'kbank',
    key: 'SP_financial-planner', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험에서 실패 확인된 '내 재무 계획을 수립해 줘'(주피터 원 예시) 직접
    // 커버. GWP와 충돌 없음
    triggers: ['재무설계사', '재무 계획', '은퇴 설계', '노후 준비 계획', '자산관리'],
  },

  // ── 법률 (2026-07-17 추가분) ──────────────────────
  // 사고실험 #44/#48/#42에서 확인된 공백. kinsurance·real-estate-agent·lawyer와
  // 각각 자격이 다름 — SP 본문 상단 주석 참조.
  appraiser: {
    label: '감정평가사', icon: '🏷️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_appraiser', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['감정평가사', '감정평가', '부동산 가치평가', '자산 가치평가'],
  },
  'loss-adjuster': {
    label: '손해사정사', icon: '📋', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_loss-adjuster', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['손해사정사', '보험금 산정', '손해사정'],
  },
  'labor-attorney': {
    label: '공인노무사', icon: '👷', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_labor-attorney', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '부당해고·임금체불'은 klaw와 동일 문자열이라 삭제하고
    // '노무사에게 상담'류 위임의도 구로 교체. 일반적인 '부당해고를 당했다'는 계속 klaw(가상판결 시뮬레이션)로 가는 게 맞다.
    triggers: ['공인노무사', '노무사에게 상담', '노무사 자문', '노무 상담'],
  },
  'patent-attorney': {
    label: '변리사', icon: '💡', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_patent-attorney', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. GWP와 충돌 없음
    triggers: ['변리사', '특허 출원', '상표 등록', '특허출원'],
  },
  'customs-broker': {
    label: '관세사', icon: '🛃', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_customs-broker', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['관세사', '수입 통관', '수출 통관', '관세사에게'],
  },

  // ── 의료·보건 (SP-HEALTH-06~15) ──────────────────────
  // 2026-07-06 신설(SP-HEALTH-16~19) — 의사·치과의사·한의사·약사. 다른 10개
  // 의료직이 전부 "확진·처방은 의사 영역"이라고 선을 긋는 구조라, 그 반대편을
  // 정의하는 이 4개는 특히 신중한 검토가 필요함(SP 본문 상단 주석 참조).
  physician: {
    label: '의사', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '의사' 단독은 khealth와 완전 중복(khealth 자체가
    // 이미 '아파요·증상·처방·진단'을 폭넓게 다룸, physician의 ownerAgency도 khealth). 일반 의료 상담은
    // 전부 khealth가 우선이어야 하므로, physician은 '주치의'처럼 khealth 트리거에 없는 좁은 표현만 남긴다.
    triggers: ['의사와 직접 상담', '주치의'],
  },
  dentist: {
    label: '치과의사', icon: '🦷', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dentist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. GWP와 충돌 없음
    triggers: ['치과의사', '치과 진료', '충치', '임플란트'],
  },
  'traditional-medicine-doctor': {
    label: '한의사', icon: '🌿', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_traditional-medicine-doctor', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['한의사', '한방 진료', '침 치료', '한약'],
  },
  pharmacist: {
    label: '약사', icon: '💊', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_pharmacist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. khealth의 '처방'과 일부 겹치나 '조제'는 약사 고유 업무라
    // 유지
    triggers: ['약사', '약 조제', '처방약 문의'],
  },
  veterinarian: {
    label: '수의사', icon: '🐾', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_veterinarian', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['수의사', '반려동물 진료', '동물병원'],
  },
  nurse: {
    label: '간호사', icon: '👩‍⚕️', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_nurse', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(전문간호사↔간호사) — 일반 업무 범위만
    triggers: ['간호사', '간호 상담'],
  },
  'physical-therapist': {
    label: '물리치료사', icon: '💪', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physical-therapist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(물리치료사↔작업치료사) 구분 키워드 — '운동' 중심
    triggers: ['물리치료사', '물리치료', '운동 재활'],
  },
  'medical-lab-technologist': {
    label: '임상병리사', icon: '🔬', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_medical-lab-technologist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(방사선사↔임상병리사) 구분 — 검체·혈액 중심
    triggers: ['임상병리사', '혈액검사', '검체검사'],
  },
  'radiologic-technologist': {
    label: '방사선사', icon: '📡', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_radiologic-technologist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 — 영상촬영 중심
    triggers: ['방사선사', '엑스레이', 'CT 촬영', '방사선 촬영'],
  },
  'dental-hygienist': {
    label: '치과위생사', icon: '🦷', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dental-hygienist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(치과기공사↔치과위생사) 구분 키워드 그대로 — '잇몸·스케일링'
    triggers: ['치과위생사', '스케일링', '잇몸 관리'],
  },
  'occupational-therapist': {
    label: '작업치료사', icon: '🧠', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_occupational-therapist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 — '일상생활 동작'
    triggers: ['작업치료사', '일상생활 동작 훈련', '작업치료'],
  },
  'dental-technician': {
    label: '치과기공사', icon: '🦷', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dental-technician', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 그대로 — '보철·틀니'
    triggers: ['치과기공사', '보철 제작', '틀니 제작'],
  },
  'advanced-practice-nurse': {
    label: '전문간호사', icon: '💉', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_advanced-practice-nurse', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 — 일반 간호사와 구분되는 '전문' 명시적 언급이 있을 때만
    triggers: ['전문간호사', '전문 간호'],
  },
  dietitian: {
    label: '영양사', icon: '🥗', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_dietitian', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 D범주('한달 간 식단을 작성해 줘', 주피터 원 예시) 직접 커버
    triggers: ['영양사', '식단 상담', '식단 작성', '영양 상담'],
  },
  // 2026-07-17 신설(사고실험 #50) — kemergency(GWP, 실제 R0 신고·출동 연계)와
  // 이름이 격치므로 SP 본문 상단에 역할 분리를 명시. 이 페르소나는 평시
  // 교육용이며, 실제 응급 신호 감지 시 R0이 최우선 적용되어 이 페르소나
  // 세션 여부와 무관하게 kemergency 트리거로 전환된다.
  paramedic: {
    label: '응급구조사', icon: '🚑', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_paramedic', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. 실제 응급상황은 kemergency(119)가 우선 — 이
    // 페르소나는 사전 상담용으로 한정
    triggers: ['응급구조사', '응급처치'],
  },
  midwife: {
    label: '조산사', icon: '🤱', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_midwife', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['조산사', '출산 조력', '분만 지원'],
  },
  'speech-language-pathologist': {
    label: '언어재활사', icon: '🗣️', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_speech-language-pathologist', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['언어재활사', '언어재활', '발음 교정'],
  },
  optician: {
    label: '안경사', icon: '👓', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_optician', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('안경을 맞추고 싶어') 직접 커버
    triggers: ['안경사', '안경을 맞추고 싶어', '시력 측정'],
  },
  sanitarian: {
    label: '위생사', icon: '🧼', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_sanitarian', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['위생사', '위생 점검', '식품위생'],
  },
  'health-educator': {
    label: '보건교육사', icon: '📢', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_health-educator', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명 위주 — 실사용 빈도 낮을 것으로 예상, 최소 트리거
    triggers: ['보건교육사', '보건교육'],
  },

  // ── 교육·상담·문화 (SP-EDU-01~06) ────────────────────
  teacher: {
    label: '교사(정교사)', icon: '👩‍🏫', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_teacher', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — '과외 선생님'은 안 넣음 — teacher는 학교 정교사이지 사교육 과외교사가
    // 아니다(99건 사고실험에서 확인된 진짜 공백, 트리거로 못 메움)
    triggers: ['정교사', '학교 선생님', '담임'],
  },
  // ── professor 정식 등록 (2026-07-26 결정) ──────────────────
  // 배경: 옛 school 저장소(K-School 브랜드) desktop.html의 "유치원부터
  // 대학원까지 전 과목을 가르치는 나만의 전담 AI 교수" 컨셉을, 60개
  // 페르소나 전부가 따르는 "실제 자격 기반 자문·지도" 원칙에 맞춰 이
  // registry에 정식 등록한다(위 TODO에서 논의된 두 방향 중 (1) 선택).
  // K-Doctor(health/prompts/doctor.md)의 구조를 참고해 SP_professor를
  // 작성했다 — 단, K-Doctor와 달리 학습자와 직접 대화하는 서비스로
  // 설계했다(2026-07-26 확정). 세션 데이터는 동의 하에 K-School의 이중
  // PDV 소스 중 두 번째 소스(교수 페르소나 실제 평가)로 집계에 쓰일 수
  // 있다 — school/docs/K_SCHOOL_PUBLIC_EDUCATION_DATA_SYSTEM_v1_0.md §2.2 참고.
  professor: {
    label: '교수(1:1 맞춤교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor', needsMedicalSafety: false,
    // '과외 선생님'을 의도적으로 제외했던 teacher 항목과 달리, professor는
    // 바로 그 1:1 개인 맞춤 교육 역할을 정식으로 담당한다 — teacher(학교
    // 정교사, 생활지도 관점)와는 범위가 다르다.
    triggers: ['1:1 교습', '개인 교사', '맞춤 교육', 'AI 교수', '과외'],
  },
  // ── civil 정식 등록 (2026-07-26 결정) ───────────────────────
  // K-Doctor 구조를 그대로 참고 — 시민과 직접 대화하고 서류를 직접
  // 수취·평가하지만, 최종 행정처분은 항상 담당 공무원에게 있다(행정
  // 절차법 등 — 의료법 제27조에 대응하는 법적 근거). K-Public
  // (SP-10_kpublic, 라이브)이 1차 상담·서류검증·내부접수를 이미
  // 담당하므로, civil은 그 이후 단계(심사 의견 형성·공무원 제출)를
  // 맡는다 — K-Health/K-Doctor의 역할 분담과 동일 구조.
  // ⚠️ 실제 정부기관 전자제출은 아직 미구현(API 통로 개통 전) —
  // prompts/SP_civil_v1_0.md §5 정직 고지 참고.
  civil: {
    label: '민원 심사(K-Civil)', icon: '🏛️', category: 'GOV', ownerAgency: 'kpublic',
    key: 'SP_civil', needsMedicalSafety: false,
    triggers: ['민원 심사', '행정 심사', '요건 검토', 'K-Civil'],
  },
  // ── advisor 정식 등록 (2026-07-26 결정) ─────────────────────
  // K-Professor와 같은 구조(법령상 최종승인 강제 없음 — PROFESSIONAL-
  // common_v2_0.md Q2 기준) — 구매자와 직접 대화하며 가격공정성·구매
  // 필요성을 평가해 직접 조언한다. K-Market(SP-KMARKET, 라이브 —
  // 검색·비교·중개만 담당)이 안 하는 평가 기능을 새로 맡는다.
  // ⚠️ 가격비교용 실제 시장데이터 파이프라인 미구현 — prompts/
  // SP_advisor_v1_0.md §5 정직 고지 참고.
  advisor: {
    label: '구매자문(K-Advisor)', icon: '🔍', category: 'FIN', ownerAgency: 'kmarket',
    key: 'SP_advisor', needsMedicalSafety: false,
    triggers: ['가격 적정성', '이거 사도 될까', '가격 비교 평가', 'K-Advisor'],
  },
  'clinical-psychologist': {
    label: '임상심리사', icon: '🧑‍⚕️', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_clinical-psychologist', needsMedicalSafety: true, // 2026-07-04: 위기개입(M5) 상속 위해 true로 수정
    // 2026-07-25 신설(주피터 지시) — 인접쌍(임상심리사↔전문상담교사↔정신건강전문요원) — '심리검사'는 임상심리사 고유 업무.
    // '심리상담사'(통칭, 정식 자격명 아님)는 세 페르소나 모두에 동일하게 추가한다(2026-07-25 재검토) —
    // 어느 한쪽에만 넣으면 그쪽이 부당하게 우선권을 갖게 되고, 원래 이 통칭은 셋 중 무엇을 뜻하는지
    // 불분명해서 AGENT-COMMON의 기존 원칙("인접 쌍이 안 갈리면 확신도 게이트가 '아니오' — 되묻는다")이
    // 작동해야 하는 사례다. 세 곳 다 넣으면 셋 다 후보로 뜨면서 그 되묻기가 자연히 발동한다.
    triggers: ['임상심리사', '심리검사', '심리상담사'],
  },
  'school-counselor': {
    label: '전문상담교사', icon: '🛋️', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_school-counselor', needsMedicalSafety: true, // 2026-07-04: 상동
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 — '학교' 맥락. 99건 사고실험 I범주('학교폭력 상담') 커버.
    // '심리상담사'는 clinical-psychologist와 동일 이유로 추가(위 주석 참고).
    triggers: ['전문상담교사', '학교 상담', '학교폭력 상담', '심리상담사'],
  },
  'mental-health-professional': {
    label: '정신건강전문요원', icon: '💬', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_mental-health-professional', needsMedicalSafety: true, // 2026-07-04: 상동
    // 2026-07-25 신설(주피터 지시) — 인접쌍(정신건강전문요원↔사회복지사) 구분 키워드 그대로 — '정신건강 재활'.
    // '심리상담사'는 clinical-psychologist와 동일 이유로 추가(위 주석 참고).
    triggers: ['정신건강전문요원', '정신건강 재활', '심리상담사'],
  },
  // 2026-07-06 신설(SP-EDU-04) — 상담직 3개와 마찬가지로 위기개입 프로토콜(M5)
  // 상속 위해 needsMedicalSafety:true. category는 EDU 유지(복지 상담이 의료
  // 행위는 아니지만, 위기 신호 대응 원칙은 동일하게 필요).
  'social-worker': {
    label: '사회복지사', icon: '🤝', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_social-worker', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 그대로 — '복지제도·자원연계'. 지역행정 welfare 도메인과는
    // 별개(사회복지사는 개인 상담 전문가)
    triggers: ['사회복지사', '복지제도 상담', '자원연계'],
  },
  curator: {
    label: '학예사(큐레이터)', icon: '🎨', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_curator', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('박물관 학예사 상담') 커버
    triggers: ['학예사', '큐레이터', '전시 상담'],
  },
  librarian: {
    label: '사서', icon: '📖', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_librarian', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명 위주
    triggers: ['사서', '도서관 상담', '장서 문의'],
  },
  'youth-counselor': {
    label: '청소년상담사', icon: '🧑‍🤝‍🧑', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_youth-counselor', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['청소년상담사', '청소년 상담'],
  },
  'childcare-teacher': {
    label: '보육교사', icon: '🧸', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_childcare-teacher', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명 위주
    triggers: ['보육교사', '보육 상담'],
  },
  'lifelong-educator': {
    label: '평생교육사', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_lifelong-educator', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['평생교육사', '평생교육', '평생학습'],
  },

  // ── 공학·건설·해사 (SP-ENG-01~09) ────────────────────
  architect: {
    label: '건축사', icon: '🏗️', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_architect', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(건축사↔기술사) 구분 키워드 그대로 — '신축·설계'
    triggers: ['건축사', '건축 설계', '신축 설계'],
  },
  'professional-engineer': {
    label: '기술사', icon: '📐', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_professional-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍 구분 키워드 그대로 — '안전점검·안전진단'(기존 구조물)
    triggers: ['기술사', '안전점검', '구조 안전진단'],
  },
  'marine-pilot': {
    label: '도선사', icon: '⚓', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_marine-pilot', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(항해사↔도선사) — '도선' 고유 업무만
    triggers: ['도선사', '도선'],
  },
  'naval-architect': {
    label: '조선사', icon: '🚢', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_naval-architect', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(기관사↔조선사) 구분 키워드 그대로 — '건조·설계 단계'
    triggers: ['조선사', '선박 설계', '선박 건조'],
  },
  'navigation-officer': {
    label: '항해사', icon: '🧭', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_navigation-officer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(항해사↔도선사) — '운항' 고유 업무만
    triggers: ['항해사', '항해', '선박 운항'],
  },
  'marine-engineer': {
    label: '기관사(선박)', icon: '⚙️', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_marine-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 인접쌍(기관사↔조선사) 구분 키워드 그대로 — '운항 중 고장'
    triggers: ['기관사', '선박 고장', '선박 엔진'],
  },
  'industrial-safety-consultant': {
    label: '산업안전·보건지도사', icon: '🦺', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_industrial-safety-consultant', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['산업안전·보건지도사', '산업안전 컨설팅', '공장 안전점검'],
  },
  'weather-forecaster': {
    label: '기상예보사', icon: '🌤️', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_weather-forecaster', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — khealth GWP의 '기상청' 도메인과는 별개(민간 자문 페르소나) — 실사용 빈도
    // 낮을 것
    triggers: ['기상예보사', '기상 예보 상담'],
  },
  'fire-safety-manager': {
    label: '소방시설관리사', icon: '🧯', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_fire-safety-manager', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['소방시설관리사', '소방 점검', '소방시설 점검'],
  },
  'landscape-engineer': {
    label: '조경기술사', icon: '🌳', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_landscape-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 A범주('조경 설계를 의뢰') 직접 커버
    triggers: ['조경기술사', '조경 설계', '정원 설계'],
  },
  'surveying-engineer': {
    label: '측량 및 지형공간정보기술사', icon: '📐', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_surveying-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['측량 및 지형공간정보기술사', '측량', '지적측량'],
  },
  'electrical-safety-engineer': {
    label: '전기안전기술사', icon: '⚡', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_electrical-safety-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['전기안전기술사', '전기안전 점검'],
  },
  'gas-safety-engineer': {
    label: '가스기술사', icon: '🔥', category: 'ENG', ownerAgency: 'gopang',
    key: 'SP_gas-safety-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['가스기술사', '가스안전 점검'],
  },

  // ── 부동산 (SP-RE-01, 2026-07-06 신설) ────────────────
  // 2026-07-06 이전엔 이 카테고리 자체가 없었음 — 전문가 페르소나 누락
  // 감사에서 확인된 가장 큰 신규 카테고리 공백.
  'real-estate-agent': {
    label: '공인중개사', icon: '🏠', category: 'REAL_ESTATE', ownerAgency: 'kestate',
    key: 'SP_real-estate-agent', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 정책 반영 — 예전 '공인중개사·매매 매물'은 kestate와 동일 문자열이라 삭제.
    // kestate가 '탐색·등록·중개연결'을 이미 폭넓게 담당하므로, 이 페르소나는 '중개 계약 체결 자체를 이 사람에게 직접
    // 맡기겠다'는 명확한 위임의도 구만 남긴다.
    triggers: ['공인중개사에게 직접 의뢰', '중개 계약 체결', '임대차 중개'],
  },

  'security-engineer': {
    label: '정보보안전문가', icon: '🔒', category: 'IT', ownerAgency: 'ksecurity',
    key: 'SP_security-engineer', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — ksecurity GWP(내부 운영자용으로 추정)와 역할이 다를 수 있음 — 이
    // 페르소나는 일반 사용자 상담용, 트리거 충돌 없음
    triggers: ['정보보안전문가', '개인정보 침해', '해킹 피해'],
  },
  'translator-interpreter': {
    label: '통역사·번역사', icon: '🌐', category: 'TRANSLATION', ownerAgency: 'gopang',
    key: 'SP_translator-interpreter', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('여행 통역사를 구해줘') 커버
    triggers: ['통역사', '번역사', '여행 통역사', '번역 의뢰'],
  },
  'tour-guide': {
    label: '관광통역안내사', icon: '🗺️', category: 'TOURISM', ownerAgency: 'gopang',
    key: 'SP_tour-guide', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명
    triggers: ['관광통역안내사', '여행 가이드', '관광 안내'],
  },
  'sports-instructor': {
    label: '생활스포츠지도사', icon: '🏃', category: 'SPORTS', ownerAgency: 'gopang',
    key: 'SP_sports-instructor', needsMedicalSafety: true,
    // 2026-07-25 신설(주피터 지시) — 99건 사고실험 I범주('스포츠 지도사와 상담') 커버
    triggers: ['생활스포츠지도사', '스포츠 지도', '운동 코칭'],
  },
  hairdresser: {
    label: '미용사', icon: '💇', category: 'BEAUTY', ownerAgency: 'gopang',
    key: 'SP_hairdresser', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — kcommerce GWP의 '미용실 예약'과는 역할이 다름(예약=kcommerce,
    // 전문 상담=이 페르소나)
    triggers: ['미용사', '헤어 상담'],
  },
  chef: {
    label: '조리사', icon: '👨‍🍳', category: 'CULINARY', ownerAgency: 'gopang',
    key: 'SP_chef', needsMedicalSafety: false,
    // 2026-07-25 신설(주피터 지시) — 직업명+법정업무명. kcommerce의 '음식 주문'과는 무관(조리사 자문 전용)
    triggers: ['조리사', '요리 상담', '메뉴 개발'],
  },
};

export function getExpertDef(personaId) {
  return EXPERT_REGISTRY[personaId] || null;
}

// BUG-FIX(2026-07-03): GWP_REGISTRY와 동일한 문제 — AGENT-COMMON SP는
// [EXPERT: SP-LAW-01] 같은 형식을 예시로 가르쳤지만 실제 키는 'lawyer'
// 같은 kebab-case 직업군 슬러그다. SP는 이제 정답 표를 갖도록 고쳤지만
// (아래 §9), 모델이 그래도 실수로 흔한 오표기를 낼 가능성에 대비해
// 별칭 해석 안전망을 둔다.
const EXPERT_ID_ALIAS = {
  'SP-LAW-01': 'lawyer',
  lawyer_ai: 'lawyer', attorney: 'lawyer',
  vet: 'veterinarian',
  pt: 'physical-therapist',
  physicaltherapist: 'physical-therapist',
  nutritionist: 'dietitian',
  psychologist: 'clinical-psychologist',
  counselor: 'school-counselor',
  // 2026-07-06 신설 8개의 흔한 대체 표기
  doctor: 'physician', 'medical-doctor': 'physician', physician_ai: 'physician',
  dentist_ai: 'dentist',
  'tcm-doctor': 'traditional-medicine-doctor', 'oriental-medicine-doctor': 'traditional-medicine-doctor',
  pharmacist_ai: 'pharmacist',
  cpa: 'accountant', 'certified-public-accountant': 'accountant',
  'realtor': 'real-estate-agent', 'real-estate': 'real-estate-agent',
  'social-worker-ai': 'social-worker',
  // 2026-07-17 신설 5개 페르소나의 흔한 대체 표기
  'afpk': 'financial-planner', 'cfp': 'financial-planner', 'financial-advisor': 'financial-planner',
  'property-appraiser': 'appraiser', 'valuation-appraiser': 'appraiser',
  'insurance-adjuster': 'loss-adjuster',
  'labor-consultant': 'labor-attorney', 'employment-attorney': 'labor-attorney',
  'emt': 'paramedic', 'emergency-medical-technician': 'paramedic',
  'patent-agent': 'patent-attorney', 'ip-attorney': 'patent-attorney',
  'customs-agent': 'customs-broker',
  'midwife-ai': 'midwife',
  'speech-therapist': 'speech-language-pathologist', 'slp': 'speech-language-pathologist',
  'optometrist': 'optician',
  'hygienist': 'sanitarian',
  'youth-counselor-ai': 'youth-counselor',
  'daycare-teacher': 'childcare-teacher', 'preschool-teacher': 'childcare-teacher',
  'lifelong-education-instructor': 'lifelong-educator',
  'landscape-architect-eng': 'landscape-engineer',
  'surveyor': 'surveying-engineer', 'geospatial-engineer': 'surveying-engineer',
  'electrical-engineer-safety': 'electrical-safety-engineer',
  'gas-engineer': 'gas-safety-engineer',
  'security-expert': 'security-engineer', 'infosec': 'security-engineer', 'cybersecurity-expert': 'security-engineer',
  'translator': 'translator-interpreter', 'interpreter': 'translator-interpreter',
  'tourist-guide': 'tour-guide', 'travel-guide': 'tour-guide',
  'fitness-instructor': 'sports-instructor', 'personal-trainer': 'sports-instructor',
  'hair-stylist': 'hairdresser', 'hairstylist': 'hairdresser',
  'cook': 'chef', 'baker': 'chef', 'culinary-chef': 'chef',
  'health-education-specialist': 'health-educator', 'public-health-educator': 'health-educator',
};

export function resolveExpertId(personaId) {
  if (!personaId) return null;
  // 1) 원문 그대로 매치 — SP-LAW-01처럼 원래 대문자인 별칭 키를 우선 존중
  if (EXPERT_REGISTRY[personaId]) return personaId;
  if (EXPERT_ID_ALIAS[personaId]) return EXPERT_ID_ALIAS[personaId];

  // 2) 대소문자 무관 매치 (2026-07-06 — 사고실험 100건 #98~100에서 실증된
  //    버그 수정: 'ATTORNEY'/'Vet'/'Counselor' 같은 변형이 일반 객체 키
  //    조회라 조용히 null이 되던 것. registry/alias 키를 소문자로도 한 번
  //    더 비교한다 — 값(personaId 자체)은 이미 소문자 kebab-case이므로
  //    별도 변환 불필요.)
  const lower = personaId.toLowerCase();
  for (const key of Object.keys(EXPERT_REGISTRY)) {
    if (key.toLowerCase() === lower) return key;
  }
  for (const key of Object.keys(EXPERT_ID_ALIAS)) {
    if (key.toLowerCase() === lower) return EXPERT_ID_ALIAS[key];
  }
  return null;
}

// ── 2026-07-03: 전문가 페르소나도 GWP 서비스처럼 "별도 새 탭"으로 연다 ──
// 이전에는 별도 서비스가 없다는 이유로 "같은 스레드 안에서 System Prompt만
// 교체"하는 방식(expert-session.js의 startExpertSession)을 썼다. 문제는:
// (1) 사용자가 그림자 AI와 나누던 대화 스레드 자체가 전문가 페르소나로
// 바뀌어버려서, 세션이 끝나고 그림자 AI로 복원되기 전까지는 사용자가 지금
// 누구와 대화 중인지 UI상 구분이 흐릿했다. (2) GWP 기관 서비스와 호출
// 경험이 이원화되어 있었다(하나는 새 탭, 하나는 같은 창) — 사용자 입장에서
// 일관성이 없다. 이제 모든 전문가 페르소나를 하나의 공용 페이지
// (pages/expert-chat.html)에서 persona 쿼리 파라미터로 SP만 갈아끼워
// 서빙하고, GWP와 동일하게 _gwpLaunch()로 새 탭을 연다.
const EXPERT_CHAT_BASE_URL = 'https://hondi.net/pages/expert-chat.html';

export function getExpertGwpDef(personaId) {
  const def = EXPERT_REGISTRY[personaId];
  if (!def) return null;
  return {
    id:   personaId,
    name: def.label,
    icon: def.icon,
    url:  `${EXPERT_CHAT_BASE_URL}?persona=${encodeURIComponent(personaId)}`,
  };
}
