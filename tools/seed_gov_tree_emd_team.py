#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_gov_tree_emd_team.py — 읍면동(43)·팀(184) 시딩

배경: gov-tree directCode 체인의 마지막 두 tier. 읍면동/팀도 city-dept·
nat-agency와 마찬가지로 개별 SP 파일이 아니라 템플릿(SP-EMD-TEMPLATE_v1.2.md /
SP-TEAM-*-TEMPLATE_v2.1.md 5종) + 마스터데이터(JSON)로 렌더링되는 방식이라
seed_gov_tree_remaining_registry.py의 rglob 스캔으로는 못 찾는다. 이 스크립트는
마스터데이터 JSON을 직접 읽어 같은 profiles 등록 계약(entity_subtype=
"{tier}:{code}")으로 시딩한다.

- emd: entity_subtype = "emd:{읍면동명}" (예: emd:애월읍)
    소스: prompts/gov-tree/05-emd/emd-master-data.json (42건, 한림읍 제외)
        + prompts/gov-tree/05-emd/hallim/hallim-data.json (1건, 한림읍은
          별도 파일로 관리되므로 별도 로더로 합류시킨다)
    합계 43건 — gov-router.js의 emd tier 처리 코드(directCode 분기, "code
    형식: '{읍면동명}'" 주석)와 정확히 일치하는 계약을 그대로 따른다.
- team: entity_subtype = "team:{읍면동명}-{팀이름}" (예: team:애월읍-총무팀)
    소스: prompts/gov-tree/05-emd/templates/team-master-data.json (184건,
    한림읍 5팀 포함 — 43개 읍면동 전체 팀 인스턴스)
    gov-router.js team tier 분기의 "code 형식: '{읍면동명}-{팀이름}'.
    읍면동명·팀이름 둘 다 하이픈을 포함하지 않으므로 첫 '-'로만 분리하면
    된다" 주석과 정확히 같은 조립 규칙을 반대 방향(조립 시)으로 적용한다.

directCode 연결(gov-router.js)은 이미 있음(emd/team 분기 기존 구현) —
이 스크립트는 profiles 등록만 담당(§1 원칙: K-Search가 찾을 수 있게 만드는
것이 목적). 미등록 상태에서도 launch는 kregionalgov 텍스트 캐스케이드로
안전 폴백한다(§1 원칙이 보장하는 동작, 다른 tier와 동일).

주의: emd-master-data.json의 무인발급기위치·일부 청사 정보는 '_meta'에
'TBD' 또는 '재확인 필요'로 명시된 항목이 남아있다(원본 데이터 자체의
알려진 한계). 이 스크립트는 그 상태를 그대로 반영하되, 팀구성·관할리·
주력산업처럼 항상 채워져 있는 필드만으로 description을 구성하므로
role 서술 공백(정책기관 24건과 같은 문제)은 발생하지 않는다 — 전부
active로 등록한다.
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gov_seed_common import find_existing_guid  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
GOVTREE = REPO_ROOT / "prompts" / "gov-tree"
RUN_LOG = REPO_ROOT / "docs" / "GOV-TREE-EMD-TEAM-SEEDING-RUN_2026-08-03.md"


def collect_emd():
    records = []

    main_data = json.loads((GOVTREE / "05-emd/emd-master-data.json").read_text(encoding="utf-8"))
    hallim_data = json.loads((GOVTREE / "05-emd/hallim/hallim-data.json").read_text(encoding="utf-8"))
    all_emd = list(main_data["읍면동목록"]) + [hallim_data]

    for r in all_emd:
        name = r["읍면동명"]
        teams_summary = ", ".join(t["팀"] for t in r.get("팀구성", []))
        desc = (
            f"{r.get('행정시명', '')} {name}({r.get('읍면동구분', '')}). "
            f"청사: {r.get('청사주소', 'TBD')}. "
            f"팀 구성: {teams_summary}. "
            f"주력산업: {r.get('주력산업', '')}."
        )
        records.append({
            "code": name,
            "gov_code": f"emd:{name}",
            "name": f"{r.get('행정시명', '')} {name}",
            "description": desc,
            "status": "active",
            "source_file": (
                "05-emd/hallim/hallim-data.json" if r.get("emd_code") == "SP-EMD-HALLIM"
                else "05-emd/emd-master-data.json"
            ),
            "tier_prefix": "emd",
        })
    return records


def collect_team():
    data = json.loads((GOVTREE / "05-emd/templates/team-master-data.json").read_text(encoding="utf-8"))
    records = []
    for r in data["팀목록"]:
        emd_name = r["읍면동이름"]
        team_name = r["팀이름"]
        code = f"{emd_name}-{team_name}"
        desc = (
            f"{r.get('도이름', '')} {r.get('시이름', '')} {emd_name} {team_name}. "
            f"접수: {r.get('입력_문구', '')} "
            f"결과: {r.get('출력_문구', '')} "
            f"({r.get('콜센터명', '')}, {r.get('콜센터운영시간', '')})"
        )
        records.append({
            "code": code,
            "gov_code": f"team:{code}",
            "name": f"{r.get('시이름', '')} {emd_name} {team_name}",
            "description": desc,
            "status": "active",
            "source_file": "05-emd/templates/team-master-data.json",
            "tier_prefix": "team",
        })
    return records


def build_payload(rec):
    return {
        "entity_type": "institution",
        "name": rec["name"],
        "description": rec["description"] or f"{rec['name']} — 역할 서술 보강 필요({rec['source_file']})",
        "tags": ["gov-tree", rec["tier_prefix"], rec["code"]],
        "occupation": "행정기관" if rec["tier_prefix"] == "emd" else "행정기관 팀",
        "entity_subtype": rec["gov_code"],
        "claim_source": "gov_tree_seed_v3",
        "claim_status": "unclaimed",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--worker-base", default=os.environ.get("WORKER_BASE", "https://hondi-proxy.tensor-city.workers.dev"))
    ap.add_argument("--only-tier", default=None, help="emd,team 중 콤마구분")
    ap.add_argument("--force", action="store_true",
                     help="이미 등록된 code도 확인 없이 강제로 새로 POST(위험 — "
                          "중복 생성됨). 기본은 꺼짐.")
    args = ap.parse_args()

    records = collect_emd() + collect_team()
    if args.only_tier:
        want = set(t.strip() for t in args.only_tier.split(","))
        records = [r for r in records if r["tier_prefix"] in want]

    by_tier = {}
    for r in records:
        by_tier.setdefault(r["tier_prefix"], []).append(r)
    print(f"총 {len(records)}건")
    for t, rs in by_tier.items():
        active = sum(1 for r in rs if r["status"] == "active")
        print(f"  {t}: {len(rs)}건 (active {active} / pending_review {len(rs)-active})")

    if not args.apply:
        print("\n[DRY-RUN] --apply 없이 실행됨. 미리보기 3건:")
        for r in records[:3]:
            print(json.dumps(build_payload(r), ensure_ascii=False, indent=2))
        print(f"... 총 {len(records)}건 전송 예정")
        return

    results = {"success": [], "failed": [], "skipped_existing": []}
    for rec in records:
        if not args.force:
            try:
                existing_guid = find_existing_guid(
                    args.worker_base, rec["name"], rec["gov_code"], rec["code"])
            except Exception as e:
                print(f"  [SKIP-UNCERTAIN] {rec['gov_code']} — 기존 등록 여부 확인 실패"
                      f"({e}), 안전을 위해 건너뜀.", file=sys.stderr)
                results["skipped_existing"].append({"code": rec["gov_code"], "reason": f"check_failed: {e}"})
                continue
            if existing_guid:
                print(f"  [SKIP-EXISTS] {rec['gov_code']} — 이미 등록됨 → {existing_guid}")
                results["skipped_existing"].append({"code": rec["gov_code"], "guid": existing_guid})
                continue
        payload = build_payload(rec)
        req = urllib.request.Request(
            f"{args.worker_base.rstrip('/')}/profile",
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                              "AppleWebKit/537.36 (KHTML, like Gecko) "
                              "Chrome/126.0.0.0 Safari/537.36",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                body = json.loads(resp.read().decode("utf-8"))
                results["success"].append({"code": rec["gov_code"], "guid": body.get("guid")})
                print(f"  [OK] {rec['gov_code']} → {body.get('guid')}")
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="replace")
            results["failed"].append({"code": rec["gov_code"], "error": f"HTTP {e.code}: {err_body}"})
            print(f"  [FAIL] {rec['gov_code']} — HTTP {e.code}: {err_body}", file=sys.stderr)
        except Exception as e:
            results["failed"].append({"code": rec["gov_code"], "error": str(e)})
            print(f"  [FAIL] {rec['gov_code']} — {e}", file=sys.stderr)

    RUN_LOG.parent.mkdir(parents=True, exist_ok=True)
    import datetime
    is_rerun = RUN_LOG.exists()
    with open(RUN_LOG, "a" if is_rerun else "w", encoding="utf-8") as f:
        if is_rerun:
            f.write(f"\n\n---\n\n## 재실행 {datetime.datetime.now().isoformat(timespec='seconds')}"
                    f"{' (--only-tier=' + args.only_tier + ')' if args.only_tier else ''}\n\n")
        else:
            f.write("# GOV-TREE-EMD-TEAM-SEEDING-RUN_2026-08-03.md\n\n")
        f.write(f"성공 {len(results['success'])}건 / 스킵(기존 등록) "
                f"{len(results['skipped_existing'])}건 / 실패 {len(results['failed'])}건 "
                f"(전체 대상 {len(records)}건, force={args.force})\n\n")
        f.write("## 성공\n")
        for r in results["success"]:
            f.write(f"- {r['code']} → {r['guid']}\n")
        f.write("\n## 스킵(이미 등록돼 있어 건너뜀 — 중복 방지)\n")
        for r in results["skipped_existing"]:
            if "guid" in r:
                f.write(f"- {r['code']} → 기존 {r['guid']}\n")
            else:
                f.write(f"- {r['code']}: {r['reason']}\n")
        f.write("\n## 실패\n")
        for r in results["failed"]:
            f.write(f"- {r['code']}: {r['error']}\n")
    print(f"\n로그 기록: {RUN_LOG}")


if __name__ == "__main__":
    main()
