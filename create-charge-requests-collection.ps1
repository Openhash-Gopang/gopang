# create-charge-requests-collection.ps1
# ------------------------------------------------------------------
# pb_migrations/1785000001_created_charge_requests.js 의 REST 버전.
# SSH 접근이 없는 상태라 PocketBase Admin REST API로 동일한 결과를
# 만든다 — create-ai-usage-log-collection.ps1과 동일 관례.
#
# GDC 충전(계좌입금 인식, "고정계좌 + 입금자명 매칭" 방식) 파이프라인의
# 저장소. 사용자가 POST /biz/charge-request로 신청하면 여기에
# status="pending" 레코드가 생기고, 관리자가 은행 앱에서 입금을 직접
# 확인한 뒤 POST /biz/charge-confirm으로 확정한다.
#
# 실행 후에도 pb_migrations 폴더의 대응 파일은 "적용 안 됨" 상태로
# 남는다 — 나중에 SSH 접근이 생기면 `_migrations` 시스템 테이블에
# 이 마이그레이션을 "이미 적용됨"으로 표시해 둘 것(다른 create-*.ps1
# 파일들과 동일한 주의사항).
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

Write-Host "`ncharge_requests 컬렉션 생성 중..."
$existing = $null
try { $existing = Invoke-RestMethod -Method GET -Uri "$base/api/collections/charge_requests" -Headers $headers -ErrorAction Stop } catch {}
if ($existing) {
    Write-Host "charge_requests 컬렉션이 이미 있습니다 — 건너뜁니다."
} else {
    $chargeRequestsBody = @{
        id = "chrg0000000001"
        name = "charge_requests"
        type = "base"
        schema = @(
            @{ system=$false; id="cr00000000001"; name="guid";              type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="cr00000000002"; name="match_code";        type="text";   required=$true;  presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="cr00000000003"; name="requested_krw";     type="number"; required=$true;  presentable=$true;  unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="cr00000000004"; name="status";           type="select"; required=$true;  presentable=$true;  unique=$false; options=@{ maxSelect=1; values=@("pending","matched","cancelled","expired") } }
            @{ system=$false; id="cr00000000005"; name="matched_krw";      type="number"; required=$false; presentable=$true;  unique=$false; options=@{ min=0; max=$null } }
            @{ system=$false; id="cr00000000006"; name="depositor_name";   type="text";   required=$false; presentable=$true;  unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="cr00000000007"; name="mint_content_hash"; type="text";  required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="cr00000000008"; name="memo";             type="text";   required=$false; presentable=$false; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
            @{ system=$false; id="cr00000000009"; name="matched_at";       type="date";   required=$false; presentable=$true;  unique=$false; options=@{ min=""; max="" } }
            @{ system=$false; id="cr00000000010"; name="expires_at";       type="date";   required=$true;  presentable=$false; unique=$false; options=@{ min=""; max="" } }
        )
        indexes = @(
            "CREATE INDEX idx_charge_requests_guid ON charge_requests (guid)"
            "CREATE INDEX idx_charge_requests_status ON charge_requests (status)"
            "CREATE INDEX idx_charge_requests_match_code ON charge_requests (match_code)"
        )
        listRule = $null; viewRule = $null; createRule = $null; updateRule = $null; deleteRule = $null
    } | ConvertTo-Json -Depth 10

    Invoke-RestMethod -Method POST -Uri "$base/api/collections" `
        -Headers $headers -ContentType "application/json" -Body $chargeRequestsBody | Out-Null
    Write-Host "charge_requests 컬렉션 생성 완료."
}

Write-Host "`n완료. 확인: $base/_/  (관리자 대시보드에서 charge_requests 컬렉션 육안 확인 권장)"
