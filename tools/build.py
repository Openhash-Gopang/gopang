#!/usr/bin/env python3
"""
Gopang Build Script v2
방식: JSON script 태그 제거 → JS template literal 직접 삽입
효과: JSON.parse 호출 없음 → JSON parse 오류 원천 차단
      BOM/CRLF 영향 없음
"""
import re, sys
from pathlib import Path

ROOT = Path(__file__).parent

def read(path, label):
    p = ROOT / path
    if not p.exists():
        print(f"ERROR: Not found: {p}"); sys.exit(1)
    text = p.read_text(encoding='utf-8-sig').lstrip('\ufeff')
    print(f"OK  {label}: {len(text):,} chars")
    return text

klaw = read('klaw/prompts/system_prompt.txt', 'K-Law prompt')
tmpl = read('src/index_template.html',        'HTML template')

ver_m   = re.search(r'v(\d+\.\d+)', klaw)
version = ver_m.group(0) if ver_m else 'v15.1'
print(f"OK  version: {version}")

# template literal 이스케이프 (순서 중요)
def esc_tl(s):
    s = s.replace('\\', '\\\\')  # \ → \\
    s = s.replace('`',  '\\`')   # ` → \`
    s = s.replace('${', '\\${')  # ${ → \${
    return s

escaped = esc_tl(klaw)
klaw_script = '<script>window.__KLAW=`' + escaped + '`;</script>'

out = tmpl.replace('{{KLAW_SCRIPT}}', klaw_script)
out = out.replace('{{VERSION}}',      version)

for marker in ['{{KLAW_SCRIPT}}', '{{VERSION}}']:
    if marker in out:
        print(f"ERROR: Replace failed: {marker}"); sys.exit(1)

# LF 고정, BOM 없이 저장
out_path = ROOT / 'index.html'
out_path.write_text(out, encoding='utf-8', newline='\n')
size_kb = len(out.encode('utf-8')) / 1024
print(f"\nOK  Build complete: index.html ({size_kb:.0f} KB)")
print(f"    K-Law {version} — template literal (JSON-free)")
