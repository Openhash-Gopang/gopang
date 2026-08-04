#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
seed_busan_pilot_org_busantransit.py — 부산 파일럿 org tier 1호(부산교통공사)
PocketBase 프로필 등록.

배경: 2026-08-04 세션에서 directCode 도(道) 하드코딩 버그를 고치고
BUSAN_ORG_TABLE(gov-router.js)·SP-ORG-BUSANTRANSIT_v1.0.md(SP 콘텐츠)까지
만들었다 — 이 스크립트가 마지막 조각(K-Search가 실제로 찾을 수 있도록
PocketBase에 프로필로 등록)이다. 등록되면 서버가 자동으로 search_text를
계산하고 entity-semantic-search 색인까지 자동으로 탄다(PR #218 자동
인덱싱 훅) — 이 스크립트가 색인까지 따로 챙길 필요는 없다.

entity_subtype="org:SP-ORG-BUSANTRANSIT" 규약은 gwp-registry.js가
directCode로 그대로 넘기는 값과 정확히 일치해야 한다(seed_gov_tree_
registry.py의 policy: 접두어 규약과 동일한 tier:code 형식).

사용:
  python seed_busan_pilot_org_busantransit.py                # dry-run(기본)
  python seed_busan_pilot_org_busantransit.py --apply         # 실제 등록
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error

RECORD = {
    "entity_type": "institution",
    "name": "부산교통공사",
    "description": (
        "부산 도시철도 1~4호선을 건설·운영하는 부산광역시 지방공기업(지방공기업법 "
        "제49조·부산광역시조례 제6287호 근거, 2006년 설립). 도시교통 발전과 시민복리 "
        "증진을 위한 부대사업도 수행한다. 대표전화 051-640-7177, 고객센터(휴메트로) "
        "1544-5005(24시간). 소재지: 부산광역시 부산진구 중앙대로644번길 20(범천동)."
    ),
    "tags": ["gov-tree", "org", "busan-pilot", "SP-ORG-BUSANTRANSIT"],
    "occupation": "지방공기업",
    "entity_subtype": "org:SP-ORG-BUSANTRANSIT",
    "address": "부산광역시 부산진구 중앙대로644번길 20",
    "claim_source": "busan_pilot_seed_20260804",
    "claim_status": "unclaimed",
}


def _existing_check(worker_base, entity_subtype):
    """중복 등록 방지 — ACRC 중복 사고(2026-08-03) 재발 방지 원칙 준수.
    POST /search로 entity_subtype 일치 레코드가 이미 있는지 먼저 확인한다."""
    try:
        req = urllib.request.Request(
            f"{worker_base.rstrip('/')}/search",
            data=json.dumps({"etype": "institution", "q": "부산교통공사", "lim": 20}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            rows = json.loads(resp.read().decode("utf-8"))
        return any(r.get("entity_subtype") == entity_subtype for r in rows if isinstance(r, dict))
    except Exception as e:
        print(f"  [경고] 기존 등록 확인 실패({e}) — 안전을 위해 있는 것으로 간주하고 중단합니다.", file=sys.stderr)
        return True  # 확인 실패 시 안전 측(중복 방지) — 강제 진행하려면 --force 사용


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="실제로 POST 실행(기본은 dry-run)")
    ap.add_argument("--force", action="store_true", help="기존 등록 확인을 건너뛰고 강제 등록(위험)")
    ap.add_argument("--worker-base", default=os.environ.get("WORKER_BASE", "https://hondi-proxy.tensor-city.workers.dev"))
    args = ap.parse_args()

    print(f"등록 대상: {RECORD['name']} (entity_subtype={RECORD['entity_subtype']})")
    print(json.dumps(RECORD, ensure_ascii=False, indent=2))

    if not args.apply:
        print("\n[dry-run] --apply 없이 실행됨 — 실제 등록 안 함. 위 내용 확인 후 --apply로 재실행하세요.")
        return

    if not args.force:
        print("\n기존 등록 여부 확인 중...")
        if _existing_check(args.worker_base, RECORD["entity_subtype"]):
            print("이미 등록된 것으로 보입니다(또는 확인 실패) — 중단합니다. 강제 등록하려면 --force를 추가하세요.")
            sys.exit(1)

    req = urllib.request.Request(
        f"{args.worker_base.rstrip('/')}/profile",
        data=json.dumps(RECORD).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            body = resp.read().decode("utf-8")
            print(f"\n등록 완료 (HTTP {resp.status}):")
            print(body)
    except urllib.error.HTTPError as e:
        print(f"\n등록 실패 (HTTP {e.code}): {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
