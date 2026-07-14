# create-pdv-merkle-anchors-collection.ps1
$base = "https://l1-hanlim.hondi.net"
$email    = Read-Host "PocketBase admin email"
$password = Read-Host "PocketBase admin password" -AsSecureString
$plainPw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))
$authBody = @{ identity = $email; password = $plainPw } | ConvertTo-Json
$authRes  = Invoke-RestMethod -Method POST -Uri "$base/api/admins/auth-with-password" -ContentType "application/json" -Body $authBody
$token = $authRes.token
if (-not $token) { Write-Host "로그인 실패"; exit 1 }
$headers = @{ Authorization = $token }

$existing = $null
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/pdv_merkle_anchors" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "pdv_merkle_anchors 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    $body = @{
        id = "pmka00000001"; name = "pdv_merkle_anchors"; type = "base"
        schema = @(
            @{ system=$false; id="pma0000000001"; name="merkle_root"; type="text";   required=$true; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pma0000000002"; name="block_count"; type="number"; required=$true; presentable=$true;  unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="pma0000000003"; name="pdv_ids";     type="text";   required=$true; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pma0000000004"; name="status";      type="text";   required=$true; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="pma0000000005"; name="anchored_at"; type="date";   required=$true; presentable=$true;  unique=$false; options=@{ min=""; max="" } }
        )
        indexes = @("CREATE INDEX idx_pdv_merkle_anchors_anchored_at ON pdv_merkle_anchors (anchored_at)")
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
    Write-Host "pdv_merkle_anchors 컬렉션 생성 완료."
}
