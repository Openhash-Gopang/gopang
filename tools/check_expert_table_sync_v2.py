#!/usr/bin/env python3
"""
tools/check_expert_table_sync_v2.py
-------------------------------------
check_expert_table_sync.py(v1)의 개선판(2026-07-29). v1은 AGENT-COMMON
§9의 "personaId는 반드시..." 도입부 문구와 "id | 이름 | 분야" 표 구조를
정규식으로 정확히 파싱했는데, AGENT-COMMON이 폐기되고 AC-PRO-CORE로
리라이트되면서(1) sp-catalog.json에서 AGENT-COMMON 키 자체가 사라졌고
(2) 남아 있었더라도 도입부 문구·표 경계 마커(★)가 리라이트 과정에서
전부 바뀌어 어차피 다시 깨졌을 것이다(check_service_table_sync.py가
겪은 것과 같은 종류의 취약점 — 표 구조 파싱은 문서가 리라이트될 때마다
깨진다).

그래서 check_service_table_sync_v2.py와 동일한 설계를 그대로 적용한다:
표 안에 있는지가 아니라 "personaId 문자열이 파일 전체 어디든(표든, 예외
설명이든) 최소 1회 등장하는가"만 확인한다 — 표 형식이 다시 바뀌어도
깨지지 않는다. registry_files_exist()(파일 존재 확인)는 표 파싱과
무관하므로 v1 그대로 유지한다.

사용법: python3 tools/check_expert_table_sync_v2.py
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent


def registry_ids() -> set[str]:
    text = (ROOT / 'src' / 'gopang' / 'ai' / 'expert-registry.js').read_text(encoding='utf-8')
    ids = re.findall(
        r"^\s*(?:'([\w-]+)'|([\w-]+)):\s*\{\s*\n(?:\s*//[^\n]*\n)*\s*label:",
        text, re.M
    )
    return {a or b for a, b in ids}


def registry_files_exist() -> list[str]:
    """각 엔트리의 file 경로가 실제로 존재하는지도 함께 확인 — v1과 동일."""
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


def ac_pro_core_text() -> str:
    manifest = json.loads((ROOT / 'prompts' / 'sp-catalog.json').read_text(encoding='utf-8'))
    fname = manifest.get('AC-PRO-CORE')
    if not fname:
        print("✗ sp-catalog.json에 AC-PRO-CORE 키가 없음")
        sys.exit(1)
    return (ROOT / 'prompts' / fname).read_text(encoding='utf-8')


def main() -> int:
    registry = registry_ids()
    text = ac_pro_core_text()
    missing_files = registry_files_exist()

    ok = True
    missing_from_text = sorted(
        pid for pid in registry if not re.search(re.escape(pid), text, re.IGNORECASE)
    )

    if missing_from_text:
        ok = False
        print("✗ expert-registry.js엔 있는데 AC-PRO-CORE 어디에도 등장하지 않는 페르소나:")
        for i in missing_from_text:
            print("  -", i)
        print("  → 이 페르소나들은 AI가 존재 자체를 모르므로 [EXPERT: id]로 라우팅될 수 없다.")

    if missing_files:
        ok = False
        print("✗ expert-registry.js 엔트리의 file 경로가 실제로 존재하지 않음:")
        for i in missing_files:
            print("  -", i)

    if ok:
        print(f"✓ EXPERT 동기화 확인 ({len(registry)}개 전부 AC-PRO-CORE 어딘가에 등장함)")

    return 0 if ok else 1


if __name__ == '__main__':
    sys.exit(main())
