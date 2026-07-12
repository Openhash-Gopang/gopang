# fix-gov-task-collection-rules.ps1 (pure ASCII, BOM only)
# The collection was created with listRule/viewRule/createRule/
# updateRule/deleteRule = null, which in PocketBase means
# 'superusers only'. worker.js writes to this collection without
# any PocketBase-level auth (it enforces its own auth via
# _requireAdmin at the app layer instead), so the rules must be
# set to empty string ('') to allow public access at the PB layer.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function _b64d($s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }

$promptEmailB64 = "UG9ja2V0QmFzZSBhZG1pbiBlbWFpbA=="
$promptPwB64 = "UG9ja2V0QmFzZSBhZG1pbiBwYXNzd29yZA=="
$authingB64 = "QXV0aGVudGljYXRpbmcuLi4="
$authOkB64 = "T0sgLSBhdXRoZW50aWNhdGVk"
$authFailPrefixB64 = "RkFJTEVEIHRvIGF1dGhlbnRpY2F0ZTog"
$fetchingB64 = "RmV0Y2hpbmcgY3VycmVudCBjb2xsZWN0aW9uLi4u"
$updatingB64 = "VXBkYXRpbmcgcnVsZXMgdG8gcHVibGljIChlbXB0eSBzdHJpbmcpLi4u"
$updateOkB64 = "T0sgLSBydWxlcyB1cGRhdGVk"
$updateFailPrefixB64 = "RkFJTEVEIHRvIHVwZGF0ZTog"
$doneMsgB64 = "RG9uZS4="

$promptEmail = _b64d $promptEmailB64
$promptPw = _b64d $promptPwB64
$authing = _b64d $authingB64
$authOk = _b64d $authOkB64
$authFailPrefix = _b64d $authFailPrefixB64
$fetching = _b64d $fetchingB64
$updating = _b64d $updatingB64
$updateOk = _b64d $updateOkB64
$updateFailPrefix = _b64d $updateFailPrefixB64
$doneMsg = _b64d $doneMsgB64

$L1_BASE = "https://l1-hanlim.hondi.net"
$adminEmail = Read-Host $promptEmail
$securePw = Read-Host $promptPw -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw)
$adminPw = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

Write-Host $authing
try {
  $authBody = @{ identity = $adminEmail; password = $adminPw } | ConvertTo-Json
  $authRes = Invoke-RestMethod -Uri "$L1_BASE/api/admins/auth-with-password" -Method Post -Body $authBody -ContentType "application/json"
  $token = $authRes.token
  Write-Host $authOk
} catch {
  Write-Error "$authFailPrefix$($_.Exception.Message)"
  exit 1
}
$adminPw = $null
$headers = @{ Authorization = "Bearer $token" }

Write-Host $fetching
$col = Invoke-RestMethod -Uri "$L1_BASE/api/collections/gov_task_schema_drafts" -Headers $headers -Method Get

Write-Host $updating
$patchBody = @{
  listRule   = ""
  viewRule   = ""
  createRule = ""
  updateRule = ""
  deleteRule = ""
} | ConvertTo-Json
try {
  $updRes = Invoke-RestMethod -Uri "$L1_BASE/api/collections/$($col.id)" -Headers $headers -Method Patch -Body $patchBody -ContentType "application/json"
  Write-Host $updateOk
  Write-Host "listRule=[$($updRes.listRule)] createRule=[$($updRes.createRule)] updateRule=[$($updRes.updateRule)]"
} catch {
  Write-Error "$updateFailPrefix$($_.Exception.Message)"
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
  exit 1
}
Write-Host $doneMsg
