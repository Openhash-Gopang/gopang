#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_gov_tree_citydept_natagency.py — city-dept(14)·국가기관 지사(34) 시딩

배경: seed_gov_tree_remaining_registry.py는 prompts/gov-tree/**/SP-*.md를
rglob으로 스캔하는데, city-dept와 국가기관 지사는 개별 파일이 아니라
템플릿(SP-CITYDEPT-*-TEMPLATE_v1.0.md / SP-NAT-{DOMAIN}-TEMPLATE_v1.2.md)
+ 마스터데이터(JSON)로 렌더링되는 방식이라 그 스크립트가 못 찾는다
(dry-run 결과에 city-dept/nat-agency tier 자체가 없었던 이유).
이 스크립트는 그 두 마스터데이터 JSON을 직접 읽어 같은 profiles 등록
계약(entity_subtype="{tier}:{code}")으로 시딩한다.

- city-dept: entity_subtype = "city-dept:{시코드}-{국코드}" (예: city-dept:jejusi-jachi)
    소스: prompts/gov-tree/04-city/templates/city-dept-master-data.json
    이미 있는 필드(입력_문구/출력_문구/산하과목록)로 description을 채우므로
    다른 tier들과 달리 "역할 서술 공백" 문제가 없다 — 전부 active로 등록.
- nat-agency: entity_subtype = "nat-agency:{domain}" (예: nat-agency:airport)
    소스: prompts/gov-tree/09-national/agencies/templates/national-agency-master-data.json
    (도코드=jeju만, 34건) — 마스터데이터엔 역할 서술이 없어 도메인별
    TEMPLATE 파일의 "- 주요 업무:" 문구를 찾아 채운다(gen_gov_registry.py에서
    이미 검증한 추출 방식 재사용).

directCode 연결(gov-router.js)은 아직 없음 — 지금은 등록만 해서 K-Search
검색 가능하게 만드는 게 목적(§1 원칙 충족). 등록되면 launch는 kgov로
안전 폴백(§1 원칙이 보장하는 동작, institution/org와 동일).
"""
import argparse
import json
import os
import re
import sys
import urllib.request
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from _gov_seed_common import find_existing_guid  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
GOVTREE = REPO_ROOT / "prompts" / "gov-tree"
RUN_LOG = REPO_ROOT / "docs" / "GOV-TREE-CITYDEPT-NATAGENCY-SEEDING-RUN_2026-08-03.md"

DUTY_RE = re.compile(r"-\s*주요\s*업무\s*:\s*(.+)")


def collect_city_dept():
    data = json.loads((GOVTREE / "04-city/templates/city-dept-master-data.json").read_text(encoding="utf-8"))
    records = []
    for r in data["국목록"]:
        if r["시코드"] not in ("jejusi", "seogwipo"):
            continue
        code = f"{r['시코드']}-{r['국코드']}"
        desc = f"산하 과: {r['산하과목록']}. 처리 업무: {r['입력_문구']}. 산출물: {r['출력_문구']}."
        records.append({
            "code": code,
            "gov_code": f"city-dept:{code}",
            "name": f"{r['시이름']} {r['국이름']}",
            "description": desc,
            "status": "active",  # 마스터데이터 필드로 채워지므로 공백 문제 없음
            "source_file": "04-city/templates/city-dept-master-data.json",
            "tier_prefix": "city-dept",
        })
    return records


def collect_nat_agency():
    data = json.loads((GOVTREE / "09-national/agencies/templates/national-agency-master-data.json").read_text(encoding="utf-8"))
    records = []
    template_cache = {}
    for r in data["기관목록"]:
        if r.get("도코드") != "jeju":
            continue
        domain = r["domain"]
        tfile = r.get("template")
        duty = None
        if tfile:
            tpath = GOVTREE / "09-national/agencies/templates" / tfile
            if tpath not in template_cache and tpath.exists():
                template_cache[tpath] = tpath.read_text(encoding="utf-8", errors="replace")
            ttext = template_cache.get(tpath)
            if ttext:
                m = DUTY_RE.search(ttext)
                duty = m.group(1).strip() if m else None
        desc = f"소속: {r.get('소속부처','')}." + (f" 주요 업무: {duty}" if duty else "")
        has_duty = bool(duty)
        records.append({
            "code": domain,
            "gov_code": f"nat-agency:{domain}",
            "name": r["지사명"],
            "description": desc,
            "status": "active" if has_duty else "pending_review",
            "source_file": f"09-national/agencies/templates/{tfile}",
            "tier_prefix": "nat-agency",
        })
    return records


def build_payload(rec):
    return {
        "entity_type": "institution",
        "name": rec["name"],
        "description": rec["description"] or f"{rec['name']} — 역할 서술 보강 필요({rec['source_file']})",
        "tags": ["gov-tree", rec["tier_prefix"], rec["code"]],
        "occupation": "공공기관" if rec["tier_prefix"] == "nat-agency" else "정부기관",
        "entity_subtype": rec["gov_code"],
        "claim_source": "gov_tree_seed_v3",
        "claim_status": "unclaimed",
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--worker-base", default=os.environ.get("WORKER_BASE", "https://hondi-proxy.tensor-city.workers.dev"))
    ap.add_argument("--only-tier", default=None, help="city-dept,nat-agency 중 콤마구분")
    # ★ 2026-08-03 신설 — seed_gov_tree_registry.py의 ACRC 중복 등록 사고
    # 이후 전체 시딩 스크립트에 동일하게 적용하는 안전장치. 기본값은
    # "확인 후 스킵" — 강제 재등록은 --force로만.
    ap.add_argument("--force", action="store_true",
                     help="이미 등록된 code도 확인 없이 강제로 새로 POST(위험 — "
                          "중복 생성됨). 기본은 꺼짐.")
    args = ap.parse_args()

    records = collect_city_dept() + collect_nat_agency()
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
    # ★ 2026-08-03 수정 — 기존엔 무조건 "w"(덮어쓰기)라 재실행하면 이전
    # 성공 기록이 통째로 사라졌다(seed_gov_tree_registry.py가 겪었던 것과
    # 동일한 버그 패턴). 로그가 이미 있으면 이어붙인다.
    import datetime
    is_rerun = RUN_LOG.exists()
    with open(RUN_LOG, "a" if is_rerun else "w", encoding="utf-8") as f:
        if is_rerun:
            f.write(f"\n\n---\n\n## 재실행 {datetime.datetime.now().isoformat(timespec='seconds')}"
                    f"{' (--only-tier=' + args.only_tier + ')' if args.only_tier else ''}\n\n")
        else:
            f.write("# GOV-TREE-CITYDEPT-NATAGENCY-SEEDING-RUN_2026-08-03.md\n\n")
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
