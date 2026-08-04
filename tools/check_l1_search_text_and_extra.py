# -*- coding: utf-8 -*-
"""
check_l1_search_text_and_extra.py — description 필드가 아예 없다는 게
확인됐으니, search_text·occupation·extra 안에 실제 업무 서술이 있는지
확인한다. 이 중 뭐가 됐든 실제 내용이 있는 걸 entity-embed-index의
임베딩 원문으로 써야 한다.

사용:
  python check_l1_search_text_and_extra.py
"""
import json
import urllib.request
import urllib.parse

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

L1_BASE = "https://l1-hanlim.hondi.net"

TARGETS = [
    "소통청렴담당관", "기획조정실", "대변인",
    "경제활력국", "건설주택국", "도민안전건강실(안전건강실)", "교통항공국",
]


def l1_get(name):
    filt = urllib.parse.quote("name = '{}'".format(name))
    url = "{}/api/collections/profiles/records?filter={}&perPage=1".format(L1_BASE, filt)
    req = urllib.request.Request(url, headers={"User-Agent": _UA})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    for name in TARGETS:
        try:
            data = l1_get(name)
        except Exception as e:
            print("===", name, "=== 조회 실패:", e)
            continue
        items = data.get("items", [])
        if not items:
            print("===", name, "=== NOT FOUND")
            continue
        p = items[0]
        print("===", name, "===")
        print("occupation:", repr(p.get("occupation"))[:200])
        print("search_text:", repr(p.get("search_text"))[:300])
        extra = p.get("extra") or {}
        print("extra 최상위 키:", list(extra.keys()) if isinstance(extra, dict) else type(extra))
        print("extra 전체(500자):", json.dumps(extra, ensure_ascii=False)[:500])
        print()


if __name__ == "__main__":
    main()
