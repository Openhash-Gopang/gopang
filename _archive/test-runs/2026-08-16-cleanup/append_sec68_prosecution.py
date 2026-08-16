# -*- coding: utf-8 -*-
"""§6-8 검찰(검찰청, 1개) — ministry-division-master-data.json에 append.
2026년 10월 2일 검찰청 폐지·공소청 신설 예정을 명시한 시한부 조직 SP.
같은 폴더의 sec68_prosecution_data.json을 읽어 병합. 재실행해도 안전(멱등성).

주의: 이 스크립트는 §6-7(외청 17개) PR이 먼저 병합된 뒤에 적용하는 것을 권장합니다.
같은 JSON 파일을 다루는 두 개의 별도 브랜치가 동시에 열려 있으면 병합 충돌 가능성이
있습니다 — §3 절차(브랜치 순차 처리)를 따르는 것이 안전합니다.
"""
import json
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, "sec68_prosecution_data.json")
TARGET_PATH = "prompts/gov-tree/09-national/policy-bodies/divisions/ministry-division-master-data.json"

with open(DATA_PATH, encoding="utf-8") as f:
    new_entries = json.load(f)

with open(TARGET_PATH, encoding="utf-8") as f:
    data = json.load(f)

existing_completed = set(data["실사현황"].get("완료", []))
existing_codes_done = set(c.split("(")[0] for c in existing_completed)

code = new_entries[0]["기관코드"]
name = new_entries[0]["기관명"]

if code in existing_codes_done:
    print(f"이미 반영됨(건너뜀): {code}")
else:
    data["division목록"].extend(new_entries)
    data["실사현황"]["완료"] = data["실사현황"].get("완료", []) + [f"{code}({name})"]
    data["실사현황"]["조사일"] = "2026-08-16"
    data["실사현황"]["방법"] = data["실사현황"].get("방법", "") + (
        " | §6-8 검찰: 검찰청 사무기구에 관한 규정(대통령령, 최신 시행일 2026-05-29)"
        " + 나무위키(2026년 10월 2일 검찰청 폐지·공소청 신설 예정 확인) + 한국민족문화대백과사전 교차확인"
    )
    data["실사현황"]["특기사항"] = data["실사현황"].get("특기사항", "") + (
        " | **PROSECUTION(검찰청) 결정적 발견**: 2026년 10월 2일 검찰청이 폐지되고 기소·공소유지"
        " 전담 신설기관 '공소청'으로 대체될 예정임을 확인 — 이번 조사(2026-08-16) 시점엔 검찰청이"
        " 아직 존속·활동 중이나, 시한부 조직을 다루고 있다는 점을 SP에 명시함. 대검찰청 8개 부"
        "(기획조정부·반부패부·형사부·마약조직범죄부·공공수사부·공판송무부·과학수사부·감찰부) 전부"
        " 확인(대통령령 직제 조문 기준, 고신뢰). §6-8 완료로 §6-1~8 전체(70개 기관) 실사 완료 —"
        " 남은 건 §6-9(별도 트랙, 지역청 내부 부서)뿐."
    )
    with open(TARGET_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    print(f"OK — {code}({name}) 추가, {len(new_entries)}건 반영")

print(f"division목록 총 {len(data['division목록'])}건")
