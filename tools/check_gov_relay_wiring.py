#!/usr/bin/env python3
"""
tools/check_gov_relay_wiring.py
--------------------------------
Openhash-Gopang 조직의 K서비스 프론트엔드 저장소들이 tax/health/public/jeju
4개 저장소에서 확인된 "표준 배선 패턴"(서버 강제 상속 릴레이 /gov/relay +
BYOK 폴백, 레거시 /ai/chat 직접호출 잔존 없음)을 따르는지 일괄 점검한다.

■ 배경 (2026-07-11)
지난 세션이 gopang 모노레포 안의 파일만 grep해서 "jeju-router.js가 아직
/ai/chat을 직접 호출한다"고 오진했었다 — 실제로는 별도 jeju 저장소가
2026-07-05에 이미 /gov/relay로 마이그레이션 완료된 상태였다. 이 스크립트는
같은 실수(모노레포 범위로만 판단)를 막기 위해, 각 K서비스 저장소를 실제로
얕은 클론해 그 저장소 자신의 코드를 검사한다 — 모노레포 안의 문서나
주석은 참고하지 않는다.

■ 판정 기준 (파일: webapp.html 우선, 없으면 루트의 *.html 전부 스캔)
  - OK        : '/gov/relay' 문자열이 있고, 레거시 '/ai/chat' 직접 fetch가 없음
                (BYOK 관련 UI id 문자열의 오탐을 피하기 위해 fetch(...'/ai/chat'
                패턴만 인정 — 단순 부분일치 아님)
  - LEGACY    : '/ai/chat'로 직접 fetch하는 코드가 남아 있음(마이그레이션 누락 후보)
  - NO_RELAY  : '/gov/relay'도 '/ai/chat'도 안 보임(프론트엔드 구조가 다르거나
                점검 대상이 아닐 수 있음 — 수동 확인 필요)
  - EMPTY     : 저장소에 webapp.html/기타 html이 아예 없음(예: LICENSE만 있는
                빈 저장소)
  - CLONE_FAIL: 네트워크 문제 등으로 클론 자체가 실패

■ 종료 코드
  0: 전부 OK 또는 EMPTY(빈 저장소는 결함이 아니라 별도 확인 대상)
  1: 하나 이상 LEGACY 또는 NO_RELAY 발견 — 수동 확인 필요
"""
import subprocess
import tempfile
import pathlib
import re
import sys
import shutil

ORG = "Openhash-Gopang"

# gopang 모노레포·인프라성 저장소(openhash-L*, .github, gopang, gopang-test,
# users, qna는 프론트엔드 웹앱 구조가 아니거나 이번 점검 범위 밖)는 제외.
REPOS = [
    "market", "tax", "gdc", "health", "security", "insurance", "school",
    "traffic", "logistics", "stock", "public", "democracy", "police",
    "911", "jeju", "jejudo", "klaw",
]

GOV_RELAY_RE = re.compile(r"""fetch\(\s*[`'"][^`'"]*['"`]?\s*\+?\s*['"`]?/gov/relay|['"`]/gov/relay['"`]""")
AI_CHAT_FETCH_RE = re.compile(r"""fetch\([^)]*['"`][^'"`]*\bai/chat\b""")


def run(cmd, cwd=None):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=60)


def check_repo(name, workdir):
    dest = workdir / name
    r = run(["git", "clone", "--depth", "1",
             f"https://github.com/{ORG}/{name}.git", str(dest)])
    if r.returncode != 0:
        return "CLONE_FAIL", r.stderr.strip().splitlines()[-1:] or [""]

    html_files = list(dest.glob("*.html")) + list(dest.glob("**/webapp.html"))
    html_files = list(dict.fromkeys(html_files))  # dedupe
    if not html_files:
        return "EMPTY", []

    has_relay = False
    legacy_hits = []
    for f in html_files:
        try:
            text = f.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        if GOV_RELAY_RE.search(text):
            has_relay = True
        m = AI_CHAT_FETCH_RE.search(text)
        if m:
            legacy_hits.append(f"{f.relative_to(dest)}: {m.group(0)[:60]}")

    if legacy_hits:
        return "LEGACY", legacy_hits
    if has_relay:
        return "OK", []
    return "NO_RELAY", [f.name for f in html_files]


def main():
    workdir = pathlib.Path(tempfile.mkdtemp(prefix="gov_relay_check_"))
    results = {}
    try:
        for name in REPOS:
            status, detail = check_repo(name, workdir)
            results[name] = (status, detail)
            print(f"[{status:10s}] {name}" + (f"  — {detail[0]}" if detail else ""))
    finally:
        shutil.rmtree(workdir, ignore_errors=True)

    bad = [n for n, (s, _) in results.items() if s in ("LEGACY", "NO_RELAY")]
    print()
    print(f"총 {len(REPOS)}개 저장소 점검. 문제 후보: {len(bad)}개 — {bad}")
    sys.exit(1 if bad else 0)


if __name__ == "__main__":
    main()
