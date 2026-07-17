# create-user-feedback-collection.ps1
# 2026-07-17 신설 — 사용자 개선 제안 능동 획득(docs/
# user_feedback_mechanism_proposal_v1.md) 저장용 L1 PocketBase 컬렉션.
# status는 항상 new로 생성되며, tools/triage_feedback.py(주기 배치)가
# 이걸 훑어 클러스터링한 뒤 명확한 것만 sp_update_proposals로 브릿지한다
# — 이 컬렉션 자체에는 자동 승인·자동 반영 로직이 전혀 없다.
# create-sp-update-proposals-collection.ps1과 동일 패턴(id 15자,
# json 필드 maxSize 필수 문제를 이미 겪어서 이번엔 처음부터 반영).
$ErrorActionPreference = 'Stop'
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/user_feedback" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "user_feedback 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    # collection id는 정확히 15자여야 함(PocketBase 요구사항)
    $body = @{
        id = "userfeedback001"; name = "user_feedback"; type = "base"
        schema = @(
            @{ system=$false; id="ufb0000000001"; name="guid";              type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ufb0000000002"; name="raw_text";          type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=2000; pattern="" } }
            @{ system=$false; id="ufb0000000003"; name="context_sp";        type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ufb0000000004"; name="context_summary";   type="text"; required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=500; pattern="" } }
            @{ system=$false; id="ufb0000000005"; name="category";         type="text"; required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="ufb0000000006"; name="status";           type="text"; required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @(
            "CREATE INDEX idx_user_feedback_status ON user_feedback (status)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body -ErrorAction Stop | Out-Null
        Write-Host "✅ user_feedback 컬렉션 생성 완료."
    } catch {
        Write-Host "❌ 컬렉션 생성 실패:"
        Write-Host $_.ErrorDetails.Message
        exit 1
    }
}

try {
    $verify = Invoke-RestMethod -Method GET -Uri "$base/api/collections/user_feedback" -Headers $headers -ErrorAction Stop
    Write-Host "확인됨 — 필드 수: $($verify.schema.Count)"
} catch {
    Write-Host "❌ 생성 확인 실패 — 컬렉션이 실제로 없을 수 있습니다:"
    Write-Host $_.ErrorDetails.Message
    exit 1
}
