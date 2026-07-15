# create-feedback-collection.ps1
$ErrorActionPreference = "Stop"
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/feedback" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "feedback 컬렉션이 이미 있습니다 — 건너뜁니다." -ForegroundColor Yellow
} else {
    $body = @{
        id = "j2ao8lt7zg5rjia"; name = "feedback"; type = "base"
        schema = @(
            @{ system=$false; id="lnk9iqu452twuyy"; name="guid";       type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="r70kuncro9f711w"; name="handle";     type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="fyv6h2txxy0obe9"; name="content";    type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="agx9rok443tdkoa"; name="category";   type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="gimjpcqyzonj2qc"; name="status";     type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="b67mttz2bbroea9"; name="admin_note"; type="text"; required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @("CREATE INDEX idx_feedback_status ON feedback (status)", "CREATE INDEX idx_feedback_guid ON feedback (guid)")
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
        Write-Host "feedback 컬렉션 생성 완료." -ForegroundColor Green
    } catch {
        Write-Host "생성 실패:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
        exit 1
    }
}
