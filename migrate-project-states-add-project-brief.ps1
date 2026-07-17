# migrate-project-states-add-project-brief.ps1
# 2026-07-17 신설 — 사고실험(학원 실태조사 시나리오 추적) 결함 1 수정:
# project_states 컬렉션이 이미 create-project-states-collection.ps1로
# 생성된 뒤라 project_brief 필드가 빠진 채 배포됐다. 이 스크립트는
# 기존 컬렉션에 해당 필드만 추가한다(PocketBase collection PATCH —
# 컬렉션을 지우고 새로 만들지 않는다, 이미 저장된 레코드가 있으면
# 보존됨).
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

$hasField = $existing.schema | Where-Object { $_.name -eq 'project_brief' }
if ($hasField) {
    Write-Host "project_brief 필드가 이미 있습니다 — 건너뜁니다."
    exit 0
}

$newSchema = $existing.schema + @{
    system=$false; id="pst0000000010"; name="project_brief"
    type="text"; required=$false; presentable=$false; unique=$false
    options=@{ min=$null; max=$null; pattern="" }
}
$body = @{ schema = $newSchema } | ConvertTo-Json -Depth 10

try {
    Invoke-RestMethod -Method PATCH -Uri "$base/api/collections/project_states" -Headers $headers -ContentType "application/json" -Body $body -ErrorAction Stop | Out-Null
    Write-Host "✅ project_brief 필드 추가 완료."
} catch {
    Write-Host "❌ 필드 추가 실패:"
    Write-Host $_.ErrorDetails.Message
    exit 1
}

$verify = Invoke-RestMethod -Method GET -Uri "$base/api/collections/project_states" -Headers $headers -ErrorAction Stop
Write-Host "확인됨 — 필드 수: $($verify.schema.Count)"
