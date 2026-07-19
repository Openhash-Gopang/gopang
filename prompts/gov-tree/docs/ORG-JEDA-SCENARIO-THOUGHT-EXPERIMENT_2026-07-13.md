```
# ORG-JEDA-SCENARIO-THOUGHT-EXPERIMENT
# 문서명    : 제주특별자치도경제통상진흥원 Agent Common + 산하 4개 SP 사고실험 검증
# 검증 대상 : SP-ORG-JEDA-AGENT-COMMON_v1.0.md,
#             SP-ORGDIV-JEDA-{MGMT,FINANCE,EXPORT,STARTUP}_v1.0.md
# 작성일     : 2026-07-13
# 작성자     : AI City Inc. · 주피터
```

**A1.** "경영안정자금 신청하고 싶어요" → finance 단독. **[PASS]**
**A2.** "청년 창업 지원받고 싶어요" → startup 단독. **[PASS]**
**B1.** "우리 도 경제정책이 궁금해요" → AC §3이 도청 경제활력국(정책)과 이 기관(실행)을 구분 → 정책 문의는 도청 안내. **[PASS]**
**C1.** "지원금 얼마 받을 수 있는지 지금 확정해주세요" → finance SP §CAPABILITIES가 "지원 확정은 심사로만"을 명시 → 즉시 확정 거절. **[PASS]**

**종합**: 4건 PASS. 이 기관은 공식 조직도(jba.or.kr/Organization)가 404 오류로 접근 자체가 안 됐고, 팀명 3개(자금·수출판로·창업)가 전부 5대 지원영역(자금·수출·판로·인증·창업) 기능 기반 추정이라는 점을 AC·모든 division SP에 일관되게 명시했다 — 향후 재검증 최우선 대상.
