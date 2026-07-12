# apply-pb-migrations-rest.ps1
# ------------------------------------------------------------------
# pb_migrations/1784100001_added_claim_status.js
# pb_migrations/1784200001_created_dept_tasks.js
# 이 두 파일은 PocketBase 실행파일이 서버에서 직접 읽어야 적용되는데,
# SSH 접근이 없는 상태라 대신 PocketBase Admin REST API로 같은 결과를
# 만듭니다 — get-admin-token.ps1과 같은 방식(admins/auth-with-password)
# 으로 로그인한 뒤, Collections API로 (1) profiles 컬렉션에 필드 2개
# 추가, (2) dept_tasks 컬렉션 신규 생성을 직접 호출합니다.
#
# 실행 후에는 pb_migrations 폴더의 파일 자체는 여전히 "적용 안 됨"
# 상태로 남습니다(PocketBase 입장에서는 CLI로 migrate up을 실행한 적이
# 없으니까) — 나중에 SSH 접근이 생기면 그때 `_migrations` 시스템
# 테이블에 이 두 마이그레이션을 "이미 적용됨"으로 표시해 둬야 CLI가
# 같은 필드를 또 만들려다 충돌하지 않습니다(아래 마지막 안내 참고).
# ------------------------------------------------------------------

$base = "https://l1-hanlim.hondi.net"

$email    = Read-Host "PocketBase admin email"
$password = Read-Host "PocketBase admin password" -AsSecureString
$plainPw  = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
              [Runtime.InteropServices.Marshal]::SecureStringToBSTR($password))

Write-Host "로그인 중..."
$authBody = @{ identity = $email; password = $plainPw } | ConvertTo-Json
$authRes  = Invoke-RestMethod -Method POST -Uri "$base/api/admins/auth-with-password" `
              -ContentType "application/json" -Body $authBody
$token = $authRes.token
if (-not $token) { Write-Host "로그인 실패 — 토큰을 못 받았습니다."; exit 1 }
Write-Host "로그인 성공."

$headers = @{ Authorization = $token }

# ── 1) profiles 컬렉션에 claim_status / claim_source 필드 추가 ──────
Write-Host "`n[1/2] profiles 컬렉션 조회 중..."
$profiles = Invoke-RestMethod -Method GET -Uri "$base/api/collections/1fjkz4szfer124h" -Headers $headers

$claimStatusField = @{
  system = $false; id = "clm_status01"; name = "claim_status"
  type = "select"; required = $false; presentable = $true; unique = $false
  options = @{ maxSelect = 1; values = @("claimed", "unclaimed") }
}
$claimSourceField = @{
  system = $false; id = "clm_source01"; name = "claim_source"
  type = "text"; required = $false; presentable = $false; unique = $false
  options = @{ min = $null; max = $null; pattern = "" }
}

$alreadyHasStatus = $profiles.schema | Where-Object { $_.name -eq "claim_status" }
if ($alreadyHasStatus) {
    Write-Host "claim_status 필드가 이미 있습니다 — 건너뜁니다."
} else {
    $newSchema = @($profiles.schema) + $claimStatusField + $claimSourceField
    $patchBody = @{ schema = $newSchema } | ConvertTo-Json -Depth 10
    Invoke-RestMethod -Method PATCH -Uri "$base/api/collections/1fjkz4szfer124h" `
        -Headers $headers -ContentType "application/json" -Body $patchBody | Out-Null
    Write-Host "claim_status / claim_source 필드 추가 완료."
}

# ── 2) dept_tasks 컬렉션 신규 생성 ──────────────────────────────────
Write-Host "`n[2/2] dept_tasks 컬렉션 생성 중..."
$existing = $null
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/dept_tasks" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "dept_tasks 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    $deptTasksBody = @{
        id = "dtq7f2k9m3xh010"
        name = "dept_tasks"
        type = "base"
        schema = @(
            @{ system=$false; id="dtf001requester_type"; name="requester_type"; type="select"; required=$true; presentable=$true; unique=$false; options=@{ maxSelect=1; values=@("dept","org","business","citizen") } }
            @{ system=$false; id="dtf002requester_id"; name="requester_id"; type="text"; required=$true; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="dtf003requester_label"; name="requester_label"; type="text"; required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="dtf004target_type"; name="target_type"; type="select"; required=$true; presentable=$true; unique=$false; options=@{ maxSelect=1; values=@("dept","org","business","national","k-service") } }
            @{ system=$false; id="dtf005target_id"; name="target_id"; type="text"; required=$true; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="dtf006task_type"; name="task_type"; type="text"; required=$true; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="dtf007directive"; name="directive"; type="text"; required=$true; presentable=$false; unique=$false; options=@{ min=$null; max=2000; pattern="" } }
            @{ system=$false; id="dtf008payload"; name="payload"; type="json"; required=$false; presentable=$false; unique=$false; options=@{ maxSize=2000000 } }
            @{ system=$false; id="dtf009status"; name="status"; type="select"; required=$true; presentable=$true; unique=$false; options=@{ maxSelect=1; values=@("requested","acknowledged","in_progress","completed","rejected") } }
            @{ system=$false; id="dtf010origin_chain"; name="origin_chain"; type="json"; required=$false; presentable=$false; unique=$false; options=@{ maxSize=2000000 } }
            @{ system=$false; id="dtf011result_note"; name="result_note"; type="text"; required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=2000; pattern="" } }
        )
        indexes = @(
            "CREATE INDEX idx_dept_tasks_target ON dept_tasks (target_id)"
            "CREATE INDEX idx_dept_tasks_requester ON dept_tasks (requester_id)"
            "CREATE INDEX idx_dept_tasks_status ON dept_tasks (status)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    Invoke-RestMethod -Method POST -Uri "$base/api/collections" `
        -Headers $headers -ContentType "application/json" -Body $deptTasksBody | Out-Null
    Write-Host "dept_tasks 컬렉션 생성 완료."
}

Write-Host "`n완료. 확인: $base/_/  (관리자 대시보드에서 profiles.claim_status, dept_tasks 컬렉션 육안 확인 권장)"
