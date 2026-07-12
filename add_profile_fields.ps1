# add_profile_fields.ps1
# L1 PocketBase의 profiles 컬렉션에 검색용 필드 6개를 API로 직접 추가.
# gopang/pb_migrations/1784000001_updated_profiles.js와 동일한 내용을
# 관리자 UI 클릭 대신 API 호출로 적용합니다.

$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

# ── 아래 3개만 채워주세요 ──────────────────────────────────
$pbUrl   = "https://l1-hanlim.gopang.net"   # PocketBase 서버 주소
$email   = "tensor.city@gmail.com".Trim()
$password = "gopang2026".Trim()
# ───────────────────────────────────────────────────────────

# 값을 안 채우고 그대로 실행한 경우 여기서 바로 멈춘다(빈 이메일로
# API를 호출해 애매한 서버 에러를 받는 대신 명확히 알려줌).
if ($email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
    Write-Host "오류: `$email 값이 유효한 이메일 형식이 아닙니다: [$email]" -ForegroundColor Red
    Write-Host "스크립트 상단의 `$email 줄을 실제 관리자 이메일로 바꿔주세요." -ForegroundColor Red
    exit 1
}
if ([string]::IsNullOrWhiteSpace($password) -or $password -eq "여기에_관리자_비밀번호") {
    Write-Host "오류: `$password 값이 비어있거나 플레이스홀더 그대로입니다." -ForegroundColor Red
    exit 1
}
Write-Host "이메일 확인: [$email] (길이 $($email.Length)자)"

$collectionId = "1fjkz4szfer124h"  # profiles 컬렉션 ID

Add-Type -AssemblyName System.Web.Extensions
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = 50 * 1024 * 1024

function Invoke-Pb($method, $path, $bodyObj, $token) {
    $bodyStr = if ($bodyObj) { $serializer.Serialize($bodyObj) } else { $null }
    $bodyBytes = if ($bodyStr) { [System.Text.Encoding]::UTF8.GetBytes($bodyStr) } else { $null }

    $req = [System.Net.HttpWebRequest]::Create("$pbUrl$path")
    $req.Method = $method
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    if ($token) { $req.Headers.Add("Authorization", "Bearer $token") }
    if ($bodyBytes) {
        $req.ContentType = "application/json; charset=utf-8"
        $req.ContentLength = $bodyBytes.Length
        $s = $req.GetRequestStream()
        $s.Write($bodyBytes, 0, $bodyBytes.Length)
        $s.Close()
    }

    try {
        $resp = $req.GetResponse()
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp) {
            $r = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
            $err = $r.ReadToEnd()
            throw "HTTP $([int]$resp.StatusCode): $err"
        }
        throw
    }
    $reader = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $text = $reader.ReadToEnd()
    $resp.Close()
    return $serializer.DeserializeObject($text)
}

Write-Host "1) 관리자 로그인..."
$authBody = @{ identity = $email; password = $password }
Write-Host "   전송 이메일 확인: $email / 비밀번호 길이: $($password.Length)자 (내용은 표시 안 함)"

$token = $null
try {
    $auth = Invoke-Pb "POST" "/api/admins/auth-with-password" $authBody $null
    $token = $auth['token']
} catch {
    Write-Host "   /api/admins/auth-with-password 실패, PocketBase 신버전 경로(superusers)로 재시도..." -ForegroundColor Yellow
    Write-Host "   (1차 오류: $($_.Exception.Message))"
    $auth = Invoke-Pb "POST" "/api/collections/_superusers/auth-with-password" $authBody $null
    $token = $auth['token']
}
Write-Host "   로그인 성공"

Write-Host "2) 현재 profiles 컬렉션 스키마 조회..."
$col = Invoke-Pb "GET" "/api/collections/$collectionId" $null $token
$schema = $col['schema']

$existingNames = $schema | ForEach-Object { $_['name'] }

$newFields = @(
    @{ name = "name";        type = "text";   options = @{} },
    @{ name = "address";     type = "text";   options = @{} },
    @{ name = "lat";         type = "number"; options = @{ min = -90;  max = 90 } },
    @{ name = "lng";         type = "number"; options = @{ min = -180; max = 180 } },
    @{ name = "occupation";  type = "text";   options = @{} },
    @{ name = "search_text"; type = "text";   options = @{} }
)

$added = 0
foreach ($f in $newFields) {
    if ($existingNames -contains $f.name) {
        Write-Host "   [skip] $($f.name) 이미 존재"
        continue
    }
    $schema += @{
        name = $f.name; type = $f.type
        required = $false; presentable = $false; unique = $false
        options = $f.options
    }
    $added++
    Write-Host "   [add] $($f.name)"
}

if ($added -eq 0) {
    Write-Host "`n이미 전부 존재합니다 — 변경 없음."
} else {
    Write-Host "`n3) 컬렉션 저장(PATCH)..."
    Invoke-Pb "PATCH" "/api/collections/$collectionId" @{ schema = $schema } $token | Out-Null
    Write-Host "   완료 — 필드 $added 개 추가됨"
}

Write-Host "`n완료. 이 창을 닫기 전에 위 이메일/비밀번호 변수는 안전하게 지워주세요."
