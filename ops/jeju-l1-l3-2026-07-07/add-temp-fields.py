#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
add-temp-fields.py
trade_ratings/온도 기능을 위해 각 L1의 profiles 컬렉션에 필드 3개를 추가한다:
  temp_score(number, 기본 36.5), temp_rating_count(number), temp_updated_at(text)

provision-l1-nodes.py와 동일한 컨벤션(admin_token, http_json, --only)을 따른다.
스키마 PATCH이므로 기존 필드는 건드리지 않고 없는 필드만 append한다(멱등 —
이미 있으면 건너뜀. 여러 번 실행해도 안전).

실행 전 확인: profiles 컬렉션이 이미 있는 L1만 대상으로 해야 한다 — 신규
프로비저닝된 L1(아직 profiles가 없는 경우)엔 이 스크립트가 아니라
provision-l1-nodes.py의 SOURCE_COLLECTIONS 클론 과정에서 profiles도 같이
포함시켜야 한다(현재 SOURCE_COLLECTIONS엔 profiles가 없다 — 별도 확인 필요).
"""
import argparse
import json
import urllib.request
import urllib.error

TOPOLOGY_FILE = "topology.json"

NEW_FIELDS = [
    {"name": "temp_score",        "type": "number", "required": False,
     "options": {"min": 0, "max": 99}},
    {"name": "temp_rating_count", "type": "number", "required": False,
     "options": {"min": 0}},
    {"name": "temp_updated_at",   "type": "text",   "required": False},
]
DEFAULT_TEMP = 36.5


def http_json(method, url, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def admin_token(base_url, email, password):
    status, data = http_json("POST", f"{base_url}/api/admins/auth-with-password",
                              body={"identity": email, "password": password})
    if status != 200:
        raise RuntimeError(f"admin auth 실패({base_url}): {status} {data}")
    return data["token"]


def add_temp_fields(base_url, token):
    status, data = http_json("GET", f"{base_url}/api/collections/profiles", token=token)
    if status != 200:
        print(f"  [!] profiles 컬렉션 조회 실패({base_url}): {status} {data}")
        return

    schema = data.get("schema", [])
    existing_names = {f["name"] for f in schema}
    added = []
    for field in NEW_FIELDS:
        if field["name"] in existing_names:
            print(f"  [.] {field['name']} 이미 존재 — 건너뜀")
            continue
        schema.append(field)
        added.append(field["name"])

    if not added:
        print(f"  [.] 추가할 필드 없음(전부 이미 존재) @ {base_url}")
        return

    payload = {"schema": schema}
    status2, data2 = http_json("PATCH", f"{base_url}/api/collections/profiles",
                                token=token, body=payload)
    if status2 == 200:
        print(f"  [+] 필드 추가 완료: {added} @ {base_url}")
    else:
        print(f"  [!] 필드 추가 실패({status2}) @ {base_url}: {data2}")


def backfill_defaults(base_url, token, dry_run):
    # temp_score가 null인 기존 레코드에 기본값(36.5)/카운트(0) 채우기.
    # PocketBase 필터로 "필드 없음"과 "null"을 구분하기 어려우므로, 전체를
    # 페이지네이션으로 순회하며 temp_score가 falsy인 것만 PATCH한다.
    page = 1
    patched = 0
    while True:
        status, data = http_json(
            "GET",
            f"{base_url}/api/collections/profiles/records?perPage=200&page={page}",
            token=token,
        )
        if status != 200:
            print(f"  [!] 레코드 조회 실패(page={page}): {status}")
            break
        items = data.get("items", [])
        if not items:
            break
        for rec in items:
            if rec.get("temp_score") is None:
                if dry_run:
                    patched += 1
                    continue
                pstatus, _ = http_json(
                    "PATCH",
                    f"{base_url}/api/collections/profiles/records/{rec['id']}",
                    token=token,
                    body={"temp_score": DEFAULT_TEMP, "temp_rating_count": 0},
                )
                if pstatus == 200:
                    patched += 1
        if len(items) < 200:
            break
        page += 1
    verb = "백필 대상(dry-run)" if dry_run else "백필 완료"
    print(f"  [+] {verb}: {patched}건 @ {base_url}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--only", help="쉼표구분 폴더명만 처리(예: hanlim,l1-aewol). 미지정 시 hanlim만.")
    ap.add_argument("--backfill", action="store_true",
                     help="기존 레코드의 temp_score/temp_rating_count 기본값 채우기까지 실행")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    # topology.json에 있는 애월 등 신규 L1은 provision-l1-nodes.py가 만든
    # 포트로 접근(로컬 127.0.0.1:{port}). hanlim은 8091 고정.
    targets = {"hanlim": 8091}
    try:
        topo = json.load(open(TOPOLOGY_FILE, encoding="utf-8"))
        for folder, cfg in topo.items():
            if cfg.get("layer") == 1 and folder != "hanlim":
                targets[folder] = cfg["port"]
    except FileNotFoundError:
        print(f"  [.] {TOPOLOGY_FILE} 없음 — hanlim만 대상으로 진행")

    if args.only:
        wanted = set(args.only.split(","))
        targets = {f: p for f, p in targets.items() if f in wanted}
    else:
        targets = {"hanlim": targets.get("hanlim", 8091)}  # 기본값: hanlim만(안전)

    print(f"대상 L1: {list(targets.keys())}")

    for folder, port in targets.items():
        base_url = f"http://127.0.0.1:{port}"
        print(f"\n=== {folder} ({base_url}) ===")
        try:
            token = admin_token(base_url, args.admin_email, args.admin_password)
        except Exception as e:
            print(f"  [!] 인증 실패, 건너뜀: {e}")
            continue
        add_temp_fields(base_url, token)
        if args.backfill:
            backfill_defaults(base_url, token, args.dry_run)

    print("\n완료.")


if __name__ == "__main__":
    main()
