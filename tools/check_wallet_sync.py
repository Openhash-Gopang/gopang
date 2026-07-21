#!/usr/bin/env python3
"""
tools/check_wallet_sync.py
-----------------------------------
gopang-wallet.js는 허브(gopang) 하나에서 관리되지만, 실제로는 18개+
위성 저장소(jeju/klaw/tax/school/gdc/police/health/market/democracy/
users/security/...)에 파일 사본이 각자 흩어져 존재한다(단일 소스가
아니라 fan-out 배포 구조). 이 사본들은 수동/스크립트 실행으로만
동기화되는데, 2026-07-19~22 사고실험에서 이게 실제로 두 세대로 갈라진
채 방치돼 있던 걸 발견했다:
  - 그룹 A(klaw/tax/school/gdc/police/health/market/democracy/jeju):
    2026-07-20 step-up biometric 재인증 추가분 누락
  - 그룹 B(users/security): 그룹 A 문제에 더해 2026-07-18 sendGdc()
    P2P 이체 함수 자체가 통째로 누락(허브 대비 -15,623B)

문서(docs/gdc_commerce_completion_plan_v0_1.md)는 "2026-07-19 동기화로
해소됨"이라 자체 기록했지만 실측 결과는 그렇지 않았다 — 즉 "동기화
스크립트를 돌렸다"는 자기보고와 실제 상태가 어긋날 수 있다는 뜻이다.
이 스크립트는 그 자기보고를 신뢰하지 않고, 매번 실제로 GitHub에서
각 저장소의 gopang-wallet.js를 받아와 sha256을 직접 비교한다.

사용법: python3 tools/check_wallet_sync.py
종료 코드: 전부 일치하면 0, 하나라도 불일치하면 1(CI 실패)
"""
import hashlib
import sys
import urllib.request

HUB_FILE = "gopang-wallet.js"

# 2026-07-22 기준 gopang-wallet.js 사본을 갖고 있는 것으로 확인된 위성
# 저장소 목록. 새 위성이 추가되면 여기에 함께 추가할 것 — 목록 누락은
# "검사를 안 하는 것"과 같아서 조용히 드리프트가 재발할 수 있다.
SATELLITE_REPOS = [
    "jeju", "klaw", "tax", "school", "gdc", "police", "health",
    "market", "democracy", "users", "security",
    # 아래는 문서(GDC09)가 언급했으나 이번 조사에서 직접 검증하지 못한
    # 나머지 위성 — 다음 실행에서 반드시 결과 확인할 것.
    "public", "911", "stock", "insurance", "traffic", "logistics",
    "qna", "security",
]
SATELLITE_REPOS = sorted(set(SATELLITE_REPOS))

RAW_URL_TMPL = "https://raw.githubusercontent.com/Openhash-Gopang/{repo}/main/gopang-wallet.js"


def sha256_of(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def fetch(url: str) -> bytes | None:
    try:
        with urllib.request.urlopen(url, timeout=15) as resp:
            return resp.read()
    except Exception as e:
        print(f"  ⚠ 요청 실패: {url} ({e})")
        return None


def main() -> int:
    with open(HUB_FILE, "rb") as f:
        hub_bytes = f.read()
    hub_hash = sha256_of(hub_bytes)
    print(f"허브 gopang-wallet.js: {hub_hash}  ({len(hub_bytes)} bytes)")
    print()

    mismatches = []
    unreachable = []

    for repo in SATELLITE_REPOS:
        url = RAW_URL_TMPL.format(repo=repo)
        data = fetch(url)
        if data is None:
            unreachable.append(repo)
            continue
        h = sha256_of(data)
        status = "OK" if h == hub_hash else "DRIFT"
        print(f"  {repo:12s} {h}  ({len(data)} bytes)  [{status}]")
        if h != hub_hash:
            mismatches.append(repo)

    print()
    if unreachable:
        print(f"⚠ 접근 실패(레포 이름 오류 가능성, 검사 제외됨): {', '.join(unreachable)}")

    if mismatches:
        print(f"❌ 드리프트 발견: {', '.join(mismatches)}")
        print("   허브 gopang-wallet.js가 변경됐다면, 위 저장소들에도 반영해야 합니다.")
        return 1

    print("✅ 모든 위성 저장소가 허브와 동일합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
