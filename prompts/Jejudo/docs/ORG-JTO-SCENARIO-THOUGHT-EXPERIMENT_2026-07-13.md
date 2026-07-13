```
# ORG-JTO-SCENARIO-THOUGHT-EXPERIMENT
# 문서명    : 제주관광공사 Agent Common + 산하 5개 SP 사고실험 검증
# 검증 대상 : SP-ORG-JTO-AGENT-COMMON_v1.0.md,
#             SP-ORGDIV-JTO-{PLANNING,MARKETING,INDUSTRY,PROFIT,AUDIT}_v1.0.md
# 작성일     : 2026-07-13
# 작성자     : AI City Inc. · 주피터
```

**A1.** "면세점에서 뭐 살 수 있어요" → profit 단독. **[PASS]**
**A2.** "관광 마케팅 협력하고 싶어요" → marketing 단독. **[PASS]**
**B1(핵심).** "이 회사 감사 관련해서 문의하고 싶어요" → AC §3이 "감사팀은 COMPOSE 대상에서 제외가 기본값"을 명시 → 외부 이용자의 감사 관련 문의는 실제로는 감사팀이 아니라 경영기획실(민원 창구)로 안내하는 게 맞는지 재확인하는 방향으로 처리, 감사팀을 직접 호출하지 않음. **[PASS]** — 조직도에는 있지만 COMPOSE 대상에서 실질적으로 빠져야 하는 부서를 사전에 표시해둔 게 실제로 작동했다.
**C1.** "면세점 지금 바로 특가 상품 알려주세요" → profit SP가 서비스 안내형 SP임을 명확히 함 — 구체적 상품 정보는 최신 확인 필요를 안내. **[PASS]**

**종합**: 4건 PASS. 감사팀을 COMPOSE 기본 제외 대상으로 미리 명시해둔 설계가 실제로 검증됨 — 다른 기관에서도 감사·이사회 등 외부응대 비대상 조직이 나오면 동일 패턴 적용.
