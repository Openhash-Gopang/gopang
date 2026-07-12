# verify_routing_live.ps1
# 1000건 사고실험 — AGENT-COMMON의 실제 LLM 라우팅 판단을 hondi-proxy에
# 직접 물어봐서 검증합니다.
#
# 실행 위치: gopang 저장소 루트(prompts\AGENT-COMMON_v3_40.txt가 있는 곳)
# 실행: powershell -ExecutionPolicy Bypass -File verify_routing_live.ps1

$ErrorActionPreference = "Stop"

# 콘솔 출력 인코딩을 UTF-8로 고정(안 하면 한글이 다시 깨져 보일 수 있음)
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$spPath = "prompts\AGENT-COMMON_v3_40.txt"
if (-not (Test-Path $spPath)) {
    Write-Host "오류: $spPath 를 못 찾았습니다. gopang 저장소 루트에서 실행해주세요." -ForegroundColor Red
    exit 1
}
$systemPrompt = Get-Content $spPath -Raw -Encoding UTF8
$systemPrompt = $systemPrompt.TrimStart([char]0xFEFF)

$endpoint = "https://hondi-proxy.tensor-city.workers.dev/chat/completions"

$scenarios = @(
    @{ num = 175; text = "펫시터 구해줘";           expect = "kcommerce (K-Market 경유 예상)" },
    @{ num = 180; text = "반려동물 등록 신청해줘";   expect = "kgov/public (K-Public 예상)" },
    @{ num = 174; text = "동물병원 예방접종 예약해줘"; expect = "kcommerce (예약형 서비스, K-Market 예상)" },
    @{ num = 181; text = "펫보험 가입해줘";          expect = "kinsurance (K-Insurance 예상)" },
    @{ num = 173; text = "강아지 미용 예약해줘";      expect = "kcommerce (예약형 서비스, K-Market 예상)" },
    @{ num = 176; text = "반려동물 호텔 예약해줘";    expect = "kcommerce (예약형 서비스, K-Market 예상)" },
    @{ num = 182; text = "애견카페 예약해줘";        expect = "kcommerce (예약형 서비스, K-Market 예상)" }
)

Add-Type -AssemblyName System.Web.Extensions
$serializer = New-Object System.Web.Script.Serialization.JavaScriptSerializer
$serializer.MaxJsonLength = 100 * 1024 * 1024

function New-JsonBody($sys, $usr) {
    $obj = @{
        model      = "hondi-flash"
        messages   = @(
            @{ role = "system"; content = $sys },
            @{ role = "user";   content = $usr }
        )
        stream     = $false
        max_tokens = 500
    }
    return $serializer.Serialize($obj)
}

# ── HttpWebRequest로 직접 호출 — 응답 바이트를 명시적으로 UTF-8로 디코딩
# (Invoke-RestMethod/Invoke-WebRequest가 Windows PowerShell 5.1에서 서버가
# 보낸 charset을 무시하고 기본 ANSI 코드페이지로 읽어버리는 알려진 문제 회피)
function Invoke-HondiChat($sys, $usr) {
    $bodyStr = New-JsonBody $sys $usr
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyStr)

    $req = [System.Net.HttpWebRequest]::Create($endpoint)
    $req.Method = "POST"
    $req.ContentType = "application/json; charset=utf-8"
    $req.Headers.Add("Origin", "https://hondi.net")
    $req.ContentLength = $bodyBytes.Length
    # Cloudflare가 gzip/br로 압축해서 응답할 수 있는데 HttpWebRequest는
    # 기본적으로 자동 압축해제를 안 한다 — 압축된 바이트를 그대로 UTF-8로
    # 읽으려 하면 깨진다(지난 실행에서 실제로 발생한 증상과 일치).
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate

    $reqStream = $req.GetRequestStream()
    $reqStream.Write($bodyBytes, 0, $bodyBytes.Length)
    $reqStream.Close()

    try {
        $resp = $req.GetResponse()
    } catch [System.Net.WebException] {
        $resp = $_.Exception.Response
        if ($resp) {
            $errStream = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
            $errBody = $errStream.ReadToEnd()
            throw "HTTP $([int]$resp.StatusCode): $errBody"
        }
        throw
    }

    $respStream = New-Object System.IO.StreamReader($resp.GetResponseStream(), [System.Text.Encoding]::UTF8)
    $respBody = $respStream.ReadToEnd()
    $resp.Close()

    $parsed = $serializer.DeserializeObject($respBody)
    return $parsed['choices'][0]['message']['content']
}

foreach ($sc in $scenarios) {
    Write-Host "`n=========================================="
    Write-Host "#$($sc.num): $($sc.text)"
    Write-Host "예상: $($sc.expect)"
    Write-Host "=========================================="

    try {
        $reply = Invoke-HondiChat $systemPrompt $sc.text
        Write-Host "`n--- 모델 응답(앞부분) ---"
        Write-Host ($reply.Substring(0, [Math]::Min(400, $reply.Length)))

        if ($reply -match '\[GWP:\s*([\w-]+)\]') {
            Write-Host "`n>>> 실제 라우팅 태그: [GWP: $($matches[1])]" -ForegroundColor Green
        } elseif ($reply -match '\[SEARCH') {
            Write-Host "`n>>> [SEARCH] 태그 감지 (AC 자체 검색 경로)" -ForegroundColor Yellow
        } elseif ($reply -match '\[EXPERT') {
            Write-Host "`n>>> [EXPERT] 태그 감지" -ForegroundColor Yellow
        } else {
            Write-Host "`n>>> 라우팅 태그 없음 — AC가 직접 응답(R4)한 것으로 보임" -ForegroundColor Cyan
        }
    } catch {
        Write-Host "오류: $($_.Exception.Message)" -ForegroundColor Red
    }

    Start-Sleep -Seconds 2
}

Write-Host "`n완료 — 위 결과를 그대로 복사해서 Claude에게 붙여넣어주세요."
