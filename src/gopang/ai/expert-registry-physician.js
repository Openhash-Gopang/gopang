/**
 * ai/expert-registry-physician.js — 의사(physician) 세부분야 전용 레지스트리
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

export const PHYSICIAN_REGISTRY = {
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
  'physician-rehabilitation': {
    label: '의사(재활의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-rehabilitation', needsMedicalSafety: true,
    parentKey: 'physician', // 2026-08-07 신설(의사·변호사 세부분야 대폭확장 배치7, 의사 배치5, 의사 26개 확장 완료)
    triggers: ['재활의학과 상담', '재활의학과 전문의'],
  },
  'physician-preventive': {
    label: '의사(예방의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-preventive', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['예방의학과 상담', '건강검진 결과 상담'],
  },
  'physician-occupational': {
    label: '의사(직업환경의학과)', icon: '🩺', category: 'HEALTH', ownerAgency: 'khealth',
    key: 'SP_physician-occupational', needsMedicalSafety: true,
    parentKey: 'physician',
    triggers: ['직업환경의학과 상담', '산재 소견서', '직업병 상담'],
  },
};
