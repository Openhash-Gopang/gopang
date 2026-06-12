with open('gopang-app.js', encoding='utf-8') as f:
    lines = f.readlines()

# 3624~3629행 (0-indexed: 3623~3628) 올바르게 교체
print('현재 3624~3630행:')
for i in range(3623, 3630):
    print(f'{i+1}: {repr(lines[i])}')

new_block = [
    "        }).then(({ fs, applied }) => {\n",
    "          console.info('[GWP_DONE] redeemClaim 완료 — block_hash:',\n",
    "            msg.block_hash.slice(0, 8), '| applied:', applied, '| bs-cash:', fs['bs-cash']);\n",
    "          appendBubble('ai', `거래 완료. 잔액 ₩${fs['bs-cash']?.toLocaleString()}`, false);\n",
    "        }).catch(err => console.warn('[GWP_DONE] redeemClaim 실패:', err.message));\n",
    "      }\n",
]

lines = lines[:3623] + new_block + lines[3630:]

print('\n교체 후 3624~3630행:')
for i in range(3623, 3630):
    print(f'{i+1}: {repr(lines[i])}')

with open('gopang-app.js', 'w', encoding='utf-8') as f:
    f.writelines(lines)

print('\n완료')