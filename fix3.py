# -*- coding: utf-8 -*-
"""
푸시 알림 권한 요청을 "가입 완료 시점"에만 표시하고,
요청 결과(허용/거부)를 채팅창에 안내 메시지로 보여주는 패치.

새로 만드는 파일:
  - src/gopang/services/push.js   (Web Push 구독 공용 로직)

수정하는 파일:
  - src/gopang/core/auth.js       (가입 완료 직후 — 결과를 채팅에 안내)
  - webapp.html                   (설정 화면의 푸시 토글을 같은 공용 로직으로 정리)
"""
import io
import os


def read_normalized(path, encoding):
    with io.open(path, "rb") as f:
        raw = f.read()
    has_crlf = b"\r\n" in raw
    text = raw.decode(encoding)
    norm = text.replace("\r\n", "\n")
    return norm, has_crlf


def write_restoring_eol(path, norm_text, has_crlf, encoding):
    out = norm_text.replace("\n", "\r\n") if has_crlf else norm_text
    with io.open(path, "w", encoding=encoding, newline="") as f:
        f.write(out)


PUSH_JS = """/**
 * services/push.js — Web Push(VAPID) 구독 공통 로직
 *
 * 가입 완료 시점에 푸시 알림 권한을 요청하기 위한 공용 모듈.
 * 설정 화면의 토글에서도 동일한 로직을 재사용한다.
 *
 * - 이미 구독돼 있으면 재요청 없이 그대로 서버에만 재등록(guid 갱신)
 * - 이미 거부된 상태(Notification.permission === 'denied')면 조용히 종료
 *   (브라우저가 다이얼로그를 다시 띄우지 않으므로 콘솔 노이즈만 남기지 않게)
 * - 실패해도 호출부의 다른 흐름(가입 등)을 막지 않도록
 *   항상 { ok, reason } 형태로만 반환하고 throw하지 않는다.
 */
const WORKER_URL = 'https://gopang-proxy.tensor-city.workers.dev';

function _urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64  = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw     = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

export async function requestPushSubscription(guid) {
  if (!guid) return { ok: false, reason: 'guid_missing' };
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, reason: 'unsupported' };
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, reason: 'permission_denied' };
  }

  try {
    const reg = await navigator.serviceWorker.ready;

    // 이미 구독돼 있으면 권한 다이얼로그 없이 그대로 재사용
    let sub = await reg.pushManager.getSubscription();

    if (!sub) {
      const keyRes   = await fetch(`${WORKER_URL}/push/vapid-public-key`);
      const vapidKey = (await keyRes.json()).publicKey;
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: _urlBase64ToUint8Array(vapidKey),
      });
    }

    const sound = localStorage.getItem('gopang_push_sound') || 'ping';
    await fetch(`${WORKER_URL}/push/subscribe`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ guid, subscription: sub.toJSON(), sound }),
    });

    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}
"""


def create_push_js():
    path = "src/gopang/services/push.js"
    if os.path.exists(path):
        print("[push.js] 이미 존재합니다. 변경 없음.")
        return False
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with io.open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(PUSH_JS)
    print("[push.js] 새 파일 생성 완료.")
    return True


def patch_auth_js():
    path = "src/gopang/core/auth.js"
    content, has_crlf = read_normalized(path, "utf-8-sig")

    if "requestPushSubscription" in content:
        print("[auth.js] 이미 패치되어 있습니다. 변경 없음.")
        return False

    old_import = (
        "import { setUser, _USER, USER_GUID, L1_URL, PROXY } from './state.js';\n"
        "const PROXY_URL = PROXY;\n"
        "import { appendBubble } from '../ui/bubble.js';\n"
    )
    new_import = (
        "import { setUser, _USER, USER_GUID, L1_URL, PROXY } from './state.js';\n"
        "const PROXY_URL = PROXY;\n"
        "import { appendBubble } from '../ui/bubble.js';\n"
        "import { requestPushSubscription } from '../services/push.js';\n"
    )
    if old_import not in content:
        print("[auth.js] import 구간을 찾지 못했습니다. 건너뜁니다.")
        return False
    content = content.replace(old_import, new_import, 1)

    old_done = (
        "        console.info('[가입][X25519] 키 등록 완료:', syncResult.publicKeyB64u?.slice(0, 16) + '...');\n"
        "      }\n"
        "\n"
        "      resolve(user);\n"
        "\n"
        "    } catch(e) {\n"
        "      nickErr.textContent = '네트워크 오류. 다시 시도해 주세요.';\n"
    )
    new_done = (
        "        console.info('[가입][X25519] 키 등록 완료:', syncResult.publicKeyB64u?.slice(0, 16) + '...');\n"
        "      }\n"
        "\n"
        "      resolve(user);\n"
        "\n"
        "      // 가입 완료 시점에 푸시 알림 권한 요청 — 결과를 채팅에 안내\n"
        "      // (가입 완료를 막지 않도록 resolve 이후 비동기로 처리)\n"
        "      requestPushSubscription(ipv6).then(pushResult => {\n"
        "        if (!document.getElementById('message-list')) return; // 화면 전환 전이면 조용히 스킵\n"
        "        if (pushResult.ok) {\n"
        "          appendBubble('ai', '\U0001f514 알림이 활성화되었습니다. PC에서 AI 키를 보내면 실시간으로 알려드릴게요.');\n"
        "        } else if (pushResult.reason === 'permission_denied') {\n"
        "          appendBubble('ai', '\U0001f514 알림 권한이 꺼져 있어요. PC에서 보낸 메시지를 실시간으로 받으려면 브라우저 설정 → 알림에서 고팡을 허용해 주세요.');\n"
        "        }\n"
        "        // unsupported/guid_missing 등은 사용자가 할 수 있는 게 없으므로 조용히 무시\n"
        "      }).catch(() => {});\n"
        "\n"
        "    } catch(e) {\n"
        "      nickErr.textContent = '네트워크 오류. 다시 시도해 주세요.';\n"
    )
    if old_done not in content:
        print("[auth.js] 가입 완료 삽입 위치를 찾지 못했습니다. 건너뜁니다.")
        return False
    content = content.replace(old_done, new_done, 1)

    write_restoring_eol(path, content, has_crlf, "utf-8-sig")
    print("[auth.js] 패치 완료.")
    return True


def patch_webapp_html():
    path = "webapp.html"
    content, has_crlf = read_normalized(path, "utf-8-sig")

    if "await import('/src/gopang/services/push.js')" in content:
        print("[webapp.html] 이미 패치되어 있습니다. 변경 없음.")
        return False

    old_block = (
        "      if (status) status.textContent = '권한 요청 중…';\n"
        "      const keyRes  = await fetch('https://gopang-proxy.tensor-city.workers.dev/push/vapid-public-key');\n"
        "      const vapidKey = (await keyRes.json()).publicKey;\n"
        "      const reg = await navigator.serviceWorker.ready;\n"
        "      const sub = await reg.pushManager.subscribe({\n"
        "        userVisibleOnly: true,\n"
        "        applicationServerKey: _urlBase64ToUint8Array(vapidKey),\n"
        "      });\n"
        "      const sound = localStorage.getItem('gopang_push_sound') || 'ping';\n"
        "      await fetch('https://gopang-proxy.tensor-city.workers.dev/push/subscribe', {\n"
        "        method: 'POST', headers: { 'Content-Type': 'application/json' },\n"
        "        body: JSON.stringify({ guid: user.ipv6, subscription: sub.toJSON(), sound }),\n"
        "      });\n"
        "      _setPushToggle(true);\n"
    )
    new_block = (
        "      if (status) status.textContent = '권한 요청 중…';\n"
        "      const { requestPushSubscription } = await import('/src/gopang/services/push.js');\n"
        "      const result = await requestPushSubscription(user.ipv6);\n"
        "      if (!result.ok) throw new Error(result.reason || '구독 실패');\n"
        "      _setPushToggle(true);\n"
    )
    if old_block not in content:
        print("[webapp.html] _togglePush 구간을 찾지 못했습니다. 건너뜁니다.")
        return False
    content = content.replace(old_block, new_block, 1)

    write_restoring_eol(path, content, has_crlf, "utf-8-sig")
    print("[webapp.html] 패치 완료.")
    return True


if __name__ == "__main__":
    changed = False
    changed |= create_push_js()
    changed |= patch_auth_js()
    changed |= patch_webapp_html()
    if changed:
        print("\n패치 적용 완료. 아래 git 명령으로 커밋/푸시하세요.")
    else:
        print("\n변경된 파일이 없습니다.")
