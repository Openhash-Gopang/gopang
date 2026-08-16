# -*- coding: utf-8 -*-
"""§6-8 검찰(검찰청) — roadmap.html 체크리스트 + §6-10 로그 갱신.
§6-1~8 전체(70개 기관) 완결. 재실행해도 안전(멱등성)."""

PATH = "reports/hondi-institutional-ai-roadmap.html"
with open(PATH, encoding="utf-8") as f:
    html = f.read()

old = '<tr><td class="chk">☐</td><td>70</td><td>검찰청</td><td>PROSECUTION</td><td>법무부</td></tr>'
new = '<tr><td class="chk">☑</td><td>70</td><td>검찰청</td><td>PROSECUTION</td><td>법무부</td></tr>'
changed = 0
if new not in html:
    if old not in html:
        raise SystemExit(f"NOT FOUND: {old}")
    assert html.count(old) == 1
    html = html.replace(old, new)
    changed += 1

marker = '''  <h3 class="subsec">6-10. 실사 진행 기록 (착수분)</h3>
  <table>
    <thead><tr><th>일자</th><th>기관</th><th>실사 결과물</th></tr></thead>
    <tbody>
'''
new_row = '''      <tr><td>2026-08-16</td><td>#70 §6-8 검찰(검찰청) — §6-1~8 70개 기관 전체 완결</td>
        <td>검찰청 사무기구에 관한 규정(대통령령, 최신 시행일 2026-05-29)+나무위키+한국민족문화대백과사전
        교차확인으로 검찰청 11개 division 확인. 대검찰청 8개 부(기획조정부·반부패부·형사부·마약조직
        범죄부·공공수사부·공판송무부·과학수사부·감찰부) 전부 대통령령 직제 조문 기준으로 확인(고신뢰).
        <b>결정적 발견:</b> 2026년 10월 2일 검찰청이 폐지되고 기소·공소유지 전담 신설기관 '공소청'
        으로 대체될 예정임을 확인 — 이번 조사(2026-08-16) 시점엔 검찰청이 아직 존속·활동 중이나,
        시한부 조직을 다루고 있다는 점을 SP에 명시했고 정기 재검증(특히 2026년 10월 이후)이 필수
        임을 기록함. <b>이로써 §6-1~8 전체(70개 기관) 전수 실사 완료.</b> 남은 건 §6-9(별도 트랙,
        지역청 내부 부서)뿐 — §6-1~8(70개 기관 중앙조직)이 끝났으니 다음 세션에서 §6-9 착수 여부를
        판단할 것. 아울러 공소청 신설(2026-10-02 예정)이 이루어지면 §6-8 자체를 재구성해야 할
        가능성이 높음(검찰청 코드 유지 여부, 공소청 신규 등록 등) — 이 역시 다음 재검증 과제.</td></tr>
'''
if "§6-8 검찰(검찰청) — §6-1~8 70개 기관 전체 완결" not in html:
    assert marker in html, "§6-10 마커를 찾을 수 없음 — 파일이 예상과 다름"
    html = html.replace(marker, marker + new_row)
    changed += 1

if changed == 0:
    print("이미 전부 적용되어 있음 — 변경 없음")
else:
    with open(PATH, "w", encoding="utf-8") as f:
        f.write(html)
    print(f"OK — {changed}건 반영")
