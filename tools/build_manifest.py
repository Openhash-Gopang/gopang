#!/usr/bin/env python3
"""
tools/build_manifest.py
-----------------------
prompts/ 디렉터리를 스캔해 prompts/sp-catalog.json 을 자동 생성한다.
CI(GitHub Actions)가 push 마다 실행 — 개발자는 SP 파일만 추가하면 된다.

■ manifest 키 규칙
  · "AGENT-COMMON"          → prompts/AGENT-COMMON_*.txt 중 최신
  · "SP-00-ROUTER"          → prompts/SP-00-ROUTER-v*.txt 중 최신
  · "profile-assistant"     → prompts/profile-assistant/profile-assistant-v*.txt 중 최신
                               (2026-07-08: personal-assistant에서 개명·분리 — 프로필
                               작성 기능만 다루는 SP. 구 폴더 prompts/personal-assistant/
                               는 더 이상 스캔하지 않음 — 죽은 폴더로 남음, 수동 정리 대상)
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
OUT     = PROMPTS / 'sp-catalog.json'

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

# 2-c) UNIVERSAL-INTEGRITY — prompts/UNIVERSAL-INTEGRITY_vX_Y.md
#      2026-07-09 신설: expert-registry.js가 하드코딩된 URL로 이 파일을
#      직접 fetch()하던 것을 manifest 체계로 통합(SP_lawyer가 v3.2에
#      몇 주간 고정돼 있던 것과 동일한 종류의 staleness 위험 방지).
universal_integrity_files = [
    f.name for f in PROMPTS.iterdir()
    if re.match(r'^UNIVERSAL-INTEGRITY_v', f.name) and f.name.endswith('.md')
]
if universal_integrity_files:
    manifest['UNIVERSAL-INTEGRITY'] = best(universal_integrity_files)

# 2-d) SP_{slug} 계열(.md) — EXPERT 페르소나(SP_lawyer 등) + 공통 가드레일
#      (SP_common_guardrails·SP_common_medical_safety) — prompts/SP_{slug}_v{ver}.md
#      2026-07-09 신설: expert-registry.js/expert-session.js가 이 파일들을
#      전부 하드코딩 경로로 직접 fetch()하고 있어, 새 버전을 만들어도 이
#      경로를 안 고치면 조용히 구버전을 계속 쓰는 문제가 실제로 있었다
#      (SP_lawyer v3.2 고정 사례로 발견). 아래 4)의 "SP-NN_slug"(하이픈+숫자,
#      .txt) 계열과는 별개 명명 규칙(SP_slug, 밑줄, .md)이라 정규식을
#      공유하지 않는다 — slug 자체에 밑줄이 들어갈 수 있어(예:
#      SP_common_guardrails) 비탐욕(non-greedy) 매칭으로 마지막
#      "_v숫자[_숫자...]" 조각만 버전으로 떼어낸다.
sp_underscore_groups: dict[str, list[str]] = defaultdict(list)
for f in PROMPTS.iterdir():
    name = f.name
    if not name.endswith('.md') or 'LATEST' in name:
        continue
    m = re.match(r'^(SP_.+?)_v[\d_]+\.md$', name)
    if m:
        sp_underscore_groups[m.group(1)].append(name)

for key in sorted(sp_underscore_groups):
    manifest[key] = best(sp_underscore_groups[key])

# 3) profile-assistant — prompts/profile-assistant/profile-assistant-vX.Y.txt
#    (2026-07-08: personal-assistant → profile-assistant 개명·분리)
pa_dir = PROMPTS / 'profile-assistant'
if pa_dir.is_dir():
    pa_files = [
        f.name for f in pa_dir.iterdir()
        if re.match(r'^profile-assistant-v', f.name) and f.name.endswith('.txt')
    ]
    if pa_files:
        # 값은 하위 디렉터리 포함 경로로 저장
        manifest['profile-assistant'] = 'profile-assistant/' + best(pa_files)

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
