#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dedupe-and-index-profiles.py
profiles.guid가 스키마상 unique:true로 선언돼 있었지만 실제 DB 인덱스
(collection.indexes)가 비어 있어 전혀 강제되지 않고 있었다(2026-07-07 실측
발견 — 동일 guid로 레코드 2건 존재 확인). 이 스크립트는:

  1. 같은 guid를 가진 레코드들을 찾아 "가장 완전한" 하나만 남기고 나머지는 삭제
     (완전성 = 비어있지 않은 필드 개수. 동률이면 최근 updated가 우선)
  2. profiles 컬렉션에 실제 UNIQUE INDEX를 추가(collection.indexes)

주의: 1번(삭제)은 되돌릴 수 없다. --dry-run으로 먼저 뭘 지울지 확인할 것.
"""
import argparse
import json
import urllib.request
import urllib.error


def http_json(method, url, token=None, body=None):
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def admin_token(base_url, email, password):
    status, data = http_json("POST", f"{base_url}/api/admins/auth-with-password",
                              body={"identity": email, "password": password})
    if status != 200:
        raise RuntimeError(f"admin auth 실패({base_url}): {status} {data}")
    return data["token"]


def fetch_all_profiles(base_url, token):
    out, page = [], 1
    while True:
        status, data = http_json(
            "GET", f"{base_url}/api/collections/profiles/records?perPage=200&page={page}",
            token=token)
        if status != 200:
            raise RuntimeError(f"profiles 조회 실패: {status} {data}")
        items = data.get("items", [])
        out.extend(items)
        if len(items) < 200:
            break
        page += 1
    return out


def completeness(rec):
    # id/guid/created/updated/collectionId/collectionName 등 메타 필드 제외,
    # 실제 값이 채워진 필드 수를 완전성 점수로 삼는다.
    meta = {"id", "guid", "created", "updated", "collectionId", "collectionName"}
    score = 0
    for k, v in rec.items():
        if k in meta:
            continue
        if v not in (None, "", 0, False, {}, []):
            score += 1
    return score


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--admin-email", required=True)
    ap.add_argument("--admin-password", required=True)
    ap.add_argument("--base-url", default="http://127.0.0.1:8091")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--skip-index", action="store_true",
                     help="중복 정리만 하고 인덱스는 추가하지 않음")
    args = ap.parse_args()

    token = admin_token(args.base_url, args.admin_email, args.admin_password)
    profiles = fetch_all_profiles(args.base_url, token)
    print(f"전체 profiles 레코드: {len(profiles)}건")

    by_guid = {}
    for rec in profiles:
        by_guid.setdefault(rec["guid"], []).append(rec)

    dup_guids = {g: recs for g, recs in by_guid.items() if len(recs) > 1}
    print(f"중복 guid: {len(dup_guids)}개")

    for guid, recs in dup_guids.items():
        recs_sorted = sorted(recs, key=lambda r: (completeness(r), r.get("updated", "")), reverse=True)
        keep, drop = recs_sorted[0], recs_sorted[1:]
        print(f"\n  guid={guid[:30]}...")
        print(f"    유지: {keep['id']} (완전성 {completeness(keep)})")
        for rec in drop:
            print(f"    삭제 대상: {rec['id']} (완전성 {completeness(rec)})")
            if not args.dry_run:
                status, data = http_json(
                    "DELETE", f"{args.base_url}/api/collections/profiles/records/{rec['id']}",
                    token=token)
                if status in (200, 204):
                    print(f"      [+] 삭제 완료")
                else:
                    print(f"      [!] 삭제 실패({status}): {data}")

    if args.dry_run:
        print("\n--dry-run 이므로 실제 삭제·인덱스 추가는 하지 않았습니다.")
        return

    if args.skip_index:
        print("\n--skip-index 지정 — 인덱스 추가 생략.")
        return

    # 중복 정리 후 실제 UNIQUE INDEX 추가
    print("\n=== UNIQUE INDEX 추가 ===")
    status, coll = http_json("GET", f"{args.base_url}/api/collections/profiles", token=token)
    if status != 200:
        print(f"  [!] 컬렉션 조회 실패: {status} {coll}")
        return

    existing_indexes = coll.get("indexes", [])
    idx_sql = "CREATE UNIQUE INDEX idx_profiles_guid ON profiles (guid)"
    if any("idx_profiles_guid" in ix for ix in existing_indexes):
        print("  [.] idx_profiles_guid 이미 존재 — 건너뜀")
        return

    new_indexes = existing_indexes + [idx_sql]
    status2, data2 = http_json(
        "PATCH", f"{args.base_url}/api/collections/profiles",
        token=token, body={"indexes": new_indexes})
    if status2 == 200:
        print("  [+] UNIQUE INDEX(guid) 추가 완료")
    else:
        print(f"  [!] 인덱스 추가 실패({status2}): {data2}")
        print("      (중복이 아직 남아있으면 이 에러가 납니다 — 위 삭제 로그 확인)")


if __name__ == "__main__":
    main()
