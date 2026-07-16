# 업종별 Profile/AC 자동 구성 시스템 — 1차 산출물

## 구성 요소 3개 (순서대로 실행)

### 1. `product_classifier.py` — 상품 → 업종
- 지난 산출물(`ksic-flat.csv`, `ksic-paths.jsonl`)을 그대로 재사용
- 1단계: 키워드 fast-path (즉시, LLM 비용 없음)
- 2단계: `embed_fn` 주입 시 임베딩 의미매칭 폴백 — **현재 미주입 상태**(실제 임베딩 API 연결 필요)
- 단독 테스트: `python3 product_classifier.py --query "택시 운송 서비스"`

### 2. `field_normalizer.py` — 필드/기능 정규화 (하이브리드 파이프라인 핵심)
- 클러스터링 → 빈도 임계값(기본 15%) → `promotion_queue` 산출
- `similarity_fn` 주입 지점 있음 — **현재는 문자열 유사도(SequenceMatcher) 폴백만 구현됨**
  - 데모 실행 결과에서 "영업시간"↔"오픈시간"이 안 묶인 게 이 폴백의 한계 — 실제 임베딩 연결하면 해결됨
- `cluster_threshold`(0.72), `promotion_ratio`(0.15)는 초기값. 실데이터로 튜닝 필요
- **여기서 나온 promotion_queue는 자동 승인되지 않음** — schema.md의 검토 단계(사람 또는 K-Compose 자동검증)를 반드시 거쳐야 `standard_fields`로 승격됨. 이 스크립트는 승격 "후보 산출"까지만 함

### 3. `template_generator.py` — 표준 필드 → 신규 사용자 템플릿
- 승격 완료된 `standard_fields`를 받아 업종별 `industry_templates` 생성
- `confidence` 필드로 표본 부족 여부 표시 (관측치 5 미만 = `low_sample`) — 신규 업종은 초반에 이 상태일 것

## schema.md
PocketBase 컬렉션 4개 설계: `field_observations`(원본, 불변) → `promotion_queue`(대기) → `standard_fields`(승격, 누적 성장) → `industry_templates`(최종 산출물)

## 아직 안 채운 것 (다음 단계 필요)
1. **임베딩 함수 연결** — `product_classifier.py`의 `embed_fn`, `field_normalizer.py`의 `similarity_fn` 둘 다 실제 임베딩 API로 교체해야 프로토타입 이상의 정확도가 나옵니다. 어떤 임베딩(자체 호스팅 vs 외부 API)을 쓰실지에 따라 배선이 달라집니다.
2. **PocketBase 컬렉션 실제 생성** — schema.md는 설계만 되어 있고 실제 마이그레이션 스크립트는 없습니다.
3. **field_normalizer의 클러스터링 알고리즘** — 지금은 O(n²) single-link라 라벨 종류가 수천 개를 넘어가면 느립니다. 그 규모가 되면 벡터 인덱스(faiss 등) 교체가 필요합니다 — 지금은 프로토타입 수준으로 봐주세요.
4. **검토 단계의 실제 주체** — "사람이 검토" vs "K-Compose가 자동검증" 중 어느 쪽으로 먼저 붙일지 미정.
