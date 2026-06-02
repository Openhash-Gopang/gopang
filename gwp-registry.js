// ══════════════════════════════════════════════════════════════════
// gwp-registry.js — GWP(Gopang Widget Portal) 서비스 레지스트리
// 고팡 하위 시스템 전체 목록 + 라우팅 트리거 키워드
// ⚠️  API 키 미포함 — git 추적 가능
// ══════════════════════════════════════════════════════════════════

const GWP_REGISTRY = [
  {
    id:       'fiil-kcleaner',
    name:     'K-Cleaner',
    icon:     '🌊',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8001/webapp.html'
              : 'https://fiil.kr/webapp.html',
    triggers: ['쓰레기','환경','해안','청소','수거','오염','해양','산림','침적'],
  },
  {
    id:       'klaw',
    name:     'K-Law',
    icon:     '⚖️',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8080/webapp.html'
              : 'https://klaw.openhash.kr/webapp.html',
    triggers: ['법률','계약서','분쟁','고소','소송','판결','법원','변호사','고발','가상판결','법적'],
  },
  {
    id:       'kpolice',
    name:     'K-Police',
    icon:     '👮',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8002/webapp.html'
              : 'https://police.gopang.net/webapp.html',
    triggers: ['경찰','신고','범죄','도둑','강도','폭행','스토킹','사기','납치','위험','위협','보이스피싱','사이버범죄'],
  },
  {
    id:       'khealth',
    name:     'K-Health',
    icon:     '🏥',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8003/webapp.html'
              : 'https://health.gopang.net/webapp.html',
    triggers: ['병원','처방','증상','수술','진단','의료','건강검진','소견','약','치료','아프'],
  },
  {
    id:       'kschool',
    name:     'K-School',
    icon:     '🎓',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8004/webapp.html'
              : 'https://school.gopang.net/webapp.html',
    triggers: [
      '공부','학습','배우','가르쳐','설명해','알려줘','이해','모르겠',
      '수학','영어','과학','국어','물리','화학','생물','역사','지리',
      '사회','도덕','음악','미술','체육','코딩','프로그래밍','철학',
      '경제','통계','논리','문학','글쓰기','독서',
      '숙제','과제','시험','문제','풀어','계산','증명','해석',
      '방정식','함수','미적분','확률','기하','대수',
      '진로','대학','수능','입시','취업','직업','커리어','전공',
      '유치원','초등','중학교','고등학교','대학원',
      'AI 교수','선생님','튜터','과외','교육','학교',
    ],
  },
  {
    id:       'kmarket',
    name:     'K-Market',
    icon:     '🛍️',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8005/webapp.html'
              : 'https://market.gopang.net/webapp.html',
    triggers: ['시켜','주문','배달','예약','음식점','식당','짜장','짜면','치킨','피자','커피','카페','쇼핑','구매','찾아줘','추천','근처','거래','부동산'],
  },
  {
    id:       'ktax',
    name:     'K-Tax',
    icon:     '📋',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8006/webapp.html'
              : 'https://tax.gopang.net/webapp.html',
    triggers: ['세금','세무','납부','환급','재무','투자','대출','재무제표','절세','부가세','소득세'],
  },
  {
    id:       'kdemocracy',
    name:     'K-Democracy',
    icon:     '🗳️',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8007/webapp.html'
              : 'https://democracy.gopang.net/webapp.html',
    triggers: ['민원','등본','허가','면허','행정심판','투표','청원','안건','고팡투표'],
  },
  {
    id:       'ksecurity',
    name:     'K-Security',
    icon:     '🔒',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8008/webapp.html'
              : 'https://security.gopang.net/webapp.html',
    triggers: ['보안','해킹','랜섬웨어','개인정보','사이버보안','침해','인증오류','계정탈취'],
  },
  {
    id:       'kinsurance',
    name:     'K-Insurance',
    icon:     '🛡️',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8009/webapp.html'
              : 'https://insurance.gopang.net/webapp.html',
    triggers: ['보험','보상','청구','실손','생명보험','자동차보험','화재보험'],
  },
  {
    id:       'kpublic',
    name:     'K-Public',
    icon:     '🏛️',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8010/webapp.html'
              : 'https://public.gopang.net/webapp.html',
    triggers: ['공공','공시','공고','정부','관공서','국가','지자체','공공서비스'],
  },
  {
    id:       'kgdc',
    name:     'K-GDC',
    icon:     '🌐',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8011/webapp.html'
              : 'https://gdc.gopang.net/webapp.html',
    triggers: ['글로벌','해외','수출','무역','외국','국제','GDC'],
  },
  {
    id:       'kstock',
    name:     'K-Stock',
    icon:     '📈',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8012/webapp.html'
              : 'https://stock.gopang.net/webapp.html',
    triggers: ['주식','종목','코스피','코스닥','ETF','배당','펀드','증권'],
  },
  {
    id:       'ktraffic',
    name:     'K-Traffic',
    icon:     '🚗',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8013/webapp.html'
              : 'https://traffic.gopang.net/webapp.html',
    triggers: ['택시','버스','지하철','길','경로','교통','배차','차편','내비'],
  },
  {
    id:       'klogistics',
    name:     'K-Logistics',
    icon:     '📦',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8014/webapp.html'
              : 'https://logistics.gopang.net/webapp.html',
    triggers: ['택배','배송','물류','운송','화물','발송','도착','추적'],
  },
  {
    id:       'k911',
    name:     'K-911',
    icon:     '🚑',
    url:      location.hostname === 'localhost'
              ? 'http://localhost:8015/webapp.html'
              : 'https://911.gopang.net/webapp.html',
    triggers: ['응급','119','구급','화재','사고','쓰러','심정지','긴급구조'],
  },
];
