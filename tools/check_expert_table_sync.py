#!/usr/bin/env python3
"""
tools/check_expert_table_sync.py
-----------------------------------
expert-registry.js(실제 라우팅 대상 — "무엇이 존재하는가")와 AGENT-COMMON
§9의 [EXPERT: personaId] 표(AI비서가 "무엇이 존재한다고 배우는가")가
어긋나지 않는지 검증한다. check_service_table_sync.py(GWP 기관 서비스용)와
같은 원리 — 2026-07-05~06에 GWP 쪽에서 kbusiness 누락이 실제로 발견됐던
것과 같은 종류의 드리프트가 EXPERT 쪽에도 생기지 않도록 미리 막는다.

사용법: python3 tools/check_expert_table_sync.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def registry_ids() -> set[str]:
    text = (ROOT / 'src' / 'gopang' / 'ai' / 'expert-registry.js').read_text(encoding='utf-8')
    # ★ 2026-07-20 수정 — 'lawyer' 등 key: { 뒤에 여러 줄 주석(버전 이력 설명)이
    # 오는 엔트리를 놓치던 버그 수정. 기존 \s*\n?\s*는 개행 1개만 허용해
    # 다줄 // 주석 블록을 만나면 매칭 실패 → registry에 있는데 없다고 오탐.
    ids = re.findall(
        r"^\s*(?:'([\w-]+)'|([\w-]+)):\s*\{\s*\n(?:\s*//[^\n]*\n)*\s*label:",
        text, re.M
    )
    return {a or b for a, b in ids}


def registry_files_exist() -> list[str]:
    """각 엔트리의 file 경로가 실제로 존재하는지도 함께 확인."""
    text = (ROOT / 'src' / 'gopang' / 'ai' / 'expert-registry.js').read_text(encoding='utf-8')
    entries = re.findall(
        r"^\s*(?:'([\w-]+)'|([\w-]+)):\s*\{[^}]*?file:\s*'([^']+)'",
        text, re.M | re.S
    )
    missing = []
    for a, b, file_path in entries:
        pid = a or b
        local = ROOT / file_path.lstrip('/')
        if not local.exists():
            missing.append(f"{pid} -> {file_path}")
    return missing


def agent_common_table_ids() -> set[str]:
    manifest = json.loads((ROOT / 'prompts' / 'sp-catalog.json').read_text(encoding='utf-8'))
    fname = manifest.get('AGENT-COMMON')
    if not fname:
        print("✗ sp-catalog.json에 AGENT-COMMON 키가 없음")
        sys.exit(1)
    text = (ROOT / 'prompts' / fname).read_text(encoding='utf-8')

    start = text.find('personaId는 반드시')
    if start == -1:
        print("✗ AGENT-COMMON에서 EXPERT 표 도입부를 찾지 못함(형식이 바뀌었을 수 있음)")
        sys.exit(1)
    # 표는 "id  | 이름 | 분야" 헤더로 시작해 다음 빈 줄+"★"까지
    table_start = text.find('id ', start)
    table_end = text.find('★', table_start)
    block = text[table_start:table_end]

    ids = set()
    for line in block.splitlines():
        line = line.strip()
        if not line or '|' not in line:
            continue
        first_col = line.split('|')[0].strip()
        if re.match(r'^[a-z][a-z0-9-]+$', first_col) and first_col != 'id':
            ids.add(first_col)
    return ids


def main() -> int:
    registry = registry_ids()
    table = agent_common_table_ids()
    missing_files = registry_files_exist()

    ok = True
    missing_from_table = sorted(registry - table)
    extra_in_table = sorted(table - registry)

    if missing_from_table:
        ok = False
        print("✗ expert-registry.js엔 있는데 AGENT-COMMON EXPERT 표엔 없는 페르소나:")
        for i in missing_from_table:
            print("  -", i)
        print("  → 이 페르소나들은 AI비서가 존재를 모르므로 [EXPERT: id] 라우팅될 수 없다.")

    if extra_in_table:
        print("⚠ AGENT-COMMON EXPERT 표엔 있는데 expert-registry.js엔 없는 항목(경고만):")
        for i in extra_in_table:
            print("  -", i)

    if missing_files:
        ok = False
        print("✗ expert-registry.js의 file 경로가 실제로 존재하지 않는 항목:")
        for m in missing_files:
            print("  -", m)

    if ok:
        print(f"✓ 전문가 페르소나 동기화 확인 (registry {len(registry)}개 = table {len(table & registry)}개 매칭, 파일 전체 존재)")
        return 0
    return 1


if __name__ == '__main__':
    sys.exit(main())
