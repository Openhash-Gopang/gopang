#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
tools/check_gwp_report_compliance.py
-------------------------------------
GWP_REGISTRY(gwp-registry.js)에 등록된, "새 탭으로 위임되는" 모든 서비스가
실제로 GWP_DONE 보고 경로를 갖고 있는지 원격(raw.githubusercontent.com)에서
검사한다.

이 검사가 잡아내려는 문제(2026-07-09 발견): K-서비스 15개 중 9개는 완전히
동일한 41줄 _reportSessionEnd() 함수를 각자 저장소에 복사해 갖고 있었고,
klaw/school/stock/gdc/security 5개와 jeju는 아예 없어서 AI 비서가 위임
결과를 전혀 모르는 상태로 방치돼 있었다 — 이 스크립트가 없으면 이런
누락은 누군가 우연히 코드를 열어보기 전까진 발견되지 않는다.

■ 등급
  COMPLIANT (공유모듈)  — gwp-report-client.js를 import — 목표 상태
  COMPLIANT (레거시)    — 자체 GWP_DONE 발신 코드 보유 — 동작은 하지만
                          단일 소스가 아니라서 회귀 위험 있음(경고만)
  NONCOMPLIANT          — GWP_DONE 발신 코드가 전혀 없음 — 실패

■ 종료 코드
  0: NONCOMPLIANT 없음 (COMPLIANT-레거시는 경고로만 취급, exit 0)
  1: 하나 이상 NONCOMPLIANT 발견
  2: 레지스트리 파싱 실패 등 스크립트 자체 오류
"""
import re
import sys
import urllib.request
import urllib.error

ORG = "Openhash-Gopang"
RAW_BASE = f"https://raw.githubusercontent.com/{ORG}"

# hondi.net 서브도메인 → GitHub 저장소명. gwp-registry.js의 url 필드에서
# 자동 추출하되, 저장소명이 서브도메인과 다른 경우만 예외 매핑한다.
REPO_OVERRIDES = {
    "market": "market",       # kbusiness도 market으로 매핑됨(대시보드 페이지)
}
# 이 스크립트의 검사 대상이 아닌 서비스(외부 도메인 등)
SKIP_IDS = {"fiil-kcleaner"}  # fiil.kr — Openhash-Gopang 조직 밖 별도 서비스

ENTRY_PATTERN = re.compile(
    r"id:\s*'([^']+)'.*?url:\s*'https://([a-z0-9-]+)\.hondi\.net/([a-zA-Z0-9_.-]+)'",
    re.S,
)


def fetch(url, timeout=10):
    req = urllib.request.Request(url, headers={"User-Agent": "gwp-compliance-check"})
    with urllib.request.urlopen(req, timeout=timeout) as res:
        return res.read().decode("utf-8", errors="replace")


def get_registry_entries():
    try:
        src = fetch(f"{RAW_BASE}/gopang/main/gwp-registry.js")
    except Exception as e:
        print(f"[ERROR] gwp-registry.js 원격 조회 실패: {e}")
        sys.exit(2)

    entries = []
    for m in ENTRY_PATTERN.finditer(src):
        svc_id, subdomain, page = m.groups()
        if svc_id in SKIP_IDS:
            continue
        repo = REPO_OVERRIDES.get(subdomain, subdomain)
        entries.append((svc_id, repo, page))
    return entries


def classify(html):
    if "gwp-report-client.js" in html and "reportGwpSessionEnd" in html:
        return "COMPLIANT_SHARED"
    if "type: 'GWP_DONE'" in html or 'type:"GWP_DONE"' in html or "'GWP_DONE'" in html and "postMessage" in html:
        return "COMPLIANT_LEGACY"
    return "NONCOMPLIANT"


def main():
    entries = get_registry_entries()
    if not entries:
        print("[ERROR] gwp-registry.js에서 서비스 항목을 하나도 파싱하지 못함 — 정규식 확인 필요")
        sys.exit(2)

    print(f"검사 대상: {len(entries)}개 서비스\n")

    results = {"COMPLIANT_SHARED": [], "COMPLIANT_LEGACY": [], "NONCOMPLIANT": [], "FETCH_ERROR": []}

    for svc_id, repo, page in entries:
        url = f"{RAW_BASE}/{repo}/main/{page}"
        try:
            html = fetch(url)
        except urllib.error.HTTPError as e:
            results["FETCH_ERROR"].append((svc_id, repo, f"HTTP {e.code}"))
            continue
        except Exception as e:
            results["FETCH_ERROR"].append((svc_id, repo, str(e)))
            continue

        grade = classify(html)
        results[grade].append((svc_id, repo))

    for svc_id, repo in results["COMPLIANT_SHARED"]:
        print(f"  ✅ {svc_id:14s} ({repo}) — 공유모듈 사용")
    for svc_id, repo in results["COMPLIANT_LEGACY"]:
        print(f"  🟡 {svc_id:14s} ({repo}) — 자체 복사본으로 동작은 함(공유모듈 마이그레이션 권장)")
    for svc_id, repo in results["NONCOMPLIANT"]:
        print(f"  ❌ {svc_id:14s} ({repo}) — GWP_DONE 보고 없음, AI 비서가 결과를 못 받음")
    for svc_id, repo, err in results["FETCH_ERROR"]:
        print(f"  ⚠️  {svc_id:14s} ({repo}) — 조회 실패({err}), 판정 불가")

    n_fail = len(results["NONCOMPLIANT"])
    n_warn = len(results["COMPLIANT_LEGACY"])
    print(f"\n결과: 공유모듈 {len(results['COMPLIANT_SHARED'])} / "
          f"레거시통과 {n_warn} / 미준수 {n_fail} / 조회실패 {len(results['FETCH_ERROR'])}")

    if n_fail:
        print(f"\n실패 — {n_fail}개 서비스가 GWP_DONE 보고를 구현하지 않음.")
        sys.exit(1)
    print("\n미준수 서비스 없음 (레거시 복사본은 경고로만 취급).")
    sys.exit(0)


if __name__ == "__main__":
    main()
