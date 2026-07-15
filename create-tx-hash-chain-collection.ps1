# create-tx-hash-chain-collection.ps1
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/tx_hash_chain" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "tx_hash_chain 컬렉션이 이미 있습니다 — 건너뜁니다." -ForegroundColor Yellow
} else {
    $body = @{
        id = "f3sxtdkw1q6e4su"; name = "tx_hash_chain"; type = "base"
        schema = @(
            @{ system=$false; id="cwrsrlzasaclgvl"; name="tx_id";           type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="asy16xue9pku1ha"; name="buyer_guid";      type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ap9ftcsaljw7kct"; name="seller_guid";     type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="qfac2af1d0f7jkk"; name="block_hash";      type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ai8b8a34uexbhmd"; name="user_hash";       type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="go7i952h0wna2te"; name="node_hash";       type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="fpnlv6mj82w5978"; name="balance_claimed"; type="number"; required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null } }
            @{ system=$false; id="hhtgky8x0fd1omq"; name="anchored_at";     type="date";   required=$true;  presentable=$true;  unique=$false; options=@{ min=""; max="" } }
        )
        indexes = @("CREATE INDEX idx_tx_hash_chain_anchored_at ON tx_hash_chain (anchored_at)")
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
        Write-Host "tx_hash_chain 컬렉션 생성 완료." -ForegroundColor Green
    } catch {
        Write-Host "생성 실패:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
        exit 1
    }
}
