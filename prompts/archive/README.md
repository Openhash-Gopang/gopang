# prompts/archive/ — 폐기된 구버전 SP 모음

이 폴더는 `sp-catalog.json`이 더 이상 참조하지 않는 구버전 SP 원문을
보관합니다. **런타임에서 로드되지 않습니다** — 참고·감사·복구 목적으로만
남겨둡니다.

## 왜 여기 있는가
새 버전을 낼 때 `git mv` 대신 새 파일만 만들고 옛 파일을 지우지 않는
실수가 반복돼(tools/check_no_orphan_prompt_files.py 상단 주석 참조),
`prompts/` 루트에 카탈로그 미참조 고아 파일이 계속 쌓였습니다. 2026-07-29
전수조사로 발견된 것들을 이 폴더로 옮겨 정리했습니다.

## 현재 정본을 찾으려면
아래 표에서 구버전 파일명으로 찾으면, 이 정리 시점(2026-07-29) 기준
`sp-catalog.json`이 실제로 참조하던 최신 버전을 알 수 있습니다. **단,
그 이후 더 새 버전이 나왔을 수 있으니 최종 확인은 항상
`prompts/sp-catalog.json`에서 직접 하십시오** — 이 표는 스냅샷일 뿐
자동 갱신되지 않습니다.

| archive 파일 (구버전) | 2026-07-29 시점 sp-catalog.json 정본 |
|---|---|
| `SP_PDV_v1_1.md` | `SP_PDV_v1_2.md` |
| `SP_advanced-practice-nurse_v3_3.md` | `SP_advanced-practice-nurse_v3_4.md` |
| `SP_appraiser_v1_1.md` | `SP_appraiser_v1_2.md` |
| `SP_chef_v1_0.md` | `SP_chef_v1_2.md` |
| `SP_chef_v1_1.md` | `SP_chef_v1_2.md` |
| `SP_childcare-teacher_v1_0.md` | `SP_childcare-teacher_v1_2.md` |
| `SP_childcare-teacher_v1_1.md` | `SP_childcare-teacher_v1_2.md` |
| `SP_civil_v1_0.md` | `SP_civil_v2_0.md` |
| `SP_clinical-psychologist_v2_7.md` | `SP_clinical-psychologist_v2_9.md` |
| `SP_clinical-psychologist_v2_8.md` | `SP_clinical-psychologist_v2_9.md` |
| `SP_common_guardrails_v3_14.md` | `SP_common_guardrails_v3_18.md` |
| `SP_common_guardrails_v3_15.md` | `SP_common_guardrails_v3_18.md` |
| `SP_common_guardrails_v3_16.md` | `SP_common_guardrails_v3_18.md` |
| `SP_common_guardrails_v3_17.md` | `SP_common_guardrails_v3_18.md` |
| `SP_curator_v2_7.md` | `SP_curator_v2_8.md` |
| `SP_customs-broker_v1_1.md` | `SP_customs-broker_v1_2.md` |
| `SP_dental-hygienist_v3_3.md` | `SP_dental-hygienist_v3_4.md` |
| `SP_dental-technician_v3_3.md` | `SP_dental-technician_v3_4.md` |
| `SP_dentist_v1_3.md` | `SP_dentist_v1_4.md` |
| `SP_dietitian_v3_3.md` | `SP_dietitian_v3_4.md` |
| `SP_electrical-safety-engineer_v1_0.md` | `SP_electrical-safety-engineer_v1_2.md` |
| `SP_electrical-safety-engineer_v1_1.md` | `SP_electrical-safety-engineer_v1_2.md` |
| `SP_financial-planner_v1_1.md` | `SP_financial-planner_v1_2.md` |
| `SP_fire-safety-manager_v2_7.md` | `SP_fire-safety-manager_v2_8.md` |
| `SP_gas-safety-engineer_v1_0.md` | `SP_gas-safety-engineer_v1_2.md` |
| `SP_gas-safety-engineer_v1_1.md` | `SP_gas-safety-engineer_v1_2.md` |
| `SP_hairdresser_v1_0.md` | `SP_hairdresser_v1_2.md` |
| `SP_hairdresser_v1_1.md` | `SP_hairdresser_v1_2.md` |
| `SP_health-educator_v1_0.md` | `SP_health-educator_v1_1.md` |
| `SP_hondi_v1_0.md` | `SP_hondi_v1_2.md` |
| `SP_hondi_v1_1.md` | `SP_hondi_v1_2.md` |
| `SP_labor-attorney_v1_0.md` | `SP_labor-attorney_v1_2.md` |
| `SP_labor-attorney_v1_1.md` | `SP_labor-attorney_v1_2.md` |
| `SP_landscape-engineer_v1_0.md` | `SP_landscape-engineer_v1_2.md` |
| `SP_landscape-engineer_v1_1.md` | `SP_landscape-engineer_v1_2.md` |
| `SP_lawyer_v4_4.md` | `SP_lawyer_v4_5.md` |
| `SP_librarian_v2_7.md` | `SP_librarian_v2_8.md` |
| `SP_lifelong-educator_v1_0.md` | `SP_lifelong-educator_v1_2.md` |
| `SP_lifelong-educator_v1_1.md` | `SP_lifelong-educator_v1_2.md` |
| `SP_loss-adjuster_v1_1.md` | `SP_loss-adjuster_v1_2.md` |
| `SP_marine-engineer_v2_7.md` | `SP_marine-engineer_v2_8.md` |
| `SP_marine-pilot_v2_7.md` | `SP_marine-pilot_v2_8.md` |
| `SP_medical-lab-technologist_v3_3.md` | `SP_medical-lab-technologist_v3_4.md` |
| `SP_mental-health-professional_v2_6.md` | `SP_mental-health-professional_v2_8.md` |
| `SP_mental-health-professional_v2_7.md` | `SP_mental-health-professional_v2_8.md` |
| `SP_midwife_v1_0.md` | `SP_midwife_v1_1.md` |
| `SP_naval-architect_v2_7.md` | `SP_naval-architect_v2_8.md` |
| `SP_navigation-officer_v2_7.md` | `SP_navigation-officer_v2_8.md` |
| `SP_nurse_v3_3.md` | `SP_nurse_v3_4.md` |
| `SP_occupational-therapist_v3_3.md` | `SP_occupational-therapist_v3_4.md` |
| `SP_optician_v1_0.md` | `SP_optician_v1_1.md` |
| `SP_paramedic_v1_0.md` | `SP_paramedic_v1_1.md` |
| `SP_patent-attorney_v1_1.md` | `SP_patent-attorney_v1_2.md` |
| `SP_pharmacist_v1_3.md` | `SP_pharmacist_v1_4.md` |
| `SP_physical-therapist_v3_3.md` | `SP_physical-therapist_v3_4.md` |
| `SP_physician_v1_3.md` | `SP_physician_v1_4.md` |
| `SP_radiologic-technologist_v3_3.md` | `SP_radiologic-technologist_v3_4.md` |
| `SP_sanitarian_v1_0.md` | `SP_sanitarian_v1_1.md` |
| `SP_school-counselor_v2_6.md` | `SP_school-counselor_v2_8.md` |
| `SP_school-counselor_v2_7.md` | `SP_school-counselor_v2_8.md` |
| `SP_security-engineer_v1_1.md` | `SP_security-engineer_v1_2.md` |
| `SP_social-worker_v1_4.md` | `SP_social-worker_v1_5.md` |
| `SP_speech-language-pathologist_v1_0.md` | `SP_speech-language-pathologist_v1_1.md` |
| `SP_sports-instructor_v1_0.md` | `SP_sports-instructor_v1_1.md` |
| `SP_surveying-engineer_v1_0.md` | `SP_surveying-engineer_v1_2.md` |
| `SP_surveying-engineer_v1_1.md` | `SP_surveying-engineer_v1_2.md` |
| `SP_teacher_v2_7.md` | `SP_teacher_v2_8.md` |
| `SP_tour-guide_v1_1.md` | `SP_tour-guide_v1_2.md` |
| `SP_traditional-medicine-doctor_v1_3.md` | `SP_traditional-medicine-doctor_v1_4.md` |
| `SP_translator-interpreter_v1_0.md` | `SP_translator-interpreter_v1_3.md` |
| `SP_translator-interpreter_v1_1.md` | `SP_translator-interpreter_v1_3.md` |
| `SP_translator-interpreter_v1_2.md` | `SP_translator-interpreter_v1_3.md` |
| `SP_veterinarian_v2_6.md` | `SP_veterinarian_v2_7.md` |
| `SP_youth-counselor_v1_0.md` | `SP_youth-counselor_v1_2.md` |
| `SP_youth-counselor_v1_1.md` | `SP_youth-counselor_v1_2.md` |

## 같은 방식으로 옮겨진 다른 계열
- `AGENT-COMMON_v3_46.txt` ~ `v3_49.txt` — 2026-07-29, AGENT-COMMON_v3_50.txt
  자체가 폐기되며(→ 개인 AC는 AC-PRO-CORE, 그림자 AI는 AC-SHADOW-CORE로
  분리) 같은 계열 구버전도 함께 정리.
