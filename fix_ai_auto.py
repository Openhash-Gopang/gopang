path = r'C:\Users\주피터\Downloads\gopang_v2\index.html'
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# sendMessage() 안에서 AI 비활성 시 안내 메시지 → AI 자동 활성화로 변경
old = "  if (aiActive) await callAI(text,capturedFile);\n  else appendBubble('ai','🔵 AI 버튼을 눌러 AI 비서를 활성화하세요.');"

new = (
    "  // AI 비활성 상태에서 메시지 입력 시 자동 활성화\n"
    "  if (!aiActive) activateAI(true);\n"
    "  await callAI(text, capturedFile);"
)

if old in content:
    content = content.replace(old, new)
    print('OK: AI 자동 활성화 수정')
else:
    # 패턴 검색
    idx = content.find("AI 버튼을 눌러 AI 비서를 활성화하세요")
    if idx != -1:
        start = content.rfind('\n  if (aiActive)', 0, idx)
        end   = content.find('\n', idx) + 1
        old2  = content[start:end]
        print(f'대체 패턴 찾음: {repr(old2)}')
        content = content.replace(old2,
            "\n  if (!aiActive) activateAI(true);\n  await callAI(text, capturedFile);\n"
        )
        print('OK: AI 자동 활성화 수정 (대체)')
    else:
        print('FAIL: 패턴 없음')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print('저장 완료')
