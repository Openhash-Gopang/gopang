# verify_30scenarios.ps1
# 신규 상상 시나리오 30건을 hondi-proxy에 실제로 물어봐서 AC의 실제
# 라우팅/처리 방식을 확인합니다. 이전 verify_routing_live.ps1의 교훈
# (HttpWebRequest 직접 사용, gzip 처리, JavaScriptSerializer, UTF-8 BOM)
# 을 전부 반영. 결과는 콘솔 출력 + 파일 저장(verify_30_results.txt) 둘 다.
#
# 실행 위치: gopang 저장소 루트(prompts\AGENT-COMMON_v3_40.txt가 있는 곳)
# 실행: powershell -ExecutionPolicy Bypass -File verify_30scenarios.ps1

$ErrorActionPreference = "Stop"
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
$resultFile = "verify_30_results.txt"
if (Test-Path $resultFile) { Remove-Item $resultFile -Force }

# ── 30개 시나리오 ────────────────────────────────────────────
$scenarios = @(
    "저번에 샀던 그 등산화 사이즈로 하나 더 주문해줘, 색깔은 아무거나.",
    "옆집 아저씨한테 빌린 드릴 반납해야 하는데, 비슷한 거 하나 사서 대신 드려도 될까 고민 중이야.",
    "회사 워크샵 장소를 제주도랑 부산 두 군데 다 알아보고 비교해줘.",
    "다음 주 화요일까지 여권 나와야 하는데 지금 신청하면 가능한지 확인하고, 안 되면 급행 신청해줘.",
    "중고나라에 있던 카메라 판매글, 아직 안 팔렸는지 확인해줘.",
    "이번 달 카드값 중에 구독료만 따로 뽑아서 정리해줘.",
    "엄마 생신 선물로 뭐가 좋을지 추천해주고, 예산 10만원 안에서 골라서 주문까지 해줘.",
    "본가 보일러가 갑자기 안 켜지는데 지금 바로 출동 가능한 업체 찾아줘, 오늘 안에 안 되면 내일 아침 제일 빠른 걸로.",
    "제주도로 이사 가는데, 전입신고랑 인터넷 설치, 이삿짐센터까지 한번에 처리해줘.",
    "요즘 밤에 잠이 안 와서 그런데, 병원 가야 할지 그냥 좀 지켜봐야 할지 모르겠어.",
    "이 번역 앱 구독료가 너무 비싼 것 같은데 더 싼 대안 있으면 바꿔줘.",
    "우리 애 학원 알아보는데 국어·영어·수학 학원 각각 근처에서 찾아서 견적 비교해줘.",
    "저 며칠 전에 여기서 뭘 물어봤었는데 기억이 안 나, 그거 다시 알려줘.",
    "제 명의로 되어 있는 휴면계좌 있는지 전부 확인해줘.",
    "다음 달에 결혼하는데 상견례 장소부터 청첩장, 스드메까지 순서대로 정리해서 하나씩 진행해줘.",
    "이 계약서에 독소조항 있는지 한번 봐줘.",
    "저 지금 사기당한 것 같은데 어떻게 해야 돼?",
    "반려견이 갑자기 토를 하는데 지금 응급실 가야 될까?",
    "이 노래 저작권 안 걸리게 배경음악으로 써도 되는지 확인해줘.",
    "부모님 두 분 다 팔순이신데 한번에 효도여행 패키지로 예약해드리고 싶어.",
    "저 이제 곧 퇴사하는데 실업급여 받을 수 있는 조건인지 확인해줘.",
    "혹시 제 폰 번호가 스팸리스트에 올라가 있는지 확인 가능해?",
    "이번 여름휴가 항공권이랑 숙소랑 렌터카 한번에 예약하되, 예산은 200만원 안으로 맞춰줘.",
    "아이 예방접종 스케줄이랑 학교 방과후 시간표랑 겹치는지 확인해줘.",
    "저희 가게에 손님이 놓고 간 지갑이 있는데 어떻게 처리해야 하는지 알려줘.",
    "저 다음 주에 해외여행 가는데 여행자보험이랑 로밍이랑 환전 한번에 준비해줘.",
    "요즘 물가가 너무 올라서 그런데, 제 지출 패턴 보고 어디서 아낄 수 있는지 조언해줘.",
    "이 아이디어로 특허 낼 수 있는지 먼저 검색부터 해줘.",
    "예전에 산 정수기 필터 교체주기 됐을 텐데 자동으로 알림 오게 설정해줘.",
    "저 오늘 기분이 진짜 안 좋은데 그냥 아무 얘기나 들어줄 수 있어?"
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
        max_tokens = 700
    }
    return $serializer.Serialize($obj)
}

function Invoke-HondiChat($sys, $usr) {
    $bodyStr = New-JsonBody $sys $usr
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($bodyStr)

    $req = [System.Net.HttpWebRequest]::Create($endpoint)
    $req.Method = "POST"
    $req.ContentType = "application/json; charset=utf-8"
    $req.Headers.Add("Origin", "https://hondi.net")
    $req.ContentLength = $bodyBytes.Length
    $req.AutomaticDecompression = [System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate
    $req.Timeout = 60000

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

function Get-RoutingTag($reply) {
    if ($reply -match '\[GWP:\s*([\w-]+)\]') { return "GWP:$($matches[1])" }
    if ($reply -match '\[CALL_(KBANK|KTELECOM|KESTATE):') { return "CALL_$($matches[1])" }
    if ($reply -match '\[KSEARCH_HANDOFF') { return "KSEARCH_HANDOFF" }
    if ($reply -match '\[CALL_KINTENT') { return "CALL_KINTENT(오케스트레이션)" }
    if ($reply -match '\[SP_DRAFT_REQUEST') { return "SP_DRAFT_REQUEST(신규SP필요판단)" }
    if ($reply -match '\[EXPERT:') { return "EXPERT" }
    if ($reply -match '\[SEARCH\]') { return "SEARCH(내부검색)" }
    return "없음(직접응답/R4 추정)"
}

$results = @()
$i = 0
foreach ($sc in $scenarios) {
    $i++
    Write-Host "`n=========================================="
    Write-Host "#$i`: $sc"
    Write-Host "=========================================="

    $entry = "`n==========================================`n#$i`: $sc`n==========================================`n"

    try {
        $reply = Invoke-HondiChat $systemPrompt $sc
        $preview = $reply.Substring(0, [Math]::Min(500, $reply.Length))
        $tag = Get-RoutingTag $reply

        Write-Host "--- 응답(앞부분) ---"
        Write-Host $preview
        Write-Host ">>> 판정: $tag" -ForegroundColor Green

        $entry += "--- 응답 ---`n$preview`n>>> 판정: $tag`n"
    } catch {
        Write-Host "오류: $($_.Exception.Message)" -ForegroundColor Red
        $entry += "오류: $($_.Exception.Message)`n"
    }

    $entry | Out-File -FilePath $resultFile -Append -Encoding utf8
    $results += $entry
    Start-Sleep -Seconds 2
}

Write-Host "`n`n완료 — 전체 결과가 $resultFile 에 저장됐습니다."
Write-Host "이 파일 내용을 통째로 복사해서 Claude에게 붙여넣어주세요."
