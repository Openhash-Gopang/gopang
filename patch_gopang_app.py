with open('gopang-app.js', 'r', encoding='utf-8') as f:
    code = f.read()

# 1. import 추가 (P2P 섹션 바로 뒤)
old_import = """// ── PDV ──────────────────────────────────────────────────
import { recordPDV }                           from './src/gopang/pdv/record.js';"""

new_import = """// ── PDV ──────────────────────────────────────────────────
import { recordPDV }                           from './src/gopang/pdv/record.js';

// ── P2P 검색/채팅 (GDUDA Phase 1) ────────────────────────
import { openSearch as openP2PSearch }         from './src/gopang/ui/p2p-search.js';
import { startIncomingWatch }                  from './src/gopang/ui/p2p-chat.js';"""

if old_import in code:
    code = code.replace(old_import, new_import)
    print("[1] import 추가 완료")
else:
    print("[1] import 위치 못 찾음")

# 2. 전역 노출 (P2P 섹션에 추가)
old_expose = """  // P2P
  window.setPeer                   = setPeer;
  window._clearPeer                = _clearPeer;"""

new_expose = """  // P2P
  window.setPeer                   = setPeer;
  window._clearPeer                = _clearPeer;

  // P2P 검색/채팅 (GDUDA Phase 1)
  window.openP2PSearch             = openP2PSearch;"""

if old_expose in code:
    code = code.replace(old_expose, new_expose)
    print("[2] 전역 노출 추가 완료")
else:
    print("[2] 전역 노출 위치 못 찾음")

# 3. startIncomingWatch 호출 (4-8 시그널 폴링 바로 뒤)
old_boot = """  // 4-8. 등록 사용자 → 시그널 폴링 자동 시작
  if (_isRegistered()) {
    _startSignalPoll();
    console.info('[Signal] 자동 폴링 시작 (등록 사용자)');
  }"""

new_boot = """  // 4-8. 등록 사용자 → 시그널 폴링 자동 시작
  if (_isRegistered()) {
    _startSignalPoll();
    console.info('[Signal] 자동 폴링 시작 (등록 사용자)');

    // GDUDA Phase 1 — incoming offer 감시
    if (_USER?.ipv6) startIncomingWatch(_USER.ipv6);
  }"""

if old_boot in code:
    code = code.replace(old_boot, new_boot)
    print("[3] startIncomingWatch 추가 완료")
else:
    print("[3] 부트 위치 못 찾음")

with open('gopang-app.js', 'w', encoding='utf-8') as f:
    f.write(code)

print("완료")
