# 도메인 플러그인 작성 가이드

## 새 도메인 추가 절차

1. **_template/ 복사**
   ```powershell
   cp -r src/domains/_template src/domains/k-newdomain
   ```

2. **index.js 수정** — metadata 5개 항목 변경

3. **classifier.js 작성** — 법령 분류 규칙
   - `classify(suList)`: SU 목록 → 법령 플래그 반환
   - `getFastPathTriggers()`: 즉각 차단 패턴 목록

4. **risk-rules.js 작성** — Fast-Path 트리거 규칙

5. **schema.js 수정** — 도메인 전용 저장 필드

6. **CHANGELOG.md 작성** — v1.0.0 릴리스 기록

7. **app.js에 등록** (1줄)
   ```javascript
   await registry.register(new KNewDomainPlugin())
   ```

8. **테스트 실행**
   ```powershell
   node src/tests/domains/k-newdomain.test.js
   ```

## 필수 구현 체크리스트

- [ ] metadata.name (소문자·하이픈)
- [ ] metadata.version (semver x.y.z)
- [ ] metadata.displayName
- [ ] legalClassifier.classify()
- [ ] legalClassifier.getFastPathTriggers()
- [ ] riskRules (배열)
- [ ] onLoad() / onUnload() / onUpdate()
- [ ] CHANGELOG.md

## 코어 파일 수정 금지

새 도메인 추가 시 `src/core/` 파일은 절대 수정하지 않습니다.
