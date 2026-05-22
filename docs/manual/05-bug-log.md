# 05 — 버그 이력 & 패턴 분석

> 새 버그 발생 시 이 파일에 BUG-012부터 추가하세요.

---

## 버그 이력

| ID | Phase | 파일 | 유형 | 상태 |
|----|-------|------|------|------|
| BUG-001 | 1 | core/event-bus.js | 텍스트 검색 오탐 | ✅ 수정 |
| BUG-002 | 2B | openhash/plsm.js | 로직 오류 (BigInt) | ✅ 수정 |
| BUG-003 | 3 | core/plugin-validator.js | 로직 오류 | ✅ 수정 |
| BUG-004 | 4 | tests/domains/k-law.test.js | 텍스트 검색 오탐 | ✅ 수정 |
| BUG-005 | 5 | gdc/tokenomics.js | 테스트 조건 오류 | ✅ 수정 |
| BUG-006 | 5 | gdc/smartVault.js | 테스트 경계값 오류 | ✅ 수정 |
| BUG-007 | 5 | gdc/currencyPool.js | 부동소수점 허용오차 | ✅ 수정 |
| BUG-008 | 6 | domains/k-health/index.js | 로직 오류 (hasMedFlag) | ✅ 수정 |
| BUG-009 | 7 | tests/phase7_bootstrap.test.js | 경로 오류 | ✅ 수정 |
| BUG-010 | 8 | tests/integration/test-harness.js | Regex + 격리 누락 | ✅ 수정 |
| BUG-011 | 배포 | src/app.js, src/shell-ui.js | Import 이름 불일치 | ✅ 수정 |

---

### BUG-001
- **증상:** C-08 테스트 실패 — event-bus.js에 'plugin-registry' 문자열 포함
- **원인:** 주석 예시 코드에 'plugin-registry' 포함 → 텍스트 검색 오탐
- **조치:** 주석에서 해당 문자열 제거
- **교훈:** 텍스트 검색 시 항상 `import` 구문 한정 검사

### BUG-002
- **증상:** O-01 실패 — χ²=51.97, L1 분포 편향
- **원인:** hex 3자리(0~4095)를 1000으로 mod 시 BigInt 미사용
- **조치:** `parseInt` → `Number(BigInt(hash) % 1000n)`
- **교훈:** 대용량 정수 mod 연산은 반드시 BigInt 사용

### BUG-003
- **증상:** A-14 실패 — 오류 플러그인이 등록 거부됨
- **원인:** PluginValidator가 `classify()` 실행 오류를 등록 거부 조건으로 처리
- **조치:** validator에서 classify 실행 검사 제거

### BUG-004
- **증상:** K-10 실패 — 코어 파일에 'k-law' 포함 오탐
- **원인:** event-bus.js 주석에 'k-law' 포함 (BUG-001 동일 패턴)
- **조치:** import 구문 한정 검사로 변경

### BUG-005~007
- **증상:** G-01, G-05, G-06 실패
- **원인:** 테스트 조건 오류 (클램핑, 경계값 `<` vs `<=`, 부동소수점 오차)
- **교훈:** 부동소수점 비교 시 `Math.abs(a - b) < epsilon` 사용

### BUG-008
- **증상:** H-07 실패 — MEDICAL_ALERT 미발행
- **원인:** `hasMedFlag` 조건이 Fast-Path S3 시 legalFlags=[] 이라 발행 차단
- **조치:** `hasMedFlag` 조건 제거, riskLevel === 'S3' 조건만 사용

### BUG-009
- **증상:** B-01~B-09 전체 실패 — 파일 없음
- **원인:** ROOT = `join(__dirname, '../../..')` → `/home/claude` 오계산
- **조치:** `join(__dirname, '../..')` 로 수정

### BUG-010
- **증상:** I-02, I-08 실패 — MED 플래그 미반환
- **원인 1:** fastPath S3 후 classify() 미실행 (break로 루프 종료)
- **원인 2:** MED-01 regex `무허가.*의료|무면허.*진료` → `무허가 병원` 미매칭
- **조치 1:** break → Set으로 변경, 모든 플러그인 classify 실행 보장
- **조치 2:** regex `무허가.*(의료|병원)|무면허.*(진료|수술)` 로 확장

### BUG-011 ⭐ 가장 중요 (배포 오류)
- **증상:** `SyntaxError: does not provide an export named 'AIPipeline'`
- **발생:** gopang.net 최초 배포 시 흰 화면
- **원인:** `app.js`가 존재하지 않는 export 이름으로 static import
  - `AIPipeline` → 실제: `runPipeline` (함수)
  - `PluginRegistry` → 실제: `registry` (싱글톤)
  - `PDVLayer`, `OpenHashLayer`, `NetworkLayer`, `GDCLayer`, `PrivacyLayer` → 존재하지 않음
  - `{ KLawPlugin }` → 실제: default export
- **조치:** `app.js` 실제 export 이름에 맞게 전면 재작성
- **재발 방지:** `01-system-map.md §2 Export 이름 일람` 항상 먼저 확인

---

## 버그 패턴 분석

| 패턴 | 건수 | 예방법 |
|------|------|-------|
| **텍스트 검색 오탐** | 2건 (001, 004) | import 구문만 검색: `grep "^import.*모듈명"` |
| **테스트 조건 오류** | 4건 (005~007, 009) | 경계값 `<=`, 부동소수점 epsilon, 경로 계산 double-check |
| **Export 이름 불일치** | 1건 (011) | 신규 파일 작성 전 `01-system-map.md` 확인 필수 |
| **로직 오류** | 4건 (002, 003, 008, 010) | 단위 테스트로 조기 발견 |

---

## 새 버그 기록 양식

```markdown
### BUG-012
- **발생일:** YYYY-MM-DD
- **Phase/위치:** 배포 / src/XXX.js
- **증상:** Console에 표시된 정확한 오류 메시지
- **원인:** 근본 원인
- **조치:** 수정 내용
- **교훈:** 재발 방지 방법
- **커밋:** fix: 설명 (BUG-012)
```
