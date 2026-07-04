#!/usr/bin/env python3
"""
tools/check_stale_refs.py
--------------------------
worker.js·expert-registry.js·expert-session.js·gwp-registry.js(및 필요시
추가 파일)가 참조하는 prompts/ 파일 경로가 (1) 실제로 존재하는지,
(2) 존재한다면 그게 진짜 최신 버전인지 검사한다.

이 스크립트가 잡아내려는 정확한 사고 패턴(2026-07-04 세션에서 3회 반복
발견됨):
  - jeju-router.js가 존재하지 않는 SP-EXP-EMERGENCY_v1.1.md를 참조(404)
  - worker.js의 K_PUBLIC_COMMON_URL이 v1.0을 가리키는 동안 v1.1이 이미
    존재(staleness — 새 내용이 반영 안 됨)
  - expert-registry.js 27개 페르소나 중 16개가 v2.2를 참조하는 동안
    v2.3이 이미 존재(staleness)

■ 종료 코드
  0: 문제 없음
  1: 하나 이상의 MISSING(존재하지 않는 파일 참조, 404 위험) 또는
     STALE(최신 버전이 아닌 참조) 발견

■ 범위
  gopang 저장소 내부 .js 파일이 gopang 저장소 내부 prompts/ 파일을
  참조하는 경우만 검사한다. jeju-router.js(별도 jeju 저장소)는 공개
  GitHub raw 엔드포인트이므로 네트워크가 있으면 추가로 원격 fetch해
  검사한다(네트워크 실패 시 건너뛰고 경고만 출력, CI 자체를 막지 않음).
  school/market/stock/gdc 저장소는 자기 자신의 SP 파일만 참조하므로
  이 스크립트의 검사 대상이 아니다(별도 저장소별 점검 필요).
"""
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).parent.parent
PROMPTS = ROOT / 'prompts'

JS_FILES_TO_SCAN = [
    ROOT / 'worker.js',
    ROOT / 'gwp-registry.js',
    ROOT / 'src' / 'gopang' / 'ai' / 'expert-registry.js',
    ROOT / 'src' / 'gopang' / 'ai' / 'expert-session.js',
]

# jeju-router.js는 별도 저장소 — 공개 raw 엔드포인트에서 fetch해 함께 검사.
# 실패해도(네트워크 등) CI를 막지 않고 경고만 남긴다.
REMOTE_JS = [
    ('jeju-router.js (jeju 저장소)',
     'https://raw.githubusercontent.com/Openhash-Gopang/jeju/main/jeju-router.js'),
]

FILE_REF_RE = re.compile(
    r"""['"]                                # 여는 따옴표
    (?:/prompts/|prompts/|Jejudo/)          # 상대경로 또는 raw URL의 prompts/ 이하
    ([\w./-]+\.(?:md|txt|json))             # 실제 파일 경로(하위 폴더 포함)
    ['"]""",
    re.VERBOSE,
)
# raw.githubusercontent.com 형태의 절대 URL도 함께 매칭
RAW_URL_RE = re.compile(
    r"https://raw\.githubusercontent\.com/Openhash-Gopang/gopang/main/prompts/([\w./-]+\.(?:md|txt|json))"
)
# jeju-router.js 전용: _fetchText('00-common/JEJU-GOV-COMMON_v1_5.md')처럼
# 접두사 없는 상대경로(_RAW가 이미 prompts/Jejudo/를 포함하므로 문자열
# 자체엔 없다) — 매칭되면 'Jejudo/' 접두사를 붙여 로컬 인덱스 키와 맞춘다.
JEJU_RELATIVE_RE = re.compile(
    r"""_fetchText\(\s*['"]([\w./-]+\.(?:md|txt|json))['"]"""
)


def parse_version(fname: str) -> tuple:
    m = re.search(r'_v(\d+)[._](\d+)(?:[._](\d+))?', fname)
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def base_key(path: str) -> str:
    """디렉터리 + 버전 제거한 파일명 기준 키. 'Jejudo/00-common/JEJU-GOV-COMMON_v1_5.md'
    -> 'Jejudo/00-common/JEJU-GOV-COMMON'"""
    d = str(Path(path).parent)
    name = Path(path).name
    name = re.sub(r'_v\d+[._]\d+(?:[._]\d+)?\.(md|txt|json)$', '', name)
    return f"{d}/{name}" if d != '.' else name


def index_prompts_dir() -> dict:
    """base_key -> 실제 최신 파일 상대경로(prompts/ 기준)"""
    idx: dict[str, list[str]] = {}
    for p in PROMPTS.rglob('*'):
        if not p.is_file():
            continue
        if 'archive' in p.parts:
            continue  # 아카이브는 의도적 구버전 — 검사 제외
        rel = str(p.relative_to(PROMPTS))
        idx.setdefault(base_key(rel), []).append(rel)
    latest = {k: max(v, key=lambda f: (parse_version(Path(f).name), len(f))) for k, v in idx.items()}
    return latest


def check_refs(label: str, text: str, latest_map: dict, results: list, jeju_relative: bool = False):
    refs = set(m.group(1) for m in FILE_REF_RE.finditer(text)) | \
           set(m.group(1) for m in RAW_URL_RE.finditer(text))
    if jeju_relative:
        refs |= set(f"Jejudo/{m.group(1)}" for m in JEJU_RELATIVE_RE.finditer(text))
    for ref in refs:
        key = base_key(ref)
        if key not in latest_map:
            continue  # 이 스크립트가 다루는 SP류 파일이 아님(예: emd-master-data.json 등 데이터 파일) — 스킵
        latest_file = latest_map[key]
        if latest_file == ref:
            results.append(('OK', label, ref, latest_file))
        else:
            # ref 자체가 디스크에 있는지에 따라 MISSING/STALE 구분
            exists = (PROMPTS / ref).exists()
            status = 'STALE' if exists else 'MISSING'
            results.append((status, label, ref, latest_file))


def main():
    latest_map = index_prompts_dir()
    results = []

    for path in JS_FILES_TO_SCAN:
        if not path.exists():
            continue
        check_refs(str(path.relative_to(ROOT)), path.read_text(encoding='utf-8', errors='ignore'), latest_map, results)

    for label, url in REMOTE_JS:
        try:
            with urllib.request.urlopen(url, timeout=10) as r:
                text = r.read().decode('utf-8', errors='ignore')
            check_refs(label, text, latest_map, results, jeju_relative=True)
        except Exception as e:
            print(f"[경고] {label} 원격 fetch 실패, 건너뜀: {e}", file=sys.stderr)

    problems = [r for r in results if r[0] != 'OK']
    ok_count = len(results) - len(problems)

    print(f"검사한 참조: {len(results)}건 (정상 {ok_count}건, 문제 {len(problems)}건)\n")
    for status, label, ref, latest_file in problems:
        icon = '🔴' if status == 'MISSING' else '🟡'
        print(f"{icon} [{status}] {label}")
        print(f"    참조: {ref}")
        print(f"    실제 최신: {latest_file}\n")

    if problems:
        print(f"실패 — {len(problems)}건의 참조 불일치 발견.", file=sys.stderr)
        sys.exit(1)

    print("모든 참조가 최신 파일과 일치합니다.")
    sys.exit(0)


if __name__ == '__main__':
    main()
