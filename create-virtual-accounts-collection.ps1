# create-virtual-accounts-collection.ps1
# ------------------------------------------------------------------
# pb_migrations/1787000002_created_virtual_accounts.js 의 REST 버전.
# SSH 접근이 없는 상태라 PocketBase Admin REST API로 동일한 결과를
# 만든다 — create-charge-requests-collection.ps1과 동일 관례.
#
# GDC 충전 자동화 방식B(PG 가상계좌)의 guid↔계좌번호 매핑 저장소.
# ------------------------------------------------------------------

$base = "https://l1-hanlim.hondi.net"

$email    = Read-Host "PocketBase admin email"
$password = Read-Host "PocketBase admin password" -AsSecureString
$plainPw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
$authBody = @{ identity = $email; password = $plainPw } | ConvertTo-Json
$authRes  = Invoke-RestMethod -Method POST -Uri "$base/api/admins/auth-with-password" -ContentType "application/json" -Body $authBody
$token = $authRes.token
if (-not $token) { Write-Host "로그인 실패" -ForegroundColor Red; exit 1 }
$headers = @{ Authorization = $token }

$existing = $null
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/virtual_accounts" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "virtual_accounts 컬렉션이 이미 있습니다 — 건너뜁니다." -ForegroundColor Yellow
    exit 0
}

$body = @{
    id = "vacc0000000001"; name = "virtual_accounts"; type = "base"
    schema = @(
        @{ system=$false; id="va00000000001"; name="guid";               type="text";   required=$true;  presentable=$true; unique=$true;  options=@{ min=$null; max=$null; pattern="" } }
        @{ system=$false; id="va00000000002"; name="pg_provider";        type="text";   required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        @{ system=$false; id="va00000000003"; name="account_no";         type="text";   required=$true;  presentable=$true; unique=$true;  options=@{ min=$null; max=$null; pattern="" } }
        @{ system=$false; id="va00000000004"; name="bank_name";          type="text";   required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        @{ system=$false; id="va00000000005"; name="status";             type="select"; required=$true;  presentable=$true; unique=$false; options=@{ maxSelect=1; values=@("active","expired","revoked") } }
        @{ system=$false; id="va00000000006"; name="expires_at";         type="date";   required=$false; presentable=$true; unique=$false; options=@{ min=""; max="" } }
    )
    indexes = @(
        "CREATE UNIQUE INDEX idx_virtual_accounts_guid ON virtual_accounts (guid)",
        "CREATE UNIQUE INDEX idx_virtual_accounts_account_no ON virtual_accounts (account_no)"
    )
    listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
} | ConvertTo-Json -Depth 10

try {
    Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
    Write-Host "virtual_accounts 컬렉션 생성 완료." -ForegroundColor Green
} catch {
    Write-Host "생성 실패:" -ForegroundColor Red
    Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    exit 1
}
