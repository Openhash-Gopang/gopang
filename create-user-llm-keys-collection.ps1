# create-user-llm-keys-collection.ps1
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/user_llm_keys" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "user_llm_keys 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    $body = @{
        id = "ullk0000001"; name = "user_llm_keys"; type = "base"
        schema = @(
            @{ system=$false; id="ullk000000001"; name="guid";          type="text"; required=$true;  presentable=$true;  unique=$true;  options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ullk000000002"; name="provider";      type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ullk000000003"; name="model";         type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ullk000000004"; name="api_key_enc";   type="text"; required=$true;  presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ullk000000005"; name="ai_active";     type="bool"; required=$false; presentable=$true;  unique=$false; options=@{} }
            @{ system=$false; id="ullk000000006"; name="custom_prompt"; type="text"; required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ullk000000007"; name="native_lang";   type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ullk000000008"; name="endpoint";      type="text"; required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @("CREATE UNIQUE INDEX idx_user_llm_keys_guid ON user_llm_keys (guid)")
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
    Write-Host "user_llm_keys 컬렉션 생성 완료."
}
