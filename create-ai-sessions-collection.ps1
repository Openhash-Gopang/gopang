# create-ai-sessions-collection.ps1
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/ai_sessions" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "ai_sessions 컬렉션이 이미 있습니다 — 건너뜁니다." -ForegroundColor Yellow
} else {
    $body = @{
        id = "ajjbxo0uqxjd8cg"; name = "ai_sessions"; type = "base"
        schema = @(
            @{ system=$false; id="e3djba8qaxqw22q"; name="session_id";   type="text"; required=$true;  presentable=$true;  unique=$true;  options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="tw4dqcf1a7wt8u8"; name="caller_guid";  type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="og79i70pc5mk3pt"; name="caller_lang"; type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="v4sghsvs7um9igc"; name="target_guid"; type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="k3ym5pmpvuweovw"; name="mode";        type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="dmibl2q8goc0po9"; name="messages";    type="json"; required=$false; presentable=$false; unique=$false; options=@{} }
            @{ system=$false; id="ahr77wjatchqxb0"; name="is_active";   type="bool"; required=$false; presentable=$true;  unique=$false; options=@{} }
            @{ system=$false; id="akq1c96mwb8g5jb"; name="escalated_at";type="date"; required=$false; presentable=$true;  unique=$false; options=@{ min=""; max="" } }
        )
        indexes = @("CREATE UNIQUE INDEX idx_ai_sessions_session_id ON ai_sessions (session_id)")
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body | Out-Null
        Write-Host "ai_sessions 컬렉션 생성 완료." -ForegroundColor Green
    } catch {
        Write-Host "생성 실패:" -ForegroundColor Red
        Write-Host $_.ErrorDetails.Message -ForegroundColor Red
        exit 1
    }
}
