# 고팡(Gopang) 사이트 운영 매뉴얼

**버전:** v3.0 | **최종 수정:** 2026-05-21 | **작성:** AI City Inc.

---

## 목차

1. [시스템 구조](#1-시스템-구조)
2. [빌드 및 배포 절차](#2-빌드-및-배포-절차)
3. [알려진 오류 및 즉시 해결법](#3-알려진-오류-및-즉시-해결법)
4. [build.py 동작 원리](#4-buildpy-동작-원리)
5. [시스템 프롬프트 구조 (SP-00~SP-09)](#5-시스템-프롬프트-구조)
6. [PDV (Private Data Vault)](#6-pdv-private-data-vault)
7. [UI 구조 및 기능](#7-ui-구조-및-기능)
8. [심급 구조 현황](#8-심급-구조-현황)
9. [버전 히스토리](#9-버전-히스토리)
10. [서비스 정보](#10-서비스-정보)

---

## 1. 시스템 구조

### 1-1. 디렉토리 구조

```
C:\Users\주피터\Downloads\gopang_v2\
│
├── index.html                    ← 배포 파일 (build.py가 자동 생성)
├── build.py                      ← 빌드 스크립트 v3
├── CNAME                         ← gopang.net 도메인 연결
├── manifest.json                 ← PWA 설정 (아이콘 포함)
├── icon-192.png                  ← 앱 아이콘 (방패)
├── icon-512.png                  ← 앱 아이콘 (방패, 고해상도)
├── favicon.ico                   ← 브라우저 파비콘
├── .gitattributes                ← CRLF 변환 차단 (수정 금지)
├── DOCS/
│   └── GOPANG_MANUAL.md          ← 이 문서
├── src/
│   └── index_template.html       ← HTML 템플릿 (직접 편집)
└── klaw/
    └── prompts/
        └── system_prompt.txt     ← K-Law v15.1 방법론 (190KB)
```

### 1-2. 배포 구조

```
로컬 build.py 실행 → index.html 생성
        ↓  git push
GitHub (nounweb/gopang_v2)
        ↓  GitHub Pages
gopang.net  (DNS A레코드: 185.199.108.153)
```

> ⚠️ **build.yml 없음** — GitHub Actions 자동 빌드 없음.  
> 반드시 로컬에서 `python build.py` 실행 후 `index.html`을 push해야 합니다.

### 1-3. 파일별 역할

| 파일 | 역할 | 직접 편집 |
|---|---|---|
| `src/index_template.html` | UI/JS 소스 | ✅ 직접 편집 |
| `klaw/prompts/system_prompt.txt` | K-Law v15.1 방법론 | ✅ K-Law 업데이트 시 |
| `build.py` | 템플릿 → index.html 생성 | 거의 편집 불필요 |
| `index.html` | 실제 배포 파일 | ❌ build.py가 생성 |
| `.gitattributes` | CRLF 차단 | ❌ 수정 금지 |
| `CNAME` | 도메인 연결 | ❌ 수정 금지 |
| `manifest.json` | PWA 설정 | 필요 시 수정 |

---

## 2. 빌드 및 배포 절차

### 2-1. 표준 배포 절차

```powershell
cd C:\Users\주피터\Downloads\gopang_v2

# 1. 반드시 로컬 빌드 먼저
python build.py
# → "OK  Build complete: index.html (XXX KB)" 확인

# 2. push
git add index.html src\index_template.html
git commit -m "feat: 변경 내용 설명"
git push
```

> ⚠️ `build.py` 없이 `index_template.html`만 push하면  
> `{{KLAW_SCRIPT}}`, `{{VERSION}}`이 화면에 텍스트로 노출됩니다.

### 2-2. K-Law 방법론 업데이트 시

```powershell
# 새 system_prompt.txt를 klaw/prompts/에 복사 후
python build.py
git add index.html klaw/prompts/system_prompt.txt
git commit -m "feat: K-Law vXX.X 업데이트"
git push
```

### 2-3. 버전 태그 (타임머신)

```powershell
# 현재 시점 저장
git tag v버전명 -m "설명"
git push origin v버전명

# 태그 목록 확인
git tag -l

# 특정 파일 복구
git checkout v태그명 -- index.html

# 전체 롤백
git reset --hard v태그명
git push origin main --force
```

---

## 3. 알려진 오류 및 즉시 해결법

### 3-1. JSON parse 오류 ★★★ (가장 빈번)

**증상:**
```
Uncaught SyntaxError: Expected property name or '}' in JSON at position 1
```

**원인:** Windows git의 `core.autocrlf=true` 설정이 LF → CRLF 변환  
**근본 해결:** v2.1부터 `window.__KLAW` template literal 방식으로 완전 해결됨

**재발 시 조치:**
```powershell
# .gitattributes 존재 확인
dir .gitattributes

# 없으면 즉시 생성
python -c "open('.gitattributes','w',newline='\n').write('* text=auto\n*.html text eol=lf\n*.py text eol=lf\n*.txt text eol=lf\n*.json text eol=lf\n')"
git add .gitattributes
git add --renormalize .
git commit -m "fix: .gitattributes 복구"
git push

# 재빌드
python build.py
git add index.html
git commit -m "fix: 재빌드"
git push
```

### 3-2. `{{KLAW_SCRIPT}}` 텍스트 노출

**원인:** `build.py` 실행 없이 `index_template.html`만 push  
**해결:** `python build.py` 실행 후 `index.html` push

### 3-3. SyntaxError: Invalid left-hand side in assignment

**원인:** optional chaining(`?.`)을 대입 좌변에 사용
```js
// ❌ 오류
$(tid)?.querySelector('.msg-bubble').innerHTML = res;
// ✅ 정상
const el = $(tid); if(el) el.querySelector('.msg-bubble').innerHTML = res;
```

### 3-4. HTTP 401: Authentication Fails

**원인:** API 키 미입력 또는 만료  
**해결:** `gopang.net` → 설정 → API 키 입력

### 3-5. git push 거부 (fetch first)

```powershell
git pull origin main --no-rebase
# vim 열리면 :wq Enter
git push
```

### 3-6. DNS 연결 문제

| 레코드 | 호스트 | 값 |
|---|---|---|
| A | gopang.net | 185.199.108.153 |
| CNAME | www.gopang.net | nounweb.github.io. |

GitHub Pages 설정: `github.com/nounweb/gopang_v2/settings/pages`
- Custom domain: `gopang.net`
- Enforce HTTPS: ✅ 체크

---

## 4. build.py 동작 원리

### 4-1. 처리 단계

```python
# 1. system_prompt.txt 읽기 (BOM 자동 제거)
klaw = read('klaw/prompts/system_prompt.txt')

# 2. template literal 이스케이프
#    \  →  \\,   `  →  \`,   ${  →  \${
escaped = esc_tl(klaw)

# 3. JS 변수로 삽입 (JSON-free)
klaw_script = '<script>window.__KLAW=`' + escaped + '`;</script>'

# 4. {{KLAW_SCRIPT}}, {{VERSION}} 치환
out = tmpl.replace('{{KLAW_SCRIPT}}', klaw_script)
out = out.replace('{{VERSION}}', version)

# 5. LF 고정 저장 (CRLF 방지)
out_path.write_text(out, encoding='utf-8', newline='\n')
```

### 4-2. 왜 JSON.parse를 쓰지 않는가

| 방식 | 오류 가능성 | 현재 사용 |
|---|---|---|
| `<script type="application/json">` + `JSON.parse()` | CRLF/BOM에 취약 | ❌ 폐기 (v2.1) |
| `window.__KLAW = \`...\`` (template literal) | CRLF/BOM 무관 | ✅ 현재 |

---

## 5. 시스템 프롬프트 구조

고팡은 멀티 LLM 인스턴스 구조로 설계되어 있습니다.

### 5-1. 인스턴스 목록

| 코드 | 이름 | 역할 | 상태 |
|---|---|---|---|
| **SP-00** | AI 비서 | 오케스트레이터 / PDV 관리 / 위법성 감지 | ✅ 활성 |
| **SP-01** | K-Law | 법률 판결 예측 (v15.1) | ✅ 활성 |
| SP-02 | 의료·건강 | 증상/진단/처방/의료기록 | 🔒 준비 중 |
| SP-03 | 교육·연구 | 학습/논문/특허/시험 | 🔒 준비 중 |
| SP-04 | 교통·이동 | 교통사고/운전/항공/물류 | 🔒 준비 중 |
| SP-05 | 금융·시장 | 투자/세금/대출/환율 | 🔒 준비 중 |
| SP-06 | 산업·기업 | 특허/창업/제조/수출 | 🔒 준비 중 |
| SP-07 | 행정·민원 | 허가/신고/공공서비스 | 🔒 준비 중 |
| SP-08 | 입법·정책 | 법안/국회/규제/헌법 | 🔒 준비 중 |
| **SP-09** | 비상·긴급 | 112/119 즉시 안내 | ✅ 활성 |

### 5-2. SP-00 라우팅 기준

```
사용자 입력
  → 위법성 감지 (S0~S3)
  → 도메인 분류
    → 법률/계약/소송  → SP-01 K-Law
    → 긴급/위험       → SP-09
    → 일반/메모/일정  → SP-00 직접 처리
```

### 5-3. SP-00 위험 등급

| 등급 | 점수 | 처리 |
|---|---|---|
| S0 | 0.00~0.29 | 정상 처리 |
| S1 | 0.30~0.59 | 소프트 알림 |
| S2 | 0.60~0.84 | 전송 보류 + 사용자 확인 |
| S3 | 0.85~1.00 | 긴급 차단 + 관련 기관 안내 |

### 5-4. 지원 LLM

설정 창에서 선택 가능:

| LLM | 모델 | 프록시 |
|---|---|---|
| **DeepSeek** (디폴트) | deepseek-chat | Cloudflare Workers |
| Claude | claude-sonnet-4-5 | 직접 연결 |
| GPT-4o | gpt-4o | 직접 연결 |
| Gemini | gemini-1.5-pro | 직접 연결 |
| Custom | 직접 입력 | 직접 입력 |

---

## 6. PDV (Private Data Vault)

### 6-1. 개요

사용자의 출생 시점부터 사망 시점까지 모든 소통을 6하 원칙으로 기록하는 개인 데이터 금고입니다.

### 6-2. 블록 구조 (블록체인 동일)

```
[Genesis Block]              [Block #N]
┌──────────────────┐        ┌──────────────────┐
│ id: PDV-...-0001 │        │ id: PDV-...-NNNN │
│ prevHash: 0000.. │←───────│ prevHash: abc1.. │
│ raw: 원문 전체   │        │ raw: 원문 전체   │
│ hash: abc1..     │───────→│ hash: xyz9..     │
│ openhash: PENDING│        │ openhash: PENDING│
└──────────────────┘        └──────────────────┘
```

### 6-3. 레코드 형식 (6하 원칙)

```json
{
  "id":       "PDV-20260521-143022-0001",
  "seq":      1,
  "who":      "도영민 → AI비서",
  "when":     "2026-05-21T14:30:22.000Z",
  "where":    "채팅",
  "what":     "소통 내용 요약 (100자 이내)",
  "how":      "텍스트",
  "why":      "법률상담",
  "raw":      "[사용자] 원문 전체\n\n[AI비서] 응답 전체",
  "risk":     "S0",
  "instance": "SP-00",
  "hash":     "sha256(id+who+when+raw+prevHash)",
  "prevHash": "직전 블록의 hash",
  "openhash": "PENDING"
}
```

### 6-4. 해시 계산 방식

```
hashInput = id + "|" + who + "|" + when + "|" + raw + "|" + prevHash
hash = SHA-256(hashInput)
```

### 6-5. OpenHash 연동 (예정)

현재 `openhash: "PENDING"` — 추후 OpenHash 네트워크에 해시 전송 예정

### 6-6. PDV 뷰어 접근

`gopang.net` → 설정 → **🔐 PDV 열기**

- 상단: OpenHash 해시체인 가로 스크롤 시각화
- 블록별 `✓ valid` / `✗ invalid` 무결성 표시
- 하단: 6하 원칙 레코드 목록 (최신순, 키워드 검색)

---

## 7. UI 구조 및 기능

### 7-1. 화면 구성

```
┌─────────────────────────────────┐
│  [채팅 화면]          🔍 AI ⚙️  │ ← Floating 버튼
│                                 │
│  [메시지 목록]                  │
│                                 │
│  ─────────────────────────────  │
│  📎 📷  [입력창]  🎤  ▶        │ ← 입력 영역
└─────────────────────────────────┘
```

### 7-2. 채팅 모드

| 모드 | 상태 | 전환 방법 |
|---|---|---|
| 일반 대화 (디폴트) | AI 버튼 회색 | - |
| AI 비서 모드 | AI 버튼 파란색 + 인디케이터 | AI 버튼 1회 클릭 |

### 7-3. Floating 버튼 (우상단)

| 버튼 | 기능 |
|---|---|
| 🔍 | 대화 상대 검색 패널 |
| AI | AI 비서 ON/OFF 토글 |
| ⚙️ | 설정 화면으로 이동 |

### 7-4. 입력창 버튼

| 버튼 | 기능 |
|---|---|
| 📎 | 파일 첨부 (PDF/DOCX/TXT/이미지) |
| 📷 | 카메라 촬영 |
| 🎤 | 음성 입력 (1초 침묵 시 자동 전송) |
| ▶ | 메시지 전송 |

### 7-5. K-Law 탭

- 사건 개요 입력 (파일 첨부 또는 직접 입력)
- 심급 선택 바 (1심 단독 활성, 나머지 준비 중)
- AI가 자동으로: 원고 주장 → 피고 주장 → 다툼 없는 사실 → 쟁점 → 판결문 생성

### 7-6. 설정 화면 구성

- **사용자 프로필** — 이름, 생년월일, 주거지, 직업 등
- **PDV** — 개인 데이터 금고 (기록 수, 열기)
- **AI 모델 선택** — DeepSeek/Claude/GPT/Gemini/Custom
- **API 키** — 선택한 모델의 API 키 입력
- **K-Law 정보** — 버전, 판결 언어
- `← 뒤로` 버튼으로 채팅 복귀

### 7-7. PWA (앱 설치)

| OS | 방법 |
|---|---|
| iPhone | Safari → 공유(□↑) → "홈 화면에 추가" |
| Android | Chrome → 메뉴(⋮) → "앱 설치" |

설치 후 주소창 없이 앱처럼 실행됩니다.

---

## 8. 심급 구조 현황

| 버튼 | 심급 | 재판부 | 판사 | LLM 수 | 상태 |
|---|---|---|---|---|---|
| 1심 단독 | 1심 | 단독 | 1인 | 1 | ✅ 활성 |
| 1심 합의 | 1심 | 합의 | 3인 | 3 | 🔒 준비 중 |
| 2심 합의 | 2심 | 합의 | 3인 | 3 | 🔒 준비 중 |
| 3심 소부 | 3심 | 소부 | 4인 | 4 | 🔒 준비 중 |
| 3심 전원 | 3심 | 전원합의 | 14인 | 14 | 🔒 준비 중 |
| 헌법재판 | 헌재 | 헌재 | 9인 | 9 | 🔒 준비 중 |

합의재판 활성화: `INSTANCES` 객체에서 `active: false → true` 후 재빌드

---

## 9. 버전 히스토리

| 태그 | 날짜 | 주요 변경 |
|---|---|---|
| v1.0-working | 05-20 | 5단계 입력폼, 진행바, 한국어 판결문 |
| v1.1-auto-analysis | 05-20 | 사건 개요 입력 → AI 자동 생성 |
| v1.2-case-classification | 05-20 | 소송종류·재판형태 자동판별 |
| v1.3-court-instances | 05-20 | 심급/재판부/판사수 구조 구현 |
| v1.4-file-upload | 05-20 | 파일 업로드 (PDF·DOCX·TXT·이미지) |
| v1.5-ui-clean | 05-20 | UI 정리, 사건개요 최상단 배치 |
| v1.6-chat-default | 05-20 | AI비서 디폴트, 심급바 K-Law 전용 |
| v1.7-chat-media | 05-20 | 채팅 파일첨부·카메라·음성입력 |
| v1.8-slide-tabbar | 05-20 | 슬라이드 탭바 (스와이프 제스처) |
| v1.9-ai-toggle | 05-20 | AI 토글 버튼, 상단 nav 제거 |
| v2.0-slide-tabbar | 05-20 | 슬라이드 탭바 복구, 텍스트 수정 |
| v2.1-json-fix-final | 05-20 | JSON parse 오류 완전 해결, .gitattributes |
| v2.2-sp00-voice | 05-21 | SP-00 오케스트레이터, 음성 1초 자동전송 |
| v2.3-floating-ui | 05-21 | Floating AI/설정 버튼, 탭바 제거 |
| v2.4-chat-contacts | 05-21 | 일반대화 디폴트, 상대 검색, 심급패널제거 |
| v2.5-multi-llm | 05-21 | 멀티 LLM 선택 (DeepSeek/Claude/GPT/Gemini) |
| v2.6-sp00-pdv | 05-21 | SP-00 시스템프롬프트 완성, PDV 뷰어 |
| v2.7-user-profile | 05-21 | 사용자 프로필 (도영민), SP-00 컨텍스트 주입 |
| v2.8-hashchain | 05-21 | OpenHash 해시체인 시각화, 원문 저장, 무결성 검증 |

---

## 10. 서비스 정보

| 항목 | 내용 |
|---|---|
| 도메인 | https://gopang.net |
| GitHub | github.com/nounweb/gopang_v2 |
| GitHub Pages | nounweb.github.io/gopang_v2 |
| DeepSeek Proxy | gopang-proxy.tensor-city.workers.dev |
| DNS IP | 185.199.108.153 (GitHub Pages) |
| 개발자 이메일 | tensor.city@gmail.com |
| K-Law 버전 | v15.1 (2026-05-18) |
| 회사 | AI City Inc. · 제주특별자치도 |
| 디폴트 사용자 | 도영민 (@체제수리공) |

---

## 부록: 디폴트 사용자 프로필

| 항목 | 내용 |
|---|---|
| 이름 | 도영민 |
| 고팡 ID | @체제수리공 |
| 생년월일 | 1964-10-05 |
| 주거지 | 제주시 이도1동 10-1번지 |
| 전화 | 010-9662-7170 |
| 혈액형 | AB형 |
| 신장/체중 | 176cm / 78kg |
| 가족 | 아내 |
| 차량 | 그랜저TG LPG |
| 직업 | 소프트웨어 개발자 |
| 학력/전공 | 대졸 / 경제학 |
| 취미 | 바다 수영, 올레길 걷기 |

