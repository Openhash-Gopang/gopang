# -*- coding: utf-8 -*-
"""
check_l1_description_field.py — WRONG-MATCH 4건 + 어트랙터 3건의 L1
PocketBase 원본 레코드를 직접 조회해 description 필드 실체를 확인한다.

배경: entity-semantic-search 파일럿에서 모든 기관의 description이
빈 문자열로 나왔는데, 이게 (a) 진짜 콘텐츠 공백인지 (b) 조회 경로
자체가 description을 안 돌려주는 필드 프로젝션 문제인지 구분이
안 됐다. GET /search, GET /profile 둘 다 description을 응답에서
빼고 있다는 게 코드 확인으로 드러났으므로, L1 PocketBase REST API를
직접 찔러 원본 레코드 전체를 본다(공개 기관 레코드는 is_public=true라
admin 토큰 없이도 조회 가능).

사용:
  python check_l1_description_field.py
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
        print("description:", repr(p.get("description"))[:200])
        print("keys:", list(p.keys()))
        print()


if __name__ == "__main__":
    main()
