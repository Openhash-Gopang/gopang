# -*- coding: utf-8 -*-
"""
sync_gopang_wallet_to_satellites.py

허브(gopang)의 gopang-wallet.js를 18개 위성 저장소(K-서비스별)에 그대로
동기화합니다. tools/check_wallet_sync.py로 실측한 결과, 전부 허브보다
9,133바이트 뒤처져 있었고(2026-07-21 "WALLET_DECRYPT_FAILED 구분 없이
새 지갑을 조용히 자동생성" 버그 수정분이 통째로 누락) — 오늘 아침
"동기화 완료"로 기록된 커밋이 실제로는 gopang-wallet.js를 반영하지
않았던 것으로 보입니다.

동작:
  - 이 스크립트가 있는 위치를 기준으로, ".. (상위 폴더)의 gopang-wallet.js"
    를 원본으로 사용합니다 — 즉 이 파일을 gopang 저장소 "바로 위" 폴더에
    두고 실행하거나, --hub 옵션으로 경로를 직접 지정하세요.
  - 각 위성 저장소를 임시 폴더에 얕은 클론 → gopang-wallet.js만 교체 →
    내용이 실제로 다를 때만 커밋 → main에 직접 push.
  - 이미 동일한 저장소는 조용히 건너뜁니다(불필요한 커밋 방지).
  - 각 저장소 처리 후 임시 클론은 삭제합니다.

요구사항: 이 컴퓨터의 git이 이미 Openhash-Gopang 조직 저장소에 push
권한이 있어야 합니다(오늘 하루 종일 gopang 저장소에 push해온 것과
동일한 자격 증명 사용).

사용법:
  python sync_gopang_wallet_to_satellites.py
  python sync_gopang_wallet_to_satellites.py --hub "C:\\Users\\주피터\\Downloads\\gopang\\gopang-wallet.js"
  python sync_gopang_wallet_to_satellites.py --dry-run   (실제 push 없이 무엇이 다른지만 확인)
"""
import argparse
import hashlib
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

SATELLITE_REPOS = [
    "911", "democracy", "gdc", "health", "insurance", "jeju", "klaw",
    "logistics", "market", "police", "public", "qna", "school",
    "security", "stock", "tax", "traffic", "users",
]

ORG = "Openhash-Gopang"
FILE_NAME = "gopang-wallet.js"


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def run(cmd, cwd=None, check=True):
    result = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True)
    if check and result.returncode != 0:
        raise RuntimeError(f"명령 실패: {' '.join(cmd)}\n{result.stdout}\n{result.stderr}")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--hub", default=None, help="허브 gopang-wallet.js 경로 (기본: 이 스크립트 상위 폴더의 gopang/gopang-wallet.js 또는 ../gopang-wallet.js 자동 탐색)")
    ap.add_argument("--dry-run", action="store_true", help="실제 커밋/푸시 없이 차이만 확인")
    args = ap.parse_args()

    if args.hub:
        hub_path = Path(args.hub)
    else:
        candidates = [
            Path.cwd() / "gopang-wallet.js",
            Path.cwd() / "gopang" / "gopang-wallet.js",
            Path.cwd().parent / "gopang" / "gopang-wallet.js",
        ]
        hub_path = next((c for c in candidates if c.exists()), None)
        if not hub_path:
            print("[FAIL] 허브 gopang-wallet.js를 자동으로 못 찾았습니다. --hub 경로로 직접 지정해주세요.")
            print("       예: python sync_gopang_wallet_to_satellites.py --hub \"C:\\Users\\주피터\\Downloads\\gopang\\gopang-wallet.js\"")
            sys.exit(1)

    if not hub_path.exists():
        print(f"[FAIL] 허브 파일을 찾을 수 없습니다: {hub_path}")
        sys.exit(1)

    hub_hash = sha256_of(hub_path)
    print(f"허브 파일: {hub_path}  sha256={hub_hash[:16]}...  ({hub_path.stat().st_size} bytes)")
    print()

    synced, skipped, failed = [], [], []

    for repo in SATELLITE_REPOS:
        print(f"── {repo} " + "─" * (40 - len(repo)))
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            clone_url = f"https://github.com/{ORG}/{repo}.git"
            try:
                run(["git", "clone", "--depth", "1", clone_url, str(tmp / repo)])
            except RuntimeError as e:
                print(f"  [FAIL] 클론 실패: {e}")
                failed.append(repo)
                continue

            repo_dir = tmp / repo
            target = repo_dir / FILE_NAME
            if not target.exists():
                print(f"  [SKIP] 이 저장소엔 {FILE_NAME}가 없습니다.")
                skipped.append(repo)
                continue

            target_hash_before = sha256_of(target)
            if target_hash_before == hub_hash:
                print(f"  [SKIP] 이미 허브와 동일함.")
                skipped.append(repo)
                continue

            shutil.copy2(hub_path, target)

            if args.dry_run:
                print(f"  [DRY-RUN] 차이 있음 — 실제로는 push 안 함. (이전 hash={target_hash_before[:16]}...)")
                continue

            run(["git", "-C", str(repo_dir), "add", FILE_NAME])
            commit_result = run(
                ["git", "-C", str(repo_dir), "commit", "-m",
                 f"sync: gopang-wallet.js 허브(gopang) 최신본으로 동기화 (WALLET_DECRYPT_FAILED 구분 수정 포함, 2026-07-22)"],
                check=False,
            )
            if commit_result.returncode != 0:
                print(f"  [SKIP] 커밋할 변경 없음(이미 동일).")
                skipped.append(repo)
                continue

            try:
                run(["git", "-C", str(repo_dir), "push", "origin", "HEAD:main"])
            except RuntimeError as e:
                print(f"  [FAIL] push 실패(브랜치 보호 등일 수 있음): {e}")
                failed.append(repo)
                continue

            print(f"  [OK] 동기화 완료 및 push됨.")
            synced.append(repo)

    print()
    print("=" * 50)
    print(f"동기화됨: {len(synced)}  {synced}")
    print(f"건너뜀(이미 동일/파일 없음): {len(skipped)}  {skipped}")
    print(f"실패: {len(failed)}  {failed}")
    if failed:
        print("\n실패한 저장소는 브랜치 보호 규칙이 걸려있을 수 있습니다 —")
        print("그 경우 수동으로 브랜치+PR 절차로 진행해주세요.")
        sys.exit(1)


if __name__ == "__main__":
    main()
