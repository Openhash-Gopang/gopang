# create-ai-usage-log-collection.ps1
# ------------------------------------------------------------------
# pb_migrations/1784800001_created_ai_usage_log.js
# 이 마이그레이션 파일은 PocketBase 실행파일이 서버에서 직접 읽어야
# 적용되는데, SSH 접근이 없는 상태라 대신 PocketBase Admin REST API로
# 같은 결과를 만듭니다 — apply-pb-migrations-rest.ps1과 동일한 방식
# (admins/auth-with-password 로그인 → Collections API POST)입니다.
#
# 실행 후에도 pb_migrations 폴더의 파일 자체는 "적용 안 됨" 상태로
# 남습니다 — 나중에 SSH 접근이 생기면 `_migrations` 시스템 테이블에
# 이 마이그레이션을 "이미 적용됨"으로 표시해 둬야 CLI가 같은 컬렉션을
# 또 만들려다 충돌하지 않습니다.
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

# ── ai_usage_log 컬렉션 신규 생성 ───────────────────────────────────
Write-Host "`nai_usage_log 컬렉션 생성 중..."
$existing = $null
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/ai_usage_log" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "ai_usage_log 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    $aiUsageLogBody = @{
        id = "a1u5g3l0g0000n1"
        name = "ai_usage_log"
        type = "base"
        schema = @(
            @{ system=$false; id="aul0000000001"; name="guid";        type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="aul0000000002"; name="service_id";  type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="aul0000000003"; name="tier";        type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="aul0000000004"; name="model";       type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="aul0000000005"; name="hit_tokens";  type="number"; required=$false; presentable=$false; unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="aul0000000006"; name="miss_tokens"; type="number"; required=$false; presentable=$false; unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="aul0000000007"; name="out_tokens";  type="number"; required=$false; presentable=$false; unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="aul0000000008"; name="cost_krw";    type="number"; required=$true;  presentable=$true;  unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="aul0000000009"; name="billed_krw";  type="number"; required=$true;  presentable=$true;  unique=$false; options=@{ min=0; max=$null } }
        )
        indexes = @(
            "CREATE INDEX idx_ai_usage_log_guid ON ai_usage_log (guid)"
            "CREATE INDEX idx_ai_usage_log_guid_created ON ai_usage_log (guid, created)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    Invoke-RestMethod -Method POST -Uri "$base/api/collections" `
        -Headers $headers -ContentType "application/json" -Body $aiUsageLogBody | Out-Null
    Write-Host "ai_usage_log 컬렉션 생성 완료."
}

Write-Host "`n완료. 확인: $base/_/  (관리자 대시보드에서 ai_usage_log 컬렉션 육안 확인 권장)"
