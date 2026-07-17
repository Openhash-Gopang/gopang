# migrate-sp-update-proposals-add-source.ps1
# 2026-07-17 신설 — sp_update_proposals 컬렉션이 이미
# create-sp-update-proposals-collection.ps1로 생성된 뒤라 source·
# user_feedback_ids 필드가 빠진 채 배포됐다(worker.js handleSpUpdatePropose가
# 2026-07-17에 이 두 필드를 쓰도록 갱신됨 — 사용자 개선 제안 능동 획득
# 메커니즘, docs/user_feedback_mechanism_proposal_v1.md). 이 스크립트는
# 기존 컬렉션에 해당 필드만 추가한다(PocketBase collection PATCH —
# 컬렉션을 지우고 새로 만들지 않는다, 이미 저장된 레코드가 있으면 보존됨).
# migrate-project-states-add-project-brief.ps1과 동일 패턴.
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
try {
    $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/sp_update_proposals" -Headers $headers -ErrorAction Stop
} catch {
    Write-Host "❌ sp_update_proposals 컬렉션이 없습니다 — 먼저 create-sp-update-proposals-collection.ps1을 실행하세요."
    exit 1
}

$newSchema = $existing.schema

$hasSource = $newSchema | Where-Object { $_.name -eq 'source' }
if (-not $hasSource) {
    $newSchema = $newSchema + @{
        system=$false; id="sup0000000011"; name="source"
        type="text"; required=$false; presentable=$true; unique=$false
        options=@{ min=$null; max=$null; pattern="" }
    }
    Write-Host "source 필드 추가 예정."
} else {
    Write-Host "source 필드가 이미 있습니다 — 건너뜁니다."
}

$hasIds = $newSchema | Where-Object { $_.name -eq 'user_feedback_ids' }
if (-not $hasIds) {
    $newSchema = $newSchema + @{
        system=$false; id="sup0000000012"; name="user_feedback_ids"
        type="json"; required=$false; presentable=$false; unique=$false
        options=@{ maxSize=2000000 }
    }
    Write-Host "user_feedback_ids 필드 추가 예정."
} else {
    Write-Host "user_feedback_ids 필드가 이미 있습니다 — 건너뜁니다."
}

if (-not $hasSource -or -not $hasIds) {
    $body = @{ schema = $newSchema } | ConvertTo-Json -Depth 10
    try {
        Invoke-RestMethod -Method PATCH -Uri "$base/api/collections/sp_update_proposals" -Headers $headers -ContentType "application/json" -Body $body -ErrorAction Stop | Out-Null
        Write-Host "✅ 필드 추가 완료."
    } catch {
        Write-Host "❌ 필드 추가 실패:"
        Write-Host $_.ErrorDetails.Message
        exit 1
    }
} else {
    Write-Host "추가할 필드 없음 — 종료."
    exit 0
}

$verify = Invoke-RestMethod -Method GET -Uri "$base/api/collections/sp_update_proposals" -Headers $headers -ErrorAction Stop
Write-Host "확인됨 — 필드 수: $($verify.schema.Count)"
