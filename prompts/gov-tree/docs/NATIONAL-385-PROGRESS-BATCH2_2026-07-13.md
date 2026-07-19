# enterprises 배치2 — 경로 정정 및 신규 수정

- 작성일: 2026-07-13

## 경로 오류 정정(중요)

지난 배치에서 KEPCO·KORAIL·LH 수정본을 잘못된 경로(`prompts/09-national-enterprises/`, 저장소 루트)에 패키징했다 — 실제 라우터가 참조하는 경로는 `prompts/Jejudo/09-national/enterprises/`이며, 거기엔 여전히 미수정 v1.0이 남아있었다. 이번 배치에서 **올바른 경로에 v1.1을 재배치**했다. 저장소의 잘못된 위치 파일(`prompts/09-national-enterprises/*`)은 삭제 대상이다.

## 신규 수정 — 2건

| 기관 | 수정 내용 | 근거 |
|---|---|---|
| SR(수서고속철도, SRT) | 지연시간·운임 제공 시 배상금 실제 계산(KTX와 동일 기준 확인) | 코레일 공식 FAQ가 "KTX와 SRT 기준 동일"이라고 명시 |
| HUG(주택도시보증공사) | 전세금·매매시세 제공 시 전세가율 직접 계산 + 위험도 판단 | 일반 원칙(전세가율=전세금/집값), 정확한 가입한도는 재검증 필요 명시 |

## 누적 현황

enterprises 30개 중 5개 수정 완료(KEPCO·KORAIL·LH·SR·HUG), 25개 미검토. 전체 385개(policy-bodies 70·enterprises 30·qgov 62·other 200+·unlisted 23) 중 5개 완료.

## 정직하게 밝힘

경로 오류가 있었다는 사실 자체를 정직하게 기록한다 — 향후 국가기관 관련 파일을 패키징할 때는 `prompts/Jejudo/09-national/{agencies|policy-bodies|enterprises|qgov|other|unlisted}/` 경로를 재확인 후 진행해야 한다.
