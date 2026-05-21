# 고팡(Gopang) v3.3 릴리스 노트
# 릴리스 태그: v3.3-sp00-v4
# 릴리스 일자: 2026-05-21
# 작성: AI City Inc. · 도영민

---

## 개요

고팡 v3.3은 AI 비서 시스템 프롬프트 SP-00을 v4.0으로 전면 개편하고,
GAS(Gopang Address System) v1.5 융합 계획을 수립하며,
OpenHash 5계층 GitHub 시뮬레이션을 완성한 마일스톤 릴리스입니다.

---

## 저장소 현황

| 저장소 | 역할 | 최신 태그 |
|---|---|---|
| nounweb/gopang_v2 | 고팡 앱 (PWA) + DOCS | v3.3-sp00-v4 |
| nounweb/openhash-L1-ido1 | OpenHash L1 이도1동 노드 | init |
| nounweb/openhash-L2-jeju-city | OpenHash L2 제주시 노드 | init |
| nounweb/openhash-L3-jeju | OpenHash L3 제주도 노드 | init |
| nounweb/openhash-L4-kr | OpenHash L4 대한민국 노드 | init |
| nounweb/openhash-L5-global | OpenHash L5 글로벌 노드 | init |

---

## 버전 히스토리 (전체)

### v1.0-working (2026-05-20)
- 5단계 입력폼, 진행바, 한국어 K-Law 판결문 생성
- DeepSeek API 연동 (Cloudflare Workers 프록시)

### v1.1-auto-analysis
- 사건 개요 입력 → AI 자동 단계별 생성
- 원고/피고/다툼없는사실/쟁점/판결문 순차 생성

### v1.2-case-classification
- 소송 종류·재판 형태 자동 판별
- K-Law v15.1 시스템 프롬프트 연동

### v1.3-court-instances
- 심급/재판부/판사 수 구조 구현
- 1심 단독/합의, 2심, 3심, 헌법재판 버튼

### v1.4-file-upload
- 파일 업로드 (PDF·DOCX·TXT·이미지)
- 사건 개요에 파일 내용 자동 첨부

### v1.5-ui-clean
- UI 정리, 사건 개요 최상단 배치
- 불필요한 중복 UI 제거

### v1.6-chat-default
- AI 비서 탭 디폴트, K-Law는 별도 탭
- 채팅 UI 기본 구조 구현

### v1.7-chat-media
- 채팅 파일첨부·카메라·음성 입력
- 📎 📷 🎤 버튼 입력창 추가

### v1.8-slide-tabbar
- 슬라이드 탭바 구현 (스와이프 제스처)
- K-Law / 채팅 / 설정 탭 전환

### v1.9-ai-toggle
- AI 토글 버튼 추가
- 상단 nav 제거

### v2.0-slide-tabbar
- 슬라이드 탭바 복구
- 텍스트 수정

### v2.1-json-fix-final
- **JSON parse 오류 완전 해결**
- window.__KLAW template literal 방식 도입
- .gitattributes CRLF 차단
- build.py v3 (JSON-free 빌드)

### v2.2-sp00-voice
- SP-00 AI 비서 시스템 프롬프트 v1.0 적용
- 음성 입력 1초 침묵 시 자동 전송
- 오류 메시지 한국어화

### v2.3-floating-ui
- **하단 슬라이드 탭바 완전 제거**
- 채팅 우상단 Floating 버튼 (AI + 설정)
- switchTab() null 체크 버그 수정

### v2.4-chat-contacts
- **AI 디폴트 OFF → 일반 대화 모드**
- 대화 상대 검색 버튼(🔍) 추가
- 검색 패널 슬라이드 다운
- 설정 창 K-Law 심급 현황 패널 삭제
- 설정 창 ← 뒤로 버튼 추가

### v2.5-multi-llm
- **멀티 LLM 선택 기능**
  - DeepSeek V3 Pro (디폴트)
  - Claude (Anthropic)
  - GPT-4o (OpenAI)
  - Gemini (Google)
  - Custom (직접 입력)
- 각 LLM별 엔드포인트/형식 자동 처리
- API 키 설정 창 추가

### v2.6-sp00-pdv
- **SP-00 시스템 프롬프트 완성 (v2.0)**
  - 9개 도메인 라우팅 테이블 (SP-01~SP-09)
  - S0~S3 위험 등급 체계
  - PDV 기록 형식 지시
- **PDV 뷰어 구현**
  - 설정 → 🔐 PDV 열기
  - 6하원칙 레코드 목록
  - SHA-256 해시체인 (SubtleCrypto API)
  - 키워드 검색, 최신순 정렬
  - 기록 수 배지 실시간 업데이트

### v2.7-user-profile
- **디폴트 사용자 프로필 (도영민)**
  - 이름, 생년월일(1964-10-05), 주거지(제주시 이도1동)
  - 전화, 혈액형, 신장/체중, 가족, 차량, 직업, 학력, 취미
  - 나이 자동 계산 (61세)
- 설정 창 프로필 카드 표시
- SP-00에 사용자 컨텍스트 자동 주입

### v2.8-hashchain
- **OpenHash 해시체인 시각화**
  - PDV 상단 가로 스크롤 블록 시각화
  - Genesis (주황) / Latest (파랑) 블록 구분
  - ✓ valid / ✗ invalid 무결성 표시
  - 최신 블록 자동 스크롤
- **원문(raw) 전체 저장**
  - [사용자] 원문 + [AI비서] 응답 전문 저장
- **체인 무결성 검증 (verifyChain)**
  - SHA-256 재계산 및 prevHash 체인 검증
- openhash_tx: PENDING 표시

### v2.8.1-manual
- DOCS/GOPANG_MANUAL.md v3.0 추가

### v2.9-sp00-v3
- **SP-00 v3.0 전면 개편**
  - § 1: 지시 3경로 분류 (직접/AI간/전문LLM)
  - § 2: 위치 인식 (GPS + 프로필 폴백)
  - § 3: 재무 관리 (5종 재무제표)
  - § 4: 디지털 서명 (ECDSA P-256)
  - § 9: 디폴트 설정 (DeepSeek V3 Pro)
- 테스트 API Key PDV 자동 저장
- GPS getLocation() 함수 구현

### v2.9.1-sp00-examples
- AI Secretary Prompt v3.0 역할 예시 10가지 추가
  1. 병원 예약
  2. 송금
  3. 교통편 예약 (버스→택시 즉흥 변경)
  4. 건축 허가 신청
  5. 여권 갱신
  6. 식사 예약
  7. 세금 신고·납부
  8. 등본 발급·전달
  9. 샌들 구매 (재고 없음 대응)
  10. 주식 투자

### v2.9.2-sp00-ex11
- AI Secretary Prompt v3.0 예시 11 추가
  - 대금 소송 → 변호사 중재 → 협상 (파산 45% 리스크 분석) → 70% 합의

### v2.9.3-gduda
- **DOCS/Gopang_User_Discovery_Algorithm.md 추가**
  - GDUDA v1.0 (Gopang Distributed User Discovery Algorithm)
  - DNS/Kademlia/BGP/mDNS 참조 설계
  - OpenHash 5계층 사용자 등록 Broadcasting 절차
  - 권역 DB 노드 선출 기준
  - P2P 직접 통신 프로토콜
  - 카카오톡 vs 고팡 비교

### v3.0-docs
- DOCS/GOPANG_MANUAL.md 추가 (v3.0)
- DOCS/Gopang_User_Discovery_Algorithm.md 추가
- DOCS/AI_Secretary_Prompt_v3.0.txt 추가

### v3.1-gas
- **DOCS/Gopang_Address_System.md 추가 (GAS v1.0)**
  - ULA IPv6 (fd6f:7068:6173::/48) 기반 주소 체계
  - 3계층 ID (고팡ID/공개IPv6/비공개PDV)
  - OpenHash 5계층과 1:1 매핑
  - Stealth Address, L1 Mailbox 프라이버시
  - 역변환 방지 (Salt+Hash)

### v3.1.1-gas-name-resolution
- GAS v1.0 → v1.1 업데이트
- § 12 Name Resolution 추가
  - DHT 기반 이름 해석
  - Well-Known URI 명세
  - 부트스트랩 설계
  - "@체제수리공 → IPv6" 매핑 흐름

### v3.2-gas-integration
- **DOCS/Gopang_Address_System_v1_5.md 추가**
  - GAS v1.5 (GPC as Protocol Primitive)
  - trust_level IPv6 인코딩, Stealth 태그 확장
  - Schnorr ZKP 완전 수식화, Legal Hold 스마트 컨트랙트
  - 닉네임 경매, GPC 가중 DHT 라우팅
- **DOCS/Gopang_GAS_Integration_Plan.md 추가**
  - 기존 코드 vs GAS v1.5 대응 분석표
  - Phase 1~4 구현 계획 (코드 포함)
  - GUID 생성 JS, routing_table GAS v1.5 형식
  - Well-Known 부트스트랩 JSON
  - 닉네임 등록 GitHub Actions
  - Stealth Address JS, ZKP Schnorr 구조
  - Legal Hold GitHub Actions

### v3.3-sp00-v4 (현재)
- **SP-00 v4.0 전면 개편 (핵심 릴리스)**

---

## v3.3 상세 변경 내용

### SP-00 v4.0 — PDV 자율 인출 원칙

#### 가장 중요한 변경: § 1 "정보 요청 금지" 명문화

```
❌ v3.0 이전 (잘못된 방식):
   "본인 확인을 위해 주민등록번호를 알려주세요."
   "발급 목적이 무엇인가요?"
   "어떤 방식으로 받으시겠어요?"

✅ v4.0 (올바른 방식):
   1. PDV에서 필요한 정보를 직접 인출
   2. 해당 기관 AI 비서를 호출하여 처리
   3. 완료 결과만 사용자에게 보고
```

#### § 2 세계관 설정 — 모든 개인·기관은 AI 비서 보유

```
도영민 AI ↔ 행정안전부 AI ↔ 시청 AI
도영민 AI ↔ 국세청 AI ↔ 법원 AI
도영민 AI ↔ 병원 AI ↔ 약국 AI
도영민 AI ↔ 식당 AI ↔ 택시 AI
도영민 AI ↔ 홍길동 AI ↔ 임꺽정 변호사 AI
```

#### § 3 지시 처리 흐름 (5단계)

```
1. 지시 분석 → 2. PDV 인출 → 3. 경로 결정
→ 4. AI-to-AI 실행 → 5. 완료 보고
```

#### § 5 역할 예시 (등본 발급 비교)

| 항목 | v3.0 | v4.0 |
|---|---|---|
| AI 응답 | "주민번호 알려주세요" | PDV 인출 → 행정부 AI 호출 → 완료 보고 |
| 사용자 역할 | 정보 제공자 | 지시자 |
| 처리 방식 | 질문-답변 | 자율 처리 후 보고 |

---

## OpenHash GitHub 시뮬레이션 현황

### 배포된 노드 (GitHub Pages)

| 노드 | URL | 상태 |
|---|---|---|
| L1 이도1동 | nounweb.github.io/openhash-L1-ido1 | ✅ 활성 |
| L2 제주시 | nounweb.github.io/openhash-L2-jeju-city | ✅ 활성 |
| L3 제주도 | nounweb.github.io/openhash-L3-jeju | ✅ 활성 |
| L4 대한민국 | nounweb.github.io/openhash-L4-kr | ✅ 활성 |
| L5 글로벌 | nounweb.github.io/openhash-L5-global | ✅ 활성 |

### 각 노드 파일 구조

```
openhash-L{N}-{name}/
├── node.json           노드 정보 (ID, 계층, 부모/자식)
├── routing_table.json  사용자 GUID 라우팅 테이블
├── chain_status.json   해시체인 상태 (총 블록, 최신 해시)
├── blocks/
│   └── block_NNNN.json SHA-256 해시체인 블록
├── api/
│   └── index.html      Apple HIG 디자인 노드 UI
└── .github/workflows/
    ├── register.yml    사용자 등록 + 상위 계층 자동 전파
    ├── verify.yml      매 시간 ILMV 무결성 검증
    └── pages.yml       GitHub Pages 자동 배포
```

### L1 노드 초기 블록체인 상태

```
block_0000.json: GENESIS 블록
block_0001.json: USER_REGISTER (도영민 @체제수리공)

routing_table.json:
  - 도영민 (@체제수리공)
    GUID: 3f7a9b2e8c1d4f6a9b3e7d2c5a8f1b4e
    L1: KR-JEJU-JEJU-IDO1
```

---

## DOCS 폴더 현황

| 문서 | 버전 | 내용 |
|---|---|---|
| GOPANG_MANUAL.md | v3.0 | 운영 매뉴얼 (빌드/배포/오류해결) |
| AI_Secretary_Prompt_v3.0.txt | v3.0 | AI 비서 시스템 프롬프트 (예시 11가지) |
| AI_Secretary_Prompt_v4.0.txt | v4.0 | **PDV 자율인출, AI-to-AI 처리** |
| Gopang_User_Discovery_Algorithm.md | v1.0 | GDUDA 분산 사용자 검색 알고리즘 |
| Gopang_Address_System.md | v1.1 | GAS 주소 체계 (Name Resolution 포함) |
| Gopang_Address_System_v1_5.md | v1.5 | GAS 완전판 (GPC 프로토콜 통합) |
| Gopang_GAS_Integration_Plan.md | v1.0 | GAS v1.5 융합 구현 계획 |

---

## 기술 스택

| 항목 | 내용 |
|---|---|
| 프론트엔드 | HTML/CSS/JS (단일 파일 PWA) |
| 빌드 | Python build.py (window.__KLAW template literal) |
| 배포 | GitHub Pages (gopang.net) |
| LLM | DeepSeek V3 Pro (디폴트), Claude/GPT/Gemini/Custom 선택 |
| 프록시 | Cloudflare Workers (gopang-proxy.tensor-city.workers.dev) |
| 암호화 | Web Crypto API (ECDSA P-256, SHA-256) |
| 저장 | localStorage (PDV 시뮬레이션) |
| 해시체인 | SubtleCrypto SHA-256 (OpenHash 호환) |
| K-Law | v15.1 (190KB 방법론 시스템 프롬프트) |
| 도메인 | gopang.net (CNAME → nounweb.github.io) |

---

## 다음 작업 계획 (v3.4~)

### 즉시 (v3.4)
- GAS v1.5 Phase 1 구현
  - routing_table.json GAS v1.5 형식 업그레이드
  - GUID 생성/파싱 함수 (index_template.html)
  - .well-known/gopang-bootstrap.json 추가
  - Well-Known URI 등록

### 단기 (v3.5~v3.9)
- SP-02~SP-10 전문 인스턴스 시스템 프롬프트 작성
- Stealth Address JS 구현
- 닉네임 등록 GitHub Actions
- GPC 지갑 시뮬레이션

### 중기 (v4.0~)
- ZKP Schnorr 구현 (WASM)
- Legal Hold GitHub Actions
- AI-to-AI 실제 통신
- 재무제표 자동 생성 UI

### 장기 (v5.0~)
- OpenHash 네트워크 실제 연동
- GPC 토큰 스마트 컨트랙트
- Mixnet 연동
- PQ 암호화 전환

---

*고팡(Gopang) v3.3 | AI City Inc. | 2026-05-21*
*gopang.net | github.com/nounweb/gopang_v2*
