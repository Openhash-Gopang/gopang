# 고팡(Gopang) 운영 매뉴얼

**버전:** v4.0 | **최종 수정:** 2026-05-27 | **작성:** AI City Inc.

---

## 목차

1. [시스템 구조](#1-시스템-구조)
2. [서비스 분류 체계](#2-서비스-분류-체계)
3. [GWP — 고팡 위젯 프로토콜](#3-gwp--고팡-위젯-프로토콜)
4. [K-Law 감시 레이어](#4-k-law-감시-레이어)
5. [빌드 및 배포 절차](#5-빌드-및-배포-절차)
6. [알려진 오류 및 즉시 해결법](#6-알려진-오류-및-즉시-해결법)
7. [프롬프트 구조](#7-프롬프트-구조)
8. [PDV (Private Data Vault)](#8-pdv-private-data-vault)
9. [UI 구조 및 기능](#9-ui-구조-및-기능)
10. [버전 히스토리](#10-버전-히스토리)
11. [서비스 정보](#11-서비스-정보)

---

## 1. 시스템 구조

### 1-1. 디렉토리 구조

```
gopang_v2/
│
├── index.html                    ← 배포 파일 (build.py 산출물)
├── gwp-sdk.js                    ← GWP SDK (서비스 개발자용)
├── build.py                      ← 빌드 스크립트
├── sw.js                         ← Service Worker (PWA 캐시)
├── CNAME                         ← gopang.net 도메인 연결
├── manifest.json                 ← PWA 설정
├── favicon.ico / icon-*.png      ← 앱 아이콘
│
├── src/
│   └── index_template.html       ← HTML/JS 소스 템플릿 (직접 편집)
│
├── klaw/
│   └── prompts/
│       ├── system_prompt.txt     ← K-Law v15.1 판결 예측 프롬프트
│       └── monitor_prompt.txt    ← K-Law 백그라운드 감시 프롬프트
│
├── prompts/
│   ├── SP-00_v9.0.txt            ← 고팡 AI 비서 메인 프롬프트
│   ├── SP-00-ROUTER.txt          ← 고팡 1단계 서비스 라우팅 프롬프트
│   ├── SP-14-IMG_v1.0.txt        ← K-Cleaner 이미지 분석
│   └── SP-14_v1.2.txt            ← K-Cleaner 텍스트 분석
│
├── docs/                         ← 문서, 백서, 매뉴얼
└── tools/
    ├── serve.py                  ← 로컬 개발 서버
    └── worker.js                 ← Cloudflare Worker (별도 배포)
```

### 1-2. 배포 구조

```
로컬 build.py 실행 → index.html 생성
        ↓  git push
GitHub (Openhash-Gopang/gopang_v2)
        ↓  GitHub Pages
gopang.net  (DNS: 185.199.108.153)
```

> ⚠️ 반드시 로컬에서 `python build.py` 실행 후 `index.html`을 push해야 합니다.

### 1-3. 파일별 역할

| 파일 | 역할 | 직접 편집 |
|---|---|---|
| `src/index_template.html` | UI/JS 소스 | ✅ |
| `klaw/prompts/system_prompt.txt` | K-Law v15.1 판결 예측 | ✅ K-Law 업데이트 시 |
| `klaw/prompts/monitor_prompt.txt` | 백그라운드 법적 감시 | ✅ 감시 정책 변경 시 |
| `prompts/SP-00_v9.0.txt` | AI 비서 메인 프롬프트 | ✅ |
| `prompts/SP-00-ROUTER.txt` | **1단계 서비스 라우팅** | ✅ 서비스 추가 시 |
| `gwp-sdk.js` | 서비스 개발자용 SDK | ✅ |
| `build.py` | 빌드 스크립트 | 거의 불필요 |
| `index.html` | 배포 파일 | ❌ build.py 산출물 |
| `CNAME` | 도메인 연결 | ❌ 수정 금지 |

---

## 2. 서비스 분류 체계

고팡은 **3단계 계층 구조**로 서비스를 분류합니다.

### 2-1. 설계 원칙

```
고팡 포털 (대분류 라우팅)
    └── 개별 서비스 (중분류 라우팅)
            └── 서비스 내 하위 기능 (소분류 처리)
```

- **고팡**은 사용자 입력을 받아 어느 서비스를 호출할지 **대분류** 수준에서 결정합니다.
- **개별 서비스**는 고팡으로부터 통제권을 넘겨받아 **중분류** 수준에서 세부 처리를 결정합니다.
- **하위 기능**은 서비스 내부에서 **소분류** 수준의 전문 처리를 수행합니다.

**예시:**
```
"저녁 먹고 배가 아파요"
    ↓ [1단계] 고팡 대분류 라우팅
    → [MED] 의료·보건 서비스 호출
        ↓ [2단계] 서비스 중분류 라우팅
        → 내과 / 소아과 / 응급 판단
            ↓ [3단계] 하위 기능 소분류 처리
            → 증상 분석 → 병원 예약 → 처방 안내
```

### 2-2. 대분류 — 고팡 서비스 카테고리

한국표준산업분류(KSIC) 대분류를 기반으로 고팡 서비스 체계를 구성합니다.

| 코드 | 카테고리 | 설명 | 대표 서비스 |
|---|---|---|---|
| **LEG** | 입법·정책 | 법안, 국회, 규제, 헌법, 정책 | K-Legislature |
| **JUS** | 사법·법률 | 판결 예측, 법률 자문, 분쟁, 계약 | **K-Law** ✅ |
| **GOV** | 행정·민원 | 허가, 신고, 공공서비스, 민원 | K-Gov |
| **MED** | 의료·보건 | 증상, 진단, 처방, 병원 | K-Health |
| **EDU** | 교육·연구 | 학습, 논문, 특허, 자격증 | K-Edu |
| **ECO** | 경제·금융 | 투자, 세금, 대출, 재무 | K-Finance |
| **MKT** | 시장·거래 | 쇼핑, 배달, 예약, 부동산 | K-Commerce |
| **IND** | 산업·제조 | 생산, 수출, 창업, 제조 | K-Industry |
| **ENV** | 환경·자원 | 쓰레기, 오염, 기후, 신고 | **fiil.kr** ✅ |
| **TRN** | 교통·물류 | 교통사고, 항공, 배송, 물류 | K-Transport |
| **CUL** | 문화·여가 | 관광, 예술, 스포츠 | K-Culture |
| **SOC** | 사회·복지 | 복지, 노동, 보험 | K-Social |
| **IOT** | IoT·사물 | 차량, 가전, 스마트홈 | K-IoT |
| **EMG** | 긴급·재난 | 112/119, 화재, 응급 | K-Emergency |

### 2-3. 중분류 예시 — 서비스 내부 라우팅

| 서비스 | 중분류 |
|---|---|
| **K-Law** | 민사 / 형사 / 행정 / 헌법 / 가사 / 노동 / 지식재산 |
| **K-Health** | 내과 / 외과 / 소아과 / 신경과 / 정신건강 / 응급 |
| **fiil.kr** | SP-14 해양쓰레기 / SP-15 생활폐기물 / SP-16 불법투기 / SP-17 응급 / SP-18 도로파손 |

### 2-4. 새 서비스 등록 방법

두 곳을 수정합니다.

**① `index.html` — GWP_REGISTRY에 항목 추가:**
```javascript
{
  id:       'k-health',
  name:     'K-Health',
  icon:     '🏥',
  url:      'https://health.gopang.net/webapp.html',
  triggers: ['병원','증상','처방','의료','아파요','진단'],
}
```

**② `prompts/SP-00-ROUTER.txt` — 카테고리 테이블에 행 추가:**
```
| MED | 의료·보건 | 병원, 증상, 처방, 아파요, 진단, 의사 |
```

---

## 3. GWP — 고팡 위젯 프로토콜

### 3-1. 개요

GWP(Gopang Widget Protocol)는 고팡과 개별 서비스 webapp 사이의 **통신 표준**입니다.

### 3-2. 작동 흐름

```
사용자 입력
    ↓
고팡 — SP-00-ROUTER로 서비스 결정
    ↓
iframe 생성
  src="https://서비스/webapp.html?gwp=1&token=USER_GUID&ctx=컨텍스트"
    ↓
서비스 → GWP_READY (top-bar 타이틀 변경, 입력창 변경)
    ↓
사용자 입력 → 서비스로 전달 (GWP_INPUT)
    ↓
서비스 완료 → GWP_DONE (PDV 기록, top-bar "고팡" 복귀)
```

### 3-3. 메시지 타입

| 방향 | 타입 | 설명 |
|---|---|---|
| 고팡→서비스 | `GWP_INIT` | 사용자 토큰·컨텍스트 전달 |
| 고팡→서비스 | `GWP_INPUT` | 사용자 입력 전달 |
| 서비스→고팡 | `GWP_READY` | 준비 완료, 입력창 설정 |
| 서비스→고팡 | `GWP_MESSAGE` | 채팅창 메시지 출력 요청 |
| 서비스→고팡 | `GWP_INPUT_CTRL` | 입력창 제어 |
| 서비스→고팡 | `GWP_DONE` | 작업 완료, 제어권 반환 |
| 서비스→고팡 | `GWP_ERROR` | 오류 발생 |

### 3-4. SDK 사용법

```html
<script src="https://gopang.net/gwp-sdk.js"></script>
<script>
  const gwp = new GopangWidget({
    onInit({ token, context }) { /* 초기화 */ },
    onInput(text, file)        { /* 입력 처리 */ },
  });
  gwp.ready({ title: '서비스명', placeholder: '입력 안내' });
  gwp.message('처리 결과');
  gwp.done({ summary: '완료', pdvData: { ... } });
</script>
```

---

## 4. K-Law 감시 레이어

### 4-1. 두 가지 역할

| | 역할 1: 백그라운드 감시 | 역할 2: 판결 예측 |
|---|---|---|
| 트리거 | 자동 | 사용자 명시적 요청 |
| 프롬프트 | `monitor_prompt.txt` | `system_prompt.txt` (v15.1) |
| 출력 | 리스크 경고 버블 | 판결 예측 보고서 |
| 위치 | gopang_v2 내장 | 독립 GWP 서비스 |

### 4-2. 리스크 수준

| 수준 | 동작 |
|---|---|
| NONE / LOW / MEDIUM | PDV에만 조용히 기록 |
| HIGH | 🟠 채팅창 경고 즉시 표시 |
| CRITICAL | 🔴 채팅창 경고 즉시 표시 |

---

## 5. 빌드 및 배포 절차

### 5-1. 표준 배포

```powershell
python build.py
git add index.html
git commit -m "feat: 변경 내용"
git push origin main
```

### 5-2. 새 서비스 추가

```powershell
# GWP_REGISTRY + SP-00-ROUTER.txt 수정 후
python build.py
git add index.html prompts/SP-00-ROUTER.txt
git commit -m "feat: 새 서비스 등록"
git push origin main
```

### 5-3. 롤백

```powershell
git reset --hard v태그명
git push origin main --force
```

---

## 6. 알려진 오류 및 즉시 해결법

### 6-1. JSON parse 오류

```powershell
python -c "open('.gitattributes','w',newline='\n').write('* text=auto\n*.html text eol=lf\n*.py text eol=lf\n*.txt text eol=lf\n*.json text eol=lf\n')"
git add .gitattributes && git add --renormalize .
git commit -m "fix: .gitattributes" && git push
python build.py && git add index.html && git commit -m "fix: 재빌드" && git push
```

### 6-2. Service Worker 캐시

```javascript
(async () => {
  const regs = await navigator.serviceWorker.getRegistrations();
  for (const r of regs) await r.unregister();
  const keys = await caches.keys();
  for (const k of keys) await caches.delete(k);
  console.log('완료. F5로 새로고침하세요.');
})();
```

### 6-3. DNS 설정

| 레코드 | 호스트 | 값 |
|---|---|---|
| A | gopang.net | 185.199.108.153 |
| CNAME | www.gopang.net | openhash-gopang.github.io. |

---

## 7. 프롬프트 구조

### 7-1. 라우팅 2단계 구조

```
[1단계] SP-00-ROUTER.txt — 고팡이 처리
  입력: 사용자 텍스트
  출력: { category: "ENV", service_id: "fiil-kcleaner" }
        ↓
[2단계] 서비스 내부 라우터 — 각 서비스가 처리
  예) fiil: SP-14/15/16/17/18 결정
  예) K-Health: 진료과 분류
  예) K-Law: 법률 영역 분류
```

### 7-2. SP 코드 체계

| 코드 범위 | 소속 | 설명 |
|---|---|---|
| SP-00 | 고팡 | AI 비서, 라우터 |
| SP-01~09 | 고팡 내장 | K-Law(01), 긴급(09) |
| SP-14~18 | fiil.kr | 환경 신고 세부 분류 |
| SP-20~29 | K-Health (예정) | 의료 세부 분류 |
| SP-30~39 | K-Finance (예정) | 금융 세부 분류 |

---

## 8. PDV (Private Data Vault)

### 8-1. 기록 구조

```json
{
  "id":       "PDV-20260527-143022-0001",
  "who":      "사용자 → AI비서",
  "when":     "2026-05-27T14:30:22.000Z",
  "what":     "소통 내용 요약",
  "service":  "fiil-kcleaner",
  "risk":     "S0",
  "hash":     "sha256(...)",
  "openhash": "PENDING"
}
```

### 8-2. 기록 시점

| 이벤트 | 기록 내용 |
|---|---|
| 일반 대화 완료 | 대화 요약, 리스크 등급 |
| 서비스 호출 | 서비스명, 요청 시각 |
| GWP_DONE 수신 | 처리 결과 요약 |
| K-Law 리스크 감지 | 리스크 유형·수준·근거 |

---

## 9. UI 구조 및 기능

### 9-1. 화면 구성

```
┌────────────────────────────────────┐
│  고팡  ←(서비스 모드: K-Cleaner)  │ ← top-bar 흰색
│  탭 → 고팡 복귀          🔍 AI ⚙️ │
├────────────────────────────────────┤
│  메시지 목록 / 서비스 iframe       │
├────────────────────────────────────┤
│  📎 📷  [입력창]  🎤  ▶          │ ← 고팡 항상 소유
└────────────────────────────────────┘
```

### 9-2. 서비스 모드 전환

| 상태 | top-bar | 입력창 | 콘텐츠 |
|---|---|---|---|
| 고팡 모드 | "고팡" | "메시지를 입력하세요…" | 채팅 UI |
| 서비스 모드 | "🌊 K-Cleaner" | "사진을 찍어 전송하세요" | 서비스 iframe |

---

## 10. 버전 히스토리

| 버전 | 날짜 | 주요 변경 |
|---|---|---|
| v1.0~v2.8 | 05-20~21 | K-Law 초기 구현, PDV, 멀티 LLM |
| v3.0~v3.4 | 05-21~24 | SP-00, K-Cleaner, fiil.kr 연동 |
| **v4.0** | **05-27** | **GWP, 기기 자동 인식, K-Law 감시, Supabase UI, 3단계 서비스 분류 체계** |

---

## 11. 서비스 정보

| 항목 | 내용 |
|---|---|
| 도메인 | https://gopang.net |
| GitHub | github.com/Openhash-Gopang/gopang_v2 |
| Supabase | ebbecjfrwaswbdybbgiu.supabase.co |
| DeepSeek Proxy | gopang-proxy.tensor-city.workers.dev |
| GWP SDK | https://gopang.net/gwp-sdk.js |
| K-Law 버전 | v15.1 (2026-05-18) |
| 회사 | AI City Inc. · 제주특별자치도 |
