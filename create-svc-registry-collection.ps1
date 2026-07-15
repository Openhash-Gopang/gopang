# create-svc-registry-collection.ps1
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/svc_registry" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "svc_registry 컬렉션이 이미 있습니다 — 건너뜁니다." -ForegroundColor Yellow
} else {
    $body = @{
        id = "m9t2hen6pw37vz1"; name = "svc_registry"; type = "base"
        schema = @(
            @{ system=$false; id="u2fdo4vpvr3tvgl"; name="svc_id";         type="text";   required=$true;  presentable=$true; unique=$true;  options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="aw98gtvlv8bzuxx"; name="domain";        type="text";   required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="juwq3tgow8nwzcp"; name="description";  type="text";   required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="akeh7iryvb0zahu"; name="operator_ipv6";type="text";   required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="byc3f3lju27y61s"; name="min_auth";     type="text";   required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="a2d7wl2nv6br8hn"; name="trust_level";  type="number"; required=$false; presentable=$true; unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="j8w1ch1zloixjrk"; name="status";       type="text";   required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @("CREATE UNIQUE INDEX idx_svc_registry_svc_id ON svc_registry (svc_id)")
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
        Write-Host "svc_registry 컬렉션 생성 완료." -ForegroundColor Green
    } catch {
        Write-Host "생성 실패:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
        exit 1
    }
}
