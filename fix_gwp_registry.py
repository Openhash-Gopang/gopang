#!/usr/bin/env python3
# fix_gwp_registry.py
# 실행 위치: C:\Users\주피터\Downloads\gopang_v2\
# 실행 방법: python fix_gwp_registry.py

from pathlib import Path

p = Path(__file__).parent / 'gwp-registry.js'

if not p.exists():
    print('❌ gwp-registry.js 파일을 찾을 수 없습니다.')
    print('   이 스크립트를 gopang_v2 폴더에 놓고 실행하세요.')
    exit(1)

text = p.read_text(encoding='utf-8')

OLD = "id:          'ktax',"
NEW = "id:          'tax',"

if OLD not in text:
    print('⚠️  이미 패치됐거나 형식이 다릅니다.')
    # 실제 파일에서 ktax 관련 줄 출력
    for i, line in enumerate(text.splitlines(), 1):
        if 'ktax' in line or 'ktax' in line:
            print(f'   {i}줄: {line.strip()}')
else:
    text = text.replace(OLD, NEW)
    p.write_text(text, encoding='utf-8')
    print('✅ gwp-registry.js 패치 완료: ktax → tax')

print()
print('다음 명령어로 커밋하세요:')
print()
print('  git add gwp-registry.js')
print('  git commit -m "fix: svc id ktax -> tax"')
print('  git push origin main')
