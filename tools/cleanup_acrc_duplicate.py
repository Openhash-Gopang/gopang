#!/usr/bin/env python3
"""
cleanup_acrc_duplicate.py — ACRC(국민권익위원회) 중복 unclaimed 프로필 정리.

배경(2026-08-03): docs/GOV-TREE-REGISTRY-SEEDING-RUN_2026-08-03.md 로그에
ACRC가 두 번 등록된 게 확인됨:
  1) unclaimed_1d4dc404-5b9a-4cd2-b558-eb79786adaed  ← 최초 70건 배치(정상)
  2) unclaimed_216628bd-5fa4-45fc-80e0-a855fbdd5dc8  ← 이후 --only=ACRC
     재실행으로 생성된 중복(삭제 대상)

이 스크립트는 admin 인증이 필요한 POST /admin/users/bulk-delete를
호출한다 — Claude 세션은 admin 토큰이 없고 네트워크 egress도 막혀 있어
직접 실행할 수 없다. 주피터님이 실제 admin 계정으로 직접 실행해야 한다.

**삭제 대상은 하드코딩돼 있다** — 이 스크립트는 범용 정리 도구가 아니라
이번 ACRC 건 전용이다. 삭제 전에 반드시 --dry-run(기본값)으로 먼저
확인하고, 맞으면 --confirm으로 실제 삭제할 것.

사용법:
  # 1) 삭제 전 확인 (실제 삭제 없음, admin 토큰도 아직 필요 없음)
  python3 tools/cleanup_acrc_duplicate.py

  # 2) 실제 삭제 (admin 이메일/비밀번호 입력 프롬프트 뜸)
  python3 tools/cleanup_acrc_duplicate.py --confirm
"""
import argparse
import getpass
import json
import sys
import urllib.request
import urllib.error

WORKER_BASE_DEFAULT = "https://hondi-proxy.tensor-city.workers.dev"

KEEP_GUID = "unclaimed_1d4dc404-5b9a-4cd2-b558-eb79786adaed"    # 최초 정상 등록분 — 유지
DELETE_GUID = "unclaimed_216628bd-5fa4-45fc-80e0-a855fbdd5dc8"  # 중복 재등록분 — 삭제 대상

_UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
       "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")


def _post(worker_base, path, payload, token=None, timeout=15):
    headers = {"Content-Type": "application/json", "User-Agent": _UA}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(
        f"{worker_base.rstrip('/')}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--worker-base", default=WORKER_BASE_DEFAULT)
    ap.add_argument("--confirm", action="store_true",
                     help="실제로 삭제를 실행한다. 없으면 무엇을 할지만 출력하고 끝난다.")
    ap.add_argument("--email", default=None, help="admin 이메일(없으면 프롬프트로 입력받음)")
    args = ap.parse_args()

    print(f"유지할 guid  : {KEEP_GUID}  (최초 정상 등록분)")
    print(f"삭제할 guid  : {DELETE_GUID}  (--only=ACRC 재실행으로 생긴 중복)")
    print(f"worker_base  : {args.worker_base}")

    if not args.confirm:
        print("\n[DRY-RUN] --confirm 없이 실행됨 — 아무것도 삭제하지 않았습니다.")
        print("확인하신 뒤 --confirm을 붙여 다시 실행해주세요.")
        return

    email = args.email or input("\nadmin 이메일: ").strip()
    password = getpass.getpass("admin 비밀번호: ")

    print("\n[1/2] admin 로그인 중...")
    try:
        login_res = _post(args.worker_base, "/admin/login", {"email": email, "password": password})
    except urllib.error.HTTPError as e:
        print(f"로그인 실패: HTTP {e.code} — {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)
    token = login_res.get("token")
    if not token:
        print(f"로그인 응답에 token이 없습니다: {login_res}", file=sys.stderr)
        sys.exit(1)
    print(f"  로그인 성공 (admin={login_res.get('admin')}, 토큰 30분 유효)")

    print(f"\n[2/2] 중복 프로필 삭제 중... ({DELETE_GUID})")
    try:
        del_res = _post(
            args.worker_base, "/admin/users/bulk-delete",
            {"identifiers": [DELETE_GUID]}, token=token,
        )
    except urllib.error.HTTPError as e:
        print(f"삭제 실패: HTTP {e.code} — {e.read().decode('utf-8', errors='replace')}", file=sys.stderr)
        sys.exit(1)

    print(f"  결과: {json.dumps(del_res, ensure_ascii=False, indent=2)}")
    print(f"\n완료. K-Search에서 '국민권익위원회' 검색 시 이제 {KEEP_GUID} 하나만 나와야 합니다 "
          f"— 확인해보세요.")


if __name__ == "__main__":
    main()
