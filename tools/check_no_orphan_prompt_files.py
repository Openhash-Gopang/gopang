#!/usr/bin/env python3
"""
tools/check_no_orphan_prompt_files.py
----------------------------------------
prompts/ 루트에 sp-catalog.json 어디서도 참조하지 않는 "구버전 사본"이
남아있지 않은지 검사한다.

배경: 이 세션에서만 SP_lawyer_v4_2, SP_common_guardrails_v3_10/v3_11,
UNIVERSAL-common_v1_0~v1_6 등 9개의 고아 파일을 발견해 archive/로
옮겼다 — 새 버전을 만들 때 git mv 대신 새 파일만 만들고 옛 파일을 안
지우는 실수가 반복된 패턴이다. 정답 파일이 어느 것인지 헷갈릴 여지를
남기고(사람이 실수로 옛 버전을 열어 편집할 위험), 저장소 크기만 늘린다.

판정 기준: prompts/ 바로 아래(하위 디렉토리 제외 — Jejudo/ 등은 별도
체계)의 .md/.txt 파일 중, 파일명이 sp-catalog.json의 값과 정확히
일치하지 않는 것은 orphan 후보로 본다. 카탈로그 대상이 원래 아닌 문서
(감사 보고서, 아키텍처 설명 문서 등)는 ALLOWLIST_PREFIXES로 제외한다.

사용법: python3 tools/check_no_orphan_prompt_files.py
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
PROMPTS = ROOT / 'prompts'

# 카탈로그 대상이 아닌 걸 파일명 접두어로 미리 아는 문서들 — SP 본문이
# 아니라 설계도·감사록·저자 가이드 등. 새 카테고리가 생기면 여기 추가한다.
ALLOWLIST_PREFIXES = (
    'SP-ARCHITECTURE-MAP', 'SP-AUTHOR', 'SP-CATALOG_v1_0', 'EXPERT-INDEX',
    'AC-EVOLUTION', 'GOV-TIER-IO-SCHEMA', 'GOV_TASK', 'PDV-TRANSFER-PROTOCOL',
    # 2026-07-20 전수조사로 추가 — 정부기관 SP 저자용 템플릿/설계도 계열
    # (AGENCY-AC-COMMON 등)은 sp-catalog.json이 관리하는 "런타임 로딩
    # 대상"이 아니라 별도 저작 파이프라인 문서라 원래부터 카탈로그
    # 등록 대상이 아니다. 단일 문서(K-Case 등)도 마찬가지.
    'AGENCY-AC-COMMON', 'AC-AUTHOR', 'AGENCY-COMMON-TEMPLATE',
    'DEPRECATED_', 'GLOBAL-LOCAL-COMPLIANCE', 'ROUTER-PRIORITY',
    'K-Case', 'jeju-gov-sp-hierarchy', 'README',
    'sp-catalog.json',
)


def main() -> int:
    catalog = json.loads((PROMPTS / 'sp-catalog.json').read_text(encoding='utf-8'))
    referenced = set(catalog.values())

    orphans = []
    for f in sorted(PROMPTS.iterdir()):
        if not f.is_file() or f.suffix not in ('.md', '.txt'):
            continue
        if f.name in referenced:
            continue
        if f.name.startswith(ALLOWLIST_PREFIXES):
            continue
        orphans.append(f.name)

    if orphans:
        print("✗ prompts/ 루트에 카탈로그가 참조하지 않는 고아 파일 발견:")
        for o in orphans:
            print("  -", o)
        print("  → 실제로 옛 버전이면 prompts/archive/로 git mv, 카탈로그 대상이")
        print("    아닌 문서면 이 스크립트의 ALLOWLIST_PREFIXES에 추가하세요.")
        return 1

    print(f"✓ 고아 파일 없음 (카탈로그 {len(referenced)}개 파일, 전부 정합)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
