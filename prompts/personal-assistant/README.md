# 나만의 AI 비서 — System Prompts

이 폴더는 사용자가 OpenRouter 등 개인 API Key로 구동하는 **개인용 AI 비서**
(`pages/ai-setup.html`에서 설정)의 시스템 프롬프트를 보관합니다.

`../prompts/SP-XX_*.txt`(K-Law, K-Health 등 14개+ 서비스)와의 차이:

| 구분 | `prompts/SP-XX_*.txt` | `prompts/personal-assistant/` |
|------|------------------------|-------------------------------|
| 호출 주체 | SP-00-ROUTER가 자동 분류 후 디스패치 | 사용자가 직접 선택/설정 |
| 실행 환경 | 고팡 서버 측 공용 모델 | 사용자 개인 OpenRouter Key |
| 범위 | 특정 민원/법률/의료 등 전문 서비스 | 범용 개인 비서 |

## 네이밍 컨벤션

```
personal-assistant-v{메이저}.{마이너}.txt
```

## 파일 목록

(아직 없음 — 다음 작업에서 `personal-assistant-v1.0.txt` 추가 예정)
