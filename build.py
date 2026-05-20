#!/usr/bin/env python3
"""
Gopang v2 Build Script
Injects K-Law prompt via JSON tag (JS-parser-safe)
Usage: python build.py
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).parent

def read(path, label):
    p = ROOT / path
    if not p.exists():
        print(f"ERROR - Not found: {p}")
        sys.exit(1)
    text = p.read_text(encoding='utf-8')
    print(f"OK  {label}: {len(text):,} chars")
    return text

klaw   = read('klaw/prompts/system_prompt.txt', 'K-Law prompt (EN)')
tmpl   = read('src/index_template.html',        'HTML template')

ver_m   = re.search(r'v(\d+\.\d+)', klaw)
version = ver_m.group(0) if ver_m else 'v15.1'
print(f"OK  K-Law version: {version}")

# JSON 직렬화 → JS 파서 완전 우회
payload = json.dumps({"klaw": klaw}, ensure_ascii=False)

out = tmpl.replace('{{KLAW_JSON}}', payload)
out = out.replace('{{VERSION}}',    version)

for m in ['{{KLAW_JSON}}', '{{VERSION}}']:
    if m in out:
        print(f"ERROR - Replace failed: {m}")
        sys.exit(1)

out_path = ROOT / 'index.html'
out_path.write_text(out, encoding='utf-8')
print(f"\nOK  Build complete → index.html ({len(out):,} chars)")
print(f"    K-Law {version} embedded via JSON tag")
