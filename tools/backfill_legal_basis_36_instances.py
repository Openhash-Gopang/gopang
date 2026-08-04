#!/usr/bin/env python3
"""
36개 do-agency/org 인스턴스 SP 파일에 §LEGAL-BASIS 섹션을 소급 반영한다.
클래스 템플릿(SP-*-TEMPLATE)의 §LEGAL-BASIS를 인스턴스별로 축약 인용하고,
전체 상세·미검증 경고는 템플릿을 참조하도록 한다(DRY 원칙 — 전문 복붙 금지).

실행: python3 tools/backfill_legal_basis_36_instances.py
"""
import re
import sys

# (파일경로, 템플릿명, 법적근거 요약 블록)
ENTRIES = [
    # ── 03-do-agency (10건, RESEARCH 3 + MUSEUM 2 + FIRE/POLICE/HERITAGE/WATER/LIBRARY 5) ──
    ("prompts/gov-tree/03-do-agency/SP-AGY-AGRITECH_v1.0.md", "SP-AGY-RESEARCH-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 농촌진흥법(지방농촌진흥기관 관련 조항), 농업·농촌 및 식품산업 기본법
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-RESEARCH-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-CHUKSAN_v1.0.md", "SP-AGY-RESEARCH-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 축산법, 가축전염병 예방법, 종축·정액등의 생산과 이용에 관한 법률
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-RESEARCH-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-BOHWAN_v1.0.md", "SP-AGY-RESEARCH-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 보건환경연구원법, 식품위생법(검사 관련), 먹는물관리법(수질검사 관련)
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-RESEARCH-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-ARTMUSEUM_v1.0.md", "SP-AGY-MUSEUM-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 박물관 및 미술관 진흥법
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-MUSEUM-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-FOLKMUSEUM_v1.0.md", "SP-AGY-MUSEUM-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 박물관 및 미술관 진흥법, (자연사 표본 소장) 문화재보호법 관련 조항
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-MUSEUM-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-FIRE_v1.0.md", "SP-AGY-FIRE-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 소방기본법, 소방시설 설치 및 관리에 관한 법률, 화재의 예방 및 안전관리에 관한 법률, 119구조·구급에 관한 법률
- 기관 구분: 행정 (광역자치단체 직속기관, 별도 법인 아님. 단, 소속 공무원 신분은 국가직)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-FIRE-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-POLICE_v1.0.md", "SP-AGY-POLICE-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 제주특별자치도 설치 및 국제자유도시 조성을 위한 특별법(자치경찰 관련 조항 — ★ 정확한 조번호 출처마다 상이, 미확정) + 국가경찰과 자치경찰의 조직 및 운영에 관한 법률(전국 자치경찰제, 제주는 이원화 구조)
- 기관 구분: 행정 (광역자치단체 직속기관, 별도 법인 아님. 도지사 소속, 국가경찰과는 별개)
- legal_basis_last_verified: 2026-08-04 (이원화 구조는 확인. 정확한 조번호는 미확정)
- 상세: 클래스 템플릿 `SP-AGY-POLICE-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-HERITAGE_v1.0.md", "SP-AGY-HERITAGE-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 자연공원법, 문화재보호법, 세계유산의 보존·관리 및 활용에 관한 특별법(적용 여부 검증 필요), 습지보전법(해당 시)
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님)
- legal_basis_last_verified: (미검증 — 복수 지정 지위별 근거법 구분 특히 미검증)
- 상세: 클래스 템플릿 `SP-AGY-HERITAGE-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-WATER_v1.1.md", "SP-AGY-WATER-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 수도법, 하수도법, 지방공기업법(직영기업 회계·요금 한정 적용 가능성)
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님. 회계는 지방공기업 특별회계일 수 있음)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-WATER-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/03-do-agency/SP-AGY-LIBRARY_v1.0.md", "SP-AGY-LIBRARY-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치법 제125조(행정기구와 공무원, 03-do-agency 공통) + 도서관법, 작은도서관 진흥법(소규모 분관 해당 시)
- 기관 구분: 행정 (광역자치단체 직속기관·사업소, 별도 법인 아님)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-AGY-LIBRARY-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),

    # ── 07-org (26건) ──
    ("prompts/gov-tree/07-org/SP-ORG-CHILDCARE_v1.0.md", "SP-ORG-WELFARE-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치단체 출자·출연 기관의 운영에 관한 법률(지방출자출연법) + 아이돌봄 지원법
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-WELFARE-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-CHILDMEAL_v1.0.md", "SP-ORG-WELFARE-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치단체 출자·출연 기관의 운영에 관한 법률(지방출자출연법) + 어린이 식생활안전관리 특별법
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-WELFARE-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-TRANSWEAK_v1.0.md", "SP-ORG-WELFARE-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치단체 출자·출연 기관의 운영에 관한 법률(지방출자출연법) + 교통약자의 이동편의 증진법
- 기관 구분: 위탁운영센터(사단법인, 지방출자출연법 준용 가능성 — 정확한 형태 검증 필요)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-WELFARE-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JPASS_v1.0.md", "SP-ORG-WELFARE-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방자치단체 출자·출연 기관의 운영에 관한 법률(지방출자출연법) + 사회서비스 지원 및 사회서비스원 설립·운영에 관한 법률(사회서비스원법)
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-WELFARE-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JPDC_v1.0.md", "SP-ORG-PUBENT-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-A, 지방공기업형): 지방공기업법 + 지방출자출연법(보충 적용) + 먹는물관리법, 국토의 계획 및 이용에 관한 법률(해당 사업 시)
- 기관 구분: 지방공기업(지방공사), 도청과 별도 법인격
- legal_basis_last_verified: (미검증 — "지방공기업법 적용 대상 여부 자체"의 확인 필요)
- 상세: 클래스 템플릿 `SP-ORG-PUBENT-TEMPLATE_v1.0.md` §LEGAL-BASIS-A 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JEA_v1.0.md", "SP-ORG-PUBENT-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-A, 지방공기업형): 지방공기업법 제49조·제53조(2026-08 이전 세션 웹서치로 확인) + 신에너지 및 재생에너지 개발·이용·보급 촉진법, 전기사업법
- 기관 구분: 지방공기업(지방공사), 도청과 별도 법인격
- legal_basis_last_verified: 2026-08 이전 세션 확인(정확한 날짜 미기재 승계) — 지방공기업법 조항 확인됨
- 상세: 클래스 템플릿 `SP-ORG-PUBENT-TEMPLATE_v1.0.md` §LEGAL-BASIS-A 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JTO_v1.0.md", "SP-ORG-PUBENT-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-A, 지방공기업형): 지방공기업법 + 제주특별자치도 설치 및 국제자유도시 조성을 위한 특별법 제173조(2026-08 이전 세션 웹서치로 확인 — 제주 고유 2단 구조, 전국 템플릿화 시 자리표시자 분리 필요)
- 기관 구분: 지방공기업(지방공사), 도청과 별도 법인격
- legal_basis_last_verified: 2026-08 이전 세션 확인(정확한 날짜 미기재 승계) — 특별법 제173조 확인됨
- 상세: 클래스 템플릿 `SP-ORG-PUBENT-TEMPLATE_v1.0.md` §LEGAL-BASIS-A 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-ICCJEJU_v1.0.md", "SP-ORG-PUBENT-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-B, 지자체 출자 주식회사형 — **지방공기업법이 아님**): 상법(회사편) + "제주특별자치도 주식회사 제주국제컨벤션센터 설립 및 출자 등에 관한 조례"
- 기관 구분: 상법상 주식회사(제주도 지분 57.02%), 지방공기업법상 "지방공사"가 아님
- legal_basis_last_verified: 2026-08-04 확인(조례명·지분구조 웹서치 검증)
- 상세: 클래스 템플릿 `SP-ORG-PUBENT-TEMPLATE_v1.0.md` §LEGAL-BASIS-B 참조. **기존 §0의 "(지방출자기관(주식회사))" 표기는 대체로 정확하나, §LEGAL-BASIS-A와 혼용해 지방공기업법을 근거로 인용하지 않도록 주의.**"""),
    ("prompts/gov-tree/07-org/SP-ORG-JTA_v1.0.md", "SP-ORG-ASSOC-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 민법 제32조(비영리법인 설립) + 관광진흥법 제43조(2026-08-04 웹서치, 문화체육관광부 비영리법인현황 공식 자료로 확인)
- 기관 구분: 민간 비영리 사단법인 — **지방출자출연기관이 아님**. 도는 감독·업무협업 관계
- legal_basis_last_verified: 2026-08-04 확인
- 상세: 클래스 템플릿 `SP-ORG-ASSOC-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JEJUMED_v1.0.md", "SP-ORG-MEDICAL-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방의료원의 설립 및 운영에 관한 법률(지방의료원법) + 지방출자출연법(보충 적용) + 의료법
- 기관 구분: **지방출연기관**(★ 2026-08-04 정정 — 기존 "지방공기업" 표기는 오류. 2005년 지방의료원법 제정 이후 지방출연기관으로 전환됨)
- legal_basis_last_verified: 2026-08-04 (형태 전환 사실 확인, 1차 공식 출처 미대조)
- 상세: 클래스 템플릿 `SP-ORG-MEDICAL-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-SGPMED_v1.0.md", "SP-ORG-MEDICAL-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방의료원의 설립 및 운영에 관한 법률(지방의료원법) + 지방출자출연법(보충 적용) + 의료법
- 기관 구분: **지방출연기관**(★ 2026-08-04 정정 — 기존 "지방공기업" 표기는 오류. 2005년 지방의료원법 제정 이후 지방출연기관으로 전환됨)
- legal_basis_last_verified: 2026-08-04 (형태 전환 사실 확인, 1차 공식 출처 미대조)
- 상세: 클래스 템플릿 `SP-ORG-MEDICAL-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JSPO_v1.0.md", "SP-ORG-SPORTS-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 국민체육진흥법(시·도체육회 법정단체 지위 근거 — 정확한 조항 번호 미검증)
- 기관 구분: 법정단체(지방출자출연기관·민간 임의단체 어느 쪽도 아닌 제3유형)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-SPORTS-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JPSPO_v1.0.md", "SP-ORG-SPORTS-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 국민체육진흥법(시·도장애인체육회 법정단체 지위 근거 — 정확한 조항 번호 미검증)
- 기관 구분: 법정단체(지방출자출연기관·민간 임의단체 어느 쪽도 아닌 제3유형)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-SPORTS-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JCCEI_v1.0.md", "SP-ORG-ECONIND-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 정확한 개별 특별법 미확인(중소벤처기업부 전국 네트워크 사업 위탁 성격으로 추정)
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: (미검증 — 개별 근거법 특히 불확실)
- 상세: 클래스 템플릿 `SP-ORG-ECONIND-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JCGF_v1.0.md", "SP-ORG-ECONIND-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 지역신용보증재단법(2026-08-04 웹서치로 법률명 확인)
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: 2026-08-04 (법률명만 확인, 정확한 조항 미검증)
- 상세: 클래스 템플릿 `SP-ORG-ECONIND-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JEDA_v1.0.md", "SP-ORG-ECONIND-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 특정 개별 특별법 없음(수출·창업지원 등은 개별 사업 근거에 따름, 검증 필요)
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-ECONIND-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JTP_v1.0.md", "SP-ORG-ECONIND-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 산업기술단지 지원에 관한 특례법 제4조(2026-08-04 웹서치로 확인 — "테크노파크"는 이 법상 사업시행자의 통칭)
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: 2026-08-04 (법률명·조항 확인)
- 상세: 클래스 템플릿 `SP-ORG-ECONIND-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JCPA_v1.0.md", "SP-ORG-CULTUREARTS-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 영화 및 비디오물의 진흥에 관한 법률, 콘텐츠산업 진흥법
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-CULTUREARTS-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JFAC_v1.0.md", "SP-ORG-CULTUREARTS-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 문화예술진흥법
- 기관 구분: 출자출연기관 (도청과 별도 법인격)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-CULTUREARTS-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-IPF_v1.0.md", "SP-ORG-PEACEFOUNDATION-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-B, 일반 재단형): 민법 제32조 또는 지방출자출연법(어느 쪽인지 미확인) — "제주도·외교부 공동 후원"이 법적 근거인지 사업협력 관계인지 불분명
- 기관 구분: 재단법인(정확한 법적 성격 미검증)
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-PEACEFOUNDATION-TEMPLATE_v1.0.md` §LEGAL-BASIS-B 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JEJU43_v1.0.md", "SP-ORG-PEACEFOUNDATION-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-A, 특별법 근거형): 제주4·3사건 진상규명 및 희생자 명예회복에 관한 특별법 제8조의2(제주4·3 관련 재단에의 출연) + 재단법인 제주4·3평화재단 설립 및 운영 등에 관한 조례
- 기관 구분: 특수법인 형태의 재단. **전국 템플릿화 불가**(제주 고유 역사적 사건에 대한 개별 특별법)
- legal_basis_last_verified: 2026-08-04 확인(위키백과 각주·재단 정관 대조)
- 상세: 클래스 템플릿 `SP-ORG-PEACEFOUNDATION-TEMPLATE_v1.0.md` §LEGAL-BASIS-A 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JERI_v1.0.md", "SP-ORG-RESEARCH-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거, 특별한 개별 특별법 없음)
- 기관 구분: 출자출연기관 (도청과 별도 법인격). ★ 03-do-agency의 SP-AGY-RESEARCH-TEMPLATE(도청 내부 조직)와 혼동 금지 — 이 기관은 별도 법인
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-RESEARCH-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JWFRI_v1.0.md", "SP-ORG-RESEARCH-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 양성평등기본법(성별영향평가 관련 조항 가능성, 검증 필요)
- 기관 구분: 출자출연기관 (도청과 별도 법인격). ★ 03-do-agency의 SP-AGY-RESEARCH-TEMPLATE(도청 내부 조직)와 혼동 금지 — 이 기관은 별도 법인
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-RESEARCH-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-JILES_v1.0.md", "SP-ORG-LIFELONGEDU-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령: 지방출자출연법(일반 근거) + 평생교육법(평생교육 사업), 도 장학기금 설치 및 운영 조례(장학 사업, 검증 필요)
- 기관 구분: 출자출연기관 (도청과 별도 법인격). 평생교육·장학 두 사업 근거법이 다름을 구분해 안내
- legal_basis_last_verified: (미검증)
- 상세: 클래스 템플릿 `SP-ORG-LIFELONGEDU-TEMPLATE_v1.0.md` §LEGAL-BASIS 참조"""),
    ("prompts/gov-tree/07-org/SP-ORG-MAEUL_v1.0.md", "SP-ORG-URBANCOMMUNITY-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-B, 조례 근거형): **전국 통일 법률 없음**(2026-08-04 웹서치로 확인 — "마을공동체 기본법" 미제정) — 각 지자체의 "마을만들기 지원 조례"가 유일한 법적 근거
- 기관 구분: 위탁운영센터(민간 수탁, 조례 근거이며 법률 근거 없음)
- legal_basis_last_verified: 2026-08-04 (법률 부재 사실 확인)
- 상세: 클래스 템플릿 `SP-ORG-URBANCOMMUNITY-TEMPLATE_v1.0.md` §LEGAL-BASIS-B 참조. **"법에 따라" 같은 표현을 함부로 쓰지 않을 것.**"""),
    ("prompts/gov-tree/07-org/SP-ORG-URBANREGEN_v1.0.md", "SP-ORG-URBANCOMMUNITY-TEMPLATE_v1.0.md", """- 페르소나 유형: 기관 페르소나 (Institutional Persona)
- 근거 법령(§LEGAL-BASIS-A, 법률 근거형): 도시재생 활성화 및 지원에 관한 특별법(도시재생지원센터 설치·운영 근거 — 정확한 조항 번호 검증 필요) + 도시재생 활성화 및 지원에 관한 조례
- 기관 구분: 위탁운영센터(국토교통부 도시재생사업 지역거점)
- legal_basis_last_verified: (미검증 — 법률명은 확실, 조항 미검증)
- 상세: 클래스 템플릿 `SP-ORG-URBANCOMMUNITY-TEMPLATE_v1.0.md` §LEGAL-BASIS-A 참조"""),
]

HEADER = "## §LEGAL-BASIS. 법적 근거\n\n"
ANCHOR = "## §0."

def main():
    ok, skip, fail = 0, 0, 0
    for path, template, body in ENTRIES:
        try:
            with open(path, encoding="utf-8") as f:
                text = f.read()
        except FileNotFoundError:
            print(f"[FAIL] 파일 없음: {path}")
            fail += 1
            continue

        if "§LEGAL-BASIS" in text:
            print(f"[SKIP] 이미 있음: {path}")
            skip += 1
            continue

        idx = text.find(ANCHOR)
        if idx == -1:
            print(f"[FAIL] '## §0.' 앵커 못 찾음: {path}")
            fail += 1
            continue

        block = HEADER + body.strip() + "\n\n"
        new_text = text[:idx] + block + text[idx:]

        with open(path, "w", encoding="utf-8") as f:
            f.write(new_text)
        print(f"[OK]   {path}  (템플릿: {template})")
        ok += 1

    print(f"\n완료: OK={ok} SKIP={skip} FAIL={fail} / 총 {len(ENTRIES)}건")
    if fail:
        sys.exit(1)

if __name__ == "__main__":
    main()
