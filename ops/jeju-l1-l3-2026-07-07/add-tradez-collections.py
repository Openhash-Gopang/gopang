#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
add-category-medians-collection.py
trade_ratings의 금액 정규화(amount_ratio)에 쓰는 category_medians 컬렉션을
각 L1에 신설한다. _refreshCategoryMedians(worker.js, scheduled() 크론)가
이 컬렉션을 읽고 쓴다.

provision-l1-nodes.py의 create_collection()과 동일 패턴.
"""
import argparse
import json
import urllib.request
import urllib.error

TOPOLOGY_FILE = "topology.json"

CATEGORY_MEDIANS_SCHEMA = {
    "name": "category_medians",
    "type": "base",
    "schema": [
        {"name": "category",      "type": "text",   "required": True},
        {"name": "median_amount", "type": "number", "required": True},
        {"name": "l1_node",       "type": "text",   "required": True},
        {"name": "sample_size",   "type": "number", "required": False},
        {"name": "computed_at",   "type": "text",   "required": False},
    ],
}

# trade_ratings_pocketbase_schema.md(market repo, docs/)와 반드시 동기화할 것.
TRADE_RATINGS_SCHEMA = {
    "name": "trade_ratings",
    "type": "base",
    "schema": [
        {"name": "tx_hash",             "type": "text",   "required": True},
        {"name": "rater_guid",          "type": "text",   "required": True},
        {"name": "ratee_guid",          "type": "text",   "required": True},
        {"name": "rater_role",          "type": "text",   "required": True},
        {"name": "polarity",            "type": "text",   "required": True},
        {"name": "comment",             "type": "text",   "required": False},
        {"name": "comment_translated",  "type": "text",   "required": False},
        {"name": "comment_lang",        "type": "text",   "required": False},
        {"name": "amount",              "type": "number", "required": True},
        {"name": "category",            "type": "text",   "required": True},
        {"name": "rater_temp_snapshot", "type": "number", "required": True},
        {"name": "rater_lang",          "type": "text",   "required": False},
        {"name": "created_at",          "type": "text",   "required": True},
    ],
}


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


def create_collection(base_url, token, schema_def):
    status, data = http_json("POST", f"{base_url}/api/collections", token=token, body=schema_def)
    if status in (200, 201):
        print(f"  [+] {schema_def['name']} 신설 완료 @ {base_url}")
    else:
        print(f"  [.] {schema_def['name']} 신설 스킵/실패({status}) @ {base_url}: {data.get('message','')}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--only", help="쉼표구분 폴더명만 처리(예: hanlim,l1-aewol). 미지정 시 hanlim만.")
    args = ap.parse_args()

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
        targets = {"hanlim": targets.get("hanlim", 8091)}

    print(f"대상 L1: {list(targets.keys())}")
    for folder, port in targets.items():
        base_url = f"http://127.0.0.1:{port}"
        print(f"\n=== {folder} ({base_url}) ===")
        try:
            token = admin_token(base_url, args.admin_email, args.admin_password)
        except Exception as e:
            print(f"  [!] 인증 실패, 건너뜀: {e}")
            continue
        create_collection(base_url, token, TRADE_RATINGS_SCHEMA)
        create_collection(base_url, token, CATEGORY_MEDIANS_SCHEMA)

    print("\n완료. profiles에 temp_score 등 필드도 add-temp-fields.py로 추가해야 온도 갱신이 동작합니다.")


if __name__ == "__main__":
    main()
