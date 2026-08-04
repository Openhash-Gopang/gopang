#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_jeju_gov_tree_3axis.py — "1단계(제주) 완결" 여부를 3개 축으로
교차검증한다:
  (a) SP 파일 존재  — prompts/gov-tree/{01-do..07-org}에 실제 .md가 있는가
  (b) PocketBase 등록 — L1 profiles에 검색 가능한 레코드로 있는가
  (c) 상속 체인 선언 — §0/상위 상속 필드가 현재 표준(kgov+UNIVERSAL-common)
      을 따르는가, 아니면 폐기된 JEJU-GOV-COMMON을 아직 참조하는가, 아니면
      선언 자체가 없는가

로컬 스캔(a·c)은 저장소 루트에서 실행해야 한다(prompts/gov-tree/ 상대경로
읽음). PocketBase 조회(b)는 공개 레코드라 admin 토큰 없이 된다.

매칭 기준: institution_name(SP 문서명에서 추출) ↔ profiles.name. 오탈자·
띄어쓰기 차이로 매칭 실패하는 경우가 있을 수 있어 UNMATCHED 목록을 반드시
사람이 한 번 더 확인해야 한다(자동 매칭 실패 ≠ 실제 결측, 이름 표기
차이일 수 있음).

09-national(국가기관)은 이번 감사 범위 밖 — "제주 지역" 1단계 완결
여부만 본다(주피터님 지시, 2026-08-04).

사용:
  python audit_jeju_gov_tree_3axis.py --worker-base https://hondi-proxy.tensor-city.workers.dev
"""
import argparse
import json
import re
import sys
import time
import urllib.request
import urllib.parse
from pathlib import Path

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
L1_BASE = "https://l1-hanlim.hondi.net"

JEJU_TIER_DIRS = [
    "01-do", "02-do-dept", "02-do-dept/divisions",
    "03-do-agency", "03-do-agency/divisions",
    "04-city", "04-city/divisions", "04-city/jeju", "04-city/seogwipo",
    "05-emd", "05-emd/hallim",
    "07-org", "07-org/divisions",
]

HDR_CODE = re.compile(r"#\s*문서\s*코드\s*:\s*(\S+)")
HDR_VER = re.compile(r"#\s*버전\s*:\s*(\S+)")
HDR_PARENT = re.compile(r"#\s*상위\s*상속\s*:\s*(.+)")
HDR_TITLE = re.compile(r"#\s*문서명\s*:\s*(.+)")


def _ver_key(v):
    if not v:
        return (0, 0)
    m = re.match(r"v?(\d+)\.(\d+)", v)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def scan_local_sp_files(gov_tree_root):
    root = Path(gov_tree_root)
    all_versions = []
    for d in JEJU_TIER_DIRS:
        dirpath = root / d
        if not dirpath.is_dir():
            continue
        for f in sorted(dirpath.glob("*.md")):
            if "TEMPLATE" in f.name.upper():
                continue
            text = f.read_text(encoding="utf-8", errors="replace")
            head = text[:3000]
            code_m = HDR_CODE.search(head)
            ver_m = HDR_VER.search(head)
            parent_m = HDR_PARENT.search(head)
            title_m = HDR_TITLE.search(head)

            parent = parent_m.group(1).strip() if parent_m else None
            chain_status = "NO_DECLARATION"
            if parent:
                if "JEJU-GOV-COMMON" in parent and "폐기" not in parent:
                    chain_status = "DEPRECATED_JEJU_GOV_COMMON"
                elif "kgov" in parent and "UNIVERSAL-common" in parent:
                    chain_status = "CURRENT_KGOV_UNIVERSAL"
                else:
                    chain_status = "OTHER"

            title = title_m.group(1).strip() if title_m else None
            institution_name = re.split(r"\s*[—–-]\s*", title)[0].strip() if title else None

            all_versions.append({
                "tier_dir": d, "file": str(f),
                "sp_code": code_m.group(1) if code_m else None,
                "version": ver_m.group(1) if ver_m else None,
                "institution_name": institution_name,
                "chain_status": chain_status,
            })

    latest = {}
    for r in all_versions:
        key = r["sp_code"] or r["file"]
        if key not in latest or _ver_key(r["version"]) > _ver_key(latest[key]["version"]):
            latest[key] = r
    return list(latest.values())


def l1_list_all_jeju_institutions(timeout, retries, backoff_base):
    """entity_subtype 접두어가 제주 티어(do:, do-dept:, do-dept-div:,
    do-agency:, do-agency-div:, city-dept:, city-div:, emd:, org:,
    org-div:)인 profiles를 전수 조회."""
    filt = urllib.parse.quote("entity_type = 'institution'")
    items_all = []
    page = 1
    while True:
        url = (f"{L1_BASE}/api/collections/profiles/records"
               f"?filter={filt}&perPage=100&page={page}&sort=created")
        last_err = None
        data = None
        for attempt in range(retries + 1):
            req = urllib.request.Request(url, headers={"User-Agent": _UA})
            try:
                with urllib.request.urlopen(req, timeout=timeout) as r:
                    data = json.loads(r.read().decode("utf-8"))
                    break
            except Exception as e:
                last_err = str(e)
                if attempt < retries:
                    time.sleep(backoff_base * (2 ** attempt))
        if data is None:
            print(f"[FATAL] {page}페이지 조회 실패: {last_err}")
            sys.exit(1)
        items = data.get("items", [])
        if not items:
            break
        items_all.extend(items)
        total_pages = data.get("totalPages", page)
        if page >= total_pages:
            break
        page += 1
        time.sleep(0.2)
    return items_all


JEJU_SUBTYPE_PREFIXES = (
    "do:", "do-dept:", "do-dept-div:", "do-agency:", "do-agency-div:",
    "city-dept:", "city-div:", "emd:", "org:", "org-div:", "city:",
)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default="https://hondi-proxy.tensor-city.workers.dev")
    ap.add_argument("--gov-tree-root", default="prompts/gov-tree")
    ap.add_argument("--out", default="results_jeju_gov_tree_3axis_audit")
    ap.add_argument("--timeout", type=int, default=30)
    ap.add_argument("--retries", type=int, default=3)
    ap.add_argument("--backoff-base", type=float, default=2.0)
    args = ap.parse_args()

    out_dir = Path(args.out)
    out_dir.mkdir(parents=True, exist_ok=True)

    print("[1/3] 로컬 SP 파일 스캔 중…")
    sp_files = scan_local_sp_files(args.gov_tree_root)
    print(f"  → {len(sp_files)}건(SP당 최신 버전만)")

    print("\n[2/3] PocketBase institution 전수 조회 중…")
    all_institutions = l1_list_all_jeju_institutions(args.timeout, args.retries, args.backoff_base)
    jeju_registered = []
    for p in all_institutions:
        extra = p.get("extra") or {}
        identity = (extra.get("public") or {}).get("identity") or {}
        st = identity.get("entity_subtype") or ""
        if st.startswith(JEJU_SUBTYPE_PREFIXES):
            jeju_registered.append({"name": p.get("name"), "entity_subtype": st, "guid": p.get("guid")})
    print(f"  → institution 전체 {len(all_institutions)}건 중 제주 티어 접두어 매칭 {len(jeju_registered)}건")

    print("\n[3/3] 교차검증 중…")
    registered_names = {r["name"] for r in jeju_registered if r["name"]}
    sp_names = {r["institution_name"] for r in sp_files if r["institution_name"]}

    sp_but_not_registered = sorted(sp_names - registered_names)
    registered_but_no_sp = sorted(registered_names - sp_names)
    both = sorted(sp_names & registered_names)

    chain_counts = {}
    for r in sp_files:
        chain_counts.setdefault(r["chain_status"], 0)
        chain_counts[r["chain_status"]] += 1

    report = {
        "sp_files_total": len(sp_files),
        "pocketbase_jeju_registered_total": len(jeju_registered),
        "both_sp_and_registered": len(both),
        "sp_exists_not_registered": sp_but_not_registered,
        "registered_no_sp_matched": registered_but_no_sp,
        "chain_declaration_status": chain_counts,
    }
    (out_dir / "audit_report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "sp_files_scan.json").write_text(
        json.dumps(sp_files, ensure_ascii=False, indent=2), encoding="utf-8")
    (out_dir / "pocketbase_registered.json").write_text(
        json.dumps(jeju_registered, ensure_ascii=False, indent=2), encoding="utf-8")

    print("\n=== 요약 ===")
    print(f"SP 파일 존재:            {len(sp_files)}건")
    print(f"PocketBase 등록(제주):   {len(jeju_registered)}건")
    print(f"양쪽 다 있음:            {len(both)}건")
    print(f"SP는 있는데 미등록:      {len(sp_but_not_registered)}건  ← §4-3류 시딩 공백")
    print(f"등록은 됐는데 SP 이름 매칭 안 됨: {len(registered_but_no_sp)}건  ← 이름 표기차 또는 placeholder만")
    print()
    print("상속 체인 선언 상태:")
    for status, count in sorted(chain_counts.items()):
        print(f"  {status:30s} {count:4d}건")

    if sp_but_not_registered:
        print("\n[SP는 있는데 미등록] (상위 20건)")
        for n in sp_but_not_registered[:20]:
            print("  -", n)

    print(f"\n전체 결과: {out_dir}/")


if __name__ == "__main__":
    main()
