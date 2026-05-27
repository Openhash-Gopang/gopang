path = r'C:\Users\주피터\Downloads\gopang_v2\js\services\gwp.js'
with open(path, 'r', encoding='utf-8') as f:
    c = f.read()

# 1. iframe top 높이 수정
c = c.replace(
    "'top:calc(44px + var(--safe-top, 0px))'",
    "'top:calc(48px + var(--safe-top, 0px))'"
)

# 2. _insertBackButton: top-bar에 absolute 삽입 대신 top-logo 안에 버튼 삽입
old = """function _insertBackButton() {
  if (document.getElementById('gwp-back-btn')) return;

  const btn = document.createElement('button');
  btn.id    = 'gwp-back-btn';
  btn.innerHTML = '&#8592; 고팡';
  btn.style.cssText = [
    'position:absolute',
    'top:0', 'left:0',
    'height:44px',
    'padding:0 14px',
    'background:none',
    'border:none',
    'color:var(--accent, #3ECF8E)',
    'font-size:15px',
    'font-weight:600',
    'cursor:pointer',
    'z-index:200',
    'display:flex',
    'align-items:center',
    'gap:4px',
  ].join(';');
  btn.onclick = () => gwpClose(true);

  const topBar = document.querySelector('.top-bar') || document.getElementById('top-bar');
  if (topBar) {
    topBar.style.position = 'relative';
    topBar.appendChild(btn);
  } else {
    // top-bar가 없으면 body에 fixed로 삽입
    btn.style.cssText += ';position:fixed;top:var(--safe-top,0px);left:0;';
    document.body.appendChild(btn);
  }
}"""

new = """function _insertBackButton() {
  if (document.getElementById('gwp-back-btn')) return;

  // top-logo-text를 "← 고팡" 버튼으로 교체
  const logoText = document.getElementById('top-logo-text');
  if (logoText) {
    logoText.dataset.prevText = logoText.textContent;
    const btn = document.createElement('button');
    btn.id = 'gwp-back-btn';
    btn.innerHTML = '&#8592; 고팡';
    btn.style.cssText = 'background:none;border:none;color:var(--accent,#3ECF8E);font-size:15px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:4px;padding:0;';
    btn.onclick = () => gwpClose(true);
    logoText.textContent = '';
    logoText.appendChild(btn);
  }
}"""

if old in c:
    c = c.replace(old, new)
    print('OK: _insertBackButton 수정')
else:
    print('FAIL: _insertBackButton 패턴 없음')
    idx = c.find('_insertBackButton')
    print(repr(c[idx:idx+100]))

# 3. _removeBackButton: top-logo-text 원복
old2 = """function _removeBackButton() {
  document.getElementById('gwp-back-btn')?.remove();
}"""

new2 = """function _removeBackButton() {
  const logoText = document.getElementById('top-logo-text');
  if (logoText && logoText.dataset.prevText) {
    logoText.textContent = logoText.dataset.prevText;
    delete logoText.dataset.prevText;
  }
  document.getElementById('gwp-back-btn')?.remove();
}"""

if old2 in c:
    c = c.replace(old2, new2)
    print('OK: _removeBackButton 수정')
else:
    print('FAIL: _removeBackButton 패턴 없음')

with open(path, 'w', encoding='utf-8') as f:
    f.write(c)
print('저장 완료')
