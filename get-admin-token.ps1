# get-admin-token.ps1  (pure ASCII, BOM only)
# Logs in against worker.js /admin/login (prompt_admins PocketBase
# collection - NOT the PocketBase superuser account) and prints a
# bearer token valid for 30 minutes.

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function _b64d($s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }

$promptEmailB64 = "cHJvbXB0X2FkbWlucyBlbWFpbA=="
$promptPwB64 = "cHJvbXB0X2FkbWlucyBwYXNzd29yZA=="
$loggingInB64 = "TG9nZ2luZyBpbi4uLg=="
$okPrefixB64 = "T0sgLSB0b2tlbiAodmFsaWQgMzAgbWluKTog"
$failPrefixB64 = "RkFJTEVEOiA="

$promptEmail = _b64d $promptEmailB64
$promptPw = _b64d $promptPwB64
$loggingIn = _b64d $loggingInB64
$okPrefix = _b64d $okPrefixB64
$failPrefix = _b64d $failPrefixB64

$WORKER_URL = "https://hondi-proxy.tensor-city.workers.dev"
$email = Read-Host $promptEmail
$securePw = Read-Host $promptPw -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw)
$pw = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

Write-Host $loggingIn
try {
  $body = @{ email = $email; password = $pw } | ConvertTo-Json
  $res = Invoke-RestMethod -Uri "$WORKER_URL/admin/login" -Method Post -Body $body -ContentType "application/json"
  $pw = $null
  Write-Host "$okPrefix$($res.token)"
  Write-Host "admin: $($res.admin)"
} catch {
  Write-Error "$failPrefix$($_.Exception.Message)"
}
