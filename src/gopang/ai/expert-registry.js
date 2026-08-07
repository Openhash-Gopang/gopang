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
export const EXPERT_BASE_KEY           = 'SP_EXPERT_BASE'; // 2026-08-07 신설(HANDOFF
// SP-EXPERT-BASE-전체롤아웃계획 §6-1) — SP_EXPERT_BASE_v1_0.md(SP-COMMON-06,
// 법무사·변호사·감정평가사·세무사 4개 실사검증 페르소나에서 추출한 STEP 골격
// 스캐폴드). COMMON_GUARDRAILS_KEY·COMMON_MEDICAL_SAFETY_KEY와 동일한 원문
// 로드(_loadSpRawByKey) 패턴을 따른다 — 개별 SP는 이 문서가 이미 정의한
// STEP 0-(-1)/STEP R 본체/STEP D 본체/C50 NEXT_STEP을 재서술하지 않는다.

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
    // 2026-08-01 추가 정정 — scenarios_regression_R1_20260801.json 재검증에서
    // '억울한 일'이 과잉발동의 주범으로 지목됐다("회사에서 갑자기 나가라고
    // 하는데 이거 정당한 건지 판단 좀 받고 싶어"처럼 '변호사'라는 단어가
    // 전혀 없는 klaw 사안에도 이 트리거가 의미적으로 걸려 lawyer가 klaw를
    // 이겨버림 — 이 문구가 사실상 "법적으로 불만족스러운 모든 상황"과
    // 동의어라 트리거로서 너무 넓었다). 제거한다. judicial-scrivener처럼
    // "경매"가 리터럴로 있어도 lawyer로 새는 사례도 관찰됐는데, 그건
    // 트리거 목록 문제가 아니라 "법률=변호사"라는 모델의 기본 연상
    // 편향이라 트리거 축소만으론 못 잡는다 — AC-PRO-CORE §CATALOG-EXPERT
    // 위에 별도 경고 문구로 대응한다(gwp-registry.js/AC-PRO-CORE 참고).
    triggers: ['변호사 선임', '변호사에게 맡기고 싶어', '변호사 상담', '법적 조치'],
  },
  'lawyer-criminal': {
    label: '변호사(형사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-criminal', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(SP_EXPERT_BASE §5 세부분야 + §5-1 동적 자문 호출)
    triggers: ['형사법 상담', '형사 전문 변호사'],
  },
  'lawyer-civil': {
    label: '변호사(민사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-civil', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['민사법 상담', '민사 전문 변호사'],
  },
  'lawyer-corporate': {
    label: '변호사(기업법무)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-corporate', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['기업법무 상담', '기업 전문 변호사', 'M&A 법률 자문'],
  },
  'lawyer-family': {
    label: '변호사(가사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-family', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치1)
    triggers: ['가사법 상담', '이혼 전문 변호사', '양육권 상담'],
  },
  'lawyer-inheritance': {
    label: '변호사(상속)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-inheritance', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['상속 전문 변호사', '유류분 상담', '상속포기 상담'],
  },
  'lawyer-realestate': {
    label: '변호사(부동산)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-realestate', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['부동산 전문 변호사', '임대차 분쟁 상담'],
  },
  'lawyer-traffic': {
    label: '변호사(교통사고)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-traffic', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['교통사고 전문 변호사'],
  },
  'lawyer-damages': {
    label: '변호사(손해배상)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-damages', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['손해배상 전문 변호사', '의료소송 상담'],
  },
  'lawyer-auction': {
    label: '변호사(등기·경매)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-auction', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['경매 전문 변호사', '명도소송 상담'],
  },
  'lawyer-commercial': {
    label: '변호사(상사법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-commercial', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치2)
    triggers: ['상사법 상담', '어음수표 소송'],
  },
  'lawyer-execution': {
    label: '변호사(민사집행)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-execution', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['민사집행 상담', '채권압류 상담'],
  },
  'lawyer-collection': {
    label: '변호사(채권추심)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-collection', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['채권추심 전문 변호사', '지급명령 상담'],
  },
  'lawyer-insolvency': {
    label: '변호사(도산)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-insolvency', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['법인회생 상담', '법인파산 상담', '기업회생 전문 변호사'],
  },
  'lawyer-securities': {
    label: '변호사(증권)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-securities', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['증권 전문 변호사', '불공정거래 대응'],
  },
  'lawyer-finance': {
    label: '변호사(금융)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-finance', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['금융 전문 변호사', '대출 약관 분쟁'],
  },
  'lawyer-insurance': {
    label: '변호사(보험)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-insurance', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['보험 전문 변호사', '보험금 지급거절 상담'],
  },
  'lawyer-government-contract': {
    label: '변호사(국가계약)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-government-contract', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['국가계약 상담', '입찰 무효 상담', '부정당업자 제재'],
  },
  'lawyer-antitrust': {
    label: '변호사(공정거래)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-antitrust', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['공정거래 전문 변호사', '가맹사업 분쟁'],
  },
  'lawyer-military': {
    label: '변호사(군형법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-military', needsMedicalSafety: false,
    parentKey: 'lawyer', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치3)
    triggers: ['군형법 상담', '군사법원 변호사'],
  },
  'lawyer-juvenile': {
    label: '변호사(소년법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-juvenile', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['소년법 상담', '소년보호사건 변호사'],
  },
  'lawyer-administrative': {
    label: '변호사(행정법)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-administrative', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['행정법 상담', '행정소송 전문 변호사', '영업정지 이의'],
  },
  'lawyer-constitutional': {
    label: '변호사(헌법재판)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-constitutional', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['헌법소원 상담', '헌법재판 전문 변호사'],
  },
  'lawyer-environmental': {
    label: '변호사(환경)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-environmental', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['환경 전문 변호사', '환경오염 손해배상'],
  },
  'lawyer-expropriation': {
    label: '변호사(수용 및 보상)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-expropriation', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['토지수용 상담', '보상금 소송 변호사'],
  },
  'lawyer-foodpharma': {
    label: '변호사(식품·의약)', icon: '⚖️', category: 'LAW', ownerAgency: 'klaw',
    key: 'SP_lawyer-foodpharma', needsMedicalSafety: false,
    parentKey: 'lawyer',
    triggers: ['식품 의약 전문 변호사', '제조물책임 소송'],
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
  'physician-internal-medicine': {
    label: '의사(내과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-internal-medicine', needsMedicalSafety: true,
    parentKey: 'physician', // 2026-08-07 신설(SP_EXPERT_BASE §5 세부분야 착수) —
    // §6-4 parentKey 재귀 조립의 첫 실사용 사례. EXPERT_BASE → physician(부모)
    // → 이 자식 순서로 조립된다.
    triggers: ['내과 상담', '내과 전문의'],
  },
  'physician-surgery': {
    label: '의사(외과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-surgery', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['외과 상담', '외과 전문의', '수술 상담'],
  },
  'physician-neurology': {
    label: '의사(신경과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-neurology', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['신경과 상담', '신경과 전문의'],
  },
  'physician-pediatrics': {
    label: '의사(소아청소년과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-pediatrics', needsMedicalSafety: true,
    parentKey: 'physician', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치1)
    triggers: ['소아청소년과 상담', '소아과 상담', '소아 전문의'],
  },
  'physician-obgyn': {
    label: '의사(산부인과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-obgyn', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['산부인과 상담', '산부인과 전문의'],
  },
  'physician-psychiatry': {
    label: '의사(정신건강의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-psychiatry', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['정신건강의학과 상담', '정신과 상담', '정신과 전문의'],
  },
  'physician-emergency': {
    label: '의사(응급의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-emergency', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['응급의학과 상담', '응급실 전문의'],
  },
  'physician-orthopedics': {
    label: '의사(정형외과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-orthopedics', needsMedicalSafety: true,
    parentKey: 'physician', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치4, 의사 배치2)
    triggers: ['정형외과 상담', '정형외과 전문의'],
  },
  'physician-cardiothoracic': {
    label: '의사(심장혈관흉부외과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-cardiothoracic', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['심장혈관흉부외과 상담', '흉부외과 전문의', '심장수술 상담'],
  },
  'physician-plastic': {
    label: '의사(성형외과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-plastic', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['성형외과 상담', '성형외과 전문의'],
  },
  'physician-anesthesiology': {
    label: '의사(마취통증의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-anesthesiology', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['마취통증의학과 상담', '통증클리닉 상담', '마취과 전문의'],
  },
  'physician-ophthalmology': {
    label: '의사(안과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-ophthalmology', needsMedicalSafety: true,
    parentKey: 'physician', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치5, 의사 배치3)
    triggers: ['안과 상담', '안과 전문의'],
  },
  'physician-ent': {
    label: '의사(이비인후과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-ent', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['이비인후과 상담', '이비인후과 전문의'],
  },
  'physician-dermatology': {
    label: '의사(피부과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-dermatology', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['피부과 상담', '피부과 전문의'],
  },
  'physician-urology': {
    label: '의사(비뇨의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-urology', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['비뇨의학과 상담', '비뇨기과 상담', '비뇨의학과 전문의'],
  },
  'physician-radiology': {
    label: '의사(영상의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-radiology', needsMedicalSafety: true,
    parentKey: 'physician', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치6, 의사 배치4)
    triggers: ['영상의학과 상담', 'X-ray 판독', 'CT 판독', 'MRI 판독'],
  },
  'physician-radiation-oncology': {
    label: '의사(방사선종양학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-radiation-oncology', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['방사선종양학과 상담', '방사선치료 상담'],
  },
  'physician-pathology': {
    label: '의사(병리과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-pathology', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['병리과 상담', '조직검사 결과', '병리 판독'],
  },
  'physician-lab-medicine': {
    label: '의사(진단검사의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-lab-medicine', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['진단검사의학과 상담', '혈액검사 결과 해석'],
  },
  'physician-nuclear-medicine': {
    label: '의사(핵의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-nuclear-medicine', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['핵의학과 상담', 'PET-CT 결과 해석'],
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
  'professor-semiconductor': {
    label: '교수(반도체공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-semiconductor', needsMedicalSafety: false,
    parentKey: 'professor', // 2026-08-07 신설(SP_EXPERT_BASE §5 세부분야 착수)
    // 2026-08-08 참고: 정부 표준분류체계(공공데이터포털 API 원문)상
    // 반도체공학(093)은 중계열 D-18 "재료" 소속이지만, 표준분류체계
    // 3단 계층화 배치1(언어·문학/인문학/사회과학/화학생명과학환경/
    // 수학물리천문지구)에 재료 중계열은 아직 없어 professor 직속으로
    // 유지한다 — 재료 중계열 신설 시 재소속 검토.
    triggers: ['반도체공학 지도', '반도체 교수'],
  },
  // ── 중계열(2단, professor의 자식이자 소계열의 부모) — 2026-08-08
  // 신설(표준분류체계 3단 계층화 배치1, N단 재귀 조립 §6-4 개정 첫
  // 실사용). 공공데이터포털 「한국대학교육협의회_대학 학과 정보」API
  // 원문(2025년) 기준 대계열/중계열/소계열 코드를 그대로 따른다.
  'professor-language-literature': {
    label: '교수(언어·문학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-language-literature', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [], // 중계열 자체는 직접 호출 대상 아님 — 소계열이 리프
  },
  'professor-humanities': {
    label: '교수(인문학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-humanities', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-socialscience': {
    label: '교수(사회과학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-socialscience', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-chembio': {
    label: '교수(화학·생명과학·환경 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chembio', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-mathphys': {
    label: '교수(수학·물리·천문·지구 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mathphys', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 경영·경제(03)/법학(04) 중계열은 배치1 범위 밖이라 아직 신설
  // 안 함 — 그래서 law/economics는 잠정적으로 professor 직속 유지
  // (배치에서 경영·경제/법학 중계열을 만들 때 재소속 예정).
  'professor-law': {
    label: '교수(법학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-law', needsMedicalSafety: false,
    parentKey: 'professor', // 법학(04) 중계열 아직 미신설 — professor 직속 유지(배치2 범위 밖)
    triggers: ['법학 지도', '법학 교수', '로스쿨 지도'],
  },
  // ── 중계열(2단) 배치2 신설 4개 ─────────────────────────────
  'professor-business-economics': {
    label: '교수(경영·경제 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-business-economics', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-electrical-computer': {
    label: '교수(전기·전자·컴퓨터 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electrical-computer', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-mechanical': {
    label: '교수(기계 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechanical', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-construction': {
    label: '교수(건설 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-construction', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-economics': {
    label: '교수(경제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-economics', needsMedicalSafety: false,
    // 2026-08-08 배치2: professor 직속 → 경영·경제(03) 중계열로 재소속
    // (배치1 커밋 메시지에서 예고했던 마이그레이션, 이번에 처리)
    parentKey: 'professor-business-economics',
    triggers: ['경제학 지도', '경제학 교수'],
  },
  // ── 소계열(3단, 리프) — 배치1: 수능 5개 교과(국어/수학/영어/한국사/
  // 탐구) 대응 핵심 13개. 표준분류체계 코드는 각 SP 파일 헤더 참고.
  'professor-korean': {
    label: '교수(국어·국문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-korean', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['국어 지도', '국문학 지도', '국어 교수'],
  },
  'professor-english': {
    label: '교수(영어·영문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-english', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['영어 지도', '영문학 지도', '영어 교수', '토플 지도', '아이엘츠 지도'],
  },
  'professor-history': {
    label: '교수(역사·고고학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-history', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['한국사 지도', '세계사 지도', '역사 교수', '고고학 지도'],
  },
  'professor-ethics': {
    label: '교수(철학·윤리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ethics', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['철학 지도', '윤리 지도', '생활과 윤리 지도', '윤리와 사상 지도'],
  },
  'professor-politics': {
    label: '교수(정치외교학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-politics', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['정치와 법 지도', '정치외교학 지도', '국제관계 지도'],
  },
  'professor-sociology': {
    label: '교수(사회학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-sociology', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['사회문화 지도', '사회학 지도'],
  },
  'professor-geography': {
    label: '교수(도시·지역·지리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-geography', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['한국지리 지도', '세계지리 지도', '지리학 지도', '도시지리 지도'],
  },
  'professor-physics': {
    label: '교수(물리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physics', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['물리학 지도', '물리 교수'],
  },
  'professor-chemistry': {
    label: '교수(화학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chemistry', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: ['화학 지도', '화학 교수'],
  },
  'professor-biology': {
    label: '교수(생명과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biology', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: ['생명과학 지도', '생물 교수'],
  },
  'professor-earthscience': {
    label: '교수(지구·지질학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-earthscience', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['지구과학 지도', '지질학 지도'],
  },
  'professor-math': {
    label: '교수(수학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-math', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['수학 지도', '수학 교수'],
  },
  'professor-statistics': {
    label: '교수(통계학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-statistics', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['통계학 지도', '확률과 통계 지도'],
  },
  // ── 소계열(3단, 리프) 배치2: 인기 전공 12개 ──────────────────
  'professor-business': {
    label: '교수(경영학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-business', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['경영학 지도', '경영학 교수', 'MBA 지도'],
  },
  'professor-mis': {
    label: '교수(경영정보학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mis', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['경영정보학 지도', 'MIS 지도'],
  },
  'professor-accounting': {
    label: '교수(회계·세무학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-accounting', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['회계학 지도', '세무학 지도', '회계사 시험 지도'],
  },
  'professor-psychology': {
    label: '교수(심리학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-psychology', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['심리학 지도', '심리학 교수'],
  },
  'professor-international': {
    label: '교수(국제학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-international', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['국제학 지도', '국제기구 지도', '지역학 지도'],
  },
  'professor-computerscience': {
    label: '교수(전산학·컴퓨터공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-computerscience', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['컴퓨터공학 지도', '전산학 지도', '알고리즘 지도', '코딩테스트 지도'],
  },
  'professor-software': {
    label: '교수(응용소프트웨어공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-software', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['소프트웨어공학 지도', '소프트웨어 아키텍처 지도'],
  },
  'professor-ai-engineering': {
    label: '교수(인공지능공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ai-engineering', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['인공지능공학 지도', '머신러닝 지도', '딥러닝 지도'],
  },
  'professor-electrical': {
    label: '교수(전기공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electrical', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['전기공학 지도', '전기기사 시험 지도'],
  },
  'professor-electronics': {
    label: '교수(전자공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-electronics', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['전자공학 지도', '전자회로 지도'],
  },
  'professor-mechanical-eng': {
    label: '교수(기계공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechanical-eng', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['기계공학 지도', '기계기사 시험 지도'],
  },
  'professor-architecture': {
    label: '교수(건축학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-architecture', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['건축학 지도', '건축설계 지도', '건축사 시험 지도'],
  },
  // ── civil(K-Civil) 폐기 (2026-08-05) ──────────────────────────
  // G18(STAFF_REVIEW_GATE) 스키마 원안이 이미 "summary는 기관 SP가
  // 채운다"고 정해뒀던 것과 SP_civil의 별도 EXPERT 페르소나 구조가
  // 어긋난다는 것을 재확인 — SP-10_kpublic(kgov) STEP D 상세(v3.14,
  // "예비 의견 형성")로 흡수하고 이 엔트리는 제거했다. 상세 경위는
  // prompts/DEPRECATED_SP_civil.txt 참조.
  // ── advisor 정식 등록 (2026-07-26 결정) ─────────────────────
  // K-Professor와 같은 구조(법령상 최종승인 강제 없음 — PROFESSIONAL-
  // common_v2_0.md Q2 기준) — 구매자와 직접 대화하며 가격공정성·구매
  // 필요성을 평가해 직접 조언한다. K-Market(SP-KMARKET, 라이브 —
  // 검색·비교·중개만 담당)이 안 하는 평가 기능을 새로 맡는다.
  // ⚠️ 가격비교용 실제 시장데이터 파이프라인 미구현 — prompts/
  // SP_advisor_v1_0.md §5 정직 고지 참고.
  advisor: {
    label: '구매자문(K-Advisor)', icon: '🔍', category: 'FIN', ownerAgency: 'kcommerce',
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

// 2026-08-07 신설(내부 자문 호출 기능) — 부모 SP가 대화 중 "이 사안은
// 세부분야 전문의 소견이 필요하다"고 판단했을 때, 실제로 소환 가능한
// 자식 SP 목록을 역조회한다. `parentKey`는 이미 §5(세부분야 상속)에서
// 정적 조립(EXPERT_BASE→부모→자식)에 쓰이고 있었는데, 이 함수는 그
// 동일한 관계를 동적 호출("자식을 부모 자리에서 아예 로드"가 아니라
// "부모가 대화를 이어가며 자식에게 좁은 질문 하나만 던지고 소견만
// 받아오는") 정당성 검증에 재사용한다 — 등록되지 않은 임의의 페르소나를
// 자문 대상으로 호출하는 것을 막는 화이트리스트 역할.
export function getConsultableChildren(parentId) {
  return Object.entries(EXPERT_REGISTRY)
    .filter(([, def]) => def && def.parentKey === parentId)
    .map(([id, def]) => ({ id, label: def.label, key: def.key, needsMedicalSafety: !!def.needsMedicalSafety }));
}

// 위와 짝을 이루는 검증 함수 — childId가 실제로 parentId의 등록된
// 자식인지 확인한다(단순 truthy 체크가 아니라 정확한 관계 매칭).
export function isConsultableChild(parentId, childId) {
  const childDef = EXPERT_REGISTRY[childId];
  return !!(childDef && childDef.parentKey === parentId);
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
  // 2026-08-06 신설 — 라이브 재검증(패널 오케스트레이션) 중 실사로 발견:
  // K-Compose가 가족관계등록(출생신고 등) 적합성 확인을 위해 EXPERT
  // 위임을 낼 때 'kfam'이라는, 등록된 적 없는 ID를 스스로 지어냈다.
  // 전용 가족법 전문가 페르소나가 아직 없어 일반 변호사('lawyer')로
  // 대신 받도록 흔히 나올 법한 표기를 미리 별칭 처리한다. 다만 이건
  // '그럴듯한 오표기 안전망'일 뿐이라, 화이트리스트에도 없는 완전히
  // 새로운 이름을 지어내는 경우까지는 못 막는다 — 그 경우를 위한
  // 방어는 call-ai.js의 EXPERT(scope=orchestration_subtask) 처리부에
  // 별도로 추가했다(존재하지 않는 ID면 침묵하지 않고 K-Compose에게
  // 정정 요청을 되돌려준다).
  'kfam': 'lawyer', 'family-law': 'lawyer', 'family-law-attorney': 'lawyer',
  'civil-registration': 'lawyer', 'family-registration': 'lawyer',
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
