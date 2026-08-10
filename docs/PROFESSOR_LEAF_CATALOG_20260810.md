# PROFESSOR_LEAF_CATALOG_20260810.md

professor(교수, 1:1 맞춤교육) 페르소나 트리 전체 카탈로그 — 리프(3단, 실제 호출 대상) 161개, 중계열(2단) 28개.

- 생성 시점 main HEAD: `9e589fb`
- 생성 방법: `tests/live_smoketest/dump_leaves.mjs` 및 `EXPERT_REGISTRY`(`src/gopang/ai/expert-registry.js`) 직접 import — 재구현 아님, production 소스 오브 트루스 그대로
- 표 열: `id`(레지스트리 키) / `label`(표시명) / `트리거 예시`(최대 3개) / `동의어 보강`(LEAF_SYNONYMS 존재 여부) / `SP 파일`(존재 여부)

---

## 교수(언어·문학 중계열) (`professor-language-literature`) — 리프 14개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-korean` | 교수(국어·국문학) | 국어 지도, 국문학 지도, 국어 교수 | ✅ | ✅ |
| `professor-english` | 교수(영어·영문학) | 영어 지도, 영문학 지도, 영어 교수 | ✅ | ✅ |
| `professor-linguistics` | 교수(언어학) | 언어학 지도, 통사론 지도 | — | ✅ |
| `professor-german` | 교수(독일어·문학) | 독일어 지도, 독어독문학 지도 | — | ✅ |
| `professor-russian` | 교수(러시아어·문학) | 러시아어 지도, 노어노문학 지도 | — | ✅ |
| `professor-spanish` | 교수(스페인어·문학) | 스페인어 지도, 서어서문학 지도 | — | ✅ |
| `professor-japanese` | 교수(일본어·문학) | 일본어 지도, JLPT 지도 | — | ✅ |
| `professor-chinese` | 교수(중국어·문학) | 중국어 지도, HSK 지도 | — | ✅ |
| `professor-classicalchinese` | 교수(한문학) | 한문 지도, 한자 교육 지도 | ✅ | ✅ |
| `professor-french` | 교수(프랑스어·문학) | 프랑스어 지도, 불어불문학 지도 | — | ✅ |
| `professor-otherasianlanguages` | 교수(기타아시아어·문학) | 베트남어 지도, 아랍어 지도, 태국어 지도 | — | ✅ |
| `professor-othereuropeanlanguages` | 교수(기타유럽어·문학) | 이탈리아어 지도, 포르투갈어 지도 | — | ✅ |
| `professor-generallanguage` | 교수(교양어·문학) | 교양외국어 지도, 여행회화 지도 | — | ✅ |
| `professor-creativewriting` | 교수(문예창작학) | 문예창작 지도, 소설·시 창작 지도 | — | ✅ |

## 교수(인문학 중계열) (`professor-humanities`) — 리프 6개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-history` | 교수(역사·고고학) | 한국사 지도, 세계사 지도, 역사 교수 | — | ✅ |
| `professor-ethics` | 교수(철학·윤리학) | 철학 지도, 윤리 지도, 생활과 윤리 지도 | — | ✅ |
| `professor-religiousstudies` | 교수(종교학) | 종교학 지도, 비교종교학 지도 | — | ✅ |
| `professor-culturalstudies` | 교수(문화·민속·미술사학) | 민속학 지도, 문화사 지도 | — | ✅ |
| `professor-areastudies` | 교수(국제지역학) | 지역학 지도, 중국학·일본학 지도 | — | ✅ |
| `professor-generalhumanities` | 교수(교양인문학) | 교양인문학 지도, 인문학 개론 지도 | — | ✅ |

## 교수(사회과학 중계열) (`professor-socialscience`) — 리프 14개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-politics` | 교수(정치외교학) | 정치와 법 지도, 정치외교학 지도, 국제관계 지도 | — | ✅ |
| `professor-sociology` | 교수(사회학) | 사회문화 지도, 사회학 지도 | — | ✅ |
| `professor-geography` | 교수(도시·지역·지리학) | 한국지리 지도, 세계지리 지도, 지리학 지도 | — | ✅ |
| `professor-psychology` | 교수(심리학) | 심리학 지도, 심리학 교수 | — | ✅ |
| `professor-international` | 교수(국제학) | 국제학 지도, 국제기구 지도, 지역학 지도 | — | ✅ |
| `professor-childfamilystudies` | 교수(아동·가족학) | 아동가족학 지도, 아동발달 이론 지도 | — | ✅ |
| `professor-socialwelfare` | 교수(사회복지학) | 사회복지학 지도, 사회복지사 국가고시 지도 | — | ✅ |
| `professor-consumerscience` | 교수(소비자·가정자원) | 소비자학 지도, 가정경제관리 지도 | — | ✅ |
| `professor-mediastudies` | 교수(언론·방송·매체학) | 언론학 지도, 저널리즘 이론 지도 | — | ✅ |
| `professor-publicadministration` | 교수(행정학) | 행정학 지도, 공무원 시험(행정학) 지도 | — | ✅ |
| `professor-anthropology` | 교수(인류학) | 인류학 지도, 문화상대주의 지도 | — | ✅ |
| `professor-libraryscience` | 교수(문헌정보학) | 문헌정보학 지도, 사서직 시험 지도 | — | ✅ |
| `professor-generalsocialscience` | 교수(교양사회과학) | 교양사회과학 지도, 사회과학 개론 지도 | ✅ | ✅ |
| `professor-militaryscience` | 교수(군사·국방·안보) | 군사학 지도, 안보전략 이론 지도 | — | ✅ |

## 교수(화학·생명과학·환경 중계열) (`professor-chembio`) — 리프 4개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-chemistry` | 교수(화학) | 화학 지도, 화학 교수 | — | ✅ |
| `professor-biology` | 교수(생명과학) | 생명과학 지도, 생물 교수 | — | ✅ |
| `professor-environmentalscience` | 교수(환경학) | 환경학 지도, 생태학 지도 | — | ✅ |
| `professor-biotechnology` | 교수(바이오테크놀로지학) | 바이오테크놀로지 지도, 생명정보학 지도 | — | ✅ |

## 교수(수학·물리·천문·지구 중계열) (`professor-mathphys`) — 리프 6개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-physics` | 교수(물리학) | 물리학 지도, 물리 교수 | — | ✅ |
| `professor-earthscience` | 교수(지구·지질학) | 지구과학 지도, 지질학 지도 | — | ✅ |
| `professor-math` | 교수(수학) | 수학 지도, 수학 교수 | ✅ | ✅ |
| `professor-statistics` | 교수(통계학) | 통계학 지도, 확률과 통계 지도 | — | ✅ |
| `professor-astronomy` | 교수(천문·대기과학) | 천문학 지도, 대기과학 지도 | — | ✅ |
| `professor-oceanography` | 교수(해양학) | 해양학 지도, 물리해양학 지도 | — | ✅ |

## 교수(1:1 맞춤교육) 직속 (중계열 미신설) (`professor`) — 리프 1개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-law` | 교수(법학) | 법학 지도, 법학 교수, 로스쿨 지도 | — | ✅ |

## 교수(경영·경제 중계열) (`professor-business-economics`) — 리프 9개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-economics` | 교수(경제학) | 경제학 지도, 경제학 교수 | — | ✅ |
| `professor-business` | 교수(경영학) | 경영학 지도, 경영학 교수, MBA 지도 | — | ✅ |
| `professor-mis` | 교수(경영정보학) | 경영정보학 지도, MIS 지도 | — | ✅ |
| `professor-accounting` | 교수(회계·세무학) | 회계학 지도, 세무학 지도, 회계사 시험 지도 | — | ✅ |
| `professor-tradedistribution` | 교수(무역·유통학) | 무역학 지도, 유통관리론 지도 | — | ✅ |
| `professor-advertising` | 교수(광고·홍보학) | 광고학 지도, PR전략 지도 | — | ✅ |
| `professor-tourism` | 교수(관광학) | 관광경영학 지도, 호스피탈리티 지도 | — | ✅ |
| `professor-realestate` | 교수(부동산) | 부동산학 지도, 공인중개사 시험 지도 | — | ✅ |
| `professor-financeinsurance` | 교수(금융·보험학) | 금융보험학 지도, 보험계리사 시험 지도 | — | ✅ |

## 교수(전기·전자·컴퓨터 중계열) (`professor-electrical-computer`) — 리프 9개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-computerscience` | 교수(전산학·컴퓨터공학) | 컴퓨터공학 지도, 전산학 지도, 알고리즘 지도 | — | ✅ |
| `professor-software` | 교수(응용소프트웨어공학) | 소프트웨어공학 지도, 소프트웨어 아키텍처 지도 | — | ✅ |
| `professor-ai-engineering` | 교수(인공지능공학) | 인공지능공학 지도, 머신러닝 지도, 딥러닝 지도 | — | ✅ |
| `professor-electrical` | 교수(전기공학) | 전기공학 지도, 전기기사 시험 지도 | — | ✅ |
| `professor-electronics` | 교수(전자공학) | 전자공학 지도, 전자회로 지도 | — | ✅ |
| `professor-controlengineering` | 교수(제어계측공학) | 제어공학 지도, PID 제어 지도 | — | ✅ |
| `professor-optics` | 교수(광학공학) | 광학공학 지도, 레이저공학 지도 | — | ✅ |
| `professor-biomedengineering` | 교수(의공학) | 의공학 지도, 의료영상 원리 지도 | — | ✅ |
| `professor-telecommunications` | 교수(정보·통신공학) | 통신공학 지도, 네트워크 프로토콜 지도 | — | ✅ |

## 교수(기계 중계열) (`professor-mechanical`) — 리프 6개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-mechanical-eng` | 교수(기계공학) | 기계공학 지도, 기계기사 시험 지도 | — | ✅ |
| `professor-mechatronics` | 교수(메카트로닉스공학) | 메카트로닉스 지도, 로봇공학 지도 | — | ✅ |
| `professor-navalengineering` | 교수(조선·해양공학) | 조선해양공학 지도, 선박유체역학 지도 | — | ✅ |
| `professor-aerospace` | 교수(항공·우주공학) | 항공우주공학 지도, 항공역학 지도 | — | ✅ |
| `professor-railwayengineering` | 교수(철도공학) | 철도공학 지도, 철도차량 공학 지도 | — | ✅ |
| `professor-automotive` | 교수(자동차공학) | 자동차공학 지도, 엔진공학 지도 | — | ✅ |

## 교수(건설 중계열) (`professor-construction`) — 리프 6개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-architecture` | 교수(건축학) | 건축학 지도, 건축설계 지도, 건축사 시험 지도 | — | ✅ |
| `professor-architecturalengineering` | 교수(건축공학) | 건축구조 지도, 건축시공학 지도 | — | ✅ |
| `professor-landscapearchitecture` | 교수(조경학) | 조경학 지도, 조경설계 지도 | — | ✅ |
| `professor-civilengineering` | 교수(토목공학) | 토목공학 지도, 토질역학 지도 | — | ✅ |
| `professor-urbanengineering` | 교수(도시공학) | 도시공학 지도, 도시계획 이론 지도 | — | ✅ |
| `professor-environmentalengineering` | 교수(환경공학) | 환경공학 지도, 수처리 공정 지도 | — | ✅ |

## 교수(간호 중계열) (`professor-nursing-series`) — 리프 1개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-nursing` | 교수(간호학) | 간호학 지도, 간호사 국가고시 지도 | — | ✅ |

## 교수(보건 중계열) (`professor-publichealth-series`) — 리프 6개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-publichealth` | 교수(보건학) | 보건학 지도, 역학 지도 | — | ✅ |
| `professor-rehabilitation` | 교수(재활치료) | 물리치료학 지도, 작업치료학 지도 | — | ✅ |
| `professor-clinicalhealth` | 교수(임상보건) | 임상병리학 지도, 방사선학 지도 | — | ✅ |
| `professor-healthmgmt` | 교수(보건관리) | 병원경영학 지도, 보건행정 지도 | — | ✅ |
| `professor-skincare` | 교수(피부미용) | 피부미용학 지도, 화장품학 지도 | — | ✅ |
| `professor-animalhealth` | 교수(동물보건) | 동물보건사 지도, 동물간호학 지도 | — | ✅ |

## 교수(약학 중계열) (`professor-pharmacy-series`) — 리프 2개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-pharmacy` | 교수(약학) | 약학 지도, 약사 국가고시 지도 | — | ✅ |
| `professor-herbalpharmacy` | 교수(한약학) | 한약학 지도, 본초학 지도 | — | ✅ |

## 교수(의료 중계열) (`professor-medicine-series`) — 리프 4개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-veterinary` | 교수(수의학) | 수의학 지도, 수의사 국가고시 지도 | — | ✅ |
| `professor-medicine` | 교수(의학) | 의학 본과 지도, 의사 국가고시 지도 | — | ✅ |
| `professor-dentistry-academic` | 교수(치의학) | 치의학 본과 지도, 치과의사 국가고시 지도 | — | ✅ |
| `professor-koreanmedicine` | 교수(한의학) | 한의학 본과 지도, 한의사 국가고시 지도 | — | ✅ |

## 교수(의료예과 중계열) (`professor-premedical-series`) — 리프 4개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-premed` | 교수(의예과) | 의예과 지도, 의대 편입 지도 | — | ✅ |
| `professor-predental` | 교수(치의예과) | 치의예과 지도, 치의학전문대학원 편입 지도 | — | ✅ |
| `professor-prekoreanmed` | 교수(한의예과) | 한의예과 지도, 한의학전문대학원 편입 지도 | — | ✅ |
| `professor-prevet` | 교수(수의예과) | 수의예과 지도, 수의학과 편입 지도 | — | ✅ |

## 교수(무용·체육 중계열) (`professor-dance-pe-series`) — 리프 2개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-dance` | 교수(무용) | 무용 지도, 무용과 입시 지도 | — | ✅ |
| `professor-physicaleducation` | 교수(체육) | 체육학 지도, 스포츠지도사 지도 | ✅ | ✅ |

## 교수(연극·영화 중계열) (`professor-theater-film-series`) — 리프 3개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-theater` | 교수(연극) | 연극 지도, 연극영화과 지도 | — | ✅ |
| `professor-film` | 교수(영화) | 영화 지도, 시나리오 작법 지도 | — | ✅ |
| `professor-broadcasting-entertainment` | 교수(방송연예) | 방송연예과 지도, 엔터테인먼트 산업 지도 | — | ✅ |

## 교수(응용예술 중계열) (`professor-appliedarts-series`) — 리프 6개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-photography` | 교수(사진) | 사진학 지도, 사진 구도 이론 지도 | — | ✅ |
| `professor-comics` | 교수(만화) | 만화 지도, 웹툰 창작 지도 | — | ✅ |
| `professor-animation` | 교수(애니메이션) | 애니메이션 지도, 애니메이션 12원칙 지도 | — | ✅ |
| `professor-game` | 교수(게임) | 게임학 지도, 게임 기획 지도 | — | ✅ |
| `professor-videoart` | 교수(영상예술) | 영상예술 지도, 미디어아트 지도 | — | ✅ |
| `professor-sound` | 교수(음향) | 음향학 지도, 믹싱·마스터링 지도 | — | ✅ |

## 교수(미술 중계열) (`professor-finearts-series`) — 리프 5개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-craft` | 교수(공예) | 공예 지도, 도자·금속공예 지도 | — | ✅ |
| `professor-design` | 교수(디자인) | 디자인 지도, UX/UI 디자인 지도 | — | ✅ |
| `professor-finearts` | 교수(순수미술) | 회화·조소 지도, 미대 입시 실기이론 지도 | ✅ | ✅ |
| `professor-appliedfinearts` | 교수(응용미술) | 응용미술 지도, 일러스트레이션 지도 | — | ✅ |
| `professor-arthistory` | 교수(미술학) | 미술사 지도, 미술비평 지도 | — | ✅ |

## 교수(음악 중계열) (`professor-music-series`) — 리프 7개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-composition` | 교수(작곡) | 작곡 지도, 화성학 지도 | — | ✅ |
| `professor-vocal` | 교수(성악) | 성악 지도, 발성 이론 지도 | — | ✅ |
| `professor-instrumental` | 교수(기악) | 기악 지도, 피아노·현악·관악 지도 | — | ✅ |
| `professor-koreanmusic` | 교수(국악) | 국악 지도, 판소리·장단 지도 | — | ✅ |
| `professor-contemporarymusic` | 교수(실용음악) | 실용음악 지도, 보컬·프로듀싱 지도 | — | ✅ |
| `professor-musicology` | 교수(음악학) | 음악사 지도, 음악학 지도 | — | ✅ |
| `professor-generalmusic` | 교수(교양음악) | 교양음악 지도, 음악 개론 지도 | ✅ | ✅ |

## 교수(산업·안전 중계열) (`professor-industrial-safety-series`) — 리프 3개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-industrialengineering` | 교수(산업공학) | 산업공학 지도, 품질관리 지도 | — | ✅ |
| `professor-safetyengineering` | 교수(안전공학) | 안전공학 지도, 산업안전기사 지도 | — | ✅ |
| `professor-disasterprevention` | 교수(방재공학) | 방재공학 지도, 화재공학 지도 | — | ✅ |

## 교수(재료 중계열) (`professor-materials-series`) — 리프 5개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-semiconductor` | 교수(반도체공학) | 반도체공학 지도, 반도체 교수 | — | ✅ |
| `professor-metallurgy` | 교수(금속공학) | 금속공학 지도, 금속조직학 지도 | — | ✅ |
| `professor-newmaterials` | 교수(신소재공학) | 신소재공학 지도, 나노소재 지도 | — | ✅ |
| `professor-ceramics` | 교수(세라믹공학) | 세라믹공학 지도, 소결 이론 지도 | — | ✅ |
| `professor-materials` | 교수(재료공학) | 재료공학 지도, 재료물성 지도 | — | ✅ |

## 교수(화공·고분자·에너지 중계열) (`professor-chemeng-energy-series`) — 리프 5개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-chemicalengineering` | 교수(화학공학) | 화학공학 지도, 반응공학 지도 | — | ✅ |
| `professor-energyengineering` | 교수(에너지공학) | 에너지공학 지도, 신재생에너지 지도 | — | ✅ |
| `professor-polymerengineering` | 교수(고분자공학) | 고분자공학 지도, 고분자화학 지도 | — | ✅ |
| `professor-bioengineering` | 교수(생명공학) | 생명공학 지도, 발효공학 지도 | — | ✅ |
| `professor-textileengineering` | 교수(섬유공학) | 섬유공학 지도, 섬유 소재 지도 | — | ✅ |

## 교수(교육 중계열) (`professor-education-series`) — 리프 11개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-education` | 교수(교육학) | 교육학 지도, 임용고시(교육학) 지도 | — | ✅ |
| `professor-languageeducation` | 교수(언어교육) | 언어교수법 지도, 임용고시(언어교육) 지도 | — | ✅ |
| `professor-elementaryeducation` | 교수(초등교육) | 초등교육 지도, 초등 임용고시 지도 | — | ✅ |
| `professor-socialstudieseducation` | 교수(사회과교육) | 사회과교육 지도, 임용고시(사회) 지도 | — | ✅ |
| `professor-earlychildhoodeducation` | 교수(유아교육) | 유아교육 지도, 누리과정 지도 | — | ✅ |
| `professor-specialeducation` | 교수(특수교육) | 특수교육 지도, 개별화교육계획 지도 | — | ✅ |
| `professor-scienceeducation` | 교수(자연과학교육) | 과학교육 지도, 임용고시(과학) 지도 | — | ✅ |
| `professor-healtheducation` | 교수(간호·보건 교육) | 보건교육 지도, 보건교사 임용고시 지도 | — | ✅ |
| `professor-artspeeducation` | 교수(예술·체육교육) | 예체능교육 지도, 임용고시(예체능) 지도 | — | ✅ |
| `professor-engineeringeducation` | 교수(공학교육) | 공업교육 지도, 임용고시(공업) 지도 | — | ✅ |
| `professor-generalengineering` | 교수(교양공학) | 교양공학 지도, 공학적 사고 입문 지도 | — | ✅ |

## 교수(농림·수산 중계열) (`professor-agriculture-fishery-series`) — 리프 7개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-cropscience` | 교수(작물·원예학) | 원예학 지도, 작물육종 지도 | — | ✅ |
| `professor-forestry` | 교수(산림학) | 산림학 지도, 산림생태학 지도 | — | ✅ |
| `professor-animalscience` | 교수(축산학) | 축산학 지도, 사양학 지도 | — | ✅ |
| `professor-fisheries` | 교수(수산학) | 수산학 지도, 양식학 지도 | — | ✅ |
| `professor-agroecology` | 교수(농림수산환경생태학) | 농생태학 지도, 지속가능농업 지도 | — | ✅ |
| `professor-agrobiosystems` | 교수(농림수산바이오시스템공학) | 생물시스템공학 지도, 스마트팜 지도 | — | ✅ |
| `professor-foodengineering` | 교수(식품공학) | 식품공학 지도, 식품가공 지도 | — | ✅ |

## 교수(생활과학 중계열) (`professor-homeeconomics-series`) — 리프 4개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-nutrition` | 교수(식품영양학) | 영양학 지도, 영양사 국가고시 지도 | — | ✅ |
| `professor-culinaryscience` | 교수(조리과학) | 조리과학 지도, 조리기능사 지도 | — | ✅ |
| `professor-clothing` | 교수(의류·의상학) | 의류학 지도, 의복구성학 지도 | — | ✅ |
| `professor-housingstudies` | 교수(주거학) | 주거학 지도, 주거환경심리 지도 | — | ✅ |

## 교수(교통·수송 중계열) (`professor-transportation-series`) — 리프 5개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-trafficsystems` | 교수(교통시스템공학) | 교통공학 지도, 교통신호체계 지도 | — | ✅ |
| `professor-railwaycontrol` | 교수(철도운전제어학) | 철도운전학 지도, 열차운전이론 지도 | — | ✅ |
| `professor-shipnavigation` | 교수(선박운항학) | 항해학 지도, 항해사 시험 지도 | — | ✅ |
| `professor-aviation` | 교수(항공운항학) | 항공운항학 지도, 조종사 학과시험 지도 | — | ✅ |
| `professor-uav` | 교수(무인항공기(운항)학) | 드론학 지도, 초경량비행장치 자격시험 지도 | — | ✅ |

## 교수(기타 N.C.E 중계열) (`professor-misc-series`) — 리프 6개

| id | label | 트리거 예시 | 동의어 보강 | SP 파일 |
|---|---|---|---|---|
| `professor-secretarial` | 교수(비서) | 비서학 지도, 비서 자격시험 지도 | — | ✅ |
| `professor-generalscience` | 교수(교양자연과학) | 교양자연과학 지도, 과학 개론 지도 | ✅ | ✅ |
| `professor-medicalscience` | 교수(의과학) | 의과학 지도, 중개연구방법론 지도 | — | ✅ |
| `professor-beautyart` | 교수(뷰티아트) | 뷰티아트 지도, 메이크업 색채이론 지도 | — | ✅ |
| `professor-generalpractical` | 교수(교양 기술·가정) | 기술가정 지도, 실과 지도 | ✅ | ✅ |
| `professor-careereducation` | 교수(진로교육) | 진로와 직업 지도, 진로교육 지도, 적성검사 해석 | ✅ | ✅ |

---

**합계 검증**: 161개 (기대값 161개, 일치)

## 참고

- `professor` 직속(중계열 미신설) 그룹은 법학(04) 계열 하나뿐 — `professor-law`. 레지스트리 주석에 "법학(04) 중계열 아직 미신설 — professor 직속 유지(배치2 범위 밖)"라고 명시돼 있음.
- K-12(2022 개정 교육과정) 대응 목적으로 신설된 4개 리프(`professor-generalmusic`, `professor-classicalchinese`, `professor-generalpractical`, `professor-careereducation`)는 나머지 157개와 분류 기준이 다름 — 자세한 내용은 별도 정합성 검토 문서 참고.
