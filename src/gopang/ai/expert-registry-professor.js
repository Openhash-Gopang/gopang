/**
 * ai/expert-registry-professor.js — 교수(professor) 세부분야 전용 레지스트리
 *
 * 2026-08-08 신설(expert-registry.js 도메인 분리 리팩터링). 배경: 의사·
 * 변호사·교수 세부분야가 여러 세션에서 동시에 빠르게 확장되면서, 이
 * 세 도메인이 단일 expert-registry.js 파일을 공유해 병합 충돌(한 세션이
 * 다른 세션의 등록분을 알지 못한 채 덮어쓰는 사고)이 반복 발생했다 —
 * 이 파일 분리로 서로 다른 도메인을 다루는 세션끼리는 애초에 같은
 * 파일을 건드리지 않게 된다.
 *
 * 이 파일은 EXPERT_REGISTRY의 일부만 담당하는 partial이며, 최종
 * EXPERT_REGISTRY는 expert-registry.js가 이 파일들을 병합해서 만든다.
 * 이 파일 자체를 직접 import해서 쓰지 않는다 — 항상 expert-registry.js의
 * EXPERT_REGISTRY를 통해 접근한다(getExpertDef 등 헬퍼 함수도 동일).
 */

export const PROFESSOR_REGISTRY = {
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
    // 2026-08-08 배치5: professor 직속 → 재료(18) 중계열로 재소속
    // (배치1 시점부터 예고했던 마이그레이션 — 정부 표준분류체계상
    // 반도체공학(093)은 D-18 재료 소속. economics의 경영·경제
    // 중계열 재소속(배치2)과 동일 패턴으로 이번에 정리 완료)
    parentKey: 'professor-materials-series',
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
  // ── 중계열(2단) 배치3 신설 5개 (의료·보건계열) ──────────────
  'professor-nursing-series': {
    label: '교수(간호 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-nursing-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-publichealth-series': {
    label: '교수(보건 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-publichealth-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-pharmacy-series': {
    label: '교수(약학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-pharmacy-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-medicine-series': {
    label: '교수(의료 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-medicine-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-premedical-series': {
    label: '교수(의료예과 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-premedical-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치3: 의료·보건계열 17개 ──────────────
  'professor-nursing': {
    label: '교수(간호학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-nursing', needsMedicalSafety: false,
    parentKey: 'professor-nursing-series',
    triggers: ['간호학 지도', '간호사 국가고시 지도'],
  },
  'professor-publichealth': {
    label: '교수(보건학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-publichealth', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['보건학 지도', '역학 지도'],
  },
  'professor-rehabilitation': {
    label: '교수(재활치료)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-rehabilitation', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['물리치료학 지도', '작업치료학 지도'],
  },
  'professor-clinicalhealth': {
    label: '교수(임상보건)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-clinicalhealth', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['임상병리학 지도', '방사선학 지도'],
  },
  'professor-healthmgmt': {
    label: '교수(보건관리)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-healthmgmt', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['병원경영학 지도', '보건행정 지도'],
  },
  'professor-skincare': {
    label: '교수(피부미용)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-skincare', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['피부미용학 지도', '화장품학 지도'],
  },
  'professor-animalhealth': {
    label: '교수(동물보건)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-animalhealth', needsMedicalSafety: false,
    parentKey: 'professor-publichealth-series',
    triggers: ['동물보건사 지도', '동물간호학 지도'],
  },
  'professor-pharmacy': {
    label: '교수(약학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-pharmacy', needsMedicalSafety: false,
    parentKey: 'professor-pharmacy-series',
    triggers: ['약학 지도', '약사 국가고시 지도'],
  },
  'professor-herbalpharmacy': {
    label: '교수(한약학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-herbalpharmacy', needsMedicalSafety: false,
    parentKey: 'professor-pharmacy-series',
    triggers: ['한약학 지도', '본초학 지도'],
  },
  'professor-veterinary': {
    label: '교수(수의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-veterinary', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: ['수의학 지도', '수의사 국가고시 지도'],
  },
  'professor-medicine': {
    label: '교수(의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-medicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: ['의학 본과 지도', '의사 국가고시 지도'],
  },
  'professor-dentistry-academic': {
    label: '교수(치의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dentistry-academic', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: ['치의학 본과 지도', '치과의사 국가고시 지도'],
  },
  'professor-koreanmedicine': {
    label: '교수(한의학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-koreanmedicine', needsMedicalSafety: false,
    parentKey: 'professor-medicine-series',
    triggers: ['한의학 본과 지도', '한의사 국가고시 지도'],
  },
  'professor-premed': {
    label: '교수(의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-premed', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['의예과 지도', '의대 편입 지도'],
  },
  'professor-predental': {
    label: '교수(치의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-predental', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['치의예과 지도', '치의학전문대학원 편입 지도'],
  },
  'professor-prekoreanmed': {
    label: '교수(한의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-prekoreanmed', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['한의예과 지도', '한의학전문대학원 편입 지도'],
  },
  'professor-prevet': {
    label: '교수(수의예과)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-prevet', needsMedicalSafety: false,
    parentKey: 'professor-premedical-series',
    triggers: ['수의예과 지도', '수의학과 편입 지도'],
  },
  // ── 중계열(2단) 배치4 신설 5개 (예체능계열) ─────────────────
  'professor-dance-pe-series': {
    label: '교수(무용·체육 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dance-pe-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-theater-film-series': {
    label: '교수(연극·영화 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-theater-film-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-appliedarts-series': {
    label: '교수(응용예술 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-appliedarts-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-finearts-series': {
    label: '교수(미술 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-finearts-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-music-series': {
    label: '교수(음악 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-music-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치4: 예체능계열 22개 ─────────────────
  'professor-dance': {
    label: '교수(무용)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-dance', needsMedicalSafety: false,
    parentKey: 'professor-dance-pe-series',
    triggers: ['무용 지도', '무용과 입시 지도'],
  },
  'professor-physicaleducation': {
    label: '교수(체육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-physicaleducation', needsMedicalSafety: false,
    parentKey: 'professor-dance-pe-series',
    triggers: ['체육학 지도', '스포츠지도사 지도'],
  },
  'professor-theater': {
    label: '교수(연극)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-theater', needsMedicalSafety: false,
    parentKey: 'professor-theater-film-series',
    triggers: ['연극 지도', '연극영화과 지도'],
  },
  'professor-film': {
    label: '교수(영화)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-film', needsMedicalSafety: false,
    parentKey: 'professor-theater-film-series',
    triggers: ['영화 지도', '시나리오 작법 지도'],
  },
  'professor-broadcasting-entertainment': {
    label: '교수(방송연예)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-broadcasting-entertainment', needsMedicalSafety: false,
    parentKey: 'professor-theater-film-series',
    triggers: ['방송연예과 지도', '엔터테인먼트 산업 지도'],
  },
  'professor-photography': {
    label: '교수(사진)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-photography', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['사진학 지도', '사진 구도 이론 지도'],
  },
  'professor-comics': {
    label: '교수(만화)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-comics', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['만화 지도', '웹툰 창작 지도'],
  },
  'professor-animation': {
    label: '교수(애니메이션)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-animation', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['애니메이션 지도', '애니메이션 12원칙 지도'],
  },
  'professor-game': {
    label: '교수(게임)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-game', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['게임학 지도', '게임 기획 지도'],
  },
  'professor-videoart': {
    label: '교수(영상예술)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-videoart', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['영상예술 지도', '미디어아트 지도'],
  },
  'professor-sound': {
    label: '교수(음향)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-sound', needsMedicalSafety: false,
    parentKey: 'professor-appliedarts-series',
    triggers: ['음향학 지도', '믹싱·마스터링 지도'],
  },
  'professor-craft': {
    label: '교수(공예)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-craft', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['공예 지도', '도자·금속공예 지도'],
  },
  'professor-design': {
    label: '교수(디자인)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-design', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['디자인 지도', 'UX/UI 디자인 지도'],
  },
  'professor-finearts': {
    label: '교수(순수미술)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-finearts', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['회화·조소 지도', '미대 입시 실기이론 지도'],
  },
  'professor-appliedfinearts': {
    label: '교수(응용미술)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-appliedfinearts', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['응용미술 지도', '일러스트레이션 지도'],
  },
  'professor-arthistory': {
    label: '교수(미술학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-arthistory', needsMedicalSafety: false,
    parentKey: 'professor-finearts-series',
    triggers: ['미술사 지도', '미술비평 지도'],
  },
  'professor-composition': {
    label: '교수(작곡)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-composition', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['작곡 지도', '화성학 지도'],
  },
  'professor-vocal': {
    label: '교수(성악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-vocal', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['성악 지도', '발성 이론 지도'],
  },
  'professor-instrumental': {
    label: '교수(기악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-instrumental', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['기악 지도', '피아노·현악·관악 지도'],
  },
  'professor-koreanmusic': {
    label: '교수(국악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-koreanmusic', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['국악 지도', '판소리·장단 지도'],
  },
  'professor-contemporarymusic': {
    label: '교수(실용음악)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-contemporarymusic', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['실용음악 지도', '보컬·프로듀싱 지도'],
  },
  'professor-musicology': {
    label: '교수(음악학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-musicology', needsMedicalSafety: false,
    parentKey: 'professor-music-series',
    triggers: ['음악사 지도', '음악학 지도'],
  },
  // ── 중계열(2단) 배치5 신설 3개 (공학 확장) ───────────────────
  'professor-industrial-safety-series': {
    label: '교수(산업·안전 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-industrial-safety-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-materials-series': {
    label: '교수(재료 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-materials-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-chemeng-energy-series': {
    label: '교수(화공·고분자·에너지 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chemeng-energy-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치5: 공학 확장 26개 ──────────────────
  'professor-controlengineering': {
    label: '교수(제어계측공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-controlengineering', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['제어공학 지도', 'PID 제어 지도'],
  },
  'professor-optics': {
    label: '교수(광학공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-optics', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['광학공학 지도', '레이저공학 지도'],
  },
  'professor-biomedengineering': {
    label: '교수(의공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biomedengineering', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['의공학 지도', '의료영상 원리 지도'],
  },
  'professor-telecommunications': {
    label: '교수(정보·통신공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-telecommunications', needsMedicalSafety: false,
    parentKey: 'professor-electrical-computer',
    triggers: ['통신공학 지도', '네트워크 프로토콜 지도'],
  },
  'professor-architecturalengineering': {
    label: '교수(건축공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-architecturalengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['건축구조 지도', '건축시공학 지도'],
  },
  'professor-landscapearchitecture': {
    label: '교수(조경학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-landscapearchitecture', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['조경학 지도', '조경설계 지도'],
  },
  'professor-civilengineering': {
    label: '교수(토목공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-civilengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['토목공학 지도', '토질역학 지도'],
  },
  'professor-urbanengineering': {
    label: '교수(도시공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-urbanengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['도시공학 지도', '도시계획 이론 지도'],
  },
  'professor-environmentalengineering': {
    label: '교수(환경공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-environmentalengineering', needsMedicalSafety: false,
    parentKey: 'professor-construction',
    triggers: ['환경공학 지도', '수처리 공정 지도'],
  },
  'professor-industrialengineering': {
    label: '교수(산업공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-industrialengineering', needsMedicalSafety: false,
    parentKey: 'professor-industrial-safety-series',
    triggers: ['산업공학 지도', '품질관리 지도'],
  },
  'professor-safetyengineering': {
    label: '교수(안전공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-safetyengineering', needsMedicalSafety: false,
    parentKey: 'professor-industrial-safety-series',
    triggers: ['안전공학 지도', '산업안전기사 지도'],
  },
  'professor-disasterprevention': {
    label: '교수(방재공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-disasterprevention', needsMedicalSafety: false,
    parentKey: 'professor-industrial-safety-series',
    triggers: ['방재공학 지도', '화재공학 지도'],
  },
  'professor-metallurgy': {
    label: '교수(금속공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-metallurgy', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['금속공학 지도', '금속조직학 지도'],
  },
  'professor-newmaterials': {
    label: '교수(신소재공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-newmaterials', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['신소재공학 지도', '나노소재 지도'],
  },
  'professor-ceramics': {
    label: '교수(세라믹공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-ceramics', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['세라믹공학 지도', '소결 이론 지도'],
  },
  'professor-materials': {
    label: '교수(재료공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-materials', needsMedicalSafety: false,
    parentKey: 'professor-materials-series',
    triggers: ['재료공학 지도', '재료물성 지도'],
  },
  'professor-mechatronics': {
    label: '교수(메카트로닉스공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mechatronics', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['메카트로닉스 지도', '로봇공학 지도'],
  },
  'professor-navalengineering': {
    label: '교수(조선·해양공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-navalengineering', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['조선해양공학 지도', '선박유체역학 지도'],
  },
  'professor-aerospace': {
    label: '교수(항공·우주공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-aerospace', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['항공우주공학 지도', '항공역학 지도'],
  },
  'professor-railwayengineering': {
    label: '교수(철도공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-railwayengineering', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['철도공학 지도', '철도차량 공학 지도'],
  },
  'professor-automotive': {
    label: '교수(자동차공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-automotive', needsMedicalSafety: false,
    parentKey: 'professor-mechanical',
    triggers: ['자동차공학 지도', '엔진공학 지도'],
  },
  'professor-chemicalengineering': {
    label: '교수(화학공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chemicalengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['화학공학 지도', '반응공학 지도'],
  },
  'professor-energyengineering': {
    label: '교수(에너지공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-energyengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['에너지공학 지도', '신재생에너지 지도'],
  },
  'professor-polymerengineering': {
    label: '교수(고분자공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-polymerengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['고분자공학 지도', '고분자화학 지도'],
  },
  'professor-bioengineering': {
    label: '교수(생명공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-bioengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['생명공학 지도', '발효공학 지도'],
  },
  'professor-textileengineering': {
    label: '교수(섬유공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-textileengineering', needsMedicalSafety: false,
    parentKey: 'professor-chemeng-energy-series',
    triggers: ['섬유공학 지도', '섬유 소재 지도'],
  },
  // ── 중계열(2단) 배치6 신설 1개 (교육) ────────────────────────
  'professor-education-series': {
    label: '교수(교육 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-education-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치6: 사회·인문 확장(13) + 교육(11) 24개 ──
  'professor-religiousstudies': {
    label: '교수(종교학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-religiousstudies', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['종교학 지도', '비교종교학 지도'],
  },
  'professor-culturalstudies': {
    label: '교수(문화·민속·미술사학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-culturalstudies', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['민속학 지도', '문화사 지도'],
  },
  'professor-areastudies': {
    label: '교수(국제지역학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-areastudies', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['지역학 지도', '중국학·일본학 지도'],
  },
  'professor-generalhumanities': {
    label: '교수(교양인문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalhumanities', needsMedicalSafety: false,
    parentKey: 'professor-humanities',
    triggers: ['교양인문학 지도', '인문학 개론 지도'],
  },
  'professor-childfamilystudies': {
    label: '교수(아동·가족학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-childfamilystudies', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['아동가족학 지도', '아동발달 이론 지도'],
  },
  'professor-socialwelfare': {
    label: '교수(사회복지학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-socialwelfare', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['사회복지학 지도', '사회복지사 국가고시 지도'],
  },
  'professor-consumerscience': {
    label: '교수(소비자·가정자원)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-consumerscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['소비자학 지도', '가정경제관리 지도'],
  },
  'professor-mediastudies': {
    label: '교수(언론·방송·매체학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-mediastudies', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['언론학 지도', '저널리즘 이론 지도'],
  },
  'professor-publicadministration': {
    label: '교수(행정학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-publicadministration', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['행정학 지도', '공무원 시험(행정학) 지도'],
  },
  'professor-anthropology': {
    label: '교수(인류학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-anthropology', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['인류학 지도', '문화상대주의 지도'],
  },
  'professor-libraryscience': {
    label: '교수(문헌정보학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-libraryscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['문헌정보학 지도', '사서직 시험 지도'],
  },
  'professor-generalsocialscience': {
    label: '교수(교양사회과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalsocialscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['교양사회과학 지도', '사회과학 개론 지도'],
  },
  'professor-militaryscience': {
    label: '교수(군사·국방·안보)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-militaryscience', needsMedicalSafety: false,
    parentKey: 'professor-socialscience',
    triggers: ['군사학 지도', '안보전략 이론 지도'],
  },
  'professor-education': {
    label: '교수(교육학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-education', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['교육학 지도', '임용고시(교육학) 지도'],
  },
  'professor-languageeducation': {
    label: '교수(언어교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-languageeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['언어교수법 지도', '임용고시(언어교육) 지도'],
  },
  'professor-elementaryeducation': {
    label: '교수(초등교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-elementaryeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['초등교육 지도', '초등 임용고시 지도'],
  },
  'professor-socialstudieseducation': {
    label: '교수(사회과교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-socialstudieseducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['사회과교육 지도', '임용고시(사회) 지도'],
  },
  'professor-earlychildhoodeducation': {
    label: '교수(유아교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-earlychildhoodeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['유아교육 지도', '누리과정 지도'],
  },
  'professor-specialeducation': {
    label: '교수(특수교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-specialeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['특수교육 지도', '개별화교육계획 지도'],
  },
  'professor-scienceeducation': {
    label: '교수(자연과학교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-scienceeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['과학교육 지도', '임용고시(과학) 지도'],
  },
  'professor-healtheducation': {
    label: '교수(간호·보건 교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-healtheducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['보건교육 지도', '보건교사 임용고시 지도'],
  },
  'professor-artspeeducation': {
    label: '교수(예술·체육교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-artspeeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['예체능교육 지도', '임용고시(예체능) 지도'],
  },
  'professor-engineeringeducation': {
    label: '교수(공학교육)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-engineeringeducation', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['공업교육 지도', '임용고시(공업) 지도'],
  },
  'professor-generalengineering': {
    label: '교수(교양공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalengineering', needsMedicalSafety: false,
    parentKey: 'professor-education-series',
    triggers: ['교양공학 지도', '공학적 사고 입문 지도'],
  },
  // ── 중계열(2단) 배치7 신설 4개 (마지막 배치) ──────────────────
  'professor-agriculture-fishery-series': {
    label: '교수(농림·수산 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-agriculture-fishery-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-homeeconomics-series': {
    label: '교수(생활과학 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-homeeconomics-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-transportation-series': {
    label: '교수(교통·수송 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-transportation-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  'professor-misc-series': {
    label: '교수(기타 N.C.E 중계열)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-misc-series', needsMedicalSafety: false,
    parentKey: 'professor',
    triggers: [],
  },
  // ── 소계열(3단, 리프) 배치7: 마지막 배치 40개 ─────────────────
  'professor-linguistics': {
    label: '교수(언어학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-linguistics', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['언어학 지도', '통사론 지도'],
  },
  'professor-german': {
    label: '교수(독일어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-german', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['독일어 지도', '독어독문학 지도'],
  },
  'professor-russian': {
    label: '교수(러시아어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-russian', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['러시아어 지도', '노어노문학 지도'],
  },
  'professor-spanish': {
    label: '교수(스페인어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-spanish', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['스페인어 지도', '서어서문학 지도'],
  },
  'professor-japanese': {
    label: '교수(일본어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-japanese', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['일본어 지도', 'JLPT 지도'],
  },
  'professor-chinese': {
    label: '교수(중국어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-chinese', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['중국어 지도', 'HSK 지도'],
  },
  'professor-french': {
    label: '교수(프랑스어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-french', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['프랑스어 지도', '불어불문학 지도'],
  },
  'professor-otherasianlanguages': {
    label: '교수(기타아시아어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-otherasianlanguages', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['베트남어 지도', '아랍어 지도', '태국어 지도'],
  },
  'professor-othereuropeanlanguages': {
    label: '교수(기타유럽어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-othereuropeanlanguages', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['이탈리아어 지도', '포르투갈어 지도'],
  },
  'professor-generallanguage': {
    label: '교수(교양어·문학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generallanguage', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['교양외국어 지도', '여행회화 지도'],
  },
  'professor-creativewriting': {
    label: '교수(문예창작학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-creativewriting', needsMedicalSafety: false,
    parentKey: 'professor-language-literature',
    triggers: ['문예창작 지도', '소설·시 창작 지도'],
  },
  'professor-tradedistribution': {
    label: '교수(무역·유통학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-tradedistribution', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['무역학 지도', '유통관리론 지도'],
  },
  'professor-advertising': {
    label: '교수(광고·홍보학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-advertising', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['광고학 지도', 'PR전략 지도'],
  },
  'professor-tourism': {
    label: '교수(관광학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-tourism', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['관광경영학 지도', '호스피탈리티 지도'],
  },
  'professor-realestate': {
    label: '교수(부동산)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-realestate', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['부동산학 지도', '공인중개사 시험 지도'],
  },
  'professor-financeinsurance': {
    label: '교수(금융·보험학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-financeinsurance', needsMedicalSafety: false,
    parentKey: 'professor-business-economics',
    triggers: ['금융보험학 지도', '보험계리사 시험 지도'],
  },
  'professor-cropscience': {
    label: '교수(작물·원예학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-cropscience', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['원예학 지도', '작물육종 지도'],
  },
  'professor-forestry': {
    label: '교수(산림학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-forestry', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['산림학 지도', '산림생태학 지도'],
  },
  'professor-animalscience': {
    label: '교수(축산학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-animalscience', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['축산학 지도', '사양학 지도'],
  },
  'professor-fisheries': {
    label: '교수(수산학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-fisheries', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['수산학 지도', '양식학 지도'],
  },
  'professor-agroecology': {
    label: '교수(농림수산환경생태학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-agroecology', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['농생태학 지도', '지속가능농업 지도'],
  },
  'professor-agrobiosystems': {
    label: '교수(농림수산바이오시스템공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-agrobiosystems', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['생물시스템공학 지도', '스마트팜 지도'],
  },
  'professor-foodengineering': {
    label: '교수(식품공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-foodengineering', needsMedicalSafety: false,
    parentKey: 'professor-agriculture-fishery-series',
    triggers: ['식품공학 지도', '식품가공 지도'],
  },
  'professor-environmentalscience': {
    label: '교수(환경학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-environmentalscience', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: ['환경학 지도', '생태학 지도'],
  },
  'professor-biotechnology': {
    label: '교수(바이오테크놀로지학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-biotechnology', needsMedicalSafety: false,
    parentKey: 'professor-chembio',
    triggers: ['바이오테크놀로지 지도', '생명정보학 지도'],
  },
  'professor-nutrition': {
    label: '교수(식품영양학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-nutrition', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['영양학 지도', '영양사 국가고시 지도'],
  },
  'professor-culinaryscience': {
    label: '교수(조리과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-culinaryscience', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['조리과학 지도', '조리기능사 지도'],
  },
  'professor-clothing': {
    label: '교수(의류·의상학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-clothing', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['의류학 지도', '의복구성학 지도'],
  },
  'professor-housingstudies': {
    label: '교수(주거학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-housingstudies', needsMedicalSafety: false,
    parentKey: 'professor-homeeconomics-series',
    triggers: ['주거학 지도', '주거환경심리 지도'],
  },
  'professor-astronomy': {
    label: '교수(천문·대기과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-astronomy', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['천문학 지도', '대기과학 지도'],
  },
  'professor-oceanography': {
    label: '교수(해양학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-oceanography', needsMedicalSafety: false,
    parentKey: 'professor-mathphys',
    triggers: ['해양학 지도', '물리해양학 지도'],
  },
  'professor-trafficsystems': {
    label: '교수(교통시스템공학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-trafficsystems', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['교통공학 지도', '교통신호체계 지도'],
  },
  'professor-railwaycontrol': {
    label: '교수(철도운전제어학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-railwaycontrol', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['철도운전학 지도', '열차운전이론 지도'],
  },
  'professor-shipnavigation': {
    label: '교수(선박운항학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-shipnavigation', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['항해학 지도', '항해사 시험 지도'],
  },
  'professor-aviation': {
    label: '교수(항공운항학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-aviation', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['항공운항학 지도', '조종사 학과시험 지도'],
  },
  'professor-uav': {
    label: '교수(무인항공기(운항)학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-uav', needsMedicalSafety: false,
    parentKey: 'professor-transportation-series',
    triggers: ['드론학 지도', '초경량비행장치 자격시험 지도'],
  },
  'professor-secretarial': {
    label: '교수(비서)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-secretarial', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['비서학 지도', '비서 자격시험 지도'],
  },
  'professor-generalscience': {
    label: '교수(교양자연과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-generalscience', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['교양자연과학 지도', '과학 개론 지도'],
  },
  'professor-medicalscience': {
    label: '교수(의과학)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-medicalscience', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['의과학 지도', '중개연구방법론 지도'],
  },
  'professor-beautyart': {
    label: '교수(뷰티아트)', icon: '🎓', category: 'EDU', ownerAgency: 'kedu',
    key: 'SP_professor-beautyart', needsMedicalSafety: false,
    parentKey: 'professor-misc-series',
    triggers: ['뷰티아트 지도', '메이크업 색채이론 지도'],
  },
};
