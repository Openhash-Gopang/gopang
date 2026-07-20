#!/usr/bin/env python3
"""
tools/check_no_mass_deletion.py
--------------------------------
push/PR로 들어온 diff에서 지정 파일(기본: worker.js)이 이전 버전 대비
비정상적으로 많은 줄이 삭제됐는지 검사한다.

2026-07-20에 반복 발견된 사고 패턴(같은 계정이 스테일 로컬 체크아웃에서
커밋 → worker.js가 통째로 오래된 버전으로 덮어써지면서 수백 줄이
삭제됨)을 사람이 매번 기억해서 막는 대신, 기계가 push 시점에 자동으로
잡아내기 위해 만들었다:
  - 436e508: worker.js 519줄 삭제(96줄만 추가) — 시군구 리졸버 유실
  - 890e434c: worker.js 457줄 삭제(17줄만 추가) — 시군구 리졸버 재유실
    + 다른 협업자의 고액거래 재인증 기능도 이번까지 3차례 유실

■ 판정 기준
  대상 파일에서 "삭제된 줄 수"가 DELETE_THRESHOLD(기본 150)를 넘으면
  실패. 순수 추가 커밋(리팩터링 없이 기능만 얹는 커밋)은 항상 통과한다 —
  이 프로젝트의 최근 관례("순수 추가만, 삭제 0줄")와 맞닿아 있다.

  진짜로 대규모 삭제가 필요한 정상적인 리팩터링(예: 죽은 코드 제거,
  구조 개편)도 있을 수 있다 — 그런 경우는 커밋 메시지에
  "[allow-mass-deletion]" 토큰을 넣으면 이 검사를 건너뛴다(의도적임을
  명시적으로 밝히는 관문 — 실수로는 절대 안 쓰게 되는 문구).

■ 종료 코드
  0: 문제 없음(삭제량이 임계값 이하, 또는 의도적 허용 태그 있음)
  1: 임계값을 넘는 삭제 발견 — 실수로 스테일 체크아웃을 푸시했을 가능성 높음
"""
import os
import subprocess
import sys

WATCHED_FILES = ['worker.js']
DELETE_THRESHOLD = 150
ALLOW_TOKEN = '[allow-mass-deletion]'


def sh(*args):
    return subprocess.run(args, capture_output=True, text=True, check=False)


def get_diff_range():
    """push 이벤트면 before..after, PR이면 base..head. 로컬/기타 상황이면
    HEAD~1..HEAD로 폴백."""
    before = os.environ.get('GITHUB_EVENT_BEFORE', '')
    after = os.environ.get('GITHUB_EVENT_AFTER', '')
    base_ref = os.environ.get('GITHUB_BASE_REF', '')

    zero_sha = '0' * 40
    if before and after and before != zero_sha:
        return before, after
    if base_ref:
        sh('git', 'fetch', 'origin', base_ref, '--depth=50')
        return f'origin/{base_ref}', 'HEAD'
    return 'HEAD~1', 'HEAD'


def get_commit_messages(rev_before, rev_after):
    r = sh('git', 'log', f'{rev_before}..{rev_after}', '--format=%B')
    return r.stdout


def main():
    rev_before, rev_after = get_diff_range()

    messages = get_commit_messages(rev_before, rev_after)
    if ALLOW_TOKEN in messages:
        print(f'[허용] 커밋 메시지에 {ALLOW_TOKEN} 토큰 발견 — 대량삭제 검사를 건너뜁니다.')
        return 0

    failed = False
    for path in WATCHED_FILES:
        r = sh('git', 'diff', '--numstat', rev_before, rev_after, '--', path)
        line = r.stdout.strip()
        if not line:
            print(f'[건너뜀] {path}: 변경 없음')
            continue
        parts = line.split('\t')
        if len(parts) < 2:
            continue
        added_str, deleted_str = parts[0], parts[1]
        if added_str == '-' or deleted_str == '-':
            print(f'[건너뜀] {path}: 바이너리 또는 측정 불가')
            continue
        added, deleted = int(added_str), int(deleted_str)
        print(f'[검사] {path}: +{added} / -{deleted} (기준: 삭제 {DELETE_THRESHOLD}줄 초과 시 실패)')
        if deleted > DELETE_THRESHOLD:
            print(f'  \u274c {path}에서 {deleted}줄 삭제 — 임계값({DELETE_THRESHOLD}줄) 초과.')
            print(f'     스테일 로컬 체크아웃에서 커밋했을 가능성이 높습니다.')
            print(f'     푸시 전에 반드시 `git pull origin main --rebase`로 최신 상태를 받았는지 확인하세요.')
            print(f'     의도적인 대규모 삭제(리팩터링 등)라면 커밋 메시지에 {ALLOW_TOKEN}를 포함해 다시 푸시하세요.')
            failed = True

    return 1 if failed else 0


if __name__ == '__main__':
    sys.exit(main())
