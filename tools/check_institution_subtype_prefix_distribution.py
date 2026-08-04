# -*- coding: utf-8 -*-
"""
check_institution_subtype_prefix_distribution.py — institution 1313건
전체를 페이지네이션으로 훑어 entity_subtype 접두어(콜론 앞부분)별
건수를 집계한다. "제주 267건 + 그 이상"이 정확히 뭘로 구성됐는지
확인해야 백필 범위를 올바르게 정한다.

사용:
  python check_institution_subtype_prefix_distribution.py
"""
import json
import urllib.request
import urllib.parse
import time
from collections import Counter

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")
L1_BASE = "https://l1-hanlim.hondi.net"


def l1_page(page, per_page=100):
    filt = urllib.parse.quote("entity_type = 'institution'")
    url = "{}/api/collections/profiles/records?filter={}&perPage={}&page={}&sort=created".format(
        L1_BASE, filt, per_page, page)
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    prefix_counts = Counter()
    no_subtype = 0
    examples_by_prefix = {}
    page = 1
    total_seen = 0

    while True:
        data = l1_page(page)
        items = data.get("items", [])
        if not items:
            break
        total_pages = data.get("totalPages", page)
        total_items = data.get("totalItems", "?")

        for p in items:
            extra = p.get("extra") or {}
            identity = (extra.get("public") or {}).get("identity") or {}
            st = identity.get("entity_subtype")
            if not st:
                no_subtype += 1
                continue
            prefix = st.split(":", 1)[0] if ":" in st else st
            prefix_counts[prefix] += 1
            if prefix not in examples_by_prefix:
                examples_by_prefix[prefix] = p.get("name")

        total_seen += len(items)
        print(f"[{page}/{total_pages}페이지] 누적 {total_seen}/{total_items}건 처리")

        if page >= total_pages:
            break
        page += 1
        time.sleep(0.3)

    print("\n=== entity_subtype 접두어별 분포 ===")
    for prefix, count in prefix_counts.most_common():
        print(f"  {prefix:20s} {count:5d}건   예: {examples_by_prefix[prefix]}")
    print(f"\n  (entity_subtype 없음)  {no_subtype:5d}건")
    print(f"\n총 확인: {total_seen}건")


if __name__ == "__main__":
    main()
