# create-ai-messages-collection.ps1
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/ai_messages" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "ai_messages 컬렉션이 이미 있습니다 — 건너뜁니다." -ForegroundColor Yellow
} else {
    $body = @{
        id = "asdhhksfuahqzj3"; name = "ai_messages"; type = "base"
        schema = @(
            @{ system=$false; id="hnpsu4lqlf58icp"; name="session_id";         type="text"; required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="aluxi3bmq56rmb3"; name="sender_guid";        type="text"; required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ve8djkhae8yvfho"; name="receiver_guid";      type="text"; required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ape8w4hgezp8uz5"; name="content_original";   type="text"; required=$true;  presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="efw84plsf7cl1xq"; name="content_translated"; type="text"; required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="eyptkhikwo8q86v"; name="lang_from";          type="text"; required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="fnpjvur7gw856y8"; name="lang_to";            type="text"; required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="otjqj1souqjzwav"; name="content_type";       type="text"; required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @("CREATE INDEX idx_ai_messages_session_id ON ai_messages (session_id)")
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
        Write-Host "ai_messages 컬렉션 생성 완료." -ForegroundColor Green
    } catch {
        Write-Host "생성 실패:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
        exit 1
    }
}
