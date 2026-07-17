# create-sp-update-proposals-collection.ps1
# 2026-07-17 신설 — SP 자기 갱신 제안(Self-Update Proposal, RULE-03:
# K-Intent v1.3/K-Compose v1.7/K-Deliver v1.3/K-Report v1.1) 저장용
# L1 PocketBase 컬렉션. status는 항상 pending_review로 생성되며,
# 자동 승인·자동 반영 로직은 어디에도 없다 — 주피터님이 이 컬렉션을
# 직접 조회/검토해 승인 여부를 판단하고, 승인된 것만 사람이 직접
# 다음 SP 버전 파일로 반영한다(create-project-states-collection.ps1
# 과 동일 패턴 — id 15자, json 필드 maxSize 필수 문제를 이미 겪어서
# 이번엔 처음부터 반영했다).
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
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/sp_update_proposals" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "sp_update_proposals 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    # collection id는 정확히 15자여야 함(PocketBase 요구사항)
    $body = @{
        id = "spupdprop000001"; name = "sp_update_proposals"; type = "base"
        schema = @(
            @{ system=$false; id="sup0000000001"; name="sp_id";                      type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="sup0000000002"; name="current_version";             type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="sup0000000003"; name="trigger";                     type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="sup0000000004"; name="issue";                       type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="sup0000000005"; name="proposed_patch";              type="text";   required=$true;  presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="sup0000000006"; name="confidence";                  type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="sup0000000007"; name="protected_sections_touched";  type="bool";   required=$false; presentable=$true;  unique=$false; options=@{} }
            @{ system=$false; id="sup0000000008"; name="needs_extra_review";          type="bool";   required=$false; presentable=$true;  unique=$false; options=@{} }
            @{ system=$false; id="sup0000000009"; name="status";                      type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="sup0000000010"; name="source_session_note";         type="text";   required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
        )
        indexes = @(
            "CREATE INDEX idx_sp_update_proposals_status ON sp_update_proposals (status, sp_id)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    try {
        Invoke-RestMethod -Method POST -Uri "$base/api/collections" -Headers $headers -ContentType "application/json" -Body $body -ErrorAction Stop | Out-Null
        Write-Host "✅ sp_update_proposals 컬렉션 생성 완료."
    } catch {
        Write-Host "❌ 컬렉션 생성 실패:"
        Write-Host $_.ErrorDetails.Message
        exit 1
    }
}

try {
    $verify = Invoke-RestMethod -Method GET -Uri "$base/api/collections/sp_update_proposals" -Headers $headers -ErrorAction Stop
    Write-Host "확인됨 — 필드 수: $($verify.schema.Count)"
} catch {
    Write-Host "❌ 생성 확인 실패 — 컬렉션이 실제로 없을 수 있습니다:"
    Write-Host $_.ErrorDetails.Message
    exit 1
}
