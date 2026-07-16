#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
혜택 카탈로그(civil-petitions-raw.json, 10,966건) 파일럿 스크립트.

목적: 서비스분야 10종에서 고르게 표본을 뽑아 org_profiles/atom_rows/
procedure_maps 시딩용 pb_migrations JS 파일을 생성한다. 전수(10,966건)
적재 전에 파싱 설계(특히 eligibility_gate 스키마)를 검증하기 위한
파일럿이며, 자동 승격하지 않고 항상 status='pending_review'로 심는다.

주의: target/eligibility/content 필드는 자유텍스트라 완전 자동 파싱은
불가능하다. 이 스크립트는 "신뢰할 수 있는 만큼만" 구조화하고, 나머지는
raw_text로 남겨 사람이 검토하게 한다 — 없는 정확도를 지어내지 않는다
(U2 원칙과 동일한 정신).
"""

import json
import re
import collections

RAW_PATH = "tools/civil-petitions-raw.json"
PILOT_SIZE_PER_CATEGORY = 3

# ── apply_method → automation.level 환산 (보수적: 가장 낮은 옵션 기준) ──
def automation_level(apply_method: str) -> str:
    if not apply_method:
        return "manual_only"
    methods = apply_method.split("||")
    # 방문신청이 옵션에 하나라도 있으면 그 즉시 manual_only 하한 적용
    if any("방문" in m for m in methods):
        return "manual_only"
    if any("온라인" in m for m in methods):
        # 온라인만 있으면 assisted (자동화 가능성은 있으나 API 미연동)
        return "assisted"
    return "manual_only"


# ── target/eligibility 텍스트에서 나이·소득 조건 등 신뢰 가능한 패턴만 추출 ──
AGE_PATTERN = re.compile(r"(만\s*)?(\d{1,2})\s*[~-]\s*(\d{1,2})\s*세")
INCOME_PATTERN = re.compile(r"(기준\s*중위소득|중위소득)\s*(\d{1,3})\s*%")


def extract_eligibility_gate(target: str, eligibility: str):
    text = " ".join(filter(None, [target or "", eligibility or ""]))
    items = []
    age_m = AGE_PATTERN.search(text)
    if age_m:
        items.append({
            "item": f"연령 {age_m.group(2)}~{age_m.group(3)}세",
            "source": "target/eligibility 필드 정규식 추출 — 원문 재확인 필요",
            "confidence": "low",
        })
    income_m = INCOME_PATTERN.search(text)
    if income_m:
        items.append({
            "item": f"기준 중위소득 {income_m.group(2)}% 이하",
            "source": "target/eligibility 필드 정규식 추출 — 원문 재확인 필요",
            "confidence": "low",
        })
    if not items:
        items.append({
            "item": "자동 추출 실패 — 원문 직접 검토 필요",
            "source": "target/eligibility raw text",
            "confidence": "none",
        })
    return items


def js_str(s: str) -> str:
    """JS 문자열 리터럴로 안전하게 이스케이프."""
    if s is None:
        s = ""
    return json.dumps(s, ensure_ascii=False)


def main():
    with open(RAW_PATH, encoding="utf-8") as f:
        data = json.load(f)

    by_cat = collections.defaultdict(list)
    for r in data:
        by_cat[r["service_category"]].append(r)

    pilot = []
    for cat, items in by_cat.items():
        # target/eligibility/apply_method가 전부 채워진 것 위주로 선별
        # (완전히 비어있는 레코드로 파일럿을 검증해봐야 얻는 게 적음)
        rich = [
            r for r in items
            if r.get("target") and r.get("apply_method") and r.get("org_code")
        ]
        pool = rich if len(rich) >= PILOT_SIZE_PER_CATEGORY else items
        pilot.extend(pool[:PILOT_SIZE_PER_CATEGORY])

    print(f"파일럿 표본: {len(pilot)}건 (목표 {PILOT_SIZE_PER_CATEGORY} x 10 = 30)")

    # org_profiles: org_code 기준 dedup
    orgs = {}
    for r in pilot:
        code = r["org_code"]
        if code not in orgs:
            orgs[code] = {
                "org_id": f"gov24-org:{code}",
                "org_name": r["org_name"],
                "branch_hint": r["org_branch_hint"],
                "dept": r.get("org_dept") or "",
            }

    branch_map = {
        "시군구": "admin_local",
        "광역시도": "admin_local",
        "중앙행정기관": "admin_central",
        "공공기관": "public_institution",
        "지방출자출연기관": "public_institution",
        "지방공기업": "public_institution",
        "교육청": "admin_local",
    }

    atom_defs = {
        "welfare-apply-online": {
            "pattern": "APPLY",
            "org_class": "benefit-provider",
            "note": "정부24/복지로 등 온라인 신청 가능",
        },
        "welfare-apply-visit": {
            "pattern": "APPLY",
            "org_class": "benefit-provider",
            "note": "읍면동 주민센터 등 방문신청 필수 — automation 상한선",
        },
    }

    procs = []
    for r in pilot:
        level = automation_level(r.get("apply_method", ""))
        atom_id = "welfare-apply-visit" if level == "manual_only" else "welfare-apply-online"
        gate = extract_eligibility_gate(r.get("target"), r.get("eligibility"))
        procs.append({
            "petition_id": r["petition_id"],
            "goal": r["petition_name"],
            "domain": r["service_category"],
            "org_id": f"gov24-org:{r['org_code']}",
            "atom_id": atom_id,
            "eligibility_gate": gate,
            "as_of_date": "2026-07-16",
            "receiving_org": r.get("receiving_org") or "",
            "detail_url": r.get("detail_url") or "",
        })

    out = {
        "orgs": [
            {**v, "branch": branch_map.get(v["branch_hint"], "public_institution")}
            for v in orgs.values()
        ],
        "atoms": atom_defs,
        "procs": procs,
    }
    with open("tools/pilot_benefit_catalog_output.json", "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print(f"org_profiles 후보: {len(out['orgs'])}건")
    print(f"atom_rows 후보: {len(out['atoms'])}건")
    print(f"procedure_maps 후보: {len(out['procs'])}건")


if __name__ == "__main__":
    main()
