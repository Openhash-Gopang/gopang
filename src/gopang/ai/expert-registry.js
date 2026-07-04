/**
 * ai/expert-registry.js — 전문가 AI(26개 페르소나) 정적 레지스트리
 *
 * 전문 분야(기관) AI(K-Law·K-Tax 등)는 별도 URL을 가진 새 탭 서비스이지만,
 * 전문가 AI(변호사·간호사 등 개별 자격직)는 별도 서비스가 없는 "순수 System
 * Prompt" 페르소나다. 따라서 GWP_REGISTRY(새 탭 방식)에 넣지 않고, 이 레지스트리를
 * 통해 "같은 스레드 내 System Prompt 교체" 방식(expert-session.js)으로 호출한다.
 *
 * 분류(LAW/HEALTH/EDU/ENG)는 각 SP 파일 1행에 적힌 코드(SP-LAW-01 등)를 그대로
 * 따른다 — 임상심리사·정신건강전문요원·전문상담교사는 SP-EDU 코드를 부여받았으므로
 * (저자 의도상 HEALTH가 아님) 의료 안전 모듈을 추가하지 않는다.
 */

export const UNIVERSAL_INTEGRITY_URL   = '/prompts/UNIVERSAL-INTEGRITY_v1_0.md';
export const COMMON_GUARDRAILS_URL     = '/prompts/SP_common_guardrails_v3_2.md';
export const COMMON_MEDICAL_SAFETY_URL = '/prompts/SP_common_medical_safety_v1_1.md';

export const EXPERT_REGISTRY = {
  // ── 법률 ──────────────────────────────────────────────
  lawyer: {
    label: '변호사', icon: '⚖️', category: 'LAW',
    file: '/prompts/SP_lawyer_v3_1.md', needsMedicalSafety: false,
  },

  // ── 재무·세무 (SP-FIN-01, 2026-07-04 신설) ────────────
  'tax-accountant': {
    label: '세무사', icon: '🧾', category: 'FIN',
    file: '/prompts/SP_tax-accountant_v1_0.md', needsMedicalSafety: false,
  },

  // ── 의료·보건 (SP-HEALTH-06~15) ──────────────────────
  veterinarian: {
    label: '수의사', icon: '🐾', category: 'HEALTH',
    file: '/prompts/SP_veterinarian_v2_2.md', needsMedicalSafety: true,
  },
  nurse: {
    label: '간호사', icon: '👩‍⚕️', category: 'HEALTH',
    file: '/prompts/SP_nurse_v3_1.md', needsMedicalSafety: true,
  },
  'physical-therapist': {
    label: '물리치료사', icon: '💪', category: 'HEALTH',
    file: '/prompts/SP_physical-therapist_v3_1.md', needsMedicalSafety: true,
  },
  'medical-lab-technologist': {
    label: '임상병리사', icon: '🔬', category: 'HEALTH',
    file: '/prompts/SP_medical-lab-technologist_v3_1.md', needsMedicalSafety: true,
  },
  'radiologic-technologist': {
    label: '방사선사', icon: '📡', category: 'HEALTH',
    file: '/prompts/SP_radiologic-technologist_v3_1.md', needsMedicalSafety: true,
  },
  'dental-hygienist': {
    label: '치과위생사', icon: '🦷', category: 'HEALTH',
    file: '/prompts/SP_dental-hygienist_v3_1.md', needsMedicalSafety: true,
  },
  'occupational-therapist': {
    label: '작업치료사', icon: '🧠', category: 'HEALTH',
    file: '/prompts/SP_occupational-therapist_v3_1.md', needsMedicalSafety: true,
  },
  'dental-technician': {
    label: '치과기공사', icon: '🦷', category: 'HEALTH',
    file: '/prompts/SP_dental-technician_v3_1.md', needsMedicalSafety: true,
  },
  'advanced-practice-nurse': {
    label: '전문간호사', icon: '💉', category: 'HEALTH',
    file: '/prompts/SP_advanced-practice-nurse_v3_1.md', needsMedicalSafety: true,
  },
  dietitian: {
    label: '영양사', icon: '🥗', category: 'HEALTH',
    file: '/prompts/SP_dietitian_v3_1.md', needsMedicalSafety: true,
  },

  // ── 교육·상담·문화 (SP-EDU-01~06) ────────────────────
  teacher: {
    label: '교사(정교사)', icon: '👩‍🏫', category: 'EDU',
    file: '/prompts/SP_teacher_v2_2.md', needsMedicalSafety: false,
  },
  'clinical-psychologist': {
    label: '임상심리사', icon: '🧑‍⚕️', category: 'EDU',
    file: '/prompts/SP_clinical-psychologist_v2_2.md', needsMedicalSafety: false,
  },
  'school-counselor': {
    label: '전문상담교사', icon: '🛋️', category: 'EDU',
    file: '/prompts/SP_school-counselor_v2_2.md', needsMedicalSafety: false,
  },
  'mental-health-professional': {
    label: '정신건강전문요원', icon: '💬', category: 'EDU',
    file: '/prompts/SP_mental-health-professional_v2_2.md', needsMedicalSafety: false,
  },
  curator: {
    label: '학예사(큐레이터)', icon: '🎨', category: 'EDU',
    file: '/prompts/SP_curator_v2_2.md', needsMedicalSafety: false,
  },
  librarian: {
    label: '사서', icon: '📖', category: 'EDU',
    file: '/prompts/SP_librarian_v2_2.md', needsMedicalSafety: false,
  },

  // ── 공학·건설·해사 (SP-ENG-01~09) ────────────────────
  architect: {
    label: '건축사', icon: '🏗️', category: 'ENG',
    file: '/prompts/SP_architect_v2_2.md', needsMedicalSafety: false,
  },
  'professional-engineer': {
    label: '기술사', icon: '📐', category: 'ENG',
    file: '/prompts/SP_professional-engineer_v2_2.md', needsMedicalSafety: false,
  },
  'marine-pilot': {
    label: '도선사', icon: '⚓', category: 'ENG',
    file: '/prompts/SP_marine-pilot_v2_2.md', needsMedicalSafety: false,
  },
  'naval-architect': {
    label: '조선사', icon: '🚢', category: 'ENG',
    file: '/prompts/SP_naval-architect_v2_2.md', needsMedicalSafety: false,
  },
  'navigation-officer': {
    label: '항해사', icon: '🧭', category: 'ENG',
    file: '/prompts/SP_navigation-officer_v2_2.md', needsMedicalSafety: false,
  },
  'marine-engineer': {
    label: '기관사(선박)', icon: '⚙️', category: 'ENG',
    file: '/prompts/SP_marine-engineer_v2_2.md', needsMedicalSafety: false,
  },
  'industrial-safety-consultant': {
    label: '산업안전·보건지도사', icon: '🦺', category: 'ENG',
    file: '/prompts/SP_industrial-safety-consultant_v2_2.md', needsMedicalSafety: false,
  },
  'weather-forecaster': {
    label: '기상예보사', icon: '🌤️', category: 'ENG',
    file: '/prompts/SP_weather-forecaster_v2_2.md', needsMedicalSafety: false,
  },
  'fire-safety-manager': {
    label: '소방시설관리사', icon: '🧯', category: 'ENG',
    file: '/prompts/SP_fire-safety-manager_v2_2.md', needsMedicalSafety: false,
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
};

export function resolveExpertId(personaId) {
  if (!personaId) return null;
  if (EXPERT_REGISTRY[personaId]) return personaId;
  return EXPERT_ID_ALIAS[personaId] || null;
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
