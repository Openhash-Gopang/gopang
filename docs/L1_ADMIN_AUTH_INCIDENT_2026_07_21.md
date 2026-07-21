# L1 admin auth 400 오류 — 원인 조사 및 재발 방지 (2026-07-21)

klaw.hondi.net "가상 판결" → 로그인 → "이 기기는 등록된 기기가 아닙니다" →
"스마트폰으로 이 기기 승인하기" 플로우에서 계속 재현되던
`L1 admin auth(...) 400: Failed to authenticate.` 오류를 추적한 기록입니다.
**최종 원인은 klaw 저장소와 무관한, hondi-proxy Worker 시크릿 설정 실수였고,
이 실수는 이미 한 번(2026-07-21 이전, LEDGER_WRITE_SECRET 401 건) 문서화된
적이 있는데도 재발했습니다.** 그래서 문서만으로는 부족하다고 판단해 이
"주의" 항목을 좌측 메뉴에 상시 노출합니다.

---

## 1. 증상

klaw.hondi.net에서 새 기기로 기존 계정 로그인 시도 → device-link 플로우
마지막 단계("스마트폰으로 요청 보내기")에서 항상:

```
{"ok":false,"error":"L1_UNREACHABLE",
 "detail":"L1 연결 실패: L1 admin auth(https://l1-hanlim.hondi.net) 400: {\"code\":400,\"message\":\"Failed to authenticate.\",\"data\":{}}"}
```

## 2. 배제한 원인들 (전부 확인했으나 진짜 원인 아니었음)

각각 직접 재현·검증했고, 모두 정상으로 확인됐습니다:

- **klaw 저장소가 gopang의 수정사항을 못 따라가는 것 아닌가?** → 아니었음.
  `device-link.html` 자체가 klaw에는 없고 hondi.net(gopang) 오리진에서만
  실행되므로, 이 플로우는 klaw/gopang 어느 쪽에서 진입해도 완전히 동일한
  코드 경로를 탄다. (단, 별개로 klaw가 `/gopang-wallet.js`를 자체 사본으로
  들고 있어 2026-07-20 변경분이 누락된 진짜 동기화 문제는 있었음 — §5 참고.)
- **전화번호 형식 문제?** → 부분적으로는 진짜 버그였음(`+820...` 한 형식만
  받던 걸 010-/82/8201... 등 다양한 표기를 받도록 `_normalizePhoneE164()`로
  수정, worker.js). 하지만 이건 L1 admin auth 400의 원인이 **아니었고**,
  형식만 고쳐도 400은 그대로 재현됨.
- **PocketBase DB의 admin 계정 자체가 잘못됨?** → 아니었음. hanlim 서버에
  SSH로 직접 들어가 `curl -X POST http://127.0.0.1:8091/api/admins/auth-with-password`
  로 실제 비밀번호를 넣어보면 200 정상 응답.
- **공인 도메인(l1-hanlim.hondi.net) 라우팅/nginx 문제?** → 아니었음. 로컬이
  아니라 공인 도메인으로 직접 쳐도 같은 계정/비밀번호로 200 정상.
- **Worker에 `L1_ADMIN_EMAIL`/`L1_ADMIN_PASSWORD` 시크릿 자체가 없음?** →
  아니었음. `wrangler secret list`로 이름은 이미 존재함을 확인.

즉 "이메일/비밀번호를 아는 사람이 직접 그 계정으로 로그인하면 되는데, 딱
Worker를 거칠 때만 실패"하는 상태였습니다 — 이 지점이 진짜 원인을 가리키는
핵심 단서였습니다.

## 3. 진짜 원인

**`Get-Content -Raw | wrangler secret put NAME` (PowerShell 파이프)로 시크릿
값을 넣으면, 문자열 끝에 개행(`\n`) 문자가 하나 추가로 붙어서 저장됩니다.**

임시 디버그 라우트(`/debug/l1-secret-check`, 평문 노출 없이 길이 + SHA256
앞 16자만 반환 — 확인 후 즉시 제거함)로 실제 검증:

| | 기대값 (원본 문자열) | 실제 Worker 시크릿 |
|---|---|---|
| 이메일 길이 | 21 | **22** |
| 비밀번호 길이 | 10 | **11** |

이메일·비밀번호 **둘 다 정확히 +1자** — 트레일링 개행이 원인임을 확정.
PocketBase의 `auth-with-password`는 당연히 `"tensor.city@gmail.com\n"`을
`"tensor.city@gmail.com"`과 다른 값으로 취급하므로 400이 나던 것.

### 3.1 이 버그는 오늘 처음이 아니었다

`docs/MARKET_PROXY_INTEGRATION_LOG_2026_07_21.md` §1.3에 이미 이렇게
적혀 있습니다:

> **실전에서 겪은 함정 — PowerShell 파이프의 개행 문제**: `"값" | wrangler
> secret put NAME` 방식이 문자열 끝에 개행을 붙이는 경우가 실제로 재현됨
> (`LEDGER_WRITE_SECRET` 401 오류로 발견). 코드 쪽에서 비교 시 `.trim()`으로
> 방어 처리.

같은 시기, 같은 종류의 시크릿(`L1_ADMIN_PASSWORD`) 설정 작업에서 **같은
버그가 다시 재현**됐습니다. 문서에 적어두는 것만으로는 다음에 급하게
`wrangler secret put`을 칠 때 기억나지 않는다는 뜻입니다 — 그래서 이번엔
좌측 메뉴 "주의" 항목으로 상시 노출합니다.

## 4. 해결 방법 (앞으로 시크릿 값을 넣을 때 반드시 이렇게)

**절대 이렇게 하지 말 것** (개행이 붙습니다):
```powershell
"내값" | wrangler secret put SECRET_NAME
Get-Content file.txt | wrangler secret put SECRET_NAME
Get-Content file.txt -Raw | wrangler secret put SECRET_NAME   # -Raw 여도 파이프면 동일하게 개행 붙음
```

**이렇게 할 것** (`cmd /c` + 파일 리다이렉션 `<` — 바이트를 그대로 넘겨서
개행이 붙지 않음):
```powershell
[System.IO.File]::WriteAllText("$env:TEMP\secret.txt", "내값")
cmd /c "wrangler secret put SECRET_NAME < `"$env:TEMP\secret.txt`""
Remove-Item "$env:TEMP\secret.txt"
```

**설정 직후 반드시 검증할 것.** 값은 절대 평문으로 되돌려주지 않으니,
길이/해시만 비교하는 임시 디버그 라우트를 그때그때 추가해서 확인하고
(worker.js에 GET 라우트 하나 임시 추가 → 배포 → curl로 확인 → 즉시 제거),
"이름이 존재한다"만으로 끝내지 말 것. `wrangler secret list`는 이름만
보여주고 값이 맞는지는 전혀 알려주지 않습니다.

## 5. 부수적으로 발견한 별개 이슈 — klaw의 `gopang-wallet.js` 동기화 누락

이번 조사 중 klaw.hondi.net의 `desktop.html`/`webapp.html`이
`https://hondi.net/gopang-wallet.js`를 불러오지 않고 **klaw 저장소 자체
사본**(`/gopang-wallet.js`)을 쓰는 걸 발견했습니다. gopang의 최신 버전과
diff한 결과, **2026-07-20자 변경 전체**(고액 거래 재인증 step-up biometric,
`generateX25519KeyPair`/`openSealedWithKey` 등 device-link 전용 메서드)가
klaw 사본에는 빠져 있었습니다. 이번 L1 admin auth 400과는 무관했지만
(device-link.html 자체는 hondi.net에서 실행되어 최신 파일을 씀), klaw
페이지에서 직접 지갑 서명·재인증 기능을 쓰는 순간에는 문제가 될 수 있는
잠재 버그입니다. 좌측 메뉴 "Check gopang-wallet.js sync across sa..."
워크플로우가 이미 존재하니, 이 체크가 실제로 klaw까지 커버하는지 별도
확인이 필요합니다.

---

**요약**: Worker 시크릿을 CLI로 설정할 때는 항상 `cmd /c ... <` 리다이렉션을
쓰고, 설정 직후 반드시 별도 방법으로 값을 검증하십시오. 이 규칙을 어기면
같은 문제가 세 번째로 재발할 수 있습니다.
