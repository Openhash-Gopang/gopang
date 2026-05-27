import re

path = r'C:\Users\주피터\Downloads\gopang_v2\index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# 1. 환영 메시지 패턴 찾기
print('환영 메시지 패턴 검색...')
idx = content.find('안녕하세요! 저는 <b>고팡 AI 비서</b>입니다')
if idx == -1:
    print('FAIL: 환영 메시지 없음')
else:
    # appendBubble 호출 시작점 찾기 (앞으로 50자 이내)
    start = content.rfind('appendBubble', 0, idx)
    if start == -1:
        start = content.rfind('_wList', 0, idx)
    end = content.find(');', idx) + 2
    old_block = content[start:end]
    print(f'찾음: {repr(old_block[:80])}')

    new_block = (
        "const _wList = document.getElementById('message-list');\n"
        "  const _wRow  = document.createElement('div');\n"
        "  _wRow.className = 'msg-row ai';\n"
        "  _wRow.innerHTML = '<div class=\"bubble bubble-ai\">"
        "안녕하세요! 저는 <b>고팡 AI 비서</b>입니다. 🐚<br><br>"
        "📍 현재 위치: <span id=\"welcome-loc\">위치 확인 중…</span><br><br>"
        "법률·의료·환경신고·생활 전반을 지원합니다.</div>';\n"
        "  _wList.appendChild(_wRow);"
    )
    content = content[:start] + new_block + content[end:]
    print('OK: 환영 메시지 수정')

# 2. onLocationUpdate 콜백에 welcome-loc 갱신 추가
print('onLocationUpdate 패턴 검색...')
target = "if (CFG.system_base) CFG.system = CFG.system_base"
idx2 = content.find(target)
if idx2 == -1:
    print('FAIL: onLocationUpdate 패턴 없음')
else:
    line_end = content.find('\n', idx2)
    insert = "\n    const locEl = document.getElementById('welcome-loc');\n    if (locEl) locEl.textContent = buildLocNote();"
    # 이미 추가됐는지 확인
    if 'welcome-loc' not in content[idx2:idx2+200]:
        content = content[:line_end] + insert + content[line_end:]
        print('OK: onLocationUpdate 콜백 수정')
    else:
        print('이미 적용됨')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('저장 완료')
