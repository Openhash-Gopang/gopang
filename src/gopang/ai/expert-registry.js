/**
 * ai/expert-registry.js — 전문가 AI 정적 레지스트리
 *
 * 전문 분야(기관) AI(K-Law·K-Tax 등)는 별도 URL을 가진 새 탭 서비스이지만,
 * 전문가 AI(변호사·간호사 등 개별 자격직)는 별도 서비스가 없는 "순수 System
 * Prompt" 페르소나다. 따라서 GWP_REGISTRY(새 탭 방식)에 넣지 않고, 이 레지스트리를
 * 통해 "같은 스레드 내 System Prompt 교체" 방식(expert-session.js)으로 호출한다.
 *
 * 분류(LAW/HEALTH/EDU/ENG/FIN/REAL_ESTATE)는 각 SP 파일 1행에 적힌 코드(SP-LAW-01
 * 등)를 그대로 따른다. 임상심리사·정신건강전문요원·전문상담교사는 SP-EDU 코드를
 * 부여받아 category는 EDU를 유지하지만, needsMedicalSafety는 true다 — 2026-07-04에
 * 위기개입 프로토콜(SP-COMMON-03 M5, 자살·자해 대응)을 상속받도록 수정됐다(카테고리
 * 분류와 안전모듈 상속은 별개 기준).
 */

export const UNIVERSAL_INTEGRITY_KEY   = 'UNIVERSAL-INTEGRITY'; // 2026-07-09: 하드코딩 경로 -> manifest 키로 전환
// 2026-07-09: v3.3 → v3.6 갱신. v3.4~v3.6이 실제로는 이 상수가 안 바뀌어서
// 한 번도 로드된 적이 없었다(실사로 확인 — expert-session.js가 이 URL을
// fetch()로 직접 읽고, manifest.json을 거치지 않는 별도 체계이기 때문).
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
    label: '변호사', icon: '⚖️', category: 'LAW',
    key: 'SP_lawyer', needsMedicalSafety: false,
  },
  // 2026-07-06 신설(전문가 페르소나 누락 감사 결과) — 변호사와 다른 자격.
  // 업무범위(등기·경매·소액사건 등) 초과 시 lawyer로 안내하도록 SP 본문에 명시.
  'judicial-scrivener': {
    label: '법무사', icon: '📜', category: 'LAW',
    key: 'SP_judicial-scrivener', needsMedicalSafety: false,
  },

  // ── 재무·세무 (SP-FIN-01, 2026-07-04 신설) ────────────
  'tax-accountant': {
    label: '세무사', icon: '🧾', category: 'FIN',
    key: 'SP_tax-accountant', needsMedicalSafety: false,
  },
  // 2026-07-06 신설 — 세무사와 다른 자격(회계감사·재무제표 중심). 사고실험
  // #40에서 세무사로 오매핑될 위험이 확인된 항목.
  accountant: {
    label: '공인회계사', icon: '📊', category: 'FIN',
    key: 'SP_accountant', needsMedicalSafety: false,
  },

  // ── 의료·보건 (SP-HEALTH-06~15) ──────────────────────
  // 2026-07-06 신설(SP-HEALTH-16~19) — 의사·치과의사·한의사·약사. 다른 10개
  // 의료직이 전부 "확진·처방은 의사 영역"이라고 선을 긋는 구조라, 그 반대편을
  // 정의하는 이 4개는 특히 신중한 검토가 필요함(SP 본문 상단 주석 참조).
  physician: {
    label: '의사', icon: '🩺', category: 'HEALTH',
    key: 'SP_physician', needsMedicalSafety: true,
  },
  dentist: {
    label: '치과의사', icon: '🦷', category: 'HEALTH',
    key: 'SP_dentist', needsMedicalSafety: true,
  },
  'traditional-medicine-doctor': {
    label: '한의사', icon: '🌿', category: 'HEALTH',
    key: 'SP_traditional-medicine-doctor', needsMedicalSafety: true,
  },
  pharmacist: {
    label: '약사', icon: '💊', category: 'HEALTH',
    key: 'SP_pharmacist', needsMedicalSafety: true,
  },
  veterinarian: {
    label: '수의사', icon: '🐾', category: 'HEALTH',
    key: 'SP_veterinarian', needsMedicalSafety: true,
  },
  nurse: {
    label: '간호사', icon: '👩‍⚕️', category: 'HEALTH',
    key: 'SP_nurse', needsMedicalSafety: true,
  },
  'physical-therapist': {
    label: '물리치료사', icon: '💪', category: 'HEALTH',
    key: 'SP_physical-therapist', needsMedicalSafety: true,
  },
  'medical-lab-technologist': {
    label: '임상병리사', icon: '🔬', category: 'HEALTH',
    key: 'SP_medical-lab-technologist', needsMedicalSafety: true,
  },
  'radiologic-technologist': {
    label: '방사선사', icon: '📡', category: 'HEALTH',
    key: 'SP_radiologic-technologist', needsMedicalSafety: true,
  },
  'dental-hygienist': {
    label: '치과위생사', icon: '🦷', category: 'HEALTH',
    key: 'SP_dental-hygienist', needsMedicalSafety: true,
  },
  'occupational-therapist': {
    label: '작업치료사', icon: '🧠', category: 'HEALTH',
    key: 'SP_occupational-therapist', needsMedicalSafety: true,
  },
  'dental-technician': {
    label: '치과기공사', icon: '🦷', category: 'HEALTH',
    key: 'SP_dental-technician', needsMedicalSafety: true,
  },
  'advanced-practice-nurse': {
    label: '전문간호사', icon: '💉', category: 'HEALTH',
    key: 'SP_advanced-practice-nurse', needsMedicalSafety: true,
  },
  dietitian: {
    label: '영양사', icon: '🥗', category: 'HEALTH',
    key: 'SP_dietitian', needsMedicalSafety: true,
  },

  // ── 교육·상담·문화 (SP-EDU-01~06) ────────────────────
  teacher: {
    label: '교사(정교사)', icon: '👩‍🏫', category: 'EDU',
    key: 'SP_teacher', needsMedicalSafety: false,
  },
  'clinical-psychologist': {
    label: '임상심리사', icon: '🧑‍⚕️', category: 'EDU',
    key: 'SP_clinical-psychologist', needsMedicalSafety: true, // 2026-07-04: 위기개입(M5) 상속 위해 true로 수정
  },
  'school-counselor': {
    label: '전문상담교사', icon: '🛋️', category: 'EDU',
    key: 'SP_school-counselor', needsMedicalSafety: true, // 2026-07-04: 상동
  },
  'mental-health-professional': {
    label: '정신건강전문요원', icon: '💬', category: 'EDU',
    key: 'SP_mental-health-professional', needsMedicalSafety: true, // 2026-07-04: 상동
  },
  // 2026-07-06 신설(SP-EDU-04) — 상담직 3개와 마찬가지로 위기개입 프로토콜(M5)
  // 상속 위해 needsMedicalSafety:true. category는 EDU 유지(복지 상담이 의료
  // 행위는 아니지만, 위기 신호 대응 원칙은 동일하게 필요).
  'social-worker': {
    label: '사회복지사', icon: '🤝', category: 'EDU',
    key: 'SP_social-worker', needsMedicalSafety: true,
  },
  curator: {
    label: '학예사(큐레이터)', icon: '🎨', category: 'EDU',
    key: 'SP_curator', needsMedicalSafety: false,
  },
  librarian: {
    label: '사서', icon: '📖', category: 'EDU',
    key: 'SP_librarian', needsMedicalSafety: false,
  },

  // ── 공학·건설·해사 (SP-ENG-01~09) ────────────────────
  architect: {
    label: '건축사', icon: '🏗️', category: 'ENG',
    key: 'SP_architect', needsMedicalSafety: false,
  },
  'professional-engineer': {
    label: '기술사', icon: '📐', category: 'ENG',
    key: 'SP_professional-engineer', needsMedicalSafety: false,
  },
  'marine-pilot': {
    label: '도선사', icon: '⚓', category: 'ENG',
    key: 'SP_marine-pilot', needsMedicalSafety: false,
  },
  'naval-architect': {
    label: '조선사', icon: '🚢', category: 'ENG',
    key: 'SP_naval-architect', needsMedicalSafety: false,
  },
  'navigation-officer': {
    label: '항해사', icon: '🧭', category: 'ENG',
    key: 'SP_navigation-officer', needsMedicalSafety: false,
  },
  'marine-engineer': {
    label: '기관사(선박)', icon: '⚙️', category: 'ENG',
    key: 'SP_marine-engineer', needsMedicalSafety: false,
  },
  'industrial-safety-consultant': {
    label: '산업안전·보건지도사', icon: '🦺', category: 'ENG',
    key: 'SP_industrial-safety-consultant', needsMedicalSafety: false,
  },
  'weather-forecaster': {
    label: '기상예보사', icon: '🌤️', category: 'ENG',
    key: 'SP_weather-forecaster', needsMedicalSafety: false,
  },
  'fire-safety-manager': {
    label: '소방시설관리사', icon: '🧯', category: 'ENG',
    key: 'SP_fire-safety-manager', needsMedicalSafety: false,
  },

  // ── 부동산 (SP-RE-01, 2026-07-06 신설) ────────────────
  // 2026-07-06 이전엔 이 카테고리 자체가 없었음 — 전문가 페르소나 누락
  // 감사에서 확인된 가장 큰 신규 카테고리 공백.
  'real-estate-agent': {
    label: '공인중개사', icon: '🏠', category: 'REAL_ESTATE',
    key: 'SP_real-estate-agent', needsMedicalSafety: false,
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
