/**
 * onboarding/industry-router.js — KSIC 업종 판단 라우터 v1.1
 *
 * 역할:
 *  1) 사용자 자연어 입력 → keywords 매칭 → KSIC 코드 1차 분류
 *  2) 매칭 실패·복수 후보 → LLM에게 최종 확인 위임
 *  3) 분류 결과로 해당 AGENT-SUPPLIER-NN 스키마 파일명 반환
 *
 * AGENT-SUPPLIER-COMMON v1.1 §6·§7 규격 준수.
 *
 * 변경 이력:
 *  v1.0  최초 작성 — KSIC 명칭 기계적 추출 triggers
 *  v1.1  triggers 전면 갱신 — 실제 구어체·업종별 사례 키워드 중심
 *        (v1.1 파일군 실반영 + v1.0 파일군 신규 콜로키얼 추가)
 */

/* ─────────────────────────────────────────────────────────
   §1. 업종 레지스트리  (KSIC 11차 77개 중분류 전체)
   ───────────────────────────────────────────────────────── */

/**
 * @typedef {Object} IndustryEntry
 * @property {string}   code      - KSIC 중분류 코드 (문자열, 예: "56")
 * @property {string}   label     - KSIC 공식 명칭
 * @property {string}   spFile    - 해당 AGENT-SUPPLIER txt 파일명 (prompts/ 기준)
 * @property {string[]} triggers  - 구어체·업종명·사례 키워드 목록
 */

/** @type {IndustryEntry[]} */
export const INDUSTRY_REGISTRY = [

  /* ── A. 농업·임업·어업 ── */
  {
    code: '01', label: '농업',
    spFile: 'AGENT-SUPPLIER-01_agriculture_v1.2.txt',
    triggers: ['농업', '농장', '농사', '농산물직거래', '친환경농장', '밭농사', '논농사',
               '스마트팜', '원예농장', '화훼농장', '과수원', '과일농장'],
  },
  {
    code: '02', label: '임업',
    spFile: 'AGENT-SUPPLIER-02_forestry_v1.2.txt',
    triggers: ['임업', '임산물', '산림조합', '버섯재배', '수목재배', '조림', '산림경영',
               '임산업', '목재생산', '나무농장'],
  },
  {
    code: '03', label: '어업',
    spFile: 'AGENT-SUPPLIER-03_fisheries_v1.2.txt',
    triggers: ['어업', '어장', '수산업', '양식장', '활어직판', '수산물', '낚시어선',
               '해산물', '굴양식', '전복양식', '김양식', '해녀'],
  },

  /* ── B. 광업 ── */
  {
    code: '05', label: '석탄·원유·천연가스 광업',
    spFile: 'AGENT-SUPPLIER-05_coal-oil-gas-mining_v1.1.txt',
    triggers: ['석탄광업', '원유채굴', '천연가스채굴', '유전개발', '탄광'],
  },
  {
    code: '06', label: '금속광업',
    spFile: 'AGENT-SUPPLIER-06_metal-mining_v1.1.txt',
    triggers: ['금속광업', '금광', '철광석채굴', '구리광산', '아연광산', '채광'],
  },
  {
    code: '07', label: '비금속광물 광업(연료용 제외)',
    spFile: 'AGENT-SUPPLIER-07_nonmetallic-mineral-mining_v1.1.txt',
    triggers: ['석회석채굴', '규석광업', '비금속광물', '골재채취', '모래채취', '석재채취'],
  },
  {
    code: '08', label: '광업 지원 서비스업',
    spFile: 'AGENT-SUPPLIER-08_mining-support-services_v1.1.txt',
    triggers: ['시추업체', '광산탐사', '광산설비임대', '시추서비스', '광산지원'],
  },

  /* ── C. 제조업 ── */
  {
    code: '10', label: '식료품 제조업',
    spFile: 'AGENT-SUPPLIER-10_food-manufacturing_v1.1.txt',
    triggers: ['식품제조업', '식품공장', '반찬제조', '베이커리제조', 'HACCP',
               '식료품제조', '가공식품', '장류제조', '김치제조', '육가공'],
  },
  {
    code: '11', label: '음료 제조업',
    spFile: 'AGENT-SUPPLIER-11_beverage-manufacturing_v1.1.txt',
    triggers: ['음료제조업', '양조장', '전통주제조', '수제맥주', '생수제조',
               '막걸리양조', '술제조', '음료공장', '주류제조'],
  },
  {
    code: '12', label: '담배 제조업',
    spFile: 'AGENT-SUPPLIER-12_tobacco-manufacturing_v1.1.txt',
    triggers: ['담배제조업', '담배공장', '궐련제조'],
  },
  {
    code: '13', label: '섬유제품 제조업',
    spFile: 'AGENT-SUPPLIER-13_textile-manufacturing_v1.1.txt',
    triggers: ['섬유제조업', '원단제조', '직물공장', '방적업', '섬유공장', '실제조',
               '원사제조', '니트제조'],
  },
  {
    code: '14', label: '의복, 의복 액세서리 및 모피제품 제조업',
    spFile: 'AGENT-SUPPLIER-14_apparel-manufacturing_v1.1.txt',
    triggers: ['의류제조', 'OEM생산', 'ODM생산', '봉제공장', '패턴제작',
               '의류공장', '옷제조', '패션제조', '의복제조'],
  },
  {
    code: '15', label: '가죽, 가방 및 신발 제조업',
    spFile: 'AGENT-SUPPLIER-15_leather-bags-footwear_v1.1.txt',
    triggers: ['가죽제조', '가방제조', '신발제조', '수제화공방', '핸드백제조',
               '구두제조', '가죽공방', '벨트제조'],
  },
  {
    code: '16', label: '목재 및 나무제품 제조업',
    spFile: 'AGENT-SUPPLIER-16_wood-products_v1.1.txt',
    triggers: ['목재가공', '원목제재', '합판제조', '목공소', '목재공장',
               '제재소', '원목가공', '집성목'],
  },
  {
    code: '17', label: '펄프, 종이 및 종이제품 제조업',
    spFile: 'AGENT-SUPPLIER-17_pulp-paper_v1.1.txt',
    triggers: ['종이제조업', '골판지제조', '포장재제조', '지업사', '종이박스제조',
               '포장박스', '펄프제조', '화장지제조'],
  },
  {
    code: '18', label: '인쇄 및 기록매체 복제업',
    spFile: 'AGENT-SUPPLIER-18_printing-media-reproduction_v1.1.txt',
    triggers: ['인쇄소', '명함제작', '전단지인쇄', '소량인쇄', '디지털인쇄',
               '인쇄업', '현수막인쇄', '스티커인쇄', '책자인쇄', '리플렛제작'],
  },
  {
    code: '19', label: '코크스, 연탄 및 석유정제품 제조업',
    spFile: 'AGENT-SUPPLIER-19_coke-petroleum-refining_v1.1.txt',
    triggers: ['연탄제조', '석유정제', '코크스제조', '정유', '석유화학'],
  },
  {
    code: '20', label: '화학물질 및 화학제품 제조업',
    spFile: 'AGENT-SUPPLIER-20_chemicals-manufacturing_v1.1.txt',
    triggers: ['화학제품제조', '화장품제조', '화장품OEM', '세제제조', '비누제조',
               '화학공장', '도료제조', '접착제제조', '화장품ODM'],
  },
  {
    code: '21', label: '의료용 물질 및 의약품 제조업',
    spFile: 'AGENT-SUPPLIER-21_pharmaceuticals_v1.1.txt',
    triggers: ['제약회사', '의약품제조', '건강기능식품제조', '원료의약품',
               '바이오제약', '한약제조', '제약공장'],
  },
  {
    code: '22', label: '고무 및 플라스틱 제품 제조업',
    spFile: 'AGENT-SUPPLIER-22_rubber-plastics_v1.1.txt',
    triggers: ['플라스틱사출', '고무제품제조', '금형제작', '사출성형',
               '플라스틱공장', '고무공장', '성형업체'],
  },
  {
    code: '23', label: '비금속 광물제품 제조업',
    spFile: 'AGENT-SUPPLIER-23_nonmetallic-mineral-products_v1.1.txt',
    triggers: ['시멘트제조', '콘크리트제조', '유리제조', '도자기제조', '타일제조',
               '벽돌제조', '석재가공', '도기제조'],
  },
  {
    code: '24', label: '1차 금속 제조업',
    spFile: 'AGENT-SUPPLIER-24_primary-metals_v1.1.txt',
    triggers: ['제철소', '주물공장', '비철금속제련', '철강가공', '압연공장',
               '알루미늄제련', '동제련', '철강압연'],
  },
  {
    code: '25', label: '금속가공제품 제조업',
    spFile: 'AGENT-SUPPLIER-25_fabricated-metal-products_v1.1.txt',
    triggers: ['금속가공', 'CNC가공', '용접업체', '철물제작', '금속공방',
               '판금', '레이저커팅', '철구조물', '스텐가공', '알루미늄가공'],
  },
  {
    code: '26', label: '전자부품, 컴퓨터, 영상, 음향 및 통신장비 제조업',
    spFile: 'AGENT-SUPPLIER-26_electronics-computers-communication_v1.1.txt',
    triggers: ['전자부품제조', 'PCB제작', '전자기기OEM', '회로기판', 'SMT',
               '전자제품제조', '반도체패키징', '통신장비제조'],
  },
  {
    code: '27', label: '의료, 정밀, 광학기기 및 시계 제조업',
    spFile: 'AGENT-SUPPLIER-27_medical-precision-optical-instruments_v1.1.txt',
    triggers: ['의료기기제조', '정밀기기제조', '광학기기제조', '시계제조',
               '내시경제조', '진단기기제조', '렌즈제조'],
  },
  {
    code: '28', label: '전기장비 제조업',
    spFile: 'AGENT-SUPPLIER-28_electrical-equipment_v1.1.txt',
    triggers: ['전기장비제조', '배터리제조', '조명기기제조', '전동기제조',
               'LED제조', '변압기제조', '배전반제조', '이차전지'],
  },
  {
    code: '29', label: '기타 기계 및 장비 제조업',
    spFile: 'AGENT-SUPPLIER-29_other-machinery-equipment_v1.1.txt',
    triggers: ['산업용기계제조', '농기계제조', '공작기계제조', '기계설비제작',
               '포장기계', '식품기계', '특수기계'],
  },
  {
    code: '30', label: '자동차 및 트레일러 제조업',
    spFile: 'AGENT-SUPPLIER-30_automobiles-trailers_v1.1.txt',
    triggers: ['자동차부품제조', '트레일러제조', '특수차량제작', '차체제조',
               '자동차조립', '전기차부품'],
  },
  {
    code: '31', label: '기타 운송장비 제조업',
    spFile: 'AGENT-SUPPLIER-31_other-transport-equipment_v1.1.txt',
    triggers: ['조선소', '선박제조', '자전거제조', '보트제작', '요트제작',
               '선박수리', '철도차량제조'],
  },
  {
    code: '32', label: '가구 제조업',
    spFile: 'AGENT-SUPPLIER-32_furniture-manufacturing_v1.1.txt',
    triggers: ['가구제조', '맞춤가구', '목공방', '주문제작가구', '소파제조',
               '사무가구제조', '붙박이장제작', '인테리어가구'],
  },
  {
    code: '33', label: '기타 제품 제조업',
    spFile: 'AGENT-SUPPLIER-33_other-products-manufacturing_v1.1.txt',
    triggers: ['액세서리제조', '문구제조', '완구제조', '간판제작', '악기제조',
               '공예품제조', '스포츠용품제조', '의료소모품제조', '귀금속제조'],
  },
  {
    code: '34', label: '산업용 기계 및 장비 수리업',
    spFile: 'AGENT-SUPPLIER-34_industrial-machinery-repair_v1.1.txt',
    triggers: ['산업기계수리', '공장설비정비', '중장비수리', '기계수리업체',
               'MRO', '설비보수', '생산설비점검'],
  },

  /* ── D. 전기·가스·수도 ── */
  {
    code: '35', label: '전기, 가스, 증기 및 공기조절 공급업',
    spFile: 'AGENT-SUPPLIER-35_electricity-gas-steam-supply_v1.1.txt',
    triggers: ['태양광발전사업', 'LPG충전소', '신재생에너지', '지역난방',
               '태양광설치', '발전사업', '에너지판매', '풍력발전'],
  },
  {
    code: '36', label: '수도사업',
    spFile: 'AGENT-SUPPLIER-36_water-supply_v1.1.txt',
    triggers: ['지하수개발', '급수시설관리', '상수도관리', '정수시설'],
  },

  /* ── E. 폐수·환경 ── */
  {
    code: '37', label: '하수, 폐수 및 분뇨 처리업',
    spFile: 'AGENT-SUPPLIER-37_sewage-wastewater-treatment_v1.1.txt',
    triggers: ['정화조청소', '폐수처리업체', '분뇨수거', '하수처리', '오폐수처리'],
  },
  {
    code: '38', label: '폐기물 수집, 운반, 처리 및 원료 재생업',
    spFile: 'AGENT-SUPPLIER-38_waste-collection-recycling_v1.1.txt',
    triggers: ['폐기물처리업체', '재활용업체', '고철수거', '폐기물수거',
               '폐기물운반', '폐가전수거', '중고철', '재활용센터', '폐지수거'],
  },
  {
    code: '39', label: '환경 정화 및 복원업',
    spFile: 'AGENT-SUPPLIER-39_environmental-remediation_v1.1.txt',
    triggers: ['토양정화업체', '환경복원', '오염정화', '환경정화', '부지정화'],
  },

  /* ── F. 건설업 ── */
  {
    code: '41', label: '종합 건설업',
    spFile: 'AGENT-SUPPLIER-41_general-construction_v1.0.txt',
    triggers: ['건설사', '시공사', '건축회사', '주택건설', '아파트시공', '토목공사',
               '종합건설', '건설업체', '공사업체', '디벨로퍼', '시행사'],
  },
  {
    code: '42', label: '전문직별 공사업',
    spFile: 'AGENT-SUPPLIER-42_specialty-trade-construction_v1.0.txt',
    triggers: ['전기공사', '설비공사', '인테리어', '도배', '타일공사', '배관공사',
               '철거업체', '리모델링', '도장공사', '방수공사', '조적공사',
               '미장', '유리공사', '창호공사', '단열공사'],
  },

  /* ── G. 도소매업 ── */
  {
    code: '45', label: '자동차 및 부품 판매업',
    spFile: 'AGENT-SUPPLIER-45_automobile-parts-sales_v1.0.txt',
    triggers: ['자동차대리점', '중고차판매', '카센터', '자동차부품판매',
               '오토바이판매', '차량매매', '중고차상사', '폐차장', '자동차용품점'],
  },
  {
    code: '46', label: '도매 및 상품 중개업',
    spFile: 'AGENT-SUPPLIER-46_wholesale-brokerage_v1.0.txt',
    triggers: ['도매상', '도매업체', '유통업체', '식자재도매', '식품도매',
               '도매업', '총판', '대리점', '유통대리점', '상품중개', '벌크판매'],
  },
  {
    code: '47', label: '소매업; 자동차 제외',
    spFile: 'AGENT-SUPPLIER-47_retail-trade_v1.0.txt',
    triggers: ['마트', '편의점', '슈퍼마켓', '잡화점', '온라인쇼핑몰', '쇼핑몰',
               '소매점', '소매업', '동네마트', '가게', '상점', '전자제품소매',
               '화장품가게', '의류매장', '옷가게'],
  },

  /* ── H. 운수·창고 ── */
  {
    code: '49', label: '육상 운송 및 파이프라인 운송업',
    spFile: 'AGENT-SUPPLIER-49_land-transport-pipeline_v1.0.txt',
    triggers: ['택배', '화물운송', '이사업체', '퀵서비스', '버스회사', '택시회사',
               '화물차', '용달', '화물기사', '운송업', '트럭운송', '냉동차'],
  },
  {
    code: '50', label: '수상 운송업',
    spFile: 'AGENT-SUPPLIER-50_water-transport_v1.0.txt',
    triggers: ['선박운송', '해운사', '도선업', '페리', '여객선', '카페리'],
  },
  {
    code: '51', label: '항공 운송업',
    spFile: 'AGENT-SUPPLIER-51_air-transport_v1.0.txt',
    triggers: ['항공사', '드론운송', '항공화물', '헬기운송', '항공운송'],
  },
  {
    code: '52', label: '창고 및 운송관련 서비스업',
    spFile: 'AGENT-SUPPLIER-52_warehousing-transport-support_v1.0.txt',
    triggers: ['물류창고', '창고업', '포워딩', '관세사', '물류센터',
               '풀필먼트', '3PL', '운송주선', '항만운영', '하역업'],
  },

  /* ── I. 숙박·음식점 ── */
  {
    code: '55', label: '숙박업',
    spFile: 'AGENT-SUPPLIER-55_accommodation_v1.0.txt',
    triggers: ['호텔', '모텔', '펜션', '게스트하우스', '에어비앤비', '민박',
               '캠핑장', '숙박업', '리조트', '콘도', '글램핑', '한옥스테이'],
  },
  {
    code: '56', label: '음식점 및 주점업',
    spFile: 'AGENT-SUPPLIER-56_restaurants-bars_v1.0.txt',
    triggers: ['식당', '음식점', '카페', '치킨집', '피자집', '분식집',
               '한식당', '중식당', '일식당', '패스트푸드', '배달음식',
               '술집', '주점', '바', '포장마차', '국밥집', '고깃집',
               '쌀국수', '해장국', '냉면집', '커피숍', '디저트카페'],
  },

  /* ── J. 정보통신업 ── */
  {
    code: '58', label: '출판업',
    spFile: 'AGENT-SUPPLIER-58_publishing_v1.0.txt',
    triggers: ['출판사', '책출판', '잡지사', '전자책', '독립출판',
               '교재출판', '웹툰출판', '도서출판'],
  },
  {
    code: '59', label: '영상·오디오 기록물 제작 및 배급업',
    spFile: 'AGENT-SUPPLIER-59_film-video-audio-production_v1.0.txt',
    triggers: ['영화제작', '드라마제작', '광고제작', '유튜브', '크리에이터',
               '음원제작', '녹음스튜디오', '뮤직비디오', '영상제작', '콘텐츠제작',
               '광고영상', '유튜브채널운영', '숏폼', '웹드라마'],
  },
  {
    code: '60', label: '방송업',
    spFile: 'AGENT-SUPPLIER-60_broadcasting-streaming_v1.0.txt',
    triggers: ['방송국', '라디오방송', '인터넷방송', '팟캐스트',
               '온라인방송', '스트리밍서비스', 'OTT'],
  },
  {
    code: '61', label: '우편 및 통신업',
    spFile: 'AGENT-SUPPLIER-61_postal-telecommunications_v1.0.txt',
    triggers: ['통신사', '인터넷서비스', 'IPTV', '알뜰폰', '통신망운영',
               'ISP', '위성통신'],
  },
  {
    code: '62', label: '컴퓨터 프로그래밍, 시스템 통합 및 관리업',
    spFile: 'AGENT-SUPPLIER-62_computer-programming-it_v1.0.txt',
    triggers: ['IT회사', '소프트웨어개발', '앱개발', '웹개발', '프로그래밍',
               'SI업체', '개발회사', '시스템통합', 'IT솔루션', 'ERP구축',
               '모바일앱', '서버관리', '클라우드구축'],
  },
  {
    code: '63', label: '정보서비스업',
    spFile: 'AGENT-SUPPLIER-63_information-services_v1.0.txt',
    triggers: ['데이터분석', '포털사이트', '플랫폼운영', '빅데이터', '클라우드서비스',
               'AI서비스', '데이터제공', '정보서비스'],
  },

  /* ── K. 금융·보험 ── */
  {
    code: '64', label: '금융업',
    spFile: 'AGENT-SUPPLIER-64_banking-finance_v1.0.txt',
    triggers: ['은행', '저축은행', '증권사', '투자회사', '신협', '새마을금고',
               '대부업', '투자조합', '벤처캐피탈', '사모펀드', '농협은행'],
  },
  {
    code: '65', label: '보험 및 연금업',
    spFile: 'AGENT-SUPPLIER-65_insurance_v1.0.txt',
    triggers: ['보험사', '보험대리점', '보험설계사', '보험회사', '손해보험',
               '생명보험', '공제조합'],
  },
  {
    code: '66', label: '금융 및 보험 관련 서비스업',
    spFile: 'AGENT-SUPPLIER-66_financial-insurance-support_v1.0.txt',
    triggers: ['환전소', '신용카드사', '핀테크', '결제대행', 'PG사',
               '신용평가', '투자자문', '재무컨설팅'],
  },

  /* ── L. 부동산업 ── */
  {
    code: '68', label: '부동산업',
    spFile: 'AGENT-SUPPLIER-68_real-estate_v1.0.txt',
    triggers: ['부동산', '공인중개사', '분양대행', '임대업', '부동산관리',
               '부동산중개', '집주인', '건물관리', '상가임대', '주택임대', '부동산개발'],
  },

  /* ── M. 전문·과학·기술 서비스 ── */
  {
    code: '70', label: '연구개발업',
    spFile: 'AGENT-SUPPLIER-70_research-development_v1.0.txt',
    triggers: ['연구소', 'R&D', '기술개발', '연구개발기관', '기업연구소',
               '연구개발업체', '기술연구소'],
  },
  {
    code: '71', label: '전문서비스업',
    spFile: 'AGENT-SUPPLIER-71_professional-services_v1.0.txt',
    triggers: ['법무사무소', '법률사무소', '변호사', '세무사', '회계사',
               '컨설팅', '경영컨설팅', '법무법인', '법률사', '세무법인',
               '특허사무소', '변리사'],
  },
  {
    code: '72', label: '건축기술, 엔지니어링 및 기타 과학기술 서비스업',
    spFile: 'AGENT-SUPPLIER-72_architecture-engineering_v1.0.txt',
    triggers: ['건축설계사무소', '설계사무소', '엔지니어링', '측량업체', '감리',
               '건축사사무소', '구조설계', '기계설계', '환경컨설팅', '지질조사'],
  },
  {
    code: '73', label: '기타 전문, 과학 및 기술 서비스업',
    spFile: 'AGENT-SUPPLIER-73_other-professional-scientific-services_v1.0.txt',
    triggers: ['광고대행사', '디자인사무소', '번역회사', '수의사', '동물병원',
               '광고회사', '브랜딩', '그래픽디자인', '사진스튜디오', '번역업체'],
  },
  {
    code: '74', label: '사업시설 관리, 사업지원 및 임대 서비스업',
    spFile: 'AGENT-SUPPLIER-74_facilities-management-landscaping_v1.0.txt',
    triggers: ['빌딩관리', '시설관리', '경비업체', '청소업체', '조경업체',
               '빌딩청소', '시설경비', '건물관리업체', '환경미화'],
  },
  {
    code: '75', label: '사업지원 서비스업',
    spFile: 'AGENT-SUPPLIER-75_business-support-services_v1.0.txt',
    triggers: ['파견업체', '인력사무소', '여행사', '이벤트회사', '콜센터',
               '인재파견', '아웃소싱', '행사대행', '여행대리점', '전시기획'],
  },
  {
    code: '76', label: '임대업; 부동산 제외',
    spFile: 'AGENT-SUPPLIER-76_rental-leasing_v1.0.txt',
    triggers: ['렌탈', '장비임대', '차량렌트', '렌터카', '레카', '기계임대',
               '건설장비임대', '의료기기렌탈', '가전렌탈'],
  },

  /* ── O. 공공행정 ── */
  {
    code: '84', label: '공공행정, 국방 및 사회보장 행정',
    spFile: 'AGENT-SUPPLIER-84_public-administration-defense_v1.0.txt',
    triggers: ['공공기관', '관공서', '행정기관', '지자체', '군부대',
               '정부기관', '공기업'],
  },

  /* ── P. 교육 서비스업 ── */
  {
    code: '85', label: '교육 서비스업',
    spFile: 'AGENT-SUPPLIER-85_education-services_v1.0.txt',
    triggers: ['학원', '교습소', '과외', '유치원', '어린이집', '학교', '평생교육원',
               '직업훈련', '어학원', '코딩학원', '체육학원', '음악학원', '미술학원',
               '입시학원', '독서실', '이러닝'],
  },

  /* ── Q. 보건·사회복지 ── */
  {
    code: '86', label: '보건업',
    spFile: 'AGENT-SUPPLIER-86_health-care_v1.0.txt',
    triggers: ['병원', '의원', '한의원', '치과', '약국', '보건소', '의료기관',
               '내과', '외과', '피부과', '정형외과', '소아과', '산부인과',
               '안과', '이비인후과', '정신건강의학과', '한의원', '치과의원'],
  },
  {
    code: '87', label: '사회복지 서비스업',
    spFile: 'AGENT-SUPPLIER-87_social-welfare-services_v1.0.txt',
    triggers: ['복지관', '요양원', '노인요양', '장애인시설', '사회복지',
               '노인복지관', '주간보호센터', '재가복지', '사회적기업', '자활센터'],
  },

  /* ── R. 예술·스포츠·여가 ── */
  {
    code: '90', label: '창작, 예술 및 여가관련 서비스업',
    spFile: 'AGENT-SUPPLIER-90_creative-arts-leisure_v1.0.txt',
    triggers: ['공방', '예술공방', '공연장', '갤러리', '게임방', '노래방',
               '카페형공방', '도예공방', '목공공방', '악기학원', '실내스크린골프',
               '방탈출카페', '보드게임카페'],
  },
  {
    code: '91', label: '스포츠 및 오락관련 서비스업',
    spFile: 'AGENT-SUPPLIER-91_sports-recreation_v1.0.txt',
    triggers: ['헬스장', '스포츠센터', '수영장', '볼링장', '골프연습장',
               '스키장', '레저시설', '요가원', '필라테스', '클라이밍',
               '골프장', '스크린골프', '체육관', '당구장'],
  },

  /* ── S. 협회·단체·수리·기타 ── */
  {
    code: '94', label: '협회 및 단체',
    spFile: 'AGENT-SUPPLIER-94_associations-organizations_v1.0.txt',
    triggers: ['협회', '조합', '단체', '재단', '비영리단체', '사단법인',
               '재단법인', '직능단체', '업종협회'],
  },
  {
    code: '95', label: '개인 및 소비용품 수리업',
    spFile: 'AGENT-SUPPLIER-95_personal-goods-repair_v1.0.txt',
    triggers: ['수리점', '세탁소', '구두수선', '시계수리', '전자제품수리', '핸드폰수리',
               '가전수리', '자전거수리', '의류수선', '가방수선', '수선집'],
  },
  {
    code: '96', label: '기타 개인 서비스업',
    spFile: 'AGENT-SUPPLIER-96_other-personal-services_v1.0.txt',
    triggers: ['미용실', '헤어샵', '네일샵', '피부관리', '마사지', '찜질방',
               '사우나', '세차장', '사진관', '애견미용', '반려동물호텔',
               '결혼정보업체', '장례식장'],
  },
  {
    code: '97', label: '가구 내 고용활동 및 달리 분류되지 않은 자가소비 생산활동',
    spFile: 'AGENT-SUPPLIER-97_household-employment_v1.0.txt',
    triggers: ['가사도우미', '베이비시터', '산후도우미', '육아도우미',
               '가사서비스', '생활지원사', '가정관리사'],
  },
  {
    code: '98', label: '자가소비를 위한 가구의 재화 및 서비스 생산활동',
    spFile: 'AGENT-SUPPLIER-98_own-consumption-production_v1.0.txt',
    triggers: ['자가소비', '자급자족'],
  },

  /* ── U. 국제기구 ── */
  {
    code: '99', label: '국제 및 외국기관',
    spFile: 'AGENT-SUPPLIER-99_international-foreign-organizations_v1.0.txt',
    triggers: ['국제기구', '외국공관', '대사관', '영사관', '유엔', 'UN기관'],
  },
];

/* ─────────────────────────────────────────────────────────
   §2. 매칭 로직
   ───────────────────────────────────────────────────────── */

/**
 * 사용자 자연어 입력에서 업종 후보를 찾는다.
 * @param {string} text - 사용자 입력
 * @returns {IndustryEntry[]} 매칭된 후보 목록 (0~N)
 */
function _matchCandidates(text) {
  const t = text.toLowerCase().replace(/\s+/g, '');
  return INDUSTRY_REGISTRY.filter(entry =>
    entry.triggers.some(kw => t.includes(kw.toLowerCase()))
  );
}

/* ─────────────────────────────────────────────────────────
   §3. LLM 폴백 (OpenRouter / DeepSeek)
   ───────────────────────────────────────────────────────── */

/**
 * LLM에게 최종 업종 분류를 요청한다.
 * @param {string}         userText   - 원본 사용자 입력
 * @param {IndustryEntry[]} candidates - 좁혀진 후보 (빈 배열이면 전체 77개)
 * @param {object}         apiCfg     - { endpoint, apiKey, model }
 * @returns {Promise<IndustryEntry|null>}
 */
async function _llmClassify(userText, candidates, apiCfg) {
  const pool = candidates.length > 0 ? candidates : INDUSTRY_REGISTRY;
  const listText = pool
    .map(e => `${e.code}: ${e.label}`)
    .join('\n');

  const prompt =
    `다음 한국표준산업분류(KSIC) 업종 목록 중 사용자 설명에 가장 맞는 업종 코드를 ` +
    `정확히 숫자만 반환하세요. 모르겠으면 "0"을 반환하세요.\n\n` +
    `## 업종 목록\n${listText}\n\n` +
    `## 사용자 설명\n"${userText}"\n\n` +
    `## 응답 (숫자 코드만):`;

  try {
    const res = await fetch(apiCfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiCfg.apiKey}`,
      },
      body: JSON.stringify({
        model: apiCfg.model || 'deepseek/deepseek-chat',
        max_tokens: 10,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`LLM ${res.status}`);
    const data = await res.json();
    const raw = data?.choices?.[0]?.message?.content?.trim() ?? '';
    const code = raw.replace(/\D/g, '');
    return INDUSTRY_REGISTRY.find(e => e.code === code) ?? null;
  } catch (err) {
    console.warn('[IndustryRouter] LLM 분류 실패:', err.message);
    return null;
  }
}

/* ─────────────────────────────────────────────────────────
   §4. 공개 API
   ───────────────────────────────────────────────────────── */

/**
 * 업종 분류 메인 함수 (AGENT-SUPPLIER-COMMON v1.1 §7 플로우 구현)
 *
 * @param {string} userText  - 사용자가 입력한 사업 설명 자연어
 * @param {object} [apiCfg]  - LLM 설정. 없으면 폴백 없이 키워드 매칭만 수행.
 *   @param {string} apiCfg.endpoint - API 엔드포인트 URL
 *   @param {string} apiCfg.apiKey   - Bearer 토큰
 *   @param {string} [apiCfg.model]  - 모델명 (기본: deepseek/deepseek-chat)
 *
 * @returns {Promise<{entry: IndustryEntry|null, method: 'keyword'|'llm'|'none'}>}
 *   entry  — 분류 결과 (null이면 미분류)
 *   method — 어떤 방법으로 분류됐는지
 */
export async function classifyIndustry(userText, apiCfg = null) {
  if (!userText || !userText.trim()) {
    return { entry: null, method: 'none' };
  }

  const candidates = _matchCandidates(userText);

  // §7-1: 정확히 1개 매칭 → 즉시 확정 (LLM 불필요)
  if (candidates.length === 1) {
    return { entry: candidates[0], method: 'keyword' };
  }

  // §7-2: 매칭 0개 또는 복수 → LLM에 위임
  if (apiCfg) {
    const entry = await _llmClassify(userText, candidates, apiCfg);
    return { entry, method: entry ? 'llm' : 'none' };
  }

  // apiCfg 없고 복수 후보 → 첫 번째 후보 반환 (최선의 노력)
  if (candidates.length > 1) {
    console.warn('[IndustryRouter] 복수 후보 / LLM 미설정 → 첫 번째 후보 사용:', candidates[0].code);
    return { entry: candidates[0], method: 'keyword' };
  }

  return { entry: null, method: 'none' };
}

/**
 * KSIC 코드로 직접 조회
 * @param {string} code
 * @returns {IndustryEntry|undefined}
 */
export function findByCode(code) {
  return INDUSTRY_REGISTRY.find(e => e.code === String(code));
}
