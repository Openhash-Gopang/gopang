#!/usr/bin/env python3
"""
tools/check_service_table_sync_v2.py
-------------------------------------
기존 check_service_table_sync.py의 두 가지 실증된 버그를 수정한 개선판
(2026-07-14, 구조적 취약점 보완 #1 — "완전 자동생성" 대신 "안전한 검증"으로
축소 재설계됨. 근거: §9 표가 registry를 기계적으로 렌더링한 게 아니라
순서·문구·예외가 사람 손으로 재구성된 "큐레이션 뷰"라서, 완전 자동생성은
오히려 새 버그(순서 상실 등) 위험이 더 크다고 판단됨).

수정된 버그 2가지:
1. 기존 정규식 `id:\\s*'...'.*?url:\\s*(null|'...')`(re.S)은 type:'switch'
   엔트리(url 필드 자체가 없음, 예: kbank)를 만나면 non-greedy가 엔트리
   경계를 못 지키고 다음 엔트리의 url까지 건너뛰어 읽어버린다 — kbank가
   실제로는 §9 표에 있는데도(2383행) "누락"으로 오탐했다(실사로 확인).
   → 이 버전은 정규식 재파싱 대신 Node vm으로 파일을 실제 실행해 안전하게
     추출한다(tools/extract_gwp_registry.mjs 재사용).
2. 기존 `agent_common_table_ids()`는 "id | 서비스명" 헤더로 시작하는 첫
   번째 표 블록만 잡아서, profile-assistant(§0-E 특례 섹션)·ksearch(별도
   K-Search 섹션) 같은 "표 밖에서 정상적으로 라우팅되는" id를 전부
   "누락"으로 오탐했다(실사로 확인).
   → 이 버전은 "표 안"이 아니라 "파일 전체 텍스트 어디든 [GWP: id] 또는
     id 자체가 최소 1회 등장하는가"로 완화한다 — §9 표에 없어도 다른
     섹션에서 실제로 라우팅되면 통과시킨다. 대신 "표에도 없고 파일
     어디에도 안 나오는" 경우만 진짜 실패로 잡는다(훨씬 보수적이지만
     오탐이 없다).

사용법: python3 tools/check_service_table_sync_v2.py
"""
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def registry_entries() -> list[dict]:
    """vm 기반 안전 추출 — 정규식 재파싱을 하지 않는다."""
    result = subprocess.run(
        ['node', str(ROOT / 'tools' / 'extract_gwp_registry.mjs')],
        capture_output=True, text=True, cwd=ROOT,
    )
    if result.returncode != 0:
        print("✗ gwp-registry.js 추출 실패:", result.stderr)
        sys.exit(1)
    return json.loads(result.stdout)


def agent_common_text() -> str:
    manifest = json.loads((ROOT / 'prompts' / 'sp-catalog.json').read_text(encoding='utf-8'))
    fname = manifest.get('AGENT-COMMON')
    if not fname:
        print("✗ sp-catalog.json에 AGENT-COMMON 키가 없음")
        sys.exit(1)
    return (ROOT / 'prompts' / fname).read_text(encoding='utf-8')


def main() -> int:
    entries = registry_entries()
    # tool-* 프리픽스는 [GWP: id] 태그가 아니라 별도 함수 invoke 메커니즘
    # (image_reminder 등과 유사한 도구 호출)이라 이 태그 동기화 검사
    # 대상이 아니다 — 기존 스크립트와 동일한 제외 기준.
    routable = [e for e in entries if not e['id'].startswith('tool-')]
    text = agent_common_text()

    missing = []
    for e in routable:
        sid = e['id']
        # id 자체가 파일 어디든(표든, §0-E 같은 특례 섹션이든, CALL_ 형태든)
        # 최소 1회 등장하면 "AI가 존재를 안다"고 인정한다.
        if not re.search(re.escape(sid), text):
            missing.append(sid)

    if missing:
        print("✗ gwp-registry.js엔 있는데 AGENT-COMMON 어디에도 등장하지 않는 서비스:")
        for i in missing:
            print("  -", i)
        print("  → 이 서비스들은 AI비서가 존재 자체를 모르므로 라우팅될 수 없다.")
        return 1

    print(f"✓ 서비스 동기화 확인 ({len(routable)}개 전부 AGENT-COMMON 어딘가에 등장함, vm 기반 안전추출)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
