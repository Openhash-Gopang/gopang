# create-pdv-query-audit-log-collection.ps1
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/pdv_query_audit_log" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "pdv_query_audit_log 컬렉션이 이미 있습니다 — 건너뜁니다." -ForegroundColor Yellow
} else {
    $body = @{
        id = "adn55pr750qug3c"; name = "pdv_query_audit_log"; type = "base"
        schema = @(
            @{ system=$false; id="alp0i3nffub7pe8"; name="query_id";      type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="du0k2j3galf5c54"; name="ipv6";          type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="s2rcv1cnhog4zfx"; name="svc";           type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ni0w78fs7r1fevq"; name="scope";         type="json";   required=$false; presentable=$false; unique=$false; options=@{} }
            @{ system=$false; id="keq2p9gv6f52m2v"; name="purpose";       type="text";   required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="xn6g5chwvbzhkii"; name="batch_size";    type="number"; required=$false; presentable=$true;  unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="akabodswq13puyy"; name="official_guid"; type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="bsyds5app259bbk"; name="official_org";  type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="iatrl7tnhwlb1fx"; name="official_role"; type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="y6j996s2lwml7f5"; name="recorded_at";   type="date";   required=$true;  presentable=$true;  unique=$false; options=@{ min=""; max="" } }
        )
        indexes = @(
            "CREATE INDEX idx_pdv_query_audit_log_ipv6 ON pdv_query_audit_log (ipv6)"
            "CREATE INDEX idx_pdv_query_audit_log_recorded_at ON pdv_query_audit_log (recorded_at)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
        Write-Host "pdv_query_audit_log 컬렉션 생성 완료." -ForegroundColor Green
    } catch {
        Write-Host "생성 실패:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
        exit 1
    }
}
