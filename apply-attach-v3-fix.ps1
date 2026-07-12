# apply-attach-v3-fix.ps1
# 잔존 단수변수(_aiPanelAttachedFile) 버그 수정 — 2곳의 실기능 버그
# (전송버튼 활성화, 음성 자동전송 판단) + 죽은 선언 1곳 정리

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function _b64d($s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }
$path = ".\webapp.html"
if (-not (Test-Path $path)) { throw "webapp.html을 찾을 수 없습니다 — 리포 루트에서 실행하세요." }
$encRead  = [System.Text.Encoding]::UTF8
$encWrite = New-Object System.Text.UTF8Encoding($true)
$content = [System.IO.File]::ReadAllText((Resolve-Path $path), $encRead)
$backupPath = ".\webapp.html.bak-$(Get-Date -Format yyyyMMdd-HHmmss)"
Copy-Item $path $backupPath
Write-Host "백업 생성: $backupPath"

$oldSendStateB64 = "ICAgIHNlbmRCdG4uZGlzYWJsZWQgPSAhKGlucHV0LnZhbHVlLnRyaW0oKSB8fCBfYWlQYW5lbEF0dGFjaGVkRmlsZSk7"
$newSendStateB64 = "ICAgIHNlbmRCdG4uZGlzYWJsZWQgPSAhKGlucHV0LnZhbHVlLnRyaW0oKSB8fCBfYWlQYW5lbEF0dGFjaGVkRmlsZXMubGVuZ3RoKTs="
$oldDeadDeclB64 = "ICAvLyDilIDilIAg7YyM7J28wrfsgqzsp4Qg7LKo67aAIOKAlCDsnoXroKUg7ZWE65OcIOyZvOyqvSDrs7TsobAg67KE7Yq8IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAogIGxldCBfYWlQYW5lbEF0dGFjaGVkRmlsZSA9IG51bGw7IC8vIHsgbmFtZSwgZGF0YVVybCwgaXNJbWFnZSB9Cg=="
$newDeadDeclB64 = "ICAvLyDilIDilIAg7YyM7J28wrfsgqzsp4Qg7LKo67aAIOKAlCDsnoXroKUg7ZWE65OcIOyZvOyqvSDrs7TsobAg67KE7Yq8IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgAo="
$oldAutoSendB64 = "ICAgICAgICBpZiAoaW5wdXQudmFsdWUudHJpbSgpIHx8IF9haVBhbmVsQXR0YWNoZWRGaWxlKSB7"
$newAutoSendB64 = "ICAgICAgICBpZiAoaW5wdXQudmFsdWUudHJpbSgpIHx8IF9haVBhbmVsQXR0YWNoZWRGaWxlcy5sZW5ndGgpIHs="

$oldSendState = _b64d $oldSendStateB64
$newSendState = _b64d $newSendStateB64
$oldDeadDecl = _b64d $oldDeadDeclB64
$newDeadDecl = _b64d $newDeadDeclB64
$oldAutoSend = _b64d $oldAutoSendB64
$newAutoSend = _b64d $newAutoSendB64

$replacements = @(
  @{ Name = '전송버튼 활성화 조건(_updatePanelSendState)'; Old = $oldSendState; New = $newSendState },
  @{ Name = '죽은 단수 변수 선언 제거';                    Old = $oldDeadDecl;  New = $newDeadDecl },
  @{ Name = '음성 자동전송 판단 조건';                    Old = $oldAutoSend;  New = $newAutoSend }
)
$applied = 0
foreach ($r in $replacements) {
  if ($content.Contains($r.Old)) {
    $content = $content.Replace($r.Old, $r.New)
    Write-Host "✅ $($r.Name) 치환 완료"
    $applied++
  } else {
    Write-Warning "⚠️ $($r.Name) — 원본과 일치하는 블록을 못 찾았습니다."
  }
}
if ($applied -gt 0) {
  [System.IO.File]::WriteAllText((Resolve-Path $path), $content, $encWrite)
  Write-Host "`nwebapp.html 저장 완료 (${applied}개 블록 치환됨)"
} else {
  Write-Host "`n치환된 블록이 없어 파일을 다시 쓰지 않았습니다."
}
Write-Host "`n남은 잔존 확인: Select-String -Path .\webapp.html -Pattern _aiPanelAttachedFile\b"
Write-Host "(_aiPanelAttachedFiles 배열 관련 줄만 나오고 단수형은 하나도 없어야 정상)"
