# patch-charge-requests-dual-channel.ps1
# ------------------------------------------------------------------
# pb_migrations/1787000001_extended_charge_requests_dual_auto_channel.js
# 의 REST 버전. SSH 접근이 없는 상태라 PocketBase Admin REST API로
# 동일한 결과를 만든다 — create-charge-requests-collection.ps1과 동일 관례.
#
# GDC 충전 자동화(방식A 오픈뱅킹 폴링 / 방식B PG 가상계좌 웹훅)를 위해
# charge_requests에 channel / confirmed_by / external_tx_id /
# virtual_account_no 4개 필드를 추가한다. 기존 필드·데이터는 건드리지
# 않는다(schema.push는 기존 schema 배열에 추가 필드만 append).
#
# 실행 후에도 pb_migrations 폴더의 대응 파일은 "적용 안 됨" 상태로
# 남는다 — 나중에 SSH 접근이 생기면 `_migrations` 시스템 테이블에
# 이 마이그레이션을 "이미 적용됨"으로 표시해 둘 것.
# ------------------------------------------------------------------

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

$collection = Invoke-RestMethod -Method GET -Uri "$base/api/collections/charge_requests" -Headers $headers
$existingNames = $collection.schema | ForEach-Object { $_.name }

$newFields = @(
    @{ system=$false; id="cr0000000011"; name="channel";            type="select"; required=$false; presentable=$true; unique=$false; options=@{ maxSelect=1; values=@("manual_admin","auto_openbanking","auto_pg_webhook") } }
    @{ system=$false; id="cr0000000012"; name="confirmed_by";       type="text";   required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
    @{ system=$false; id="cr0000000013"; name="external_tx_id";     type="text";   required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
    @{ system=$false; id="cr0000000014"; name="virtual_account_no"; type="text";   required=$false; presentable=$true; unique=$false; options=@{ min=$null; max=$null; pattern="" } }
)

$addedCount = 0
foreach ($f in $newFields) {
    if ($existingNames -contains $f.name) {
        Write-Host "필드 '$($f.name)' 이미 존재 — 건너뜁니다." -ForegroundColor Yellow
        continue
    }
    $collection.schema += $f
    $addedCount++
}

if ($addedCount -eq 0) {
    Write-Host "추가할 필드가 없습니다(전부 이미 존재)." -ForegroundColor Yellow
    exit 0
}

# 인덱스 추가(중복 방지 — 이미 있으면 건너뜀)
$idxName = "idx_charge_requests_external_tx_id"
if ($collection.indexes -notmatch $idxName) {
    $collection.indexes += "CREATE UNIQUE INDEX $idxName ON charge_requests (external_tx_id) WHERE external_tx_id IS NOT NULL AND external_tx_id != ''"
}

$patchBody = @{ schema = $collection.schema; indexes = $collection.indexes } | ConvertTo-Json -Depth 10

try {
    Invoke-RestMethod -Method PATCH -Uri "$base/api/collections/charge_requests" -Headers $headers -ContentType "application/json" -Body $patchBody | Out-Null
    Write-Host "charge_requests 스키마 확장 완료 ($addedCount개 필드 추가)." -ForegroundColor Green
} catch {
    Write-Host "패치 실패:" -ForegroundColor Red
    Write-Host $_.ErrorDetails.Message -ForegroundColor Red
    exit 1
}
