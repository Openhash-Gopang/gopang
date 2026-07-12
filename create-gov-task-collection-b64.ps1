# create-gov-task-collection.ps1 (Base64-only version)
# Creates the gov_task_schema_drafts collection on PocketBase L1
# (l1-hanlim.hondi.net) via the admin API.
# Every non-ASCII (Korean) string in this script is Base64-encoded and
# decoded at runtime, to avoid Windows PowerShell 5.1 misreading the
# script file under the system codepage (cp949) when no BOM survives
# the download/copy pipeline. This is the confirmed-working approach
# after repeated failures with plain UTF-8(+BOM) scripts (2026-07-12).

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}
function _b64d($s) { [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($s)) }

$L1_BASE = "https://l1-hanlim.hondi.net"

$promptEmailB64 = "UG9ja2V0QmFzZSDqtIDrpqzsnpAg7J2066mU7J28"
$promptPwB64 = "UG9ja2V0QmFzZSDqtIDrpqzsnpAg67mE67CA67KI7Zi4"
$authingB64 = "YG7qtIDrpqzsnpAg7J247KadIOykkS4uLg=="
$authOkB64 = "4pyFIOyduOymnSDshLHqs7U="
$authFailPrefixB64 = "4p2MIOyduOymnSDsi6TtjKg6IA=="
$versionHint1B64 = "UG9ja2V0QmFzZSDrsoTsoITsnbQgdjAuMjMg7J207IOB7J2066m0IOyXlOuTnO2PrOyduO2KuOqwgCDri6TrpoXri4jri6Q6"
$versionHint2B64 = "ICAvYXBpL2NvbGxlY3Rpb25zL19zdXBlcnVzZXJzL2F1dGgtd2l0aC1wYXNzd29yZA=="
$versionHint3B64 = "67KE7KCEIO2ZleyduDogJEwxX0JBU0UvYXBpL2hlYWx0aCDrmJDripQgQWRtaW4gVUkg7KKM7LihIO2VmOuLqA=="
$checkingB64 = "YG7quLDsobQg7Lus66CJ7IWYIO2ZleyduCDspJEuLi4="
$checkWarnPrefixB64 = "7ZmV7J24IOykkSDsmIjsg4Eg67CWIOydkeuLtTog"
$alreadyExistsB64 = "4oS577iPICBnb3ZfdGFza19zY2hlbWFfZHJhZnRzIOy7rOugieyFmOydtCDsnbTrr7gg7KG07J6s7ZWp64uI64ukIOKAlCDsg53shLHsnYQg6rG064SI65yB64uI64ukLg=="
$creatingB64 = "YG5nb3ZfdGFza19zY2hlbWFfZHJhZnRzIOy7rOugieyFmCDsg53shLEg7KSRLi4u"
$createOkPrefixB64 = "4pyFIOy7rOugieyFmCDsg53shLEg7JmE66OMIChpZDog"
$createFailPrefixB64 = "4p2MIOyDneyEsSDsi6TtjKg6IA=="
$finalCheckB64 = "YG7stZzsooUg7ZmV7J24Og=="
$doneMsgB64 = "YG7smYTro4wuIOydtCDssL3snYQg64ur7Jy87Iuc66m0IOuwqeq4iCDsnoXroKXtlZwg67mE67CA67KI7Zi464qUIOuplOuqqOumrOyXkOyEnCDsgqzrnbzsp5Hri4jri6Qu"
$fieldLinePrefixB64 = "ICAtIA=="

$promptEmail = _b64d $promptEmailB64
$promptPw = _b64d $promptPwB64
$authing = _b64d $authingB64
$authOk = _b64d $authOkB64
$authFailPrefix = _b64d $authFailPrefixB64
$versionHint1 = _b64d $versionHint1B64
$versionHint2 = _b64d $versionHint2B64
$versionHint3 = _b64d $versionHint3B64
$checking = _b64d $checkingB64
$checkWarnPrefix = _b64d $checkWarnPrefixB64
$alreadyExists = _b64d $alreadyExistsB64
$creating = _b64d $creatingB64
$createOkPrefix = _b64d $createOkPrefixB64
$createFailPrefix = _b64d $createFailPrefixB64
$finalCheck = _b64d $finalCheckB64
$doneMsg = _b64d $doneMsgB64
$fieldLinePrefix = _b64d $fieldLinePrefixB64

# -- Prompt for credentials (password not echoed) --
$adminEmail = Read-Host $promptEmail
$securePw   = Read-Host $promptPw -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw)
$adminPw = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

Write-Host $authing
try {
  $authBody = @{ identity = $adminEmail; password = $adminPw } | ConvertTo-Json
  $authRes = Invoke-RestMethod -Uri "$L1_BASE/api/admins/auth-with-password" -Method Post -Body $authBody -ContentType "application/json"
  $token = $authRes.token
  if (-not $token) { throw "no token" }
  Write-Host $authOk
} catch {
  Write-Error "$authFailPrefix$($_.Exception.Message)"
  Write-Host $versionHint1
  Write-Host $versionHint2
  Write-Host $versionHint3
  exit 1
}
$adminPw = $null

$headers = @{ Authorization = "Bearer $token" }

Write-Host $checking
$exists = $false
try {
  $check = Invoke-RestMethod -Uri "$L1_BASE/api/collections/gov_task_schema_drafts" -Headers $headers -Method Get
  if ($check.id) { $exists = $true }
} catch {
  if ($_.Exception.Response.StatusCode.value__ -ne 404) {
    Write-Warning "$checkWarnPrefix$($_.Exception.Message)"
  }
}

if ($exists) {
  Write-Host $alreadyExists
} else {
  Write-Host $creating
  $schema = @{
    name = "gov_task_schema_drafts"
    type = "base"
    schema = @(
      @{ name = "agency";          type = "text";   required = $true;  options = @{ max = 100 } }
      @{ name = "task_key";        type = "text";   required = $true;  options = @{ max = 200 } }
      @{ name = "schema_json";     type = "text";   required = $true;  options = @{ max = 20000 } }
      @{ name = "source_urls";     type = "text";   required = $false; options = @{ max = 20000 } }
      @{ name = "status";          type = "select"; required = $true;  options = @{ maxSelect = 1; values = @("pending","active","rejected") } }
      @{ name = "created_by_guid"; type = "text";   required = $true;  options = @{ max = 200 } }
      @{ name = "reviewed_by";     type = "text";   required = $false; options = @{ max = 200 } }
      @{ name = "reviewed_at";     type = "date";   required = $false; options = @{} }
    )
    indexes = @(
      "CREATE INDEX idx_gov_task_lookup ON gov_task_schema_drafts (agency, task_key, status)"
    )
    listRule = $null
    viewRule = $null
    createRule = $null
    updateRule = $null
    deleteRule = $null
  } | ConvertTo-Json -Depth 10

  try {
    $createRes = Invoke-RestMethod -Uri "$L1_BASE/api/collections" -Headers $headers -Method Post -Body $schema -ContentType "application/json"
    Write-Host "$createOkPrefix$($createRes.id))"
  } catch {
    Write-Error "$createFailPrefix$($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
    exit 1
  }
}

Write-Host $finalCheck
$final = Invoke-RestMethod -Uri "$L1_BASE/api/collections/gov_task_schema_drafts" -Headers $headers -Method Get
$final.schema | ForEach-Object { Write-Host "$fieldLinePrefix$($_.name) ($($_.type), required=$($_.required))" }

Write-Host $doneMsg
