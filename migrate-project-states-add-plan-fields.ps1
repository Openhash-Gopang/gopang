# migrate-project-states-add-plan-fields.ps1
# 2026-07-17 신설 — "구조화는 데이터만, 판단은 자연어로" 원칙 리팩토링
# (K-Compose v2.0/K-Execute v1.4/K-Deliver v1.6). project_states
# 컬렉션에 execution_plan·progress_note·results_summary(전부 text)
# 필드를 추가한다. 기존 remaining_steps·results_so_far(json) 컬럼은
# 더 이상 안 쓰지만 지우지 않는다(데이터 유실 방지 — 이미 저장된
# 레코드가 있을 수 있음). worker.js는 이제 새 필드만 읽고 쓴다.
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
    $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/project_states" -Headers $headers -ErrorAction Stop
} catch {
    Write-Host "❌ project_states 컬렉션이 없습니다 — 먼저 create-project-states-collection.ps1을 실행하세요."
    exit 1
}

$newFieldNames = @('execution_plan', 'progress_note', 'results_summary')
$existingNames = $existing.schema | ForEach-Object { $_.name }
$toAdd = $newFieldNames | Where-Object { $_ -notin $existingNames }

if ($toAdd.Count -eq 0) {
    Write-Host "필요한 필드가 이미 다 있습니다 — 건너뜁니다."
    exit 0
}

$idMap = @{ execution_plan = 'pst0000000011'; progress_note = 'pst0000000012'; results_summary = 'pst0000000013' }
$addedFields = $toAdd | ForEach-Object {
    @{ system=$false; id=$idMap[$_]; name=$_; type='text'; required=$false; presentable=$false; unique=$false
       options=@{ min=$null; max=$null; pattern='' } }
}
$newSchema = $existing.schema + $addedFields
$body = @{ schema = $newSchema } | ConvertTo-Json -Depth 10

try {
    Invoke-RestMethod -Method PATCH -Uri "$base/api/collections/project_states" -Headers $headers -ContentType "application/json" -Body $body -ErrorAction Stop | Out-Null
    Write-Host "✅ 필드 추가 완료: $($toAdd -join ', ')"
} catch {
    Write-Host "❌ 필드 추가 실패:"
    Write-Host $_.ErrorDetails.Message
    exit 1
}

$verify = Invoke-RestMethod -Method GET -Uri "$base/api/collections/project_states" -Headers $headers -ErrorAction Stop
Write-Host "확인됨 — 필드 수: $($verify.schema.Count)"
