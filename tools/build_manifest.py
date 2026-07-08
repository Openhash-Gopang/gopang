#!/usr/bin/env python3
"""
tools/build_manifest.py
-----------------------
prompts/ 디렉터리를 스캔해 prompts/manifest.json 을 자동 생성한다.
CI(GitHub Actions)가 push 마다 실행 — 개발자는 SP 파일만 추가하면 된다.

■ manifest 키 규칙
  · "AGENT-COMMON"          → prompts/AGENT-COMMON_*.txt 중 최신
  · "SP-00-ROUTER"          → prompts/SP-00-ROUTER-v*.txt 중 최신
  · "personal-assistant"    → prompts/personal-assistant/personal-assistant-v*.txt 중 최신
  · "SP-NN_slug"            → prompts/SP-NN_slug_v*.txt 중 최신
                               같은 번호라도 slug 가 다르면 독립 키 (SP-14 중복 대응)
  · "AGENT-SUPPLIER-NN"     → prompts/AGENT-SUPPLIER-NN_*.txt 중 최신
                               동점(동일 버전)이면 파일명이 긴 쪽 선택

■ 버전 비교
  파일명 안의 vMAJOR[._]MINOR[._]PATCH 를 파싱해 숫자 튜플로 비교.
  AGENT-COMMON 처럼 vX_Y 표기도 지원.
  버전 표기 없으면 (0,0,0).

■ *-LATEST.txt 포인터 파일
  스캔 대상에서 제외 (manifest 로 완전 대체).
  기존 파일은 삭제하지 않아도 무방하나 JS 에서는 참조하지 않는다.
"""
import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT    = Path(__file__).parent.parent   # 저장소 루트
PROMPTS = ROOT / 'prompts'
OUT     = PROMPTS / 'manifest.json'

# ── 버전 파싱 ──────────────────────────────────────────────────────────
def parse_version(fname: str) -> tuple:
    m = re.search(r'v(\d+)[._](\d+)(?:[._](\d+))?', fname)
    if not m:
        return (0, 0, 0)
    return (int(m.group(1)), int(m.group(2)), int(m.group(3) or 0))

def best(files: list[str]) -> str:
    """버전 내림차순, 동점이면 파일명 길이 내림차순으로 최신 선택."""
    return max(files, key=lambda f: (parse_version(f), len(f)))

# ── 파일 스캔 ──────────────────────────────────────────────────────────
manifest: dict[str, str] = {}

# 1) AGENT-COMMON — prompts/AGENT-COMMON_vX_Y.txt
agent_common_files = [
    f.name for f in PROMPTS.iterdir()
    if re.match(r'^AGENT-COMMON_v', f.name) and f.name.endswith('.txt')
]
if agent_common_files:
    manifest['AGENT-COMMON'] = best(agent_common_files)

# 1-b) AGENT-SUPPLIER-COMMON — prompts/AGENT-SUPPLIER-COMMON_vX.Y.txt
#      2026-06-30: 누락돼 있던 키. AGENT-SUPPLIER-NN 정규식은 '_' 뒤에
#      숫자가 와야 매칭되므로(AGENT-SUPPLIER-(\d+)_) "COMMON"은 거기서
#      잡히지 않는다 — 별도 스캔 필요.
agent_supplier_common_files = [
    f.name for f in PROMPTS.iterdir()
    if re.match(r'^AGENT-SUPPLIER-COMMON_v', f.name) and f.name.endswith('.txt')
]
if agent_supplier_common_files:
    manifest['AGENT-SUPPLIER-COMMON'] = best(agent_supplier_common_files)

# 2) SP-00-ROUTER — prompts/SP-00-ROUTER-vX_Y.txt
router_files = [
    f.name for f in PROMPTS.iterdir()
    if re.match(r'^SP-00-ROUTER-v', f.name) and f.name.endswith('.txt')
]
if router_files:
    manifest['SP-00-ROUTER'] = best(router_files)

# 2-b) HONDI_VISITOR_SP — prompts/hondi_visitor_sp_vX_Y.txt
#      2026-07-08 신설: 기존엔 이 SP가 manifest 체계 밖에 있어서 desktop.html
#      에 전문이 직접 박혀 있었다(check_no_embedded_sp.py 사각지대). 다른
#      SP들과 동일하게 manifest 기반 fetch로 전환하며 스캔 대상에 추가.
visitor_files = [
    f.name for f in PROMPTS.iterdir()
    if re.match(r'^hondi_visitor_sp_v', f.name) and f.name.endswith('.txt')
]
if visitor_files:
    manifest['HONDI_VISITOR_SP'] = best(visitor_files)

# 3) personal-assistant — prompts/personal-assistant/personal-assistant-vX.Y.txt
pa_dir = PROMPTS / 'personal-assistant'
if pa_dir.is_dir():
    pa_files = [
        f.name for f in pa_dir.iterdir()
        if re.match(r'^personal-assistant-v', f.name) and f.name.endswith('.txt')
    ]
    if pa_files:
        # 값은 하위 디렉터리 포함 경로로 저장
        manifest['personal-assistant'] = 'personal-assistant/' + best(pa_files)

# 4) SP-NN 계열 — prompts/SP-NN_slug_vX.Y.txt
sp_groups: dict[str, list[str]] = defaultdict(list)
for f in PROMPTS.iterdir():
    name = f.name
    if not name.endswith('.txt') or 'LATEST' in name:
        continue
    m = re.match(r'^(SP-[\d]+-?(?:IMG)?)_(.+?)(?:_v[\d.]+)?\.txt$', name)
    if m:
        key = f"{m.group(1)}_{m.group(2)}"
        sp_groups[key].append(name)

for key in sorted(sp_groups):
    manifest[key] = best(sp_groups[key])

# 5) AGENT-SUPPLIER-NN 계열
supplier_groups: dict[str, list[str]] = defaultdict(list)
for f in PROMPTS.iterdir():
    name = f.name
    if not name.endswith('.txt') or 'LATEST' in name:
        continue
    m = re.match(r'^(AGENT-SUPPLIER-(\d+))_', name)
    if m:
        supplier_groups[m.group(2)].append(name)

for code in sorted(supplier_groups):
    manifest[f'AGENT-SUPPLIER-{code}'] = best(supplier_groups[code])

# ── 출력 ──────────────────────────────────────────────────────────────
for key, fname in manifest.items():
    print(f'  {key}: {fname}')

OUT.write_text(
    json.dumps(manifest, ensure_ascii=False, indent=2) + '\n',
    encoding='utf-8'
)
print(f'\n✓  {OUT}  ({len(manifest)} 항목)')
