# create-gov-task-collection.ps1
# PocketBase L1(l1-hanlim.hondi.net)에 gov_task_schema_drafts 컬렉션을
# API로 생성한다. 이메일/비밀번호는 이 스크립트 실행 시 그 자리에서
# 입력받는다(스크립트 파일이나 채팅에 평문으로 남기지 않기 위함).

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$L1_BASE = "https://l1-hanlim.hondi.net"

# ── 자격증명 입력 (화면에 비밀번호 안 보임) ──────────────────────
$adminEmail = Read-Host "PocketBase 관리자 이메일"
$securePw   = Read-Host "PocketBase 관리자 비밀번호" -AsSecureString
$bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePw)
$adminPw = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($bstr)
[System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)

# ── 1) 관리자 인증 (PocketBase v0.22.x 기준 — /api/admins/auth-with-password) ──
Write-Host "`n관리자 인증 중..."
try {
  $authBody = @{ identity = $adminEmail; password = $adminPw } | ConvertTo-Json
  $authRes = Invoke-RestMethod -Uri "$L1_BASE/api/admins/auth-with-password" `
    -Method Post -Body $authBody -ContentType "application/json"
  $token = $authRes.token
  if (-not $token) { throw "토큰을 받지 못했습니다." }
  Write-Host "✅ 인증 성공"
} catch {
  Write-Error "❌ 인증 실패: $($_.Exception.Message)"
  Write-Host "PocketBase 버전이 v0.23 이상이면 엔드포인트가 다릅니다:"
  Write-Host "  /api/collections/_superusers/auth-with-password"
  Write-Host "버전 확인: $L1_BASE/api/health 또는 Admin UI 좌측 하단"
  exit 1
}
# 비밀번호 변수는 더 이상 필요 없으니 즉시 비움
$adminPw = $null

$headers = @{ Authorization = "Bearer $token" }

# ── 2) 이미 있는지 먼저 확인(중복 생성 방지) ─────────────────────
Write-Host "`n기존 컬렉션 확인 중..."
$exists = $false
try {
  $check = Invoke-RestMethod -Uri "$L1_BASE/api/collections/gov_task_schema_drafts" -Headers $headers -Method Get
  if ($check.id) { $exists = $true }
} catch {
  # 404면 정상(아직 없음) — 그 외 에러는 그대로 노출
  if ($_.Exception.Response.StatusCode.value__ -ne 404) {
    Write-Warning "확인 중 예상 밖 응답: $($_.Exception.Message)"
  }
}

if ($exists) {
  Write-Host "ℹ️  gov_task_schema_drafts 컬렉션이 이미 존재합니다 — 생성을 건너뜁니다."
} else {
  # ── 3) 컬렉션 생성 ──────────────────────────────────────────
  Write-Host "`ngov_task_schema_drafts 컬렉션 생성 중..."
  $schema = @{
    name = "gov_task_schema_drafts"
    type = "base"
    schema = @(
      @{ name = "agency";          type = "text";   required = $true;  options = @{ max = 100 } }
      @{ name = "task_key";        type = "text";   required = $true;  options = @{ max = 200 } }
      @{ name = "schema_json";     type = "text";   required = $true;  options = @{ max = 20000 } }
      @{ name = "source_urls";     type = "text";   required = $false; options = @{ max = 20000 } }
      @{ name = "status";          type = "select"; required = $true;  options = @{ maxSelect = 1; values = @("pending","active","rejected") } }
      @{ name = "created_by_guid"; type = "text";   required = $true;  options = @{ max = 200 } }
      @{ name = "reviewed_by";     type = "text";   required = $false; options = @{ max = 200 } }
      @{ name = "reviewed_at";     type = "date";   required = $false; options = @{} }
    )
    indexes = @(
      "CREATE INDEX idx_gov_task_lookup ON gov_task_schema_drafts (agency, task_key, status)"
    )
    # 규칙 비워둠 = 지금은 아무나 접근 가능(서버가 서비스키로만 호출하는 전제).
    # 나중에 pdv_records/pending_agents 등 기존 컬렉션 규칙에 맞춰 잠글 것.
    listRule = $null
    viewRule = $null
    createRule = $null
    updateRule = $null
    deleteRule = $null
  } | ConvertTo-Json -Depth 10

  try {
    $createRes = Invoke-RestMethod -Uri "$L1_BASE/api/collections" -Headers $headers `
      -Method Post -Body $schema -ContentType "application/json"
    Write-Host "✅ 컬렉션 생성 완료 (id: $($createRes.id))"
  } catch {
    Write-Error "❌ 생성 실패: $($_.Exception.Message)"
    if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
    exit 1
  }
}

# ── 4) 최종 확인 — 필드 목록 출력 ─────────────────────────────────
Write-Host "`n최종 확인:"
$final = Invoke-RestMethod -Uri "$L1_BASE/api/collections/gov_task_schema_drafts" -Headers $headers -Method Get
$final.schema | ForEach-Object { Write-Host "  - $($_.name) ($($_.type), required=$($_.required))" }
Write-Host "`n완료. 이 창을 닫으시면 방금 입력한 비밀번호는 메모리에서 사라집니다."
