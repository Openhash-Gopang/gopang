#!/usr/bin/env python3
"""
tools/archive_old_prompts.py
-----------------------------
prompts/ 안에 같은 SP/문서 계열의 버전 파일이 너무 많이 쌓이는 걸 막는다.
각 계열(build_manifest.py와 동일한 그룹핑 규칙)마다 최신 KEEP_LATEST개만
prompts/에 남기고, 그보다 오래된 버전은 prompts/archive/로 옮긴다.

■ 왜 필요한가
  AGENT-COMMON만 해도 v2.3~v3.13까지 16개 버전이 한 번도 정리되지 않고
  prompts/ 최상위에 계속 쌓여왔다(2026-07-05 확인). "이미 push된 버전은
  직접 고치지 않고 새 파일로 분리한다"는 원칙 자체는 맞지만, 그 결과가
  무한정 쌓이기만 하면 사람도 다음 세션도 어느 게 실제로 살아있는
  최신본인지 훑어보기 버거워진다. manifest.json이 최신을 자동 선택해
  기능적으로는 문제없지만, 이건 사람이 디렉터리를 볼 때의 문제다.

■ 안전 원칙
  - manifest.json이 실제로 참조하는 "최신본"은 절대 옮기지 않는다
    (KEEP_LATEST가 1 미만으로 설정되는 실수를 해도 최신본은 항상 보존).
  - 지우지 않고 prompts/archive/로 이동만 한다 — git 이력도 그대로 남는다.
  - 이미 손으로 archive/에 넣어둔 파일(SP-00-ROUTER 등)은 건드리지 않는다
    (스캔 대상이 PROMPTS.iterdir()이므로 하위 폴더인 archive/는 애초에
    스캔되지 않음 — build_manifest.py와 동일).
  - personal-assistant/처럼 하위 폴더에 있는 계열도 동일하게 처리하되,
    이동 위치는 prompts/archive/ 하나로 통일한다(파일명 자체가
    "personal-assistant-vX.txt"라 최상위로 옮겨도 계열 구분에 문제 없음).

■ 실행 시점
  - .github/workflows/manifest.yml에서 build_manifest.py 실행 "전"에
    호출한다(push마다 — 즉시 정리).
  - .github/workflows/archive-prompts.yml에서 주기적(cron)으로도 별도
    호출한다 — push 트리거를 놓치는 경우에 대한 안전망.

■ 사용법
  python3 tools/archive_old_prompts.py           # 실제 이동 수행
  python3 tools/archive_old_prompts.py --dry-run # 무엇을 옮길지만 출력
"""
import re
import sys
import shutil
from collections import defaultdict
from pathlib import Path

ROOT     = Path(__file__).parent.parent
PROMPTS  = ROOT / 'prompts'
ARCHIVE  = PROMPTS / 'archive'

KEEP_LATEST = 5  # 계열당 prompts/ 최상위에 남길 최신 버전 개수


def parse_version(fname: str) -> tuple:
    m = re.search(r'v(\d+)[._](\d+)(?:[._](\d+))?', fname)
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))


def group_files() -> dict[str, list[Path]]:
    """build_manifest.py와 동일한 규칙으로 파일을 계열별로 묶는다."""
    groups: dict[str, list[Path]] = defaultdict(list)

    def add(key, path):
        groups[key].append(path)

    for f in PROMPTS.iterdir():
        if f.is_dir():
            continue
        name = f.name
        if 'LATEST' in name or name == 'manifest.json':
            continue

        if re.match(r'^AGENT-COMMON_v', name) and name.endswith('.txt'):
            add('AGENT-COMMON', f)
        elif re.match(r'^AGENT-SUPPLIER-COMMON_v', name) and name.endswith('.txt'):
            add('AGENT-SUPPLIER-COMMON', f)
        elif re.match(r'^SP-00-ROUTER-v', name) and name.endswith('.txt'):
            add('SP-00-ROUTER', f)
        elif name.endswith('.txt'):
            m = re.match(r'^(SP-[\d]+-?(?:IMG)?)_(.+?)(?:_v[\d.]+)?\.txt$', name)
            if m:
                add(f"{m.group(1)}_{m.group(2)}", f)
                continue
            m2 = re.match(r'^(AGENT-SUPPLIER-(\d+))_', name)
            if m2:
                add(f'AGENT-SUPPLIER-{m2.group(2)}', f)

    pa_dir = PROMPTS / 'personal-assistant'
    if pa_dir.is_dir():
        for f in pa_dir.iterdir():
            if re.match(r'^personal-assistant-v', f.name) and f.name.endswith('.txt'):
                add('personal-assistant', f)

    return groups


def plan_archive(groups: dict[str, list[Path]]) -> list[Path]:
    """계열마다 최신 KEEP_LATEST개를 제외한 나머지를 반환한다."""
    to_archive = []
    for key, files in groups.items():
        if len(files) <= KEEP_LATEST:
            continue
        ranked = sorted(files, key=lambda p: (parse_version(p.name), len(p.name)), reverse=True)
        old = ranked[KEEP_LATEST:]
        to_archive.extend(old)
    return to_archive


def main():
    dry_run = '--dry-run' in sys.argv
    groups = group_files()
    to_archive = plan_archive(groups)

    if not to_archive:
        print('정리할 파일 없음 — 모든 계열이 KEEP_LATEST(=%d) 이하.' % KEEP_LATEST)
        return

    ARCHIVE.mkdir(exist_ok=True)
    for f in to_archive:
        dest = ARCHIVE / f.name
        if dest.exists():
            print(f'  건너뜀(이미 archive에 동명 파일 존재): {f.name}')
            continue
        print(f'  {"[dry-run] " if dry_run else ""}{f.relative_to(ROOT)} → {dest.relative_to(ROOT)}')
        if not dry_run:
            shutil.move(str(f), str(dest))

    print(f'\n총 {len(to_archive)}개 {"이동 예정(dry-run)" if dry_run else "이동 완료"}.')


if __name__ == '__main__':
    main()
