# 고팡 (Gopang) 개발 매뉴얼 v5.0

> 작성: AI City Inc. · 도영민 | 최종 갱신: 2026-05-28

---

## § 1. 프로젝트 개요

고팡은 제주도 기반 AI 통합 커뮤니케이션·서비스 포털입니다.
사용자의 말 한마디로 적합한 서비스를 자동 호출하고, 결과를 PDV(개인 데이터 금고)에 기록합니다.

### 핵심 원칙
- **의도 파악 우선**: 사용자 입력에서 진짜 의도를 파악하여 서비스를 호출
- **PDV 6하 원칙**: 모든 활동을 누가/언제/어디서/무엇을/어떻게/왜 형식으로 기록
- **K-Law 상시 감시**: 모든 대화에서 법적 리스크를 백그라운드에서 자동 감지

---

## § 2. 저장소 구조

| 저장소 | URL | 역할 |
|---|---|---|
| gopang_v2 | github.com/Openhash-Gopang/gopang_v2 | 고팡 포털 (gopang.net) |
| fiil | github.com/nounweb/fiil | K-Cleaner 서비스 (fiil.kr) |

---

## § 3. 파일 구조 (gopang_v2)

```
gopang_v2/
├── index.html              ← 앱 진입점 (v4.0)
├── config.js               ← 전역 상수·API키·GWP 레지스트리 ⚠️ .gitignore
├── gwp-sdk.js              ← GWP 클라이언트 SDK v1.1
├── sw.js                   ← Service Worker
│
├── js/
│   ├── core/
│   │   ├── auth.js         ← 사용자 식별·Supabase upsert
│   │   └── location.js     ← GPS·역지오코딩(Worker)·날씨
│   ├── services/
│   │   ├── ai.js           ← callAI·도메인 감지·전문가 SP 로딩
│   │   ├── gwp.js          ← GWP 새탭 실행·BroadcastChannel
│   │   ├── klaw.js         ← K-Law 백그라운드 법적 리스크 감시
│   │   ├── pdv.js          ← PDV 6하 원칙 기록
│   │   ├── registry.js     ← 서비스 자기 등록 레지스트리
│   │   └── storage.js      ← Supabase Storage 사진 업로드
│   └── fiil/
│       └── reporter.js     ← fiil 신고서 생성·전송
│
├── services/
│   ├── fiil-kcleaner/manifest.json  ← K-Cleaner 서비스 등록 정보
│   └── klaw/manifest.json           ← K-Law 서비스 등록 정보
│
├── klaw/prompts/
│   ├── system_prompt.txt   ← K-Law v15.1 (판결 예측)
│   └── monitor_prompt.txt  ← K-Law 감시용 경량 프롬프트
│
├── prompts/
│   ├── SP-00-ROUTER.txt    ← 고팡 1단계 라우터
│   ├── SP-00_v9.0.txt      ← 고팡 AI 비서 시스템 프롬프트
│   ├── SP-14_kcleaner_v1.2.txt      ← K-Cleaner 텍스트 분석
│   └── SP-14-IMG_kcleaner_vision_prompt_v1.0.txt ← K-Cleaner 이미지 분석
│
└── tools/
    ├── serve.py            ← 로컬 테스트 서버 (포트 8000)
    └── worker.js           ← Cloudflare Worker 소스
```

---

## § 4. 서비스 분류 체계

```
고팡 (1단계 — 14개 대분류)
├── ECO  금융·경제
├── MED  의료·보건      → K-Health (예정)
├── EDU  교육·연구
├── TRN  교통·물류
├── MKT  시장·거래
├── GOV  정부행정
├── JUS  사법·법률      → K-Law ✅
├── IND  산업·생산
├── ENV  환경·자원      → K-Cleaner (fiil.kr) ✅
├── CUL  문화·여가
├── SOC  사회·복지
├── IOT  IoT·사물
├── INT  국제·외교
└── MED  미디어·통신
```

각 대분류 서비스가 중분류, 소분류로 이어지는 3단계 계층 구조.

---

## § 5. GWP (Gopang Widget Portal) 아키텍처

### v2.0 — 새 탭 + BroadcastChannel 방식

```
사용자 입력 (텍스트 + 사진)
    ↓
고팡 → Supabase Storage에 사진 업로드 → public URL 획득
    ↓
window.open(서비스URL?gwp=1&photo_url=...&desc=...&gps_addr=...)
    ↓
서비스 새 탭에서 자동 처리 (사진 fetch → AI 분석 → 신고 제출)
    ↓
BroadcastChannel('gopang_gwp') → GWP_DONE 메시지
    ↓
고팡 수신 → PDV 기록 → 완료 메시지
```

### 서비스 등록 방법

1. `services/{id}/manifest.json` 파일 배포
2. `config.js`의 `GWP_REGISTRY`에 항목 추가
3. 서비스 webapp에 `gwp-sdk.js` 로드

### manifest.json 표준 스펙

```json
{
  "id":          "서비스ID",
  "name":        "서비스명",
  "icon":        "🌊",
  "version":     "1.0.0",
  "url":         "https://서비스URL",
  "category":    "ENV",
  "sp_path":     "prompts/SP-xx.txt",
  "triggers":    ["키워드1", "키워드2"],
  "description": "서비스 설명"
}
```

### URL 파라미터 (고팡 → 서비스)

| 파라미터 | 설명 |
|---|---|
| `gwp=1` | GWP 모드 활성화 |
| `token` | 사용자 GUID |
| `origin` | 고팡 origin |
| `ctx` | 사용자 입력 텍스트 |
| `gps_addr` | GPS 좌표 + 행정 지명 |
| `photo_url` | Supabase Storage 사진 URL |
| `desc` | 요청사항 텍스트 |

---

## § 6. Cloudflare Worker (gopang-proxy)

URL: `https://gopang-proxy.tensor-city.workers.dev`

| 엔드포인트 | 메서드 | 역할 |
|---|---|---|
| `/deepseek` | POST | DeepSeek API 프록시 |
| `/geocode?lat=&lng=` | GET | 카카오 역지오코딩 프록시 |
| `/gemini/*` | POST | GPT-4o mini Vision 프록시 |

환경변수 (Cloudflare Dashboard → Settings):
- `DEEPSEEK_API_KEY`
- `KAKAO_REST_KEY`
- `OpenAI` (GPT-4o mini)

---

## § 7. Supabase 테이블

| 테이블 | 역할 |
|---|---|
| `users` | 사용자 식별 (guid, device_fp, phone) |
| `pdv_log` | PDV 6하 원칙 기록 (12컬럼) |
| `reports` | fiil.kr 신고서 |

### pdv_log 6하 원칙 컬럼

| 컬럼 | 6하 | 설명 |
|---|---|---|
| `user_guid`, `who_name` | 누가 | GUID + 마스킹 전화번호 |
| `created_at` | 언제 | 자동 타임스탬프 |
| `location` | 어디서 | GPS 좌표 또는 행정 지명 |
| `summary`, `payload` | 무엇을 | 요약 + 전체 JSON |
| `how`, `record_type` | 어떻게 | image/text/auto |
| `why`, `service_id` | 왜 | 서비스 이용 목적 |

### Supabase Storage

버킷: `gopang-photos` (public)
- 경로: `{user_guid}/{timestamp}.jpg`
- 용도: 고팡에서 사진 업로드 후 서비스에 URL 전달

---

## § 8. K-Law 이중 역할

| 역할 | 방식 | 프롬프트 |
|---|---|---|
| **백그라운드 감시** | 모든 대화 자동 분석, 30초 쿨다운 | `monitor_prompt.txt` |
| **판결 예측 서비스** | 사용자 명시적 요청, GWP 위젯 | `system_prompt.txt` (v15.1) |

---

## § 9. 로컬 개발 환경

```powershell
# 터미널 1 — 고팡
cd C:\Users\주피터\Downloads\gopang_v2
python tools\serve.py 8000

# 터미널 2 — fiil.kr
cd C:\Users\주피터\Downloads\fiil
python -m http.server 8001
```

브라우저: `http://localhost:8000`

### config.js 개발/운영 분기

```javascript
// 개발 시 fiil.kr 로컬 서버 사용
url: location.hostname === 'localhost'
  ? 'http://localhost:8001/webapp.html'
  : 'https://fiil.kr/webapp.html'
```

---

## § 10. 테스트 결과 (v4.0)

| 테스트 | 결과 | 비고 |
|---|---|---|
| T-01 사용자 로그인 | ✅ | UUID + GPS + 역지오코딩 정상 |
| T-02 GWP fiil.kr 호출 | ✅ | 새 탭 방식, 사진/GPS/메시지 전달 |
| T-03 Supabase PDV 기록 | ✅ | 6하 원칙 12컬럼 저장 |
| T-04 관리자 로그인 | 🔲 | 미구현 (다음 스프린트) |

---

## § 11. 배포

```powershell
# gopang_v2
git add . && git add -u
git commit -m "feat: 변경사항"
git push origin main

# fiil
git add . && git add -u
git commit -m "feat: 변경사항"
git push origin main
```

⚠️ `config.js`는 `.gitignore`에 추가되어 있어 push되지 않습니다.
운영 서버에는 별도로 배포해야 합니다.

---

## § 12. 향후 로드맵

- [ ] 관리자 인증 (Supabase Auth)
- [ ] K-Law 판결 예측 GWP 위젯
- [ ] K-Health 서비스 추가
- [ ] Gemini 코드 제거 (OpenAI로 통일)
- [ ] 고팡 SP-00 1단계 라우터 고도화
