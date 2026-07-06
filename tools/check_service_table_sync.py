#!/usr/bin/env python3
"""
tools/check_service_table_sync.py
-----------------------------------
gwp-registry.js(실제 라우팅 대상 서비스 — "무엇이 존재하는가")와
AGENT-COMMON §9의 [GWP: id] 표(AI비서가 "무엇이 존재한다고 배우는가")는
서로 다른 파일에 손으로 따로 관리되어 왔다. 2026-07-05~06 사고실험에서
이 둘이 어긋나 kbusiness가 §9 표에서 통째로 빠져 있던 게 발견됐다 —
AGENT-COMMON은 "표 밖의 id는 존재하지 않는다"고 스스로 명시하므로,
표에서 빠진 서비스는 사용자가 아무리 명확하게 요청해도 라우팅될 수
없다(SVC_ID_ALIAS의 우연한 별칭 매칭에만 기댈 수 있을 뿐).

이 스크립트는 그 드리프트가 재발하면 CI에서 즉시 잡아낸다:
  1. gwp-registry.js에서 url이 있는(= 실제 탭을 여는) 모든 서비스 id를
     추출한다. url이 없는 항목(예: tool-web-search, tool-calculator)은
     [GWP: id] 태그가 아니라 함수 호출로 invoke되는 별도 메커니즘이므로
     비교 대상에서 제외한다.
  2. AGENT-COMMON(prompts/manifest.json이 가리키는 최신 파일)의 §9 표에서
     id 목록을 추출한다.
  3. (1)에는 있는데 (2)에는 없는 id가 하나라도 있으면 실패(exit 1) —
     "한 곳에서 빠짐없이 관리"를 코드로 강제한다.

역방향(§9에는 있는데 registry엔 없는 경우 — 서비스가 폐지됐는데 AI만
아직 그 존재를 아는 경우)도 함께 경고하되, 실패시키지는 않는다(당장
사용자에게 해가 되는 방향은 아니므로 — 존재하지 않는 곳으로 잘못
안내할 위험은 있지만, 이건 별도 이슈로 다룬다).

사용법: python3 tools/check_service_table_sync.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def registry_ids_with_url() -> set[str]:
    text = (ROOT / 'gwp-registry.js').read_text(encoding='utf-8')
    # 각 엔트리: id: '...' ... url: null 또는 url: '...'
    entries = re.findall(
        r"id:\s*'([a-z0-9-]+)'.*?url:\s*(null|'[^']*')", text, re.S
    )
    return {id_ for id_, url in entries if url != 'null'}


def agent_common_table_ids() -> set[str]:
    manifest = json.loads((ROOT / 'prompts' / 'manifest.json').read_text(encoding='utf-8'))
    fname = manifest.get('AGENT-COMMON')
    if not fname:
        print("✗ manifest.json에 AGENT-COMMON 키가 없음")
        sys.exit(1)
    text = (ROOT / 'prompts' / fname).read_text(encoding='utf-8')

    m = re.search(r'id\s+\|\s*서비스명.*?\n((?:.*\|.*\n)+)', text)
    if not m:
        print("✗ AGENT-COMMON에서 §9 라우팅 표를 찾지 못함(형식이 바뀌었을 수 있음)")
        sys.exit(1)

    ids = set()
    for line in m.group(1).splitlines():
        line = line.strip()
        if not line or '|' not in line:
            continue
        first_col = line.split('|')[0].strip()
        if re.match(r'^[a-z0-9-]+$', first_col):
            ids.add(first_col)
    return ids


def main() -> int:
    registry = registry_ids_with_url()
    table = agent_common_table_ids()

    missing_from_table = sorted(registry - table)
    extra_in_table = sorted(table - registry)

    ok = True
    if missing_from_table:
        ok = False
        print("✗ gwp-registry.js엔 있는데 AGENT-COMMON §9 표엔 없는 서비스:")
        for i in missing_from_table:
            print("  -", i)
        print("  → 이 서비스들은 AI비서가 존재를 모르므로 라우팅될 수 없다.")

    if extra_in_table:
        print("⚠ AGENT-COMMON §9 표엔 있는데 gwp-registry.js엔 없는(또는 url이 빠진) 항목(경고만, 실패 아님):")
        for i in extra_in_table:
            print("  -", i)

    if ok:
        print(f"✓ 서비스 목록 동기화 확인 (registry {len(registry)}개 = table {len(table & registry)}개 매칭)")
        return 0
    return 1


if __name__ == '__main__':
    sys.exit(main())
